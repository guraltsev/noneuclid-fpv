# Job 59 - Answer every arc-end question from one cache, the arc index

Status: queued.
Resolves: part of issue [86](../../_issues/86_derived_state_is_recomputed_by_scanning_the_world.md).

## Goal

"Which arc ends are on this anchor" is asked seven times per flow step, and each asking scans every arc. Replace all of it with one
plain cache. Function signatures stay the same, so no caller changes. The cache recomputes three times in a flow run of 839 reads (a
prototype measured this), so it gets no `repair`.

## Depends on

Job 58.

## Before you start

- Read design 014 sections 1.1 and 7.1.
- Read `src/world-objects/geodesic/endpoints.ts` and `src/world-objects/geodesic/lifecycle.ts`.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

In one flow run, 238 of 239 arc updates keep both anchors. Vertex poses change every step, but no vertex is added or removed until
the merge. So a filter on anchors keeps the index valid through the whole flow.

The order of these lists matters. `arcsAtVertex` gives the two arc ends the flow reads as `u1`, `u2`, and `forEachTiedVertex` sets the
Gauss-Seidel order. Both are registry insertion order, and the index must reproduce it exactly.

## Decisions

- New file `src/world-objects/geodesic/arcIndex.ts`:

  ```ts
  export interface ArcIndex {
    /** Attachments on each anchor, arcs in registry order, start before end. Frozen. */
    readonly attachmentsByAnchor: ReadonlyMap<string, readonly GeodesicEndpointAttachment[]>;
    /** The same ends as ArcEnd records. Frozen. */
    readonly endsByAnchor: ReadonlyMap<string, readonly ArcEnd[]>;
    /** Distinct arc ids on each anchor, in first-seen order. Frozen. */
    readonly arcIdsByAnchor: ReadonlyMap<string, readonly string[]>;
    /** Vertices with two or more arc ends, closed loops included, in registry order. Frozen. */
    readonly tiedVertexIds: readonly string[];
  }

  export const arcIndex = defineDerived<RuntimeObjectReader, RuntimeWorldObject, ArcIndex>({
    id: "geodesicModel/arcIndex",
    kinds: ["geodesicModel/arc", "geodesicModel/vertex"],
    relevant: anchorsDiffer,
    compute: buildArcIndex,
  });
  ```

- `anchorsDiffer(before, after)` is true only when both are arcs and `start.anchorObjectId` or `end.anchorObjectId` differs. A vertex
  update returns false: the index holds no pose. An attachment has three fields, `geodesicId`, `role` and `anchorObjectId`; only the
  anchor can change on an update.
- `buildArcIndex` makes one pass over `getObjectsOfKind("geodesicModel/arc")` and one over the vertices. Freeze every list. An anchor with
  no ends has no key: a reader uses a shared frozen empty array.
- `ArcEnd` moves from `endpoints.ts` to `arcIndex.ts`, because `endpoints.ts` now imports `arcIndex.ts`; update its importers. `arcIndex.ts`
  imports no other geodesic file except `objects.ts`, or `docs:check` reports a cycle.
- These functions keep their signatures and read the index:

  | Function | New body |
  | --- | --- |
  | `getGeodesicEndpointAttachmentsForAnchor` | `attachmentsByAnchor.get(id) ?? empty` |
  | `getEmitterGeodesicIds` | `arcIdsByAnchor.get(id) ?? empty` |
  | `arcsAtVertex` | `endsByAnchor.get(id) ?? empty` |
  | `forEachTiedVertex` | loop over `tiedVertexIds` |
  | `tiedVertexCount` | `tiedVertexIds.length` |
  | `isVertexSharedWithOtherArc` | keep the vertex check; then look for an entry of `arcIdsByAnchor.get(anchor)` other than `arcId` |
  | `isTied` | keep the two vertex checks; then the same test on each vertex end |

- `forEachTiedVertex` loops by index over a frozen snapshot. A visit that merges vertices is safe; the id may be gone when reached, and
  the visitor checks. Say so in its comment.
- The return types stay `readonly`. No caller may mutate a list, and the compiler already says so.
- G4 scans in the refreshers change too:
  - `measureLengthTool.ts`, `findClosestGeodesicSegment` and `getGeodesicTotalLengthMeters`: `registry.getSegmentsOfGeodesic(geodesicId)`;
  - `protractorTool.ts`, the `getAll().filter(...)` near line 391: `registry.getSegmentsOfGeodesic(previous.geodesicId)`, keeping the
    rest of the filter and the sort. `getSegmentsOfGeodesic` is unsorted, as `getAll` order was not meaningful here; if a test shows an
    order dependence, keep the order by sorting on `segmentIndex` and record it.
- `findEquivalentConnectingArc` in `vertices.ts` and `removeUnusedFreeGeodesicEnds` run per merge, not per step: leave them.
- **No `repair`.** If the counters show more than 6 computes in a flow run, the filter is wrong: fix the filter.

## Steps

1. `arcIndex.ts`, with `tests/world-objects/geodesic/arcIndex.test.ts`:
   - each list against a hand-built registry, including an arc with both ends on one anchor (it appears twice in the ends, once in the
     arc ids) and a closed loop on one vertex (tied, with two ends);
   - **order**: arcs added in a known order give ends in that order, and re-anchoring an arc keeps its registry position;
   - the oracle fuzz, `expectDerivedMatchesCompute`, with writes: add an arc, remove an arc, re-anchor one end, change an arc's
     `portalWord` (ignored by the filter), move a vertex (ignored), add a vertex, remove a vertex, write an emitter (undeclared kind).

2. Replace the bodies in the table, one at a time, running `npx vitest run tests/world-objects/geodesic` after each.

3. The refresher scans. Run `npx vitest run tests/world-objects`.

4. Add to `tests/world-objects/geodesic/curveShortening.test.ts` the V3 test: on `createTorusTiedPairScenario`, run the flow until the pair is
   gone; then `derivedStatsOf(registry)` shows `geodesicModel/arcIndex` with `computes` at most 6, and `reads` above 100.

5. `npm run bench -- moduleStep --check`, then `--record-counters`. `geodesicModel/arc` scans per flow run must be at most 6 in every scene,
   and `"*"` scans must fall. Check with `git diff`, and commit.

## Tests and checks

- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke -- --world cube,torus-moduli`, `npm run test:release`,
  `npm run bench -- moduleStep --check`.
- Run the app with the `derived-verify` debug option and carry an emitter, shoot, and tie; if you cannot, list it under
  "Manual checks for the maintainer".

## Do not

- Do not change any assertion in an existing test: the answers are the same, only faster.
- Do not add a keyed table or a `repair`, and do not cache `arcsOfCurve`; it runs per user action.
- Do not hold a list across a step in a variable that outlives the call.

## Done when

- `grep -rn 'getObjectsOfKind("geodesicModel/arc")' src` shows only `arcIndex.ts` and `vertices.ts` (`findEquivalentConnectingArc`).
- `grep -n "getAll()" src/world-objects/measureLengthTool.ts src/world-objects/protractorTool.ts` is empty.
- All checks are green, and the counters are recorded.
