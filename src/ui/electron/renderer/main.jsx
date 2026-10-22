import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { Menu } from "@base-ui/react/menu";
import { Icon } from "@iconify/react";
import restart from "@iconify-icons/solar/restart-linear";
import layers from "@iconify-icons/solar/layers-linear";
import keyboard from "@iconify-icons/solar/keyboard-linear";
import save from "@iconify-icons/solar/diskette-linear";
import arrow from "@iconify-icons/solar/arrow-right-linear";
import check from "@iconify-icons/solar/check-circle-linear";
import close from "@iconify-icons/solar/close-circle-linear";
import monitor from "@iconify-icons/solar/monitor-linear";
import gear from "@iconify-icons/solar/settings-linear";
import { Preferences, AudioFeedback } from "./preferences.jsx";
import { OverlayEditor } from "./overlays/editor.jsx";
import { GuidedTour } from "./guided-tour.jsx";
import { Onboarding } from "./onboarding.jsx";
import { Home } from "./home.jsx";
import { ResetLaunch } from "./reset-launch.jsx";
import { StartupSplash } from "./startup-splash.jsx";
import { Changelog } from "./changelog.jsx";
import { ResetLog, useResetLog } from "./reset-log.jsx";
import history from "@iconify-icons/solar/history-linear";
import home from "@iconify-icons/solar/home-2-linear";
import help from "@iconify-icons/solar/question-circle-linear";
import pen from "@iconify-icons/solar/pen-linear";
import bug from "@iconify-icons/solar/bug-linear";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import logo from "@assets/sector-logo-orange.png";
import { keyFromEvent, keyLabel } from "./keys.js";
import { statusView } from "./status.js";
import "./style.css";

const api = window.sector;
const Glyph = ({ icon, ...props }) => (
  <Icon icon={icon} aria-hidden="true" {...props} />
);

function App() {
  const [startup, setStartup] = useState("pending");
  const finishStartup = useCallback(() => setStartup("done"), []);
  const [settings, setSettings] = useState(null);
  const [keys, setKeys] = useState([]);
  const [status, setStatus] = useState({ phase: "idle" });
  const [tab, setTab] = useState("home");
  const [game, setGame] = useState({
    running: false,
    launching: false,
    error: "",
  });
  const [preview, setPreview] = useState(true);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState("");
  const [captureHint, setCaptureHint] = useState(
    "Press a key, or choose Bind wheel button. Esc to cancel.",
  );
  const [pending, setPending] = useState(false);
  const [wheelCapturing, setWheelCapturing] = useState(false);
  const wheelCaptureSequence = useRef(0);
  const [tour, setTour] = useState(false);
  const [onboarding, setOnboarding] = useState(null);
  const tourStartTab = useRef("reset");
  const [quitting, setQuitting] = useState(false);
  const backgroundAfterClose = useRef(false);
  const modalRef = useRef(null);
  const modalContent = useRef(null);
  if (modal) modalContent.current = modal;
  const shownModal = modalContent.current;
  const captureBusy = useRef(false);
  const audio = useRef(null);
  const view = statusView(status);
  const eacBlocked = status.blocked_reason === "eac" || game.eac === true;
  const gameDetected =
    game.running || ["active", "paused"].includes(status.phase);
  const resetLog = useResetLog(status);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(
      settings?.reduce_motion === true,
    );
  }, [settings?.reduce_motion]);

  useEffect(() => {
    if (status.phase === "error") setQuitting(false);
  }, [status.phase, status.message]);

  useEffect(() => {
    let live = true;
    let receivedStatus = false;
    let receivedGame = false;
    const gameOff = api.onGame((value) => {
      receivedGame = true;
      if (live) setGame(value);
    });
    const statusOff = api.onStatus((value) => {
      receivedStatus = true;
      if (live) setStatus(value);
    });
    const closeOff = api.onCloseRequested(() => {
      setTour(false);
      setModal("close");
    });
    api
      .initialize()
      .then((data) => {
        if (!live) return;
        setSettings(data.settings);
        setStartup(data.launchAnimation ? "playing" : "done");
        setPreview(data.preview);
        if (!receivedGame) setGame(data.game);
        setOnboarding(data.onboarding);
        setKeys(data.keys);
        setError(data.settingsError);
        if (!receivedStatus) setStatus(data.status);
      })
      .catch(() => {
        setStartup("done");
        setError("Sector could not initialize. Close and reopen the app.");
      });
    return () => {
      live = false;
      statusOff();
      gameOff();
      closeOff();
      audio.current?.pause();
    };
  }, []);

  useEffect(() => {
    const keyboardInput = () => {
      document.documentElement.dataset.input = "keyboard";
    };
    const pointerInput = () => {
      document.documentElement.dataset.input = "pointer";
    };
    window.addEventListener("keydown", keyboardInput, true);
    window.addEventListener("pointerdown", pointerInput, true);
    return () => {
      window.removeEventListener("keydown", keyboardInput, true);
      window.removeEventListener("pointerdown", pointerInput, true);
    };
  }, []);

  async function updateSettings(candidate) {
    setPending(true);
    try {
      const result = await api.saveSettings(candidate);
      if (!result.ok) throw new Error(result.error);
      setSettings(result.settings);
      setError("");
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (modal !== "save_key" && modal !== "restore_key") return;
    const capture = async (event) => {
      if (event.key === "Escape") return;
      if (
        event.target.closest?.("button") &&
        ["Enter", "Space"].includes(event.code)
      )
        return;
      // Tab remains navigation for the Cancel button. Clicking the Tab affordance
      // below explicitly assigns it, so keyboard users cannot be trapped here.
      if (event.code === "Tab") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || captureBusy.current) return;
      const name = keyFromEvent(event, keys);
      if (!name) {
        setCaptureHint("Use one key without Ctrl, Alt, Shift or Windows.");
        return;
      }
      const other = modal === "save_key" ? "restore_key" : "save_key";
      if (name === settings[other]) {
        setCaptureHint("That key is already assigned to the other action.");
        return;
      }
      captureBusy.current = true;
      if (await updateSettings({ ...settings, [modal]: name })) setModal(null);
      captureBusy.current = false;
    };
    const blur = () => setModal(null);
    window.addEventListener("keydown", capture, true);
    window.addEventListener("blur", blur);
    return () => {
      wheelCaptureSequence.current += 1;
      captureBusy.current = false;
      setWheelCapturing(false);
      void api.cancelWheelCapture?.().catch(() => {});
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("blur", blur);
    };
  }, [modal, settings, keys]);

  async function bindWheel() {
    if (captureBusy.current) return;
    const sequence = ++wheelCaptureSequence.current;
    captureBusy.current = true;
    setWheelCapturing(true);
    setCaptureHint(
      "Release all wheel buttons, then press one button. Keep Sector focused.",
    );
    try {
      const result = await api.captureWheel();
      if (sequence !== wheelCaptureSequence.current) return;
      if (!result.ok) {
        if (!result.canceled) setCaptureHint(result.error);
        return;
      }
      const other = modal === "save_key" ? "restore_key" : "save_key";
      if (result.binding === settings[other]) {
        setCaptureHint(
          "That wheel button is already assigned to the other action.",
        );
        return;
      }
      if (await updateSettings({ ...settings, [modal]: result.binding }))
        setModal(null);
    } catch {
      if (sequence === wheelCaptureSequence.current)
        setCaptureHint("Could not capture a wheel button. Try again.");
    } finally {
      if (sequence === wheelCaptureSequence.current) {
        captureBusy.current = false;
        setWheelCapturing(false);
      }
    }
  }

  async function sound(name) {
    try {
      const result = await api.previewSound(name);
      if (!result.ok) throw new Error(result.error);
      audio.current?.pause();
      audio.current = new Audio(result.source);
      await audio.current.play();
      setError("");
    } catch (err) {
      setError(err.message || "Audio device unavailable.");
    }
  }

  function openCapture(name) {
    setCaptureHint("Press a key, or choose Bind wheel button. Esc to cancel.");
    setModal(name);
  }

  async function exit() {
    setQuitting(true);
    setModal(null);
    try {
      await api.quit();
    } catch {
      setQuitting(false);
      setError("Could not close Sector. Please try again.");
    }
  }

  const key = (name) =>
    keyLabel(settings?.[name] || (name === "save_key" ? "F6" : "F7"), keys);
  function startGuide() {
    tourStartTab.current = tab;
    setModal(null);
    // Let the menu release focus before the tour takes it.
    requestAnimationFrame(() => setTour(true));
  }
  if (startup === "pending") return <div className="splash" />;
  if (startup === "playing")
    return (
      <StartupSplash
        reduceMotion={settings?.reduce_motion === true}
        onDone={finishStartup}
      />
    );
  return (
    <>
      <div className="titlebar">
        <div className="titlebar-menus">
          <Menu.Root>
            <Menu.Trigger
              className="help-menu-trigger"
              data-tour="settings"
              disabled={!settings || quitting}
            >
              Edit
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                className="help-menu-positioner"
                side="bottom"
                align="start"
                sideOffset={4}
                collisionPadding={8}
              >
                <Menu.Popup className="help-menu-popup">
                  <Menu.Item
                    className="help-menu-item"
                    onClick={() =>
                      requestAnimationFrame(() => setModal("settings"))
                    }
                  >
                    <Glyph icon={gear} /> Settings
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Menu.Root>
            <Menu.Trigger
              className="help-menu-trigger guide-menu-trigger"
              disabled={!settings || quitting}
            >
              Help
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                className="help-menu-positioner"
                side="bottom"
                align="start"
                sideOffset={4}
                collisionPadding={8}
              >
                <Menu.Popup className="help-menu-popup">
                  <Menu.Item className="help-menu-item" onClick={startGuide}>
                    <Glyph icon={help} /> Guide
                  </Menu.Item>
                  <Menu.Separator className="help-menu-separator" />
                  <Menu.Item
                    className="help-menu-item"
                    onClick={() => setModal("changelog")}
                  >
                    <Glyph icon={history} /> Changelog
                  </Menu.Item>
                  <Menu.Separator className="help-menu-separator" />
                  <Menu.Item
                    className="help-menu-item"
                    onClick={() => {
                      setExportState("");
                      setModal("diagnostics");
                    }}
                  >
                    <Glyph icon={save} /> Export diagnostics
                  </Menu.Item>
                  <Menu.Item
                    className="help-menu-item"
                    onClick={async () => {
                      try {
                        const result = await api.reportBug();
                        if (!result.ok) throw new Error(result.error);
                      } catch (err) {
                        setError(err.message || "Could not open GitHub.");
                      }
                    }}
                  >
                    <Glyph icon={bug} /> Report a bug
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <div className="window-controls">
          <button aria-label="Minimize" onClick={() => api.minimize()}>
            <svg viewBox="0 0 16 16">
              <path d="M3 8h10" />
            </svg>
          </button>
          <button
            aria-label="Maximize or restore window"
            onClick={() => api.maximize()}
          >
            <svg viewBox="0 0 16 16">
              <rect x="3.5" y="3.5" width="9" height="9" rx=".5" />
            </svg>
          </button>
          <button
            data-tour="background"
            className="window-close"
            aria-label="Close window"
            onClick={() => setModal("close")}
          >
            <svg viewBox="0 0 16 16">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <Tabs.Root
        value={tab}
        onValueChange={setTab}
        orientation="vertical"
        className="app-shell"
      >
        <header className="app-header">
          <div className="brand">
            <span
              className="brand-mark"
              style={{ maskImage: `url(${logo})` }}
              aria-hidden="true"
            />
            <span>
              sector<span className="brand-period">.</span>
            </span>
          </div>
          <Tabs.List className="tabs" aria-label="Features">
            <Tabs.Tab value="home">
              <Glyph icon={home} />
              Home
            </Tabs.Tab>
            <Tabs.Tab value="reset">
              <Glyph icon={restart} />
              Active Reset
            </Tabs.Tab>
            <Tabs.Tab value="overlay" data-tour="overlay">
              <Glyph icon={layers} />
              Overlay
            </Tabs.Tab>
            <Tabs.Indicator className="tab-indicator" />
          </Tabs.List>
        </header>
        <main className="scroll-area">
          <Tabs.Panel value="home" className="page home-page">
            <Home
              game={game}
              view={view}
              status={status}
              saveKey={key("save_key")}
              restoreKey={key("restore_key")}
              disabled={!settings || pending || quitting}
              resetUnavailable={eacBlocked}
              onNavigate={setTab}
            />
          </Tabs.Panel>
          <Tabs.Panel value="reset" className="page reset-page">
            <div className="page-heading reset-heading">
              <div>
                <div className="page-kicker">02 / Practice tools</div>
                <h1>Active Reset</h1>
              </div>
              <ResetLaunch
                game={game}
                preview={preview}
                disabled={!settings || pending || quitting}
              />
            </div>
            {eacBlocked && (
              <section className="reset-blocked" role="alert">
                <Glyph icon={close} />
                <div>
                  <h2>Active Reset unavailable: Easy Anti-Cheat is active</h2>
                  <p>
                    LMU was detected with EAC active. Save, Restore and their
                    shortcuts ({key("save_key")} / {key("restore_key")}) are
                    disabled.
                  </p>
                  <p>
                    Close LMU, choose <strong>Open LMU without EAC</strong>,
                    then enter Offline Practice. Overlays remain available.
                  </p>
                </div>
              </section>
            )}
            <section
              className={`checkpoint ${view.saved ? "is-saved" : ""}`}
              data-tour="checkpoint"
              aria-label="Checkpoint"
            >
              <div className="checkpoint-main">
                <div className="card-top">
                  <span className="eyebrow">Your checkpoint</span>
                  <span className="checkpoint-label">
                    <Glyph icon={view.saved ? check : save} />
                    {view.saved ? "Saved" : "Empty"}
                  </span>
                </div>
                <h2 className="checkpoint-title">
                  {view.saved ? "Checkpoint ready" : "No checkpoint"}
                </h2>
                <p className="checkpoint-help">
                  {eacBlocked ? (
                    <>Close LMU and reopen it without EAC to use checkpoints.</>
                  ) : view.saved ? (
                    <>
                      Return to this moment with <kbd>{key("restore_key")}</kbd>
                    </>
                  ) : (
                    <>
                      Press <kbd>{key("save_key")}</kbd> in LMU to save a
                      checkpoint.
                    </>
                  )}
                </p>
              </div>
              <aside className="checkpoint-side" aria-label="Reset readiness">
                <ol className="readiness-steps">
                  {[
                    ["LMU detected", gameDetected],
                    [
                      "Driving offline",
                      status.phase === "active" && !eacBlocked,
                    ],
                    ["Checkpoint saved", view.saved],
                  ].map(([label, done], index) => (
                    <li key={label} data-done={Boolean(done)}>
                      <span>{done ? <Glyph icon={check} /> : index + 1}</span>
                      {label}
                    </li>
                  ))}
                </ol>
                <div className="checkpoint-count">
                  <span className="eyebrow">Checkpoint restores</span>
                  <strong>{view.count}</strong>
                </div>
              </aside>
            </section>
            <ResetLog
              entries={resetLog}
              onExport={() => {
                setExportState("");
                setModal("diagnostics");
              }}
            />
            <div className="settings-grid">
              <section
                data-tour="shortcuts"
                className="settings-section"
                aria-labelledby="shortcuts-title"
              >
                <div className="section-heading">
                  <h2 id="shortcuts-title">Keyboard shortcuts</h2>
                </div>
                <div className="setting-row">
                  <span className="action-icon">
                    <Glyph icon={save} />
                  </span>
                  <div className="setting-label">
                    <h3>Save checkpoint</h3>
                  </div>
                  <button
                    className="key-button"
                    aria-label={`Change save shortcut, ${key("save_key")}`}
                    disabled={!settings || pending || quitting}
                    onClick={() => openCapture("save_key")}
                  >
                    <kbd>{key("save_key")}</kbd>
                    <Glyph icon={pen} />
                  </button>
                </div>
                <div className="setting-row">
                  <span className="action-icon">
                    <Glyph icon={restart} />
                  </span>
                  <div className="setting-label">
                    <h3>Restore checkpoint</h3>
                  </div>
                  <button
                    className="key-button"
                    aria-label={`Change restore shortcut, ${key("restore_key")}`}
                    disabled={!settings || pending || quitting}
                    onClick={() => openCapture("restore_key")}
                  >
                    <kbd>{key("restore_key")}</kbd>
                    <Glyph icon={pen} />
                  </button>
                </div>
              </section>
              <AudioFeedback
                settings={settings}
                pending={pending || quitting}
                updateSettings={updateSettings}
                sound={sound}
              />
            </div>
          </Tabs.Panel>
          <Tabs.Panel value="overlay" className="page overlay-page">
            <OverlayEditor />
          </Tabs.Panel>
          {error && (
            <div className="error-banner" role="alert">
              <Glyph icon={close} />
              <span>{error}</span>
              {error.includes("Restore defaults") && (
                <button
                  onClick={() =>
                    updateSettings({
                      save_key: "F6",
                      restore_key: "F7",
                      sound: true,
                    })
                  }
                >
                  Restore defaults
                </button>
              )}
            </div>
          )}
        </main>
      </Tabs.Root>
      {onboarding?.required && (
        <Onboarding
          open={!modal && !quitting}
          initialFolder={onboarding.folder}
          onFinish={(tutorial) => {
            setOnboarding({ required: false });
            if (tutorial) startGuide();
          }}
        />
      )}
      {tour && (
        <GuidedTour
          saveKey={key("save_key")}
          restoreKey={key("restore_key")}
          onTabChange={setTab}
          onFinish={() => {
            setTour(false);
            setTab(tourStartTab.current);
            requestAnimationFrame(() =>
              document.querySelector(".guide-menu-trigger")?.focus(),
            );
          }}
        />
      )}
      <Dialog.Root
        open={modal !== null}
        onOpenChangeComplete={(open) => {
          if (!open && backgroundAfterClose.current) {
            backgroundAfterClose.current = false;
            void api.background();
          }
        }}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="modal-backdrop" />
          <Dialog.Viewport className="modal-viewport">
            <Dialog.Popup
              className={`modal${shownModal === "changelog" ? " changelog-modal" : shownModal === "settings" ? " settings-modal" : ""}`}
              ref={modalRef}
              initialFocus={modalRef}
            >
              {["settings", "changelog"].includes(shownModal) ? (
                <div className="page-kicker">
                  {shownModal === "settings"
                    ? "Edit / Settings"
                    : "Help / Changelog"}
                </div>
              ) : (
                <div className="modal-icon">
                  <Glyph
                    icon={
                      shownModal === "diagnostics"
                        ? save
                        : shownModal === "changelog"
                          ? history
                          : shownModal === "settings"
                            ? gear
                            : shownModal === "close"
                              ? monitor
                              : keyboard
                    }
                  />
                </div>
              )}
              <Dialog.Title>
                {shownModal === "diagnostics"
                  ? "Export diagnostics"
                  : shownModal === "changelog"
                    ? "Changelog"
                    : shownModal === "settings"
                      ? "Settings"
                      : shownModal === "close"
                        ? "Keep Sector running?"
                        : shownModal === "save_key"
                          ? "Set save shortcut"
                          : "Set restore shortcut"}
              </Dialog.Title>
              <Dialog.Description
                className={
                  ["settings", "changelog"].includes(shownModal)
                    ? "sr-only"
                    : undefined
                }
              >
                {shownModal === "diagnostics"
                  ? "Save a diagnostic file to share with support. It includes recent text logs, app and graphics versions, and the current car and track. Nothing is uploaded automatically."
                  : shownModal === "changelog"
                    ? "Changes in each Sector update."
                    : shownModal === "settings"
                      ? "Appearance and overlay display preferences."
                      : shownModal === "close"
                        ? "Keep your shortcuts active in the background, or quit Sector."
                        : captureHint}
              </Dialog.Description>
              {shownModal === "diagnostics" ? (
                <>
                  <p role="status">{exportState}</p>
                  <div className="onboarding-actions">
                    <Dialog.Close className="secondary">Close</Dialog.Close>
                    <button
                      className="primary"
                      disabled={pending}
                      onClick={async () => {
                        setPending(true);
                        setExportState("");
                        try {
                          const result = await api.exportDiagnostics();
                          if (!result.canceled)
                            setExportState(
                              result.ok
                                ? "Diagnostics saved. Attach the file to your bug report."
                                : result.error,
                            );
                        } catch {
                          setExportState("Export failed. Please try again.");
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      Save diagnostic file
                    </button>
                  </div>
                </>
              ) : shownModal === "changelog" ? (
                <>
                  <Changelog />
                  <Dialog.Close className="secondary settings-done">
                    Done
                  </Dialog.Close>
                </>
              ) : shownModal === "settings" ? (
                <>
                  <Preferences
                    settings={settings}
                    pending={pending}
                    updateSettings={updateSettings}
                  />
                  <Dialog.Close className="secondary settings-done">
                    Done
                  </Dialog.Close>
                </>
              ) : shownModal === "close" ? (
                <div className="close-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      // Finish the exit animation before Chromium hides the window.
                      backgroundAfterClose.current = true;
                      setModal(null);
                    }}
                  >
                    <Glyph icon={layers} />
                    <span>Run in background</span>
                    <Glyph icon={arrow} />
                  </button>
                  <button className="text-button quit-button" onClick={exit}>
                    <Glyph icon={close} />
                    <span>Quit Sector</span>
                  </button>
                  <Dialog.Close className="text-button">Cancel</Dialog.Close>
                </div>
              ) : (
                <>
                  <div className="capture-key" aria-hidden="true">
                    <Glyph icon={keyboard} />
                    <span>
                      {wheelCapturing
                        ? "PRESS A WHEEL BUTTON"
                        : "KEY OR WHEEL BUTTON"}
                    </span>
                  </div>
                  <div className="capture-actions">
                    <button
                      className="primary"
                      disabled={pending || wheelCapturing}
                      onClick={bindWheel}
                    >
                      {wheelCapturing ? "Listening…" : "Bind wheel button"}
                    </button>
                    <button
                      className="text-button"
                      disabled={pending || wheelCapturing}
                      onClick={async () => {
                        if (
                          await updateSettings({
                            ...settings,
                            [shownModal]: "Tab",
                          })
                        )
                          setModal(null);
                      }}
                    >
                      Use Tab
                    </button>
                    <Dialog.Close className="secondary">Cancel</Dialog.Close>
                  </div>
                </>
              )}
              {error && (
                <p className="modal-error" role="alert">
                  {error}
                </p>
              )}
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
      {quitting && (
        <div className="shutdown" role="status">
          {status.phase === "error"
            ? status.message
            : "Finishing the current operation…"}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
