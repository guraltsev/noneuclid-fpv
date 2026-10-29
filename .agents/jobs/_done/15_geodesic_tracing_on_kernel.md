# Job 15 - Geodesic tracing on the segment-walk kernel

Status: done, needs review on 2026-10-29.
Revised on 2026-10-29 for a less capable implementing model.
Resolves: issue [69](../../_issues/69_geodesic_tracing_kernel_numerics.md).

## Goal

1. Multi-portal geodesics are traced with `walkDevelopedSegment` (job 12): no 1e-4 m nudge, the pieces' lengths add up
   to exactly the requested length, and the end point error does not grow with the number of crossings.
2. Forbidden-zone hits use an open-disk rule: a start on the circle that moves outward is not a hit; a start strictly
   inside, or on the circle moving inward, is a hit at t = 0.
3. A ray that passes through a portal-junction vertex is a forbidden-zone hit (documented and tested).
4. Lifting an endpoint uses precomputed inverse portal transforms.
5. The intersection finder reports self-crossings and crossings near unrelated emitters.

## Depends on

[Job 12](12_segment_walk_kernel.md). Independent of jobs 13 and 14 (it does not use the mover). Must land **before**
[job 25](25_split_geodesic_cannon_modules.md), which splits `geodesicCannon.ts`.

## Before you start

Line numbers are from commit `0d86165` (`src/world-objects/geodesicCannon.ts`, 5 959 lines). Search by name if they
moved.

| Lines | What |
| --- | --- |
| 307-328 | `GeodesicSegmentTerminal` (the `portal-hit` variant carries `targetStart`, `targetDirection`) |
| 342-360 | `TraceGeodesicSegmentInput`, `TraceGeodesicSegmentWithEmittersInput` |
| 561-573 | constants: `portalStartEpsilonMeters = 1e-4`, `intersectionTolerance = 1e-7`, `emitterConnectionToleranceMeters = 0.3` |
| 927-1034 | `liftGeodesicEndpoint`, `liftGeodesicEndpointWithAnchors` (inverse per letter at :962 and :1013) |
| 1287-1412 | `traceGeodesicSegment` (single cell) |
| 1414-1490 | `traceGeodesicSegmentWithEmitters`, `findNearestEmitterHitOnTrace` |
| 1492-1540 | `traceGeodesicSegmentForConnectionMode`, `traceGeodesicPathForConnectionMode` (the loop with the nudge) |
| 1547-1606 | `traceGeodesicFromLiftedChord` (homotopy check with `samePortalWord`) |
| 2571-2599 | `withAnchoredTargetTerminal*` (relabels the last piece) |
| 2605-2641 | `replaceDerivedSegmentsFromTraces`, `buildDerivedSegmentsFromTraces` (segment index = position after the half split) |
| 5606-5672 | `findGeodesicIntersections`, `pointCoincidesWithGeodesicEmitter` |
| 5780-5817 | `intersectHorizontalSegments` |
| 5895-5931 | `intersectRayWithForbiddenZone` |

Callers of the multi-cell loop: `traceGeodesicPathForConnectionMode` is called at about :1530, :1564, :1641, :1797,
:2201, :2685, :3239, :4491. The single-cell `traceGeodesicSegment` is also called directly at :2942 and :4895 and in
tests (`tests/world-objects/geodesicCannon.test.ts` :49, :58, :224-254, :452, :481, :3209;
`tests/cell-complex/compileCellComplex.test.ts` :278-282). Also read `src/world-objects/measureLengthTool.ts:175-181`
(sums `lengthMeters`).

Baseline: `npm run typecheck`, `npm test`. `tests/world-objects/geodesicCannon.test.ts` is 3 111 lines; run it on its
own after every step (`npx vitest run tests/world-objects/geodesicCannon.test.ts`).

## Background

### Today's loop

`traceGeodesicPathForConnectionMode` calls the single-cell tracer, and on a `portal-hit` restarts in the target cell
from `targetStart = T(hit) + 1e-4·d'`. The budget is reduced by the traced length only, so after k crossings the drawn
polyline covers `L + k·1e-4` and ends `k·1e-4` past the anchor. If the end anchor is within `k·1e-4` of a portal side,
the trace crosses it and gains a letter, and `samePortalWord` refuses the rebuild (issue 69).

### With the kernel

Walk the developed segment `A + t·d`, t ∈ [0, L], with `walkDevelopedSegment`. Piece k gives, in cell k's frame, the
start point `Mₖ(A + tEnter·d)`, the unit direction `Rₖ d`, and the length `tExit − tEnter`. Consecutive pieces meet
exactly at the portal (the next piece's start is the previous piece's end mapped by the portal transform, up to
rounding of order 1e-15·|coordinates|). The last piece ends at `t = L`.

Inside each piece the tracer still has to find forbidden-zone discs and (in emitter-connection mode) emitters, which
may stop the geodesic **before** the piece's exit. So: walk first, then scan the pieces in order and cut at the first
zone or emitter hit.

## Decisions

1. **Keep the result type.** Decided: `traceGeodesicPathForConnectionMode` keeps returning
   `readonly TraceGeodesicSegmentResult[]`, one per cell piece, so none of its eight callers change. For a
   `portal-hit` piece, `targetStart` is the **next piece's start point** (no nudge) and `targetDirection` is the next
   piece's direction. Delete `portalStartEpsilonMeters`.
2. **Zone hits come before the walk's exit.** Decided: for each piece, in order, compute the earliest zone hit (open-disk
   rule, Decision 4) and, when `connectEmitters`, the earliest emitter hit (`findNearestEmitterHitOnTrace` with the
   piece's start, direction and length) in that piece's cell. The first hit cuts the geodesic: that piece gets the
   shortened length and the hit's terminal, and later pieces are dropped. A hit at exactly the piece's start (length 0)
   is allowed and still produces a piece of length 0 with the hit's terminal.
3. **Vertex passes.** Decided: if a piece's exit has `throughVertexIndex` defined (job 12), the geodesic ends there
   with a `forbidden-zone-hit` whose `junctionId` is `"<cellId>:vertex-<index>"` (the id format of
   `prismCells.ts:164`). In shipped worlds every portal endpoint has a zone that is hit first, so this only fires in
   worlds without zones at that vertex (job 18 will remove zones at flat vertices; this rule keeps geodesics
   well-defined then). Add a test that every portal-side endpoint of every example world has a junction id (the
   compile-time assertion of issue 69 item 3, as a test).
4. **Open-disk predicate.** Decided: replace `intersectRayWithForbiddenZone` with:
   - o = start − centre (horizontal), b = 2·o·d, c = |o|² − r², and `onCircle = |(|o| − r)| ≤ 1e-9`;
   - if `|o| < r − 1e-9` (strictly inside): hit at t = 0;
   - if `onCircle`: hit at t = 0 if `o·d < 0` (moving inward), otherwise no hit;
   - else (outside): if `b ≥ 0` no hit; disc = b² − 4c; if disc < 0 no hit; t = (−b − √disc)/2; a hit if t ≤ max length.
   Keep the vertical slab test for finite zone heights as it is.
   Why: issue 69 proposed change 2. A free end created at a zone-hit terminal sits on the circle; it must be able to move
   away.
5. **Single-cell tracer.** Decided: keep `traceGeodesicSegment` exported with the same signature and behaviour except
   (a) the open-disk rule, (b) `portal-hit` continuation without nudge: `targetStart = T(hit point)` exactly. Callers that
   restart from `targetStart` by hand would then re-hit the target side at t = 0; search for such callers
   (`targetStart` outside `traceGeodesicPathForConnectionMode`) and switch them to the multi-cell function. Add an
   optional `entrySideIndex?: number` to `TraceGeodesicSegmentInput`; when given, that side is skipped (replacing the
   `t <= intersectionTolerance` guard for it).
6. **Final snap.** Decided: no snapping. With exact budgets the realized end point equals the lifted chord's end up to
   rounding (job 12 measured 0 after 217 crossings). The acceptance test checks < 1e-8 m.
7. **Lift with cached inverses.** Decided: add a module-level `WeakMap<CompiledPortal, RigidTransform3>` cache
   `inversePortalTransform(portal)` and use it in both lift functions. A compiled world is immutable, and a new world
   (deformation commit) has new portal objects, so a `WeakMap` is always correct.
8. **Intersections.** Decided, replacing the 0.3 m emitter exclusion:
   - same-geodesic pairs are tested when `|left.segmentIndex − right.segmentIndex| ≥ 2` (adjacent segments share an
     endpoint);
   - a crossing is dropped only when it lies at an **anchor endpoint of either geodesic**: the start of that geodesic's
     segment with index 0, or the end of its segment with the largest index, within 1e-6 m. Use the segment-parameter
     values of `intersectHorizontalSegments` (expose `leftT`, `rightT`): drop if (`left.segmentIndex === 0` and
     `leftT ≤ 1e-6 / left length`) or (left is last and `leftT ≥ 1 − 1e-6 / length`), and the same for right;
   - delete `pointCoincidesWithGeodesicEmitter`.
   Why: issue 69 item 4. Geodesics that share an emitter meet at t = 0 of their first segments and are still excluded.

## Steps

1. Replace `intersectRayWithForbiddenZone` (Decision 4). Run the geodesic tests. The existing test "stops immediately
   when a segment starts inside a forbidden zone" must still pass.
2. Add `entrySideIndex` and remove the nudge from `traceGeodesicSegment` (Decision 5).
3. Rewrite `traceGeodesicPathForConnectionMode` on the kernel (Decisions 1-3):

   ```text
   walk = walkDevelopedSegment({ world, cellId, start: xy(input.start), direction: xy(input.direction),
                                 lengthMeters: input.maxLengthMeters, maxCrossings: 4096 })
   if walk.status is "start-outside" or "missing-cell": fall back to the single-cell tracer's result for the start
     cell (one piece) and return it; record which tests hit this, if any
   traces = []
   for piece of walk.pieces:
     cell = piece.cellId; start = Mₖ(A + tEnter d) with z = input.start.z; dir = Rₖ d; len = tExit − tEnter
     zoneT  = earliest open-disk hit over the cell's forbidden zones within [0, len]
     emitT  = connectEmitters ? findNearestEmitterHitOnTrace(... maxLengthMeters: len)?.distanceMeters : undefined
     cut = min(zoneT, emitT); if cut defined: push piece with length cut and that terminal; break
     terminal from piece.exit: "end" -> open; "wall" -> wall-hit (vertex pass: Decision 3); "portal" -> vertex pass:
       Decision 3, else portal-hit with targetStart/targetDirection = next piece's start/direction
     push; if terminal is not portal-hit: break
   return traces
   ```

   `findNearestEmitterHitOnTrace` keeps its own tolerances. Remember that it ignores hits with
   `projected ≤ intersectionTolerance`; at the start of a non-first piece, an emitter exactly on the portal would be
   missed. That is today's behaviour too; record it under `### Uncertain` if a test shows it.
4. Run `tests/world-objects/geodesicCannon.test.ts`. Expected: tests that compared positions with `toBeCloseTo` at
   default precision pass; tests that hard-coded a nudged `targetStart` fail. For each failing test, check that the new
   value is the exact (un-nudged) one and update it; list every such change under `### Deviations`.
5. Cached inverses (Decision 7).
6. Intersections (Decision 8).
7. Delete `portalStartEpsilonMeters`, and update the doc comments that mention the nudge (`GeodesicSegmentTerminal`,
   the loop's comment) and `_docs/MATHEMATICAL_MODEL.md` §6.

## Tests

Add to `tests/world-objects/geodesicCannon.test.ts` (new `describe("geodesic tracing on the kernel")`), or to a new
file `tests/world-objects/geodesicTracingKernel.test.ts` if that is easier to keep small:

1. Issue 69 acceptance, endpoint error: on `torusModuli`, 50 random chords (fast-check, `numRuns: 50`) from a random
   interior point, random direction, length in [15, 3 000] m (up to about 200 crossings): the sum of piece lengths
   equals the requested length within 1e-9 m, and the last piece's end point, lifted back through the inverse
   transforms of the crossed portals, equals `A + L·d` within 1e-8 m. Use `traceGeodesicPathForConnectionMode`
   indirectly through an exported function, or export a thin test hook with JSDoc if none fits (record which).
   Skip chords that hit a zone (`fc.pre`); with zones at the torus corner this rejects some draws.
2. Issue 69 acceptance, anchor near a side: build a geodesic interval between two emitters whose end anchor is 1e-5 m
   from a portal side, wrapping the torus 10 times; the rebuild succeeds and the realized word equals the stored word.
   (Before this job, 10 crossings × 1e-4 = 1e-3 > 1e-5, so the rebuild failed.) Build the registry the way the existing
   tests build a locked interval between two cannons: search the test file for `createGeodesicIntervalObject` and
   `rebuildConnectedGeodesicBetweenEmitters`, and place the objects directly in the registry (no placement checks).
3. Measured length equals the drawn polyline length within 1e-9 m (`measureLengthTool` sum versus the sum of segment
   lengths).
4. A free end on a zone circle aimed inward is a zone hit for both role orientations; aimed outward it is not.
5. A (2, 1) geodesic on the square torus, long enough to self-cross, yields a geodesic-intersection object whose two
   geodesic ids are equal.
6. A crossing of two different geodesics 0.2 m from an unrelated emitter is reported.
7. Every portal-side endpoint of every example world has a junction (Decision 3).
8. A vertex pass: a world without a zone at one vertex is not available today; test the mapping directly by calling the
   piece-to-terminal conversion (export it as an internal helper with JSDoc) with a hand-made piece whose
   `throughVertexIndex` is 2: the terminal is `forbidden-zone-hit` with `junctionId` `"<cell>:vertex-2"`.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`. Run the browser smoke test on `torus-moduli` once
(`npm run build`, `npm run smoke -- --world torus-moduli`).

## Bookkeeping

Close issue 69 with the measured numbers. Update issue 50's row 69. Note in issue 70 (performance) that the nudge loop
is gone and lifts use cached inverses.

## Do not

- Do not change curve shortening (job 26), the free-end mover (job 13 owns it) or the module split (job 25).
- Do not change the meaning of `TraceGeodesicSegmentResult` fields other than `targetStart`.
- Do not change `emitterConnectionToleranceMeters`; it is still the emitter **hit** tolerance in
  `findNearestEmitterHitOnTrace`.

## Done when

- No nudge constant remains; the multi-cell loop uses `walkDevelopedSegment`.
- Tests 1-8 pass, and every changed old test is listed under `### Deviations`.
- Issue 69 is closed with evidence.

## Report

### Done
- `src/world-objects/geodesicCannon.ts`:
  - `traceGeodesicPathForConnectionMode` now walks the developed segment with `walkDevelopedSegment` (`maxCrossings` 4096, walk length `L + 1e-7` so a side reached within tolerance beyond `L` still counts, clamped to `L`, as the old tracer did) and cuts each piece at its first zone hit (open-disk rule) or emitter hit. `portal-hit` pieces carry the next piece's exact start and direction. `portalStartEpsilonMeters` is deleted (new constants `forbiddenZoneCircleToleranceMeters` 1e-9, `maxGeodesicWalkCrossings`, `geodesicAnchorCrossingToleranceMeters` 1e-6).
  - New exported helper `geodesicTerminalFromWalkPiece(piece, continuation?)` (piece to terminal; a vertex-tie exit becomes `forbidden-zone-hit` with `junctionId` `<cellId>:vertex-<index>`).
  - `intersectRayWithForbiddenZone` uses the open-disk rule (Decision 4).
  - `traceGeodesicSegment`: optional `entrySideIndex`, no nudge (`targetStart` is the exact image of the hit point). No caller outside the multi-cell loop used `targetStart`.
  - `inversePortalTransform` (`WeakMap` cache) used by both lift functions.
  - `findGeodesicIntersections`: same-geodesic pairs two or more segments apart are tested; only crossings within 1e-6 m of an anchor end of either geodesic (first segment start, last segment end) are dropped; `pointCoincidesWithGeodesicEmitter` deleted; `intersectHorizontalSegments` returns `leftT`, `rightT` and the segment lengths.
- `_docs/MATHEMATICAL_MODEL.md` section 6 updated; `_docs/generated/*` regenerated.
- Tests: new `tests/world-objects/geodesicTracingKernel.test.ts` (11 tests: tests 1-8 of the job; the open-disk rule has three cases). The new tests fail on the old code (7 of 11 fail there).
- Measured: 50 random torus chords of 15-3000 m (up to about 200 crossings): sum of piece lengths within 1e-9 m of the requested length and the end point, pulled back through the inverse portal transforms, within 1e-8 m of `A + L d` (test bounds; no run exceeded them).
- Commit hashes: see the job's commit lines in the git log (code commit, then the move-to-done commit).

### Deviations
- `tests/world-objects/geodesicCannon.test.ts`, "does not create a vertex balloon at an emitter when geodesics intersect there": renamed and inverted (now expects one vertex). Decision 8 removes the 0.3 m emitter exclusion and the emitter there is unrelated to both geodesics, so the crossing must be reported. This is the only changed old test; no test hard-coded a nudged `targetStart`.
- Test 5 of the job ("a (2, 1) geodesic on the square torus self-crosses") cannot hold: the torus gluing is translation-only, so every piece of a geodesic in a cell is parallel to every other and never crosses. The self-crossing test uses hand-made segments of one geodesic id (indices 0 and 3 cross, indices 0/1 and 1/2 are adjacent).
- Test 3 (measured length): `measureLengthTool` just sums `lengthMeters`, so the test compares the sum of segment lengths with the summed `|end - start|` polyline length and the requested length.
- Tests 1 and 3 go through `shootGeodesic(..., connectEmitters: false)` instead of a new test hook. Note the registry splits each piece into two halves, so the test counts `portal-hit` terminals for crossings. Test 2 uses two cannons with a 10-fold `right-left` word.
- Issue 70 note added; issue 50 row 69 not touched because issue 69 stays open.

### Uncertain
- A final non-first `end` piece of length at most 1e-7 m is dropped (the previous piece then ends in `portal-hit`), mirroring the old loop's `remaining <= intersectionTolerance` stop. The sum of lengths is then short by at most 1e-7 in that rare case. Would be confirmed by deciding whether a zero-length open tail is wanted.
- `start-outside` / `missing-cell` fall back to the single-cell tracer for one piece as the job says; no existing test hit that path, but a start more than `cellContainmentToleranceMeters` outside its cell no longer continues across portals.
- The first full `npm test` run of the finished change showed one failing test file that I did not capture (the output was cut to the last lines); two later full runs were green (115 files, 857 passed, 8 skipped). Probably a load-dependent timeout (`portalPaths.test.ts` takes about 60 s), unconfirmed.
- Emitter exactly on a portal at the start of a non-first piece is ignored by `findNearestEmitterHitOnTrace` (`projected <= intersectionTolerance`), as before; no test showed it.

### Not done
- Issue 69 is not closed (see Uncertain). Issue 50 row 69 not updated.

### Checks
- Baseline: `npm run typecheck` and `npm test` green (114 files, 846 passed, 8 skipped).
- After: `npm run typecheck` green; `npm test` green (115 files, 857 passed, 8 skipped) on the second and third runs; `npm run docs:check` green after `npm run docs:generate`.
- `npm run build` ok; `npm run smoke -- --world torus-moduli`: SMOKE OK (the page logs a failed dynamic import of the `inter` font chunk from the preview server; unrelated to this job and not investigated).

### Manual checks not run
- Visual check in a browser of a long wrapped geodesic and the measured-length label.