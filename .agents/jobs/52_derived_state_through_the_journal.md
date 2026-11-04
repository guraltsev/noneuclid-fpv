# Job 52 - Derive crossings, lengths and angles from the change ring

Status: queued.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirement 4).

## Goal

Derived state follows from what changed. The hand-written follow-up lists in the shell and the tools disappear: crossings,
measured lengths and protractor angles are derive ticks that read the journal.

## Depends on

Job 60 (and with it the ring of job 57 and the counters of job 56).

## Before you start

- Read design 013: sections 2, 6.2 to 6.4, and job 52 in section 15. Read design 014: D9, D12, D13 and section 9, which amend 013.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

- `createThreeApp.ts:1261-1284` refreshes angles and lengths after the flow. Line numbers will have moved; find the block
  after the "curve shortening" phase.
- `geodesicCannonTools.ts` has five refresh sites.
- `src/runtime/worldGeometryComputedObjects.ts` holds a second, drifted copy of the refreshers.
- About 40 call sites use `requestGeodesicIntersectionUpdate` and `withDeferredGeodesicIntersections`.
- `refreshMeasuredGeodesicLengthObject` is in `measureLengthTool.ts`, `refreshProtractorAngleObject` in `protractorTool.ts`.
- The flow still runs in the shell after `engine.step` until job 53. Since job 57 its writes reach the next derive pass, so during this job
  crossings and labels of a flowing curve are one frame behind. That is accepted.
- `updateGeodesicIntersectionObjects` removes and re-adds every marker on each call, so the crossings tick writes on every pass that wakes.
  Leave that as it is.

## Decisions

- A derive tick keeps a cursor, wakes by `subscribes` or `wants`, and reads `[ctx.changesFrom, ctx.changesTo)`: absolute sequence numbers, read
  through `ctx.objects.changes.ring` (014 section 9). Crossings, lengths and angles are **materialized** records (014 D9): they stay in the
  registry because clients draw them.
- Tick `geodesicModel/crossings` writes crossings.
- Tick `lengths` subscribes arcs and segments; `wants` is true when the local participant's cell or position changed
  (today's `measuredLengthsRefreshed` guard).
- Tick `angles` subscribes arcs and crossings, removes angles whose centre marker was removed, and writes an angle only
  when it changed.
- Both ticks use the pure world-objects refreshers.
- A deformation runs `transformGeometry` and one derive pass (step phase 7).
- Tests that read markers right after a mutation use a helper `runDerivePass(engine)` in `tests/support/`.
- Legacy direct writes reach the ring, so ticks see them, including writes made between `step` and `endFrame` (014 section 9).
- `geodesicIntersectionMemoryByRegistry` is keyed by the registry object. With the write guard on, a tick holds a copy of the registry, so the
  memory would split. Key it by `registry.changes` instead; the same goes for `geodesicIntersectionDeferralByRegistry` until step 1 deletes it.
- The local player's position is an input of a length, and a cache may not depend on a participant (014 D13). This is why `lengths` is a tick
  with `wants`.

## Steps

1. Tick `geodesicModel/crossings`. Delete `requestGeodesicIntersectionUpdate`, `withDeferredGeodesicIntersections` and their
   call sites. Add `runDerivePass`.
2. `src/modules/geodesicMeasurements/`: kinds renamed `geodesicMeasurements/length` and `geodesicMeasurements/angle`; ticks
   `lengths` and `angles`; declared in the experience after `geodesicModel`.
3. The render label runtimes sync from the journal. Delete the follow-up block in `createThreeApp.ts`, the five refresh
   sites in `geodesicCannonTools.ts`, the refresh half of `worldGeometryComputedObjects.ts`, and
   `requestSelectableHitboxDebugSync` after geodesic edits.
4. Move the bench's **flow+dependents** scene onto the derive pass: it gets an engine with the modules, and `legacyStep` loses its refresh loops.
5. `npm run bench -- moduleStep --check`, then `--record-counters`. This job may raise `writes` and scans in `flow+dependents` only, and only by what
   the tick pass does; name each risen number under `### Deviations`. `flow` and `manyArcs` must not rise.

## Tests and checks

- Each tick: wakes on a subscribed kind, stays asleep otherwise, reads each change once.
- An angle whose centre marker is removed is removed.
- Existing measurement and intersection tests keep their assertions; only the timing helper changes.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not re-record the timing baseline. If `--check` fails on a counter, the printed line names the cost. On timing, use the coordinator's rule.
- Do not keep a second refresher "for safety".

## Done when

- `grep -n "refreshProtractorAngles\|refreshMeasuredGeodesicLengths" src/render src/runtime` shows only the label runtime
  sync, and all checks are green.
