import test from "node:test";
import assert from "node:assert/strict";
import { CheckpointTiming } from "../shared/checkpoint-timing.cjs";
import { valuesFor } from "../shared/overlay-model.cjs";

const sample = (et, distance, patch = {}) => ({
  connected: true,
  driving: true,
  paused: false,
  track: "Fixture",
  session: 1,
  length: 1000,
  et,
  player: { id: 1, model: "Fixture car", et, speed: 180 },
  cars: [{ id: 1, player: true, distance, best: 80 }],
  ...patch,
});
const ack = (last_event, report_id) => ({
  checkpoint: true,
  last_event,
  report_id,
  log_prefix: "fixture-host",
  reset_action: 0,
});
function fixture() {
  let now = 1000;
  const model = new CheckpointTiming({ now: () => now });
  model.update(sample(10, 100));
  model.onStatus(ack("save", 1));
  model.update(sample(10.1, 100));
  return { model, advance: (ms) => (now += ms) };
}

test("checkpoint clock starts after acknowledged save, not on a request or duplicate sample", () => {
  const model = new CheckpointTiming();
  assert.equal(model.update(sample(10, 100)), null);
  model.onStatus({ checkpoint: false, reset_action: 1 });
  assert.equal(model.update(sample(11, 110)), null);
  model.onStatus(ack("save", 1));
  assert.equal(model.update(sample(11.1, 110)).seconds, 0);
  assert.ok(Math.abs(model.update(sample(12.1, 140)).seconds - 1) < 1e-9);
  assert.ok(Math.abs(model.update(sample(12.1, 140)).seconds - 1) < 1e-9);
  model.onStatus(ack("save", 1));
  assert.ok(Math.abs(model.update(sample(13.1, 170)).seconds - 2) < 1e-9);
});

test("restore restarts the clock and interpolates delta against the previous attempt at matching distance", () => {
  const { model } = fixture();
  model.update(sample(11.1, 130));
  model.update(sample(12.1, 160));
  model.onStatus(ack("restore", 4));
  assert.equal(model.update(sample(12.2, 100)).seconds, 0);
  const value = model.update(sample(13.2, 145));
  assert.ok(Math.abs(value.seconds - 1) < 1e-9);
  assert.ok(Math.abs(value.delta + 0.5) < 1e-9);
  assert.equal(value.reference, true);
  const finish = model.update(sample(14.2, 200));
  assert.equal(finish.finished, true);
  assert.ok(finish.seconds < 2);
  assert.equal(model.update(sample(15.2, 250)).seconds, finish.seconds);
});

test("a failed restore cannot reset the clock and a new save discards the previous reference", () => {
  const { model } = fixture();
  model.update(sample(11.1, 130));
  model.onStatus(ack("rejected", 2));
  assert.ok(Math.abs(model.update(sample(12.1, 160)).seconds - 2) < 1e-9);
  model.onStatus(ack("save", 3));
  const value = model.update(sample(12.2, 160));
  assert.equal(value.seconds, 0);
  assert.equal(value.reference, false);
});

test("pause excludes elapsed pause time and restores wait for fresh telemetry near the checkpoint", () => {
  const { model, advance } = fixture();
  model.update(sample(11.1, 130));
  model.hold();
  assert.ok(Math.abs(model.update(sample(100, 130)).seconds - 1) < 1e-9);
  assert.ok(Math.abs(model.update(sample(101, 160)).seconds - 2) < 1e-9);
  model.onStatus(ack("restore", 4));
  assert.equal(model.update(sample(101.1, 500)).valid, false);
  advance(1600);
  assert.equal(model.update(sample(101.2, 500)).valid, false);
});

test("forward lap wrap is valid; unexplained teleports, reverse motion and time discontinuity are rejected", () => {
  const wrap = new CheckpointTiming();
  wrap.onStatus(ack("save", 1));
  wrap.update(sample(10, 990));
  assert.equal(wrap.update(sample(11, 20)).valid, true);
  for (const [et, distance] of [
    [11, 500],
    [11, 80],
    [9, 100],
    [15, 130],
  ]) {
    const { model } = fixture();
    const value = model.update(sample(et, distance));
    assert.equal(value.valid, false);
    assert.equal(value.delta, null);
  }
});

test("session, car and checkpoint invalidation cannot reuse an earlier reference", () => {
  const { model } = fixture();
  assert.equal(model.update(sample(11, 110, { track: "Other" })), null);
  model.onStatus({ checkpoint: false });
  assert.equal(model.update(sample(12, 120)), null);
});

test("checkpoint widget shows a zero clock and keeps native lap delta outside checkpoint timing", () => {
  const frame = sample(10, 100);
  const value = valuesFor(
    "delta",
    {
      ...frame,
      checkpointTiming: {
        active: true,
        valid: true,
        seconds: 0,
        delta: -0.25,
        reference: true,
      },
    },
    {},
  );
  assert.equal(value.timingTitle, "CHECKPOINT");
  assert.equal(value.pred, "0:00.000");
  assert.equal(value.referenceLabel, "vs checkpoint best");
  assert.equal(value.clockLabel, "time");
  assert.equal(value.deltaTxt, "\u22120.250");
  assert.equal(valuesFor("delta", frame, {}).timingTitle, "DELTA");
});

test("only the best completed attempt becomes the reference and finish delta remains frozen", () => {
  const { model } = fixture();
  model.update(sample(11.1, 130));
  model.update(sample(12.1, 160));
  model.onStatus(ack("restore", 4));
  model.update(sample(12.2, 100));
  model.update(sample(13.2, 120));
  model.update(sample(14.2, 140));
  const slow = model.update(sample(15.2, 160));
  assert.equal(slow.finished, true);
  assert.equal(slow.record, false);
  assert.ok(Math.abs(slow.delta - 1) < 1e-8);
  assert.ok(Math.abs(slow.bestSeconds - 2) < 1e-8);
  model.onStatus(ack("restore", 7));
  model.update(sample(15.3, 100));
  model.update(sample(16.3, 140));
  const best = model.update(sample(16.8, 160));
  assert.equal(best.record, true);
  assert.ok(Math.abs(best.delta + 0.5) < 1e-8);
  model.hold();
  const frozen = model.update(sample(30, 600));
  assert.equal(frozen.delta, best.delta);
  assert.equal(frozen.seconds, best.seconds);
  model.onStatus(ack("restore", 10));
  model.update(sample(30.1, 100));
  model.update(sample(31.1, 130));
  const afterRecord = model.update(sample(32.1, 160));
  assert.ok(Math.abs(afterRecord.delta - 0.5) < 1e-8);
  assert.ok(Math.abs(afterRecord.bestSeconds - 1.5) < 1e-8);
});

test("early reset does not replace the checkpoint best or move its fixed finish", () => {
  const { model } = fixture();
  model.update(sample(11.1, 130));
  model.update(sample(12.1, 160));
  model.onStatus(ack("restore", 4));
  model.update(sample(12.2, 100));
  model.update(sample(12.8, 120));
  model.onStatus(ack("restore", 7));
  const next = model.update(sample(12.9, 100));
  assert.equal(next.finishDistance, 60);
  assert.ok(Math.abs(next.bestSeconds - 2) < 1e-8);
  assert.equal(next.finished, false);
});

test("finish presentation uses violet only for a new record and an explicit frozen result", () => {
  const base = {
    ...sample(20, 100),
    checkpointTiming: {
      active: true,
      valid: true,
      seconds: 2,
      delta: -0.5,
      reference: true,
      finished: false,
      record: false,
      remainingDistance: 30,
      finishDistance: 60,
    },
  };
  assert.equal(valuesFor("delta", base, {}).deltaFg, "#3DDC84");
  assert.equal(valuesFor("delta", base, {}).attemptStatus, "30 m to finish");
  const best = valuesFor(
    "delta",
    {
      ...base,
      checkpointTiming: {
        ...base.checkpointTiming,
        finished: true,
        record: true,
      },
    },
    {},
  );
  assert.equal(best.deltaFg, "#C084FC");
  assert.equal(best.timingTitle, "FINISHED - NEW BEST");
  assert.match(best.attemptStatus, /frozen/);
  const slow = valuesFor(
    "delta",
    {
      ...base,
      checkpointTiming: { ...base.checkpointTiming, finished: true, delta: 1 },
    },
    {},
  );
  assert.equal(slow.deltaFg, "#FF5D5D");
  assert.equal(slow.timingTitle, "FINISHED");
});

test("first restore records the reference when the teleport precedes every status poll", () => {
  const { model } = fixture();
  model.update(sample(11.1, 130));
  model.update(sample(12.1, 160));
  assert.equal(model.update(sample(12.2, 100)).valid, false);
  model.update(sample(12.3, 103));
  model.onStatus(ack("restore", 4));
  const value = model.update(sample(12.4, 106));
  assert.equal(value.reference, true);
  assert.equal(value.finishDistance, 60);
  assert.ok(Math.abs(value.seconds - 0.2) < 1e-8);
  assert.ok(Math.abs(value.delta) < 1e-8);
});

test("missing handoff telemetry preserves the reference candidate and checkpoint", () => {
  const { model } = fixture();
  model.update(sample(11.1, 130));
  model.update(sample(12.1, 160));
  model.update({ connected: false });
  model.update(sample(12.2, 100));
  model.onStatus(ack("restore", 4));
  assert.equal(model.update(sample(13.2, 130)).reference, true);
  assert.equal(model.value().finishDistance, 60);
  model.update({ connected: false });
  assert.equal(model.value().valid, false);
  assert.ok(Math.abs(model.value().bestSeconds - 2) < 1e-8);
});

test("preparing and held handoffs retain the first landing until acknowledgement", () => {
  for (const preparing of [true, false]) {
    const { model } = fixture();
    model.update(sample(11.1, 130));
    model.update(sample(12.1, 160));
    if (preparing) model.onStatus({ ...ack("save", 1), reset_action: 2 });
    else model.hold();
    model.update(sample(12.2, 100));
    model.update(sample(12.3, 103));
    model.onStatus(ack("restore", 4));
    const value = model.update(sample(12.4, 106));
    assert.equal(value.reference, true);
    assert.equal(value.finishDistance, 60);
    assert.ok(Math.abs(value.seconds - 0.2) < 1e-8);
  }
});

test("a rejected or expired teleport candidate cannot establish a reference", () => {
  for (const reject of [true, false]) {
    const { model, advance } = fixture();
    model.update(sample(11.1, 130));
    model.update(sample(12.1, 160));
    model.update(sample(12.2, 100));
    if (reject) model.onStatus(ack("rejected", 3));
    else advance(1600);
    model.onStatus(ack("restore", 4));
    const value = model.update(sample(12.3, 103));
    assert.equal(value.reference, false);
    assert.equal(value.finishDistance, null);
  }
});

function liveFrame(et, start, speed) {
  const scoring = Math.floor((et + 1e-9) * 5) / 5;
  const raw = sample(et, 100 + speed * (scoring - start));
  raw.et = scoring;
  raw.player.speed = speed * 3.6;
  raw.cars[0].liveProgress = {
    et,
    travel: speed * (et - scoring),
    speed,
  };
  return raw;
}

test("60 Hz telemetry with 5 Hz scoring gives a continuous distance-matched delta", () => {
  const model = new CheckpointTiming();
  model.onStatus(ack("save", 1));
  model.update(liveFrame(10, 10, 50));
  for (let i = 1; i <= 240; i++) model.update(liveFrame(10 + i / 60, 10, 50));
  model.onStatus(ack("restore", 4));
  model.update(liveFrame(20, 20, 45));
  let previous = 0;
  for (let i = 1; i <= 240; i++) {
    const elapsed = i / 60;
    const value = model.update(liveFrame(20 + elapsed, 20, 45));
    assert.equal(value.valid, true);
    assert.ok(
      Math.abs(value.delta - elapsed * 0.1) < 1e-7,
      `frame ${i}: ${value.delta}`,
    );
    assert.ok(value.delta >= previous - 1e-8);
    previous = value.delta;
  }
});

test("scoring-only fallback holds the paired clock and survives temporary projection loss", () => {
  const model = new CheckpointTiming();
  model.onStatus(ack("save", 1));
  model.update(liveFrame(10, 10, 50));
  model.update(liveFrame(10.1, 10, 50));
  const missing = liveFrame(10.15, 10, 50);
  missing.cars[0].liveProgress = null;
  const held = model.update(missing);
  assert.equal(held.valid, true);
  assert.ok(Math.abs(held.seconds - 0.1) < 1e-8);
  assert.ok(
    Math.abs(model.update(liveFrame(10.2, 10, 50)).seconds - 0.2) < 1e-8,
  );
  const scoringOnly = liveFrame(10.25, 10, 50);
  scoringOnly.cars[0].liveProgress = null;
  assert.ok(Math.abs(model.update(scoringOnly).seconds - 0.2) < 1e-8);
});
