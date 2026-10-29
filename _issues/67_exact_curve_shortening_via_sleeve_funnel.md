# 67 - Replace free-vertex gradient descent by an exact sleeve/funnel solution

Status: open; re-verified 2026-10-28.

Priority: P1 (correctness + design). Supersedes the "Tick Geometry" and "Monotonicity" sections of issue 32 and
resolves the issue-41 items "failed fusion leaves a stuck ready-to-fuse pair", "degenerate free loop never deleted"
and "failed previews retried forever", which are all symptoms of the problem below. Issue 66 covers the immediate
stall bug.

## Status update 2026-10-28

Not started: there is no `src/world-objects/geodesics/` directory and no sleeve or funnel code. Curve shortening is
still the free-vertex descent in `advanceCurveShorteningPairs` (`src/world-objects/geodesicCannon.ts:3628`), with
`curveShorteningFuseAngleToleranceRadians`, `curveShorteningMinStepMeters` (`:582-586`), `absorbShortCurveShorteningHalf`
(`:4030-4152`) and `cleanupCurveShorteningPreviewFailure` (`:4348-4425`) all in place.

Changes since the issue was written:

- The ray–disk test now reports a hit at `t = 0` when the start is inside or on the disk (`intersectRayWithForbiddenZone`,
  `:5897-5899`; test "stops immediately when a segment starts inside a forbidden zone"). The third evidence bullet below is
  therefore stale: an arc whose `start` role sits inside a disk now fails its preview like the reversed arc. The
  descent still moves X with `ignoreForbiddenZones: true` (`:3738`), so the delete/split outcome described in the first
  bullet is unchanged.
- A failed non-zone fusion no longer stays `ready-to-fuse`: `advanceCurveShorteningPairs` reverts the pair to `moving`
  (test "reverts a ready-to-fuse pair to moving when its fusion preview fails without a forbidden zone"). This removes the
  stuck object but not the cause: the pair can cycle between `moving` and `ready-to-fuse` while the chord of `w` stays
  outside the sleeve.
- Fusion now checks for an already existing stable geodesic with the same anchors and the same word, in either direction
  (`findEquivalentStableInterval`, `discardCurveShorteningPairInFavorOf`; tests under "fusing into an already existing
  geodesic"). The exact solution must keep this check.

Issues 31 and 32 (closed 2026-10-28) left a set of end-to-end Phase F tests unwritten. They test outcomes, not the
descent, so they apply to the exact solution as well; they are listed under "Carried over from issues 31 and 32" below.

Remaining: everything under "Proposed change" and "Acceptance criteria".

## Summary

The answer the descent approximates can be computed exactly. For a pair (A ← X → B) with arc words `w_A` and `w_B`,
the length-minimizing path in the class of the fused word `w = reduce(w_A^{-1} · w_B)` is:

- the straight chord `Ã B̃` in the development, if that chord stays inside the sleeve of `w`; otherwise
- the taut string through the sleeve: straight pieces joined by wraps around the exclusion disks
  (r = 0.15 m, `src/cell-complex/forbiddenZones.ts:9`) at the portal junction vertices.

The current code finds neither reliably. When the taut string should wrap a disk, the descent drives an arc into the
disk, and the code then deletes or splits the construction.

## Evidence

- Free-vertex move ignores zones: `src/world-objects/geodesicCannon.ts:3733-3739` (`ignoreForbiddenZones: true`).
  When a cone point lies inside the developed triangle (Ã, X, B̃), the arcs sweep across its disk as X descends. The
  preview of an arc that ends at X then reports `forbidden-zone-hit`. `cleanupCurveShorteningPreviewFailure`
  (`:4348-4425`) deletes that arc and turns the other into an ordinary free geodesic on a new free end at the last
  good point. The user's tied construction falls apart exactly when the correct answer is a geodesic polygon with a
  corner at that cone point.
- Fusion previews only the straight chord of `w` (`:3990-3998`). If the chord leaves the sleeve (wall hit or a
  different word) the pair stayed `ready-to-fuse` forever; it now reverts to `moving` and is flagged again on a later
  tick (see the status update). Same mechanism as above, seen at the end of the flow.
- ~~An arc whose *start* role is X does not notice the zone at all once X is inside the disk. The ray–disk test treats
  a start inside the disk as no hit (`:5769-5771`). The outcome therefore depends on how the roles are oriented; see
  issue 69.~~ Fixed: a start inside or on the disk is now a hit at `t = 0` (`:5897-5899`).
- Free loops (one interval with both roles on F; `fuseCurveShorteningPair`, `:3921-3946`). The loop length is
  `L(F) = |g_w^{-1}(F) - F|`, where `g_w = (R_θ, t)` is the holonomy of the loop word. If `θ = 0` (every torus
  word), L is constant: every F on the cylinder gives a closed geodesic and nothing should move. If `θ ≠ 0`,
  `L(F) = 2|sin(θ/2)|·|F - c|` with `c = (I - R_θ)^{-1} t` (the developed enclosed cone point). The loop always
  collapses into that disk. The descent cannot reach either outcome cleanly.

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

## Merged from issue 41 (2026-10-28)

Curve-shortening defects from issue 41 that the exact solution must not reproduce. Each needs a test.

- Several helpers assume the emitter sits at the non-free `start` end; an emitter at `end`, or another anchor kind, is
  rejected (`TODO(issue 67)` at `geodesicCannon.ts:3955`, also `absorbShortCurveShorteningHalf`).
- `tieAndDetachGeodesicEndpoints` deletes geodesics when a forbidden-zone rebuild fails, instead of rolling back.
- A rejected (lengthening) step is skipped, not rolled back to a fused geodesic.

The other curve-shortening items of issue 41 are tracked in [66](66_curve_shortening_stalls_at_high_frame_rate.md) (the short free loop stall, `TODO(issue 66)` at
`geodesicCannon.ts:3727`) and [68](68_loop_endpoint_crossing_must_conjugate_portal_word.md) (a free loop whose free end crosses a portal, `TODO(issue 68)` at `:3755`).
