# Wheel button bindings

Open Active Reset, click the Save or Restore shortcut, then choose **Bind wheel button**. Keep Sector focused, release all buttons on the target device, then press exactly one button. Capture expires after 15 seconds. Escape or Cancel stops capture. A keyboard key can be assigned in the same dialog; keyboard and wheel bindings can be mixed.

Bindings support DirectInput buttons 1 through 128 and use the device instance GUID rather than enumeration order. Each shortcut displays a short device identifier and button number. Reconnecting through a different USB port or reinstalling a driver may require rebinding. Axes and POV hats are not button bindings. Choose controls that are unused in LMU; Sector does not suppress the game's own input.

DirectInput reads are nonexclusive and do not create force-feedback effects. A missing device or failed input read prevents shortcut activation and requires a fresh release before resuming. Focus, offline admission, EAC checks, native preparation and acknowledgement rules are shared with keyboard shortcuts. A held button never repeats automatically. Disabling Active Reset still requires closing LMU before online play.

Hardware capture does not launch LMU or authorize Active Reset. The preview blocks real hardware capture; its UI checks use a synthetic button. Fixture tests cover capture release, duplicate bindings, simultaneous devices, disconnection, cancellation, mixed input and persisted settings. Input enumeration and nonexclusive state reads can be checked without running the game. Live checkpoint save/restore with physical wheel presses requires a separate in-game check.
