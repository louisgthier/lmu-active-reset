import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { OverlayTelemetry, displayRate } from "../main/overlay-telemetry.cjs";

const frame = (et = 10, patch = {}) => ({
  schema: 1,
  connected: true,
  foreground: true,
  driving: true,
  paused: false,
  session: 1,
  track: "Fixture",
  et,
  length: 1000,
  player: { id: 1, et, lap: 1, lapStart: 0, speed: 80, fuel: 40 },
  cars: [
    { id: 1, player: true, class: "LMGT3", place: 1, distance: 100, laps: 0 },
  ],
  ...patch,
});

async function fixture(t, initialRate = 144) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sector-overlay-timing-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin/overlay-reader.exe"), "fixture");
  let now = 1000,
    rate = initialRate;
  const children = [],
    commands = [],
    published = [];
  const feed = new OverlayTelemetry(dir, {
    now: () => now,
    getRefreshRate: () => rate,
    discover: async () => [{ pid: 123 }],
    spawnChild: (_binary, args) => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdin.on("data", (data) => commands.push(data.toString()));
      children.push({ child, args });
      return child;
    },
  });
  t.after(() => {
    feed.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  feed.on("frame", (value) => published.push(value));
  feed.stopped = false;
  await feed.tick();
  return {
    feed,
    children,
    commands,
    published,
    advance: (ms) => {
      now += ms;
    },
    rate: (value) => {
      rate = value;
    },
    send: (value) => feed.child.stdout.write(JSON.stringify(value) + "\n"),
  };
}

test("display frequency reaches the reader and changes without restarting it", async (t) => {
  const f = await fixture(t, 143.856);
  assert.equal(f.children[0].args[2], "143.856");
  f.feed.setRefreshRate(240);
  f.feed.setRefreshRate(240);
  assert.deepEqual(f.commands, ["rate 240\n"]);
  f.rate(59.94);
  f.advance(1000);
  await f.feed.tick();
  assert.equal(f.commands.at(-1), "rate 59.94\n");
  assert.equal(f.children.length, 1);
  for (const invalid of [undefined, null, 0, -1, NaN, Infinity, 1001, "144"])
    assert.equal(displayRate(invalid), 60);
});

test("pause heartbeat hides immediately; frozen telemetry hides within the short timeout", async (t) => {
  const f = await fixture(t);
  f.send(frame());
  f.advance(299);
  await f.feed.tick();
  assert.ok(f.feed.frame);
  f.advance(1);
  await f.feed.tick();
  assert.equal(f.feed.frame, null);
  f.send(frame(11));
  assert.ok(f.feed.frame);
  f.send(frame(11, { paused: true }));
  assert.equal(f.feed.frame, null);
  assert.equal(f.feed.status, "Paused");
  f.send(frame(12));
  assert.ok(f.feed.frame);
});

test("slow scoring cannot hide advancing driving telemetry; stalled scoring eventually expires", async (t) => {
  const f = await fixture(t);
  f.send(frame());
  for (let i = 1; i <= 10; i++) {
    f.advance(100);
    const next = frame();
    next.player.et += i / 10;
    f.send(next);
    assert.ok(f.feed.frame);
  }
  f.advance(500);
  const next = frame();
  next.player.et = 12;
  f.send(next);
  assert.equal(f.feed.frame, null);
});

test("F7 keeps the frame through prepare, restore and acknowledgement but resets histories", async (t) => {
  const f = await fixture(t);
  f.send(frame());
  f.feed.model.laps.push({ time: 90 });
  f.feed.onResetStatus({ phase: "active", reset_action: 2, restore_count: 0 });
  f.advance(350);
  await f.feed.tick();
  assert.ok(f.feed.frame);
  f.feed.onResetStatus({ phase: "active", reset_action: 3, restore_count: 0 });
  f.advance(100);
  f.feed.onResetStatus({ phase: "active", reset_action: 0, restore_count: 1 });
  assert.ok(f.feed.frame);
  assert.deepEqual(f.feed.model.laps, []);
  f.send(frame(11, { player: { ...frame(11).player, speed: 40 } }));
  assert.equal(f.feed.frame.player.speed, 40);
  assert.deepEqual(f.feed.frame.laps, []);
  assert.ok(f.published.every(Boolean));
});

test("reset grace is bounded and cannot mask an explicit pause or a disconnect", async (t) => {
  const f = await fixture(t);
  f.send(frame());
  const pending = { phase: "active", reset_action: 2, restore_count: 0 };
  f.feed.onResetStatus(pending);
  f.advance(500);
  f.feed.onResetStatus(pending);
  f.advance(500);
  await f.feed.tick();
  assert.equal(f.feed.frame, null);
  f.send(frame(11));
  f.feed.onResetStatus({ phase: "active", reset_action: 0, restore_count: 1 });
  f.send(frame(11, { paused: true }));
  assert.equal(f.feed.frame, null);
  f.send(frame(12));
  f.feed.onResetStatus(pending);
  f.feed.child.emit("exit", 1);
  assert.equal(f.feed.frame, null);
});

test("monitor scoring remains visible and late data cannot revive a stopped reader", async (t) => {
  const f = await fixture(t);
  f.send(frame(10, { driving: false }));
  f.advance(500);
  f.send(frame(11, { driving: false, player: frame(10).player }));
  assert.ok(f.feed.frame);
  const child = f.feed.child;
  f.feed.stop();
  child.stdout.write(JSON.stringify(frame(12)) + "\n");
  assert.equal(f.feed.frame, null);
});

test("checkpoint timing survives overlay history reset and follows acknowledged restore events", async (t) => {
  const f = await fixture(t);
  const at = (et, distance) =>
    frame(et, {
      cars: [{ id: 1, player: true, class: "LMGT3", distance, laps: 0 }],
    });
  f.send(at(10, 100));
  f.feed.onResetStatus({
    phase: "active",
    checkpoint: true,
    last_event: "save",
    report_id: 1,
    log_prefix: "fixture",
    restore_count: 0,
    reset_action: 0,
  });
  f.send(at(10.1, 100));
  f.send(at(11.1, 120));
  f.send(at(12.1, 140));
  assert.ok(Math.abs(f.feed.frame.checkpointTiming.seconds - 2) < 1e-8);
  f.feed.onResetStatus({
    phase: "active",
    checkpoint: true,
    last_event: "restore",
    report_id: 3,
    log_prefix: "fixture",
    restore_count: 1,
    reset_action: 0,
  });
  f.send(at(12.2, 100));
  assert.equal(f.feed.frame.checkpointTiming.seconds, 0);
  f.send(at(13.2, 130));
  assert.ok(Math.abs(f.feed.frame.checkpointTiming.delta + 0.5) < 1e-8);
  f.feed.onResetStatus({ checkpoint: false, phase: "stopped" });
  f.send(at(13.3, 132));
  assert.equal(f.feed.frame.checkpointTiming, null);
});
