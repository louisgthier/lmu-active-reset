import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OfflineSafety } from "../main/offline-safety.cjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sector-handoff-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let clock = 1000;
  const options = {
    file: path.join(root, "journal.json"),
    installation: () => root,
    now: () => clock,
  };
  const safety = new OfflineSafety(options);
  const game = {
    pid: 42,
    identity: "42:123",
    eac: false,
    executable: path.join(root, "Le Mans Ultimate.exe"),
  };
  safety.captureLaunch(game);
  safety.enable(game, 1);
  safety.markModified(game);
  return {
    root,
    options,
    safety,
    game,
    clock: (v) => (clock = v),
    stop: { clean: true, game, workerPid: 77 },
  };
}

test("a clean handoff offers only an explicit single-use claim and retains the modified journal", (t) => {
  const f = fixture(t);
  assert.equal(f.safety.writeHandoff(f.stop, 88), true);
  const resumed = new OfflineSafety(f.options);
  assert.equal(resumed.enabled, false);
  assert.equal(resumed.state([f.game]).canResume, true);
  assert.equal(resumed.state([f.game]).restartRequired, true);
  assert.throws(() => resumed.enable(f.game, 1));
  const ticket = resumed.claimHandoff(f.game, 1);
  assert.equal(resumed.state([f.game]).canResume, false);
  assert.throws(() => resumed.claimHandoff(f.game, 1));
  resumed.adoptHandoff(f.game, ticket);
  resumed.enable(f.game, 1);
  resumed.markModified(f.game);
  assert.equal(resumed.allows(f.game), true);
  assert.ok(fs.existsSync(f.options.file));
  assert.throws(() => resumed.adoptHandoff(f.game, ticket));
});

test("missing, expired, changed, ambiguous or EAC handoffs never offer resumption", (t) => {
  const f = fixture(t);
  let next = new OfflineSafety(f.options);
  assert.equal(next.state([f.game]).canResume, false);
  assert.equal(f.safety.writeHandoff({ ...f.stop, clean: false }, 88), false);
  f.safety.writeHandoff(f.stop, 88);
  next = new OfflineSafety(f.options);
  for (const games of [
    [],
    [f.game, f.game],
    [{ ...f.game, identity: "42:124" }],
    [{ ...f.game, eac: true }],
    [{ ...f.game, executable: "wrong.exe" }],
  ])
    assert.equal(next.state(games).canResume, false);
  f.clock(601000);
  assert.equal(next.state([f.game]).canResume, false);
  f.clock(0);
  assert.equal(next.state([f.game]).canResume, false);
});

test("failed verification consumes the receipt and cannot authorize a later activation", (t) => {
  const f = fixture(t);
  f.safety.writeHandoff(f.stop, 88);
  const next = new OfflineSafety(f.options);
  const ticket = next.claimHandoff(f.game, 1);
  next.revoke();
  assert.throws(() => next.adoptHandoff(f.game, ticket));
  assert.equal(new OfflineSafety(f.options).state([f.game]).canResume, false);
});

test("a receipt expiring during verification and a process exit both block adoption", (t) => {
  const f = fixture(t);
  f.safety.writeHandoff(f.stop, 88);
  const next = new OfflineSafety(f.options);
  const ticket = next.claimHandoff(f.game, 1);
  f.clock(601000);
  assert.throws(() => next.adoptHandoff(f.game, ticket));
  next.observe([]);
  assert.equal(next.state([f.game]).canResume, false);
});
