# 70 - Per-frame cost of geodesic rebuilds

Status: open; re-verified 2026-10-28. Implemented by job 27, which ended "done, needs review"; see the Report in `.agents/jobs/_done/27_geodesic_rebuild_performance.md`.

Priority: P2 (performance + design). Complements issue 38 (decompose monoliths) with a concrete cut for this file.

Jobs: [27](../.agents/jobs/27_geodesic_rebuild_performance.md).

## Status update 2026-10-29

Job 27 was rewritten against commit `0b468e1` with re-verified evidence; the line numbers below are stale. Corrections:
a carry frame runs two intersection passes per incident locked interval (not one plus a removal elsewhere), the
`{...input}` spread per trace step is gone (job 15), and a crossing that lies exactly on a portal side is reported
twice, once per cell, rather than missed (merged issue-41 item). Item 4 needs no code (job 15 caches inverse portal
transforms; job 26 builds a sleeve once per pair). The module directory is `src/world-objects/geodesic/` (job 25).

## Status update 2026-10-28

Nothing has been done. `getGeodesicSegments` still copies the registry (`src/world-objects/geodesicCannon.ts:1037-1045`),
`removeGeodesicSegments` still recomputes all intersections (`:5403-5408`), the registry has only the
`objectIdsByCellId` index (`src/world-objects/runtimeObjectRegistry.ts:159`), there is no structured preview result,
no precomputed inverse portal transforms, and no `geodesics/` directory. The file has grown from 5,812 to 5,942 lines.
The facts below are corrected to the current code: `getGeodesicSegments` has 42 call sites and
`updateGeodesicIntersectionObjects` 26 in the file; the suite has 85 test files.

Merged 2026-10-28: the module split that this issue used to propose is now tracked only in issue
[76](../.agents/jobs/25_split_geodesic_cannon_modules.md). This issue keeps the performance items.

## Summary

Every carry frame and every curve-shortening tick rebuilds geodesics through helpers that scan and copy the whole
registry, and recompute all pairwise segment intersections several times per rebuild. Failure paths re-trace the
same arc up to three times. The 5,942-line `geodesicCannon.ts` mixes the pure kernel with registry mutation and
legacy code, so this cost and the bugs in issues 66-69 are hard to see.

## Evidence

- `getGeodesicSegments` (`src/world-objects/geodesicCannon.ts:1037-1045`) does `registry.getAll()` (an array copy,
  `src/world-objects/runtimeObjectRegistry.ts:247-249`), then two filters and a sort, on every call. There are 42
  call sites in the file, including inside per-pair tick code (`:3708`, `:4043`) and the hot carry path.
- `removeGeodesicSegments` (`:5403-5408`) calls `updateGeodesicIntersectionObjects`. That function is O(S²) over all
  segments (`:5589-5635`), removes and re-adds every intersection object, builds `toFixed` string keys, and matches
  identities in O(I·I_prev) (`:5677-5701`). The function is called 26 times in the file. A single curve-shortening
  tick commit calls it once per arc (`:3872`) and again at the end (`:3887`). Carry calls it per incident geodesic
  per frame (`rebuildLockedGeodesicFromEndpointsAndPortalWord`, `:2073`, plus the removal inside the segment
  replacement).
- Failed tick: `previewRebuildGeodesicInterval`, then `previewGeodesicIntervalIsDegenerate`, then
  `previewGeodesicIntervalHitsForbiddenZone` (`:3786-3833`, `:4452-4513`). Each lifts and/or traces the same arc
  again. `lockedIntervalRebuildHitsForbiddenZone` (`:1754-1792`) repeats the rebuild trace after a failed rebuild
  (`:3152`).
- `findGeodesicIntersections` compares pairs across all cells and only then rejects `left.cellId !== right.cellId`.
- Allocation: every trace step spreads `{...input}` (`:1497`) and allocates new Vec3s. Lifts invert transforms each
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

## Acceptance criteria

- Benchmark test (vitest, no rendering): 200 segments, one carried emitter incident to 10 loops. One carry frame
  performs ≤ 1 intersection pass and ≤ 1 trace per incident interval.
- `getGeodesicSegments` no longer calls `getAll()`.
- The existing test files (85 on 2026-10-28) pass unchanged.

## Merged from issue 41 (2026-10-28)

- `updateGeodesicIntersectionObjects` is a full O(n²) scan (`TODO(issue 70)` at `geodesicCannon.ts:5240`) and does
  not pair segments across a portal boundary, so a crossing that lies exactly on a portal edge can be missed. Item 2
  above (bucket by cell) should handle the boundary case explicitly.

## Note from job 15 (2026-10-29)

- The portal nudge loop is gone (the multi-cell trace walks the developed segment once with `walkDevelopedSegment`) and
  the lift functions use cached inverse portal transforms (`inversePortalTransform`, a `WeakMap` keyed by portal).
  `findGeodesicIntersections` now also tests same-geodesic pairs two or more segments apart, so the O(n^2) scan has more pairs.
