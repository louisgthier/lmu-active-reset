import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import module from "../main/wheel-capture.cjs";
import settings from "../main/settings.cjs";
import { keyLabel } from "../renderer/keys.js";
const { WheelCapture } = module;
const device = "0123456789ABCDEF0123456789ABCDEF";
const binding = `WHEEL:${device}:128`;

function fixture() {
  const calls = [];
  const children = [];
  const capture = new WheelCapture({
    root: ".",
    python: "python.exe",
    spawnChild: (...args) => {
      calls.push(args);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.kill = () => {
        child.killed = true;
        queueMicrotask(() => child.emit("close"));
      };
      children.push(child);
      return child;
    },
  });
  return {
    capture,
    calls,
    children,
    output(value) {
      const child = children.at(-1);
      child.stdout.emit("data", Buffer.from(JSON.stringify(value)));
      child.emit("close");
    },
  };
}

test("wheel preferences round trip, reject invalid buttons and preserve keyboard defaults", () => {
  const value = settings.validateSettings({
    ...settings.defaults,
    save_key: binding.toLowerCase(),
  });
  assert.equal(value.save_key, binding);
  assert.equal(value.restore_key, "F7");
  assert.equal(keyLabel(binding, []), "Wheel 0123 · Button 128");
  for (const save_key of [
    binding.replace(":128", ":129"),
    binding.replace(":128", ":0"),
    binding + "\n",
    "WHEEL:unknown:1",
  ])
    assert.throws(() => settings.validateSettings({ ...value, save_key }));
  assert.throws(() =>
    settings.validateSettings({ ...value, restore_key: binding }),
  );
});

test("wheel capture uses a separate input-only module and accepts only validated wheel results", async () => {
  const f = fixture();
  const result = f.capture.capture();
  assert.equal((await f.capture.capture()).ok, false);
  assert.ok(f.calls[0][1].includes("runtime.wheel_buttons"));
  assert.ok(!f.calls[0][1].includes("--allow-writes"));
  assert.equal(f.calls[0][2].shell, false);
  f.output({ ok: true, binding });
  assert.deepEqual(await result, { ok: true, binding });
  for (const bad of ["F6", "WHEEL:bad:1", binding.replace(":128", ":129")]) {
    const next = f.capture.capture();
    f.output({ ok: true, binding: bad });
    assert.equal((await next).ok, false);
  }
});

test("canceling capture resolves once and stale child output cannot change a later binding", async () => {
  const f = fixture();
  const old = f.capture.capture();
  const oldChild = f.children[0];
  f.capture.cancel();
  assert.equal((await old).canceled, true);
  assert.equal(oldChild.killed, true);
  const current = f.capture.capture();
  oldChild.stdout.emit(
    "data",
    Buffer.from(JSON.stringify({ ok: true, binding })),
  );
  oldChild.emit("close");
  assert.equal(f.capture.child, f.children[1]);
  f.output({ ok: true, binding });
  assert.equal((await current).binding, binding);
  f.capture.cancel();
});

test("malformed or oversized helper output never produces a binding", async () => {
  const f = fixture();
  let promise = f.capture.capture();
  f.children[0].stdout.emit("data", Buffer.from("x".repeat(8193)));
  assert.equal((await promise).ok, false);
  promise = f.capture.capture();
  f.children[1].emit("error", new Error("fixture"));
  assert.equal((await promise).ok, false);
});
