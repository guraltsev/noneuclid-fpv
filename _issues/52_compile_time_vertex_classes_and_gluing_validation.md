# 52 - The compiler never builds vertex classes: silent bad gluings, cylinders at flat vertices, mixed-unit predicates

Status: open; re-verified 2026-10-28.

Priority: P2 (correctness / robustness / design). This extends the following items of
[MATHEMATICAL_MODEL §11](../_docs/MATHEMATICAL_MODEL.md#11-assumptions-and-known-gaps) and issue 41: equal side lengths,
exclusion cylinders at vertices of angle sum 2π, and validation gaps. It adds a concrete design and several new defects.

Jobs: [18](../.agents/jobs/18_vertex_classes_and_gluing_validation.md).

## Status update 2026-10-28

Done since the audit:

- Equal-length check for glued sides: `src/cell-complex/validateCellComplexSpec.ts` rejects a pair whose lengths differ
  by more than `gluedSideLengthToleranceMeters` (1e-6 m, absolute); test "rejects glued sides of unequal length but
  allows unequal heights" in `tests/cell-complex/validateCellComplexSpec.test.ts`. `compileCellComplex` turns the check
  off because deformation snapshots report mismatches through `validateTopologyPreservingSnapshot`.
- `src/cell-complex/prismBase.ts#validatePrismBaseVertices` now compares with `geometryTolerance` (1e-8, from
  `src/math/tolerances.ts`) rather than a literal; the validator still uses `<= 0`, so the two still differ.

Still open (all of "Proposed change"):

- No vertex classes, cone angles, χ or Gauss–Bonnet in `src/` (no `vertexClasses.ts`, no `topology` field on
  `CompiledCellComplex`). Two tests compute vertex classes with private helpers (`buildVertexClasses` in
  `tests/cell-complex/compileCellComplex.test.ts` and `tests/authoring/exampleWorlds.test.ts`).
- The length check is a length comparison, not the endpoint-isometry check, and its tolerance is absolute, not scaled
  by the world's diameter; no holonomy self-check; no short-portal or connectivity warning.
- Cylinders are still compiled at every portal-incident corner, including the flat torus corners
  (`src/cell-complex/prismCells.ts#compilePortalJunctions`, `:150-169`); junction ids are still per corner.
- The unit-mismatched predicates remain; current locations are given in the Evidence list below.

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

- No corner identification anywhere. `src/cell-complex/prismCells.ts:150-169` (`compilePortalJunctions`) adds a
  junction for both endpoints of every portal side. Gluing data is used only to build `transformToTarget`
  (`compilePortalTransforms.ts`, `derivePortalTransform`).
- Flat vertices still get cylinders. In `torus.world.js` and `torus-moduli.world.js` the single vertex class has
  θ = 4·90° = 360°, so it is a regular point of the flat torus, yet 4 cylinders are compiled. Issue 53 shows these
  cylinders trapping the player after a live deformation.
- θ mod 2π does not decide flatness. The genus-2 octagon has one class of θ = 1080° = 6π. Its holonomy rotation is the
  identity, yet it is a cone point of curvature −4π. A flatness test therefore needs the exact angle sum. Checking only
  that the loop map is a rotation by 0 is not enough.
- Gauss–Bonnet holds in every example (see issue 51's table). That makes it a cheap self-test:
  Σ_interior (2π − θ_v) + Σ_boundary (π − θ_v) = 2πχ, with E counting walls once and portal pairs once.
- Short portals are impassable without a diagnostic. A portal side of length ℓ leaves a walkable gap of
  ℓ − 2(r_zone + r_player) = ℓ − 0.8 m (`forbiddenZones.ts#forbiddenPortalJunctionRadiusMeters` = 0.15,
  `playerBody.ts` default radius 0.25). Nothing warns when ℓ ≤ 0.8 m.
- Unit mismatches in tolerances:
  - `prismBase.ts:86,100` compares twice the area and the edge cross product (both m²) with `geometryTolerance` = 1e-8. Its sibling
    `src/cell-complex/validateCellComplexSpec.ts:190,205` uses `<= 0` instead. That validator was moved there from
    `authoring/validateAuthoringSpec.ts`, which is now a shim, while this audit was under way. The builder and the validator therefore accept different
    polygons, and both results depend on the world's scale.
  - `polygons.ts:110-112` (`pointLiesOnSegment2xy`) compares `cross` (|e|·distance, m²) with a tolerance in metres. The boundary band is
    tol/|e| wide: 1.8e-10 m on a 55 m genus-2 side and 1e-7 m on a 0.1 m side.
  - `intersections.ts:45,51` (`intersectSegmentWithPlane`, re-verified 2026-10-28; the file is now 62 lines) compares a
    signed-distance difference (m) and a dimensionless `t` with the same `tolerance`.
- The cell graph is not checked for connectivity. An unreachable cell compiles, gets path tables and is never seen.

## Fix

Tracked as job [18](../.agents/jobs/18_vertex_classes_and_gluing_validation.md). This issue is resolved when that job's acceptance criteria hold.

## Merged from issue 41 (2026-10-28)

- Unequal cell heights across a portal are neither modelled (the aperture is the smaller height) nor rejected. The
  `validateCellComplexSpec.ts` header says it does not check them. Either reject them in validation or model the
  aperture explicitly.
