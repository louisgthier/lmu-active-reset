import React, { useRef, useState } from "react";
import "./reset-launch.css";

export function ResetLaunch({ game, preview, disabled }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const safety = game.safety || {};
  async function action(method) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.sector[method]();
      if (!result.ok && !result.canceled) setError(result.error);
    } catch (failure) {
      setError(failure.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const blocked = disabled || preview || busy;
  return (
    <div className="reset-launch" data-tour="launch">
      <button
        className="reset-launch-button"
        disabled={
          blocked ||
          game.running ||
          game.launching ||
          safety.restartRequired ||
          Boolean(safety.error)
        }
        onClick={() => action("launchGame")}
      >
        {game.launching
          ? "Opening LMU..."
          : "Start offline session without EAC"}
      </button>
      <button
        className="reset-launch-button"
        disabled={blocked || safety.enabled || !safety.canEnable}
        onClick={() => action("enableReset")}
      >
        {safety.canRearm ? "Reactivate Active Reset" : "Enable Active Reset"}
      </button>
      <button
        className="reset-launch-button"
        disabled={blocked || !safety.enabled}
        onClick={() => action("disableReset")}
      >
        Disable Active Reset
      </button>
      <button
        className="reset-launch-button"
        disabled={blocked || Boolean(safety.error)}
        onClick={() => action("restartOnline")}
      >
        Restart LMU through Steam
      </button>
      <p role="status">
        {safety.canRearm
          ? "Previous host stopped cleanly. Enter Offline Practice, enable Active Reset again and save a new checkpoint. Close LMU before online play."
          : safety.restartRequired
            ? "This LMU process may contain the reset host. Close it before online play. Saved game data is not rolled back."
            : safety.enabled
              ? "Active Reset enabled for this offline session only."
              : "Active Reset is disabled. Start a fresh offline session here, enter Offline Practice, then enable it explicitly."}
      </p>
      {(error || game.error || safety.error) && (
        <p role="alert">{error || game.error || safety.error}</p>
      )}
    </div>
  );
}
