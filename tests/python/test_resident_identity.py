import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from contextlib import ExitStack
import ctypes as C

from sector.runtime.resident_identity import (
    HOST_REVISION,
    physical_host_identity,
    resident_profile,
    verify_stopped_resident,
)


class ResidentIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "current"
        self.store = self.root / "Sector/runtime"
        self.name = "lmu-physical-reset-v17-25661166-" + "a" * 32 + ".dll"
        self.manifest = "steam-25661166-physical-reset-v17.json"
        self.payload = b"fixture host"
        self.profile = {
            "dll_sha256": hashlib.sha256(self.payload).hexdigest(),
            "targets": [{"rva": 42, "prolog": "1234", "name": "fixture"}],
        }

    def install(self, managed=False):
        root = self.store / "staging" if managed else self.project
        (root / "bin").mkdir(parents=True)
        (root / "compatibility").mkdir()
        profile_bytes = json.dumps(self.profile).encode()
        (root / "compatibility" / self.manifest).write_bytes(profile_bytes)
        (root / "bin" / self.name).write_bytes(self.payload)
        if managed:
            canonical = "lmu-physical-reset-v17-25661166.dll"
            inventory = {
                f"bin/{canonical}": self.profile["dll_sha256"],
                f"compatibility/{self.manifest}": hashlib.sha256(profile_bytes).hexdigest(),
            }
            content = json.dumps(inventory).encode()
            (root / "release-manifest.json").write_bytes(content)
            root = root.rename(self.store / ("0.2.2-" + hashlib.sha256(content).hexdigest()[:16]))
        return {"name": self.name, "path": str(root / "bin" / self.name)}

    def resolve(self, entry):
        return resident_profile(entry, self.manifest, self.project, self.store)

    def test_current_build_and_new_revisions(self):
        self.assertEqual(self.resolve(self.install()), self.profile)
        for revision in (9, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28):
            name = self.name.replace("v17", f"v{revision}")
            identity = physical_host_identity(name)
            self.assertEqual(identity[2], f"LMU_PhysicalReset_{name}_")
            self.assertEqual(identity[3], 0x4C4D555253543030 + revision)
        for name in (
            self.name.replace("v17", f"v{HOST_REVISION + 1}"),
            self.name.replace("v17", "v0"),
            self.name.replace("a" * 32, "bad"),
        ):
            self.assertIsNone(physical_host_identity(name))

    def test_stopped_previous_release_uses_its_own_profile(self):
        entry = self.install(managed=True)
        # The new installation does not need to carry the old DLL or its hash.
        self.assertFalse(self.project.exists())
        self.assertEqual(self.resolve(entry), self.profile)

    def test_offline_prerelease_resident_still_requires_its_content_address(self):
        entry = self.install(managed=True)
        root = Path(entry["path"]).parents[1]
        renamed = root.rename(root.with_name(root.name.replace("0.2.2-", "1.0.1-offline.8-")))
        entry["path"] = str(renamed / "bin" / self.name)
        self.assertEqual(self.resolve(entry), self.profile)
        (renamed / "release-manifest.json").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "manifest changed"):
            self.resolve(entry)

    def test_changed_dll_is_not_accepted(self):
        entry = self.install(managed=True)
        Path(entry["path"]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "DLL hash mismatch"):
            self.resolve(entry)

    def test_changed_profile_is_not_accepted(self):
        entry = self.install(managed=True)
        (Path(entry["path"]).parents[1] / "compatibility" / self.manifest).write_text("{}")
        with self.assertRaisesRegex(ValueError, "profile changed"):
            self.resolve(entry)

    def test_changed_release_inventory_is_not_accepted(self):
        entry = self.install(managed=True)
        (Path(entry["path"]).parents[1] / "release-manifest.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "manifest changed"):
            self.resolve(entry)

    def test_arbitrary_location_is_not_accepted(self):
        entry = self.install()
        with self.assertRaisesRegex(ValueError, "Unrecognized resident location"):
            resident_profile(entry, self.manifest, self.root / "other", self.store)

    def test_live_failed_or_wrong_process_module_is_not_accepted(self):
        identity = physical_host_identity(self.name)
        fields = dict(
            magic=identity[3], pid=123, version=1, status=3, error=0, stop=1, allow_observation=0
        )
        verify_stopped_resident(SimpleNamespace(**fields), identity[3], 123)
        for key, value in (
            ("magic", 0),
            ("pid", 456),
            ("version", 2),
            ("status", 2),
            ("status", 5),
            ("error", 108),
            ("stop", 0),
            ("allow_observation", 1),
        ):
            with (
                self.subTest(key=key, value=value),
                self.assertRaisesRegex(ValueError, "not cleanly stopped"),
            ):
                verify_stopped_resident(SimpleNamespace(**{**fields, key: value}), identity[3], 123)

    def test_audit_checks_v17_ipc_and_restored_targets(self):
        from sector.observers import audit_snapshot_25661166 as audit
        from sector.runtime.reset_host_runner import IPC

        entry = self.install()
        state = IPC()
        state.magic = physical_host_identity(self.name)[3]
        state.pid, state.version, state.status, state.stop = 123, 1, 3, 1
        base = 0x100000
        original = bytes.fromhex("488bc4488958104889701848897820")
        reads = []

        def read(handle, address, size):
            reads.append(address)
            return bytes.fromhex("1234") if address == base + 42 else original

        with ExitStack() as stack:
            stack.enter_context(patch.object(audit, "PROJECT", self.project))
            stack.enter_context(patch.object(audit, "verify_telemetry"))
            stack.enter_context(patch.object(audit, "api"))
            stack.enter_context(
                patch.object(
                    audit,
                    "modules",
                    return_value=[entry, {"name": "Le Mans Ultimate.exe", "base": base}],
                )
            )
            for method, result in (
                ("OpenFileMappingW", 1),
                ("MapViewOfFile", C.addressof(state)),
                ("OpenProcess", 2),
                ("UnmapViewOfFile", 1),
                ("CloseHandle", 1),
            ):
                stack.enter_context(patch.object(audit.k, method, return_value=result))
            reader = stack.enter_context(patch.object(audit, "read_process", side_effect=read))
            self.assertIn(self.name, audit.audit(123)["modules"])
            self.assertIn(base + 42, reads)
            reader.side_effect = lambda *args: b"\x00\x00"
            with self.assertRaisesRegex(ValueError, "Physical reset target not restored"):
                audit.audit(123)
