import unittest
from sector.runtime.wheel_buttons import CaptureEdges, binding_down, wheel_binding
from sector.runtime.physical_reset_hotkeys import HotkeyCommands, input_binding

DEVICE = "0123456789ABCDEF0123456789ABCDEF"
OTHER = "FEDCBA9876543210FEDCBA9876543210"


class WheelButtonsTest(unittest.TestCase):
    def test_binding_limits_and_canonical_identity(self):
        self.assertEqual(input_binding(f"wheel:{DEVICE.lower()}:128"), (DEVICE, 128))
        self.assertEqual(input_binding("f6"), 0x75)
        for value in [f"WHEEL:{DEVICE}:0", f"WHEEL:{DEVICE}:129", f"WHEEL:{DEVICE}:01",
                      f"WHEEL:{DEVICE}:1\n", "WHEEL:unknown:1", None, 42]:
            self.assertIsNone(wheel_binding(value))
            with self.assertRaises(ValueError):
                input_binding(value)

    def test_capture_requires_neutral_and_rejects_chords(self):
        capture = CaptureEdges()
        self.assertIsNone(capture.poll({DEVICE: {128}}))
        self.assertIsNone(capture.poll({DEVICE: set()}))
        self.assertIsNone(capture.poll({DEVICE: {1, 128}}))
        self.assertIsNone(capture.poll({DEVICE: {128}}))
        capture.poll({DEVICE: set()})
        self.assertEqual(capture.poll({DEVICE: {128}}), f"WHEEL:{DEVICE}:128")
        self.assertIsNone(capture.poll({DEVICE: {128}}))

    def test_device_loss_and_reconnection_require_release(self):
        capture = CaptureEdges()
        capture.poll({DEVICE: set()})
        capture.poll({DEVICE: None})
        self.assertIsNone(capture.poll({DEVICE: {1}}))
        capture.poll({DEVICE: set()})
        capture.poll({})
        self.assertIsNone(capture.poll({DEVICE: {1}}))
        self.assertIsNone(binding_down((DEVICE, 1), {OTHER: {1}}))
        self.assertIsNone(binding_down((DEVICE, 1), {DEVICE: None}))
        self.assertTrue(binding_down((DEVICE, 128), {DEVICE: {128}}))
        self.assertFalse(binding_down((DEVICE, 128), {DEVICE: {1}}))

    def test_simultaneous_devices_are_not_guessed(self):
        capture = CaptureEdges()
        capture.poll({DEVICE: set(), OTHER: set()})
        self.assertIsNone(capture.poll({DEVICE: {1}, OTHER: {2}}))
        self.assertIsNone(capture.poll({DEVICE: {1}, OTHER: set()}))
        capture.poll({DEVICE: set(), OTHER: set()})
        self.assertEqual(capture.poll({DEVICE: {1}, OTHER: set()}), f"WHEEL:{DEVICE}:1")

    def test_wheel_edges_keep_focus_and_context_gates(self):
        commands = HotkeyCommands()
        poll = lambda focus, allow, save=False: commands.poll(focus, allow, save, False, False, 1)
        poll(True, True)
        self.assertEqual(poll(False, True, True), {})
        self.assertEqual(poll(True, True, True), {})
        poll(True, True)
        self.assertEqual(poll(True, False, True), {})
        self.assertEqual(poll(True, True, True), {})
        poll(True, True)
        self.assertEqual(poll(True, True, True)["action"], 1)


class WheelInputIntegrationTest(unittest.TestCase):
    def keys(self, snapshot):
        import ctypes
        from ctypes import wintypes
        from sector.runtime.physical_reset_hotkeys import WindowsKeys

        class User:
            def GetForegroundWindow(self):
                return 42

            def GetWindowThreadProcessId(self, handle, pointer):
                pointer._obj.value = 100

            def GetAsyncKeyState(self, key):
                return 0x8000 if key == 0x75 else 0

        class Reader:
            def snapshot(self):
                return snapshot

        keys = WindowsKeys.__new__(WindowsKeys)
        keys.c, keys.w, keys.user = ctypes, wintypes, User()
        keys.pid, keys.save_vk, keys.restore_vk = 100, (DEVICE, 128), 0x75
        keys.wheel = Reader()
        return keys

    def test_mixed_keyboard_and_wheel_input(self):
        self.assertEqual(self.keys({DEVICE: {128}}).read(), (True, True, True, False))
        self.assertEqual(self.keys({DEVICE: set()}).read(), (True, False, True, False))

    def test_missing_or_failed_wheel_revokes_focus_eligibility(self):
        self.assertFalse(self.keys({}).read()[0])
        self.assertFalse(self.keys({DEVICE: None}).read()[0])
        self.assertFalse(self.keys({OTHER: {128}}).read()[0])

    def test_desktop_persisted_wheel_settings_reach_worker(self):
        import json
        import tempfile
        from pathlib import Path
        from sector.desktop.reset_desktop_session import DesktopSession

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text(json.dumps({"save_key": f"wheel:{DEVICE.lower()}:128",
                "restore_key": "f7", "sound": False}), encoding="utf-8")
            session = DesktopSession(None, settings_file=path)
            self.assertEqual(session.settings(), (f"WHEEL:{DEVICE}:128", "F7", False))
            path.write_text(json.dumps({"save_key": f"WHEEL:{DEVICE}:128",
                "restore_key": f"wheel:{DEVICE.lower()}:128", "sound": False}), encoding="utf-8")
            self.assertIsNone(session.settings())


if __name__ == "__main__":
    unittest.main()
