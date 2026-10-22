"""Read-only verification for an explicitly requested clean desktop handoff."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import json
from sector.observers.audit_snapshot_25661166 import audit
from sector.observers.run_physics_observer import modules


def predecessor_absent(pid, kernel):
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        if C.get_last_error() == 87:
            return True
        raise OSError("Cannot verify the previous controller exited.")
    try:
        code = W.DWORD()
        if not kernel.GetExitCodeProcess(handle, C.byref(code)):
            raise OSError("Cannot query the previous controller.")
        return code.value != 259
    finally:
        kernel.CloseHandle(handle)


def verify(args):
    kernel = C.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    kernel.OpenProcess.restype = W.HANDLE
    kernel.CloseHandle.argtypes = [W.HANDLE]
    kernel.GetExitCodeProcess.argtypes = [W.HANDLE, C.POINTER(W.DWORD)]
    kernel.GetProcessTimes.argtypes = [W.HANDLE] + [C.POINTER(W.FILETIME)] * 4
    if not predecessor_absent(args.controller, kernel) or not predecessor_absent(args.worker, kernel):
        raise ValueError("The previous Sector controller or worker is still running. Restart LMU if shutdown is uncertain.")
    handle = kernel.OpenProcess(0x1000, False, args.pid)
    if not handle:
        raise OSError("LMU process identity is unavailable.")
    try:
        times = [W.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(C.byref(value) for value in times)):
            raise OSError("LMU process creation time is unavailable.")
        ticks = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        identity = f"{args.pid}:{ticks + 504911232000000000}"
        if identity != args.identity:
            raise ValueError("LMU process identity changed.")
        listed = modules(args.pid)
        if any("easyanticheat" in m["name"].lower() or m["name"].lower().startswith("eac") for m in listed):
            raise ValueError("EAC module present")
        report = audit(args.pid)
        if not any(name.startswith("lmu-physical-reset-") for name in report["modules"]):
            raise ValueError("The previous reset host cannot be verified.")
        return {"verified": True, "identity": identity}
    finally:
        kernel.CloseHandle(handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("pid", "controller", "worker"):
        parser.add_argument("--" + name, type=int, required=True)
    parser.add_argument("--identity", required=True)
    args = parser.parse_args()
    if any(value <= 0 for value in (args.pid, args.controller, args.worker)):
        parser.error("Positive process IDs required")
    print(json.dumps(verify(args)))


if __name__ == "__main__":
    main()
