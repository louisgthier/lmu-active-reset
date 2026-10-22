from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from sector.runtime import audit_session_resume as resume


class ResumeAuditTests(unittest.TestCase):
    def kernel(self):
        kernel = Mock()
        def exit_code(handle, value):
            value._obj.value = 0
            return 1
        kernel.GetExitCodeProcess.side_effect = exit_code
        kernel.GetProcessTimes.return_value = 1
        return kernel

    def test_live_predecessor_and_access_denied_are_refused(self):
        kernel = self.kernel()
        def live(handle, value):
            value._obj.value = 259
            return 1
        kernel.GetExitCodeProcess.side_effect = live
        self.assertFalse(resume.predecessor_absent(77, kernel))
        kernel.OpenProcess.return_value = None
        with patch.object(resume.C, "get_last_error", return_value=5):
            with self.assertRaises(OSError):
                resume.predecessor_absent(77, kernel)
        with patch.object(resume.C, "get_last_error", return_value=87):
            self.assertTrue(resume.predecessor_absent(77, kernel))

    def test_fresh_identity_and_resident_audit_are_both_required(self):
        args = SimpleNamespace(pid=42, controller=88, worker=77, identity="42:504911232000000000")
        kernel = self.kernel()
        with patch.object(resume.C, "WinDLL", return_value=kernel), patch.object(resume, "modules", return_value=[]), patch.object(resume, "audit", return_value={"modules": {"lmu-physical-reset-v28-25661166-fixture.dll": {}}}) as audit:
            self.assertTrue(resume.verify(args)["verified"])
            audit.assert_called_once_with(42)
            args.identity = "42:wrong"
            with self.assertRaisesRegex(ValueError, "identity changed"):
                resume.verify(args)

    def test_eac_blocks_the_resident_audit(self):
        args = SimpleNamespace(pid=42, controller=88, worker=77, identity="42:504911232000000000")
        with patch.object(resume.C, "WinDLL", return_value=self.kernel()), patch.object(resume, "modules", return_value=[{"name": "EasyAntiCheat.dll"}]), patch.object(resume, "audit") as audit:
            with self.assertRaisesRegex(ValueError, "EAC"):
                resume.verify(args)
            audit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
