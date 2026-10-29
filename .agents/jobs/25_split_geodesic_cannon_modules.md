# Job 25 - Split geodesicCannon.ts and geodesicCannonTools.ts

Status: queued.
Former issue: 76 (converted to a job on 2026-10-28).

Priority: P1 (architecture). Concrete execution plan for the geodesic half of issue 38; coordinate legacy removal with
issues 31/32 as 38 requires.

## Status update 2026-10-28

No stage has started. `src/world-objects/geodesic/` does not exist, `src/math/vec2.ts` does not exist, and
`geodesicCannonTools.ts` still lives in `render/three` and imports `three`. `geodesicCannon.ts` has grown again, to 5,942
lines and 108 exports; `tests/world-objects/geodesicCannon.test.ts` is 3,111 lines. The line ranges in the table below
are updated to the current file.

Issues 31 and 32 were closed on 2026-10-28: the endpoint model and Phase F are in place, and the Phase F tests that are
still missing moved to issue 67 ("Carried over from issues 31 and 32"). Stage 5's precondition now refers to that list.
Note for stage 2: the new tie/detach entry points `tieAndDetachIncidentGeodesics` (`:3272`, which falls back to the
legacy path) and `tieAndDetachGeodesicEndpoints` (`:3321`) sit between legacy functions; only
`tieAndDetachIncidentGeodesicsLegacy` and what it alone uses belong in `legacyConnection.ts`. Issue 70 proposes the same
split with slightly different module names; do it once.

## Summary

`src/world-objects/geodesicCannon.ts` is 5,942 lines (5,812 on 2026-10-08; issue 38 recorded 4,533 on 2026-08-03: it has
grown 31% since the split was requested). It holds seven distinct concerns behind one module with 108 exports. Its controller,
`src/render/three/geodesicCannonTools.ts` (1,308 lines), is a domain state machine (rotate / aim / carry / tie-and-detach)
that touches Three.js in only ~9 lines, yet lives in `render/three`. Below is a file-level target with line ranges so
the work can be done as mechanical moves first, behavior changes later.

## Evidence

Concerns in `src/world-objects/geodesicCannon.ts` (line ranges as of 2026-10-28):

| Concern | Lines | Examples |
| --- | --- | --- |
| Object types, constants, constructors, type guards | 99-798 | `GeodesicIntervalObject` :190, `CurveShorteningPairObject` :209, constants :555-597, `create*Object` :604-798, `is*Object` :677-706 |
| Endpoint attachment / lifting | 800-1036, 1852-1906 | `liftGeodesicEndpoint` :925, `replaceGeodesicEndpointAttachment` :827 |
| Ray tracing through portals | 1242-1708 | `traceGeodesicSegment` :1270, `traceGeodesicFromLiftedChord` :1530, `aimFreeGeodesicFromEndpoint` :1591 |
| Portal-word algebra | 887-924, 2086-2527, 4219 | `getGeodesicPortalWord` :887, `reverseGeodesicPortalWord` :901, `reduceAdjacentInversePortalTraversals` :2503, `portalTraversalsAreInverse` :2518 |
| Interval rebuild / split | 1709-2251, 2600-2721 | `rebuildLockedGeodesicFromEndpointsAndPortalWord` :2026, `splitGeodesicIntervalAtSegmentHit` :1907 |
| Legacy emitter connection / straightening | 2742-3271, 3415-3627, 4517-5072, 5410-5588 | `syncLegacyEmitterGeodesicFields` :2742, `connectGeodesicToEmitter` :3035, `tieAndDetachIncidentGeodesicsLegacy` :3415, `advanceStraighteningGeodesics` :3495, `markStraighteningGeodesic` :4771, `markGeodesicConnected` :5454 |
| Curve shortening | 3272-3414, 3598-4516 | `tieAndDetachGeodesicEndpoints` :3321, `advanceCurveShorteningPairs` :3628, `fuseCurveShorteningPair` :3906, `cleanupCurveShorteningPreviewFailure` :4348 |
| Intersection balloons (with module-level `WeakMap` memory) | 593, 5243-5801 | `updateGeodesicIntersectionObjects` :5243, `intersectHorizontalSegments` :5763 |
| Private 2D/3D helpers duplicating `src/math` | 5870-5942 | `cross2` :5940, `distanceSquared` :5933 (also in `measureLengthTool.ts:214`, `aimTarget.ts:1122`, `runtimeSceneUtils.ts:128`) |

`src/render/three/geodesicCannonTools.ts`: tool state `GeodesicCannonToolState` :82, a 75-line `deps` interface :106-183,
mode transitions `startGeodesicCannonRotation` :441 / `Aim` :474 / `Carry` :509 / `TieAndDetach` :667, carried-portal-word
bookkeeping :913-1016. Only the carry glow (:1048-1070) is rendering.

## Proposed change

Target layout (all under `src/world-objects/geodesic/`, re-exported from a thin `geodesicCannon.ts` facade during the
transition so callers and tests do not change in the same commit):

```text
geodesic/objects.ts          types, constants, create*/is* (99-798)
geodesic/endpoints.ts        attachment, lifting, endpoint selection (800-1036, 1852-1906)
geodesic/trace.ts            traceGeodesicSegment*, findNearestEmitterHitOnTrace, aim-from-endpoint (1242-1708)
geodesic/portalWord.ts       portal-word type + reverse/reduce/compare/update-for-moved-endpoint (pure; no registry)
geodesic/intervals.ts        rebuild/split/preview of intervals and derived segments
geodesic/curveShortening.ts  tie/detach, advance/fuse/absorb/cleanup (3272-3414, 3598-4516)
geodesic/intersections.ts    intersection balloons; replace the module-level WeakMap (:593) with a field on the registry
geodesic/legacyConnection.ts every *Legacy*, straightening and emitter-connection function (to be deleted per 31/32/38)
src/math/vec2.ts             cross2/dot2/sub2/... (also used by staticPortalPathCull.ts, see 78)
```

`geodesicCannonTools.ts` becomes `src/world-objects/geodesic/cannonToolMachine.ts`: a pure
`step(state, registry, input) -> { state, effects }` reducer (effects = `{ kind: "set-glow", cannonId } | ...`);
`render/three/geodesicCannonTools.ts` keeps only the glow mesh and applies effects.

Stages (each a separate PR, behavior-preserving, full test suite green):

1. Mechanical move of `objects.ts`, `portalWord.ts`, `trace.ts` + facade. No logic edits.
2. Move `legacyConnection.ts` and make it the *only* importer of straightening/connection state; add a docs-check rule
   (or `layering-baseline`-style list) that nothing new imports it.
3. Move `intervals.ts`, `curveShortening.ts`, `intersections.ts`.
4. Extract `cannonToolMachine.ts` with contract tests driven by a fake registry (no Three.js).
5. Delete `legacyConnection.ts` once the endpoint/curve-shortening tests listed in issue 67 ("Carried over from issues 31
   and 32") exist; delete the facade.

## Acceptance criteria

- No file under `src/world-objects/geodesic/` exceeds ~1,000 lines; `geodesicCannon.ts` is gone or a <50-line facade.
- `portalWord.ts` and `trace.ts` import only `math`, `cell-complex`, `movement` and `geodesic/objects.ts`.
- The tool state machine has tests in `tests/world-objects/` that run without `three`.
- `tests/world-objects/geodesicCannon.test.ts` (3,111 lines) is split to mirror the new modules.

## Merged from issue 70 (2026-10-28)

Issue 70 proposed the same split. Its additions are kept here:

- A separate `geodesic/development.ts` for lift, sleeve construction and the funnel/taut string of issue
  [67](../../_issues/67_exact_curve_shortening_via_sleeve_funnel.md), between `portalWord.ts` and `intervals.ts`.
- `portalWord.ts` also owns the chain check, the anchor-crossing update with conjugation (issue
  [68](../../_issues/_closed/68_loop_endpoint_crossing_must_conjugate_portal_word.md)) and the holonomy of a word.
- `trace.ts` also owns the disk predicate (issue 69).
- The pure modules import nothing from `world-objects/runtimeObjectRegistry` or `render/`, enforced by the layering
  check in `scripts/docs`.

Issue [70](../../_issues/70_geodesic_module_performance_and_split.md) keeps the performance work (segment index, once-per-frame intersections, structured preview results,
cached inverse transforms).
