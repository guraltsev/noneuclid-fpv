# Job 18 - Compile-time vertex classes, cone angles and gluing validation

Status: queued.
Split from issue 52 on 2026-10-28: the defect stays in the issue, the design is here.
Resolves: issue [52](../../_issues/52_compile_time_vertex_classes_and_gluing_validation.md).

## Context

The defect, evidence and current state are in issue [52](../../_issues/52_compile_time_vertex_classes_and_gluing_validation.md).

## Owner constraint

Worlds of any genus and cone-angle profile must stay possible. Compute and report the invariants; do not reject a world for its Euler characteristic. Dropping the cylinders at flat vertices needs the robust vertex-tie rule of [job 12](12_segment_walk_kernel.md) first ([issue 50](../../_issues/50_deep_code_audit_2026_10_09_index.md) theme 3).

## Proposed change

1. **`analyzeCellComplexTopology(compiled)`** in `src/cell-complex/vertexClasses.ts`:
   - Union-find on corners `(cellId, i)`. For each portal pair (A, i) ↔ (B, j), union (A, i) with (B, j+1) and
     (A, i+1) with (B, j).
   - Per class, store `corners`, `coneAngleRadians = Σ` interior angles (computed with `atan2`, never reduced mod 2π),
     `onBoundary` (some incident side is a wall), and `curvature = 2π − θ` (interior) or `π − θ` (boundary).
   - Global: V, E = portalPairs + walls, F, `χ = V − E + F`, connected components of the cell graph, and orientable
     genus `g = 1 − χ/2` when there is no boundary.
   - Store the result on `CompiledCellComplex.topology` (read-only data).
2. **Gluing validation**, which subsumes the length check of 41:
   - For each portal, require |g(vᵢ) − v'ⱼ₊₁| ≤ ε_L and |g(vᵢ₊₁) − v'ⱼ| ≤ ε_L, with ε_L = 1e-9 · max(1, diam).
     This is the actual isometry condition on the edge, not just a midpoint match.
   - Holonomy self-check per interior class: compose the gluing maps around the corner fan, ordered by walking
     corner → next side → glued corner. Require that the loop map fixes the vertex, |h(v) − v| ≤ ε_L, and that its
     rotation angle equals θ_v mod 2π. This catches a compiler regression in `derivePortalTransform` that no unit test
     currently covers.
   - Gauss–Bonnet residual below 1e-9 as an assertion.
   - Warn (not error) when a portal side has ℓ ≤ 2(r_zone + r_player), and when the cell graph is disconnected.
3. **Drop exclusion cylinders at flat interior vertices** (|θ − 2π| ≤ 1e-9 and not on a boundary). Keep them at cone
   points and at boundary vertices: there, collision against the neighbour's walls is not modelled, so the cylinders
   still serve a purpose. Prerequisite: the geodesic tracer and `moveDynamicObject` must handle a hit within δ of a
   flat corner. Rotate the direction through the corner fan, choosing the outgoing corner sector by cumulative
   interior angle, instead of crossing one portal and nudging by ε = 1e-4 m, which may leave the target cell.
   Gate this behind a per-world flag until it is tested.
4. **Junction identity**: give `PortalJunction` a `vertexClassId`, keeping the existing per-corner id for
   compatibility, so debug output and future tools can name "the cone point of angle 270°" consistently.
5. **Dimensionless predicates**:
   - Convexity: `turn / (|a||b|) > 1e-9`, which is sin of the turn angle.
   - Area: `2A / perimeter² > 1e-12`.
   - Point-on-segment: `|cross| / |e| ≤ tol`.
   - `validateCellComplexSpec` should call `validatePrismBaseVertices` instead of duplicating it with different
     thresholds.

## Acceptance criteria

- `compileCellComplex(torus).topology` reports `{V: 1, χ: 0, classes: [{θ: 2π, onBoundary: false}]}` for the
  torus worlds. Issue 51's expected values hold for every example.
- A spec with a midpoint-matched but unequal-length gluing fails with a message naming both sides and the vertex
  mismatch distance.
- A deliberately corrupted `transformToTarget` (rotation off by 1e-3 rad) fails the holonomy self-check in a unit test.
- With flag (3) enabled, the torus worlds compile with 0 forbidden zones. Movement and geodesic tests through a flat
  corner pass.
- Scaling every vertex of a valid world by 1e-3 or 1e3 does not change validation results.
