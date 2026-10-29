# Job 26 - Exact curve shortening via the sleeve/funnel

Status: queued.
Split from issue 67 on 2026-10-28: the defect stays in the issue, the design is here.
Resolves: issue [67](../../_issues/67_exact_curve_shortening_via_sleeve_funnel.md).

## Context

The defect, evidence and current state are in issue [67](../../_issues/67_exact_curve_shortening_via_sleeve_funnel.md).

## Proposed change

New module `src/world-objects/geodesics/sleeve.ts` (pure, no registry):

1. **Develop the sleeve** of a reduced word `w = (p_1..p_k)` from cell `C_0`: `M_0 = I`,
   `M_i = M_{i-1} ∘ T_{p_i}^{-1}` (cell `C_i` frame → `C_0` frame; precompute `T^{-1}` per portal once at
   compile time). Portal `i` becomes the developed segment `[L_i, R_i] = M_{i-1}(side endpoints)`, oriented left and
   right relative to the direction of travel. Every portal endpoint is a junction with a disk of radius r. The
   free aperture is therefore `[L_i + r ê_i, R_i - r ê_i]`, and a word with an aperture shorter than 0 is infeasible.
2. **Funnel (Lee–Preparata / Hershberger–Snoeyink)** from Ã to B̃ = `M_k(B)` over the apertures. Run it on point
   apexes first (O(k)) to get the turn sequence: apex j is disk `D(c_j, r)`, on the left or right side. Then replace
   each piece by the common tangent of consecutive disks: the outer tangent for same-side turns, the inner tangent
   when the side changes. The point-to-disk tangent is used at Ã and B̃. The result is exact for disks.
   Overlapping developed cells (cone angle > 2π, long words) are harmless because the funnel works on the sequence,
   not on a planar union.
3. **Representation of corners.** If the apex list is empty, the result is one locked interval with word `w`
   (current fusion). Otherwise create one pinned anchor per apex: `kind: "geodesic-corner"`, with `junctionId` and
   side. Its position is the intersection of the two tangent lines, at distance `r / cos(φ/2)` from `c_j` along
   the outward bisector, where φ is the turn angle. Split `w` at the portal index where each apex occurs. This gives
   a chain of locked intervals, and the length error of the polyline is `r(2 tan(φ/2) - φ)` per corner. Rendering an
   actual arc is optional later.
4. **Animation, if wanted.** Move X at speed v along the straight developed segment toward
   `X* = argmin_{Y ∈ taut path} |Y - X|`, stopping at the first disk contact (which becomes a corner). L is convex in
   the developed frame, so it is non-increasing along X→X*: no rollback is needed. A per-step preview is still used
   only to detect portal crossings for the word update.
5. **Free loops.** Compute `g_w` from the composed transforms. If `θ ≈ 0` (|θ| < 1e-9): mark stable immediately
   when the chord realizes `w`. Otherwise the loop collapses; delete it with a user-visible message, or wrap the
   cone disk if that product decision is made. No iteration is needed in either case.
6. **Delete** `curveShorteningFuseAngleToleranceRadians`, `curveShorteningMinStepMeters`, the absorb heuristics
   (`:4030-4152`) and the forbidden-zone split (`:4348-4425`), all of which compensate for the descent.

## Acceptance criteria

- Unit tests on the pure sleeve module: (a) a straight case where the result equals the chord to 1e-9 m; (b) one
  cone point inside the triangle, where the result has one corner and its length matches the analytic tangent–arc
  value to 1e-6 m; (c) a word with an alternating left/right funnel; (d) an infeasible aperture rejected.
- Torus free loop: stable in 1 tick. A loop around a rotational cone point is deleted deterministically.
- No code path deletes a curve-shortening arc because the minimizer touches a disk.
- Fusion never leaves a `ready-to-fuse` pair behind.

### Carried over from issues 31 and 32

End-to-end tests from the Phase F plan (issue 32 "Test Slices", issue 31 "Required Tests") that are still missing.
They state outcomes and should be written against whatever algorithm replaces the descent.

- Tie/release of two distinct locked intervals at one emitter creates two moving intervals and one pair (32 slice 3).
  The only direct `tieAndDetachGeodesicEndpoints` test is the same-emitter loop case.
- The torus two-emitter scenario of issue 31: tie and release at E2 of `E1 -- G2 -- E2 -- G1 -- E1` ends as one stable
  locked loop at E1 with a nonempty word (32 slice 7). A scratch run on 2026-10-28 shows it works at 60 Hz (word
  `[right]`, length 15 m, 3 segments, one per cell piece), but no test pins it.
- A nondegenerate free loop ends as one stable free loop (32 slice 8).
- A forbidden-zone hit by one half leaves the other half as a stable free geodesic (32 slice 10). Under this issue the
  expected outcome changes to "the result wraps the disk"; the test should assert the new outcome.
- Fusion never creates a segment that spans a portal (32 slice 11).
- Length measurements, protractor angles and intersections refresh or are removed after pair deletion and after
  fusion (32 slice 12).
- A rejected tick after a portal crossing of the free end leaves the stored words unchanged (32 slice 13).
- Fusion and absorption with a non-emitter anchor at a non-free end (today both refuse; `TODO(issue 67)` at
  `fuseCurveShorteningPair`).
