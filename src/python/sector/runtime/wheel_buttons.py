"""Read wheel buttons through Windows DirectInput without exclusive access or effects."""

import ctypes as C
import json
import re
import time
import uuid

WHEEL = re.compile(r"WHEEL:([0-9A-F]{32}):([1-9][0-9]{0,2})", re.ASCII)


def wheel_binding(name):
    match = WHEEL.fullmatch(name.upper()) if isinstance(name, str) else None
    if match and int(match[2]) <= 128:
        return match[1], int(match[2])
    return None


def binding_down(binding, snapshot):
    """Return None on disconnect/read failure so callers revoke edge arming."""
    identity, button = binding
    state = snapshot.get(identity)
    return None if state is None else button in state


class CaptureEdges:
    def __init__(self):
        self.ready = set()

    def poll(self, snapshot):
        # A newly connected device must first be observed with every button up.
        self.ready.intersection_update(snapshot)
        candidates = []
        for identity, buttons in snapshot.items():
            if buttons is None:
                self.ready.discard(identity)
            elif not buttons:
                self.ready.add(identity)
            else:
                if identity in self.ready and len(buttons) == 1:
                    candidates.append((identity, next(iter(buttons))))
                self.ready.discard(identity)
        if len(candidates) == 1 and sum(bool(s) for s in snapshot.values()) == 1:
            identity, button = candidates[0]
            return f"WHEEL:{identity}:{button}"
        return None


class GUID(C.Structure):
    _fields_ = [("raw", C.c_ubyte * 16)]

    @classmethod
    def parse(cls, value):
        return cls((C.c_ubyte * 16).from_buffer_copy(uuid.UUID(value).bytes_le))

    def identity(self):
        return uuid.UUID(bytes_le=bytes(self.raw)).hex.upper()


DWORD = C.c_uint32
HRESULT = C.c_int32


class DeviceInstance(C.Structure):
    _fields_ = [
        ("size", DWORD), ("instance", GUID), ("product", GUID), ("type", DWORD),
        ("instance_name", C.c_wchar * 260), ("product_name", C.c_wchar * 260),
        ("ff_driver", GUID), ("usage_page", C.c_uint16), ("usage", C.c_uint16),
    ]


class ObjectFormat(C.Structure):
    _fields_ = [("guid", C.POINTER(GUID)), ("offset", DWORD), ("type", DWORD), ("flags", DWORD)]


class DataFormat(C.Structure):
    _fields_ = [
        ("size", DWORD), ("object_size", DWORD), ("flags", DWORD),
        ("data_size", DWORD), ("count", DWORD), ("objects", C.POINTER(ObjectFormat)),
    ]


def method(pointer, index, *args):
    table = C.cast(pointer, C.POINTER(C.POINTER(C.c_void_p))).contents
    return C.WINFUNCTYPE(HRESULT, C.c_void_p, *args)(table[index])


def checked(result, operation):
    if result < 0:
        raise OSError(f"DirectInput {operation} failed (0x{result & 0xffffffff:08X}).")


class DirectInputButtons:
    """One thread owns the COM interfaces and its hidden top-level helper window."""

    def __init__(self):
        self.devices = {}
        self.names = {}
        self.next_discovery = 0
        self.interface = C.c_void_p()
        self.window = None
        self.user = C.WinDLL("user32", use_last_error=True)
        self.user.CreateWindowExW.argtypes = [DWORD, C.c_wchar_p, C.c_wchar_p, DWORD,
            C.c_int, C.c_int, C.c_int, C.c_int, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p]
        self.user.CreateWindowExW.restype = C.c_void_p
        self.user.DestroyWindow.argtypes = [C.c_void_p]
        kernel = C.WinDLL("kernel32", use_last_error=True)
        kernel.GetModuleHandleW.argtypes = [C.c_wchar_p]
        kernel.GetModuleHandleW.restype = C.c_void_p
        module = kernel.GetModuleHandleW(None)
        self.library = C.WinDLL("dinput8")
        self.library.DirectInput8Create.argtypes = [C.c_void_p, DWORD, C.POINTER(GUID),
            C.POINTER(C.c_void_p), C.c_void_p]
        self.library.DirectInput8Create.restype = HRESULT
        iid = GUID.parse("BF798031-483A-4DA2-AA99-5D64ED369700")
        checked(self.library.DirectInput8Create(module, 0x0800, C.byref(iid),
            C.byref(self.interface), None), "initialization")
        self.window = self.user.CreateWindowExW(0, "STATIC", "Sector wheel input", 0,
            0, 0, 0, 0, None, None, module, None)
        if not self.window:
            self.close()
            raise OSError("Could not create the wheel input helper window.")
        self.button_guid = GUID.parse("A36D02F0-C9F3-11CF-BFC7-444553540000")
        self.objects = (ObjectFormat * 128)(*(
            ObjectFormat(C.pointer(self.button_guid), i, 0x8000000C | (i << 8), 0)
            for i in range(128)))
        self.format = DataFormat(C.sizeof(DataFormat), C.sizeof(ObjectFormat), 1, 128,
            128, self.objects)

    def discover(self):
        found = {}
        callback_type = C.WINFUNCTYPE(C.c_int, C.POINTER(DeviceInstance), C.c_void_p)

        def collect(pointer, _):
            device = pointer.contents
            found[device.instance.identity()] = (GUID.from_buffer_copy(device.instance),
                device.product_name)
            return 1

        callback = callback_type(collect)
        checked(method(self.interface, 4, DWORD, callback_type, C.c_void_p, DWORD)(
            self.interface, 4, callback, None, 1), "device discovery")
        for identity in list(self.devices):
            if identity not in found:
                self.release(identity)
        self.names = {identity: name for identity, (_, name) in found.items()}
        for identity, (guid, _) in found.items():
            if identity in self.devices:
                continue
            device = C.c_void_p()
            try:
                checked(method(self.interface, 3, C.POINTER(GUID), C.POINTER(C.c_void_p),
                    C.c_void_p)(self.interface, C.byref(guid), C.byref(device), None), "open")
                checked(method(device, 11, C.POINTER(DataFormat))(
                    device, C.byref(self.format)), "button format")
                # DISCL_NONEXCLUSIVE | DISCL_BACKGROUND: do not take the device from LMU.
                checked(method(device, 13, C.c_void_p, DWORD)(device, self.window, 0xA), "sharing")
                self.devices[identity] = device
            except OSError:
                if device:
                    method(device, 2)(device)
        self.next_discovery = time.monotonic() + 1

    def snapshot(self):
        if time.monotonic() >= self.next_discovery:
            self.discover()
        result = {}
        for identity, device in self.devices.items():
            method(device, 25)(device)  # Polled devices require Poll before GetDeviceState.
            state = (C.c_ubyte * 128)()
            status = method(device, 9, DWORD, C.c_void_p)(device, 128, state)
            if status < 0:
                method(device, 7)(device)  # Acquire once; never spin on a lost device.
                result[identity] = None
            else:
                result[identity] = {i + 1 for i, value in enumerate(state) if value & 0x80}
        return result

    def release(self, identity):
        device = self.devices.pop(identity)
        method(device, 8)(device)
        method(device, 2)(device)

    def close(self):
        for identity in list(self.devices):
            self.release(identity)
        if self.interface:
            method(self.interface, 2)(self.interface)
            self.interface = C.c_void_p()
        if self.window:
            self.user.DestroyWindow(self.window)
            self.window = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", action="store_true")
    args = parser.parse_args()
    reader = None
    try:
        reader = DirectInputButtons()
        if not args.capture:
            reader.discover()
            print(json.dumps({"devices": list(reader.names.values())}))
            return
        edges = CaptureEdges()
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            binding = edges.poll(reader.snapshot())
            if binding:
                identity, _ = wheel_binding(binding)
                print(json.dumps({"ok": True, "binding": binding,
                    "device": reader.names.get(identity, "Wheel")}))
                return
            time.sleep(0.02)
        print(json.dumps({"ok": False, "error":
            "No button captured. Release all wheel buttons, then retry. Check the wheel is connected."}))
    except (OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
    finally:
        if reader:
            reader.close()


if __name__ == "__main__":
    main()
