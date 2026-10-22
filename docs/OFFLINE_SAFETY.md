# Local offline hardening build

This is an experimental local fork, not a safety certification or publisher approval.

## Session lifecycle

Active Reset starts disabled. Start LMU through Sector with all other LMU instances closed. Sector binds ownership to the spawned child PID and its creation time while that child is still alive. Enter Offline Practice, then choose Enable Active Reset. An unrelated or pre-existing game cannot be admitted.

Activation requires an identified process from the selected installation, EAC explicitly absent and a supported offline Practice context. The Python runner repeats the executable/profile, process-creation identity and EAC-module checks before loading the host. It periodically checks modules again. Native writes continue to require the existing short context lease and preparation gates.

The desktop grants a process-bound authorization for at most 2.5 seconds, refreshed only after successful process and offline-context verification. A brief Windows replacement conflict gets one bounded read retry, with writes revoked before retrying and no cached permission fallback. Malformed, expired or persistently unreadable authorization stops the GUI worker. A temporary HTTP verification failure pauses writes without renewing the previous authorization; successful fresh verification can resume before its original deadline. Known non-Practice context and EAC still stop the worker. A late asynchronous verification cannot revive expired authorization. Discovery errors, ambiguous processes, EAC or changed identity revoke authorization. These are cooperative checks with finite detection delays, not an absolute system-wide interlock.

Before spawning a worker, a journal is flushed to disk beside preferences. It marks the process as potentially modified, even if loading later fails. Disabling the feature, exiting Sector or restarting Sector does not clear this marker. Verified disappearance of that process identity clears it. Corrupt or unreadable journals block activation. A game/session context exit no longer automatically re-admits the host. After a fully verified clean shutdown, the same Sector instance may offer an explicit reactivation for its original process. The modified journal remains set, a new checkpoint is required, and the new worker audits resident modules before loading a fresh one-session host. See SESSION_REACTIVATION.md.

Disable Active Reset stops new commands and asks the worker to shut down. It does not promise to unload the resident DLL. Restart LMU through Steam first revokes authorization, requests confirmation, closes only the verified modified game cooperatively, waits for all LMU instances and the reset worker to exit, then requests a new Steam launch. Unknown processes, failed discovery and timeouts block that launch. Sector cannot control launches made outside this application or guarantee that custom Steam options enable EAC.

A fresh process removes this process's memory modifications. This build does not back up or restore saved results, penalties, preferences or other game data; it cannot reproduce an entire previous running session or undo a previous detection.

## Distributed components

Version: 1.0.1-offline.2. The Sector host DLL and both telemetry readers are compiled locally from the native sources in this fork. No native executable from the Sector release is included. The build uses official Zig 0.16.0 and the three SDK headers copied read-only from an installed LMU version whose hashes match the pinned telemetry profile. The source-build receipt records native source, SDK and output hashes; packaging refuses stale or mismatching outputs.

Electron 44.8.0 Windows x64 and CPython 3.13.12 embedded x64 remain official third-party distributions verified during the audit. They are not Sector code. Packaging changes Electron's icon/version/manifest resources. The executable remains unsigned. Runtime hashes are checked at startup against the bundled inventory; extra code files and links are refused. Generated unique copies of the exact host DLL are permitted; work/log directories remain writable. Python bytecode caching is disabled. These checks do not defend against a fully compromised Windows account or modified package trust root.

The native diagnostic passed 24 self-tests, the overlay reader passed its self-test, and all 15 core build/test scripts completed on owned fixture processes. The host fixture was compiled, but scenarios needing a recorded `saved.frame` were not run. Fixture success does not establish live-game behavior or publisher approval.

## Local rebuild

The prepared checkout retains dependencies, official Electron, pinned Python archive, source-built native binaries, their receipt and compatibility profiles in ignored directories. From the repository root, run PowerShell 7:

```powershell
./scripts/build/Build-OfflineLocal.ps1
```

The script preserves existing release folders and refuses to overwrite the same version. Move a previous output deliberately before rebuilding that version. No publishing, game execution, antivirus exclusions or EAC changes are performed by this build script.

To rebuild the native components, use official Zig 0.16.0 and a verified local telemetry profile:

```powershell
./scripts/build/Build-OfflineNative.ps1 -ZigPath '<official-zig>/zig.exe' -LmuPath '<LMU-installation>' -TelemetryProfile '<local-telemetry-profile.json>'
```

The script copies only the three SDK headers, verifies the game/profile hashes, compiles the Sector native components and runs their available offline tests. It does not launch LMU. SDK snapshots, game files, profiles, toolchains, captures, receipts and binaries are private local build inputs and must not be committed. A fresh source-only checkout additionally needs Node 22.12+, `npm ci --ignore-scripts`, the official Electron distribution and the pinned Python archive.

## Validation limits

Unit tests model process/context transitions without launching LMU. No live reset, EAC transition, online session or gameplay rollback has been tested. The packaged GUI smoke test requires an interactive environment able to start sandboxed Electron. The sandboxed Codex process could not start Electron, but the packaged preview passed when launched outside that execution sandbox, with the Chromium renderer sandbox still enabled. Preview tests refused game, reset and Steam actions and confirmed no reset worker. No explicit antivirus scan has completed, and no files have been explicitly uploaded to an analysis service.
