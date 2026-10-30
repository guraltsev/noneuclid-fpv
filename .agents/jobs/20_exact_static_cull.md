# Job 20 - Exact static cull by oriented line stabbing

Status: queued.
Split from issue 56 on 2026-10-28; rewritten on 2026-10-29 for a less capable implementing model (line numbers re-checked
at commit `0b468e1`).
Resolves: issue [56](../../_issues/56_exact_static_cull_by_oriented_line_stabbing.md) (including its "Merged from issue 41"
section).

## Goal

Replace the static portal-path cull (`src/cell-complex/staticPortalPathCull.ts`, 1639 lines) by an exact test:

1. A portal word is kept **iff** some oriented plan-view line crosses its portals in order, each in the forward sense.
   The set of such lines is a convex cone `K` in R^3, updated in O(|K|) per child (homogeneous Sutherland-Hodgman).
2. The aperture-plane test (with its 7.5 cm slack that rejects *more* as it grows), the interval branch-and-bound, the
   projective chart (which misses lines crossing the line sent to infinity) and the tau/sigma debug code are deleted.
3. `StaticPortalPathRejectReason` becomes `"no-static-line-transversal" | "static-path-budget"`.
4. The per-root budget is spent best-first by the Crofton measure of `K` (largest set of sight lines first), so the
   budget drops the least visible words in every direction instead of a prefix of `cell.portals` order.
5. Every kept path stores its newest portal developed into the root frame (`newestPortalInRoot`). Job 21 reuses it.

## Depends on

Nothing in code. In the batch this job runs after jobs 37, 25-27 and 28-29; none of them touch
`staticPortalPathCull.ts`, but 28/29 move lines in `createThreeApp.ts`: **search by name, not by line number**.
Job 21 depends on this job (it imports `OrientedPortalSegment` and reads `PortalRenderPath.newestPortalInRoot`). Job 24
(lazy trie) will call `clipLineConeByPortal` per trie node, so keep that function free of table bookkeeping.

## Before you start

Line numbers are at commit `0b468e1`; re-find them by name.

| File | Lines | What |
| --- | --- | --- |
| `src/cell-complex/staticPortalPathCull.ts` | 1-24 | header and imports (`forbiddenPortalJunctionRadiusMeters`, `CompiledPrismSide`) |
| | 28-66 | private types `Vec2`, `Segment2`, `TauSigmaBox`, `HalfPlane2`, `ProjectiveTauSigmaResult` |
| | 71-88 | `StaticPortalPathCullOptions` (`toleranceMeters`, `maxKeptPathsPerRoot`, `keepRejectedPathDetails`, `debugTauSigmaDisagreements`) |
| | 93-133 | `TauSigmaDisagreementStats`, `BuildStaticallyCulledPortalPathTablesOptions` (`onDepthComplete`), `StaticPortalPathDepthStatus` |
| | 138-177 | `StaticPortalPathCullResult`, `StaticPortalPathCullSummary`, `StaticPortalPathRejectReason` (4 members at :164), `RejectedPortalRenderPath` |
| | 184-347 | `buildStaticallyCulledPortalPathTables` (BFS, budget at :254, `cullTolerance` at :201, tests at :285-294) |
| | 354-440 | `staticallyCullPortalPathTables` (filters an existing table, inherits parent rejection at :384-392) |
| | 446-490 | `rejectGeometrically` |
| | 495-508 | `isImmediateReverse` (keep) |
| | 514-1526 | tau/sigma machinery and 2D helpers (full list in Part C) |
| | 1532-1580 | `rejectAgainstPortalAperture` (the `> -toleranceMeters` rule at :1548), `prismBoundVertices` |
| | 1585-1639 | `createGeometricRejection`, `createRejection`, `createInheritedRejection`, `stripRejectionDetails` |
| `src/cell-complex/portalPaths.ts` | 60-87, 160-224 | `PortalRenderPath`; `buildPortalPathTableForRoot` (child creation at :197-216) |
| `src/cell-complex/segmentWalk.ts` | 24-112 | `SegmentWalkCrossing` (`sourceCellId`, `portalId`), `walkDevelopedSegment` (job 12) |
| `src/cell-complex/prismCells.ts` | 55 | `CompiledPrismSide` (`start`, `end`, `inwardNormal`, `sideIndex`) |
| `src/math/polygons.ts` | 10 | `Vec2xy` |
| `src/math/vec3.ts` | 19-94 | `vec3`, `dotVec3`, `crossVec3`, `lengthVec3` |
| `src/render/three/createThreeApp.ts` | 782-796 | `portalPathOptions` (`maxDepth 10`, `toleranceMeters 1e-6`, `maxKeptPathsPerRoot 50_000`) |
| `src/render/three/portalDebugRuntime.ts` | 141-168 | the only `onDepthComplete` caller |
| `src/render/three/cellRenderArchetypes.ts` | 170-182 | `buildDefaultCellRenderArchetypeCapacities` (also builds a cull) |
| `src/runtime/worldGeometryWorker.ts` | 79 | worker build of the cull |
| `tests/cell-complex/staticPortalPathCull.test.ts` | all (303) | existing tests; several change (Part B step 6) |
| `tests/cell-complex/portalPathDebug.test.ts` | 77, 102 | uses `staticallyCullPortalPathTables` |
| `tests/support/arbitraries.ts` | 90-119 | `exampleWorldSpecs` (10 example worlds), `arbPointInCell` (job 11) |
| `_docs/MATHEMATICAL_MODEL.md` | 129-154, 473 | Section 4 description of the cull; Section 11 "Culling soundness" |

Baseline: `npm run typecheck`, `npm test`, `npm run docs:check`. Then record the **build-time baseline** (Part A step 1)
before you change any culling code.

## Background

All tests are done in the **root frame's plan** (x, y; z is ignored). Gluing maps are rotations about z plus
translations, so they preserve left and right.

**Developed portal.** For a path whose newest step leaves cell `C` through side `s` (side `i` runs from base vertex `i`,
`side.start`, to vertex `i + 1`, `side.end`; cells are counterclockwise), let `rootFromSource` be the **parent** path's
`rootFromDestination` (the source cell of the newest step is the parent's destination). Then

```text
right = rootFromSource(side.start)      left = rootFromSource(side.end)
```

Facing out of `C` through `s`, `left` is on your left. Check on the unit square `(0,0),(1,0),(1,1),(0,1)`, side 0:
leaving through `y = 0` means facing `-y`; your left is `+x`, i.e. `side.end = (1,0)`. In formula form,
`cross(-inwardNormal, left - mid) > 0`.

**Oriented lines.** A line is a homogeneous triple `l = (a, b, c)` (stored as `Vec3` with `x=a, y=b, z=c`). Its left
side is `{a·x + b·y + c > 0}` and its direction is `(b, -a)`. The line through `P` then `Q` (directed `P -> Q`) is
`l = cross((P.x, P.y, 1), (Q.x, Q.y, 1))`. Example: `P = (0,0)`, `Q = (1,0)` gives `l = (0, 1, 0)`: left side `y > 0`,
direction `(1, 0)`.

**Constraints of one portal.** "`l` crosses portal `(left, right)` in the forward sense" is

```text
l · (left.x, left.y, 1)   >= 0      (left endpoint on the left)
l · (right.x, right.y, 1) <= 0      (right endpoint on the right)
```

Written as `h · l >= 0` with two **constraint vectors** `hL = (left.x, left.y, 1)` and `hR = (-right.x, -right.y, -1)`.

**Why this is exact** (issue 56). Inside a convex cell, a line that enters through `s_i` leaves through the next side it
meets, so the 2k inequalities force the crossings to happen in order. Any line that crosses `s_1` forward also passes
through the root cell just before `s_1`, so some eye position sees along it. With equal cell heights every horizontal
line at eye height passes every aperture, so the plan test is exact in 3D. Depth-1 words are always visible (a line
through the middle of the portal). Depth-2 words in convex cells are always visible too (join interior points of the
two sides), but they still get a cone, because children are clipped from it.

**The cone.** `K(word) = { l : h · l >= 0 for all 2k constraint vectors }`. For k >= 2 it is a pointed polyhedral cone
(it contains no opposite pair `l, -l` unless all four endpoints are collinear). Represent it by its **extreme rays in
cyclic order**, each a unit `Vec3`. A child adds two constraints; clip the parent's rays by each (Sutherland-Hodgman on
the cyclic list). On an edge `a -> b` with values `va = h·a`, `vb = h·b` of opposite sign (one inside, one outside),
the new ray is

```text
r = |va| · b + |vb| · a          (positive combination, h · r = 0), then normalize
```

**Crofton measure.** Parametrize an oriented line by the angle `theta` of its normal `(a, b)` and `p = -c / |(a,b)|`.
The measure of lines in `K` is the area of its image in `(theta, p)`. On the face between consecutive rays `r_i`,
`r_{i+1}` every line passes through the point `P_i = r_i × r_{i+1}` (dehomogenized), so `p(theta) = P_i.x cos theta +
P_i.y sin theta`, and Green's theorem gives the exact formula

```text
mu(K) = | sum_i  P_i.x (sin th_{i+1} - sin th_i) - P_i.y (cos th_{i+1} - cos th_i) |,   th_i = atan2(r_i.b, r_i.a)
```

(skip a term when `|sin(th_{i+1} - th_i)| < 1e-12`; cones with fewer than 3 rays have `mu = 0`). For a depth-2 word
this is the crossed-strings formula `|L1R2| + |R1L2| - |L1L2| - |R1R2|`. A child's cone is a subset of its parent's, so
`mu(child) <= mu(parent)`. Depth-1 words get `mu = 2 · |left - right|` (all lines meeting a segment); the root gets
`+Infinity`.

## Decisions

1. **Where the new code lives.** Decided: two new modules.
   - `src/cell-complex/orientedPortal.ts`: `OrientedPortalSegment` and `developPortalSegment` (used by the cull and by
     job 21).
   - `src/cell-complex/staticLineCone.ts`: the cone (`LineCone`), its construction, clipping and measure. No table
     bookkeeping in it (job 24 will reuse it per trie node).
   Why: job 21 must import the portal representation without pulling in the cull.
2. **Portal representation.** Decided:

   ```ts
   /** A portal side developed into a root frame's plan; `left`/`right` as seen when leaving the source cell through it. */
   export interface OrientedPortalSegment {
     readonly left: Vec2xy;              // image of side.end, meters, root frame
     readonly right: Vec2xy;             // image of side.start
     readonly apertureTopMeters: number; // min(source cell height, target cell height)
   }
   export function developPortalSegment(
     world: CompiledCellComplex, sourceCellId: string, sideIndex: number, rootFromSource: RigidTransform3,
   ): OrientedPortalSegment;   // throws on a missing cell or side
   ```

   `PortalRenderPath` (in `portalPaths.ts`) gets an optional field
   `readonly newestPortalInRoot?: OrientedPortalSegment;` (absent on the root path). Both `buildPortalPathTableForRoot`
   and the culled builder fill it for every non-root path. It is optional only so that hand-built test fixtures keep
   compiling. Why: job 21 needs exactly this per path every frame; computing it once at build time removes the
   per-frame `transformPoint3` calls.
3. **Cone API** (`staticLineCone.ts`):

   ```ts
   /** Extreme rays (unit Vec3, x=a, y=b, z=c) of a pointed cone of oriented lines, in cyclic order. Empty = no line. */
   export type LineCone = readonly Vec3[];
   export function portalConstraintVectors(portal: OrientedPortalSegment, wideningMeters: number): readonly [Vec3, Vec3];
   export function lineConeForTwoPortals(first: OrientedPortalSegment, second: OrientedPortalSegment, wideningMeters: number): LineCone;
   export function clipLineConeByPortal(cone: LineCone, portal: OrientedPortalSegment, wideningMeters: number): LineCone;
   export function lineConeMeasure(cone: LineCone): number;          // meters (m·rad)
   export const staticLineConeInsideTolerance = 1e-12;
   export const staticLineConeMinMeasureMeters = 1e-9;
   ```

4. **Tolerances.** Decided:
   - Widening: `wideningMeters = options.toleranceMeters` (callers pass `1e-6`). Each segment is lengthened at both ends
     along itself before its constraint vectors are formed: `u = (left - right) / |left - right|`,
     `left' = left + δu`, `right' = right - δu`. This only enlarges `K`.
   - Inside test: a ray `r` is inside `h` when `h · r >= -1e-12 · |h|` (rays are unit). This only enlarges `K`.
   - Rejection: a word is rejected when its cone is empty **or** `lineConeMeasure(cone) < 1e-9` m. Why the measure
     floor: "touching" words (all lines must run along a cell edge, e.g. cube `0 3 1`, see Part B step 6) have a cone of
     measure zero that survives the tolerances as a numerical sliver; their descendants would survive too and inflate
     the tables. A set of lines of measure below 1e-9 m is invisible from every eye position except a cell corner,
     which lies inside a forbidden zone. Genuine thin views are many orders larger (a 1 px crack at depth 10 is about
     1e-6 m).
   - `toleranceMeters < 0` still throws (unchanged validation).
5. **Depth 1 and depth 2.** Decided: depth-1 words are never rejected and carry no cone (their constraint set is a
   wedge, not a pointed cone). A depth-2 cone is built by brute-force vertex enumeration (`lineConeForTwoPortals`,
   pseudocode below); depth >= 3 clips the parent's cone. Why: four half-spaces in R^3 are cheap to enumerate; this
   avoids the special cases of shared endpoints (adjacent sides of one cell share a vertex, which makes two constraint
   planes equal or opposite).
6. **Reject reasons.** Decided: `StaticPortalPathRejectReason = "no-static-line-transversal" | "static-path-budget"`.
   `"outside-ancestor-portal-plane"` and `"outside-ancestor-vertical-range"` are removed with the aperture test.
7. **Unequal cell heights** (issue 41). Decided: out of scope. The cull ignores heights and keeps the path (the plan
   test is a necessary condition, so this is conservative). The old vertical-range rejection is dropped. Record this in
   `_docs/MATHEMATICAL_MODEL.md` Section 11. Why: no example world has unequal heights (every cell uses the builder
   default of 15 m, `src/authoring/worldBuilder.ts:23`).
8. **Budget.** Decided (Part C): `buildStaticallyCulledPortalPathTables` expands best-first from a max-heap keyed on
   `(mu desc, insertion sequence asc)`. Ids are still assigned to every candidate when it is created (sparse ids, as
   today). When a candidate is popped while `kept.length >= maxKeptPathsPerRoot`, that candidate and every entry still
   in the heap are rejected as `"static-path-budget"` (one record each), and the root is finished. Children are cone-
   tested when pushed, so a budget rejection always means "feasible but cut". Parents are always popped before their
   children (`mu` never increases), so `paths` still lists parents first, but it is **no longer ordered by depth**.
   `staticallyCullPortalPathTables` (test-only) keeps its table-order budget. Why: issue 56 evidence (direction bias).
9. **Progress callback.** Decided (Part C): `onDepthComplete` and `StaticPortalPathDepthStatus` are replaced by

   ```ts
   readonly onRootComplete?: (status: StaticPortalPathRootStatus) => void;
   export interface StaticPortalPathRootStatus {
     readonly rootCellId: string;
     readonly keptPathCount: number;                  // including the root path
     readonly rejectedPathCount: number;
     readonly keptPathCountByDepth: readonly number[]; // index = depth
     readonly budgetExhausted: boolean;
   }
   ```

   `portalDebugRuntime.ts` logs one line per root from it. Why: best-first has no depth levels.
10. **Option cleanup.** Decided: delete `debugTauSigmaDisagreements` (no caller outside the file). Keep
    `toleranceMeters` (now the widening, Decision 4), `maxKeptPathsPerRoot`, `keepRejectedPathDetails`. Rejection
    `details` strings: `"Rejected path <id>; no oriented line crosses its portals in order."` and the existing budget
    and inherited-rejection texts.
11. **Comparison with the old cull.** Decided: in Part B the old builder survives temporarily as
    `buildStaticallyCulledPortalPathTablesLegacy` (the current body, renamed, marked `@deprecated` "removed in Part C")
    so a temporary comparison test can run both. Part C deletes it and the comparison test, after you have copied the
    comparison table into the report.
12. **Benchmark.** Decided: a skipped-by-default timing test `tests/cell-complex/staticCullBenchmark.test.ts`
    (`describe.skipIf(!process.env.STATIC_CULL_BENCH)`), kept in the repo. It times
    `buildStaticallyCulledPortalPathTables(world, { maxDepth: 10, skipImmediateReverse: true, toleranceMeters: 1e-6,
    maxKeptPathsPerRoot: 50_000 })` (the app's `portalPathOptions`) for `cube`, `icosahedron`, `torusModuli`,
    `genus2Torus`, `dodecahedron` (3 runs each, report the median in ms and the kept count per root) with
    `performance.now()` and prints a table with `console.info`. Run it in PowerShell with
    `$env:STATIC_CULL_BENCH='1'; npx vitest run tests/cell-complex/staticCullBenchmark.test.ts; Remove-Item Env:STATIC_CULL_BENCH`.
    Acceptance: after Part C each world's median is at most 1.1 × its baseline median.

## Algorithms (pseudocode)

```text
developPortalSegment(world, sourceCellId, sideIndex, rootFromSource):
  cell = world.cellsById.get(sourceCellId); side = cell.sides[sideIndex]          // throw if missing
  portal = cell.portalBySideIndex.get(sideIndex); target = world.cellsById.get(portal.targetCellId)
  r = transformPoint3(rootFromSource, vec3(side.start.x, side.start.y, 0))
  l = transformPoint3(rootFromSource, vec3(side.end.x,   side.end.y,   0))
  top = target ? min(cell.heightMeters, target.heightMeters) : cell.heightMeters
  return { left: {x: l.x, y: l.y}, right: {x: r.x, y: r.y}, apertureTopMeters: top }

portalConstraintVectors(portal, δ):
  u = normalize(left - right)                    // segments have length >= 0.05 m in valid worlds
  L = left + δu ; R = right - δu
  return [ vec3(L.x, L.y, 1), vec3(-R.x, -R.y, -1) ]

inside(h, r) := dot(h, r) >= -1e-12 * |h|

lineConeForTwoPortals(p1, p2, δ):
  hs = [...portalConstraintVectors(p1, δ), ...portalConstraintVectors(p2, δ)]      // 4 vectors
  candidates = []
  for i < j in 0..3:
    c = cross(hs[i], hs[j]); if |c| < 1e-15 * |hs[i]| * |hs[j]|: continue           // equal/opposite planes
    for s in (+1, -1):
      r = s * c / |c|
      if every h in hs: inside(h, r): candidates.push(r)
  rays = dedupe(candidates, |r - r'| < 1e-9)
  return sortCyclic(rays)

sortCyclic(rays):                                 // rays of a pointed cone, any order
  if rays.length <= 2: return rays
  m = normalize(sum(rays)); pick u = normalize(any vector ⟂ m), v = cross(m, u)
  return rays sorted by atan2(dot(r, v), dot(r, u))

clipByVector(rays, h):                            // one half-space h·l >= 0
  n = rays.length; if n == 0: return []
  val[i] = dot(h, rays[i]); in[i] = val[i] >= -1e-12 * |h|
  if n == 1: return in[0] ? rays : []
  if n == 2:                                      // a segment, not a polygon
    if in[0] and in[1]: return rays
    if !in[0] and !in[1]: return []
    return [ the inside ray, normalize(|val0| * rays[1] + |val1| * rays[0]) ]
  out = []
  for i in 0..n-1:
    j = (i + 1) % n
    if in[i]: out.push(rays[i])
    if in[i] != in[j]: out.push(normalize(|val[i]| * rays[j] + |val[j]| * rays[i]))
  return dedupeConsecutive(out, 1e-12)            // also compare last with first

clipLineConeByPortal(cone, portal, δ):
  [hL, hR] = portalConstraintVectors(portal, δ)
  return clipByVector(clipByVector(cone, hL), hR)

lineConeMeasure(cone):
  if cone.length < 3: return 0
  sum = 0
  for i in 0..n-1:  a = cone[i]; b = cone[(i+1) % n]
    ta = atan2(a.y, a.x); tb = atan2(b.y, b.x)
    if |sin(tb - ta)| < 1e-12: continue
    q = cross(a, b); if |q.z| < 1e-15 * |q|: continue
    P = (q.x / q.z, q.y / q.z)
    sum += P.x * (sin tb - sin ta) - P.y * (cos tb - cos ta)
  return |sum|

testChild(parentCone | undefined, parentPath, child):     // returns { cone, measure } or "rejected"
  portal = child.newestPortalInRoot
  if child.depth == 1: return { cone: undefined, measure: 2 * |portal.left - portal.right| }
  cone = child.depth == 2
    ? lineConeForTwoPortals(parentPath.newestPortalInRoot, portal, δ)
    : clipLineConeByPortal(parentCone, portal, δ)
  m = lineConeMeasure(cone)
  if cone.length == 0 or m < 1e-9: return "rejected"   // reason "no-static-line-transversal"
  return { cone, measure: m }
```

Cones live only in a build-local `Map<pathId, LineCone>` (or on the heap entry) and are dropped after the build; they
are **not** stored on `PortalRenderPath` (memory, worker message size).

## Steps

Run `npx vitest run <file>` after each step and `npm run typecheck` after each Part.

### Part A: oriented portals, the cone module, unit tests (commit 1)

1. Create `tests/cell-complex/staticCullBenchmark.test.ts` (Decision 12). Run it once on the unchanged code and write
   the baseline table into your notes (it goes into the report under `### Checks`).
2. Create `src/cell-complex/orientedPortal.ts` (Decision 2) with module header and JSDoc on every export.
3. Create `src/cell-complex/staticLineCone.ts` (Decision 3, pseudocode above).
4. Create `tests/cell-complex/staticLineCone.test.ts`. Hand-computed cases (all lengths in meters):
   - `developPortalSegment` on the `twoRoomsWithPortal`-style square room (copy the spec from
     `tests/render-contract/visiblePortalPaths.test.ts`, `twoRoomsWithPortal`): side 1 of `room-a` (x = 1, from (1,-1)
     to (1,1)) with identity transform gives `right = (1,-1)`, `left = (1,1)`, `apertureTopMeters = 3`; and
     `cross(-inwardNormal, left - mid) > 0`.
   - Crossed strings: `p1 = { left: (-1,0), right: (1,0) }`, `p2 = { left: (-1,2), right: (1,2) }` (this is "leaving
     upward": facing +y, left is -x; use `apertureTopMeters: 3`, widening 0). `lineConeForTwoPortals` returns 4 rays;
     `lineConeMeasure` is `4·sqrt(2) - 4 = 1.6568542...` (to 1e-9). The four rays are, up to positive scale,
     `(-1,0,-1)` (line x = -1 upward), `(-1,0,1)` (x = 1 upward), `(-1,1,-1)` (L1 -> R2) and `(-1,-1,1)` (R1 -> L2).
   - Shared endpoint (adjacent sides of one square): the unit square entered through its bottom side upward
     (`p1 = { left: (0,0), right: (1,0) }`) and left through its right side (`p2 = { left: (1,1), right: (1,0) }`).
     The cone has 3 rays (lines y = 0 directed +x, x = 1 directed +y, and the diagonal (0,0) -> (1,1)) and measure
     `2 - sqrt(2) = 0.5857864...` (crossed strings: `|L1R2| + |R1L2| - |L1L2| - |R1R2| = 1 + 1 - sqrt(2) - 0`).
   - Impossible word: `p1` as in the crossed-strings case, `p2 = { left: (1,-2), right: (-1,-2) }` (crossed downward:
     facing -y, left is +x). A line cannot cross y = 0 upward and then y = -2 downward; only the zero vector satisfies
     the four constraints, also after widening. Expect an empty cone.
   - Clipping that keeps: clip the crossed-strings cone by `p3 = { left: (-1,4), right: (1,4) }`. Every line through the
     first and third segments passes the middle one, so the result equals the depth-2 cone of `p1, p3`: measure
     `4·sqrt(5) - 8 = 0.9442719...`.
   - Clipping that empties: clip the crossed-strings cone by `p3 = { left: (3.5,4), right: (5,4) }`. Lines through both
     first segments reach y = 4 at x in [-3, 3], so expect an empty cone (or measure < 1e-9).
   - Random check (seeded `mulberry32`, Part B step 3; write a local copy in Part A if you prefer): 200 random third
     portals above y = 2, crossed upward, so `left` has the smaller x: `left = (x0, y3)`, `right = (x0 + w, y3)` with
     `x0 ∈ [-4, 2]`, `w ∈ [0.2, 3]`, `y3 ∈ [2.5, 6]`. Skip samples whose clipped cone is empty. For each: `measure(child) <= measure(parent) + 1e-12`, and the clipped rays equal a brute-force vertex
     enumeration over all 6 constraint vectors (the `lineConeForTwoPortals` loop generalised to any number of vectors,
     written in the test file) up to cyclic order and 1e-9.
   - Numeric oracle for `lineConeMeasure`: for 50 random 3-portal cones, compare with a midpoint-rule integral of
     `max(0, min_i(L_i·u(θ)) - max_j(R_j·u(θ)))` over θ in [0, 2π) with 20 000 samples, where `L_i`, `R_j` run over the
     widened left and right endpoints and `u(θ) = (cos θ, sin θ)`; agree to 1e-4 relative.
5. Run `npx vitest run tests/cell-complex/staticLineCone.test.ts`, `npm run typecheck`, `npm run docs:check` (run
   `npm run docs:generate` if stale). Commit: "Job 20 Part A: oriented portals and the static line cone".

### Part B: switch both culls to the cone; property test; comparison (commit 2)

1. `portalPaths.ts`: add `newestPortalInRoot` to `PortalRenderPath` (Decision 2) and fill it in
   `buildPortalPathTableForRoot` with `developPortalSegment(world, sourceCell.id, portal.sideIndex,
   parent.rootFromDestination)`.
2. `staticPortalPathCull.ts`:
   - Rename the current `buildStaticallyCulledPortalPathTables` to `buildStaticallyCulledPortalPathTablesLegacy`
     (Decision 11); it keeps calling `rejectGeometrically` and `rejectByTauSigmaTransversal`.
   - Write a new `buildStaticallyCulledPortalPathTables` with the **same BFS loop and budget as today** (budget changes
     in Part C), creating children with `newestPortalInRoot` and testing them with `testChild` (pseudocode). Keep the
     parent cones in a `Map<number, LineCone>`; drop the map at the end of each root. `onDepthComplete` still works
     (it is replaced in Part C).
   - Replace the tests in `staticallyCullPortalPathTables` (`rejectGeometrically(...) ?? rejectByTauSigmaTransversal(...)`)
     by `testChild` with a `Map<pathId, LineCone>` filled in table order. For table paths without
     `newestPortalInRoot` (hand-built fixtures), compute it with `developPortalSegment` from the parent's
     `rootFromDestination`.
   - Add `"no-static-line-transversal"` details text (Decision 10). Keep the 4-member reason type until Part C.
3. Create `tests/support/portalWordWitness.ts` (helpers shared with job 21):
   - `mulberry32(seed: number): () => number` (seeded PRNG in [0,1)).
   - `wordSignature(steps: readonly { sourceCellId: string; sourcePortalId: string }[]): string` →
     `"cellA:portal1/cellB:portal2"` (same as `pathSignature` in `staticPortalPathCull.test.ts`).
   - `walkedWordPrefixes(world, rootCellId, start: Vec2xy, direction: Vec2xy, maxCrossings): string[]`: runs
     `walkDevelopedSegment({ world, cellId: rootCellId, start, direction, lengthMeters: 1000, maxCrossings })` and
     returns the signature of every prefix of `result.crossings` (crossing `c` contributes `${c.sourceCellId}:${c.portalId}`).
   - `sampleLineInCone(cone, rng)`: `l = normalize(sum_i w_i · cone[i])` with `w_i = 0.05 + rng()`.
   - `lineStartThroughPortal(l, first: OrientedPortalSegment)`: `d = (l.y, -l.x) / |(l.x, l.y)|`;
     `t = (l · R_h) / (l · R_h - l · L_h)` with `R_h = (right, 1)`, `L_h = (left, 1)`; `X = right + t (left - right)`;
     return `{ start: X - 1e-4 · d, direction: d }`.
4. Create the property test `tests/cell-complex/staticPortalPathCull.property.test.ts` (fast-check, as in job 11):
   - Add to `tests/support/arbitraries.ts` an arbitrary `arbConeFanWorldSpec`: `n ∈ [3, 8]` triangles around a common
     apex `O = (0,0)`, apex angles `α_i ∈ [0.3, 2.0]` rad, spoke radii `r_i ∈ [3, 12]` m, `θ_0 = 0`,
     `θ_{i+1} = θ_i + α_i`. Cell `fan-i` has base vertices `O`, `P_i = r_i (cos θ_i, sin θ_i)`,
     `P_{i+1} = r_{(i+1) mod n} (cos θ_{i+1}, sin θ_{i+1})` (counterclockwise), height 3, a portal `"out"` on side 2
     (from `P_{i+1}` to `O`) targeting `fan-(i+1 mod n)` portal `"in"`, and a portal `"in"` on side 0 (from `O` to
     `P_i`) targeting `fan-(i-1 mod n)` portal `"out"`. Side 1 is a wall. Glued sides have equal length by
     construction. The total angle `Σα_i` ranges over about [0.9, 16] rad, so cone points with angle sum below and
     above 2π both occur. Add a test in `tests/support/arbitraries.test.ts` that 50 samples compile with
     `compileCellComplex`.
   - Property 1 (example worlds): for each world in `exampleWorldSpecs`, build the culled tables once
     (`maxDepth: 6`, `toleranceMeters: 1e-6`, no budget) and the set of kept signatures per root. Then
     `fc.assert` with 200 runs: a random root cell, a start point `arbPointInCell(cell)`, a direction angle in
     [-π, π]; every prefix from `walkedWordPrefixes(..., maxCrossings: 6)` must be a kept signature for that root.
   - Property 2 (cone fans): 100 runs of `arbConeFanWorldSpec` × a random root/start/direction, same assertion
     (build the cull inside the property; fans are small).
   - Property 3 (soundness of kept cones): for 50 random kept paths of depth 3-6 per example world, sample 20 lines with
     `sampleLineInCone` (rebuild the path's cone by clipping along its ancestors with the exported functions) and
     check that at least one reproduces the path's word with `lineStartThroughPortal` + `walkedWordPrefixes`.
5. Create the temporary comparison test `tests/cell-complex/staticCullComparison.test.ts`: for each world in
   `exampleWorldSpecs`, build legacy and new tables (`maxDepth: 6`, `toleranceMeters: 1e-6`, no budget) and compare
   kept signature sets per root:
   - `newOnly` (kept by new, rejected by legacy = fixed false rejections): each must have a witness (Property 3 method);
     the test fails otherwise.
   - `oldOnly` (kept by legacy, rejected by new): for the first 50 per world, try 2000 random lines through the first
     portal (random point on it, random forward direction, seeded) and assert none reproduces the word.
   - `console.info` one row per world: legacy kept, new kept, `newOnly`, `oldOnly`. Copy this table into the report.
6. Update `tests/cell-complex/staticPortalPathCull.test.ts` (list every change under `### Deviations`):
   - "rejects impossible bounds against ancestor portal apertures and counts the reason": **delete**; the aperture
     reason no longer exists and depth-1 words are never rejected.
   - "rejects cube paths that only touch an ancestor portal plane from behind": keep `0 3` and `0 3 2` as kept; `0 3 1`
     must still be rejected, now with `rejectionReason: "no-static-line-transversal"`. (Check: in the developed root
     frame of `front`, `0` crosses y = -7.5 southward and `1` crosses y = -7.5 northward; only the line y = -7.5 itself
     satisfies both, measure 0.)
   - "drops descendants of rejected paths so no kept path has a rejected parent": replace the hand-broken transform by
     a structural check on cube `maxDepth: 4`: every kept path's parent is kept; every candidate whose parent was
     rejected is rejected with the parent's reason and `details` containing `"parent path"`; and at least one such
     inherited rejection exists (`0 3 1` has children).
   - "can apply static culling while expanding the path tree": compare **sorted** signature arrays (order differs after
     Part C).
   - "prunes the dodecahedron path tree contextually at depth 10": keep every assertion. If `keptPathCount <= 12_000`
     fails, record the new count in the report and raise the bound to the new count rounded up to the next 1000
     (it is a regression guard, not a correctness claim).
   - `tests/cell-complex/portalPathDebug.test.ts`: fix only what the reason rename forces; list it.
7. Run `npx vitest run tests/cell-complex`, `npm run typecheck`, `npm test`. Commit: "Job 20 Part B: exact static
   cull by oriented line cones".

### Part C: delete the old code; best-first budget; docs (commit 3)

1. Copy the comparison table (Part B step 5) into the report. Delete `tests/cell-complex/staticCullComparison.test.ts`
   and `buildStaticallyCulledPortalPathTablesLegacy`.
2. Delete from `staticPortalPathCull.ts` (names; start lines at `0b468e1`): `rejectGeometrically` (:446),
   `rejectByTauSigmaTransversal` (:514), `portalSegmentsInRoot` (:558), `tauSigmaLineTransversalMayExist` (:589),
   `createTauSigmaDisagreementStats` (:624), `logTauSigmaDisagreement` (:633), `cloneSegmentForDebug` (:672),
   `logTauSigmaDisagreementSummary` (:679), `projectiveTauSigmaLineTransversalMayExist` (:696),
   `filterDomainsByProjectedWitness` (:772), `polygonCentroid` (:792), `projectedRayIntersectsWindow` (:814),
   `valuesMayHaveOppositeSigns` (:837), `affineIntervalLineTransversalMayExist` (:845),
   `affineBoxMayContainRayThroughWindow` (:878), `affineOrientationInterval` (:915),
   `movingRayEndpointOrientationInterval` (:932), `intervalsHaveSameStrictSign` (:951), `splitTauSigmaBox` (:965),
   `tauSigmaBoxDiameter` (:987), `clipDomainsByOppositeSigns` (:994), `clipDomainsBySameSigns` (:1029),
   `clipDomainsToWindowChart` (:1064), `parameterCoordinateLine` (:1097), `projectSegmentsToParallelRootLeaf` (:1117),
   `projectParallelSegmentsToAffineFrame` (:1148), `projectParallelPoint` (:1172),
   `projectIntersectingSegmentsToParallelFrame` (:1191), `intersectingBasisCoordinates` (:1248),
   `crossesProjectiveInfinity` (:1266), `projectIntersectingCoordinates` (:1276), `areaTolerance` (:1292),
   `tauSigmaLineForPoint` (:1300), `parameterLineForPointOnSegment` (:1315), `unitTauSigmaSquare` (:1341),
   `pruneTauSigmaDomains` (:1353), `polygonArea` (:1378), `polygonKey` (:1393), `clipConvexPolygonByHalfPlane` (:1406),
   `intersectTauSigmaEdge` (:1445), `dedupePolygonVertices` (:1457), `negateHalfPlane`, `evaluateHalfPlane`, `add2`,
   `sub2`, `scale2`, `dot2`, `length2`, `cross2`, `interpolate2`, `orient2` (:1478-1526),
   `rejectAgainstPortalAperture` (:1532), `prismBoundVertices` (:1575), `createGeometricRejection` (:1585); the types
   `Vec2`, `Segment2`, `TauSigmaBox`, `HalfPlane2`, `ProjectiveTauSigmaResult`, `TauSigmaDisagreementStats`; the option
   `debugTauSigmaDisagreements`; the imports that become unused (`forbiddenPortalJunctionRadiusMeters`,
   `CompiledPrismSide`, `vec3`/`Vec3` if unused). Remove both `TODO(issue 56)` comments. About 1 000 lines go.
3. Reduce `StaticPortalPathRejectReason` (Decision 6) and fix what `npm run typecheck` reports.
4. Best-first budget in `buildStaticallyCulledPortalPathTables` (Decision 8) with a small private binary max-heap in the
   same file:

   ```text
   heap = [ { path: root, cone: undefined, measure: +Infinity, seq: 0 } ]; kept = []
   while heap not empty:
     entry = heap.popMax()                         // by measure desc, then seq asc
     if kept.length >= budget:
       reject entry.path and every remaining entry as "static-path-budget"; budgetExhausted = true; break
     kept.push(entry.path)
     if entry.path.depth == maxDepth: continue
     for portal of world.cellsById.get(entry.path.destinationCellId).portals:
       if skipImmediateReverse and isImmediateReverse(entry.path, portal): continue
       child = createChild(entry.path, portal, nextPathId++)      // with newestPortalInRoot
       r = testChild(entry.cone, entry.path, child)
       if r is "rejected": record "no-static-line-transversal"; continue
       heap.push({ path: child, cone: r.cone, measure: r.measure, seq: nextSeq++ })
   ```

   Replace `onDepthComplete` by `onRootComplete` (Decision 9) and update `portalDebugRuntime.ts` (one `console.info`
   line per root: root, kept, rejected, `keptByDepth=<comma list>`, `budgetExhausted`).
5. Update tests in `tests/cell-complex/staticPortalPathCull.test.ts` (list under `### Deviations`):
   - "spends contextual path budget breadth-first" → rename "spends the path budget best-first by line measure": cube,
     `maxDepth: 4`, budget 5: depths `[0, 1, 1, 1, 1]` (the four depth-1 words have measure 2 · 15 = 30, more than any
     depth-2 word) and `rejectedByReason.get("static-path-budget")` is **12** (each of the 4 kept depth-1 paths pushed 3
     feasible depth-2 children; every depth-2 word is feasible in a convex cell).
   - "reports contextual path progress at the end of each depth" → "reports per-root progress": cube, `maxDepth: 2`,
     root `front`: one call with `keptPathCountByDepth` equal to `[1, 4, 12]`, `budgetExhausted: false`.
6. Run the benchmark (Decision 12) and compare with the Part A baseline. If a world is more than 10% slower, profile
   (`clipByVector` allocations are the likely cause: reuse arrays) and record the result either way.
7. Docs: rewrite `_docs/MATHEMATICAL_MODEL.md` Section 4 lines 133-154 (the cull: oriented constraints, cone, measure,
   best-first budget, the 1e-9 m floor and why) and the Section 11 "Culling soundness" bullet (line 473: the cull is now
   exact in plan view; unequal heights are ignored, Decision 7). Update `_docs/ARCHITECTURE.md:44` if its wording no
   longer fits. Update the module header of `staticPortalPathCull.ts` (it describes the three old families).
8. Run the full checks (below). Commit: "Job 20 Part C: delete the tau/sigma cull; best-first path budget".

## Tests and checks

After each Part: `npm run typecheck`, `npm test`, `npm run docs:check` (run `npm run docs:generate` if stale). After
Part C also `npm run build` and `npm run smoke -- --world cube,icosahedron,torus-moduli,genus-2-torus`. A single smoke
failure right after a checkout or build is a known flake (batch report 11-17/36): rerun once before investigating.

Manual check (record if not run): `npm run dev`, in `cube` and `genus-2-torus` walk to a corner and look along the
walls; deep views must not lose pieces compared with the previous build.

## Do not

- Do not change `computeVisiblePortalPaths` or anything per-frame (job 21).
- Do not store cones on `PortalRenderPath` or post them from the worker.
- Do not change `buildPortalPathTables`' order or ids (only add `newestPortalInRoot`).
- Do not weaken tests beyond the changes listed in Part B step 6 and Part C step 5; record each under `### Deviations`.
- Do not implement unequal heights (Decision 7).

## Done when

- `StaticPortalPathRejectReason` is `"no-static-line-transversal" | "static-path-budget"` and none of the deleted
  functions exist (`git grep -n "tauSigma\|rejectGeometrically\|rejectAgainstPortalAperture" src` is empty).
- The property tests (example worlds and cone fans) and `staticLineCone.test.ts` pass.
- The report contains the old-vs-new comparison table with every fixed false rejection counted per world.
- The depth-10 benchmark is within 1.1 × the baseline for every world, or the report explains why not.
- Issue 56 is moved to `_issues/_closed/` with an Outcome (exact cone cull, best-first budget, unequal heights out of
  scope) and Closing evidence (commit hashes, test names, comparison table). The queue row in `.agents/jobs/README.md`
  is struck through and the job moves to `_done/` with its report (see README).
