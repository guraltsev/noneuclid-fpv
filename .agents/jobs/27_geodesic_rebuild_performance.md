# Job 27 - Per-frame cost of geodesic rebuilds

Status: queued.
Rewritten on 2026-10-29 against commit `0b468e1` for a less capable implementing model.
Resolves: issue [70](../../_issues/70_geodesic_module_performance_and_split.md).

## Goal

Carrying an emitter and ticking curve shortening no longer rescan, copy and re-intersect the whole registry several
times per frame:

1. Geodesic code finds segments, cannons, intervals and pairs through registry indexes, never through
   `registry.getAll()`.
2. Intersection markers are recomputed **at most once** per public geodesic operation and at most once per carry frame
   (not once per helper call), comparing only segments in the same cell, and a crossing that lies exactly on a portal
   side is reported once.
3. A chord is traced at most once per interval per operation, also on the failure path.
4. A benchmark test pins this: 200 segments, one carried emitter incident to 10 loops, one carry frame does at most one
   intersection pass, at most 10 chord traces and no `getAll()` call.

## Depends on

[Job 25](25_split_geodesic_cannon_modules.md) (module paths) and [job 26](26_exact_curve_shortening.md) (the curve
shortening code measured here; job 26 deleted the descent and the legacy model). [Job 37](37_object_owners_and_place_at.md)
changed `runtimeObjectRegistry.ts` (ownership, a publisher function that re-indexes like `update`). Batch order: 37, 25,
26, then **27**.

Line numbers are at commit `0b468e1`, where all geodesic code was in `src/world-objects/geodesicCannon.ts`; jobs 25, 26
and 37 moved or changed it. **Search by name.** Module names below are job 25's.

## Before you start

| File | What |
| --- | --- |
| `src/world-objects/runtimeObjectRegistry.ts` | `createRuntimeObjectRegistry`: `objectsById`, `objectIdsByCellId` (:158-176), `add`/`update`/`remove`/`moveToCell`, `getAll` (:247-249, copies all values); job 37's `claimOwnership` publisher |
| `geodesic/segments.ts` | `getGeodesicSegments` (:1076-1084 at `0b468e1`: `getAll()`, two filters, sort), `getGeodesicTail`, `removeGeodesicSegments` (:5593-5598: removes, then a full intersection pass), `buildDerivedSegmentsFromTraces`, `resolveGeodesicNumber` / `getGlobalGeodesicNumbers` (:6019, scans all segments), `syncLegacyEmitterGeodesicFields`, `resolveEndpointTangentAtAnchor` |
| `geodesic/intersections.ts` | `updateGeodesicIntersectionObjects` (:5433-5456: removes every marker and re-adds), `findGeodesicIntersections` (:5779-5839: all pairs, cell check inside the double loop), `assignGeodesicIntersectionIdentities` / `findContinuityMatchedIntersection` (:5857-5901: every previous marker per new marker), `intersectHorizontalSegments` (:5963-6011, endpoints included with tolerance 1e-7), the memory `WeakMap` |
| `geodesic/intervals.ts` | `rebuildDerivedGeodesicSegments` (:1852), `traceGeodesicFromLiftedChord` (:1673), `lockedIntervalRebuildHitsForbiddenZone` (:1897-1935), `rebuildLockedGeodesicFromEndpointsAndPortalWord` (:2169-2219), `previewRebuildGeodesicInterval` (:2324-2380), `previewGeodesicIntervalHitsForbiddenZone` (:4642) |
| `geodesic/cannon.ts` | `rebuildConnectedGeodesicBetweenEmitters` (:3304-3338 after job 26 Part E) |
| `geodesic/curveShortening.ts` | `advanceCurveShorteningPairs`, `resolveCurveShorteningPair` (job 26) |
| `geodesic/trace.ts` | `traceGeodesicPathForConnectionMode` (the one multi-cell chord tracer) |
| `src/render/three/geodesicCannonTools.ts` | `updateCarriedGeodesicCannonPose` (:835), `rebuildCarriedGeodesicFromCannon` (:881-934, the per-frame carry loop), `syncTieAndDetachSelectionHighlights` (:790, `getAll`), `collectIncidentGeodesicIdsForCannon` (:1105, `getAll`), `getGeodesicTotalLengthMeters` (:1292, `getAll`) |
| `scripts/docs/lib.mjs` | `moduleImportRules` (job 25): `trace.ts` has a `mayImportOnly` list |
| `tests/world-objects/geodesic/fixtures.ts` | `compileTorusLoopWorld`, `compileWorld`, `createSegment`, `createCarryPortalTraversal` |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`. Record the counts.

## Background

Verified at `0b468e1` (issue 70's numbers are from 2026-10-28 and partly stale):

- `getGeodesicSegments` copies the registry with `getAll()` and filters on every call; `getGeodesicSegments(` occurs 44
  times and `updateGeodesicIntersectionObjects(` 27 times in `geodesicCannon.ts` (with the definitions); 20 `getAll()`
  calls. Job 26 removed some of them with the descent and the legacy model.
- **One carry frame** (`updateCarriedGeodesicCannonPose` → `rebuildCarriedGeodesicFromCannon`) with n incident locked
  intervals runs, per interval: `rebuildConnectedGeodesicBetweenEmitters` → `rebuildLockedGeodesicFromEndpointsAndPortalWord`
  → `rebuildDerivedGeodesicSegments` → one lift + **one chord trace** → `replaceDerivedSegmentsFromTraces` →
  `removeGeodesicSegments` (**intersection pass 1**) → `buildDerivedSegmentsFromTraces` (`resolveGeodesicNumber` scans all
  segments; `getGeodesicTail` copies the registry) → `syncLegacyEmitterGeodesicFields` (two `getGeodesicSegments`) →
  **intersection pass 2**. So 2n intersection passes and about 6n registry copies per frame, each pass O(S²) over all S
  segments. With 10 loops of 20 segments: 20 passes × about 20,000 pair tests.
- On a failed carry rebuild with `preserveGeodesicOnRebuildFailure` (the live carry), `rebuildConnectedGeodesicBetweenEmitters`
  calls `lockedIntervalRebuildHitsForbiddenZone`, which lifts and **traces the same chord again** (:3323).
- Job 26's `resolveCurveShorteningPair` previews each result interval and then rebuilds it, tracing each chord twice.
- `findGeodesicIntersections` compares all pairs and only then rejects different cells (:5795).
- Identity matching scans all previous markers for every new marker.
- **Portal-side crossings (merged from issue 41).** `intersectHorizontalSegments` includes segment endpoints (tolerance
  1e-7). Two geodesics that cross exactly on a portal side meet at the end of their segments in the source cell and at the
  start of their continuations in the target cell, so the crossing is reported **twice**, once per cell (issue 41 said
  "missed"; at `0b468e1` it is duplicated).
- Stale claims of issue 70: the per-step `{...input}` spread is gone (job 15); lifts already use cached inverse portal
  transforms (`inversePortalTransform`, job 15). Item 4's sleeve cache is not needed: job 26 develops a sleeve once per
  pair resolution, not per frame.
- Not in this issue but seen while verifying: `createThreeApp.ts` calls `refreshMeasuredGeodesicLengths()` every frame,
  which scans `getAll()` and recomputes every measurement (`toolObjectRuntimes.ts:221`). Leave it to job 29; mention it
  in the report.

## Decisions

1. **Registry indexes.** Decided: add to `RuntimeObjectRegistry`:

   ```ts
   /** Objects of one kind, in insertion order (a fresh array). */
   getObjectsOfKind<K extends RuntimeWorldObject["kind"]>(kind: K): readonly Extract<RuntimeWorldObject, { readonly kind: K }>[];
   /** The derived segments whose `geodesicId` is `geodesicId`, unsorted (a fresh array). */
   getSegmentsOfGeodesic(geodesicId: string): readonly GeodesicSegmentObject[];
   ```

   Backed by `objectIdsByKind: Map<string, Set<string>>` and `segmentIdsByGeodesicId: Map<string, Set<string>>`, kept in
   step in `add`, `update` (re-index when the kind or, for a segment, the `geodesicId` changed), `remove` and job 37's
   ownership publisher (it must use the same re-indexing code: put it in job 37's private `replaceObject(previous, next)`
   helper, through which `update`, `moveToCell` and every publisher already write, and in `add`/`remove`; job 28, which
   runs later, adds its version bump there too). Why: issue 70
   item 1 (a secondary index like `objectIdsByCellId`); the registry already imports the geodesic types.

2. **No `getAll()` in geodesic code.** Decided: every `registry.getAll()` in `src/world-objects/geodesic/**` that is
   followed by a filter on one `kind` becomes `getObjectsOfKind(kind)`; `getGeodesicSegments` becomes
   `getSegmentsOfGeodesic(id)` sorted by `segmentIndex`. The three calls in `geodesicCannonTools.ts` (:791, :1117,
   :1293) are replaced the same way (`:1293` by `getGeodesicSegments`). A `getAll()` that needs several kinds stays and is
   listed in the report. Why: the benchmark asserts zero `getAll()` calls in a carry frame.

   The one multi-kind scan on the carry path is `getGlobalGeodesicNumbers` (:6019-6070; its second loop needs cannons,
   segments and intervals in registry order, so it keeps `getAll()`). Decided: `resolveGeodesicNumber` first returns the
   `geodesicNumber` of an existing segment of that geodesic (via `getSegmentsOfGeodesic`) and only falls back to
   `getGlobalGeodesicNumbers`; `replaceDerivedSegmentsFromTraces` resolves the number **before** it removes the old
   segments and passes it to `buildDerivedSegmentsFromTraces` through a new optional input `geodesicNumber`. Effect: a
   rebuilt geodesic keeps its display number (today it can be renumbered to a lower free number when it is rebuilt,
   because its own segments are removed first). New geodesics are numbered exactly as before. Test A3 below pins it.

3. **One intersection pass per operation.** Decided, in `intersections.ts`:

   ```ts
   /** Marks markers stale; recomputes now unless a deferral scope is open for this registry. */
   export function requestGeodesicIntersectionUpdate(registry: RuntimeObjectRegistry): void;
   /** Runs `body`; inner update requests are coalesced into one `updateGeodesicIntersectionObjects` when the outermost scope exits (also on throw). */
   export function withDeferredGeodesicIntersections<T>(registry: RuntimeObjectRegistry, body: () => T): T;
   ```

   State: a module-level `WeakMap<RuntimeObjectRegistry, { depth: number; dirty: boolean }>` (keyed per registry like
   the marker memory). Every **internal** call of `updateGeodesicIntersectionObjects(registry)` in the geodesic modules
   becomes `requestGeodesicIntersectionUpdate(registry)`; the exported `updateGeodesicIntersectionObjects` keeps its
   behaviour (always recomputes) for tests and callers. Then wrap the body of every **exported** function that can reach
   a request in `withDeferredGeodesicIntersections`: at least `shootGeodesic`, `extendGeodesic`, `rebuildGeodesicToLength`,
   `connectGeodesicToEmitter`, `rebuildConnectedGeodesicBetweenEmitters`, `placeGeodesicCannonOnGeodesic`,
   `placeGeodesicCannonAtGeodesicVertex` (cannon.ts); `aimFreeGeodesicFromEndpoint`, `rebuildDerivedGeodesicSegments`,
   `traceGeodesicFromLiftedChord`, `splitGeodesicIntervalAtSegmentHit`, `rebuildLockedGeodesicFromEndpointsAndPortalWord`
   (intervals.ts); `removeGeodesic`, `removeUnlockedGeodesicsFromCannon`, `removeGeodesicCannonAndSegments`
   (lifecycle.ts); `removeGeodesicIntervalAndDerivedObjects` (segments.ts); `tieAndDetachGeodesicEndpoints`,
   `advanceCurveShorteningPairs`, `resolveCurveShorteningPair` (curveShortening.ts). Find any other with
   `git grep -n requestGeodesicIntersectionUpdate src` and the call graph. Callers therefore still see up-to-date markers
   when a public function returns. The carry loop in `geodesicCannonTools.ts#rebuildCarriedGeodesicFromCannon` wraps its
   whole body in one scope, so a carry frame has one pass. Why: issue 70 item 2 asks for one pass per frame; a scope keeps
   every public function's contract ("markers are current on return") and needs no frame-loop flag.

4. **Bucket by cell; keyed identity matching.** Decided: `findGeodesicIntersections` groups segments by `cellId`
   (`Map<string, GeodesicSegmentObject[]>`, first-appearance order, original order inside a bucket) and tests pairs only
   inside a bucket, so the output keeps today's order within each cell. `assignGeodesicIntersectionIdentities` builds
   `Map<"<cellId>|<geodesicIds[0]>|<geodesicIds[1]>", previous[]>` once and searches only the matching list; the
   nearest-unused rule and `vertexContinuityToleranceMeters` stay. Marker ids keep their string format (they are
   identities that other objects store); the `toFixed` dedupe key is only built for real crossings and stays. Why: issue
   70 item 2 (cost \(\sum_c n_c^2\)); ids must not change.

5. **Portal-side crossings.** Decided: in `findGeodesicIntersections`, drop a crossing when, for either segment, the
   segment's `terminal.kind` is `"portal-hit"` and its crossing parameter `t >= 1 - geodesicAnchorCrossingToleranceMeters / length`
   (the same tolerance as the anchor rule). The continuation segments in the target cell meet at their start (t = 0,
   `segmentIndex > 0`, so not an anchor) and report the crossing there. Why: merged item of issue 41; one marker per
   crossing, in the cell the geodesics enter.

6. **Trace once.** Decided: add to `intervals.ts`

   ```ts
   export type IntervalChordRealization =
     | { readonly kind: "ok"; readonly lifted: LiftedGeodesicEndpoint; readonly traces: readonly TraceGeodesicSegmentResult[] }
     | { readonly kind: "lift-failed" }
     | { readonly kind: "degenerate"; readonly lengthMeters: number }
     | { readonly kind: "zone"; readonly junctionId: string; readonly traces: readonly TraceGeodesicSegmentResult[] }
     | { readonly kind: "wall"; readonly sideIndex: number; readonly traces: readonly TraceGeodesicSegmentResult[] }
     | { readonly kind: "word-mismatch"; readonly realizedWord: readonly GeodesicPortalTraversal[]; readonly traces: readonly TraceGeodesicSegmentResult[] };
   export function realizeIntervalChord(input: {
     readonly world: CompiledCellComplex; readonly registry: RuntimeObjectRegistry; readonly interval: GeodesicIntervalObject;
     readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>; readonly allowUnexpectedPortalWord?: boolean;
   }): IntervalChordRealization;
   ```

   It lifts (start role), checks the minimum length, traces **once** and classifies: a `forbidden-zone-hit` terminal
   anywhere → `"zone"`; else a `wall-hit` → `"wall"`; else a word different from the lifted word (unless allowed) →
   `"word-mismatch"`; else `"ok"`. `previewRebuildGeodesicInterval`, `rebuildDerivedGeodesicSegments` and
   `traceGeodesicFromLiftedChord` keep their signatures and results and are rewritten on top of it (`rebuildDerivedGeodesicSegments`
   still deletes a degenerate interval). Add `rebuildDerivedGeodesicSegmentsDetailed(input)` returning
   `{ realization, result }`. Then:
   - `rebuildLockedGeodesicFromEndpointsAndPortalWord` / `rebuildConnectedGeodesicBetweenEmitters` decide "delete on zone"
     from the realization; delete `lockedIntervalRebuildHitsForbiddenZone`.
   - `resolveCurveShorteningPair` (job 26) commits the previewed segments (`preview.segments`) instead of rebuilding
     (as the old descent commit did: remove old segments, add preview segments, `syncLegacyEmitterGeodesicFields`).
   - Delete `previewGeodesicIntervalHitsForbiddenZone` and `previewGeodesicIntervalIsDegenerate` if job 26 left any user;
     use the realization instead.
   Why: issue 70 item 3.

7. **Counters for the tests.** Decided: new module `src/world-objects/geodesic/perfCounters.ts`:
   `export const geodesicPerfCounters = { intersectionPasses: 0, chordTraces: 0 }` and
   `export function resetGeodesicPerfCounters(): void`. `findGeodesicIntersections` increments `intersectionPasses`;
   `traceGeodesicPathForConnectionMode` increments `chordTraces`. Add `"world-objects/geodesic/perfCounters.ts"` to
   `trace.ts`'s `mayImportOnly` list in `scripts/docs/lib.mjs`. Why: internal calls inside an ES module cannot be counted
   with `vi.spyOn`; two integer increments cost nothing.

8. **Item 4 of issue 70 is closed without code.** Decided: inverse portal transforms are already cached per compiled
   portal (job 15's `WeakMap`, equivalent to precomputing them in `compileCellComplex`), and job 26 builds a sleeve once
   per pair, so no sleeve cache is added. Record this in the issue's closing evidence.

9. **Intersection memory stays a module-level `WeakMap`.** Decided: keep it (job 25 Decision 5); it is per registry and
   correct. Moving it into the registry would add a geodesic concept to the registry interface for no speed gain.

## Steps

After each step run the named tests and `npm run typecheck`. End of every Part: `npm run typecheck`, `npm test`,
`npm run docs:check` (`npm run docs:generate` when stale). Part B changes the runtime carry loop, so after Part B and
after Part C also run `npm run build` and `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.
**One commit per Part** (`Job 27 part X: ...`).

### Part A: registry indexes and no `getAll()` in geodesic code

1. Decision 1 in `runtimeObjectRegistry.ts`. Tests in `tests/world-objects/runtimeObjectRegistry.test.ts`:
   - add two cannons and three segments (two of geodesic `g1`, one of `g2`, use `createSegment` from the geodesic
     fixtures or a local copy): `getObjectsOfKind("geodesic-cannon")` has 2 entries in insertion order,
     `getSegmentsOfGeodesic("g1")` has 2;
   - `update` a `g1` segment to `geodesicId: "g2"`: `g1` has 1, `g2` has 2; `remove` it: `g2` has 1;
   - `moveToCell` keeps both indexes right; an object removed is in no index; an unknown kind gives `[]`;
   - job 37's publisher re-indexes the same way (update a published object's cell and check `getObjectsInCell`).
2. Decision 2 in the geodesic modules and the three tool calls.
3. Test A3 (in `tests/world-objects/geodesic/segments` tests, or `intersections.test.ts` if job 25 put the numbering
   tests there): shoot three geodesics from one cannon (numbers 1, 2, 3), `removeGeodesic` the first, then
   `rebuildConnectedGeodesicBetweenEmitters` / `rebuildGeodesicToLength` the third: it is still number 3
   (`resolveGeodesicNumber`), and a newly shot fourth geodesic gets number 1. Existing numbering tests ("numbers multiple
   geodesics from the same emitter pole incrementally", "numbers geodesics globally across emitters", "preserves existing
   global geodesic numbers when lower numbers are absent") pass unchanged.
4. `npx vitest run tests/world-objects tests/render-contract tests/runtime`; end-of-Part checks; commit.

### Part B: one intersection pass, buckets, portal-side crossings, counters, benchmark

1. Create `perfCounters.ts` (Decision 7) and the import-rule change.
2. Decision 3 (`requestGeodesicIntersectionUpdate`, `withDeferredGeodesicIntersections`, replace internal calls, wrap the
   exported entry points, wrap the tools' carry loop).
3. Decisions 4 and 5.
4. Tests (new file `tests/world-objects/geodesic/performance.test.ts` for B1-B3, `intersections.test.ts` for B4-B6):
   - **B1 benchmark** (see "The 200-segment benchmark" below).
   - B2 a public call makes one pass: on the B1 world, reset the counters and call `removeGeodesic(registry, "loop-0")`:
     `intersectionPasses === 1`; `rebuildConnectedGeodesicBetweenEmitters` for one loop: `intersectionPasses === 1`,
     `chordTraces === 1`.
   - B3 nested scopes: `withDeferredGeodesicIntersections(r, () => withDeferredGeodesicIntersections(r, () => { removeGeodesic(r, "loop-0"); removeGeodesic(r, "loop-1"); }))`
     → exactly 1 pass, and after it no marker names `loop-0` or `loop-1`. A throw inside the scope still leaves
     `intersectionPasses === 1` and current markers.
   - B4 portal-side crossing (Decision 5), with `compileWorld(true)` (two 2 m squares, `a`'s side 1 at x = 2 glued to
     `b`'s side 3 at x = 0, so a point (2, y) of `a` is (0, y) of `b`) and hand-made segments at beam height
     (`createSegment`): geodesic `X`: index 0 in `a` from (1, 0.5) along (1, 0.5)/√1.25 for √1.25 m, terminal
     `portal-hit` (portal `ab`, target `b`/`ba`, targetStart (0, 1)); index 1 in `b` from (0, 1) along the same direction
     for √1.25 m, terminal `open`. Geodesic `Y`: index 0 in `a` from (1, 1.5) along (1, -0.5)/√1.25 for √1.25 m,
     `portal-hit`; index 1 in `b` from (0, 1), same direction, `open`. `updateGeodesicIntersectionObjects` returns exactly
     **one** marker, in cell `b`, at (0, 1), `geodesicIds` ["X", "Y"]. (Before this job: two markers, one in `a` at
     (2, 1) and one in `b`.)
   - B5 buckets do not change results: for the B1 registry, the marker set (ids, cells, points rounded to 1e-9) equals
     the set computed by a test-local copy of the old all-pairs loop (copy `findGeodesicIntersections` as it was at
     `0b468e1` into the test, minus the portal-side rule, and compare after removing B4-type duplicates; there are none in
     B1 because no crossing lies on a portal side there).
   - B6 identity matching: the existing tests "keeps vertex identity while a geodesic pair intersection moves
     continuously", "remembers a missing vertex and recreates it with the same identity within ten meters" and "prunes
     non-existent vertex memory and refuses to match jumps beyond ten meters" pass unchanged.
5. `npx vitest run tests/world-objects/geodesic`; end-of-Part checks with build and smoke; commit.

### Part C: trace once

1. Decision 6: `realizeIntervalChord`, rewrite the three functions on it, `rebuildDerivedGeodesicSegmentsDetailed`,
   use it in the locked rebuild, delete `lockedIntervalRebuildHitsForbiddenZone` and the preview helpers, make
   `resolveCurveShorteningPair` commit preview segments.
2. Tests in `tests/world-objects/geodesic/performance.test.ts`:
   - C1 failed live carry traces once: the existing scenario of the test "destroys a locked interval during live carry
     when the rebuilt path crosses a forbidden zone" (carry.test.ts) run with counters: `chordTraces === 1` for the
     failing `rebuildConnectedGeodesicBetweenEmitters` call (was 2), and the interval is still deleted.
   - C2 the scenario of "preserves a locked interval after a failed live carry rebuild": `chordTraces === 1`, interval
     preserved.
   - C3 `realizeIntervalChord` kinds: a chord through a wall → `"wall"` with the side index; a chord through a junction
     disk → `"zone"` with the junction id; a chord shorter than 0.15 m → `"degenerate"`; a valid chord → `"ok"`.
   - C4 job 26's B1 resolution traces each of the two result chords once: `chordTraces === 2` for the
     `resolveCurveShorteningPair` call (preview only, no rebuild).
3. End-of-Part checks with build and smoke; commit.

### The 200-segment benchmark (B1)

File `tests/world-objects/geodesic/performance.test.ts`, plain vitest, no rendering; run with
`npx vitest run tests/world-objects/geodesic/performance.test.ts`. It passes when the three counts hold; the time is only
printed.

```text
world = compileTorusLoopWorld()            // one 15 m square cell "torus-room", opposite sides glued, zones at the corners
registry = createRuntimeObjectRegistry(); add cannon "e" in "torus-room" at (-2, 1.95)   // checked: all ten chords keep >= 0.30 m from every corner
for j in 0..9:
  (a, b) = (18 - j, j); length = 15 * hypot(a, b); direction = (a, b) / hypot(a, b)
  walk = walkDevelopedSegment({ world, cellId: "torus-room", start: { x: -2, y: 1.95 }, direction, lengthMeters: length, maxCrossings: 64 })
  expect(walk.status).toBe("end"); expect(walk.crossings.length).toBe(18)
  word = walk.crossings.map(c => ({ sourceCellId: c.sourceCellId, sourcePortalId: c.portalId, targetCellId: c.targetCellId, targetPortalId: c.targetPortalId }))
  add createGeodesicIntervalObject({ id: `loop-${j}`, startAnchorObjectId: "e", endAnchorObjectId: "e", startCellId: "torus-room", portalWord: word })
  expect(rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: `loop-${j}` }).length).toBeGreaterThan(0)
expect total geodesic-segment count in [195, 205]            // 19 cell pieces + 1 half split per loop = 200
before = registry.get("e"); registry.update({ ...before, localPose: yawRigidTransform3(0, { x: -1.95, y: 1.95, z: 0 }) })
resetGeodesicPerfCounters(); getAll = vi.spyOn(registry, "getAll"); t0 = performance.now()
withDeferredGeodesicIntersections(registry, () => {           // what geodesicCannonTools does per carry frame
  for id of collectLockedIncidentGeodesicIdsForEmitter(registry, "e"):
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: id, carriedEmitterId: "e",
      carriedEmitterBeforeMove: before, preserveGeodesicOnRebuildFailure: true, allowOutOfBoundsCarriedEndpoint: true })
})
console.info(`carry frame: ${performance.now() - t0} ms`)
expect(geodesicPerfCounters.intersectionPasses).toBeLessThanOrEqual(1)
expect(geodesicPerfCounters.chordTraces).toBeLessThanOrEqual(10)
expect(getAll).not.toHaveBeenCalled()
every loop-j still has segments and its word is unchanged
```

Before this job the same frame makes 20 intersection passes; write the test first (Part B step 4) and record the
before/after numbers and times in the report.

## Tests and checks

- New tests as listed; existing test files pass **unchanged** (issue 70 acceptance). If an existing test changes
  because marker ids or order changed, stop and record it under `### Deviations` with the reason; ids must not change.
- Every Part: `npm run typecheck`, `npm test`, `npm run docs:check` (after `npm run docs:generate` if stale). Parts B and
  C: `npm run build` and `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`.
- Manual browser check (record if not run): in `?config=full` on `torus-moduli`, create several loops on one emitter and
  carry it; motion is smooth and the vertex balloons follow the crossings; geodesics crossing on a portal show one
  balloon.

## Do not

- Do not change marker id formats, the 10 m continuity tolerance, or what counts as a crossing (other than Decision 5).
- Do not change the frame loop's call order in `createThreeApp.ts`, and do not touch `refreshMeasuredGeodesicLengths`.
- Do not change the curve-shortening algorithm or the tracing numerics.
- Do not add a spatial index beyond the per-cell buckets.

## Done when

- [ ] `git grep -n "getAll()" src/world-objects/geodesic` is empty or lists only the documented multi-kind calls;
      `getGeodesicSegments` uses the index.
- [ ] B1 passes: at most 1 intersection pass, at most 10 chord traces and no `getAll()` in one carry frame of 10 loops /
      200 segments; numbers before and after are in the report.
- [ ] B2-B6 and C1-C4 pass; existing tests unchanged.
- [ ] Three commits (Parts A-C); build and smoke green after B and C.
- [ ] Issue 70 is closed (moved to `_issues/_closed/` with Outcome and Closing evidence: the benchmark numbers, Decision 8
      for item 4) unless the report has `### Uncertain` or `### Not done` items; then leave it open with a pointer.
- [ ] Report written per [README](README.md); mention `refreshMeasuredGeodesicLengths` for job 29.
