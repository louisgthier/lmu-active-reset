"""Read-only native telemetry and UI capture for the separately pinned Steam 25661166 executable (appBuild 14200).

No VM_READ/VM_WRITE, DLL loading, game input or REST POST. This profile does not
enable the old physics observer, whose 14130 hash/ABI checks remain unchanged.
"""

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import re
import zipfile
from sector.telemetry.capture_context import PROJECT, KERNEL, get_json, capture_verified


def verify_telemetry(pid):
    profile = json.loads((PROJECT / "compatibility/steam-25661166-telemetry.json").read_text())
    if profile["observation_build"] != 14200 or profile["physics_compatible"] is not False:
        raise ValueError("Unsupported telemetry profile")
    # Resolve the installation from the requested process; retain all pinned hash checks.
    handle = KERNEL.OpenProcess(0x1000, False, pid)
    if not handle:
        raise OSError(ctypes.get_last_error(), "Cannot query process identity")
    try:
        path = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(path))
        if not KERNEL.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(length)):
            raise OSError(ctypes.get_last_error(), "Cannot query process path")
        executable = Path(path.value)
        if executable.name.lower() != "le mans ultimate.exe":
            raise ValueError("Wrong process")
        root = executable.parent
    finally:
        KERNEL.CloseHandle(handle)
    for entry in profile["files"]:
        if (
            hashlib.sha256((root / entry["relative_path"]).read_bytes()).hexdigest().upper()
            != entry["sha256"]
        ):
            raise ValueError("Telemetry profile mismatch: " + entry["relative_path"])
    contract = profile["ui_contract"]
    with zipfile.ZipFile(root / "Bin/UI.zip") as archive:
        info = archive.getinfo(contract["member"])
        if info.file_size != contract["size"]:
            raise ValueError("UI member size changed")
        content = archive.read(info)
    if hashlib.sha256(content).hexdigest() != contract["sha256"]:
        raise ValueError("UI contract changed")
    binary = PROJECT / "bin/diagnostic-14200.exe"
    if hashlib.sha256(binary.read_bytes()).hexdigest() != profile["diagnostic_sha256"].lower():
        raise ValueError("Diagnostic binary changed")
    state = get_json("/navigation/state")["state"]
    if (
        state.get("appBuild") != 14200
        or state.get("settingMode") != "SETTING_GRANDPRIX"
        or state.get("gameSession") not in ("PRACTICE1", "PRACTICE2", "PRACTICE3", "PRACTICE4")
    ):
        raise ValueError("Start only in verified singleplayer Practice")
    return binary, contract, profile["diagnostic_sha256"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--seconds", type=int, default=180)
    parser.add_argument("--label", default="preparation_steam25661166")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 3600 or not re.fullmatch(r"[a-zA-Z0-9_-]+", args.label):
        parser.error("Invalid duration or label")
    binary, contract, digest = verify_telemetry(args.pid)
    print(
        "Verified Steam 25661166 telemetry profile; read-only capture started; no game input or physics access.",
        flush=True,
    )
    return capture_verified(
        args.pid, args.seconds, args.label, binary, contract, digest, observation_build=14200
    )


if __name__ == "__main__":
    raise SystemExit(main())
