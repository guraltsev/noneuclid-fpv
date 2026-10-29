# Job 12 - Shared segment-walk kernel and developed-disk atlas

Status: in progress.
Revised on 2026-10-29 for a less capable implementing model (design prototyped and checked on every example world).
Resolves: the kernel part of issue [62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md) and the
"local atlas" part of issue [63](../../_issues/63_collision_ignores_cells_a_straddling_body_overlaps.md). It closes no
issue by itself; jobs 13, 15, 16 and 17 move the callers onto it and close the issues.

## Goal

Add two pure modules in `src/cell-complex` and nothing else:

1. `segmentWalk.ts`: walk a straight segment, given in the frame of its start cell, through the glued convex cells. It
   reports every cell piece with its exact parameter window `[tEnter, tExit]`, the portals crossed, and the composed
   transform of each cell. A segment that passes exactly through a vertex follows one documented rule.
2. `developedDisk.ts`: list every cell copy that a disk of radius ρ around a point overlaps, with the developing
   transform of each copy and the angular wedge (seen from the centre) that belongs to that copy.

No existing caller changes in this job. This is theme 1 of [issue 50](../../_issues/50_deep_code_audit_2026_10_09_index.md).

## Depends on

[Job 11](11_property_tests_for_geometry_core.md) (for `tests/support/arbitraries.ts`).

## Before you start

| File | What to look at |
| --- | --- |
| `src/cell-complex/prismCells.ts` | `CompiledPrismSide` (:55-65), `CompiledPrismCell` (:42-49): `sides[i]` runs from vertex i to i+1, `inwardNormal` is unit and points into the cell |
| `src/cell-complex/specs.ts` | `CompiledPortal` (:62-75): `transformToTarget`, `targetCellId`, `reciprocalPortalId` |
| `src/cell-complex/compileCellComplex.ts` | `CompiledCellComplex.cellsById` |
| `src/math/rigidTransform3.ts` | `composeRigidTransform3(a, b)` = a after b; `invertRigidTransform3`; `transformPoint3`; `transformDirection3` |
| `src/math/polygons.ts` | `Vec2xy` (use it for 2-D points) |
| `src/math/tolerances.ts` | where the new constants go |
| `src/movement/collision.ts` | `signedDistanceToSide` (:276-278); do **not** import it (layer rule: `cell-complex` may import only `math`); write a private copy |
| `src/world-objects/geodesicCannon.ts` | `traceGeodesicSegment` (:1287-1412): the single-cell tracer this kernel generalizes |
| `scripts/docs/lib.mjs` | `layers` (:23-51) |

Baseline: `npm run typecheck` and `npm test` (expected on 2026-10-29: 706 passed, 8 skipped, plus job 11's tests).

## Background

### Frames and the developed segment

Every cell has its own frame (x east, y north, z up, meters). A portal transform `g` maps source-cell coordinates to
target-cell coordinates and is a rotation about +z plus a horizontal translation. A straight segment that leaves cell
C₀ and enters C₁, C₂, … is one straight line in the **developed frame** of C₀: the point at parameter t is
`P(t) = A + t·d` (A in C₀'s frame, d a unit horizontal vector, t in meters). Its piece in cell Cₖ is
`Mₖ(P(t))` for t in `[tEnterₖ, tExitₖ]`, where `Mₖ = gₖ ∘ … ∘ g₁` maps C₀'s frame to Cₖ's frame. This is exact up to
rounding: no nudge past a portal is needed, and lengths add up exactly to the requested length.

### Exit side of a convex cell

A convex cell is the intersection of the half-planes `dᵢ(q) = (q − startᵢ)·nᵢ ≥ 0`. Along `Aₖ + t·dₖ`
(`Aₖ = Mₖ(A)`, `dₖ = Rₖ d`), side i is **outgoing** when `dₖ·nᵢ < 0`, and the line crosses its supporting line at
`tᵢ = dᵢ(Aₖ) / (−dₖ·nᵢ)`. The exit is the outgoing side with the smallest `tᵢ`. No "does the hit lie within the side
segment" test is needed: for a convex polygon the first half-plane the line leaves is always crossed on its segment.
The entry side is excluded by **side index**.

### The vertex rule (decided, see Decision 3)

When two adjacent sides tie (`|tᵢ − tⱼ| ≤ 1e-9` m) the line passes through their shared vertex. The kernel then
exits through **the side that starts at that vertex** (the counterclockwise successor). This is the same as
displacing the line by an infinitesimal amount to its left, which is one global rule, so it is consistent in every cell
and every gluing. Example: in the square [-1,1]², a ray from (0,0) toward (1,1) ties the east side (index 1, ends at
(1,1)) and the north side (index 2, starts at (1,1)); the rule picks the north side. In the next cell the walk then
sits exactly at a vertex; it may leave that cell again at once through the other side at that vertex, which gives a
**zero-length piece** (`tEnter === tExit`). That is correct. Checked: the issue-62 cube walk from the centre of `front`
toward (7.5, −7.5) gives `front [0, 10.6066] → right [10.6066, 10.6066] → bottom [10.6066, 19.997]`, and the end
point is 6.64 m inside `bottom`.

### The developed disk

For a centre c (inside cell C₀) and radius ρ, the straight rays of length ρ from c reach a set of cell copies. Each copy
is reached by the rays in one **wedge** (an angular interval seen from c). Starting from C₀ with the full circle, a
portal side of a copy spawns a child copy when (1) c is strictly on the inner side of that side's line (the side faces
away from c), (2) the side's developed segment, clipped to the current wedge, comes closer to c than ρ. The child's
wedge is the current wedge intersected with the wedge spanned by the side's developed segment. Because each point of
the plane is reached by exactly one ray from c, the copies **tile** the disk: every point of the disk lies in exactly
one copy (inside its developed polygon and inside its wedge). Checked on cube, icosahedron, torus-moduli,
dodecahedron, genus-2 torus and tetrahedron with c at 0.3, 0.27 and 0.1 m from a vertex and ρ = 0.25 m: every
sample point was covered exactly once, including when the disk contains the vertex, and no case needed more than 7
copies.

## Decisions

1. **Where.** Decided: two new modules, `src/cell-complex/segmentWalk.ts` and `src/cell-complex/developedDisk.ts`,
   importing only `src/math/*` and `src/cell-complex/*` types. Why: `cell-complex` may import only `math`, and every
   caller (movement, world-objects, render) may import `cell-complex`. Alternative: `src/math`; rejected because the
   kernel needs `CompiledCellComplex`.
2. **No `Iso2` type.** Decided: use `RigidTransform3` and `Vec2xy` as they are. Why: issue 55 shows composition cost is
   not a problem at this scale, and a new transform type would touch every caller; [job 30](30_deformation_rebuild_pipeline.md)
   owns `Iso2`. Record this in issue 55 (step 6).
3. **Vertex tie rule.** Decided: the counterclockwise-successor rule above, with tie tolerance
   `segmentWalkVertexTieMeters = 1e-9`. The piece records `throughVertexIndex` (the index of the shared vertex in the
   exited cell) when a tie decided the exit. Why: deterministic, one global rule, and callers that must treat a vertex
   pass as an obstacle (geodesics, job 15) can detect it. Alternative: report "hit a vertex" and stop; rejected because
   bodies that ignore forbidden zones (creatures, tool points) must keep moving.
4. **Start outside the cell.** Decided: if `min_i dᵢ(start) < −1e-6` (`cellContainmentToleranceMeters`), return
   status `"start-outside"` with no pieces. A start within 1e-6 outside is accepted; exit parameters below `tEnter`
   are clamped up to `tEnter`, so such a start leaves at once through the violated side if the direction is outgoing.
   Why: callers own recovery; a silent guess is what issue 62 is about.
5. **Crossing limit.** Decided: `maxCrossings` defaults to 64; when it is reached the status is `"crossing-limit"` and
   the pieces so far are returned. Why: guards against loops; 200 m on the 15 m torus needs 14-30 crossings, the
   geodesic tests need up to about 220 (they pass their own limit).
6. **Outgoing threshold.** Decided: a side is outgoing when `dₖ·nᵢ < −1e-12` (dimensionless, both unit vectors).
   Sides parallel to the ray are never exits.
7. **Transforms are composed, not re-projected.** Decided: `cellFromStart` of the next cell is
   `composeRigidTransform3(portal.transformToTarget, cellFromStart)`. Measured: after 217 torus crossings the lifted
   end point differs from the developed one by 0. Re-projection of rotations is [job 14](14_movement_numerics.md).
8. **Atlas centre on a side.** Decided: before building the atlas, if the centre is within 1e-7 m of any side of its
   cell, move it 1e-7 m inward along the sum of those sides' inward normals (normalized) and add 1e-7 m to ρ. Why: rule
   (1) of the disk needs c strictly inside; otherwise a body centred exactly on a portal would miss the neighbour.
9. **Atlas limit.** Decided: `maxNodes` defaults to 64; the result has `truncated: true` if the limit stopped the
   search. Why: a 0.5 m disk needs at most about 7; long moves (30 m in a test) need more and pass a larger limit.
10. **Movement is not migrated here.** Decided: unlike the first version of this job, no caller changes. Why: migrating
    the movement exit guess "behind the existing API" would be thrown away by job 13 one job later.

## Steps

### Step 1: constants

Append to `src/math/tolerances.ts` (each with a JSDoc comment stating the unit):

```ts
/** Two side crossings closer than this (meters along the walk) are a pass through their shared vertex. */
export const segmentWalkVertexTieMeters = 1e-9;
/** A walk start or atlas centre may lie this far (meters) outside its cell and still count as inside. */
export const cellContainmentToleranceMeters = 1e-6;
/** A side is crossed outward when dot(direction, inwardNormal) is below minus this (dimensionless). */
export const segmentWalkOutgoingDotTolerance = 1e-12;
```

### Step 2: `src/cell-complex/segmentWalk.ts`

Start the file with a module header comment (copy the style of `src/cell-complex/compileCellComplex.ts`) that explains
the developed frame, the exit rule and the vertex rule from the Background. Every export needs a JSDoc comment.

Types:

```ts
/** One portal crossing during a walk, in walk order. */
export interface SegmentWalkCrossing {
  readonly sourceCellId: string;
  readonly portalId: string;        // portal id in the source cell
  readonly sourceSideIndex: number;
  readonly targetCellId: string;
  readonly targetPortalId: string;
  readonly targetSideIndex: number;
  readonly transformToTarget: RigidTransform3;
  readonly tMeters: number;         // walk parameter of the crossing
}

export type SegmentWalkExit =
  | { readonly kind: "end" }
  | { readonly kind: "portal"; readonly sideIndex: number; readonly portal: CompiledPortal; readonly throughVertexIndex?: number }
  | { readonly kind: "wall"; readonly sideIndex: number; readonly throughVertexIndex?: number };

export interface SegmentWalkPiece {
  readonly cellId: string;
  readonly cellFromStart: RigidTransform3;   // start-cell frame -> this cell's frame
  readonly tEnter: number;                    // meters, 0 for the first piece
  readonly tExit: number;                     // meters, >= tEnter
  readonly entrySideIndex?: number;           // undefined for the first piece unless the request gave one
  readonly exit: SegmentWalkExit;
}

export type SegmentWalkStatus = "end" | "wall" | "crossing-limit" | "start-outside" | "missing-cell";

export interface SegmentWalkResult {
  readonly status: SegmentWalkStatus;
  readonly pieces: readonly SegmentWalkPiece[];
  readonly crossings: readonly SegmentWalkCrossing[];
}

export interface SegmentWalkRequest {
  readonly world: CompiledCellComplex;
  readonly cellId: string;
  readonly start: Vec2xy;              // in cellId's frame
  readonly direction: Vec2xy;          // normalized by the function; must not be zero
  readonly lengthMeters: number;       // >= 0
  readonly entrySideIndex?: number;    // side of the start cell to ignore (the walk just came through it)
  readonly maxCrossings?: number;      // default 64
}

export function walkDevelopedSegment(request: SegmentWalkRequest): SegmentWalkResult;
```

Algorithm (this is the prototype that was checked; translate it, keep the variable meaning):

```ts
const sd = (side, p) => (p.x - side.start.x) * side.inwardNormal.x + (p.y - side.start.y) * side.inwardNormal.y;

let cell = world.cellsById.get(cellId);            // missing -> { status: "missing-cell", pieces: [], crossings: [] }
const dir = normalize(request.direction);          // throw Error if its length <= 1e-12
if (min over sides of sd(side, start) < -cellContainmentToleranceMeters) return start-outside;
let M = identityRigidTransform3; let entry = request.entrySideIndex; let tEnter = 0;
for (let k = 0; k <= maxCrossings; k += 1) {
  const Ak = transformPoint3(M, vec3(start.x, start.y, 0));
  const dk = transformDirection3(M, vec3(dir.x, dir.y, 0));
  let best: { side; t } | undefined;
  for (const side of cell.sides) {
    if (side.sideIndex === entry) continue;
    const dn = dk.x * side.inwardNormal.x + dk.y * side.inwardNormal.y;
    if (dn >= -segmentWalkOutgoingDotTolerance) continue;
    const t = sd(side, Ak) / -dn;
    if (!best || t < best.t - segmentWalkVertexTieMeters) { best = { side, t }; tiedVertex = undefined; }
    else if (Math.abs(t - best.t) <= segmentWalkVertexTieMeters) {
      const n = cell.sides.length;
      if ((best.side.sideIndex + 1) % n === side.sideIndex) { tiedVertex = side.sideIndex; best = { side, t }; }
      else if ((side.sideIndex + 1) % n === best.side.sideIndex) { tiedVertex = best.side.sideIndex; }
    }
  }
  const tExit = best ? Math.max(best.t, tEnter) : Infinity;
  if (tExit >= lengthMeters) { push piece (tEnter, lengthMeters, exit end); return status "end"; }
  if (!best.side.portal) { push piece (exit wall, throughVertexIndex: tiedVertex); return status "wall"; }
  push piece (exit portal, throughVertexIndex: tiedVertex); push crossing (tMeters: tExit);
  M = composeRigidTransform3(best.side.portal.transformToTarget, M);
  cell = world.cellsById.get(best.side.portal.targetCellId);   // missing -> status "missing-cell"
  entry = cell.portalsById.get(best.side.portal.reciprocalPortalId)!.sideIndex;
  tEnter = tExit;
}
return status "crossing-limit";
```

Notes for the translation:

- `throughVertexIndex` is the index of the vertex shared by the two tied sides, which is the start index of the
  successor side (side j starts at vertex j). Reset the tie marker whenever a strictly smaller `t` is found.
- `lengthMeters === 0` gives one piece `[0, 0]` with exit `end` and no crossings, even if the start is within 1e-6
  outside a side. A walk of length zero never crosses. Job 14 relies on this.
- If the side order of the cell wraps (side n−1 and side 0 share vertex 0), the `% n` handles it.

Also export a convenience wrapper:

```ts
/** Finds the cell and frame of `to`, reached by the straight segment from `from` (both in cellId's frame). */
export function locateDevelopedPoint(
  world: CompiledCellComplex, cellId: string, from: Vec2xy, to: Vec2xy, maxCrossings?: number,
): { readonly status: SegmentWalkStatus; readonly cellId: string; readonly cellFromStart: RigidTransform3;
     readonly crossings: readonly SegmentWalkCrossing[] };
```

If `|to − from| ≤ 1e-12` it returns `{ status: "end", cellId, cellFromStart: identity, crossings: [] }` without
walking. Otherwise it walks from `from` toward `to` with length `|to − from|` and returns the last piece's cell and
transform (for status `"wall"`, the cell where the wall was hit). Jobs 13 (released cannons), 16 (aim origin) and 17
(eye roots) use it.

### Step 3: `src/cell-complex/developedDisk.ts`

```ts
/** Directions seen from the disk centre. "full" is the whole circle; "cone" runs counterclockwise from `from` to `to`
 *  (cross(from, to) > 0, opening < π). */
export type DevelopedWedge =
  | { readonly kind: "full" }
  | { readonly kind: "cone"; readonly from: Vec2xy; readonly to: Vec2xy };

export interface DevelopedDiskNode {
  readonly cellId: string;
  readonly cellFromStart: RigidTransform3;
  readonly startFromCell: RigidTransform3;
  readonly wedge: DevelopedWedge;
  readonly depth: number;               // portal hops from the start cell
  readonly entrySideIndex?: number;
}

export interface DevelopedDiskRequest {
  readonly world: CompiledCellComplex;
  readonly cellId: string;
  readonly center: Vec2xy;               // in cellId's frame
  readonly radiusMeters: number;
  readonly maxNodes?: number;            // default 64
}

export function collectDevelopedDisk(request: DevelopedDiskRequest):
  { readonly center: Vec2xy; readonly radiusMeters: number; readonly nodes: readonly DevelopedDiskNode[]; readonly truncated: boolean };
export function wedgeContainsDirection(wedge: DevelopedWedge, direction: Vec2xy): boolean;
export function intersectWedges(a: DevelopedWedge, b: DevelopedWedge): DevelopedWedge | undefined;
export function clipSegmentToWedge(wedge: DevelopedWedge, center: Vec2xy, a: Vec2xy, b: Vec2xy): readonly [Vec2xy, Vec2xy] | undefined;
export function distanceToWedge(wedge: DevelopedWedge, center: Vec2xy, point: Vec2xy): number;  // 0 inside
export function distancePointToSegment2(point: Vec2xy, a: Vec2xy, b: Vec2xy): number;
```

`center` and `radiusMeters` in the result are the values after Decision 8's nudge; callers must use them.

Algorithm (checked prototype; `cross(a, b) = a.x·b.y − a.y·b.x`):

```ts
wedgeContainsDirection(w, p) = w.kind === "full" || (cross(w.from, p) >= -1e-12 && cross(p, w.to) >= -1e-12)

intersectWedges(w1, w2):
  if w1 full return w2; if w2 full return w1;
  from = contains(w2, w1.from) ? w1.from : contains(w1, w2.from) ? w2.from : undefined
  to   = contains(w2, w1.to)   ? w1.to   : contains(w1, w2.to)   ? w2.to   : undefined
  if (!from || !to || cross(from, to) <= 1e-12) return undefined
  return { kind: "cone", from, to }

clipSegmentToWedge(w, c, S, E):     // keep the part of S + u (E - S), u in [0, 1], inside the wedge
  if full return [S, E]
  u0 = 0, u1 = 1, D = E - S
  for each constraint f0 + u * f1 >= 0 with
      (f0, f1) = (cross(w.from, S - c), cross(w.from, D))  and  (cross(S - c, w.to), cross(D, w.to)):
    if |f1| < 1e-15: if f0 < 0 return undefined; continue
    u = -f0 / f1; if f1 > 0 u0 = max(u0, u) else u1 = min(u1, u)
  if u0 > u1 return undefined
  return [S + u0 D, S + u1 D]

distanceToWedge(w, c, p): 0 if full or wedgeContainsDirection(w, p - c); else the smaller of the distances from p to
  the two boundary rays (ray from c along w.from, ray from c along w.to; clamp the ray parameter at 0).

collectDevelopedDisk:
  apply Decision 8 to the centre; nodes = [{ start cell, identity, identity, full wedge, depth 0 }]
  for (q = 0; q < nodes.length; q += 1):
    node = nodes[q]; ck = transformPoint3(node.cellFromStart, c)
    for each side of node's cell with a portal:
      if sd(side, ck) <= 1e-12 continue                       // faces c (includes the entry side)
      S, E = side.start, side.end mapped by node.startFromCell (developed, in the start frame)
      clipped = clipSegmentToWedge(node.wedge, c, S, E); if (!clipped) continue
      if distancePointToSegment2(c, clipped[0], clipped[1]) >= ρ continue
      wedge = intersectWedges(node.wedge, { kind: "cone", from: S - c, to: E - c }); if (!wedge) continue
      if nodes.length >= maxNodes { truncated = true; continue }
      push { target cell, cellFromStart: compose(portal.transformToTarget, node.cellFromStart),
             startFromCell: invert(that), wedge, depth: node.depth + 1, entrySideIndex: reciprocal side index }
```

Seen from a centre on the inner side, a side's `start → end` is counterclockwise, so `{ from: S − c, to: E − c }` is
a valid cone.

### Step 4: tests

Create `tests/cell-complex/segmentWalk.test.ts` (examples) and `tests/cell-complex/segmentWalk.property.test.ts`:

1. Square room [-1,1]² with 4 walls: a walk from (0,0) along (1,0) for 5 m ends with status `wall`, one piece
   `[0, 1]`, exit side 1.
2. `twoRoomsWithPortal` (copy the helper from `tests/movement/moveDynamicObject.test.ts`): from (0.5, 0) along (1,0)
   for 1 m gives pieces `room-a [0, 0.5]` and `room-b [0.5, 1]`, one crossing, and the end point in `room-b` is
   (−0.5, 0).
3. Vertex rule: in a single square room whose four sides are portals to four neighbour squares (build the spec), the
   walk from (0,0) along (1,1)/√2 for 2 m crosses the **north** side first (side index 2); `throughVertexIndex` is 2.
4. Cube vertex (issue 62): `cube`, cell `front`, from (0,0) toward (7.5, −7.5), length 20 m: status `end`, three
   pieces, the middle one has zero length, and the end point is inside the last cell (all `sd ≥ −1e-9`).
5. Length zero: a start 1e-9 m outside a portal side, length 0, gives status `end` and no crossings.
6. Start outside: a start 0.01 m outside gives `start-outside`.
7. Property, every example world (`exampleWorldSpecs` from job 11), 300 segments per world: random start
   (`arbPointInCell`), random direction, length in [1, 80]; every fifth segment aimed exactly at a vertex of its start
   cell. For every piece, the points at `tEnter`, the midpoint and `tExit`, mapped by `cellFromStart`, lie inside the
   piece's cell (`sd ≥ −1e-8`). Status is always `end` (no walls in example worlds). (Prototype result: worst
   −2.5e-13, at most 11 pieces.)
8. Property (torus-moduli): a walk of 200 × 15.2 m at a shallow angle (about 217 crossings, pass
   `maxCrossings: 1000`); map the end point back through the inverse transforms of the crossings in reverse order; it
   equals `start + L·d` within 1e-8 m.
9. Property against brute force (issue 62 verification): on `cube`, `icosahedron` and `torusModuli`, for random
   segments of length ≤ 3 m, sample 200 equally spaced t in the walk; at each sample, the piece whose
   `[tEnter, tExit]` contains t maps the developed point into a point inside that piece's cell. (Same check as 7, at
   finer resolution.)

Create `tests/cell-complex/developedDisk.test.ts`:

1. Tiling (issue 63 acceptance, in sampled form): for `cube`, `icosahedron`, `torusModuli`, `dodecahedron`,
   `genus2Torus`, `tetrahedron`, for the first 3 cells, for each base vertex v: put c on the line from v to the cell's
   vertex average at distance 0.3, 0.27 and 0.1 m from v, with ρ = 0.25. For 400 sample points p in the disk
   (`r = ρ·√frac(i·0.618034)`, angle `i·2.399963`), count the nodes with `wedgeContainsDirection(node.wedge, p − c)` and
   `p` mapped by `cellFromStart` inside the node's cell (`sd ≥ −1e-9`). The count is exactly 1 for every sample.
   Assert `nodes.length ≤ 8` in this setup.
2. A centre exactly on the midpoint of a portal side of `twoRoomsWithPortal`, ρ = 0.25: the result has 2 nodes
   (Decision 8).
3. `intersectWedges`, `clipSegmentToWedge` and `distanceToWedge` each get two or three hand-checked examples (contained
   cone, partial overlap, disjoint).

## Tests and checks

- `npx vitest run tests/cell-complex/segmentWalk.test.ts tests/cell-complex/segmentWalk.property.test.ts tests/cell-complex/developedDisk.test.ts`
- `npm run typecheck`, `npm test`, `npm run docs:check` (run `npm run docs:generate` after adding the modules; the
  generated architecture reference lists modules).

### Step 5: documentation

- `_docs/MATHEMATICAL_MODEL.md` §4 (developing map): add a paragraph "Segment walk" that states the exit rule and the
  vertex rule, with links `src/cell-complex/segmentWalk.ts#walkDevelopedSegment` and
  `src/cell-complex/developedDisk.ts#collectDevelopedDisk`.
- §10 (tolerances): list the three new constants.

### Step 6: bookkeeping

- Issue 55: add one dated line under its status: "Job 12 (2026-…): the segment-walk kernel uses `RigidTransform3`; no
  `Iso2` was introduced (job 30 owns it)."
- Issues 62 and 63: add one dated line each: "Kernel landed in job 12 (`segmentWalk.ts`, `developedDisk.ts`); callers
  move in job 13."

## Do not

- Do not change any existing module except `src/math/tolerances.ts` and the docs named above.
- Do not import from `src/movement` (layer rule). Write the private `sd` helper.
- Do not add zone, wall-capsule or body logic here; that is job 13.

## Done when

- Both modules exist with the exported names above, header comments and JSDoc.
- All tests of step 4 pass; `npm test` and `npm run docs:check` pass.
- Issues 55, 62 and 63 carry the status lines of step 6.
