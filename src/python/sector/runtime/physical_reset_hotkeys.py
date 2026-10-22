"""Focused key edges and acknowledged prepare/restore sequencing."""

from sector.runtime.resident_identity import HOST_REVISION


def expected_restore_fields(revision):
    """Legacy counts; v17 validates each vehicle's complete plan in native code."""
    if 17 <= revision <= HOST_REVISION:
        return None
    if revision == 16:
        return 10085
    if revision == 15:
        return 10084
    if 1 <= revision <= 14:
        return 10077
    raise ValueError(f"Unsupported reset host revision: {revision}")


def rejection_reason(report):
    cause = report.get("cause")
    if cause == 92004 and report.get("bodywork_check_name"):
        return (
            f"Bodywork layout rejected: {report['bodywork_check_name']} "
            f"(component {report.get('bodywork_component_index', 0)}, "
            f"mesh {report.get('bodywork_mesh_index', 0)}). "
            "Use Help > Export diagnostics to share the log."
        )
    bodywork_reasons = {
        92003: "Bodywork is being updated. Wait for the impact or loading to finish and retry.",
        92004: "Bodywork buffers are not ready or have an unsupported layout.",
        92005: "This vehicle uses a graphics buffer that this reset version cannot restore.",
        92006: "Bodywork is damaged. Save a new checkpoint with a repaired car.",
        92007: "The bodywork was rebuilt. Save a new checkpoint before restoring.",
        92010: "Bodywork recovery failed. Restart LMU before using Active Reset again.",
    }
    if cause in bodywork_reasons:
        return bodywork_reasons[cause]
    capture_reasons = {
        93001: "Save rejected: the vehicle identity changed.",
        93002: "Save rejected: the physics synchronization was lost.",
        93003: "Save rejected: the physical state could not be read consistently.",
        93004: "Save rejected: the aerodynamic state is inconsistent.",
        93005: "Save rejected: aerodynamic damage is still present. Repair the car before saving.",
        93006: "Save rejected: the wheel deformation state is inconsistent.",
        93007: "Save rejected: the suspension alignment state is invalid.",
        93008: "Save rejected: the physical checkpoint failed validation.",
        93009: "Save rejected: the tire contact samples were stale or did not match the vehicle.",
        93010: "Save rejected: the tire contact geometry failed validation.",
        93011: "Save rejected: the lap sector is unavailable or outside its supported range.",
        93012: "Save rejected: the collision state is invalid.",
        93013: "Save rejected: the tire model or puncture tables could not be validated.",
        93014: "Save rejected: a tire is punctured. Repair it before saving a checkpoint.",
        93015: "Restore rejected: detached suspension does not match the saved attachment state.",
        93016: "Restore rejected: detached component registries could not be validated.",
    }
    if cause in capture_reasons:
        reason = capture_reasons[cause]
        if report.get("action") in (2, 3):
            reason = reason.replace("Save rejected:", "Restore rejected:", 1)
        return (
            f"{reason} Code {cause}. "
            "Use Help > Export diagnostics to share the log."
        )
    if cause in (91001, 91002, 91003, 91004):
        wheel = ("Front-left", "Front-right", "Rear-left", "Rear-right")[cause - 91001]
        return f"{wheel} wheel detached. This reset version cannot rebuild detached suspension."
    return None


def preparation_ready(report, expected_fields=None):
    if report.get("action") != 2 or report.get("result") != 0:
        return False
    count = report.get("fields")
    if expected_fields is not None:
        return count == expected_fields
    # Count varies with body/constraint topology and engine channels. The pinned
    # native host validates the entire typed plan and read-only preflight first.
    return (
        type(count) is int
        and 4 <= count <= 16384
        and report.get("verified_fields") == count
        and report.get("mismatched_fields") == 0
        and report.get("readable") == 1
        and type(report.get("epoch")) is int
        and report["epoch"] > 0
    )


class HotkeyCommands:
    def __init__(self, expected_fields=None):
        self.expected_fields = expected_fields
        self.armed = False
        self.saved = False
        self.pending = None
        self.next_id = 0
        self.notice = None
        self.desktop_pending = False

    def rebind(self):
        """Require a fresh release without discarding an existing checkpoint."""
        if self.pending:
            return False
        self.armed = False
        return True

    def issue(self, action, now):
        self.next_id += 1
        self.pending = (self.next_id, action, now)
        return {"id": self.next_id, "action": action}

    def poll(
        self, focused, allowed, save, restore, modifiers, now, report=None, desktop_action=None
    ):
        self.notice = None
        if not self.pending:
            self.desktop_pending = False
        keyboard_eligible = focused and allowed and not modifiers
        eligible = allowed and (keyboard_eligible or self.desktop_pending)
        edge = 0
        if not keyboard_eligible or self.desktop_pending or (save and restore):
            self.armed = False
        elif not save and not restore:
            self.armed = True
        elif self.armed:
            self.armed = False
            edge = 1 if save else 2

        if self.pending:
            request_id, action, issued = self.pending
            # A save acknowledgement remains valid if focus moved meanwhile.
            if report and report["id"] == request_id and action == 1:
                self.pending = None
                self.saved = self.saved or report["result"] == 0
                return {}
            # Keyboard preparation requires focus; all sources require context
            # and a timely acknowledgement before any restore can be issued.
            if not eligible or now - issued > 2:
                self.pending = None
                return {}
            if report and report["id"] == request_id:
                self.pending = None
                if action == 1:
                    self.saved = self.saved or report["result"] == 0
                elif action == 2:
                    if preparation_ready(report, self.expected_fields):
                        return self.issue(3, now)
                    self.notice = rejection_reason(report) or (
                        "Restore preparation rejected: "
                        f"result {report.get('result')}, cause {report.get('cause')}, "
                        f"fields {report.get('fields')} "
                        "(complete native preflight required)."
                    )
            return {}
        # A validated desktop click has its own intent; game focus is only needed
        # for keyboard edges. Both sources share native IDs and preparation gates.
        if desktop_action in ("save", "restore") and allowed:
            self.desktop_pending = True
            self.armed = False
            edge = 1 if desktop_action == "save" else 2
        if edge == 1:
            return self.issue(1, now)
        if edge == 2 and self.saved:
            return self.issue(2, now)
        if edge == 2:
            self.notice = "Save a checkpoint before restoring."
        return {}


class WindowsKeys:
    def __init__(self, pid, save_vk, restore_vk):
        import ctypes as c
        from ctypes import wintypes as w

        self.c, self.w = c, w
        self.pid, self.save_vk, self.restore_vk = pid, save_vk, restore_vk
        self.user = c.WinDLL("user32", use_last_error=True)
        self.user.GetForegroundWindow.restype = w.HWND
        self.user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
        self.user.GetAsyncKeyState.argtypes = [c.c_int]
        self.user.GetAsyncKeyState.restype = c.c_short

    def read(self):
        pid = self.w.DWORD()
        self.user.GetWindowThreadProcessId(self.user.GetForegroundWindow(), self.c.byref(pid))

        from sector.runtime.wheel_buttons import DirectInputButtons, binding_down

        snapshot = {}
        valid = True
        if any(isinstance(binding, tuple) for binding in (self.save_vk, self.restore_vk)):
            try:
                if not getattr(self, "wheel", None):
                    self.wheel = DirectInputButtons()
                snapshot = self.wheel.snapshot()
            except (OSError, ValueError):
                valid = False

        def down(vk):
            nonlocal valid
            if isinstance(vk, tuple):
                value = binding_down(vk, snapshot)
                valid = valid and value is not None
                return bool(value)
            return bool(self.user.GetAsyncKeyState(vk) & 0x8000)

        save, restore = down(self.save_vk), down(self.restore_vk)
        return (
            pid.value == self.pid and valid,
            save,
            restore,
            any(down(vk) for vk in (0x10, 0x11, 0x12, 0x5B, 0x5C)),
        )


def virtual_key(name):
    """Resolve persisted key names through the same map used by the desktop."""
    from sector.desktop.reset_keymap import KEY_CODES

    if not isinstance(name, str) or name.upper() not in KEY_CODES:
        raise ValueError("Choose a supported single keyboard key")
    return KEY_CODES[name.upper()]


def input_binding(name):
    """Resolve a keyboard key or a device-specific wheel button."""
    from sector.runtime.wheel_buttons import wheel_binding

    return wheel_binding(name) or virtual_key(name)
