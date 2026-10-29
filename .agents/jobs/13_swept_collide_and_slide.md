# Job 13 - Swept collide-and-slide on the segment-walk kernel

Status: in progress.
Revised on 2026-10-29 for a less capable implementing model.
Resolves: issue [61](../../_issues/61_wall_response_lets_bodies_escape_through_corners.md), issue
[62](../../_issues/62_segment_based_portal_traversal_and_swept_motion.md), issue
[63](../../_issues/63_collision_ignores_cells_a_straddling_body_overlaps.md) (except the ghost item, which is
[job 17](17_multi_hop_ghosts_and_eye_rerooting.md)).

## Goal

Rewrite `moveDynamicObject` so that a body:

- slides along walls and stops cleanly in corners (issue 61);
- follows its real path through any number of portals in one call and is never lost past a vertex (issue 62);
- collides with walls, forbidden zones and other bodies that lie in **neighbouring** cells while it straddles a portal
  (issue 63).

The method: build the developed disk around the body (job 12), collect every obstacle in it **in the start cell's
frame**, slide the body's centre through those obstacles in that one flat frame, then walk the resulting path through
the cells with the segment-walk kernel to find the final cell and pose.

The job has three parts. Commit after each part, with all checks green.

- **Part A**: the new mover (walls, zones, floor and ceiling, any number of crossings).
- **Part B**: runtime bodies as obstacles across portals; the player and the creatures use it.
- **Part C**: callers that assumed at most one crossing per move.

## Depends on

[Job 12](12_segment_walk_kernel.md) (`walkDevelopedSegment`, `locateDevelopedPoint`, `collectDevelopedDisk`) and
[job 11](11_property_tests_for_geometry_core.md).

## Before you start

Line numbers are from commit `0d86165`.

| File | Lines | What to look at |
| --- | --- | --- |
| `src/movement/moveDynamicObject.ts` | all (291) | the function being replaced; keep its exported types |
| `src/movement/collision.ts` | 82-185, 202-227, 276-278 | `testCellCollision`, bounds helpers, `moveIncreasesCylinderOverlap`, `signedDistanceToSide` |
| `src/movement/movePlayer.ts` | all (181) | `movePlayer`, `resolvePlayerMoveAgainstBodies` |
| `src/movement/depenetrateDynamicObject.ts` | all | job 09's recovery; unchanged here except the creature option (step C5) |
| `src/cell-complex/segmentWalk.ts`, `src/cell-complex/developedDisk.ts` | all | job 12 |
| `src/render/three/createThreeApp.ts` | 1310-1360, 2298-2315, 3351-3375, 1418-1430, 1060-1068, 883-884 | the two `movePlayer` calls, `recordCellTransition`, `blockPlayerMoveAgainstRuntimeObjects`, creature updates, transition getters |
| `src/render/three/geodesicCannonTools.ts` | 125-135, 558-625, 924-1010 | deps, carry start/finish, `normalizeReleasedCarriedGeodesicCannon`, `updateCarriedGeodesicPortalWord` |
| `src/render/three/geodesicCarryPortalTransition.ts` | all (64) | |
| `src/render/three/xrPlayerRig.ts` | 196-212 | `acceptPhysicalMove` uses `blocked` and `appliedDisplacement` |
| `src/world-objects/simpleGeoCreature.ts` | 217-252, 360-378 | creature `update`, `creatureIntersectsObstacle` |
| `src/world-objects/geodesicMarmot.ts` | 140-160 | marmot `update` |
| `src/world-objects/geodesicCannon.ts` | 3740-3790 | curve-shortening free-end move and its single-crossing word update |
| `tests/movement/moveDynamicObject.test.ts` | all (513) | the helpers `singleRoom`, `twoRoomsWithPortal`, `selfWrappingRoom`, `dynamicObject` |
| `tests/movement/movePlayer.test.ts` | 188-275 | applied displacement and runtime-body tests |
| `_docs/MATHEMATICAL_MODEL.md` | 156-194 | §5 Motion of bodies (rewrite in step A8) |

Baseline: `npm run typecheck`, `npm test`.

## Background

### What is wrong today

- `findMostProbablePortalExit` (`moveDynamicObject.ts:207-255`) looks only at the end point. Past a vertex it returns
  nothing and the body is accepted outside its cell (issue 62: in `cube`, a creature walking from the centre of
  `front` toward (7.5, −7.5) with zones ignored ends at (14.14, −14.14), 6.6 m outside).
- One crossing per call; the test "teleports an out-of-domain endpoint through only one most probable portal per frame"
  (`moveDynamicObject.test.ts:147`) encodes that.
- Wall response pushes out of the first wall only; in a corner it now refuses the whole step (issue 61: stops 0.03 m
  short of (0.75, 0.75)). A push that lands across a portal is accepted outside the cell (issue 61: δ = (3, 6) in a
  room with a north portal returns (0.749999, 6)).
- Collision looks only at the body's own cell (issue 63).
- The per-frame `dt` is already capped at 0.1 s (commit `98a99af`, `maxSimulationStepSeconds`), so a single step is at
  most a few tenths of a meter for the player and creatures.

### Body geometry

A body is an upright cylinder: horizontal centre `c = anchor + (R·offset)ₓᵧ`, radius r, half height hh, vertical centre
`z_c = anchor.z + (R·offset)_z`. The player's offset is (0, 0, h/2), so its horizontal centre is its anchor. Creatures
have a **horizontal** offset (the mouse along body +y, the butterfly in x and y; `simpleGeoCreature.ts:505-540`), so
anchor and centre differ. A body without `collision` is a point (r = 0, hh = 0, c = anchor).

During a translation the rotation does not change, so the anchor and the centre move by the same displacement. In the
start cell's developed frame the anchor path is the centre path shifted by `−o` (o = horizontal offset). **Collision is
decided for the centre; the cell is decided by the anchor** (the existing "anchor" crossing rule).

### Swept tests (developed start frame, centre path p(s) = p + s·v, s ∈ [0, 1])

- **Disc** (centre q, radius R = r + r_obstacle). Let w = p − q, a = v·v, b = 2 v·w, c₀ = w·w − R².
  - If c₀ < 0 (already overlapping): if b < 0 (moving closer) it is a hit at s = 0 with normal `w/|w|` (if
    |w| < 1e-12 use `−v/|v|`); otherwise no hit (the body may leave an overlap).
  - Else if b ≥ 0: no hit. Else disc = b² − 4ac₀; if disc < 0 no hit; s = (−b − √disc)/(2a); a hit if s ≤ 1, with
    normal `(p + s v − q)/R`.
- **Capsule** (wall segment [A, B], radius R = r). Let e = B − A, L = |e|, û = e/L, n = (−û.y, û.x). Let h₀ = (p − A)·n;
  if h₀ < 0 set n = −n and h₀ = −h₀. Let vn = v·n and u(s) = (p + s v − A)·û.
  - Slab: if h₀ < R (already inside the slab): a hit at s = 0 with normal n if vn < 0 and u(0) ∈ [0, L]. Otherwise,
    if vn < 0: s = (h₀ − R)/(−vn); a hit if 0 ≤ s ≤ 1 and u(s) ∈ [0, L], normal n.
  - Caps: the disc test above with q = A and q = B, radius R.
  - The capsule hit is the smallest s of the three.
- A hit is "approaching" by construction (b < 0 or vn < 0). Only approaching hits count.

### Slide loop (centre, developed start frame)

```text
pos = c; v = δ_h; contacts = []; legs = [c]
for iteration in 0..3:
  if |v| <= 1e-12: break
  hit = smallest-s hit over all obstacles (ties: any)
  if no hit: pos = pos + v; legs.push(pos); v = 0; break
  sAdvance = max(0, hit.s - collisionSkinMeters / |v|)
  if sAdvance > 0: pos = pos + sAdvance·v; legs.push(pos)
  rem = (1 - sAdvance)·v
  rem = rem - (rem·hit.normal)·hit.normal          // keep the tangential part
  for each earlier contact n': if rem·n' < -1e-12: rem = 0     // crease: two walls meeting
  contacts.push(hit); v = rem
// after 4 iterations any remaining v is dropped (blocked)
```

Worked example (issue 61, four walls of [-1,1]², r = 0.25, 200 steps of (0.03, 0.03)): each step slides along the
first wall touched; at the corner the second contact's normal makes `rem·n' < 0`, so the body stops at
(0.75 − 1e-6, 0.75 − 1e-6). Worked example (issue 61, north portal, δ = (3, 6) from the origin): the path passes the
end cap (1, 1) at 0.447 m, enters the developed north neighbour, hits the neighbour's east wall at (0.75, 1.5), slides
north, and stops at its north wall. The final pose is inside the neighbour, not 4 m beyond it.

## Decisions

1. **One flat frame.** Decided: collect obstacles from `collectDevelopedDisk` around the body's centre with
   reach `ρ = r + |δ_h| + 2·collisionSkinMeters` and slide in the start cell's frame; then walk the anchor polyline with
   `walkDevelopedSegment`. Why: the disk is the straight-ray chart from the centre, which job 12 showed tiles the disk
   exactly once in every world, even around cone points. Alternative: the per-cell loop of issue 62's pseudocode
   (re-collect obstacles after each crossing); rejected as more code with the same result for steps below 0.5 m.
2. **Iteration cap.** Decided: 4 slide iterations (issue 61's number); crossings are unlimited up to the kernel's
   `maxCrossings` (64). The 8 of issue 62's pseudocode counted crossings and contacts together.
3. **Skin.** Decided: add `collisionSkinMeters = 1e-6` to `src/math/tolerances.ts` in this job and use it everywhere
   the literal `1e-6` was the wall skin (`moveDynamicObject.ts:273`). Job 14 then only audits the other literals.
4. **Which obstacles.**
   - Walls: every non-portal side of every node within ρ of the centre (`distancePointToSegment2`) **and** with
     `distanceToWedge(node.wedge, c, nearest point) ≤ r` (use: `clipSegmentToWedge` is not empty, or either endpoint
     has `distanceToWedge < r`). Capsule radius r.
   - Too-low portals: a portal side of any node whose **target** cell height is below the body's top
     (`z_c + hh` after the vertical step) becomes a wall with reason `"ceiling"`. This replaces today's "refuse the
     crossing on a target ceiling".
   - Zones (unless `ignoreForbiddenZones`): the developed position of each `singularityColumns` centre of every node,
     included if its distance to c is below ρ + r_zone and (it is inside the node's wedge or
     `distanceToWedge < r + r_zone`). Deduplicate by position rounded to 1e-6 m. Disc radius r + r_zone.
   - Bodies (Part B): each body of each node's cell, developed to the start frame, included if within ρ + r_body and
     (`distanceToWedge < r + r_body`), and only if its vertical interval overlaps the moving body's
     (`|z_c − z_o| < hh + hh_o`). Deduplicate by object id plus rounded position. Disc radius r + r_body.
5. **Vertical motion.** Decided: clamp δ_z so that `z_c − hh ≥ 0` and `z_c + hh ≤ h_start` after the move (if the body
   already violates a bound, it may move away from it but not further in: clamp to `[min(0, −bottom), max(0, h − top)]`
   with bottom = z_c − hh, top = z_c + hh). A clamp marks the move blocked with reason `"floor"` or `"ceiling"` and still
   applies the horizontal part. Why: matches issue 62 ("floor and ceiling are 1-D: clamp z and clip v_z"), and the
   existing tests only check the reason.
6. **Anchor outside its cell.** Decided: if the anchor is more than `cellContainmentToleranceMeters` outside its cell
   (`walkDevelopedSegment` would return `start-outside`), first re-home it with `locateDevelopedPoint` from the cell's
   vertex average to the anchor, apply those crossings to the pose, then continue. Why: such states can only come from
   old saves or external placement; walking from an interior point is the deterministic recovery.
7. **Anchor hits a wall the centre did not** (only possible when the horizontal offset exceeds r). Decided: stop the
   anchor at the wall hit minus `collisionSkinMeters` along that leg, drop the remaining legs, report blocked
   `"wall"`.
8. **Crossing limit or missing cell in the anchor walk.** Decided: return the original object, `blocked: true`,
   `blockingReason: undefined`, and `console.warn` once per call. These do not happen in shipped worlds.
9. **Result shape.** Decided: keep every existing field of `MoveDynamicObjectResult` and add
   `crossings: readonly SegmentWalkCrossing[]` (in order) and `cellFromStart: RigidTransform3` (start-cell frame to
   final-cell frame). `crossedPortal = crossings.length > 0`; `crossedPortalId = crossings[0]?.portalId` (the portal
   **in the start cell**, as documented today). `blocked` is true when any contact happened, the vertical step was
   clamped, or Decision 7/8 applied; it can now be true **and** `crossedPortal` true in one move.
   `appliedDisplacement` is the total anchor displacement in the start frame (z included).
10. **`portalCrossingMode`.** Decided: keep the field and `AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE`, narrow
    `PortalCrossingMode` to `"anchor"`, delete the `"bounds"` throw and its test ("throws for the unimplemented bounds
    crossing mode"). Why: removing the field would touch five callers for no behaviour change. Record the deleted test
    under `### Deviations`.
11. **Runtime bodies slide instead of revert.** Decided: the player's runtime-object obstacles and the creatures'
    player obstacle become discs in the same slide (Part B). `resolvePlayerMoveAgainstBodies`,
    `blockPlayerMoveAgainstRuntimeObjects`, `creatureIntersectsObstacle` and `moveIncreasesCylinderOverlap` are deleted.
    Why: the swept disc test already lets a body leave an overlap and never deepen it (the job 08 rule), works across
    portals, and slides instead of stopping. The job 08 tests are ported, not dropped.
12. **Creatures keep ignoring zones.** Decided: `simpleGeoCreature` keeps `ignoreForbiddenZones: true`. Why: issue 63
    worried that a disk containing a cone point is not flat; job 12 showed the atlas is still exact (one straight-ray
    chart), and turning zones on would make creatures stick to zones head-on (they have no turn-away logic, unlike
    marmots). [Job 36](36_creatures_detour_and_resume_geodesic.md) later turns zones on for creatures with a
    leader-following detour; do not anticipate it here.
13. **Several crossings in one frame (Part C).** Decided: replace the single "latest player portal transition" with an
    append-only log of transitions with serial numbers; the cannon carry folds **every** unseen transition, in order.
    Why: this was already broken when the XR stick move and the physical move each cross in one frame; multi-crossing
    moves make it more likely.

## Steps

### Part A: the mover

**A1. Constant.** Add to `src/math/tolerances.ts`:

```ts
/** Clearance, meters, kept between a body and an obstacle after a collision response. */
export const collisionSkinMeters = 1e-6;
```

**A2. Swept primitives.** Create `src/movement/sweptCollision.ts` (header comment; JSDoc on exports):

```ts
export type SweptObstacleReason = "wall" | "ceiling" | "forbidden-zone" | "body";
export type SweptObstacle =
  | { readonly kind: "capsule"; readonly a: Vec2xy; readonly b: Vec2xy; readonly radius: number; readonly reason: SweptObstacleReason }
  | { readonly kind: "disc"; readonly center: Vec2xy; readonly radius: number; readonly reason: SweptObstacleReason; readonly objectId?: string };
export interface SweptHit { readonly s: number; readonly normal: Vec2xy; readonly obstacle: SweptObstacle }
export function sweepDiscAgainstObstacle(p: Vec2xy, v: Vec2xy, obstacle: SweptObstacle): SweptHit | undefined;
export interface SlideResult {
  readonly end: Vec2xy;
  readonly legs: readonly Vec2xy[];      // polyline of the centre, legs[0] = start; consecutive points differ
  readonly contacts: readonly SweptHit[];
}
export function slideDisc(start: Vec2xy, displacement: Vec2xy, obstacles: readonly SweptObstacle[], maxIterations?: number): SlideResult;
```

Implement the formulas of Background "Swept tests" and "Slide loop" exactly. `obstacle.radius` already includes the
moving body's radius (the collector adds it).

Tests `tests/movement/sweptCollision.test.ts`:

- disc: head-on hit at the right s; tangent miss; start overlapping and moving away gives no hit; start overlapping and
  moving closer gives s = 0.
- capsule: slab hit; end-cap hit; a path passing beyond the segment end misses the slab.
- slide: the four-corner repro of issue 61 run **inside the slide only** (4 capsules of [-1,1]², radius 0.25, 200
  calls of (±0.03, ±0.03) feeding `end` back as `start`) ends within 1e-5 of (±0.75, ±0.75) in all four corners.
- slide: diagonal (0.1, 0.3) into one wall keeps the full tangential component (matches
  "still slides along a single wall when moving diagonally into it").
- property (job 11 arbitraries): random convex wall-only polygons (`arbConvexPolygon2xy`, radius ≥ 2 m; use
  `fc.pre` to skip polygons whose vertex average is closer than 0.3 m to a side), r = 0.25,
  start at the vertex average, 2 000 random steps with |δ| ≤ 0.5: after every step, the distance from `end` to every
  wall line is ≥ r − 1e-9 (issue 61 acceptance, with 2 000 instead of 10⁴ steps for speed; record this).

**A3. Obstacle collection.** Create `src/movement/developedObstacles.ts`:

```ts
export interface DevelopedObstacleRequest {
  readonly world: CompiledCellComplex;
  readonly cellId: string;
  readonly center: Vec2xy;                 // body centre in cellId's frame
  readonly reachMeters: number;            // ρ of Decision 1
  readonly bodyRadius: number;
  readonly bodyBottomZ: number;            // after the vertical step
  readonly bodyTopZ: number;
  readonly ignoreForbiddenZones?: boolean;
  readonly bodiesInCell?: (cellId: string) => readonly DynamicObjectState[];   // Part B
  readonly ignoredObjectIds?: ReadonlySet<string>;                              // Part B
}
export function collectDevelopedObstacles(request: DevelopedObstacleRequest): readonly SweptObstacle[];
```

Use `collectDevelopedDisk({ world, cellId, center, radiusMeters: reachMeters, maxNodes: 256 })` and the rules of
Decision 4. Map cell-local points to the start frame with `node.startFromCell`. In Part A ignore `bodiesInCell`.

Tests `tests/movement/developedObstacles.test.ts`:

- `singleRoom`: 4 wall capsules near a corner, fewer near the centre with a small reach.
- `twoRoomsWithPortal` with the body 0.1 m before the east portal: the neighbour's walls appear, shifted by (+2, 0).
- A spec where room-b is 0.75 m tall and the body's top is 1.0: the east portal side appears as a capsule with reason
  `"ceiling"`.
- Zones: cube, centre 0.5 m from a vertex, reach 0.6: exactly one zone disc for that vertex (dedupe works).

**A4. Rewrite `moveDynamicObject`.** Keep the file and the exported names. New body, in this order:

1. Look up the start cell (throw as today if missing).
2. If the anchor is outside the cell by more than 1e-6, re-home it (Decision 6) and remember those crossings and
   `cellFromStart` as the prefix of the result.
3. bounds = `getDynamicObjectCollisionBounds(object)`; r, hh, z_c, offset o = centre − anchor (horizontal).
   No collision shape: r = 0, hh = 0, o = 0.
4. Vertical: clamp δ_z (Decision 5).
5. If `|δ_h| ≤ 1e-12`: return the translated object (vertical part only), no walk. **A zero horizontal move never
   crosses a portal.**
6. obstacles = `collectDevelopedObstacles(...)` with reach ρ.
7. slide = `slideDisc(c, δ_h, obstacles)`.
8. Walk the anchor legs: for each consecutive pair of `slide.legs` (minus o), call `walkDevelopedSegment` from the
   current cell, starting at the current anchor mapped into that cell's frame, direction = leg direction rotated into
   that cell's frame, length = leg length, **no** `entrySideIndex`. Accumulate `cellFromStart` with
   `composeRigidTransform3(piece.cellFromStart, cellFromStartSoFar)` and collect crossings. Apply Decisions 7 and 8.
9. Final pose: `translation = cellFromStart(anchorEnd with z = anchor.z + δ_z')`, rotation =
   `cellFromStart.rotation · object.rotation` (that is `composeRigidTransform3(cellFromStart, translatedPose)`).
10. Build the result (Decision 9). `blockingReason` = reason of the first contact (`"wall"`, `"ceiling"`,
    `"forbidden-zone"`; `"body"` maps to undefined in Part A, see Part B), else the vertical clamp's reason.

Delete `findMostProbablePortalExit`, `resolveBlockedWallPosition` and `getSignedClearanceToSide`. Keep
`testCellCollision` (used by depenetration and placement).

**A5. Update the movement tests** in `tests/movement/moveDynamicObject.test.ts`. Change only these tests and record
each under `### Deviations`:

- "teleports an out-of-domain endpoint through only one most probable portal per frame" (:147): rewrite as
  "re-homes an out-of-cell anchor before moving": the anchor at (5.1, 0) in `selfWrappingRoom` (2 m wide, east glued to
  west) is re-homed by walking from (0, 0) to (5.1, 0): three crossings east, ending at (−0.9, 0) (check: 5.1 − 3·2).
  Then a second call with zero displacement does **not** cross.
- "throws for the unimplemented bounds crossing mode": delete (Decision 10).
- "refuses to cross when the object would violate the target cell ceiling" (:320): the body now slides against the
  portal as a `"ceiling"` wall. The body (radius 0.1) starts at x = 0.95, already within 0.1 of the portal line and
  moving toward it, so the swept test hits at s = 0 and the body does not advance. Expect `blocked: true`,
  `blockingReason: "ceiling"`, `crossedPortal: false`, `cellId` `room-a` and x = 0.95 within 1e-12. Do not expect
  `result.object` to be the same object any more.
- "falls back to the original pose when pushing out of one wall leaves the body inside another (convex corner)": the
  body now stops in the corner; expect x and y within 1e-5 of 0.9 (radius 0.1 in a 1 m half-width room).
- "lets anchor portal crossing take precedence over swept forbidden-zone collision" (:267): with a swept test the zone
  at (1, 1) (radius 0.15 + 0.1) lies on the path from (0.6, 0.9) to (1.4, 0.9); the move now slides around or stops at
  the zone. Rewrite it to assert the honest outcome you observe **and** that the final anchor is inside its final
  cell; record the old and new expectation.

All other existing tests must pass unchanged. If one does not, find out why before changing it, and record it.

**A6. New mover tests** (`tests/movement/moveDynamicObject.test.ts`, new `describe("swept motion")`):

1. Issue 61 four-corner repro through `moveDynamicObject` (singleRoom is [-1,1]², use radius 0.25): ends within 1e-5
   of (±0.75, ±0.75).
2. Issue 61 north-portal repro: δ = (3, 6) from the origin in a room whose north side is a portal to an identical
   room: the result is in the neighbour, inside it, at x ≈ 0.75 (record the y you get).
3. Issue 62 cube vertex, zones ignored (radius 0.2, 0.05 m steps from the centre of `front` toward (7.5, −7.5), 400
   steps): after every step the anchor is inside its cell (`min sd ≥ −1e-9`).
4. Same with zones on: the body stops at the zone: the final centre is at distance 0.35 ± 1e-5 from the vertex (0.2 +
   0.15).
5. Issue 62 long move: a corridor of 6 rooms glued east-west (build it like `twoRoomsWithPortal`): one call with
   δ = (10, 0.3, 0) from the middle of room 1 gives the same final `(cellId, translation)` as 600 calls of δ/600, within
   1e-6.
6. Property: in `cube`, `icosahedron` and `torusModuli`, random walks of 500 steps (|δ| ≤ 0.3, zones on, radius 0.25,
   start at a cell's vertex average): after every step the anchor is inside its cell (`min sd ≥ −1e-9`) and the centre
   is at least `0.4 − 1e-6` from every zone centre of its cell.

**A7. Keep the other movers working.** Run every test file that calls `moveDynamicObject` or `movePlayer`:
`tests/movement/*`, `tests/world-objects/geodesicMarmot.test.ts`, `tests/world-objects/simpleGeoCreature.test.ts`,
`tests/world-objects/geodesicCannon.test.ts`, `tests/render-contract/geodesicCarryPortalTransition.test.ts`,
`tests/render-contract/vrLocomotion.test.ts`. Marmots still react to `blockingReason === "forbidden-zone"`; with the
slide they now stop **at** the zone surface rather than one step before it, which `turnAwayFromNearestForbiddenZone`
handles. If a geodesic-cannon test fails, read Part C first: it may be a multi-crossing case.

**A8. Docs.** Rewrite `_docs/MATHEMATICAL_MODEL.md` §5 items 1-4 to describe: developed obstacles, the swept disc and
capsule tests, the slide with crease rule, the anchor walk with the vertex rule, and vertical clamping. Remove the
§11 bullet "Wall overlap at crossings" (it no longer applies) and say so in the issue 62 closing evidence.

Commit Part A.

### Part B: bodies across portals (issue 63)

**B1.** `MoveDynamicObjectRequest` gains `bodiesInCell?: (cellId: string) => readonly DynamicObjectState[]` and
`ignoredObjectIds?: ReadonlySet<string>`. `collectDevelopedObstacles` turns them into discs (Decision 4). Map
`"body"` contacts to `blockingReason: undefined` with `blocked: true` (today's player-vs-object revert reports no
reason either; check `movePlayer.test.ts` "lets a player inside a runtime body step away but not further in").

**B2.** `movePlayer`: `MoveRequest` gains `bodiesInCell?` and passes it through; `MoveResult` gains `crossings` and
`cellFromStart` (copy from the dynamic result). Delete `resolvePlayerMoveAgainstBodies`. Port its two tests in
`tests/movement/movePlayer.test.ts` ("reports the applied part of a wall slide" stays as is; "lets a player inside a
runtime body step away but not further in" now passes the body through `bodiesInCell`; expected outcome: stepping
away moves, stepping further in does not move closer).

**B3.** `createThreeApp.ts`: pass
`bodiesInCell: (cellId) => runtimeObjectRegistry.getPlayerBlockingObjectsInCell(cellId).map(runtimeObjectToDynamicObjectState)`
to both `movePlayer` calls; delete `blockPlayerMoveAgainstRuntimeObjects` and its two call sites (use the `movePlayer`
results directly). Delete `moveIncreasesCylinderOverlap` from `collision.ts` and its test in `collision.test.ts`
(record it).

**B4.** `simpleGeoCreature.ts` `update`: pass `bodiesInCell: (cellId) => obstacles.filter((o) => o.cellId === cellId)`
and replace `state = creatureIntersectsObstacle(result.object, obstacles) ? state : result.object;` with
`state = result.object;`. Delete `creatureIntersectsObstacle`.

**B5. Tests** (issue 63 acceptance):

1. Player 0.1 m before the east portal of `twoRoomsWithPortal`, a body (r = 0.25, same height) 0.1 m beyond it in
   `room-b`: moving the player east by 0.05 is blocked (the centres stay at least 0.5 − 1e-6 apart, measured in the
   developed frame); the same with the roles of the cells swapped.
2. A wall of the neighbour meets the shared portal at 30°. room-a is the square [-1,1]² with its east side (index 1)
   a portal; room-b is the triangle A = (0, −1), B = (2/√3, −1), C = (0, 1) (counterclockwise; side 2 runs C → A, has
   length 2 and is the portal glued to room-a's side 1; the angle at C between C→A and C→B is atan((2/√3)/2) = 30°).
   Developed into room-a, room-b's wall B → C runs from (1 + 2/√3, −1) to (1, 1). A body of radius 0.1 with
   `ignoreForbiddenZones: true` starts at (0.95, −0.5) and moves by (0, 0.02) for 100 steps. After every step its
   developed centre is at least 0.1 − 1e-9 from that wall segment, and its cell changes at most once over the run.
3. Developed-disk area acceptance of issue 63 is already covered by job 12's tiling test; reference it in the issue's
   closing evidence.

Commit Part B.

### Part C: callers of multi-crossing moves

**C1. Transition log** (`createThreeApp.ts`). Replace `latestPlayerPortalTransition` /
`latestPlayerPortalTransitionSerial` with:

```ts
// Append-only, newest last; at most 64 entries; serials increase by 1 per crossing and are never reused.
let playerPortalTransitionLog: { readonly serial: number; readonly transition: GeodesicCarryPortalTransition }[] = [];
let latestPlayerPortalTransitionSerial = 0;
function recordPlayerPortalTransitionInLog(transition: GeodesicCarryPortalTransition): void { /* push, bump, trim */ }
```

`recordCellTransition(previousCellId, moveResult)`: for each `moveResult.crossings` entry build
`{ sourceCellId, sourcePortalId: portalId, targetCellId, targetPortalId, transformToTarget }` and record it. For the
diagnostics line use the last crossing's portal id. `resolveGeodesicCarryPortalTransitionFromMove` is no longer used
there; keep the module (tests use it) and add `resolveGeodesicCarryPortalTransitionsFromCrossings(crossings)` that does
the mapping above, with a test.

**C2. Deps** (`geodesicCannonTools.ts`): keep `getLatestPlayerPortalTransition()` (returns the newest log entry's
transition) and `getLatestPlayerPortalTransitionSerial()`; add
`getPlayerPortalTransitionsSince(serial: number): readonly { serial: number; transition: GeodesicCarryPortalTransition }[]`
(entries with a larger serial, oldest first). `recordPlayerPortalTransition` appends to the log.

**C3. Carry start.** In the function that starts a carry (`startGeodesicCannonCarry`, called at :568), include
`carryPortalTransitionSerial: deps.getLatestPlayerPortalTransitionSerial()` in the cannon tool state it sets.

**C4. Fold every unseen transition.** In `updateCarriedGeodesicPortalWord` (:924):

```text
lastApplied = state.carryPortalTransitionSerialByGeodesicId?.[geodesicId] ?? state.carryPortalTransitionSerial ?? latestSerial
pending = deps.getPlayerPortalTransitionsSince(lastApplied)
if (!previousCannon || pending.length === 0) return
chain check: pending[0].transition.sourceCellId === previousCannon.cellId,
             pending[i].transition.targetCellId === pending[i+1].transition.sourceCellId,
             pending.at(-1).transition.targetCellId === cannon.cellId;   otherwise return (as today)
for each pending transition, in order: apply today's logic (interval word via
  updateLockedGeodesicPortalWordForCarriedAnchorTraversal, else the connection branch), feeding the word produced by
  the previous transition into the next one
store the final word(s) and set both serial fields to pending.at(-1).serial
```

Factor today's single-transition body into `applyCarriedPortalTransition(word, transition, ...)` so the loop stays
small. Keep the verbose logging once per call, listing all transitions.

**C5. Released cannon.** `normalizeReleasedCarriedGeodesicCannon` (:594): replace the zero-displacement
`moveDynamicObject` with `locateDevelopedPoint(world, player.cellId, playerPosition_xy, cannonAnchor_xy)` (the cannon is
held in the player's cell frame, possibly outside it). Record **each** returned crossing with
`deps.recordPlayerPortalTransition`, then return the cannon re-homed with
`composeRigidTransform3(result.cellFromStart, cannon.localPose)` in `result.cellId`. A zero move would no longer
re-home it (step A4.5), so this change is required.

**C6. Curve shortening** (`geodesicCannon.ts` around :3774): the free end may now cross more than one portal in one
tick. Replace the single `getPortalTraversalFromSource(..., moveResult.crossedPortalId)` with a loop over
`moveResult.crossings` that applies `portalWordAfterAnchorCrossing` once per crossing, in order. If any step fails the
cell-chain check, leave the words unchanged (today's behaviour for a failed check).

**C7. Depenetration of creatures.** No change (`ignoreForbiddenZones: true` stays, Decision 12).

**C8. Tests.**

- `tests/render-contract/geodesicCarryPortalTransition.test.ts`: add a test for
  `resolveGeodesicCarryPortalTransitionsFromCrossings` with two crossings.
- A unit test for the fold: build the smallest registry the existing carry tests use (search
  `tests/world-objects/geodesicCannon.test.ts` for `updateLockedGeodesicPortalWordForCarriedAnchorTraversal`), apply
  two transitions in one update, and check the word gained both letters in order. If the function is not reachable from
  a test without the Three.js shell, test `applyCarriedPortalTransition` (export it from the tools module with JSDoc)
  twice in a row instead, and record that.
- Curve shortening: an existing curve-shortening test still passes; add one where the free end's single tick crosses
  two portals (torus-moduli corner region is not allowed: zones; use `selfWrappingRoom`-style narrow cells where a
  0.25 m step can cross two sides, or a direct unit test of the loop) and record which you chose.

Commit Part C.

## Tests and checks

After each part: `npm run typecheck`, `npm test`, `npm run docs:check`. Before the final push run the browser smoke
test once (`npm run build` then `npm run smoke -- --world cube,torus-moduli`) and record the output.

Manual check (record as not done if you cannot run a browser): walk into a room corner in `?config=full` with a walled
test world, and walk straight at a cube vertex; the player slides around the zone and never disappears.

## Bookkeeping

Close issues 61, 62 and 63 (move them to `_issues/_closed/` with `Outcome` and `Closing evidence`), except: issue 63's
"Ghosts" paragraph is open work for job 17. Write that in issue 63's outcome and link job 17. Update
`_issues/50_deep_code_audit_2026_10_09_index.md` rows 61-63.

## Do not

- Do not change `depenetrateDynamicObject` beyond what compiles.
- Do not touch geodesic tracing (job 15), aim picking (job 16), ghosts or XR eye roots (job 17).
- Do not add pose re-orthonormalization; that is job 14.
- Do not turn forbidden zones on for creatures.

## Done when

- `moveDynamicObject` contains no end-point exit guess; it uses `collectDevelopedObstacles`, `slideDisc` and
  `walkDevelopedSegment`.
- Every test in A2, A3, A6, B5 and C8 exists and passes; every changed old test is listed under `### Deviations`.
- Issues 61, 62 and 63 are closed or carry a pointer to this job's report.
## Report

### Done
#### Part A
- `src/math/tolerances.ts`: added `collisionSkinMeters = 1e-6`.
- `src/movement/sweptCollision.ts` (new): `sweepDiscAgainstObstacle`, `slideDisc`, the obstacle and hit types.
- `src/movement/developedObstacles.ts` (new): `collectDevelopedObstacles` (walls, ceiling portals, deduplicated zone discs; Part B bodies not included).
- `src/movement/moveDynamicObject.ts` rewritten on `collectDevelopedObstacles`, `slideDisc` and `walkDevelopedSegment`; `findMostProbablePortalExit`, `resolveBlockedWallPosition` and `getSignedClearanceToSide` deleted; `PortalCrossingMode` narrowed to `"anchor"`; the result gained `crossings` and `cellFromStart`.
- Tests: new `tests/movement/sweptCollision.test.ts` (A2, including the 25-run random-polygon property), `tests/movement/developedObstacles.test.ts` (A3), and a `swept motion` describe in `tests/movement/moveDynamicObject.test.ts` (A6 items 1-6).
- `_docs/MATHEMATICAL_MODEL.md` section 5 items 1-4 rewritten (now items 1-5), section 11 bullet "Wall overlap at crossings" removed; generated docs regenerated.
- Parts B and C not started; the runtime-body paragraph of section 5 and the `moveIncreasesCylinderOverlap` code are untouched.
#### Part B
- `src/movement/developedObstacles.ts`: `bodiesInCell` and `ignoredObjectIds` now produce `"body"` discs (radius r + r_body) for every body of every cell of the developed disk, mapped to the start frame, filtered by wedge, vertical overlap and reach, deduplicated by id plus rounded position; new exported type `ObstacleBodyState` (a `DynamicObjectState` with an optional `id`).
- `src/movement/moveDynamicObject.ts`: request gains `bodiesInCell` and `ignoredObjectIds`; a `"body"` contact reports `blocked: true` with `blockingReason` undefined.
- `src/movement/movePlayer.ts`: `MoveRequest.bodiesInCell`; `MoveResult` gains `crossings` and `cellFromStart`; `resolvePlayerMoveAgainstBodies` deleted.
- `src/render/three/createThreeApp.ts`: both `movePlayer` calls pass `bodiesInCell: playerBlockingBodiesInCell`; `blockPlayerMoveAgainstRuntimeObjects` and its two call sites deleted.
- `src/movement/collision.ts`: `moveIncreasesCylinderOverlap` deleted. `src/world-objects/simpleGeoCreature.ts`: `update` passes `bodiesInCell` and takes `result.object`; `creatureIntersectsObstacle` deleted.
- Tests: new `describe("bodies across portals (issue 63)")` in `tests/movement/moveDynamicObject.test.ts` (B5.1 in both directions, a no-deeper-overlap test, an id/height filter test, B5.2 the 30 degree triangle); `tests/render-contract/vrLocomotion.test.ts` literals gained `crossings` and `cellFromStart`.
- `_docs/MATHEMATICAL_MODEL.md` section 5 "Runtime bodies" paragraph rewritten; generated docs regenerated.
#### Part C
- `src/render/three/geodesicCarryPortalTransition.ts`: new `resolveGeodesicCarryPortalTransitionsFromCrossings(crossings)` (one chained transition per crossing). `resolveGeodesicCarryPortalTransitionFromMove` is kept (tests use it) but no longer called by the shell.
- `src/render/three/createThreeApp.ts` (C1): `latestPlayerPortalTransition` / serial replaced by an append-only `playerPortalTransitionLog` (newest last, at most 64, serials +1 per crossing, never reused) with `recordPlayerPortalTransitionInLog`; `recordCellTransition` records every `moveResult.crossings` entry and reports the last crossing's portal id in the diagnostics line. Both debug consumers still get the newest transition.
- `src/render/three/geodesicCannonTools.ts` (C2-C5): new dep `getPlayerPortalTransitionsSince(serial)`; `startGeodesicCannonCarry` stores `carryPortalTransitionSerial`; `updateCarriedGeodesicPortalWord` folds every unseen transition in order (chain check as in the job: first source = previous cannon cell, entries chain, last target = cannon cell; the interval branch folds all traversals and validates once, the connection branch applies the new exported `applyCarriedPortalTransition` per crossing); `normalizeReleasedCarriedGeodesicCannon` now uses `locateDevelopedPoint` from the player's position to the cannon's, records each crossing and re-homes with `composeRigidTransform3(result.cellFromStart, cannon.localPose)`; the `moveDynamicObject` import is gone.
- `src/world-objects/geodesicCannon.ts` (C5/C6): new exports `applyAnchorCrossingTraversals` (folds `portalWordAfterAnchorCrossing` over a traversal list) and `updateLockedGeodesicPortalWordForCarriedAnchorTraversals` (the old single-traversal function now delegates to it); curve shortening builds one traversal per `moveResult.crossings` entry and applies them in order.
- Tests (C8): two-crossing mapping and `applyCarriedPortalTransition` tests in `tests/render-contract/geodesicCarryPortalTransition.test.ts`; in `tests/world-objects/geodesicCannon.test.ts` (loop words describe) a fold test (two traversals at once equal two single updates) and a direct unit test of `applyAnchorCrossingTraversals`.
- Generated docs regenerated.
### Deviations
#### Part A
- Deleted test "throws for the unimplemented bounds crossing mode" (Decision 10).
- "teleports an out-of-domain endpoint through only one most probable portal per frame" rewritten as "re-homes an out-of-cell anchor before moving" (3 crossings, x = -0.9, second zero move does not cross).
- "falls back to the original pose ... (convex corner)" renamed "stops in a convex corner where two walls meet"; expects x, y within 1e-5 of 0.9 (was: unchanged 0.85).
- "refuses to cross when the object would violate the target cell ceiling": now expects cell `room-a`, x within 1e-12 of 0.95, `blocked`, reason `ceiling`; no longer `result.object` identity.
- "lets anchor portal crossing take precedence over swept forbidden-zone collision" rewritten as "slides around a swept forbidden zone ...": old expectation was a crossing into room-b, new is blocked with `forbidden-zone`, final anchor inside its cell and at least 0.25 from the zone.
- "crosses portals near an endpoint when forbidden-zone collision is ignored" (not on the job's list): the start y changed from 0.9 to 0.75 (expected y likewise). Why: with radius 0.2 at y = 0.9 the body starts overlapping the north wall (0.1 away) and moves toward the wall end cap at the portal vertex (1, 1), so it is correctly deflected and reported blocked. At y = 0.75 it is clear of the wall and the crossing intent of the test is kept.
- The north-portal repro (A6.2) asserts the neighbour-local pose (0.75, 0.75): x 0.75 on the neighbour's east wall, y 0.75 against its north wall (developed y = 2.75), `blocked` and `crossedPortal` both true.
- Random-polygon slide property uses 25 runs of 2 000 steps each (not 10^4 steps), and the polygon filter is "vertex average more than 0.4 m from every side" (arbitrary polygons have radius from 1 m).
- `collectDevelopedObstacles` has an extra optional field `frameFromCell` (and `bodiesInCell` / `ignoredObjectIds` are left for Part B).
#### Part B
- `movePlayer.test.ts` "lets a player inside a runtime body step away but not further in": now passes the body through `bodiesInCell` (as a `DynamicObjectState`); the "further in" case expects the position within 1e-9 of 0.3 instead of exactly equal.
- `simpleGeoCreature.test.ts` "blocks a mouse from penetrating a supplied player obstacle" renamed "stops a mouse at the surface of a supplied player obstacle": old expectation y = 0 (the whole move discarded), new y in (0.14, 0.15] (the obstacle is 0.65 m ahead, radii sum 0.5 m).
- `collision.test.ts`: the `moveIncreasesCylinderOverlap` test deleted with the function (Decision 11).
- `vrLocomotion.test.ts`: two `MoveResult` literals gained `crossings: []` and `cellFromStart` to satisfy the type.
#### Part C
- No existing test was changed. C8 fold test: the Three.js shell (`updateCarriedGeodesicPortalWord`) is not reachable from a test, so the fold is tested through the registry function it calls (`updateLockedGeodesicPortalWordForCarriedAnchorTraversals`) plus `applyCarriedPortalTransition` twice, as the job allows.
- C8 curve shortening: a direct unit test of the traversal loop (`applyAnchorCrossingTraversals`) was chosen over a two-portal tick in a narrow world; the existing curve-shortening tests still pass.
### Uncertain
#### Part A
- Creature offset: when the collision offset is horizontal, the obstacles are collected around the body centre in the centre's own cell (found by `locateDevelopedPoint` from the anchor to the centre) and mapped back to the anchor cell's frame with `frameFromCell`, instead of treating the centre as a point of the anchor cell. Not in the job text; confirm the choice with a creature that stands within its offset of a portal.
- A hit at s within 1e-9 of the end of the step counts as a touch, not a block. Needed so that "can ignore forbidden zones" still reports `blocked: false` for a body ending exactly at the wall distance.
- A body that travels exactly at radius distance along a straight wall can touch the seam end cap where two collinear walls (across a portal) meet; the tangential response leaves the motion unchanged but `blocked` may be reported true for that step.
- The anchor stop of Decision 7 (anchor hits a wall the centre did not) is implemented but has no dedicated test (no shipped body has an offset larger than its radius).
- The unfinished-walk path (Decision 8: crossing limit, missing cell, failed re-homing) is implemented with `console.warn` but not covered by a test.
#### Part B
- A `DynamicObjectState` has no id, so `ObstacleBodyState.id` is optional: `createThreeApp.ts` adds the registry id to the player's blocking bodies; creatures pass their obstacles without ids. The moving body is never in its own `bodiesInCell` list (the player is not in the registry's blocking list), so nothing self-ignores.
- B5.1 as written (a mover 0.1 m before the portal and a r = 0.25 body 0.1 m beyond it) starts already overlapping, so a non-overlap distance cannot hold. I used a mover of radius 0.1 starting 0.1 m before the portal and a body 0.5 m beyond it, which exercises the crossing: the mover ends in `room-b` 0.35 m (the radii sum) from the body. The already-overlapping case is its own test (cannot move closer, may move away).
- The B5.2 triangle test asserts only the stated invariants (clearance from the developed wall B-C at least 0.1 m, at most one cell change); I did not verify that the wall is actually touched.
- A creature now advances to the obstacle surface and slides, instead of discarding the whole move; confirm that is the wanted creature behaviour.
#### Part C
- `rebuildConnectedGeodesicBetweenEmitters` still receives only the newest transition as `carriedEmitterPortalTransition` (`deps.getLatestPlayerPortalTransition()`); its API takes one transition and the job does not list it. The portal word itself is folded over all transitions, so only the fallback inference uses the newest one. Confirm with a carry that crosses two portals in one frame.
- `normalizeReleasedCarriedGeodesicCannon` walks from the player's position only when the cannon is in the player's cell; otherwise the cannon is left as is (the job assumes it is always held in the player's cell frame; the old zero-move re-homed from `cannon.cellId`).
- A move whose crossings do not chain for the cannon (chain check fails) is skipped on every later frame too (as before for a single transition) because the serial is not advanced.
- The first `npm run smoke -- --world cube,torus-moduli` run failed on torus-moduli ("loading screen still present after 60000 ms; no canvas"); an immediate rerun of torus-moduli alone passed. Looks like a load-time flake, not confirmed against the previous commit.
### Not done
#### Part A
- Nothing in Part A. Parts B and C, issue closing, the browser smoke test and the manual check are left for later (job stays `in progress`).
#### Part B
- Nothing in Part B. Part C, issue closing, the browser smoke test and the manual check are still left.
#### Part C
- Nothing in Part C. Issues 61, 62, 63 are not closed (the Uncertain entries above; coordinator ruling): each carries a pointer to this report instead.
### Manual checks not run
- Walk into a room corner in `?config=full` with a walled test world, and walk straight at a cube vertex (slides around the zone, never disappears); also carry a geodesic cannon through two portals in one frame. No interactive browser here.
### Checks
#### Part A
- Baseline: `npm run typecheck` ok; `npm test` 111 files, 813 passed, 8 skipped.
- After: `npm run typecheck` ok; `npm test` all pass except the documentation test, which failed on stale generated docs; `npm run docs:generate` then `npm run docs:check` all ok and `npx vitest run tests/docs` passes. Final run before the commit: typecheck ok, 113 test files passed (831 tests passed, 8 skipped), docs:check ok.
#### Part B
- Baseline: Part A final state (typecheck ok, 831 tests passed, docs:check ok).
- After: `npm run typecheck` ok; `npm test` 113 files, 835 passed, 8 skipped; `npm run docs:generate` then `npm run docs:check` ok.
#### Part C
- Baseline: Part B final state. After: `npm run typecheck` ok; `npm test` 113 files, 839 passed, 8 skipped; `docs:check` first reported a detached JSDoc on `createGeodesicCannonTools` (fixed) and stale generated docs, then `npm run docs:generate` and `npm run docs:check` ok.
- `npm run build` ok. `npm run smoke -- --world cube,torus-moduli`: cube "SMOKE OK"; torus-moduli failed once ("loading screen still present after 60000 ms; no canvas"), rerun `npm run smoke -- --world torus-moduli` "SMOKE OK".
