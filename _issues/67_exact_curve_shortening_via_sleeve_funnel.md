# 67 - Replace free-vertex gradient descent by an exact sleeve/funnel solution

Status: open as of 2026-10-08.

Priority: P1 (correctness + design). Supersedes the "Tick Geometry" and "Monotonicity" sections of issue 32 and
resolves the issue-41 items "failed fusion leaves a stuck ready-to-fuse pair", "degenerate free loop never deleted"
and "failed previews retried forever", which are all symptoms of the problem below. Issue 66 covers the immediate
stall bug.

## Summary

The answer the descent approximates can be computed exactly. For a pair (A ← X → B) with arc words `w_A` and `w_B`,
the length-minimizing path in the class of the fused word `w = reduce(w_A^{-1} · w_B)` is:

- the straight chord `Ã B̃` in the development, if that chord stays inside the sleeve of `w`; otherwise
- the taut string through the sleeve: straight pieces joined by wraps around the exclusion disks
  (r = 0.15 m, `src/cell-complex/forbiddenZones.ts:9`) at the portal junction vertices.

The current code finds neither reliably. When the taut string should wrap a disk, the descent drives an arc into the
disk, and the code then deletes or splits the construction.

## Evidence

- Free-vertex move ignores zones: `src/world-objects/geodesicCannon.ts:3708-3714` (`ignoreForbiddenZones: true`).
  When a cone point lies inside the developed triangle (Ã, X, B̃), the arcs sweep across its disk as X descends. The
  preview of an arc that ends at X then reports `forbidden-zone-hit`. `cleanupCurveShorteningPreviewFailure`
  (`:4242-4318`) deletes that arc and turns the other into an ordinary free geodesic on a new free end at the last
  good point. The user's tied construction falls apart exactly when the correct answer is a geodesic polygon with a
  corner at that cone point.
- Fusion previews only the straight chord of `w` (`:3947-3957`). If the chord leaves the sleeve (wall hit or a
  different word) the pair stays `ready-to-fuse` forever. Same mechanism as above, seen at the end of the flow.
- An arc whose *start* role is X does not notice the zone at all once X is inside the disk. The ray–disk test treats
  a start inside the disk as no hit (`:5769-5771`). The outcome therefore depends on how the roles are oriented; see
  issue 69.
- Free loops (one interval with both roles on F, `:3878-3901`). The loop length is
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
   (`:3980-4093`) and the forbidden-zone split (`:4242-4318`), all of which compensate for the descent.

## Acceptance criteria

- Unit tests on the pure sleeve module: (a) a straight case where the result equals the chord to 1e-9 m; (b) one
  cone point inside the triangle, where the result has one corner and its length matches the analytic tangent–arc
  value to 1e-6 m; (c) a word with an alternating left/right funnel; (d) an infeasible aperture rejected.
- Torus free loop: stable in 1 tick. A loop around a rotational cone point is deleted deterministically.
- No code path deletes a curve-shortening arc because the minimizer touches a disk.
- Fusion never leaves a `ready-to-fuse` pair behind.
