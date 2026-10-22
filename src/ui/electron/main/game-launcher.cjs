const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { validateFolder } = require("./onboarding.cjs");

class GameLauncher extends EventEmitter {
  constructor({ installation, discover, preview = false, spawnChild = spawn }) {
    super();
    Object.assign(this, { installation, discover, preview, spawnChild });
    this.state = { running: false, launching: false, eac: false, error: "" };
  }

  publish(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.state);
  }

  observe(games) {
    const running = games.length > 0;
    if (running) {
      clearTimeout(this.timeout);
      this.publish({
        running: true,
        launching: false,
        eac: games.some((game) => game.eac === true),
        error: "",
      });
    } else if (this.state.running) {
      this.publish({ running: false, eac: false });
    }
  }

  async launch() {
    if (this.stopped) return { ok: false, error: "Sector is closing." };
    if (this.preview)
      return { ok: false, error: "Game launch is unavailable in preview." };
    if (this.state.launching || this.state.running) return { ok: true };
    this.publish({ launching: true, error: "" });
    try {
      const folder = validateFolder(this.installation());
      // Check all LMU processes, including copies outside the selected folder.
      const games = await this.discover();
      if (this.stopped) return { ok: false, error: "Sector is closing." };
      if (games.length) {
        this.observe(games);
        return {
          ok: false,
          error: "Close every LMU instance before starting an offline session.",
        };
      }
      const child = this.spawnChild(
        // Directly open the game executable, not Steam's EAC launcher.
        // Discovery still verifies the resulting process protection state.
        path.join(folder, "Le Mans Ultimate.exe"),
        [],
        {
          cwd: folder,
          detached: true,
          stdio: "ignore",
          shell: false,
          windowsHide: true,
        },
      );
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      const verified = await this.discover();
      const own = verified.length === 1 && verified[0];
      if (
        this.stopped ||
        child.exitCode !== null ||
        child.signalCode !== null ||
        !own ||
        own.pid !== child.pid ||
        own.eac !== false ||
        typeof own.identity !== "string" ||
        !/^\d+:\d+$/.test(own.identity) ||
        typeof own.executable !== "string" ||
        path.resolve(own.executable).toLowerCase() !==
          path.join(folder, "Le Mans Ultimate.exe").toLowerCase()
      )
        throw new Error(
          "Fresh offline LMU process could not be verified. Close LMU and try again.",
        );
      this.ownedPid = child.pid;
      this.emit("launched", own);
      this.observe(verified);
      child.unref();
      // Process discovery, rather than a successful spawn, confirms the game opened.
      if (!this.stopped && !this.state.running)
        this.timeout = setTimeout(() => {
          this.publish({
            launching: false,
            error: "LMU has not opened. Check Steam, then try again.",
          });
        }, 45000);
      this.timeout?.unref?.();
      return { ok: true };
    } catch (error) {
      this.publish({
        launching: false,
        error: `Could not launch LMU: ${error.message}`,
      });
      return { ok: false, error: this.state.error };
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timeout);
  }
}

module.exports = { GameLauncher };
