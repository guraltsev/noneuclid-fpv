# Job 68 - Commit a deformation inside the engine step (phase 7)

Status: blocked on the maintainer: the engine API rows in "Questions" are not agreed in design 013. Split from job 30 on 2026-11-11.
Resolves: nothing fully; it finishes design 013 section 5.2 step 7 and section 9.1's `transformGeometry`, and removes
`render/three/geometryCommit.ts` from `legacyWorldWriters` (issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md)).

## Goal

A finished deformation step is applied by the world, not by the shell: at step phase 7, after every command and tick of the step,
the engine carries everything across the deformation map, bumps the geometry version, emits `world/geometryChanged`, and runs one more
derive pass in the new geometry (design 013 section 5.2; design 012 P8, P9). Modules move their own objects through a
`transformGeometry` hook. The shell only redraws on the event.

## Depends on

Job [30](30_deformation_rebuild_pipeline.md) (main-thread steps, in-place commit) and job [35](35_torus_family_as_teichmuller_space.md)
(the re-marking and the word re-derivation, which this job moves into the geodesic emitters module).

## What exists (2026-11-11)

- The shell commits at the start of its frame (`createThreeApp.ts`, `geometryCommit.commitReady()`), outside any step.
- `geometryCommit.commit` moves the player, the `objectHost` (creatures, static assets), flags and emitters, then runs
  `applyGeometryCommitComputedObjectPolicy`. Modules get no callback; their derive ticks see the registry changes in the next step.
- No `geometryVersion`, no `world/geometryChanged`, no module `transformGeometry` (`src/modules/placedFlags/module.ts` notes the gap).

## Questions for the maintainer (answer in design 013 before this job runs)

1. How a ready deformation reaches the engine: a proposed `engine.offerGeometry(snapshot, maps)` from the shell's session, applied at
   phase 7 of the next step; or the deformation session itself moves into the engine as a P9 job with a handle and a completion event.
2. Who moves what is not a module yet (the local player, creatures, static assets): a host hook the shell registers, called at phase 7,
   until creatures and locomotion move into the engine (013 section 16).
3. Whether a sweep steps once per tick (step length from the simulation's \(h\), as P8 implies) or once per frame as job 30 does.
4. The shape of `transformGeometry(ctx, maps)` on a module, and what `maps` exposes (`mapPoint`, `mapDirection`, `mapDisplacement`).

## Steps

To be written once the questions are answered. Expected: `geometryVersion` in the read view; `world/geometryChanged`; module
`transformGeometry` for `placedFlags`, `geodesicEmitters` (with job 35's word re-derivation) and `geodesicModel`; the derive pass at phase
7; tests of the event order of P8 (the step's events in the old geometry, then `geometryChanged`, then the snapshot in the new one).
