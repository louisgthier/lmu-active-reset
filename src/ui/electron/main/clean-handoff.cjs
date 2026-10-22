const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const TTL = 10 * 60 * 1000;

// This receipt records provenance, not permission. Every claim requires a fresh audit.
class CleanHandoff {
  constructor(file, now = Date.now) {
    this.file = file;
    this.now = now;
  }
  read(marker, installation) {
    try {
      const s = fs.statSync(this.file);
      if (
        !s.isFile() ||
        s.size > 4096 ||
        fs.lstatSync(this.file).isSymbolicLink()
      )
        return null;
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (
        value.schema !== 1 ||
        value.identity !== marker?.identity ||
        value.pid !== marker?.pid ||
        ![value.pid, value.controller, value.worker].every(
          (id) => Number.isSafeInteger(id) && id > 0,
        ) ||
        new Set([value.pid, value.controller, value.worker]).size !== 3 ||
        typeof value.identity !== "string" ||
        !/^\d+:\d+$/.test(value.identity) ||
        !value.identity.startsWith(`${value.pid}:`) ||
        !Number.isSafeInteger(value.created) ||
        this.now() < value.created ||
        this.now() - value.created >= TTL ||
        typeof value.executable !== "string" ||
        path.resolve(value.executable).toLowerCase() !==
          path.resolve(installation, "Le Mans Ultimate.exe").toLowerCase()
      )
        return null;
      return value;
    } catch {
      return null;
    }
  }
  write(stop, controller, marker, installation) {
    if (
      !stop?.clean ||
      stop.game?.identity !== marker?.identity ||
      stop.game?.pid !== marker?.pid
    )
      return false;
    const value = {
      schema: 1,
      pid: stop.game.pid,
      identity: stop.game.identity,
      executable: stop.game.executable,
      controller,
      worker: stop.workerPid,
      created: this.now(),
    };
    if (
      !Number.isSafeInteger(controller) ||
      !Number.isSafeInteger(stop.workerPid) ||
      controller <= 0 ||
      stop.workerPid <= 0 ||
      new Set([value.pid, controller, stop.workerPid]).size !== 3 ||
      typeof value.executable !== "string" ||
      path.resolve(value.executable).toLowerCase() !==
        path.resolve(installation, "Le Mans Ultimate.exe").toLowerCase()
    )
      return false;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, this.file);
    return true;
  }
  claim(marker, installation) {
    const claim = `${this.file}.${randomUUID()}.claimed`;
    fs.renameSync(this.file, claim); // Atomic single use, including across app instances.
    const reader = new CleanHandoff(claim, this.now);
    try {
      const value = reader.read(marker, installation);
      if (!value)
        throw new Error(
          "Clean shutdown receipt expired or changed. Restart LMU.",
        );
      return value;
    } finally {
      fs.rmSync(claim, { force: true });
    }
  }
  clear() {
    fs.rmSync(this.file, { force: true });
  }
}
module.exports = { CleanHandoff, TTL };
