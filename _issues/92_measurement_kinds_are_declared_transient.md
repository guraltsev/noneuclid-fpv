# 92 - Measurement kinds are declared transient, so a save would lose what the person placed

Status: open; done in code by job 66 (done, needs review). Closes when the maintainer accepts job 66's Report. Re-verified 2026-11-11.

Priority: P3 (no save format exists yet; fix the declaration before one does). Found 2026-11-05.

Jobs: [66](../.agents/jobs/_done/66_measurement_tools_and_flags.md).

## Status update 2026-11-11

Nothing left but the review and a desktop look at the measurement tools.

## Problem

`geodesicMeasurementsModule` declares `geodesicMeasurements/length` and `geodesicMeasurements/angle` as `cheap-derived` and
`transient`. Design 014 section 2.1 says part of each is real: which geodesic a length measures, which sides an angle spans.
Those are the person's choices and no derive tick can rebuild them. Under the rules of 013 section 11, a `transient` kind is neither
saved nor rebuilt, so a save would drop every measurement.

Section 11's contract test (every declared kind has a `label` and a `persistence`) was not written either; only the type enforces it.

## Done when

- The declarations match 014 section 2.1: the real part is saved, and the displayed values are rebuilt.
- The contract test of section 11 exists.

- Job 66 (2026-11-06): done, needs review; see the Report in [the job](../.agents/jobs/_done/66_measurement_tools_and_flags.md). Manual checks are not done, so this stays open.
