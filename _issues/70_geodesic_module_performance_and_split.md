# 70 - Per-frame cost of geodesic rebuilds and splitting geodesicCannon.ts along mathematical lines

Status: open as of 2026-10-08.

Priority: P2 (performance + design). Complements issue 38 (decompose monoliths) with a concrete cut for this file.

## Summary

Every carry frame and every curve-shortening tick rebuilds geodesics through helpers that scan and copy the whole
registry, and recompute all pairwise segment intersections several times per rebuild. Failure paths re-trace the
same arc up to three times. The 5,812-line `geodesicCannon.ts` mixes the pure kernel with registry mutation and
legacy code, so this cost and the bugs in issues 66-69 are hard to see.

## Evidence

- `getGeodesicSegments` (`src/world-objects/geodesicCannon.ts:1030-1038`) does `registry.getAll()` (an array copy,
  `src/world-objects/runtimeObjectRegistry.ts:247-249`), then two filters and a sort, on every call. There are 42
  call sites in the file, including inside per-pair tick code (`:3686`, `:3993`) and the hot carry path.
- `removeGeodesicSegments` (`:5273-5278`) calls `updateGeodesicIntersectionObjects`. That function is O(S²) over all
  segments (`:5459-5505`), removes and re-adds every intersection object, builds `toFixed` string keys, and matches
  identities in O(I·I_prev) (`:5547-5571`). The function is called 26 times in the file. A single curve-shortening
  tick commit calls it once per arc (`:3827`) and again at the end (`:3842`). Carry calls it per incident geodesic
  per frame (`rebuildLockedGeodesicFromEndpointsAndPortalWord`, `:2066`, plus the removal inside the segment
  replacement).
- Failed tick: `previewRebuildGeodesicInterval`, then `previewGeodesicIntervalIsDegenerate`, then
  `previewGeodesicIntervalHitsForbiddenZone` (`:3759-3800`, `:4242-4259`). Each lifts and/or traces the same arc
  again. `lockedIntervalRebuildHitsForbiddenZone` (`:1747-1785`) repeats the rebuild trace after a failed rebuild
  (`:3137-3142`).
- `findGeodesicIntersections` compares pairs across all cells and only then rejects `left.cellId !== right.cellId`.
- Allocation: every trace step spreads `{...input}` (`:1489`) and allocates new Vec3s. Lifts invert transforms each
  time.

Scale example: 10 locked torus loops × 20 segments = 200 segments, about 20k segment-pair tests per intersection
pass. With 3-5 passes per frame while carrying an emitter incident to all of them, that is roughly 100k tests plus
registry churn per frame, before rendering.

## Proposed change

Performance:
1. Index segments by `geodesicId` in the registry (secondary index like `objectIdsByCellId`), or keep the derived
   chain on a side table keyed by interval id. `getGeodesicSegments` becomes O(chain).
2. Intersections: make them a dirty-flag recomputed **once per frame** by the frame loop, not inside mutation
   helpers. Bucket segments by `cellId` first (cost Σ n_c²), and use numeric keys.
3. Trace once: return a structured preview result `{ kind: "ok" | "degenerate" | "zone" | "wall" | "word-mismatch", traces }`
   so callers branch on it instead of re-tracing.
4. Precompute `T^{-1}` per portal in `compileCellComplex`, and cache developed sleeves per (startCell, word) while
   the geometry is unchanged.

Split (each module pure unless noted; the dependency order is top to bottom):
- `geodesics/trace.ts`: single-cell ray kernel, developed-frame multi-cell tracer, disk predicate (issue 69).
- `geodesics/portalWord.ts`: traversal type, inverse, reduce, chain check, anchor-crossing update with conjugation
  (issue 68), holonomy of a word.
- `geodesics/development.ts`: lift, sleeve construction, funnel/taut string (issue 67).
- `geodesics/intervalModel.ts` (registry): interval/free-end/pair objects, attachments, rebuild from (anchors, word),
  derived-segment building and half split.
- `geodesics/curveShortening.ts` (registry): pair state machine on top of `development.ts`.
- `geodesics/intersections.ts` (registry): vertex detection and identity continuity.
- `geodesics/legacy.ts`: `GeodesicEmitterConnection`, straightening, `tieAndDetachIncidentGeodesicsLegacy`,
  `markGeodesicConnected`, `syncLegacyEmitterGeodesicFields`, `resolveCarriedConnectedGeodesicPlan`. Delete it once
  issue 31's migration list is checked off.
- `geodesicCannon.ts` keeps only the emitter object, its placement, and re-exports.

## Acceptance criteria

- Benchmark test (vitest, no rendering): 200 segments, one carried emitter incident to 10 loops. One carry frame
  performs ≤ 1 intersection pass and ≤ 1 trace per incident interval.
- `getGeodesicSegments` no longer calls `getAll()`.
- The pure modules import nothing from `world-objects/runtimeObjectRegistry` or `render/`, enforced by the
  layering check in `scripts/docs`.
- `geodesicCannon.ts` is under 1,000 lines, and the existing 81 test files pass unchanged apart from import paths.
