import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import launcherModule from "../main/game-launcher.cjs";
const { GameLauncher } = launcherModule;

function fixture(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "sector-game-"));
  fs.writeFileSync(path.join(folder, "Le Mans Ultimate.exe"), "never executed");
  const calls = [];
  let discoveries = 0;
  const launcher = new GameLauncher({
    installation: () => folder,
    discover: async () =>
      ++discoveries === 1
        ? []
        : [
            {
              pid: 42,
              identity: "42:1",
              eac: false,
              executable: path.join(folder, "Le Mans Ultimate.exe"),
            },
          ],
    spawnChild: (...args) => {
      calls.push(args);
      const child = new EventEmitter();
      child.pid = 42;
      child.exitCode = null;
      child.signalCode = null;
      child.unref = () => {};
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
    ...options,
  });
  t.after(() => {
    launcher.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { launcher, folder, calls };
}

test("launches the selected executable once without a shell and awaits discovery", async (t) => {
  const { launcher, folder, calls } = fixture(t);
  await Promise.all([launcher.launch(), launcher.launch()]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    path.join(folder, "Le Mans Ultimate.exe"),
    [],
    {
      cwd: folder,
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    },
  ]);
  assert.equal(launcher.state.launching, false);
  assert.equal(launcher.state.running, true);
  launcher.observe([{ pid: 42 }]);
  assert.equal(launcher.state.launching, false);
  assert.equal(launcher.state.running, true);
  launcher.observe([{ pid: 42, eac: true }]);
  assert.equal(launcher.state.eac, true);
  launcher.observe([]);
  assert.equal(launcher.state.running, false);
  assert.equal(launcher.state.eac, false);
});

test("existing game, invalid installation and preview never spawn a game", async (t) => {
  for (const options of [
    { discover: async () => [{ pid: 42 }] },
    { installation: () => "" },
    { preview: true },
  ]) {
    const { launcher, calls } = fixture(t, options);
    const result = await launcher.launch();
    assert.equal(calls.length, 0);
    assert.equal(result.ok, false);
  }
});

test("launch errors are reported and a closed app cannot spawn after discovery", async (t) => {
  const failed = fixture(t, {
    spawnChild: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("Access denied")));
      return child;
    },
  });
  assert.equal((await failed.launcher.launch()).ok, false);
  assert.match(failed.launcher.state.error, /Access denied/);
  assert.equal(failed.launcher.state.launching, false);
  let finish;
  const closing = fixture(t, {
    discover: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = closing.launcher.launch();
  closing.launcher.stop();
  finish([]);
  await pending;
  assert.equal(closing.calls.length, 0);
});
