# 54 - Treat the torus family as Teichmüller space: reduction, geodesic stepping, GL(2,ℝ) generalization

Status: open; re-verified 2026-10-28.

Priority: P3 (design; it also improves rendering quality and makes the family generalize).

## Status update 2026-10-28

Nothing in this issue is implemented. The family still uses the marked basis as the footprint
(`buildTorusParallelogramVertices`, `src/runtime/deformations/torusSkewDeformation.ts:120-135`), still steps in
Euclidean (a, b) (`nextTorusSkewStep`, `:173-194`), there is no reduction or re-marking commit, no moduli-equivalence
display, and the only registered family is `torus-skew` (`src/runtime/worldGeometryDeformationFamilies.ts:56`).

Changed facts: the app now passes `maxStepMeters: 0.04` (`src/render/three/createThreeApp.ts:792`); the session
default of 0.08 m (`worldGeometrySession.ts:121`) applies only when no step options are given. The render depth is
`rootRenderPathMaxDepth = 10` at `createThreeApp.ts:761`. Related: issue 81 proposes lattice UVs for the floor, which
would also need to follow a re-marking commit.

## Summary

The torus-skew family parametrizes a box in Teichmüller space, τ = (a + ib)/w ∈ [0, 2] × [½, 2] ⊂ ℍ, and always uses
the *marked* basis (u, v) as the cell footprint. Three things follow.

- The box covers the moduli space ℍ/PSL(2,ℤ) several times. τ, τ + 1 and τ + 2 are the same flat torus.
- Near the box corners the cell is a 14°/166° parallelogram, even when the torus is a plain 2:1 rectangle.
- Steps are Euclidean in (a, b), so the per-commit distortion is not uniform.

The same structure generalizes directly to every translation surface, not just the torus.

## Evidence

- Range: `torusSkewDeformation.ts:304-316`. Footprint = marked basis: `buildTorusParallelogramVertices` (`:120-135`).
- At a = 30, b = 7.5 (w = 15): u = (15, 0), v = (30, 7.5).
  - The corner angle is atan(7.5/30) = 14°, and the cell diameter is |u + v| = 45.6 m.
  - Gauss reduction gives v − 2u = (0, 7.5), so the same torus is the 15 × 7.5 rectangle, with diameter 16.8 m.
  - The fixed portal depth (`createThreeApp.ts:761`, depth 10) covers the lattice points m·u + n·v with
    |m| + |n| ≤ 10. In the skewed basis that region is a strongly sheared diamond, so the view distance becomes very
    anisotropic: about 7.5 m between lattice copies along one axis, 45 m along another. Measured: the static cull keeps
    1793 paths at every skew (`buildWorldGeometrySnapshotForRequest`, depth 10), so the budget is not redistributed.
- a = 0 → a = w is a closed loop in moduli space: the Dehn twist T: τ ↦ τ + 1. The UI does not tell the user that the
  start and end worlds are isometric. That is a missed teaching moment, not a bug.
- Step: `nextTorusSkewStep` (`:173-194`) moves at most `maxStepMeters` in (a, b): 0.08 m by default, 0.04 m as
  configured by the app (re-verified 2026-10-28).
  - The dilatation of one step's affine map is K ≈ 1 + |Δτ|/Im τ.
  - So a 0.08 m step distorts shapes twice as much at b = 7.5 as at b = 15, and lattice-coordinate transport of objects
    (issue 53) jumps further where the torus is thin.

## Proposed change

1. **Reduced footprint, fixed marking.** Keep τ (the marked torus) as the state. Build the footprint from the
   Lagrange–Gauss-reduced basis (u*, v*) = γ·(u, v), γ ∈ SL(2,ℤ), with |Re τ*| ≤ ½ and |τ*| ≥ 1.
   - Either use the parallelogram of (u*, v*), or the Dirichlet hexagon: 6 sides, 3 translation pairs, two flat vertex
     classes of three corners each, with angle sum 2π, and no corner close to degenerate.
   - When γ changes between two steps, emit a **re-marking commit**:
     - Points: (α, β) ↦ γ⁻ᵀ(α, β), wrapped mod ℤ² into the new cell.
     - Locked geodesics: π₁(T²) = ℤ² is abelian, so a geodesic class is just its developed displacement. Re-derive the
       portal word by re-tracing the developed chord, which is invariant under the affine map, in the new cell.
   - `validateTopologyPreservingSnapshot` must accept a declared re-marking: the old and new complexes differ
     combinatorially but are isometric.
2. **Step in the Teichmüller metric.** Use d_T = ½ d_ℍ, with ds = |dτ|/(2 Im τ). Move along the hyperbolic geodesic
   (a vertical line or a semicircle orthogonal to ℝ) by at most δ per step. That bounds every commit's affine map to
   K ≤ e^{2δ}, uniformly over the box. δ ≈ 0.0027 matches today's step at b = w (|Δτ| = 0.08/15, Im τ = 1).
3. **Show moduli equivalence.** Show the user when the current τ is SL(2,ℤ)-equivalent to the start state, for example
   "same torus, twisted once": compute γ by reduction and compare reduced τ* values.
4. **Generalize: a GL⁺(2,ℝ) family for translation surfaces.**
   - Detect translation surfaces at compile time: every `transformToTarget` rotation is the identity within 1e-12. That
     holds for both torus worlds. It does not hold for `genus-2-torus.world.js`, whose a b a⁻¹ b⁻¹ c d c⁻¹ d⁻¹ pairing
     on a regular octagon has rotational holonomy.
   - For such surfaces, any M ∈ GL⁺(2,ℝ) applied to every base vertex of every cell keeps glued sides parallel and of
     equal length. The complex stays valid and the per-cell map is simply p ↦ M p.
   - This replaces the torus-specific frame logic (and the frame assumptions in issue 53).
   - It gives a family for any authored translation surface, for example a regular octagon with *opposite* sides glued
     (genus 2, one cone point of 6π). Optionally restrict M to SL(2,ℝ) so area is preserved.

## Acceptance criteria

- At τ = 2 + ½i the compiled footprint has every corner angle ≥ 60° and diameter ≤ 1.2 × the reduced-basis diameter.
  A cross-Dehn-twist deformation keeps the player, the creatures and the locked geodesics continuous: same developed
  positions, same displacement classes.
- Each commit's affine map has dilatation K ≤ e^{2δ}. A test asserts this along a path from τ = i to τ = 2 + ½i.
- A `translation-gl2r` family applies to both torus worlds and to a new opposite-sides octagon world, and rejects
  `genus-2-torus.world.js` with a clear message.
