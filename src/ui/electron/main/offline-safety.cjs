const fs = require("node:fs");
const path = require("node:path");

// This is a cooperative guard, not an anti-cheat bypass. A process which may
// contain our host is never declared clean until its identity has disappeared.
class OfflineSafety {
  constructor({ file, installation }) {
    this.file = file;
    this.installation = installation;
    this.enabled = false;
    this.ownedPid = null;
    this.identity = null;
    this.marker = null;
    this.error = "";
    try {
      const marker = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        marker.schema !== 1 ||
        !Number.isSafeInteger(marker.pid) ||
        marker.pid <= 0 ||
        !/^\d+:\d+$/.test(marker.identity) ||
        !marker.identity.startsWith(`${marker.pid}:`)
      )
        throw new Error(
          "Invalid reset safety journal. Keep Active Reset disabled.",
        );
      this.marker = marker;
    } catch (error) {
      if (error.code !== "ENOENT")
        this.error =
          "Cannot read the reset safety journal. Active Reset is blocked.";
    }
  }
  captureLaunch(game) {
    const pid = game?.pid;
    if (
      this.error ||
      this.marker ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      !/^\d+:\d+$/.test(game.identity)
    )
      throw new Error("A verified fresh LMU launch is required.");
    this.ownedPid = pid;
    this.ownedIdentity = game.identity;
    this.identity = null;
  }
  observe(games) {
    if (!Array.isArray(games)) throw new Error("Unknown LMU discovery result.");
    // A missing path or start time is uncertainty, never evidence of a clean exit.
    if (
      this.marker &&
      games.every(
        (g) =>
          Number.isSafeInteger(g.pid) &&
          typeof g.identity === "string" &&
          /^\d+:\d+$/.test(g.identity) &&
          g.identity !== this.marker.identity,
      )
    ) {
      fs.rmSync(this.file, { force: true });
      this.marker = null;
      this.revoke();
    }
    if (this.enabled && !this.allows(games[0], games.length)) this.revoke();
  }
  eligible(game, count = 1) {
    return (
      !this.error &&
      count === 1 &&
      game?.eac === false &&
      Number.isSafeInteger(game.pid) &&
      game.pid === this.ownedPid &&
      game.identity === this.ownedIdentity &&
      typeof game.identity === "string" &&
      /^\d+:\d+$/.test(game.identity) &&
      game.identity.startsWith(`${game.pid}:`) &&
      typeof game.executable === "string" &&
      path.resolve(game.executable).toLowerCase() ===
        path.resolve(this.installation(), "Le Mans Ultimate.exe").toLowerCase()
    );
  }
  enable(game, count) {
    if (this.marker || !this.eligible(game, count))
      throw new Error(
        this.error ||
          "Close LMU and start a new offline session from Sector first.",
      );
    this.identity = game.identity;
    this.enabled = true;
  }
  allows(game, count = 1) {
    return (
      this.enabled &&
      this.eligible(game, count) &&
      game.identity === this.identity
    );
  }
  markModified(game) {
    if (this.marker || !this.allows(game))
      throw new Error("Offline launch authorization expired.");
    const marker = { schema: 1, pid: game.pid, identity: game.identity };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(marker));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, this.file);
    this.marker = marker; // Persist BEFORE starting a worker which could inject.
  }
  revoke() {
    this.enabled = false;
    this.identity = null;
    this.ownedPid = null;
    this.ownedIdentity = null;
  }
  state(games = []) {
    return {
      enabled: this.enabled,
      restartRequired: Boolean(this.marker),
      canEnable: !this.marker && this.eligible(games[0], games.length),
      error: this.error,
    };
  }
}
module.exports = { OfflineSafety };
