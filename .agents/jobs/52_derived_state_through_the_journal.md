# Job 52 - Derive crossings, lengths and angles from the change journal

Status: queued.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirement 4).

## Goal

Derived state follows from what changed. The hand-written follow-up lists in the shell and the tools disappear: crossings,
measured lengths and protractor angles are derive ticks that read the journal.

## Depends on

Job 51.

## Before you start

- Own worktree and branch (`git worktree add ../noneuclid-job52 -b job-52 <branch with job 51>`).
- Read design 013: sections 2, 6.2 to 6.4, and job 52 in section 15.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

- `createThreeApp.ts:1261-1284` refreshes angles and lengths after the flow. Line numbers will have moved; find the block
  after the "curve shortening" phase.
- `geodesicCannonTools.ts` has five refresh sites.
- `src/runtime/worldGeometryComputedObjects.ts` holds a second, drifted copy of the refreshers.
- About 40 call sites use `requestGeodesicIntersectionUpdate` and `withDeferredGeodesicIntersections`.
- `refreshMeasuredGeodesicLengthObject` is in `measureLengthTool.ts`, `refreshProtractorAngleObject` in `protractorTool.ts`.

## Decisions

- A derive tick keeps a cursor, wakes by `subscribes` or `wants`, and reads `[cursor, length)` (6.4).
- Tick `geodesicModel/crossings` writes crossings.
- Tick `lengths` subscribes arcs and segments; `wants` is true when the local participant's cell or position changed
  (today's `measuredLengthsRefreshed` guard).
- Tick `angles` subscribes arcs and crossings, removes angles whose centre marker was removed, and writes an angle only
  when it changed.
- Both ticks use the pure world-objects refreshers.
- A deformation runs `transformGeometry` and one derive pass (step phase 7).
- Tests that read markers right after a mutation use a helper `runDerivePass(engine)` in `tests/support/`.
- Legacy direct writes still reach the journal, so ticks see them. Writes between frames stay until the next frame's
  readers have seen them (6.3).

## Steps

1. Tick `geodesicModel/crossings`. Delete `requestGeodesicIntersectionUpdate`, `withDeferredGeodesicIntersections` and their
   call sites. Add `runDerivePass`.
2. `src/modules/geodesicMeasurements/`: kinds renamed `geodesicMeasurements/length` and `geodesicMeasurements/angle`; ticks
   `lengths` and `angles`; declared in the experience after `geodesicModel`.
3. The render label runtimes sync from the journal. Delete the follow-up block in `createThreeApp.ts`, the five refresh
   sites in `geodesicCannonTools.ts`, the refresh half of `worldGeometryComputedObjects.ts`, and
   `requestSelectableHitboxDebugSync` after geodesic edits.
4. Move the bench's **flow+dependents** scene onto the derive pass.

## Tests and checks

- Each tick: wakes on a subscribed kind, stays asleep otherwise, reads each change once.
- An angle whose centre marker is removed is removed.
- Existing measurement and intersection tests keep their assertions; only the timing helper changes.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not re-record the bench baseline. If `--check` fails, find the cost.
- Do not keep a second refresher "for safety".

## Done when

- `grep -n "refreshProtractorAngles\|refreshMeasuredGeodesicLengths" src/render src/runtime` shows only the label runtime
  sync, and all checks are green.
