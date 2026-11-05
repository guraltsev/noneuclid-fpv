# 94 - Removing a geodesic writes measurement records from whichever module called it

Status: open.

Priority: P3 (the write guard throws; with the guard off, as in the normal app, the behaviour is right). Found 2026-11-05.

Jobs: [64](../.agents/jobs/64_emitter_edits_and_length.md).

## Problem

`removeGeodesicIntervalAndDerivedObjects` (`src/world-objects/geodesic/segments.ts`) deletes `geodesicMeasurements/length` and
`geodesicMeasurements/angle` records itself. It runs in the frame of whichever module caused the removal, and that module does not own those kinds.

- **Carry, reproduced.** Carrying an emitter onto the far end of its own locked geodesic makes the arc degenerate. The rebuild deletes the arc and its
  measurements, and with the guard on the step throws `module carry wrote "geodesicMeasurements/length"`. The defect predates the fast channel: the same
  action sequence fails on `92aa20d`. The seeded oracle test only reached it once the frame order changed. Fixed for now by listing the two kinds in
  carry's `writesCoreKinds`; the test "match fresh refreshes when a carry collapses a measured locked geodesic" pins it.
- **Geodesic model, by reading only, not run.** `removeVertex` calls the same function for a collapsed or duplicate merge, in the frame of
  `geodesicModel`, which does not declare the kinds either. A curve with a measurement should throw the same way with the guard on.

The measurement ticks already delete their own records when a refresh finds nothing left to measure, so the owner can do this work.

## Done when

- `removeGeodesicIntervalAndDerivedObjects` no longer touches measurement kinds, and the measurement ticks remove them. Legacy shell callers and tests that
  expect them gone at once change accordingly.
- No module lists another module's kinds in order to delete them. Job 64 removes `writesCoreKinds` from carry, so this must be settled there.
- A test of a flow that collapses a measured curve, with the guard on.
