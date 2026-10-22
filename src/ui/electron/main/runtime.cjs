const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const { resetAccess, EAC_MESSAGE } = require("./reset-access.cjs");

const emptyCheckpoint = {
  checkpoint: false,
  saved_speed_kmh: null,
  saved_at: null,
  restore_count: 0,
};

async function discoverGame(installation, { telemetryOnly = false } = {}) {
  // This fixed command never includes data from the renderer or settings.
  const command =
    "$env:PSModulePath = (Join-Path $PSHOME 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath; $ErrorActionPreference='Stop'; $all = @(Get-Process -ErrorAction Stop); $eacActive = @($all | Where-Object { $_.ProcessName -like 'EasyAntiCheat*' }).Count -gt 0; @($all | Where-Object { $_.ProcessName -eq 'Le Mans Ultimate' } | ForEach-Object { $gamePath = $null; $gameIdentity = $null; try { $gamePath = $_.Path; $gameIdentity = ([string]$_.Id + ':' + $_.StartTime.ToUniversalTime().Ticks) } catch {}; @{pid=$_.Id; executable=$gamePath; identity=$gameIdentity; eac=$eacActive} }) | ConvertTo-Json -Compress";
  const { stdout } = await execute(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, timeout: 5000 },
  );
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const games = Array.isArray(parsed) ? parsed : [parsed];
  // Protected processes may hide their path. Retain them only so reset
  // admission can report EAC explicitly before checking installation identity.
  return games.some((game) => game.eac === true)
    ? games
    : selectGames(games, installation, telemetryOnly);
}

function selectGames(games, installation, telemetryOnly = false) {
  // The public SDK does not require the protected game's executable path or start time.
  // Reset admission still requires the selected installation and a process identity.
  if (telemetryOnly) return games;
  return installation
    ? games.filter(
        (game) =>
          typeof game.executable === "string" &&
          typeof game.identity === "string" &&
          path.resolve(game.executable).toLowerCase() ===
            path.join(installation, "Le Mans Ultimate.exe").toLowerCase(),
      )
    : games;
}

function resolvePython() {
  if (process.env.SECTOR_PYTHON) return process.env.SECTOR_PYTHON;
  const bundled = path.join(
    process.env.USERPROFILE || "",
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",
  );
  return fs.existsSync(bundled) ? bundled : "python.exe";
}

class Runtime extends EventEmitter {
  constructor({
    root,
    settingsFile,
    getSettings,
    python = resolvePython(),
    discover = discoverGame,
    spawnChild = spawn,
    now = Date.now,
    replaceLease = fs.renameSync,
    admission = resetAccess,
    authorize = () => false,
    beforeLaunch = () => {
      throw new Error("Explicit offline authorization required.");
    },
    onRevoke = () => {},
    onCleanStop = () => {},
  }) {
    super();
    Object.assign(this, {
      root,
      settingsFile,
      getSettings,
      python,
      discover,
      spawnChild,
      now,
      replaceLease,
      admission,
      authorize,
      beforeLaunch,
      onRevoke,
      onCleanStop,
    });
    this.state = {
      ...emptyCheckpoint,
      phase: "idle",
      message: "",
    };
    this.enabled = false;
    this.verifiedUntil = 0;
    this.contextVerified = true;
    this.child = null;
    this.blockedIdentity = null;
    this.nextDiscovery = 0;
    this.publishedLeaseUntil = 0;
    this.sequence = -1;
    this.stopping = false;
    this.busy = false;
  }

  publish(patch) {
    if (patch.phase === "error" || patch.blocked_reason === "eac") {
      this.handoffBlocked = true;
      this.lastCleanStop = null;
    }
    if (patch.blocked_reason === "eac") this.eacBlocked = true;
    this.state = { ...this.state, ...patch };
    if (!this.enabled && patch.phase === "active")
      Object.assign(this.state, { phase: "stopped", ...emptyCheckpoint });
    if (this.eacBlocked)
      Object.assign(this.state, {
        phase: "blocked",
        blocked_reason: "eac",
        reset_action: 0,
        ...emptyCheckpoint,
        message: EAC_MESSAGE,
      });
    if (!this.state.checkpoint) Object.assign(this.state, emptyCheckpoint);
    this.emit("status", this.state);
  }

  enable() {
    if (this.stopping || this.child)
      throw new Error("Wait for the previous listener to stop.");
    this.enabled = true;
    this.blockedIdentity = null;
    this.nextDiscovery = 0;
    this.start();
  }

  disable(
    reason = "Active Reset disabled. Close LMU before returning online.",
  ) {
    this.enabled = false;
    this.verifiedUntil = 0;
    this.onRevoke();
    this.finishReset({ ok: false, error: reason });
    if (this.session) {
      // Signal stop even if a concurrent Windows reader prevents deleting the lease.
      try {
        fs.writeFileSync(path.join(this.session, "stop"), "");
      } catch {
        reason +=
          " Stop signal could not be written; the existing lease will expire.";
      }
      try {
        fs.rmSync(path.join(this.session, "heartbeat"), { force: true });
      } catch {
        reason += " The previous lease could not be removed and will expire.";
      }
    }
    this.publish({ phase: "stopped", ...emptyCheckpoint, message: reason });
  }

  writeLease() {
    if (!this.enabled || this.stopping || this.now() >= this.verifiedUntil)
      return;
    if (this.publishedLeaseUntil && this.now() >= this.publishedLeaseUntil)
      throw new Error(
        "Published safety authorization expired. Restart LMU before re-enabling.",
      );
    const file = path.join(this.session, "heartbeat");
    const expiry = this.verifiedUntil;
    fs.writeFileSync(
      `${file}.tmp`,
      JSON.stringify({
        schema: 1,
        pid: this.game.pid,
        identity: this.game.identity,
        expires_at_ms: expiry,
        writes_allowed: this.contextVerified,
      }),
    );
    try {
      this.replaceLease(`${file}.tmp`, file);
      this.publishedLeaseUntil = expiry;
    } catch (error) {
      // Python can briefly hold the destination open without delete sharing on Windows.
      // Keep the previous complete lease and retry on the next tick; never extend
      // its lifetime or recreate an expired authorization after a missed publication.
      if (
        !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
        !this.publishedLeaseUntil ||
        this.now() >= this.publishedLeaseUntil
      )
        throw error;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 250);
    void this.tick();
  }

  requestReset(action) {
    const reject = (error) => Promise.resolve({ ok: false, error });
    if (this.eacBlocked) return reject(EAC_MESSAGE);
    if (!this.contextVerified)
      return reject(
        "Writes are paused while offline verification is unavailable.",
      );
    if (!this.enabled || this.now() >= this.verifiedUntil)
      return reject(
        "Offline authorization expired. Disable Active Reset and restart LMU.",
      );
    if (!["save", "restore"].includes(action))
      return reject("Unknown reset action.");
    if (
      this.stopping ||
      !this.child ||
      this.state.phase !== "active" ||
      !this.state.log_prefix
    )
      return reject("Enter driving before saving or restoring.");
    if (this.resetRequest)
      return reject("A reset operation is already in progress.");
    if (action === "restore" && !this.state.checkpoint)
      return reject("Save a checkpoint before restoring.");
    const request = {
      schema_version: 1,
      id: randomUUID(),
      action,
      host: this.state.log_prefix,
      created_at_ms: this.now(),
    };
    return new Promise((resolve) => {
      const file = path.join(this.session, "command.json");
      const temporary = `${file}.tmp`;
      this.resetRequest = {
        id: request.id,
        resolve,
        file,
        timer: setTimeout(
          () =>
            this.finishReset({
              ok: false,
              error: "Reset acknowledgement timed out.",
            }),
          7000,
        ),
      };
      try {
        fs.writeFileSync(temporary, JSON.stringify(request));
        fs.renameSync(temporary, file);
      } catch (error) {
        this.finishReset({ ok: false, error: error.message });
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    });
  }

  finishReset(result) {
    const pending = this.resetRequest;
    if (!pending) return;
    this.resetRequest = null;
    clearTimeout(pending.timer);
    // Delete only our own unconsumed request. Never retry a timed-out reset.
    try {
      if (JSON.parse(fs.readFileSync(pending.file, "utf8")).id === pending.id)
        fs.rmSync(pending.file);
    } catch {
      /* The supervisor may already have consumed it. */
    }
    pending.resolve(result);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.child) {
        if (this.enabled && this.now() >= this.verifiedUntil)
          this.disable(
            "Safety checks expired. Close LMU before using Active Reset again.",
          );
        this.writeLease();
        this.readStatus();
        if (
          this.enabled &&
          !this.stopping &&
          !this.protectionCheck &&
          this.now() >= this.nextDiscovery
        ) {
          this.nextDiscovery = this.now() + 1000;
          const child = this.child;
          const identity = this.game.identity;
          this.protectionCheck = (async () => {
            const games = await this.discover();
            if (!this.enabled || this.child !== child) return;
            if (games.some((game) => game.eac === true)) return this.blockEac();
            if (
              games.length !== 1 ||
              games[0].identity !== identity ||
              !this.authorize(games[0])
            )
              throw new Error(
                "LMU process identity or offline authorization changed.",
              );
            const access = await this.admission(games[0]);
            if (!this.enabled || this.stopping || this.child !== child) return;
            if (this.now() >= this.verifiedUntil)
              throw new Error("Safety verification timed out.");
            if (
              !access.allowed &&
              ["transport", "unknown"].includes(access.code)
            ) {
              // Do not renew authorization while the HTTP context is unknown.
              // The worker pauses writes immediately; the existing deadline still applies.
              this.contextVerified = false;
              this.writeLease();
              this.publish({
                phase: "paused",
                message: access.reason,
                context_code: access.code,
              });
              this.nextDiscovery = this.now() + 250;
              return;
            }
            if (!access.allowed)
              throw new Error(
                access.reason || "Offline Practice is no longer confirmed.",
              );
            // An expired lease must never be revived by a slow asynchronous check.
            if (
              this.enabled &&
              !this.stopping &&
              this.child === child &&
              this.now() < this.verifiedUntil
            ) {
              this.contextVerified = true;
              if (this.state.context_code) this.publish({ context_code: null });
              this.verifiedUntil = this.now() + 2500;
              this.writeLease();
            } else if (this.enabled)
              throw new Error("Safety verification timed out.");
          })()
            .catch((error) =>
              this.disable(`Safety verification failed: ${error.message}`),
            )
            .finally(() => {
              this.protectionCheck = null;
            });
        }
        return;
      }
      if (this.stopping || this.now() < this.nextDiscovery) return;
      this.nextDiscovery = this.now() + 1500;
      const games = await this.discover();
      // A quit request may arrive while PowerShell is discovering the game.
      if (this.stopping) return;
      if (games.some((game) => game.eac === true)) {
        this.blockEac();
        return;
      }
      this.eacBlocked = false;
      this.state.blocked_reason = null;
      if (games.length !== 1) {
        this.blockedIdentity = null;
        this.publish({
          phase: "idle",
          ...emptyCheckpoint,
          message: games.length > 1 ? "Keep one LMU instance open." : "",
        });
        return;
      }
      const game = games[0];
      if (!this.enabled || !this.authorize(game)) return;
      const access = await this.admission(game);
      if (this.stopping || !this.enabled || !this.authorize(game)) return;
      if (!access.allowed) {
        this.publish({
          phase: "waiting",
          ...emptyCheckpoint,
          message: access.reason,
        });
        return;
      }
      if (
        !Number.isSafeInteger(game.pid) ||
        game.pid <= 0 ||
        typeof game.identity !== "string"
      )
        throw new Error("Invalid LMU process identity.");
      if (game.identity === this.blockedIdentity) return;
      this.blockedIdentity = game.identity;
      this.beforeLaunch(game);
      this.game = game;
      this.contextVerified = true;
      this.verifiedUntil = this.now() + 2500;
      this.launch(game.pid);
    } catch (error) {
      this.disable(error.message);
      this.publish({ phase: "error", message: error.message });
    } finally {
      this.busy = false;
    }
  }

  blockEac() {
    this.disable(EAC_MESSAGE);
    this.eacBlocked = true;
    this.finishReset({ ok: false, error: EAC_MESSAGE });
    this.publish({});
    if (this.child) fs.writeFileSync(path.join(this.session, "stop"), "");
  }

  launch(pid) {
    this.lastCleanStop = null;
    this.handoffBlocked = false;
    this.session = path.join(this.root, "work/gui", randomUUID());
    this.publishedLeaseUntil = 0;
    fs.mkdirSync(this.session, { recursive: true });
    this.writeLease();
    const logs = path.join(this.root, "logs");
    fs.mkdirSync(logs, { recursive: true });
    const name = `gui-${path.basename(this.session)}`;
    const preferences = this.getSettings();
    const args = [
      "-B",
      "-X",
      "utf8",
      path.join(this.root, "scripts/sector.py"),
      "runtime.start_reset_hotkeys",
      "--pid",
      String(pid),
      "--save-key",
      preferences.save_key,
      "--restore-key",
      preferences.restore_key,
      "--gui-session",
      this.session,
      "--settings-file",
      this.settingsFile,
      "--offline-launch-confirmed",
      "--allow-writes",
    ];
    if (!preferences.sound) args.push("--mute");
    const output = fs.openSync(path.join(logs, `${name}.log`), "a");
    let errors;
    try {
      errors = fs.openSync(path.join(logs, `${name}.error.log`), "a");
      this.child = this.spawnChild(this.python, args, {
        cwd: this.root,
        windowsHide: true,
        stdio: ["ignore", output, errors],
        env: { ...process.env, PYTHONUTF8: "1" },
      });
    } finally {
      fs.closeSync(output);
      if (errors !== undefined) fs.closeSync(errors);
    }
    this.sequence = -1;
    this.publish({
      phase: "waiting",
      ...emptyCheckpoint,
      message: "LMU detected. Enter driving in offline Practice.",
      clean_shutdown: false,
      controller_stop_reason: null,
      context_code: null,
    });
    const child = this.child;
    child.once("error", (error) => {
      this.publish({
        phase: "error",
        ...emptyCheckpoint,
        message: `Cannot start the reset listener: ${error.message}`,
      });
    });
    child.once("close", (code) => {
      if (this.child !== child) return;
      const failure = this.state.phase === "error" ? this.state.message : null;
      this.readStatus();
      this.finishReset({ ok: false, error: "Reset listener disconnected." });
      this.enabled = false;
      this.verifiedUntil = 0;
      this.onRevoke();
      this.child = null;
      const controllerCause = this.state.controller_stop_reason;
      const clean =
        !this.handoffBlocked &&
        code === 0 &&
        !this.eacBlocked &&
        failure === null &&
        this.state.phase !== "error" &&
        this.state.clean_shutdown === true;
      this.lastCleanStop = clean
        ? { clean: true, game: { ...this.game }, workerPid: child.pid }
        : null;
      const resumable =
        code === 0 &&
        !this.stopping &&
        !this.eacBlocked &&
        failure === null &&
        this.state.phase !== "error" &&
        this.state.clean_shutdown === true;
      if (resumable) this.onCleanStop(this.game);
      const previousError = failure !== null || this.state.phase === "error";
      this.publish({
        ...emptyCheckpoint,
        clean_shutdown: false,
        phase: previousError
          ? "error"
          : resumable
            ? "session_ended"
            : code === 0
              ? "stopped"
              : "error",
        message: previousError
          ? (failure ?? this.state.message)
          : resumable
            ? `Host stopped cleanly${controllerCause ? ` (${controllerCause})` : ""}. Enter Offline Practice and explicitly enable Active Reset; save a new checkpoint.`
            : code === 0
              ? "Disconnected."
              : `Listener stopped (${code ?? "launch error"}). Reopen Sector after checking the session log.`,
      });
      this.emit("detached");
    });
  }

  readStatus() {
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(this.session, "status.json"), "utf8"),
      );
      if (
        value.schema_version !== 1 ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence === this.sequence
      )
        return;
      this.sequence = value.sequence;
      const failure =
        !this.enabled && this.state.phase === "error"
          ? { phase: "error", message: this.state.message }
          : {};
      this.publish({ ...value, ...failure });
      if (
        value.desktop_request?.id === this.resetRequest?.id &&
        this.resetRequest
      )
        this.finishReset(value.desktop_request);
    } catch {
      /* Atomic replacement can briefly race a reader on Windows. */
    }
  }

  async stop() {
    this.disable("Sector is closing. Restart LMU before online play.");
    this.stopping = true;
    this.finishReset({ ok: false, error: "Sector is closing." });
    if (!this.child) {
      this.dispose();
      return;
    }
    this.publish({
      phase: "stopping",
      message: "Finishing the current operation\u2026",
    });
    // Keep heartbeat/status polling alive until Python confirms native detach.
    // Never terminate the game or a listener in the middle of a restore.
    const detached = new Promise((resolve) => this.once("detached", resolve));
    fs.writeFileSync(path.join(this.session, "stop"), "");
    await detached;
    this.dispose();
  }

  dispose() {
    this.stopping = true;
    this.finishReset({ ok: false, error: "Reset listener stopped." });
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  Runtime,
  resolvePython,
  emptyCheckpoint,
  discoverGame,
  selectGames,
};
