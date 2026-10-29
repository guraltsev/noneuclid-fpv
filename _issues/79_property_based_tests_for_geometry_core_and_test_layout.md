# 79 - Property-based tests for the geometry core; fix test layout gaps

Status: open; re-verified 2026-10-28.

Priority: P2 (testing).

## Status update 2026-10-28

Nothing in this issue has been done. Re-checked `package.json`, `vite.config.ts` and the `tests/` tree.

Done:
- Nothing.

Remains:
- No `fast-check` or `@vitest/coverage-v8` dev dependency; no `tests/support/`; no `*.property.test.ts` files; no
  coverage configuration in `vite.config.ts`.
- `tests/math/*.test.ts` are unchanged (29 + 20 + 35 + 51 + 33 lines; `rigidTransform3.test.ts` still has 4 cases).
- Core modules with no matching test file: `math/tolerances.ts`, `cell-complex/compilePortalTransforms.ts`,
  `cell-complex/prismCells.ts`, `cell-complex/forbiddenZones.ts`, `cell-complex/specs.ts`, `cell-complex/prismBase.ts`
  (type test only, `tests/typecheck/prismBase.types.ts`), `movement/portalCrossing.ts`, `movement/dynamicObject.ts`,
  `movement/playerBody.ts`, `movement/playerPose.ts`.
- The four root test files are still directly under `tests/`, and the pure-logic tests are still in
  `tests/render-contract/` (blocked on issue 78).
- `tests/world-objects/geodesicCannon.test.ts` has grown to 3,111 lines (split with issue 76).

## Summary

The geometry core is the part whose correctness matters most and it has the thinnest tests: the five `tests/math` files
total 168 lines of hand-picked examples, and several `cell-complex`/`movement` modules have no test file. Several P1
items in issue 41 (side-length mismatch, culled-id consistency, crossing behavior) are exactly the kind of bug a
generated-input invariant would have caught. Test placement also no longer mirrors `src/`.

## Evidence

- `tests/math/*.test.ts`: 29 + 20 + 35 + 51 + 33 lines; `rigidTransform3.test.ts` has 4 cases (:14, :19, :26, :38).
- No test file references `src/cell-complex/compilePortalTransforms.ts` or `src/cell-complex/prismCells.ts`;
  `src/movement/portalCrossing.ts` is not imported by any test (`tests/movement/moveDynamicObject.test.ts` only exercises it
  indirectly through `portalCrossingMode`).
- No property-testing dependency in `package.json`.
- Pure logic tested under `tests/render-contract/` because its source lives in `render/three`: `aimTarget.test.ts`,
  `visiblePortalPaths.test.ts`, `vrLocomotion.test.ts`, `xrSessionState.test.ts`, `geodesicCarryPortalTransition.test.ts`
  (see 78).
- Loose root tests `tests/debugSettings.test.ts`, `tests/launchOptionsUrl.test.ts`, `tests/readLaunchOptions.test.ts`,
  `tests/geometrySelection.test.ts` test `src/glue/*` but sit outside a `tests/glue/` folder.
- `tests/world-objects/geodesicCannon.test.ts` is 3,111 lines (split with issue 76).
- 330 type errors appeared in `src/` + `tests/` under `noUncheckedIndexedAccess` on 2026-10-08 (see 80, which owns the
  current count); 13 were in `src/math/polygons.ts`.

## Proposed change

Add `fast-check` (dev dependency) and `tests/support/arbitraries.ts` with `arbVec3`, `arbUnitVec3`, `arbYawRigidTransform3`,
`arbRigidTransform3`, `arbConvexPolygon2xy` (sorted angles on a jittered circle), and `arbWorld` drawn from the bundled
example specs plus randomized torus/prism parameters. Seed is printed on failure; default 200 runs, `numRuns` lowered for
heavy compiles.

Invariants (one `*.property.test.ts` next to each existing test):

| Module | Invariant |
| --- | --- |
| `math/rigidTransform3` | `compose(g, invert(g)) ≈ id`; `compose` associative; `transformPoint(compose(a,b),p) = a(b(p))`; distances and `dot` of directions preserved; `yawRigidTransform3(a)∘yaw(b) = yaw(a+b)` |
| `math/vec3` | `normalize` gives unit length or throws below tolerance; `cross(a,b)⊥a,b`; triangle inequality |
| `math/polygons` | signed area flips under reversal; area invariant under rigid motion; centroid classified `inside` for convex polygons; vertices classified `boundary` |
| `math/intersections`, `math/planes` | reported hit point lies on both objects within tolerance |
| `cell-complex/compilePortalTransforms` | **reciprocity** `g_{b→a} = g_{a→b}⁻¹`; `g` maps the source side segment onto the target side segment endpoint-to-endpoint (catches the unequal-length bug in 41); inward normal maps to outward normal |
| `cell-complex/portalPaths` | `rootFromDestination` of a path equals the composition of its portal steps; each child path's parent id exists; no path when `maxDepth = 0` beyond the root |
| `cell-complex/staticPortalPathCull` | culled set ⊆ uncull set; **conservativeness**: for random camera poses inside the root cell, every path `computeVisiblePortalPaths` reports visible is kept by the static cull (cross-check against the dynamic visibility in `visiblePortalPaths.ts`) |
| `movement/portalCrossing` + `movePlayer` | **round trip**: crossing a portal and stepping back by the reversed displacement returns to the start cell and pose within tolerance; a move never ends outside the cell's prism or inside a forbidden zone; zero input leaves the pose unchanged |
| `world-objects/geodesic/portalWord` (76) | `reverse(reverse(w)) = w`; `reduce` is idempotent; `reduce(w · reverse(w)) = ε` |
| `runtime/worldGeometryDeformations` | identity deformation maps every pose to itself; transport then inverse transport is identity |

Layout:
- Move the four root `tests/*.test.ts` files to `tests/glue/`.
- After 78, move pure-logic tests out of `tests/render-contract/`; keep that folder for tests that construct Three.js
  objects.
- Add `tests/cell-complex/compilePortalTransforms.test.ts`, `tests/cell-complex/prismCells.test.ts`,
  `tests/movement/portalCrossing.test.ts` with at least one example each besides the property tests.
- Add vitest coverage (`@vitest/coverage-v8`) scoped to `src/math`, `src/cell-complex`, `src/movement`, with a floor
  enforced in CI (issue 36).

## Acceptance criteria

- `fast-check` property tests exist for every row above and run in plain Node under `npm test` in < 20 s total.
- Every module in `src/math`, `src/cell-complex`, `src/movement` has a matching test file.
- No test files directly under `tests/`.
- Line coverage for the three core directories reported in CI, with a floor of at least 85%.
