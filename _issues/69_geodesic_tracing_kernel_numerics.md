# 69 - Geodesic tracing kernel: nudge drift, disk test with the start inside, missed intersections

Status: open; re-verified 2026-10-28; fix designed 2026-10-29. Implemented by job 15, which ended "done, needs review"; see the Report in [job 15](../.agents/jobs/_done/15_geodesic_tracing_on_kernel.md).

Priority: P2 (robustness / correctness).

Jobs: [15](../.agents/jobs/_done/15_geodesic_tracing_on_kernel.md).

Implemented by job 15, needs review: see the Report in [the job](../.agents/jobs/_done/15_geodesic_tracing_on_kernel.md).

## Status update 2026-10-29

Design decided in [job 15](../.agents/jobs/15_geodesic_tracing_on_kernel.md) (not implemented yet):

- The multi-cell trace walks the developed chord with `walkDevelopedSegment` (job 12) and then cuts it at the first
  zone or emitter hit; `targetStart` of a portal hit is the next piece's exact start. No end-point snapping (the job 12
  prototype measured 0 error after 217 torus crossings).
- Disk test: strictly inside, or on the circle (±1e-9 m) moving inward, is a hit at t = 0; on the circle moving
  outward is not.
- Vertex rule: a kernel exit decided by the vertex tie rule ends the geodesic as a `forbidden-zone-hit` at that vertex.
  The "compile-time assertion" is a test that every portal-side endpoint has a junction.
- Inverse portal transforms are cached in a `WeakMap` keyed by the compiled portal.
- Intersections: same-geodesic pairs with segment indices at least 2 apart are tested; only crossings at an anchor
  endpoint of either geodesic are dropped; the 0.3 m emitter exclusion is removed.

## Status update 2026-10-28

Done:

- Start inside a disk. `intersectRayWithForbiddenZone` (`src/world-objects/geodesicCannon.ts:5884-5913`) now returns
  `t = 0` when `c <= 0`, so a ray that starts inside or on the circle is a zone hit and the trace ends there
  (`traceGeodesicSegment`, `:1322-1331`). Test: "stops immediately when a segment starts inside a forbidden zone"
  (`tests/world-objects/geodesicCannon.test.ts`). The role-orientation asymmetry described below is gone: an arc whose
  start role is inside a disk now fails its preview just as the reversed arc does. A start on the circle aimed inward
  is a hit for either sign of the rounded `c`, but no test covers it.

Still open:

- Nudge drift: unchanged (`portalStartEpsilonMeters = 1e-4`, `:564`; nudge at `:1373`; budget at `:1505`).
- Disk test, new form of the problem: a start *on* the circle that moves outward is a hit at `t = 0` whenever rounding
  gives `c <= 0`. Proposed change 2 (open-disk predicate with tolerance) still applies, now to avoid false hits instead
  of missed ones.
- Vertex tie rule: unchanged and still undocumented; no compile-time assertion.
- Development cost: `liftGeodesicEndpoint` and `liftGeodesicEndpointWithAnchors` still call `invertRigidTransform3`
  per letter on every call (`:953`, `:998`).
- Intersections: self-crossings and crossings within 0.3 m of any emitter are still dropped (`:5598-5608`,
  `:5637-5655`).
- No acceptance test exists.

## Summary

Each piece of a multi-portal geodesic is traced from a point nudged `ε = 1e-4 m` past the portal, but the length
budget is not reduced by ε. As a result the drawn polyline ends `k·ε` beyond its anchor (k = number of portal
crossings), and an anchor within `k·ε` of a portal makes the homotopy check fail. The ray–disk test ignores rays
that start inside or on a disk. The intersection finder skips self-intersections and every crossing within 0.3 m of
any emitter.

## Evidence

- Nudge: `src/world-objects/geodesicCannon.ts:1373` sets `targetStart = T(hit) + ε·d'`. `:1505` subtracts only
  `trace.lengthMeters`, and `:1513` restarts from the nudged point. Summed over k crossings, the realized path
  covers `L + kε` of the developed line while the segment lengths sum to L. The last segment therefore ends
  `kε` past `B̃`, and no step snaps it to the end anchor (`withAnchoredTargetTerminalForAnchors`, `:2576-2598`,
  only relabels the terminal). Effects:
  - The drawn endpoint is offset from the emitter by kε: 1 mm for a geodesic that wraps a torus 10 times.
  - If the end anchor is within kε of a portal side in its cell, the trace crosses that portal, the realized word
    gains a letter, and `samePortalWord` fails (`:1560`, `:2228`). The locked geodesic then refuses to rebuild, or
    is deleted at release.
  - The measurement tool sums `lengthMeters` (`src/world-objects/measureLengthTool.ts:175-181`), so the label (L) and
    the drawing (L + kε) disagree.
- ~~Start inside a disk: `intersectRayWithForbiddenZone` returns "no hit" when `c <= 0` (`:5769-5771`).~~ Fixed (see
  the status update); the rest of this bullet describes the old behavior. A free end
  created at a `forbidden-zone-hit` terminal lies on the circle (c ≈ 0, either sign from rounding). The
  curve-shortening free end moves with `ignoreForbiddenZones: true` (`:3738`). An arc whose `start` role sits at
  such a point therefore crosses the disk undetected, while the reversed arc (trace from the other end) reports the
  hit. The result depends on role orientation.
- Ties at `u ≈ 0/1`: `:1306-1319` accepts both sides at a shared vertex within 1e-7 and keeps the first. This is
  benign today only because every portal endpoint carries a 0.15 m disk that is hit first. Nothing documents or
  asserts that invariant.
- Development cost: `liftGeodesicEndpoint` calls `invertRigidTransform3` for each letter on every call (`:953`, `:998`).
- Intersections: `findGeodesicIntersections` skips `left.geodesicId === right.geodesicId` (`:5598`), so a long
  geodesic's self-crossings are never vertices for the protractor. `pointCoincidesWithGeodesicEmitter` (`:5606`,
  `:5637-5655`) drops every crossing within `emitterConnectionToleranceMeters` = 0.3 m of any emitter in the cell,
  including real crossings of two geodesics passing near a third emitter. The 1e-4 gaps at portals can also hide
  crossings that fall inside a gap.

## Proposed change

1. **Trace in the developed frame.** Fix the developed ray `P(t) = A + t·d` in the frame of `C_0`. Keep
   `M_i` (cell `C_i` → `C_0`, composed once per crossing, with `T^{-1}` precomputed per portal). In cell `C_i`,
   intersect P with the developed sides `M_i(side)`, excluding the entry side by **side index** rather than by
   `t > 1e-7`. Then `exit_t = min t` over the other sides, with `t ≥ entry_t - tol`. Each segment is
   `[entry_t, exit_t]` mapped back by `M_i^{-1}`. No nudge is needed, the budget is exact (the last piece ends at
   `t = L`), and the endpoint error is `O(k·ε_mach·|coords|)` instead of `k·1e-4`. Snap the final point to the
   anchor when `|M_k^{-1}(A + L d) - B| < 1e-6`.
2. **Disk test** as a segment–open-disk predicate: hit iff `dist(center, segment[t0, t1]) < r - tol`. Report the
   first t where the segment is strictly inside. A start on the circle that moves outward is not a hit; a start
   strictly inside is a hit at `t = 0`.
3. **Vertex tie rule:** make it explicit that a ray within `tol` of a junction vertex is a `forbidden-zone-hit`, and
   assert at compile time that every portal endpoint has a zone.
4. **Intersections:** include same-geodesic pairs whose segment indices are not adjacent, and exclude only crossings
   at the geodesics' *own* anchor endpoints (by segment index 0 or last plus `t ∈ {0,1}`), not crossings near
   arbitrary emitters.

## Acceptance criteria

- Property test: on a torus, random chords with up to 200 crossings have rendered-endpoint error < 1e-8 m and
  realize the expected word, including anchors 1e-5 m from a portal side.
- Measured length equals the drawn polyline length to 1e-9 m.
- Test: a free-end start on the zone circle aimed inward reports a zone hit for both role orientations.
- Test: a (2,1) geodesic on a torus long enough to self-cross yields a self-intersection vertex.
- Test: a crossing 0.2 m from an unrelated emitter is reported.
