import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from sector.telemetry import capture_preparation_steam25661166 as telemetry


class TelemetryProfileVerificationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.game = self.root / "game"
        self.game.mkdir()
        self.executable = self.game / "Le Mans Ultimate.exe"
        self.executable.write_bytes(b"fixture game; never executed")
        (self.game / "Bin").mkdir()
        self.content = b"fixture UI contract"
        with zipfile.ZipFile(self.game / "Bin/UI.zip", "w") as archive:
            archive.writestr("contract.js", self.content)
        (self.root / "bin").mkdir()
        self.binary = self.root / "bin/diagnostic-14200.exe"
        self.binary.write_bytes(b"fixture diagnostic; never executed")
        (self.root / "compatibility").mkdir()
        self.profile = {
            "observation_build": 14200, "physics_compatible": False,
            "files": [{"relative_path": self.executable.name,
                "sha256": hashlib.sha256(self.executable.read_bytes()).hexdigest().upper()}],
            "ui_contract": {"member": "contract.js", "size": len(self.content),
                "sha256": hashlib.sha256(self.content).hexdigest()},
            "diagnostic_sha256": hashlib.sha256(self.binary.read_bytes()).hexdigest(),
        }
        def image_name(handle, flags, value, size):
            value.value = str(self.executable)
            return True
        kernel = Mock()
        kernel.QueryFullProcessImageNameW.side_effect = image_name
        self.addCleanup(patch.stopall)
        patch.object(telemetry, "PROJECT", self.root).start()
        patch.object(telemetry, "KERNEL", kernel).start()
        self.state = {"state": {"appBuild": 14200, "settingMode": "SETTING_GRANDPRIX",
            "gameSession": "PRACTICE1"}}
        patch.object(telemetry, "get_json", return_value=self.state).start()
        self.write_profile()

    def write_profile(self):
        (self.root / "compatibility/steam-25661166-telemetry.json").write_text(
            json.dumps(self.profile), encoding="utf-8")

    def test_lowercase_local_and_uppercase_upstream_hashes_both_verify(self):
        for digest in [self.profile["diagnostic_sha256"], self.profile["diagnostic_sha256"].upper()]:
            self.profile["diagnostic_sha256"] = digest
            self.write_profile()
            self.assertEqual(telemetry.verify_telemetry(42)[0], self.binary)

    def test_modified_diagnostic_is_still_rejected(self):
        self.binary.write_bytes(b"changed diagnostic")
        with self.assertRaisesRegex(ValueError, "Diagnostic binary changed"):
            telemetry.verify_telemetry(42)

    def test_game_and_ui_integrity_checks_remain_required(self):
        self.executable.write_bytes(b"changed game")
        with self.assertRaisesRegex(ValueError, "Telemetry profile mismatch"):
            telemetry.verify_telemetry(42)
        self.profile["files"][0]["sha256"] = hashlib.sha256(self.executable.read_bytes()).hexdigest().upper()
        self.profile["ui_contract"]["sha256"] = "0" * 64
        self.write_profile()
        with self.assertRaisesRegex(ValueError, "UI contract changed"):
            telemetry.verify_telemetry(42)

    def test_matching_binary_does_not_admit_an_online_session(self):
        self.state["state"]["settingMode"] = "SETTING_MULTIPLAYER"
        with self.assertRaisesRegex(ValueError, "verified singleplayer Practice"):
            telemetry.verify_telemetry(42)


if __name__ == "__main__":
    unittest.main()
