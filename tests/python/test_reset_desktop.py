import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import wave

from sector.runtime.physical_reset_hotkeys import HotkeyCommands
from sector.runtime.resident_identity import HOST_REVISION
from sector.desktop.reset_desktop_session import DesktopSession
from sector.desktop.reset_feedback import Feedback, report_feedback, write_sounds
from sector.runtime.start_reset_hotkeys import supervise


class DesktopTests(unittest.TestCase):
    def test_overlay_restore_action_is_structured_and_cleared_on_completion_or_pause(self):
        self.session.publish(phase="active")
        self.session.command(2, 1)
        self.assertEqual(self.session.state["reset_action"], 2)
        self.session.report(dict(id=1, action=2, result=0))
        self.assertEqual(self.session.state["reset_action"], 2)
        self.session.command(3, 2)
        self.assertEqual(self.session.state["reset_action"], 3)
        self.session.report(dict(id=2, action=3, result=0))
        self.assertEqual(self.session.state["reset_action"], 0)
        self.session.command(2, 3)
        self.session.report(dict(id=3, action=2, result=9, cause=3))
        self.assertEqual(self.session.state["reset_action"], 0)
        self.session.command(2, 4)
        self.session.publish(phase="paused")
        self.assertEqual(self.session.state["reset_action"], 0)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.session = DesktopSession(self.path, clock=lambda: 1000)
        (self.path / "heartbeat").touch()
        os.utime(self.path / "heartbeat", (1000, 1000))

    def click(self, name, **patch):
        command = dict(
            schema_version=1, id=name, action=name, host="fixture", created_at_ms=1000000
        )
        command.update(patch)
        (self.path / "command.json").write_text(json.dumps(command))
        return command

    def test_desktop_clicks_use_acknowledged_save_prepare_restore_without_game_focus(self):
        self.session.publish(phase="active", log_prefix="fixture")
        keys = HotkeyCommands()
        self.click("save")
        action = self.session.take_request(idle=True)
        command = keys.poll(False, True, False, False, False, 0, desktop_action=action)
        self.session.command(command["action"], command["id"])
        self.assertFalse(self.session.state["checkpoint"])
        saved = dict(id=command["id"], action=1, result=0, speed=10)
        self.session.report(saved)
        keys.poll(False, True, False, False, False, 0.1, saved)
        self.assertTrue(self.session.state["desktop_request"]["ok"])
        self.click("restore")
        command = keys.poll(
            False,
            True,
            False,
            False,
            False,
            0.2,
            desktop_action=self.session.take_request(idle=True),
        )
        self.assertEqual(command["action"], 2)
        self.session.command(2, command["id"])
        prepared = dict(
            id=command["id"],
            action=2,
            result=0,
            fields=10123,
            verified_fields=10123,
            mismatched_fields=0,
            readable=1,
            epoch=1,
        )
        self.session.report(prepared)
        self.assertIsNotNone(self.session.request)
        command = keys.poll(False, True, False, False, False, 0.3, prepared)
        self.assertEqual(command["action"], 3)
        self.session.command(3, command["id"])
        self.session.report(dict(id=command["id"], action=3, result=0))
        self.assertTrue(self.session.state["desktop_request"]["ok"])
        self.assertEqual(self.session.state["restore_count"], 1)
        self.click("restore")
        self.assertIsNone(self.session.take_request(idle=True))

    def test_desktop_requests_reject_stale_context_busy_and_wrong_host(self):
        self.session.publish(phase="active", log_prefix="fixture")
        for index, changes in enumerate(
            [
                dict(created_at_ms=997999),
                dict(created_at_ms=1000001),
                dict(host="old-host"),
                dict(action="prepare"),
                dict(created_at_ms=None),
            ]
        ):
            self.click("save", id=str(index), **changes)
            self.assertIsNone(self.session.take_request(idle=True))
            self.assertFalse(self.session.state["desktop_request"]["ok"])
        self.click("save", id="busy")
        self.assertIsNone(self.session.take_request(idle=False))
        self.session.publish(phase="paused")
        self.click("save", id="paused")
        self.assertIsNone(self.session.take_request(idle=True))
        self.session.publish(phase="active")
        self.assertIsNone(self.session.take_request(idle=True))

    def test_desktop_preparation_still_requires_context_timely_ack_and_full_plan(self):
        for allowed, now, fields, result in [
            (False, 0.1, 10085, 0),
            (True, 3, 10085, 0),
            (True, 0.1, 10077, 0),
            (True, 0.1, 10085, 9),
        ]:
            keys = HotkeyCommands()
            keys.saved = True
            command = keys.poll(False, True, False, False, False, 0, desktop_action="restore")
            self.assertEqual(command["action"], 2)
            ack = dict(
                id=command["id"],
                action=2,
                result=result,
                fields=fields,
                verified_fields=10085,
                mismatched_fields=0,
                readable=1,
                epoch=1,
            )
            self.assertEqual(keys.poll(False, allowed, False, False, False, now, ack), {})
            self.assertIsNone(keys.pending)
            self.assertEqual(keys.poll(False, True, False, False, False, now + 0.1, ack), {})

    def test_checkpoint_does_not_expire_with_healthy_gui(self):
        self.session.report({"action": 1, "result": 0, "id": 1})
        for now in (1000, 1000 + 301, 1000 + 86400):
            self.session.clock = lambda: now
            os.utime(self.path / "heartbeat", (now, now))
            self.assertFalse(self.session.stopped())
            self.assertTrue(self.session.state["checkpoint"])
        self.session.publish(checkpoint=False, message="Vehicle reset.")
        self.assertFalse(json.loads((self.path / "status.json").read_text())["checkpoint"])

    def test_required_lease_rejects_missing_malformed_expired_or_wrong_pid(self):
        strict = DesktopSession(self.path, clock=lambda: 1000, require_lease=True, pid=7)
        heartbeat = self.path / "heartbeat"
        self.assertTrue(strict.stopped())
        lease = dict(schema=1, pid=7, identity="7:123", expires_at_ms=1002000)
        heartbeat.write_text(json.dumps(lease))
        self.assertFalse(strict.stopped())
        for invalid in ({**lease, "pid": 8}, {**lease, "identity": "8:123"},
                        {**lease, "expires_at_ms": 1000000},
                        {**lease, "expires_at_ms": 1003000},
                        {**lease, "expires_at_ms": float("nan")}):
            heartbeat.write_text(json.dumps(invalid))
            self.assertTrue(strict.stopped())
        heartbeat.write_text("not json")
        self.assertTrue(strict.stopped())

    def test_process_creation_identity_rejects_reused_pid(self):
        import ctypes as C
        import subprocess
        current_pid = os.getpid()
        ticks = subprocess.check_output([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            f"(Get-Process -Id {current_pid}).StartTime.ToUniversalTime().Ticks",
        ], text=True).strip()
        strict = DesktopSession(self.path, clock=lambda: 1000, require_lease=True, pid=current_pid)
        lease = dict(schema=1, pid=current_pid, identity=f"{current_pid}:{ticks}", expires_at_ms=1002000)
        heartbeat = self.path / "heartbeat"
        heartbeat.write_text(json.dumps(lease))
        self.assertTrue(strict.process_matches(-1))
        lease["identity"] = f"{current_pid}:{int(ticks)+1}"
        heartbeat.write_text(json.dumps(lease))
        self.assertFalse(strict.process_matches(-1))

    def test_close_and_crashed_gui_request_stop(self):
        self.assertFalse(self.session.stopped())
        self.session.clock = lambda: 1011
        self.assertTrue(self.session.stopped())
        self.session.clock = lambda: 1000
        (self.path / "stop").touch()
        self.assertTrue(self.session.stopped())

    def test_status_write_failure_cannot_interrupt_native_cleanup(self):
        with patch.object(Path, "replace", side_effect=PermissionError):
            self.session.report({"action": 1, "result": 0, "id": 1})
        self.assertTrue(self.session.state["checkpoint"])
        self.session.publish(phase="active")
        self.assertTrue(json.loads((self.path / "status.json").read_text())["checkpoint"])

    def test_checkpoint_summary_uses_acknowledgements_and_survives_failed_save(self):
        self.session.command(1)
        self.assertFalse(self.session.state["checkpoint"])
        self.session.report({"action": 1, "result": 0, "id": 1, "speed": 25.0})
        self.assertEqual(self.session.state["saved_speed_kmh"], 90.0)
        self.assertEqual(self.session.state["saved_at"], 1000)
        self.session.command(2)
        self.session.report({"action": 2, "result": 0, "id": 2})
        self.assertEqual(self.session.state["restore_count"], 0)
        self.session.report({"action": 3, "result": 0, "id": 3})
        self.session.report({"action": 1, "result": 9, "cause": 3, "id": 4})
        self.assertEqual(self.session.state["saved_speed_kmh"], 90.0)
        self.assertEqual(self.session.state["restore_count"], 1)
        self.session.publish(phase="waiting", checkpoint=False)
        self.assertIsNone(self.session.state["saved_speed_kmh"])
        self.assertIsNone(self.session.state["saved_at"])
        self.assertEqual(self.session.state["restore_count"], 0)

    def test_invalid_speed_does_not_break_status_or_cleanup(self):
        for speed in (float("nan"), float("inf"), -1, None, "fast", True):
            self.session.report({"action": 1, "result": 0, "id": 1, "speed": speed})
            snapshot = json.loads((self.path / "status.json").read_text())
            self.assertIsNone(snapshot["saved_speed_kmh"])
            self.assertTrue(snapshot["checkpoint"])

    def test_settings_validation_and_atomic_replacement(self):
        self.session.settings_file = self.path / "settings.json"
        values = {"save_key": "F8", "restore_key": "F9", "sound": False}
        self.session.settings_file.write_text(json.dumps(values))
        self.assertEqual(self.session.settings(), ("F8", "F9", False))
        for invalid in (
            dict(values, restore_key="F8"),
            dict(values, save_key="Ctrl+G"),
            dict(values, sound="false"),
            dict(values, restore_key=None),
        ):
            self.session.settings_file.write_text(json.dumps(invalid))
            self.assertIsNone(self.session.settings())
        self.session.settings_file.write_text("{")
        self.assertIsNone(self.session.settings())

    def test_rebind_retains_checkpoint_and_requires_release(self):
        keys = HotkeyCommands()
        keys.saved = True
        keys.armed = True
        self.assertTrue(keys.rebind())
        self.assertTrue(keys.saved)
        self.assertEqual(keys.poll(True, True, False, True, False, 90000), {})
        keys.poll(True, True, False, False, False, 90000)
        self.assertEqual(keys.poll(True, True, False, True, False, 90001)["action"], 2)
        self.assertFalse(keys.rebind())  # Do not change a preparation in flight.

    def test_native_save_ack_survives_focus_loss(self):
        keys = HotkeyCommands()
        keys.poll(True, True, False, False, False, 0)
        keys.poll(True, True, True, False, False, 0)
        keys.poll(False, True, False, False, False, 0.1, {"id": 1, "result": 0})
        self.assertTrue(keys.saved)

    def test_failed_save_preserves_previous_checkpoint(self):
        self.session.report({"action": 1, "result": 0, "id": 1})
        self.session.command(1)
        self.session.report({"action": 1, "result": 9, "cause": 3, "id": 2})
        self.assertTrue(self.session.state["checkpoint"])
        keys = HotkeyCommands()
        keys.saved = True
        keys.poll(True, True, False, False, False, 0)
        keys.poll(True, True, True, False, False, 0)
        keys.poll(True, True, False, False, False, 0.1, {"id": 1, "result": 9})
        self.assertTrue(keys.saved)

    def test_restore_without_checkpoint_has_feedback_once_per_press(self):
        keys = HotkeyCommands()
        keys.poll(True, True, False, False, False, 0)
        self.assertEqual(keys.poll(True, True, False, True, False, 1), {})
        self.assertIn("Save a checkpoint", keys.notice)
        keys.poll(True, True, False, True, False, 2)
        self.assertIsNone(keys.notice)

    def test_lifecycle_exit_requires_new_process_and_never_rearms(self):
        args = SimpleNamespace(pid=7, desktop=self.session)
        alive = Mock(return_value=True)
        run = Mock(side_effect=["vehicle_reset", "context_changed", RuntimeError("quarantined")])
        wait = Mock(return_value=True)
        audit = Mock()
        supervise(args, run, audit, alive, wait=wait, sleep=lambda _: None)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(audit.call_count, 1)
        self.assertEqual(args.revision, HOST_REVISION)
        self.assertFalse(self.session.state["checkpoint"])
        self.assertFalse(hasattr(args, "seconds"))

    def test_unknown_shutdown_does_not_autorestart(self):
        args = SimpleNamespace(pid=7, desktop=self.session)
        run = Mock(return_value="stopped")
        with self.assertRaisesRegex(RuntimeError, "unexpectedly"):
            supervise(args, run, Mock(), lambda: True, wait=Mock(return_value=True))
        self.assertEqual(run.call_count, 1)

    def test_user_shutdown_does_not_error_or_autorestart(self):
        args = SimpleNamespace(pid=7, desktop=self.session)
        run = Mock(return_value="user_stopped")
        audit = Mock()
        wait = Mock(return_value=True)
        supervise(args, run, audit, lambda: True, wait=wait)
        run.assert_called_once_with(args)
        audit.assert_called_once_with(7)
        self.assertEqual(wait.call_count, 1)

    def test_stop_while_waiting_never_loads_host(self):
        (self.path / "stop").touch()
        run = Mock()
        supervise(SimpleNamespace(pid=7, desktop=self.session), run, Mock(), lambda: True)
        run.assert_not_called()

    def test_sounds_are_distinct_valid_wav_and_ack_only(self):
        paths = write_sounds(self.path / "audio")
        self.assertEqual(len({p.read_bytes() for p in paths.values()}), 3)
        for path in paths.values():
            with wave.open(str(path)) as sound:
                self.assertEqual((sound.getnchannels(), sound.getsampwidth()), (1, 2))
                self.assertLess(sound.getnframes() / sound.getframerate(), 0.5)
        self.assertIsNone(report_feedback({"action": 2, "result": 0}))
        self.assertEqual(report_feedback({"action": 1, "result": 0})[0], "save")
        self.assertEqual(report_feedback({"action": 3, "result": 0})[0], "restore")
        self.assertEqual(report_feedback({"action": 2, "result": 5, "cause": 1})[0], "rejected")

    def test_audio_is_async_and_can_be_muted_live(self):
        audio = Mock(SND_FILENAME=1, SND_ASYNC=2, SND_NODEFAULT=4)
        with patch.dict("sys.modules", {"winsound": audio}):
            feedback = Feedback(self.path / "audio", muted=True)
            feedback.play("save")
            audio.PlaySound.assert_not_called()
            feedback.muted = False
            feedback.play("restore")
            audio.PlaySound.assert_called_once_with(str(feedback.paths["restore"]), 7)
            audio.PlaySound.side_effect = RuntimeError("No device")
            feedback.play("rejected")  # Audio failure never kills the controller.


if __name__ == "__main__":
    unittest.main()
