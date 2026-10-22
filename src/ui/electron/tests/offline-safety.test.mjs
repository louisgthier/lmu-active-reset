import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { OfflineSafety } from "../main/offline-safety.cjs";
import { Runtime } from "../main/runtime.cjs";
import { waitForGameExit } from "../main/clean-restart.cjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sector-safety-"));
  const file = path.join(root, "journal.json");
  const options = { file, installation: () => root };
  const safety = new OfflineSafety(options);
  const game = {
    pid: 42,
    identity: "42:123",
    eac: false,
    executable: path.join(root, "Le Mans Ultimate.exe"),
  };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file, safety, game, options };
}

test("only explicit activation of Sector's own exact process can authorize writes", (t) => {
  const { safety, game } = fixture(t);
  assert.equal(safety.allows(game), false);
  assert.throws(() => safety.enable(game, 1));
  safety.captureLaunch(game);
  for (const wrong of [
    { ...game, eac: true },
    { ...game, eac: null },
    { ...game, pid: 43 },
    { ...game, identity: null },
    { ...game, executable: "other.exe" },
  ])
    assert.throws(() => safety.enable(wrong, 1));
  assert.throws(() => safety.enable(game, 2));
  safety.enable(game, 1);
  assert.equal(safety.allows(game), true);
  assert.equal(safety.allows({ ...game, identity: "42:124" }), false);
});

test("restart journal survives app restart and disable, clearing only on verified process exit", (t) => {
  const { safety, game, file, options } = fixture(t);
  safety.captureLaunch(game);
  safety.enable(game, 1);
  safety.markModified(game);
  assert.ok(fs.existsSync(file));
  safety.revoke();
  safety.observe([game]);
  assert.equal(safety.state([game]).restartRequired, true);
  const restarted = new OfflineSafety(options);
  assert.equal(restarted.state([game]).restartRequired, true);
  assert.throws(() => restarted.enable(game, 1));
  restarted.observe([{ ...game, identity: null }]);
  assert.ok(fs.existsSync(file));
  restarted.observe([]);
  assert.equal(restarted.state().restartRequired, false);
  assert.equal(restarted.enabled, false);
});

test("failed journal reads or writes never authorize a worker", (t) => {
  const { safety, game, file, options } = fixture(t);
  fs.writeFileSync(file, "broken");
  const broken = new OfflineSafety(options);
  assert.ok(broken.error);
  assert.throws(() => broken.captureLaunch(game));
  fs.rmSync(file);
  fs.mkdirSync(file);
  safety.captureLaunch(game);
  safety.enable(game, 1);
  assert.throws(() => safety.markModified(game));
});

function runtimeFixture(t, overrides = {}) {
  const f = fixture(t);
  let clock = 1000;
  let games = [f.game];
  const workers = [];
  const runtime = new Runtime({
    root: f.root,
    settingsFile: path.join(f.root, "settings.json"),
    getSettings: () => ({ save_key: "F6", restore_key: "F7", sound: false }),
    now: () => clock,
    discover: async () => games,
    admission: async () => ({ allowed: true }),
    authorize: (game) => f.safety.allows(game),
    beforeLaunch: (game) => f.safety.markModified(game),
    onRevoke: () => f.safety.revoke(),
    spawnChild: () => {
      const child = new EventEmitter();
      workers.push(child);
      return child;
    },
    ...overrides,
  });
  t.after(() => runtime.dispose());
  return {
    ...f,
    runtime,
    workers,
    setClock: (value) => (clock = value),
    setGames: (value) => (games = value),
    activate() {
      f.safety.captureLaunch(f.game);
      f.safety.enable(f.game, 1);
      runtime.enabled = true;
    },
  };
}

test("default startup observes offline LMU without starting a worker or journaling it", async (t) => {
  const f = runtimeFixture(t);
  await f.runtime.tick();
  assert.equal(f.workers.length, 0);
  assert.equal(fs.existsSync(f.file), false);
});

test("expired lease revokes writes and cannot be revived by a late successful check", async (t) => {
  let finish;
  const f = runtimeFixture(t);
  f.activate();
  await f.runtime.tick();
  f.runtime.discover = () => new Promise((resolve) => (finish = resolve));
  f.setClock(2600);
  await f.runtime.tick();
  const pending = f.runtime.protectionCheck;
  f.setClock(3600);
  await f.runtime.tick();
  assert.equal(f.runtime.enabled, false);
  assert.equal(fs.existsSync(path.join(f.runtime.session, "heartbeat")), false);
  finish([f.game]);
  await pending;
  assert.equal(f.runtime.enabled, false);
  assert.equal((await f.runtime.requestReset("save")).ok, false);
  assert.equal(f.safety.state().restartRequired, true);
});

test("discovery error, process replacement, ambiguous processes and lost offline context revoke", async (t) => {
  for (const mode of ["error", "replacement", "multiple", "online"]) {
    const f = runtimeFixture(t);
    f.activate();
    await f.runtime.tick();
    f.setClock(2600);
    if (mode === "error")
      f.runtime.discover = async () => {
        throw new Error("denied");
      };
    if (mode === "replacement") f.setGames([{ ...f.game, identity: "42:124" }]);
    if (mode === "multiple") f.setGames([f.game, { ...f.game, pid: 43 }]);
    if (mode === "online")
      f.runtime.admission = async () => ({
        allowed: false,
        reason: "Online session",
      });
    await f.runtime.tick();
    await f.runtime.protectionCheck;
    assert.equal(f.runtime.enabled, false, mode);
    assert.ok(fs.existsSync(path.join(f.runtime.session, "stop")), mode);
    assert.ok(!fs.existsSync(path.join(f.runtime.session, "heartbeat")), mode);
  }
});

test("clean restart waits for actual disappearance and refuses unknown or lingering instances", async () => {
  const game = { pid: 42, identity: "42:123" };
  let calls = 0,
    closed = false;
  await waitForGameExit({
    game,
    discover: async () => (++calls < 3 ? [game] : []),
    close: async () => (closed = true),
    sleep: async () => {},
    attempts: 3,
  });
  assert.equal(closed, true);
  await assert.rejects(
    waitForGameExit({
      game,
      discover: async () => [game],
      close: async () => {},
      sleep: async () => {},
      attempts: 2,
    }),
    /still running/,
  );
  await assert.rejects(
    waitForGameExit({
      game,
      discover: async () => [{ ...game, identity: null }],
      close: async () => assert.fail("Must not close an unknown process"),
    }),
    /manually/,
  );
  await assert.rejects(
    waitForGameExit({
      game,
      discover: async () => {
        throw new Error("denied");
      },
    }),
    /denied/,
  );
});

test("runtime integrity rejects changed scripts and malformed inventory paths", async (t) => {
  const { verifyRuntime } = await import("../main/runtime-integrity.cjs");
  const { createHash } = await import("node:crypto");
  const f = fixture(t);
  const resources = path.join(f.root, "resources");
  const payload = path.join(resources, "runtime");
  fs.mkdirSync(payload, { recursive: true });
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  const script = path.join(payload, "script.py");
  fs.writeFileSync(script, "trusted");
  function manifest(value) {
    const data = JSON.stringify(value);
    fs.writeFileSync(path.join(payload, "release-manifest.json"), data);
    fs.writeFileSync(
      path.join(resources, "release-id"),
      hash(data).slice(0, 16),
    );
  }
  manifest({ "script.py": hash("trusted") });
  verifyRuntime(payload, resources);
  fs.writeFileSync(path.join(payload, "extra.py"), "unexpected");
  assert.throws(() => verifyRuntime(payload, resources), /Unlisted/);
  fs.rmSync(path.join(payload, "extra.py"));
  fs.writeFileSync(script, "modified");
  assert.throws(() => verifyRuntime(payload, resources), /integrity mismatch/);
  manifest({ "../outside.py": hash("trusted") });
  assert.throws(() => verifyRuntime(payload, resources), /Invalid/);
});
