import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from sector.desktop.reset_desktop_session import DesktopSession


class DesktopAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.session = DesktopSession(self.path, clock=lambda: 1000, require_lease=True, pid=7)
        self.lease = dict(schema=1, pid=7, identity="7:123", expires_at_ms=1002000)
        (self.path / "heartbeat").write_text(json.dumps(self.lease), encoding="utf-8")

    def test_unknown_context_pauses_without_extending_or_stopping_valid_lease(self):
        self.lease["writes_allowed"] = False
        (self.path / "heartbeat").write_text(json.dumps(self.lease), encoding="utf-8")
        self.assertEqual(self.session.authorization(), "paused")
        self.assertFalse(self.session.stopped())
        self.session.clock = lambda: 1002
        self.assertEqual(self.session.authorization(), "stopped")
        self.assertIn("expired", self.session.authorization_reason)

    def test_transient_permission_failure_revokes_input_before_a_valid_read_can_recover(self):
        revoke = Mock()
        with patch.object(Path, "read_text", side_effect=[PermissionError("sharing"), json.dumps(self.lease)]), patch("time.sleep"):
            self.assertEqual(self.session.authorization(on_unavailable=revoke), "allowed")
        revoke.assert_called_once()

    def test_retry_never_falls_back_to_a_cached_permission(self):
        self.assertEqual(self.session.authorization(), "allowed")
        with patch.object(Path, "read_text", side_effect=PermissionError("locked")), patch("time.sleep"):
            self.assertEqual(self.session.authorization(), "stopped")
        self.assertIn("unreadable", self.session.authorization_reason)

    def test_expired_or_malformed_retry_cannot_admit_writes(self):
        expired = {**self.lease, "expires_at_ms": 1000000}
        for response in [json.dumps(expired), "not JSON"]:
            with patch.object(Path, "read_text", side_effect=[PermissionError("sharing"), response]), patch("time.sleep"):
                self.assertEqual(self.session.authorization(), "stopped")
        (self.path / "stop").touch()
        self.assertTrue(self.session.stopped())
        self.assertEqual(self.session.authorization_reason, "Desktop requested stop")


if __name__ == "__main__":
    unittest.main()
