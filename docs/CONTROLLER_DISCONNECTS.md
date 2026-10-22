# Controller disconnect handling

The supplied diagnostics contained clean native shutdowns with status 3, no native error and restored hook prologues. One desktop event reported a failed offline-context check. The older generic stop reason did not distinguish a user stop from an unreadable or expired desktop authorization file, so it does not establish the precise cause of every disconnect.

The controller now distinguishes a confirmed non-Practice context from transport failure or incomplete local API data. Temporary transport/unknown results publish a writes-disabled lease with the original deadline and pause the worker. Successful fresh process, EAC and context verification can resume within that deadline. No new authority is granted while context is unknown; prolonged failure still expires and stops. Pending commands/preparation are canceled and keys must be released before new input.

A Windows permission/missing-file replacement race gets at most one 10 ms read retry. Input permission is revoked before the retry. Only a successful parse and validation of the actual file can recover; cached permission, malformed leases, expired leases and extended deadlines are not accepted. The concrete controller stop reason is recorded in worker status, summary and desktop diagnostics.

This reduces disconnects from brief verification and file-sharing failures. It does not eliminate legitimate safety stops, game exits, native quarantine, process changes, persistent I/O failure or prolonged unavailable context. Fixture tests verify pause/recovery and expiry; no live-game test was performed during development.
