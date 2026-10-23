const finite = Number.isFinite;
const { movement } = require("./live-gaps.cjs");

// Practice timing only. No game memory or native scoring state is modified.
class CheckpointTiming {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.reset();
  }
  reset() {
    this.checkpoint = null;
    this.attempt = null;
    this.reference = null;
    this.finishDistance = null;
    this.bestSeconds = null;
    this.pending = null;
    this.lastAck = null;
    this.lastRejection = null;
    this.suspended = false;
    this.latest = null;
    this.restoreCandidate = null;
    this.restoreObserved = null;
  }
  onStatus(state) {
    if (state.checkpoint === false) {
      this.reset();
      return;
    }
    const preparing = [2, 3].includes(state.reset_action);
    if (preparing && !this.suspended && this.attempt?.valid)
      this.captureRestoreCandidate();
    const action = state.last_event;
    const key = `${state.log_prefix}:${state.report_id}:${action}`;
    if (action === "rejected" && key !== this.lastRejection) {
      this.restoreCandidate = null;
      this.restoreObserved = null;
      this.lastRejection = key;
    }
    this.suspended = preparing;
    if (
      !state.checkpoint ||
      !["save", "restore"].includes(action) ||
      !Number.isSafeInteger(state.report_id) ||
      key === this.lastAck
    )
      return;
    this.lastAck = key;
    if (action === "save") {
      this.checkpoint = null;
      this.reference = null;
      this.finishDistance = null;
      this.bestSeconds = null;
      this.restoreCandidate = null;
      this.restoreObserved = null;
    } else {
      if (!this.checkpoint) return;
      const recent =
        this.restoreCandidate &&
        this.now() - this.restoreCandidate.capturedAt <= 1500;
      const previous = this.restoreCandidate
        ? recent
          ? this.restoreCandidate
          : null
        : this.attempt;
      if (!this.finishDistance && previous?.valid && previous.progress >= 5) {
        this.finishDistance = previous.progress;
        this.bestSeconds = previous.elapsed;
        this.reference = [...previous.samples.map((sample) => ({ ...sample }))];
        if (this.reference.at(-1).distance < this.finishDistance)
          this.reference.push({
            distance: this.finishDistance,
            seconds: this.bestSeconds,
          });
      }
    }
    this.attempt = null;
    this.restoreCandidate = null;
    this.suspended = false;
    // Telemetry and command acknowledgements arrive on independent streams.
    // Retain the first observed landing instead of starting late at the next poll.
    const landing = this.restoreObserved;
    this.restoreObserved = null;
    if (
      action === "restore" &&
      landing &&
      this.now() - landing.observedAt <= 1500
    ) {
      this.startAttempt(landing.sample);
      this.pending = null;
      return;
    }
    this.pending = {
      action,
      deadline: this.now() + 1500,
      minET: this.latest?.et,
    };
  }
  sample(raw) {
    const p = raw?.player;
    const car = raw?.cars?.find((value) => value.id === p?.id);
    if (
      !raw?.connected ||
      !p ||
      !car ||
      !finite(p.et) ||
      !finite(car.distance) ||
      !finite(raw.length) ||
      raw.length <= 0 ||
      !finite(p.speed)
    )
      return null;
    const live = movement(car, raw.et);
    // Pair distance with its own timestamp. A scoring-only frame must never
    // advance a high-rate clock against an unchanged low-rate distance.
    const et = live ? live.et : raw.et;
    if (!finite(et)) return null;
    return {
      et,
      live: Boolean(live),
      distance:
        (((car.distance + (live?.travel ?? 0)) % raw.length) + raw.length) %
        raw.length,
      length: raw.length,
      speed: Math.abs(p.speed) / 3.6,
      identity: JSON.stringify([
        raw.track,
        raw.session,
        p.id,
        p.model,
        raw.length,
      ]),
    };
  }
  hold() {
    if (this.attempt) this.attempt.held = true;
  }
  captureRestoreCandidate() {
    this.restoreCandidate = {
      ...this.attempt,
      samples: this.attempt.samples.map((point) => ({ ...point })),
      capturedAt: this.now(),
    };
  }
  nearCheckpoint(sample) {
    const offset = Math.abs(sample.distance - this.checkpoint.distance);
    return (
      Math.min(offset, sample.length - offset) <=
      Math.max(20, sample.speed * 0.5)
    );
  }
  observeRestore(sample) {
    if (!this.checkpoint || !this.nearCheckpoint(sample)) return;
    if (this.attempt?.valid && !this.restoreCandidate)
      this.captureRestoreCandidate();
    if (this.restoreCandidate && !this.restoreObserved)
      this.restoreObserved = { sample, observedAt: this.now() };
  }
  startAttempt(sample) {
    this.attempt = {
      valid: true,
      et: sample.et,
      distance: sample.distance,
      elapsed: 0,
      progress: 0,
      samples: [{ distance: 0, seconds: 0 }],
      comparison: this.reference,
      comparisonBest: this.bestSeconds,
      finished: false,
    };
  }
  invalidate(reason) {
    if (this.attempt) {
      this.attempt.valid = false;
      this.attempt.reason = reason;
    }
  }
  update(raw) {
    const sample = this.sample(raw);
    if (!sample) {
      // A missing player during a restore is not evidence of a new session.
      // Preserve the checkpoint/reference; reject the interrupted attempt.
      if (!this.attempt?.finished) {
        if (this.attempt?.valid) this.captureRestoreCandidate();
        this.invalidate("Checkpoint telemetry unavailable");
      }
      return this.value();
    }
    this.latest = sample;
    if (this.checkpoint && sample.identity !== this.checkpoint.identity) {
      this.reset();
      return null;
    }
    if (
      this.restoreCandidate &&
      this.now() - this.restoreCandidate.capturedAt > 1500
    ) {
      this.restoreCandidate = null;
      this.restoreObserved = null;
    }
    if (this.attempt?.finished) return this.value();
    if (raw.paused || !raw.driving) {
      this.hold();
      return this.value();
    }
    if (this.pending) {
      if (this.now() > this.pending.deadline) {
        this.pending = null;
        this.attempt = {
          valid: false,
          reason: "Checkpoint telemetry unavailable",
        };
        return this.value();
      }
      if (
        this.suspended ||
        (finite(this.pending.minET) && sample.et <= this.pending.minET)
      )
        return this.value();
      if (this.pending.action === "restore") {
        if (!this.nearCheckpoint(sample)) return this.value();
      } else this.checkpoint = { ...sample };
      this.startAttempt(sample);
      this.pending = null;
      return this.value();
    }
    const a = this.attempt;
    if (!a?.valid) {
      if (this.restoreCandidate) this.observeRestore(sample);
      return this.value();
    }
    if (this.suspended) {
      if (
        Math.abs(sample.distance - a.distance) >
        Math.max(15, sample.speed * 0.5)
      )
        this.observeRestore(sample);
      return this.value();
    }
    if (a.held) {
      a.held = false;
      a.et = sample.et;
      const offset = Math.abs(sample.distance - a.distance);
      if (Math.min(offset, sample.length - offset) > 5) {
        this.observeRestore(sample);
        this.invalidate("Position changed while paused");
      }
      return this.value();
    }
    const dt = sample.et - a.et;
    // A temporary loss of projection may expose an older scoring anchor.
    // Wait for it to catch up rather than treating it as a simulation rewind.
    if (!sample.live && dt <= 0 && finite(raw.et) && raw.player.et > sample.et)
      return this.value();
    if (dt === 0) return this.value();
    if (dt < 0 || dt > 1.5) {
      this.observeRestore(sample);
      this.invalidate("Simulation time discontinuity");
      return this.value();
    }
    let step = sample.distance - a.distance;
    if (step < -sample.length / 2) step += sample.length;
    if (step > sample.length / 2) step -= sample.length;
    if (step < -3 || step > Math.max(15, sample.speed * dt * 2 + 5)) {
      this.observeRestore(sample);
      this.invalidate("Position discontinuity or reverse driving");
      return this.value();
    }
    const previousProgress = a.progress;
    const previousElapsed = a.elapsed;
    a.et = sample.et;
    a.elapsed += dt;
    if (step > 0) {
      a.distance = sample.distance;
      a.progress += step;
      if (a.progress - a.samples.at(-1).distance >= 2) {
        if (a.samples.length >= 20000)
          this.invalidate("Attempt recording limit reached");
        else a.samples.push({ distance: a.progress, seconds: a.elapsed });
      }
    }
    if (a.valid && this.finishDistance && a.progress >= this.finishDistance) {
      const fraction =
        (this.finishDistance - previousProgress) /
        (a.progress - previousProgress);
      a.elapsed = previousElapsed + fraction * dt;
      a.progress = this.finishDistance;
      a.samples = a.samples.filter(
        (point) => point.distance < this.finishDistance,
      );
      a.samples.push({ distance: this.finishDistance, seconds: a.elapsed });
      a.finished = true;
      if (a.elapsed < this.bestSeconds) {
        this.reference = a.samples.map((point) => ({ ...point }));
        this.bestSeconds = a.elapsed;
        a.record = true;
      }
    }
    return this.value();
  }
  value() {
    if (!this.checkpoint && !this.pending) return null;
    const a = this.attempt;
    let delta = null;
    const reference = a?.comparison;
    if (a?.valid && reference && a.progress <= reference.at(-1).distance) {
      // Binary search avoids scanning a long reference on every display frame.
      let low = 0,
        high = reference.length - 1;
      while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (reference[mid].distance < a.progress) low = mid;
        else high = mid;
      }
      const left = reference[low],
        right = reference[high];
      const fraction =
        (a.progress - left.distance) / (right.distance - left.distance);
      delta =
        a.elapsed - (left.seconds + fraction * (right.seconds - left.seconds));
    }
    return {
      active: true,
      valid: Boolean(a?.valid) && !this.pending && !this.suspended,
      seconds: a?.valid ? a.elapsed : null,
      delta,
      reference: Boolean(a?.comparison),
      referenceSeconds: a?.comparisonBest ?? null,
      progress: a?.progress ?? 0,
      remainingDistance:
        this.finishDistance !== null && a?.valid
          ? Math.max(0, this.finishDistance - a.progress)
          : null,
      bestSeconds: this.bestSeconds,
      finishDistance: this.finishDistance,
      finished: Boolean(a?.finished),
      record: Boolean(a?.record),
      reason:
        a?.reason || (this.pending ? "Waiting for checkpoint telemetry" : ""),
    };
  }
}
module.exports = { CheckpointTiming };
