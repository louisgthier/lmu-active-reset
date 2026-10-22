"""Wait for driving and supervise a checkpoint host without a session time limit."""

import argparse
from pathlib import Path
import time
from urllib.error import URLError
from sector.runtime.resident_identity import HOST_REVISION


def get_json(path):
    from sector.telemetry.capture_context import get_json as fetch

    return fetch(path)


def driving_ready(state, game):
    return (
        state.get("appBuild") == 14200
        and state.get("settingMode") == "SETTING_GRANDPRIX"
        and state.get("gameSession") in ("PRACTICE1", "PRACTICE2", "PRACTICE3", "PRACTICE4")
        and game.get("inControlOfVehicle") is True
        and game.get("inMonitor") is False
        and game.get("playerVehicleLoaded") is True
        and game.get("isReplayActive") is False
        # LMU retains vehicle control while paused, but no physics callbacks
        # run then. Wait before loading a host whose owner discovery is bounded.
        and game.get("MultiStintState") == "DRIVING"
    )


def wait_for_driving(stop_requested=lambda: False, stable_samples=1):
    print("Waiting for driving in offline Practiceâ€¦", flush=True)
    consecutive = 0
    while not stop_requested():
        try:
            state = get_json("/navigation/state")["state"]
            game = get_json("/rest/sessions/GetGameState")
            consecutive = consecutive + 1 if driving_ready(state, game) else 0
            if consecutive >= stable_samples:
                return True
        except (TimeoutError, URLError, ConnectionError):
            consecutive = 0
        time.sleep(0.5)
    return False


def supervise(args, run_host, audit_host, alive, wait=wait_for_driving, sleep=time.sleep):
    """A clean stop may offer explicit reactivation; never automatically re-admit."""

    def stopped():
        return args.desktop.stopped() or not alive()

    args.owner_thread = 0
    args.revision = HOST_REVISION
    args.hotkeys = True
    args.request_file = Path("work/unused-hotkey-command.json")
    while not stopped():
        args.desktop.publish(phase="waiting", checkpoint=False, readiness="Waiting for driving")
        if not wait(stopped, stable_samples=2):
            break
        args.desktop.publish(phase="starting", message="Connecting to LMUâ€¦")
        for attempt in range(20):
            if stopped():
                return
            try:
                audit_host(args.pid)
                break
            except ValueError as error:
                if str(error) != "Snapshot module not cleanly stopped" or attempt == 19:
                    raise
                sleep(0.2)
        if stopped():
            break
        outcome = run_host(args)
        if stopped() or outcome == "user_stopped":
            break
        if outcome not in ("vehicle_reset", "context_changed"):
            raise RuntimeError("Connection stopped unexpectedly. Close LMU before reconnecting.")
        args.desktop.publish(checkpoint=False, message="Session changed. Enter Offline Practice and explicitly enable Active Reset again. Save a new checkpoint.")
        return


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--save-key", default="F6")
    parser.add_argument("--restore-key", default="F7")
    parser.add_argument("--mute", action="store_true")
    parser.add_argument("--gui-session", type=Path)
    parser.add_argument("--settings-file", type=Path)
    parser.add_argument("--offline-launch-confirmed", action="store_true")
    parser.add_argument("--allow-writes", action="store_true")
    args = parser.parse_args()
    if not args.gui_session or not args.offline_launch_confirmed or not args.allow_writes:
        parser.error("Offline launch confirmation and write opt-in required")
    from sector.desktop.reset_desktop_session import DesktopSession
    from sector.runtime.physical_reset_hotkeys import input_binding

    args.desktop = DesktopSession(args.gui_session, settings_file=args.settings_file, require_lease=True, pid=args.pid)
    handle = None
    try:
        if input_binding(args.save_key) == input_binding(args.restore_key):
            raise ValueError("Choose different keys for save and restore.")
        from sector.observers.audit_snapshot_25661166 import audit
        from sector.runtime.reset_host_runner import run, process_exit_code, k

        handle = k.OpenProcess(0x1000, False, args.pid)
        if not handle:
            raise OSError("LMU process is unavailable.")
        supervise(args, run, audit, lambda: process_exit_code(handle) is None)
        args.desktop.publish(phase="stopped", checkpoint=False, message="Disconnected.")
    except KeyboardInterrupt:
        args.desktop.publish(phase="stopped", checkpoint=False, message="Disconnected.")
    except Exception as error:
        args.desktop.publish(
            phase="error",
            checkpoint=False,
            message=str(error),
            blocked_reason="eac" if str(error) == "EAC module present" else None,
        )
        raise
    finally:
        if handle:
            k.CloseHandle(handle)


if __name__ == "__main__":
    main()
