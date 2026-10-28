# 76 - Split geodesicCannon.ts and geodesicCannonTools.ts along concrete seams

Status: open as of 2026-10-08.

Priority: P1 (architecture). Concrete execution plan for the geodesic half of issue 38; coordinate legacy removal with
issues 31/32 as 38 requires.

## Summary

`src/world-objects/geodesicCannon.ts` is 5,812 lines (issue 38 recorded 4,533 on 2026-08-03: it has grown 28% since the
split was requested). It holds seven distinct concerns behind one module with ~95 exports. Its controller,
`src/render/three/geodesicCannonTools.ts` (1,308 lines), is a domain state machine (rotate / aim / carry / tie-and-detach)
that touches Three.js in only ~9 lines, yet lives in `render/three`. Below is a file-level target with line ranges so
the work can be done as mechanical moves first, behavior changes later.

## Evidence

Concerns in `src/world-objects/geodesicCannon.ts` (line ranges are current):

| Concern | Lines | Examples |
| --- | --- | --- |
| Object types, constants, constructors, type guards | 97-800 | `GeodesicIntervalObject` :188, `CurveShorteningPairObject` :207, constants :548-584, `create*Object` :597-790, `is*Object` :670-695 |
| Endpoint attachment / lifting | 793-1030, 1845-1900 | `liftGeodesicEndpoint` :918, `replaceGeodesicEndpointAttachment` :820 |
| Ray tracing through portals | 1235-1600 | `traceGeodesicSegment` :1263, `traceGeodesicFromLiftedChord` :1523, `aimFreeGeodesicFromEndpoint` :1584 |
| Portal-word algebra | 880-918, 2079-2520, 4114 | `getGeodesicPortalWord` :880, `reverseGeodesicPortalWord` :894, `reduceAdjacentInversePortalTraversals` :2496, `portalTraversalsAreInverse` :2511 |
| Interval rebuild / split | 1702-2245, 2589-2711 | `rebuildLockedGeodesicFromEndpointsAndPortalWord` :2019, `splitGeodesicIntervalAtSegmentHit` :1900 |
| Legacy emitter connection / straightening | 2731-3484, 3404, 3484-3613, 4387-4876, 5280-5431 | `syncLegacyEmitterGeodesicFields` :2731, `connectGeodesicToEmitter` :3024, `tieAndDetachIncidentGeodesicsLegacy` :3404, `advanceStraighteningGeodesics` :3484, `markStraighteningGeodesic` :4641, `markGeodesicConnected` :5324 |
| Curve shortening | 3613-4360 | `advanceCurveShorteningPairs` :3613, `fuseCurveShorteningPair` :3861, `cleanupCurveShorteningPreviewFailure` :4242 |
| Intersection balloons (with module-level `WeakMap` memory) | 586, 5113-5633 | `updateGeodesicIntersectionObjects` :5113, `intersectHorizontalSegments` :5633 |
| Private 2D/3D helpers duplicating `src/math` | 5740-5812 | `cross2` :5810, `distanceSquared` :5803 (also in `measureLengthTool.ts:214`, `aimTarget.ts:1122`, `runtimeSceneUtils.ts:99`) |

`src/render/three/geodesicCannonTools.ts`: tool state `GeodesicCannonToolState` :82, a 75-line `deps` interface :106-183,
mode transitions `startGeodesicCannonRotation` :441 / `Aim` :474 / `Carry` :509 / `TieAndDetach` :667, carried-portal-word
bookkeeping :913-1016. Only the carry glow (:1048-1070) is rendering.

## Proposed change

Target layout (all under `src/world-objects/geodesic/`, re-exported from a thin `geodesicCannon.ts` facade during the
transition so callers and tests do not change in the same commit):

```text
geodesic/objects.ts          types, constants, create*/is* (97-800)
geodesic/endpoints.ts        attachment, lifting, endpoint selection (793-1030, 1845-1900)
geodesic/trace.ts            traceGeodesicSegment*, findNearestEmitterHitOnTrace, aim-from-endpoint (1235-1600)
geodesic/portalWord.ts       portal-word type + reverse/reduce/compare/update-for-moved-endpoint (pure; no registry)
geodesic/intervals.ts        rebuild/split/preview of intervals and derived segments
geodesic/curveShortening.ts  advance/fuse/absorb/cleanup (3613-4360)
geodesic/intersections.ts    intersection balloons; replace the module-level WeakMap (:586) with a field on the registry
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
5. Delete `legacyConnection.ts` once issue 31/32 tests cover endpoint/curve-shortening behavior; delete the facade.

## Acceptance criteria

- No file under `src/world-objects/geodesic/` exceeds ~1,000 lines; `geodesicCannon.ts` is gone or a <50-line facade.
- `portalWord.ts` and `trace.ts` import only `math`, `cell-complex`, `movement` and `geodesic/objects.ts`.
- The tool state machine has tests in `tests/world-objects/` that run without `three`.
- `tests/world-objects/geodesicCannon.test.ts` (2,834 lines) is split to mirror the new modules.
