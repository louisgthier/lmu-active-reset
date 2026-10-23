# Checkpoint timer investigation

## Current behavior and evidence

Physical checkpoint restoration does not rewind LMU's session or lap clocks. `src/native/telemetry/diagnostic.cpp` reads `mCurrentET` and `mLapStartET` from the official shared-memory data. `src/native/telemetry/overlay_reader.cpp` exports session elapsed time, lap-start time, last/best laps and estimated lap time for presentation.

The writable scoring allowlist in `src/native/restore/lap_scoring_plan.c` covers specific four-byte sector/validity/failure fields. It does not admit the session clock, lap-start timestamps, split histories or reference-lap state. Their availability in shared memory is evidence that they can be read; it is not evidence of a supported command to change the game's authoritative timers.

## Native LMU timer

A reliable native rewind would require identifying the owning internal clock and all dependent lap/sector/reference histories for the pinned game build, verifying their lifetime and owner-thread synchronization, and supporting atomic restoration or compensation. Rewinding the global session clock alone could disturb other cars, session duration and scoring. Rewriting only the visible shared-memory copy would be temporary and would not repair the game's own delta. No unverified timer offsets or timer writes have been added.

## Sector practice timing (implemented)

The existing Delta overlay switches to checkpoint practice timing after an acknowledged save. Enable overlays and the Delta widget to see it. Drive the first reference attempt and press Restore at the desired end of the section. That first valid restore fixes the finish distance (at least five metres beyond the checkpoint). Subsequent attempts compare against the fastest completed attempt at matching track distance, interpolating between telemetry samples. An early reset does not replace the record or move the finish. A new checkpoint or session discards the finish and record.

The clock and delta freeze at the interpolated finish crossing, even if the car continues moving. During an attempt the delta is green when faster and red when slower. At the finish, a new record shows FINISHED - NEW BEST in violet; other completed attempts show FINISHED with the frozen delta. Remaining distance is shown before the finish. A new record becomes the reference for the next attempt, so the completed attempt's displayed delta remains relative to the record it was chasing.

Only acknowledged saves and restores affect timing. Rejected requests and duplicate status events cannot reset the timer. Simulation elapsed time excludes explicit pauses. Discontinuous time, reverse driving, unrelated teleports, stale samples, session/car changes and a bounded recording limit invalidate timing instead of inventing a comparison. No delta is extrapolated beyond a reference. The timing model is separate from overlay lap history so an acknowledged rewind does not erase the practice reference.

The live distance uses the reader's bounded position projection between scoring updates, paired with its telemetry timestamp. If projection is unavailable, both distance and clock fall back to the scoring sample together. This avoids advancing the clock while comparing against a distance that has not updated. Reference interpolation runs on every usable live frame; it does not reset the delta at scoring boundaries.

Telemetry may show a restore before its status acknowledgement. A pre-teleport attempt and the first landing sample are retained for at most 1.5 seconds, and used only after an acknowledged restore in the same checkpoint/session. Rejected or expired candidates cannot establish a reference. Missing telemetry invalidates the interrupted attempt without erasing an existing checkpoint best. An explicit checkpoint removal or session/car change still clears it.

This is read-only, telemetry-based practice timing, not authoritative LMU timing. The zero point is the first fresh usable sample after acknowledgement, or the recent observed landing if telemetry arrived first. Controller and telemetry latency still affect repeatability and distance alignment. Millisecond formatting does not imply millisecond checkpoint accuracy. Track-distance matching also does not detect every off-track shortcut. Game HUD delta, official lap times and native session clocks remain unchanged.
