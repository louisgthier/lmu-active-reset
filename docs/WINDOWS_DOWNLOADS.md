# Windows downloads

Download the Windows assets from this fork's [Releases page](https://github.com/louisgthier/lmu-active-reset/releases).

## Recommended: Setup EXE

1. Download `Sector-<version>-win-x64-Setup.exe`.
2. Open it and choose Install. Sector is installed for your Windows account under `%LOCALAPPDATA%\Programs\Sector` without requiring administrator rights.
3. Open Sector using the Start menu or desktop shortcut. You can pin that shortcut to the taskbar.

The installer contains the complete application. It does not require Node.js, Python, an SDK, or source-code downloads. Windows 10/11 x64 and an installed supported copy of LMU are required. Confirm your own LMU folder on first launch. The game itself is not included.

To update, quit Sector completely from its tray icon and run the new Setup EXE. The executable path and application identity stay the same. Preferences and session safety journals are stored outside the installation directory and are preserved. Setup never closes the game or Sector automatically. Uninstall through Windows Settings; preferences are retained.

The installer and application are unsigned. Windows may display an unknown-publisher or reputation prompt. Do not disable antivirus. Verify that the download comes from this fork and compare its SHA-256 hash with `SHA256SUMS.txt` if needed. A checksum detects download changes; it is not a publisher signature or a malware guarantee.

## Alternative: portable ZIP

Download `Sector-<version>-win-x64.zip`, choose Extract All, and run `Sector.exe` inside the extracted folder. Keep every accompanying file and the `resources` and `locales` directories together. A permanent folder such as `Documents\Apps\Sector` works; installing in Program Files is unnecessary. Create a desktop shortcut instead of moving only `Sector.exe`.

GitHub's automatic Source code downloads contain the source tree, not the ready-to-run application.

## Offline practice

This fork is experimental. Active Reset starts disabled and requires a fresh Sector-owned game process, a supported Offline Practice session and EAC absence. Closing Sector does not undo a modified running game. Fully exit LMU before returning to normal online play. There is no guarantee against bans or unknown malware. See [offline safety](OFFLINE_SAFETY.md) for the exact limits.

## Building the installer

Prepare a verified local package and its `FILES.sha256` inventory first. Use the official signed Inno Setup compiler from [the publisher](https://jrsoftware.org/isdl.php):

```powershell
./scripts/build/Build-WindowsInstaller.ps1 -PackageDirectory '<verified-package>' -CompilerPath '<Inno-Setup>/ISCC.exe'
```

The script validates every package file and the native source-build receipt before compiling. Keep the compiler, private SDK inputs, local compatibility profiles and generated packages outside Git. Publish only reviewed distributable assets, with checksums, as release attachments.
