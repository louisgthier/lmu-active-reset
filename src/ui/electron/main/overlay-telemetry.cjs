const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { discoverGame } = require("./runtime.cjs");
const { TelemetryModel } = require("../shared/overlay-model.cjs");
const { CheckpointTiming } = require("../shared/checkpoint-timing.cjs");
const PAUSE_TIMEOUT = 300;
const SCORING_TIMEOUT = 1500;
const displayRate = (value) =>
  Number.isFinite(value) && value >= 1 && value <= 1000 ? value : 60;
class OverlayTelemetry extends EventEmitter {
  constructor(
    root,
    {
      discover = discoverGame,
      spawnChild = spawn,
      now = Date.now,
      getRefreshRate = () => 60,
    } = {},
  ) {
    super();
    Object.assign(this, { root, discover, spawnChild, now, getRefreshRate });
    this.model = new TelemetryModel();
    this.checkpointTiming = new CheckpointTiming({ now });
    this.frame = null;
    this.status = "Waiting for LMU";
    this.stopped = true;
    this.last = 0;
    this.refreshRate = displayRate(getRefreshRate());
    this.restoreUntil = 0;
    this.restorePending = false;
  }
  publish(frame, status) {
    this.frame = frame;
    this.status = status;
    this.emit("frame", frame);
  }
  onResetStatus(state) {
    this.checkpointTiming.onStatus(state);
    const wasPending = this.restorePending;
    const pending =
      state.phase === "active" && [2, 3].includes(state.reset_action);
    if (pending && !this.restorePending) this.restoreUntil = this.now() + 1000;
    this.restorePending = pending;
    const count = Number.isSafeInteger(state.restore_count)
      ? state.restore_count
      : 0;
    if (count > (this.restoreCount || 0)) {
      // A short rewind may not cross a lap or the position discontinuity threshold.
      this.model.reset();
      // Keep the displayed frame until the next sample, without keeping lap history.
      this.restoreUntil = Math.max(
        this.restoreUntil,
        this.now() + PAUSE_TIMEOUT,
      );
    } else if ((wasPending && !pending) || state.phase !== "active") {
      this.restoreUntil = 0;
    }
    this.restoreCount = count;
  }
  setRefreshRate(value) {
    const rate = displayRate(value);
    if (rate === this.refreshRate) return;
    this.refreshRate = rate;
    if (
      this.child &&
      !this.child.stdin.destroyed &&
      !this.child.stdin.writableEnded
    )
      this.child.stdin.write(`rate ${rate}\n`);
  }
  expire() {
    if (!this.frame || this.now() < this.restoreUntil) return;
    const timeout =
      this.frame.driving && this.frame.player ? PAUSE_TIMEOUT : SCORING_TIMEOUT;
    if (
      this.now() - this.last >= timeout ||
      this.now() - this.lastScoring >= SCORING_TIMEOUT
    )
      this.publish(null, "Waiting for telemetry");
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), 50);
    void this.tick();
  }
  async tick() {
    if (this.stopped || this.busy) return;
    if (this.now() >= (this.nextRateCheck || 0)) {
      this.nextRateCheck = this.now() + 1000;
      this.setRefreshRate(this.getRefreshRate());
    }
    if (this.child) {
      this.expire();
      return;
    }
    if (this.now() < (this.retry || 0)) return;
    this.busy = true;
    this.retry = this.now() + 2500;
    try {
      const binary = path.join(this.root, "bin/overlay-reader.exe");
      if (!fs.existsSync(binary)) {
        this.publish(null, "Build the overlay reader");
        return;
      }
      const games = await this.discover();
      if (this.stopped) return;
      if (games.length !== 1) {
        this.publish(
          null,
          games.length ? "Select one LMU instance" : "Waiting for LMU",
        );
        return;
      }
      const child = this.spawnChild(
        binary,
        [String(games[0].pid), String(process.pid), String(this.refreshRate)],
        { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
      );
      this.child = child;
      this.last = this.now();
      this.lastET = this.lastETScoring = undefined;
      this.lastScoring = this.lastTelemetry = this.last;
      this.restoreUntil = 0;
      this.model.reset();
      let buffer = "";
      child.stdin.on("error", () => {});
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (this.stopped || this.child !== child) return;
        buffer += chunk;
        if (buffer.length > 1024 * 1024) {
          buffer = "";
          return;
        }
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const raw = JSON.parse(line);
            if (
              raw.schema !== 1 ||
              !Array.isArray(raw.cars) ||
              raw.cars.length > 104
            )
              continue;
            // SDK timestamps must advance. A paused mapping must not leave a frozen HUD on screen.
            const now = this.now();
            if (raw.player?.et !== this.lastET) {
              this.lastTelemetry = now;
              this.lastET = raw.player?.et;
            }
            if (raw.et !== this.lastETScoring) {
              this.lastScoring = now;
              this.lastETScoring = raw.et;
            }
            this.last =
              raw.driving && raw.player ? this.lastTelemetry : this.lastScoring;
            // The SDK pause heartbeat takes priority even during a reset handoff.
            if (raw.paused === true) {
              this.restoreUntil = 0;
              this.checkpointTiming.hold();
              this.publish(null, "Paused");
              continue;
            }
            const timeout =
              raw.driving && raw.player ? PAUSE_TIMEOUT : SCORING_TIMEOUT;
            if (
              now - this.last >= timeout ||
              now - this.lastScoring >= SCORING_TIMEOUT
            ) {
              if (!raw.foreground || !raw.connected || !raw.cars.length)
                this.restoreUntil = 0;
              this.expire();
              continue;
            }
            this.publish(
              {
                ...this.model.update(raw),
                checkpointTiming: this.checkpointTiming.update(raw),
              },
              raw.cars.length ? "Live" : "Waiting for session",
            );
          } catch {
            this.publish(null, "Telemetry unavailable");
          }
        }
      });
      const ended = () => {
        if (this.child === child) {
          this.child = null;
          this.lastET = null;
          this.lastETScoring = null;
          this.checkpointTiming.reset();
          this.publish(null, "Waiting for telemetry");
        }
      };
      child.on("error", ended);
      child.on("exit", ended);
    } catch {
      this.publish(null, "Telemetry unavailable");
    } finally {
      this.busy = false;
    }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    this.restoreUntil = 0;
    this.restorePending = false;
    this.checkpointTiming.reset();
    this.child?.stdin.end("stop\n");
    this.publish(null, "Disabled");
  }
}
module.exports = { OverlayTelemetry, displayRate };
