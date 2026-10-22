const { spawn } = require("node:child_process");
const path = require("node:path");
const { validateSettings, defaults } = require("./settings.cjs");

class WheelCapture {
  constructor({ root, python, spawnChild = spawn }) {
    Object.assign(this, { root, python, spawnChild });
    this.child = null;
  }

  capture() {
    if (this.child)
      return Promise.resolve({
        ok: false,
        error: "Wheel capture is already running.",
      });
    return new Promise((resolve) => {
      let child;
      let output = "";
      let timer;
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        resolve(result);
      };
      try {
        child = this.spawnChild(
          this.python,
          [
            "-B",
            "-X",
            "utf8",
            path.join(this.root, "scripts/sector.py"),
            "runtime.wheel_buttons",
            "--capture",
          ],
          {
            cwd: this.root,
            windowsHide: true,
            stdio: ["ignore", "pipe", "ignore"],
            shell: false,
          },
        );
        this.child = child;
        this.cancelCurrent = () => {
          child.kill();
          finish({ ok: false, canceled: true });
        };
        timer = setTimeout(() => {
          child.kill();
          finish({ ok: false, error: "Wheel capture timed out. Try again." });
        }, 17000);
        child.stdout.on("data", (data) => {
          output += data.toString("utf8");
          if (output.length > 8192) {
            child.kill();
            finish({ ok: false, error: "Invalid wheel response." });
          }
        });
        child.once("error", () =>
          finish({ ok: false, error: "Could not start wheel capture." }),
        );
        child.once("close", () => {
          try {
            const value = JSON.parse(output);
            if (!value.ok)
              return finish({
                ok: false,
                error:
                  "No button captured. Release all wheel buttons and retry; check the wheel is connected.",
              });
            const validated = validateSettings({
              ...defaults,
              save_key: value.binding,
            });
            if (!validated.save_key.startsWith("WHEEL:"))
              throw new Error("Invalid button.");
            finish({ ok: true, binding: validated.save_key });
          } catch {
            finish({
              ok: false,
              error:
                "Could not read a wheel button. Check the wheel is connected.",
            });
          }
        });
      } catch {
        finish({ ok: false, error: "Could not start wheel capture." });
      }
    });
  }

  cancel() {
    if (this.child) this.cancelCurrent();
  }
}

module.exports = { WheelCapture };
