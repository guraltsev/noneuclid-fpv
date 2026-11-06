# Job 66 - Move the measurement tools and the flags into modules

Status: in progress.
Resolves: issue [92](../../_issues/92_measurement_kinds_are_declared_transient.md).

## Goal

The length tool, the protractor and the flags reach the world through commands, as the emitters do.

## Depends on

Job 64.

## Before you start

- Read 013 sections 8.3, 9, 11 and 16, and 014 section 2.1. Read `src/render/three/runtimeObjectActions.ts` and `toolObjectRuntimes.ts`.

## Decisions

- `geodesicMeasurements` gains commands `createLength { arcId }`, `removeLength`, `createAngle { center, first, second }`, `removeAngle`, and a client
  part with the two tools. Ids move to `geodesicMeasurements/length:<n>` and `/angle:<n>`.
- Kinds stay materialized records, and are declared `saved`: their choices (geodesic, sides) are real, per 014 section 2.1, and their values
  are refreshed after a load. The contract test of 013 section 11 is written here.
- New module `placedFlags`: kind `placedFlags/flag`, commands `place`, `setMessage`, `remove`, a client part with the tool. It needs no ticks.
- `trackReads` stays on by default (014 D14).
- **An angle whose crossing vanishes is hidden, not deleted** (013 section 17, item 6). It returns with the crossing, and is deleted 3 s of world time after
  the aiming stops if the crossing has not returned. "The aiming stops" means the last edit or carry of either geodesic's emitter ended; with no such edit, the 3 s run from the moment the crossing vanished. Use the remembered-centre code. Test both ways: the crossing returns in time; it does not.
- The flag branch of `geometryCommit.ts` stays until the deformation job.

## Steps

1. Measurement commands and tools; each command's refusal; the kinds' declarations; the contract test.
2. `placedFlags`.
3. The list of direct client writes falls; record it in the Report.

## Tests and checks

Existing measurement assertions on values stay. Smoke, release, bench counters.

## Do not

Do not touch the deformation or creatures. Do not decide what happens to an angle whose crossing vanishes: see the open question in 013.

## Done when

`runtimeObjectActions.ts` and `toolObjectRuntimes.ts` no longer write the registry, except what a named later job owns.
