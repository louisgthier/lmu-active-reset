# Checkpoint timer investigation

## Current behavior and evidence

Physical checkpoint restoration does not rewind LMU's session or lap clocks. `src/native/telemetry/diagnostic.cpp` reads `mCurrentET` and `mLapStartET` from the official shared-memory data. `src/native/telemetry/overlay_reader.cpp` exports session elapsed time, lap-start time, last/best laps and estimated lap time for presentation.

The writable scoring allowlist in `src/native/restore/lap_scoring_plan.c` covers specific four-byte sector/validity/failure fields. It does not admit the session clock, lap-start timestamps, split histories or reference-lap state. Their availability in shared memory is evidence that they can be read; it is not evidence of a supported command to change the game's authoritative timers.

## Native LMU timer

A reliable native rewind would require identifying the owning internal clock and all dependent lap/sector/reference histories for the pinned game build, verifying their lifetime and owner-thread synchronization, and supporting atomic restoration or compensation. Rewinding the global session clock alone could disturb other cars, session duration and scoring. Rewriting only the visible shared-memory copy would be temporary and would not repair the game's own delta. No unverified timer offsets or timer writes have been added.

## Sector-only practice timing

A separate Sector practice timer is feasible from read-only telemetry and acknowledged saves/restores. On a successful save, record a clock anchor and track-distance/lap identity; on a confirmed restore, start a new attempt at that checkpoint. Use simulation time, pause handling and identity changes rather than wall-clock time. Compare attempts at matching track distance against a recorded reference, invalidating samples at session changes, unexplained teleports, stale telemetry and wrong-direction movement.

That would provide a checkpoint-relative practice delta within Sector; it would not correct LMU's native HUD delta or official lap times. This investigation does not implement that separate overlay feature.
