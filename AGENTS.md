# Project instructions

- Write code, identifiers, comments, docstrings, configuration guidance and development documentation in English.
- Rebuild Sector's native host and both readers from source with official Zig 0.16.0. Use `scripts/build/Build-OfflineNative.ps1` with a verified local telemetry profile and the SDK headers from the user's LMU installation. Packaging requires the matching local source-build receipt. Do not substitute native binaries from a Sector release.
- Keep SDK headers, game executables, local profiles, installation paths, captures, logs, toolchains, build receipts, binaries and packages out of Git. Inspect the staged diff and file inventory before every push. Use a GitHub noreply identity when committing public changes.
- Active Reset must start disabled. Activation requires an explicit request, a fresh Sector-owned process identity, verified offline context and EAC absence. Unknown state, discovery errors, expired authorization and changed identity must revoke writes.
- Treat a process which may have loaded the host as modified until its exit is verified. Disabling commands is not proof of DLL unload or data rollback. Do not automatically re-admit a different session in that process.
- Run fixture/self-tests and an explicitly isolated preview without starting LMU, injecting into a game, disabling antivirus or changing EAC. Live-game tests require separate explicit scope. Never claim a guarantee against bans or malware.
- Use `scripts/install/Install-OfflineLocal.ps1` for the stable per-user installation. Preserve the executable path and app identity across updates. Keep backups and build intermediates under ignored workspace directories, and preserve user preferences outside the installation folder.
