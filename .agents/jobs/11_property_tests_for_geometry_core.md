# Job 11 - Property-based tests for the geometry core

Status: queued.
Former issue: 79 (converted to a job on 2026-10-28). Revised on 2026-10-29 for a less capable implementing model.
Resolves: nothing by itself (it is test infrastructure). Jobs 12-17 add their own property tests on top of it.

## Goal

1. Add `fast-check` and a small set of shared generators (`tests/support/arbitraries.ts`).
2. Add property tests for the pure geometry core (`src/math`, `src/cell-complex`, `src/movement`) that **pass on the
   current code**. This job does not fix bugs. A property that fails on the current code is recorded and either
   weakened to what the code really guarantees, or turned into `it.skip` with a link to the job that will fix it.
3. Add the missing example test files, move the four loose root tests into `tests/glue/`, and add a coverage command.

## Depends on

Nothing. Jobs 12-17 depend on this job, because they reuse `tests/support/arbitraries.ts`.

## Before you start

Read these files. Line numbers are from commit `0d86165`; if they moved, search for the name.

| File | What to look at |
| --- | --- |
| `src/math/rigidTransform3.ts` | all (167 lines): `composeRigidTransform3(a, b)` is "a after b" |
| `src/math/vec3.ts`, `src/math/polygons.ts`, `src/math/intersections.ts`, `src/math/planes.ts` | all |
| `src/math/tolerances.ts` | `geometryTolerance = 1e-8` |
| `src/cell-complex/compilePortalTransforms.ts` | `derivePortalTransform` (:65-79) |
| `src/cell-complex/prismCells.ts` | `CompiledPrismSide` (:55-65): `start`, `end`, `inwardNormal`, `lengthMeters` |
| `src/cell-complex/portalPaths.ts` | `PortalRenderPath` (:60-90), `buildPortalPathTables` (:104) |
| `src/movement/portalCrossing.ts` | `crossDynamicObjectPortal` |
| `src/movement/moveDynamicObject.ts` | `moveDynamicObject` (:87-170) |
| `src/runtime/worldGeometryDeformations.ts` | `createIdentityCellDeformationMaps` (:264), `transformPoseWithCellMaps` (:144) |
| `src/authoring/exampleWorlds.ts` | the ten exported example specs |
| `tests/math/rigidTransform3.test.ts` | the existing example-test style |
| `vite.config.ts` | the `test` block (only `environment: "node"`) |

Baseline, before you change anything (measured on 2026-10-29: 94 files, 706 passed, 8 skipped, about 56 s;
`tests/cell-complex/portalPaths.test.ts` alone takes about 54 s of that):

```bash
npm run typecheck
npm test
```

## Background

- Every gluing map is a rotation about +z plus a horizontal translation (`_docs/MATHEMATICAL_MODEL.md` §3). In world
  data `R.m02 = R.m12 = R.m20 = R.m21 = 0`, `R.m22 = 1`, and `t.z = 0`.
- Glued sides have equal length within 1e-6 m (`validateCellComplexSpec`, `checkGluedSideLengths`). The portal map
  sends the source side's start vertex to the target side's **end** vertex and vice versa (the boundary is traversed in
  opposite directions by the two counterclockwise cells).
- `npm test` also runs `tests/docs/documentation.test.ts`. It checks `src/` only, so test helpers need no JSDoc.

## Decisions

1. **Library and versions.** Decided: `fast-check` 3.x and `@vitest/coverage-v8` pinned to the installed vitest version
   (1.6.1). Command:
   `npm install --save-dev --save-exact fast-check@3.23.2 @vitest/coverage-v8@1.6.1`.
   If `fast-check@3.23.2` cannot be installed, use the newest 3.x that `npm view fast-check@3 version` lists and record
   it under `### Deviations`. Why: fast-check 3 is the long-stable line; the coverage plugin must match vitest's major
   and minor version or vitest refuses to load it.
2. **Run counts.** Decided: `numRuns: 200` for pure math, `numRuns: 50` for anything that compiles a world. Compile
   each example world once per file (module-level `const`), never inside a property. Why: keeps the whole set of new
   property tests under 10 s; the suite is already 56 s.
3. **Seeds.** Decided: no fixed seed. fast-check prints the seed and the shrunk counterexample on failure; copy both
   into the report if a property fails. Why: fixed seeds hide bugs.
4. **What is NOT in this job.** Decided, and different from issue 79's original table:
   - The static-cull conservativeness property moves to [job 20](20_exact_static_cull.md) (it is known to be unsound
     today, `MATHEMATICAL_MODEL.md` §11 "Culling soundness").
   - The `portalWord` module does not exist until [job 25](25_split_geodesic_cannon_modules.md). Test
     `reverseGeodesicPortalWord` (exported from `src/world-objects/geodesicCannon.ts`) for involution only.
   - Moving pure-logic tests out of `tests/render-contract/` waits for [job 32](32_layer_dag.md).
   - The movement round-trip, "never ends outside its cell" and corner properties belong to jobs 13 and 14, because
     they fail today (issues 61, 62, 65). This job adds only the movement properties that hold now.
5. **Coverage.** Decided: add `npm run test:coverage` (vitest `--coverage`) scoped to `src/math`, `src/cell-complex`,
   `src/movement`. Do **not** add it to the pre-push hook. Set `thresholds.lines` to the measured line coverage of
   those three directories rounded **down** to a whole percent, minus 1. Record the measured numbers in the report.
   Why: there is no CI; a floor that already fails would block every push. The 85% target of issue 79 stays the goal.
6. **Tolerances in assertions.** Decided: compare with absolute `1e-9` for unit-scale math, and with
   `1e-9 * max(1, |coordinates|)` where coordinates reach 100 m. Never use `toBeCloseTo` with its default precision
   for these.

## Steps

Run `npm run typecheck` after every step that changes TypeScript, and the named test file with
`npx vitest run <file>`.

### Step 1: dependencies and coverage script

1. Run the install command of Decision 1.
2. In `package.json` `scripts`, add `"test:coverage": "vitest run --coverage"`.
3. In `vite.config.ts`, extend the `test` block:

   ```ts
   test: {
     environment: "node",
     coverage: {
       provider: "v8",
       include: ["src/math/**", "src/cell-complex/**", "src/movement/**"],
       reporter: ["text-summary", "text"],
       // thresholds: { lines: NN },  // set in step 7
     },
   },
   ```

4. Check `.gitignore` already lists `coverage/` (it does on 2026-10-29).

### Step 2: shared generators

Create `tests/support/arbitraries.ts`. Export exactly these (names are used by jobs 12-17):

```ts
import fc from "fast-check";
// Coordinates in meters; never NaN or infinite.
export const arbCoordinate = fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true });
export const arbVec3: fc.Arbitrary<Vec3>;            // three arbCoordinate
export const arbUnitVec3: fc.Arbitrary<Vec3>;        // arbVec3 filtered to length > 1e-3, then normalized
export const arbYawRadians = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
export const arbYawRigidTransform3: fc.Arbitrary<RigidTransform3>;   // yawRigidTransform3(yaw, (x, y, 0))
export const arbRigidTransform3: fc.Arbitrary<RigidTransform3>;      // random unit quaternion -> rotation matrix, plus arbVec3
export const arbConvexPolygon2xy: fc.Arbitrary<Polygon2xy>;          // see below
export const exampleWorldSpecs: readonly (readonly [string, CellComplexSpec])[];   // the ten specs of exampleWorlds.ts
export function arbPointInCell(cell: CompiledPrismCell): fc.Arbitrary<{ x: number; y: number }>;
```

- `arbConvexPolygon2xy`: pick `n` in [3, 8], a radius `R` in [1, 20], a center in [-50, 50]², and `n` angles. Build the
  angles as sorted cumulative gaps: draw `n` gaps in [1, 2], scale them so they sum to 2π. Vertex k is
  `center + R·(cos θ_k, sin θ_k)`. Equal-radius points in increasing angle are always strictly convex and
  counterclockwise. Filter out polygons with an edge shorter than 0.05 m.
- `arbRigidTransform3`: draw four doubles in [-1, 1], filter norm > 1e-3, normalize to (w, x, y, z), and use the
  standard quaternion-to-matrix formula.
- `arbPointInCell`: draw one weight in [0.01, 1] per base vertex and return the weighted average of the vertices
  (strictly inside a convex cell).

Add `tests/support/arbitraries.test.ts` with one sanity test per generator (for example: every generated polygon has
positive `polygonSignedArea2xy` and passes `validatePolygon2xy`; every unit vector has length 1 within 1e-12).

### Step 3: math properties

Create one `*.property.test.ts` next to each existing math test:

| File | Properties (all must pass on current code) |
| --- | --- |
| `tests/math/rigidTransform3.property.test.ts` | `compose(g, invert(g))` maps any point to itself within 1e-9·scale; `compose` is associative on points; `transformPoint3(compose(a, b), p) = a(b(p))`; distances between two points are preserved; `dot` of two directions is preserved; `compose(yaw(a), yaw(b))` equals `yaw(a + b)` on points |
| `tests/math/vec3.property.test.ts` | `normalizeVec3` gives length 1 within 1e-12, or throws when length ≤ 1e-8; `cross(a, b)·a ≈ 0` and `cross(a, b)·b ≈ 0` (tolerance 1e-9·\|a\|·\|b\|·max(\|a\|, \|b\|)); triangle inequality `\|a + b\| ≤ \|a\| + \|b\| + 1e-9` |
| `tests/math/polygons.property.test.ts` | reversing the vertex list negates the signed area; area is invariant under a yaw rigid motion (1e-9·area); the vertex average of a convex polygon is classified `inside`; every vertex is classified `boundary` |
| `tests/math/intersections.property.test.ts` | for a plane from `planeFromPointAndNormal(arbVec3, arbUnitVec3)` and a segment whose endpoints have signed distances of opposite sign and both \|d\| ≥ 1e-3: the result is `point`, its `t` is in [0, 1], and the point's signed distance is within 1e-9·scale of 0 |

### Step 4: cell-complex properties

Compile every spec of `exampleWorldSpecs` once at module level.

| File | Properties |
| --- | --- |
| `tests/cell-complex/compilePortalTransforms.property.test.ts` | for every portal in every world (a plain loop is fine; no generator needed): (a) **reciprocity**: `compose(reciprocal.transformToTarget, portal.transformToTarget)` maps any `arbVec3` to itself within 1e-9·scale; (b) the source side's `start` maps to the target side's `end`, and `end` to `start`, within 1e-6 m; (c) the source outward normal (`-inwardNormal`) maps to the target `inwardNormal` within 1e-12; (d) `R` is a pure yaw: `m02, m12, m20, m21` are 0 and `m22` is 1 within 1e-12, and `t.z` is 0 |
| `tests/cell-complex/compilePortalTransforms.test.ts` (new example file) | one hand-checked example: two unit squares glued east-west; the transform is a translation by (2, 0, 0) (check the numbers by hand before writing them) |
| `tests/cell-complex/portalPaths.property.test.ts` | with `buildPortalPathTables(world, { maxDepth: 3 })` on `cube`, `tetrahedron` and `torus` only (speed): every non-root path's `parentPathId` exists in `pathsById`; `path.depth === path.steps.length`; the depth-0 path is the only one with `steps.length === 0`; `rootFromDestination` equals the composition `inv(g_1) ∘ inv(g_2) ∘ … ∘ inv(g_k)` of its steps' portal transforms, applied to three fixed test points, within 1e-9·scale; `compose(destinationFromRoot, rootFromDestination)` is the identity on points |
| `tests/cell-complex/prismCells.test.ts` (new example file) | `compilePrismCellGeometry` of a unit square: four sides, inward normals (0, 1), (-1, 0), (0, -1), (1, 0) in side order, lengths 2, and one forbidden zone per portal-side endpoint |

For the composition check, look up each step's portal with
`world.cellsById.get(step.sourceCellId)!.portalsById.get(step.sourcePortalId)!`. If the order of composition in the
code is the other way round, the property tells you; fix the **test** to match the code, and write the order you found
into the test's comment and into the report.

### Step 5: movement properties that hold today

| File | Properties |
| --- | --- |
| `tests/movement/portalCrossing.test.ts` (new) | example: crossing the east portal of `twoRoomsWithPortal` (copy the helper from `tests/movement/moveDynamicObject.test.ts`) maps (0.95, 0, 0.5) to (-0.95, 0, 0.5) |
| `tests/movement/portalCrossing.property.test.ts` | for every portal of every example world and any `arbYawRigidTransform3` pose: crossing the portal and then its reciprocal returns the pose within 1e-9·scale (translation) and 1e-12 (rotation entries) |
| `tests/movement/moveDynamicObject.property.test.ts` | in `singleRoom` (copy the helper): a zero displacement leaves the pose unchanged and not blocked for any start point drawn with `arbPointInCell` that is at least 0.11 m from every wall (the default test body has radius 0.1) |

### Step 6: the remaining rows

| File | Properties |
| --- | --- |
| `tests/world-objects/geodesicPortalWord.property.test.ts` | for words built from random sequences of real portal traversals of `cube` (pick a random portal of the current cell, step to its target): `reverseGeodesicPortalWord(reverseGeodesicPortalWord(w))` deep-equals `w`. Look up the traversal type `GeodesicPortalTraversal` in `geodesicCannon.ts` to build the words. |
| `tests/runtime/worldGeometryDeformations.property.test.ts` | `createIdentityCellDeformationMaps(world)` maps every `arbPointInCell` point of `torusModuli` to itself exactly, and `transformPoseWithCellMaps` with those maps returns an equal pose (read its signature first) |

### Step 7: layout and coverage floor

1. `git mv` the four root tests into `tests/glue/`: `tests/debugSettings.test.ts`, `tests/launchOptionsUrl.test.ts`,
   `tests/readLaunchOptions.test.ts`, `tests/geometrySelection.test.ts`. Fix their relative imports (`../src/` becomes
   `../../src/`). Run them.
2. Run `npm run test:coverage`. Read the line coverage of each of the three directories from the text report. Set
   `thresholds: { lines: NN }` in `vite.config.ts` with NN from Decision 5. Run `npm run test:coverage` again; it must
   pass.
3. List in the report every module in `src/math`, `src/cell-complex`, `src/movement` that still has **no** test file
   of its own name. Do not write more tests for them in this job.

## Tests and checks

- Every new file passes on its own (`npx vitest run <file>`).
- `npm run typecheck`, `npm test`, `npm run docs:check` pass. `npm test` must not get slower by more than 15 s; record
  the before and after durations.
- `npm run test:coverage` passes with the threshold you set.

## Do not

- Do not change any file under `src/`: this job only adds tests and configuration. If a property fails,
  record the counterexample under `### Uncertain`, mark that one property `it.skip` with a comment
  `// fails on current code; fixed by job NN` (choose 12-17 by topic, or 20 for culling), and carry on.
- Do not lower `numRuns` below the values in Decision 2 to make a slow test fast; move the property to fewer worlds
  instead.
- Do not move tests out of `tests/render-contract/`.

## Done when

- `fast-check` and `@vitest/coverage-v8` are dev dependencies at exact versions.
- `tests/support/arbitraries.ts` exports every name listed in step 2.
- Every property in steps 3-6 exists and passes, or is skipped with a recorded counterexample.
- No test file sits directly under `tests/`.
- `npm run test:coverage` exists, is not in the pre-push hook, and its floor is recorded in the report.
