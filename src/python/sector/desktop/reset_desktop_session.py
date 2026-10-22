"""Atomic desktop status, explicit reset requests and cooperative shutdown.

Desktop requests never grant native admission and use the hotkey preparation gates.
"""

import json
import math
from pathlib import Path
import time


class DesktopSession:
    def __init__(self, directory, clock=time.time, settings_file=None, require_lease=False, pid=None):
        self.directory = Path(directory) if directory else None
        self.clock = clock
        self.require_lease = require_lease
        self.pid = pid
        self.settings_file = Path(settings_file) if settings_file else None
        self.state = {
            "schema_version": 1,
            "phase": "waiting",
            "checkpoint": False,
            "clean_shutdown": False,
            "saved_speed_kmh": None,
            "saved_at": None,
            "restore_count": 0,
            "reset_action": 0,
            "message": "",
            "sequence": 0,
        }
        self.dirty = False
        self.request = None
        self.request_native_id = None
        self.seen_requests = set()
        if self.directory:
            self.directory.mkdir(parents=True, exist_ok=True)

    def stopped(self):
        if not self.directory:
            return False
        if (self.directory / "stop").exists():
            return True
        try:
            if self.require_lease:
                lease = json.loads((self.directory / "heartbeat").read_text(encoding="utf-8"))
                now = self.clock() * 1000
                expiry = lease.get("expires_at_ms")
                identity = lease.get("identity")
                return not (
                    lease.get("schema") == 1 and type(lease.get("pid")) is int
                    and lease["pid"] == self.pid and isinstance(identity, str)
                    and identity.startswith(f"{self.pid}:")
                    and type(expiry) in (int, float) and math.isfinite(expiry)
                    and 0 < expiry - now <= 2500
                )
            age = self.clock() - (self.directory / "heartbeat").stat().st_mtime
            return age > 10 or age < -10
        except (OSError, ValueError, TypeError, AttributeError):
            return True

    def process_matches(self, handle):
        if not self.require_lease:
            return True
        if self.stopped():
            return False
        try:
            import ctypes as C
            from ctypes import wintypes as W
            lease = json.loads((self.directory / "heartbeat").read_text(encoding="utf-8"))
            times = [W.FILETIME() for _ in range(4)]
            api = C.WinDLL("kernel32", use_last_error=True).GetProcessTimes
            api.argtypes = [W.HANDLE] + [C.POINTER(W.FILETIME)] * 4
            api.restype = W.BOOL
            if not api(handle, *(C.byref(value) for value in times)):
                return False
            ticks = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
            # .NET DateTime ticks begin in year 1; FILETIME ticks begin in 1601.
            return lease["identity"] == f"{self.pid}:{ticks + 504911232000000000}"
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def publish(self, **changes):
        if (
            changes.get("phase", self.state["phase"]) != "active"
            or changes.get("last_event") == "rejected"
        ):
            changes["reset_action"] = 0
        if changes.get("checkpoint") is False:
            changes.update(saved_speed_kmh=None, saved_at=None, restore_count=0)
        if not self.dirty and all(self.state.get(k) == v for k, v in changes.items()):
            return
        self.state.update(changes)
        self.state["sequence"] += 1
        if not self.directory:
            return
        temporary = self.directory / "status.tmp"
        try:
            temporary.write_text(
                json.dumps(self.state, ensure_ascii=True, allow_nan=False), encoding="utf-8"
            )
            temporary.replace(self.directory / "status.json")
            self.dirty = False
        except OSError:
            # Desktop status must never prevent the runner's native cleanup.
            # Keep the old snapshot and retry on the next publish.
            self.dirty = True

    def take_request(self, idle):
        if not self.directory:
            return None
        path = self.directory / "command.json"
        try:
            request = json.loads(path.read_text(encoding="utf-8"))
            path.unlink()
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            return None
        if not isinstance(request, dict) or not isinstance(request.get("id"), str):
            return None
        request_id = request["id"]
        if request_id in self.seen_requests:
            return None
        self.seen_requests.add(request_id)
        stamp = request.get("created_at_ms")
        valid = (
            request.get("schema_version") == 1
            and request.get("action") in ("save", "restore")
            and request.get("host") == self.state.get("log_prefix")
            and self.state.get("phase") == "active"
            and type(stamp) in (int, float)
            and math.isfinite(stamp)
            and 0 <= self.clock() * 1000 - stamp <= 2000
            and idle
            and not self.request
            and not self.stopped()
        )
        if not valid:
            self.publish(
                desktop_request={
                    "id": request_id,
                    "ok": False,
                    "error": "Reset request expired or the session is not ready.",
                }
            )
            return None
        self.request = request
        self.request_native_id = None
        return request["action"]

    def finish_request(self, ok=False, error="Reset canceled because the session is not ready."):
        if self.request:
            result = {"id": self.request["id"], "ok": ok}
            if not ok:
                result["error"] = error
            self.request = None
            self.request_native_id = None
            self.publish(desktop_request=result)

    def command(self, action, request_id=None):
        if self.request:
            self.request_native_id = request_id
        if action == 1:
            self.publish(message="Saving checkpointâ€¦", reset_action=1)
        elif action == 2:
            self.publish(message="Preparing restoreâ€¦", reset_action=2)
        elif action == 3:
            self.publish(message="Restoring checkpointâ€¦", reset_action=3)

    def settings(self):
        from sector.runtime.physical_reset_hotkeys import input_binding

        if not self.settings_file:
            return None
        try:
            settings = json.loads(self.settings_file.read_text(encoding="utf-8-sig"))
            save, restore = settings["save_key"], settings["restore_key"]
            if input_binding(save) == input_binding(restore) or type(settings["sound"]) is not bool:
                return None
            return save.upper(), restore.upper(), settings["sound"]
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            return None

    def report(self, row):
        from sector.desktop.reset_feedback import report_feedback

        feedback = report_feedback(row)
        changes = {}
        if row["result"] != 0 or row["action"] in (1, 3):
            changes["reset_action"] = 0
        if row["action"] == 1 and row["result"] == 0:
            speed = row.get("speed")
            speed_kmh = (
                speed * 3.6
                if type(speed) in (float, int) and math.isfinite(speed) and speed >= 0
                else None
            )
            changes.update(
                checkpoint=True, saved_speed_kmh=speed_kmh, saved_at=self.clock(), restore_count=0
            )
        elif row["action"] == 3 and row["result"] == 0:
            changes["restore_count"] = self.state["restore_count"] + 1
        if feedback:
            changes.update(message=feedback[1], last_event=feedback[0], report_id=row["id"])
        if changes:
            self.publish(**changes)
        if self.request and row["id"] == self.request_native_id:
            if row["result"] != 0:
                self.finish_request(
                    error=feedback[1] if feedback else "Reset rejected by the native host."
                )
            elif row["action"] in (1, 3):
                self.finish_request(ok=True)
