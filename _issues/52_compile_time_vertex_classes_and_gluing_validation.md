# 52 - Compile-time vertex classes, cone angles and gluing validation

Status: open as of 2026-10-08.

Priority: P2 (correctness / robustness / design). This extends the following items of
[MATHEMATICAL_MODEL §11](../MATHEMATICAL_MODEL.md#11-assumptions-and-known-gaps) and issue 41: equal side lengths,
exclusion cylinders at vertices of angle sum 2π, and validation gaps. It adds a concrete design and several new defects.

## Summary

The compiler never builds the vertex classes of the glued surface. That has four consequences.

1. Invalid or unintended worlds compile silently. Issue 51 shows a whole example glued into the wrong surface.
2. The 0.15 m exclusion cylinders are placed at every portal-incident corner, including corners that are flat points
   (θ = 2π): all four corners of both torus worlds.
3. Junction identity is per cell corner (`"<cell>:vertex-<i>"`), not per point of the surface. One cone point carries
   3-25 unrelated ids.
4. Validation predicates use absolute tolerances on quantities with different units.

A union-find pass over the corners, about 60 lines and O(corners · α), gives the combinatorial invariants. These are
compile-time integrity data, not a runtime "curvature engine". Design record 003 keeps them out of what students see.
Making them visible would need an amendment to 003. This issue only uses them internally and in debug output.

## Evidence

- No corner identification anywhere. `src/cell-complex/prismCells.ts:365-384` (`compilePortalJunctions`) adds a
  junction for both endpoints of every portal side. Gluing data is used only to build `transformToTarget`
  (`compilePortalTransforms.ts:51-58`).
- Flat vertices still get cylinders. In `torus.world.js` and `torus-moduli.world.js` the single vertex class has
  θ = 4·90° = 360°, so it is a regular point of the flat torus, yet 4 cylinders are compiled. Issue 53 shows these
  cylinders trapping the player after a live deformation.
- θ mod 2π does not decide flatness. The genus-2 octagon has one class of θ = 1080° = 6π. Its holonomy rotation is the
  identity, yet it is a cone point of curvature −4π. A flatness test therefore needs the exact angle sum. Checking only
  that the loop map is a rotation by 0 is not enough.
- Gauss–Bonnet holds in every example (see issue 51's table). That makes it a cheap self-test:
  Σ_interior (2π − θ_v) + Σ_boundary (π − θ_v) = 2πχ, with E counting walls once and portal pairs once.
- Short portals are impassable without a diagnostic. A portal side of length ℓ leaves a walkable gap of
  ℓ − 2(r_zone + r_player) = ℓ − 0.8 m (`forbiddenZones.ts:115`, `playerBody.ts`). Nothing warns when ℓ ≤ 0.8 m.
- Unit mismatches in tolerances:
  - `prismBase.ts:86,100` compares twice the area and the edge cross product (both m²) with 1e-8. Its sibling
    `src/cell-complex/validateCellComplexSpec.ts:190,205` uses `<= 0` instead. That validator was moved there from
    `authoring/validateAuthoringSpec.ts`, which is now a shim, while this audit was under way. The builder and the validator therefore accept different
    polygons, and both results depend on the world's scale.
  - `polygons.ts:290-292` compares `cross` (|e|·distance, m²) with a tolerance in metres. The boundary band is
    tol/|e| wide: 1.8e-10 m on a 55 m genus-2 side and 1e-7 m on a 0.1 m side.
  - `intersections.ts:424,430` compares a length difference (m) and a dimensionless `t` with the same `tolerance`.
- The cell graph is not checked for connectivity. An unreachable cell compiles, gets path tables and is never seen.

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
