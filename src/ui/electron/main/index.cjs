const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  protocol,
  net,
  session,
  dialog,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Overlays } = require("./overlays.cjs");
const { Runtime, resolvePython, discoverGame } = require("./runtime.cjs");
const setupStore = require("./onboarding.cjs");
const { GameLauncher } = require("./game-launcher.cjs");
const { OfflineSafety } = require("./offline-safety.cjs");
const { waitForGameExit } = require("./clean-restart.cjs");
const { resetAccess } = require("./reset-access.cjs");
const { Diagnostics } = require("./diagnostics.cjs");
const {
  defaults,
  keys,
  readSettings,
  writeSettings,
  validateSettings,
} = require("./settings.cjs");

// Packaged resources are copied to a versioned writable workspace for native logs and IPC.
const { verifyRuntime } = require("./runtime-integrity.cjs");
const sourceRoot = path.resolve(__dirname, "../../../..");
const packagedPreview = process.argv.includes("--preview");
if (packagedPreview && process.env.SECTOR_PREVIEW_ROOT) {
  fs.mkdirSync(process.env.SECTOR_PREVIEW_ROOT, { recursive: true });
  app.setPath("userData", path.resolve(process.env.SECTOR_PREVIEW_ROOT));
}
const root = app.isPackaged
  ? path.join(
      app.getPath("userData"),
      packagedPreview ? "preview-runtime" : "runtime",
      `${app.getVersion()}-${fs.readFileSync(path.join(process.resourcesPath, "release-id"), "utf8").trim()}`,
    )
  : sourceRoot;
if (app.isPackaged) {
  if (!fs.existsSync(root)) {
    const staging = `${root}-${process.pid}.tmp`;
    fs.mkdirSync(staging, { recursive: true });
    fs.cpSync(path.join(process.resourcesPath, "runtime"), staging, {
      recursive: true,
    });
    try {
      fs.renameSync(staging, root);
    } catch (error) {
      if (!fs.existsSync(root)) throw error;
    }
  }
  verifyRuntime(root, process.resourcesPath);
  process.env.SECTOR_PYTHON = path.join(root, "python/python.exe");
}
process.env.PYTHONDONTWRITEBYTECODE = "1";
const preview = process.argv.includes("--preview");
const smoke = preview && process.argv.includes("--smoke");
const onboardingSmoke = smoke && process.argv.includes("--onboarding-smoke");
const previewRoot = path.join(root, "work/electron-preview");
if (preview) app.setPath("userData", previewRoot);
const diagnostics = new Diagnostics(
  preview ? previewRoot : root,
  app.getVersion(),
);
diagnostics.record("startup", {
  version: app.getVersion(),
  packaged: app.isPackaged,
  preview,
});
process.on("uncaughtExceptionMonitor", (error) =>
  diagnostics.record("uncaught-error", {
    message: error.message,
    stack: error.stack,
  }),
);
app.setName("Sector");
app.setAppUserModelId("Sector.Desktop");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "sector",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const settingsFile = path.join(
  preview ? previewRoot : process.env.LOCALAPPDATA || app.getPath("userData"),
  "LMUActiveReset/settings.json",
);
const setupFile =
  onboardingSmoke && process.env.SECTOR_TEST_SETUP_FILE
    ? process.env.SECTOR_TEST_SETUP_FILE
    : path.join(path.dirname(settingsFile), "onboarding.json");
let setup = setupStore.readSetup(setupFile);
const setupReady = () => (preview && !onboardingSmoke) || setup.completed;
const safety = new OfflineSafety({
  file: path.join(path.dirname(settingsFile), "reset-safety.json"),
  installation: () => setup.lmuPath,
});
let latestGames = [];
const gameLauncher = new GameLauncher({
  installation: () => setup.lmuPath,
  discover: discoverGame,
  preview,
});
const discoverInstallation = async () => {
  if (!setupReady()) return [];
  const games = await discoverGame();
  latestGames = games;
  safety.observe(games);
  gameLauncher.observe(games);
  return games;
};
const discoverOverlayGame = async () => {
  if (!setupReady()) return [];
  const games = await discoverGame(undefined, { telemetryOnly: true });
  latestGames = games;
  safety.observe(games);
  if (!safety.enabled && runtime.enabled)
    runtime.disable(
      "Offline authorization lost. Close LMU before re-enabling.",
    );
  gameLauncher.observe(games);
  return games;
};
let preferences = { ...defaults };
let settingsError = "";
try {
  preferences = readSettings(settingsFile);
} catch (error) {
  settingsError = error.message;
}
const runtime = new Runtime({
  root,
  settingsFile,
  getSettings: () => preferences,
  discover: discoverInstallation,
  authorize: (game) => safety.allows(game),
  beforeLaunch: (game) => safety.markModified(game),
  onRevoke: () => safety.revoke(),
});
gameLauncher.on("launched", (game) => {
  safety.captureLaunch(game);
  latestGames = [game];
});
let transitionPending = false;
let window;
let tray;
let quitting = false;
let canQuit = false;
let audioReady;
let overlays;
// Keep this in the main process so hiding, restoring or reloading cannot replay it.
let launchAnimationPending = true;
gameLauncher.on("state", (state) => {
  // Both overlay and reset discovery reach this path, including LMU's menu.
  // Block commands before notifying the renderer, without waiting for admission
  // or for the reset worker's next discovery cycle.
  if (state.eac && !runtime.eacBlocked) runtime.blockEac();
  if (window && !window.isDestroyed())
    window.webContents.send("sector:game", {
      ...state,
      safety: safety.state(latestGames),
    });
});

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function quit() {
  if (quitting) return;
  quitting = true;
  showWindow();
  try {
    overlays?.stop();
    gameLauncher.stop();
    await runtime.stop();
    canQuit = true;
    app.quit();
  } catch (error) {
    quitting = false;
    runtime.publish({
      phase: "error",
      message: `Could not request shutdown: ${error.message}. Try Quit again.`,
    });
  }
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== "sector://app/index.html"
    )
      throw new Error("Untrusted desktop request.");
    return callback(...args);
  });
}

function installBridge() {
  handle("sector:diagnostics-export", async () => {
    const selected = await dialog.showSaveDialog(window, {
      title: "Export Sector diagnostics",
      defaultPath: path.join(
        app.getPath("downloads"),
        `Sector-${app.getVersion()}-diagnostics.json`,
      ),
      filters: [{ name: "Sector diagnostics", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    try {
      const frame = overlays?.telemetry.frame;
      const graphics = await app.getGPUInfo("basic").catch(() => null);
      const bundle = diagnostics.bundle({
        reset: runtime.state,
        telemetry: {
          status: overlays?.telemetry.status,
          track: frame?.track,
          car: frame?.player?.model,
          session: frame?.session,
        },
        graphics,
      });
      fs.writeFileSync(
        selected.filePath,
        JSON.stringify(bundle, null, 2),
        "utf8",
      );
      return { ok: true };
    } catch (error) {
      diagnostics.record("export-error", { message: error.message });
      return {
        ok: false,
        error:
          "Could not export diagnostics. Choose a writable folder and retry.",
      };
    }
  });
  handle("sector:initialize", () => {
    const launchAnimation = launchAnimationPending;
    launchAnimationPending = false;
    return {
      launchAnimation,
      settings: preferences,
      keys,
      status: runtime.state,
      preview,
      game: { ...gameLauncher.state, safety: safety.state(latestGames) },
      settingsError,
      onboarding: { required: !setupReady(), folder: setup.lmuPath },
    };
  });
  handle("sector:launch-game", async () => {
    if (preview || quitting || !setupReady() || transitionPending)
      return { ok: false, error: "Offline launch is unavailable." };
    try {
      const games = await discoverInstallation();
      if (games.length || safety.marker || safety.error || runtime.child)
        throw new Error(
          safety.error ||
            "Close LMU and wait for the previous listener to stop first.",
        );
      return await gameLauncher.launch();
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle("sector:reset-enable", async () => {
    if (preview || quitting || !setupReady() || transitionPending)
      return { ok: false, error: "Active Reset is unavailable." };
    try {
      const games = await discoverInstallation();
      if (games.length !== 1)
        throw new Error(
          "Exactly one verified offline LMU session is required.",
        );
      const access = await resetAccess(games[0]);
      if (!access.allowed) throw new Error(access.reason);
      // Refresh after asynchronous context checks to reject a changed process.
      const refreshed = await discoverInstallation();
      if (refreshed.length !== 1 || refreshed[0].identity !== games[0].identity)
        throw new Error("LMU identity changed during activation.");
      if (quitting || transitionPending)
        throw new Error("Activation canceled.");
      safety.enable(refreshed[0], refreshed.length);
      runtime.enable();
      gameLauncher.publish({});
      return { ok: true };
    } catch (error) {
      runtime.disable(error.message);
      return { ok: false, error: error.message };
    }
  });
  handle("sector:reset-disable", () => {
    runtime.disable();
    gameLauncher.publish({});
    return { ok: true, restartRequired: Boolean(safety.marker) };
  });
  handle("sector:restart-online", async () => {
    if (preview || quitting || transitionPending || !setupReady())
      return { ok: false, error: "Restart is unavailable." };
    transitionPending = true;
    // Revoke before displaying any dialog, never leave writes active on cancel.
    const modified = safety.marker;
    runtime.disable();
    gameLauncher.publish({});
    try {
      const answer = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Restart LMU for online play",
        message: "Close this LMU session and launch a new one through Steam?",
        detail:
          "Active Reset stays disabled. Unsaved session progress may be lost. Restarting removes in-memory modifications; it does not undo saved results or guarantee protection from bans.",
        buttons: ["Cancel", "Close LMU and launch through Steam"],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return { ok: false, canceled: true };
      await waitForGameExit({ discover: discoverInstallation, game: modified });
      // Require the worker to exit cooperatively too; never kill a restore worker.
      for (let i = 0; runtime.child && i < 40; i++)
        await new Promise((resolve) => setTimeout(resolve, 250));
      if (
        runtime.child ||
        (await discoverInstallation()).length ||
        safety.marker ||
        safety.error
      )
        throw new Error(
          "Clean shutdown could not be verified. Online relaunch is blocked.",
        );
      if (quitting) throw new Error("Sector is closing.");
      await shell.openExternal("steam://rungameid/2399420");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      transitionPending = false;
      gameLauncher.publish({});
    }
  });
  handle("sector:report-bug", async () => {
    try {
      // Keep external navigation limited to the project's issue composer.
      await shell.openExternal(
        "https://github.com/sector-lmu/Sector/issues/new",
      );
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not open GitHub in your browser." };
    }
  });
  handle("sector:installation", () => ({ folder: setup.lmuPath }));
  handle("sector:installation-update", (folder) => {
    try {
      if (!setupReady()) throw new Error("Complete first-launch setup first.");
      if (quitting) throw new Error("Sector is closing.");
      if (runtime.enabled || runtime.child || safety.marker)
        throw new Error(
          "Close the reset session before changing installation.",
        );
      const candidate = {
        lmuPath: setupStore.validateFolder(folder),
        completed: true,
      };
      // Preview must never persist settings outside its isolated profile.
      setup =
        preview && !onboardingSmoke
          ? candidate
          : setupStore.writeSetup(setupFile, candidate);
      return { ok: true, folder: setup.lmuPath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle("sector:reset", (action) =>
    preview || quitting || !setupReady()
      ? { ok: false, error: "Reset is unavailable in this session." }
      : runtime.requestReset(action),
  );
  handle("sector:setup-detect", async () => {
    if (preview)
      return onboardingSmoke && process.env.SECTOR_TEST_LMU
        ? [setupStore.validateFolder(process.env.SECTOR_TEST_LMU)]
        : [];
    return setupStore.detectInstallations();
  });
  handle("sector:setup-browse", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Select Le Mans Ultimate folder",
      defaultPath: setup.lmuPath || undefined,
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      return {
        ok: true,
        folder: setupStore.validateFolder(result.filePaths[0]),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle("sector:setup-confirm", (folder) => {
    try {
      if (setupReady()) throw new Error("Setup is already complete.");
      setup = setupStore.writeSetup(setupFile, {
        lmuPath: folder,
        completed: false,
      });
      return { ok: true, folder: setup.lmuPath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle("sector:setup-complete", () => {
    try {
      setup = setupStore.writeSetup(setupFile, { ...setup, completed: true });
      if (!preview && !settingsError) {
        preferences = writeSettings(settingsFile, preferences);
        runtime.start();
      }
      overlays.sync();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle("sector:settings", (candidate) => {
    try {
      preferences = preview
        ? validateSettings(candidate)
        : writeSettings(settingsFile, candidate);
      settingsError = "";
      if (!preview && setupReady() && !runtime.timer) runtime.start();
      return { ok: true, settings: preferences };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle("sector:overlays-initialize", () => overlays.state());
  handle("sector:overlays-save", (value) => overlays.save(value));
  handle("sector:overlays-edit", (value) => overlays.setEditing(value));
  handle("sector:sound", async (name) => {
    if (!["save", "restore"].includes(name) || !preferences.sound)
      return { ok: false, error: "Sound is disabled." };
    try {
      const directory = path.join(root, "work/ui-audio");
      if (!audioReady) {
        audioReady = promisify(execFile)(
          resolvePython(),
          [
            "-B",
            "-X",
            "utf8",
            path.join(root, "scripts/sector.py"),
            "desktop.reset_feedback",
            directory,
          ],
          { cwd: root, windowsHide: true, timeout: 15000 },
        ).catch((error) => {
          audioReady = null;
          throw error;
        });
      }
      await audioReady;
      return {
        ok: true,
        source: `data:audio/wav;base64,${fs.readFileSync(path.join(directory, `${name}.wav`)).toString("base64")}`,
      };
    } catch {
      return {
        ok: false,
        error: "Sound preview unavailable. Check Python and your audio device.",
      };
    }
  });
  handle("sector:minimize", () => window.minimize());
  handle("sector:maximize", () =>
    window.isMaximized() ? window.unmaximize() : window.maximize(),
  );
  handle("sector:background", () => {
    if (!quitting) {
      overlays.setEditing(false);
      window.hide();
    }
  });
  handle("sector:quit", () => {
    void quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  // An older tray instance otherwise silently receives launches of a new EXE.
  if (preview) app.quit();
  else
    app.whenReady().then(async () => {
      await dialog.showMessageBox({
        type: "info",
        title: `Sector ${app.getVersion()}`,
        message: "Sector is already running",
        detail: `The open instance has been brought to the front. To start version ${app.getVersion()}, choose Quit Sector in that app, then open this executable again.`,
        buttons: ["OK"],
      });
      app.quit();
    });
} else {
  app.on("second-instance", showWindow);
  app.on("before-quit", (event) => {
    if (!canQuit) {
      event.preventDefault();
      void quit();
    }
  });
  app.on("window-all-closed", () => {
    /* Tray owns the app lifetime. */
  });
  app
    .whenReady()
    .then(async () => {
      const dist = path.join(__dirname, "../dist");
      protocol.handle("sector", (request) => {
        const url = new URL(request.url);
        const file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
        const relative = path.relative(dist, file);
        if (
          url.host !== "app" ||
          request.method !== "GET" ||
          relative.startsWith("..") ||
          path.isAbsolute(relative)
        )
          return new Response("Forbidden", { status: 403 });
        return net.fetch(pathToFileURL(file).toString());
      });
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
        (_request, callback) => callback({ cancel: true }),
      );
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      window = new BrowserWindow({
        title: "Sector",
        width: 1200,
        height: 880,
        minWidth: 620,
        minHeight: 560,
        backgroundColor: "#f3f0e8",
        frame: false,
        show: false,
        icon: path.join(root, "assets/sector.ico"),
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: true,
        },
      });
      window.removeMenu();
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      window.webContents.on("render-process-gone", () => {
        void quit();
      });
      window.on("close", (event) => {
        if (!canQuit) {
          event.preventDefault();
          if (!quitting) window.webContents.send("sector:close-requested");
        }
      });
      overlays = new Overlays({
        root,
        file: path.join(path.dirname(settingsFile), "overlays.json"),
        preview,
        desktop: () => window,
        discover: discoverOverlayGame,
        ready: setupReady,
      });
      installBridge();
      runtime.on("status", (state) => {
        diagnostics.record("reset-status", {
          phase: state.phase,
          message: state.message,
          checkpoint: state.checkpoint,
          log_prefix: state.log_prefix,
          restore_count: state.restore_count,
        });
        overlays.telemetry.onResetStatus(state);
        if (!window.isDestroyed())
          window.webContents.send("sector:status", state);
      });
      overlays.telemetry.on("frame", (frame) => {
        diagnostics.record("session", {
          status: overlays.telemetry.status,
          track: frame?.track,
          car: frame?.player?.model,
          session: frame?.session,
        });
        const player = frame?.cars?.find((car) => car.player);
        diagnostics.record("scoring", {
          gamePhase: frame?.gamePhase,
          yellowFlagState: frame?.yellowFlagState,
          playerId: player?.id,
          penalties: player?.penalties,
          finishStatus: player?.finishStatus,
          flag: player?.flag,
          countLap: player?.countLap,
          trackLimits: frame?.player?.limits,
          lapInvalidated: frame?.player?.invalid,
          restoreCount: runtime.state.restore_count,
        });
      });
      window.webContents.on("render-process-gone", (_event, details) =>
        diagnostics.record("renderer-exit", details),
      );
      tray = new Tray(path.join(root, "assets/sector.ico"));
      tray.setToolTip(preview ? "Sector - Preview" : "Sector");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Open Sector", click: showWindow },
          { type: "separator" },
          {
            label: "Quit Sector",
            click: () => {
              void quit();
            },
          },
        ]),
      );
      tray.on("double-click", showWindow);
      await window.loadURL("sector://app/index.html");
      if (!smoke) showWindow();
      // Preview and automated UI tests cannot discover LMU or launch the host.
      if (!preview && setupReady() && !settingsError) {
        try {
          preferences = writeSettings(settingsFile, preferences);
          runtime.start();
        } catch (error) {
          runtime.publish({ phase: "error", message: error.message });
        }
      }
      // Only the isolated preview process exposes a test driver, never the renderer.
      if (smoke)
        global.sectorTest = {
          publish: (state) => {
            // Isolated preview driver only: exercise presentation without granting a worker.
            const enabled = runtime.enabled;
            runtime.enabled = true;
            runtime.publish(state);
            runtime.enabled = enabled;
          },
          clearProtection: () => {
            runtime.eacBlocked = false;
            runtime.publish({ phase: "idle", blocked_reason: null });
          },
          show: showWindow,
          window: () => window,
          hasListener: () => Boolean(runtime.child || runtime.timer),
          observeGame: (games) => gameLauncher.observe(games),
          overlays: () => overlays,
        };
    })
    .catch((error) => {
      console.error(error);
      canQuit = true;
      app.exit(1);
    });
}
