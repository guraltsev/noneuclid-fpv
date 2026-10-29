# Job 09 - Make torus deformation commits safe

Status: queued.
Resolves: issue [53](../../_issues/53_torus_deformation_commit_transport_defects.md) items 1, 3 and 4 (item 2, the heading, is [job 07](07_forward_heading_convention.md)).
Depends: none.

## Goal

A deformation commit in the `torus-moduli` world (and any other world using the `torus-skew` family) must:

1. never leave the player, a creature or a placed flag inside a forbidden zone or a wall (issue 53 item 1);
2. refuse a base world whose floor footprint is not the centred parallelogram the family assumes (item 3);
3. reach every target it accepts, including a target with a different width (item 4).

Three changes do this: a new pure function `depenetrateDynamicObject` called after every commit, a footprint check in
`validateTorusSkewBaseSpec`, and a `nextTorusSkewStep` that moves (w, a, b) together.

## Depends on

Nothing. [Job 07](07_forward_heading_convention.md) also edits the commit path (heading transport) but touches
different lines; this job can land before or after it. [Job 10](10_floor_texture_in_lattice_coordinates.md) depends on
this job (it relies on the footprint check of step 6).

## Before you start

Read these, in this order. Line numbers are from commit `e094b82`; if they moved, search for the function name.

| File | Lines | What to look at |
| --- | --- | --- |
| `_docs/MATHEMATICAL_MODEL.md` | 27-55, 156-187, 334-361 | Conventions, motion of bodies (§5), live deformation (§9) |
| `src/runtime/deformations/torusSkewDeformation.ts` | 1-6, 60-115, 117-195, 197-258, 287-323, 338-374 | Family, vertices, maps, step, validation, inference, normalization, lattice frame |
| `src/runtime/worldGeometrySession.ts` | 144-240 | `scheduleNextBuild`, `setTarget` |
| `src/runtime/worldGeometryDeformationFamilies.ts` | 76-107 | `applyWorldDeformationToSpec`, `createInitialWorldDeformationState` |
| `src/render/three/createThreeApp.ts` | 1554-1663, 3078-3093, 3367-3375 | `commitWorldGeometrySnapshot`, `transformPlayerForGeometryCommit`, `transformRuntimeObjectsForGeometryCommit`, `resetPlayerToHome`, `createPlayerCollisionState` |
| `src/movement/collision.ts` | 82-134, 164-185, 249-251 | `testCellCollision`, `getDynamicObjectCollisionBounds`, `signedDistanceToSide` |
| `src/movement/moveDynamicObject.ts` | 82-163, 252-285 | `moveDynamicObject`, `resolveBlockedWallPosition` |
| `src/movement/portalCrossing.ts` | 14-20 | `crossDynamicObjectPortal` |
| `src/movement/playerPose.ts` | 43-60 | `playerPoseToDynamicObject`, `playerPoseFromDynamicObject` |
| `src/cell-complex/forbiddenZones.ts` | 1-46 | Zone radius 0.15 m, infinite height |
| `src/cell-complex/prismCells.ts` | 18-65 | `CompiledPrismCellGeometry`, `CompiledPrismSide` |
| `src/world-objects/geodesicMarmot.ts` | 140-187 | `update` (zones active), `transformGeometry` |
| `src/world-objects/simpleGeoCreature.ts` | 237-280 | `update` (uses `ignoreForbiddenZones: true`), `transformGeometry` |
| `tests/runtime/torusSkewDeformation.test.ts` | all | Existing family tests and the local `skewState` helper |
| `tests/runtime/worldGeometryDeformations.test.ts` | 28-67 | Inference tests that this job must adjust |
| `tests/runtime/worldGeometrySession.test.ts` | 49-70, 129-220 | `createTestSession`, `createDeferredBuildClient`, `flushPromises` |
| `tests/movement/moveDynamicObject.test.ts` | 189-212, 382-440 | Wall and zone tests, `dynamicObject` helper |

Environment: Windows, run commands in Git Bash from the repository root.

Baseline, before you change anything:

```bash
npm run typecheck
npm test
```

Both must pass. If they do not, stop editing, record the failing output under `### Checks` in `## Report`, and only
then continue (do not try to fix unrelated failures). Run one test file with `npx vitest run <path>`, for example
`npx vitest run tests/runtime/torusSkewDeformation.test.ts`.

`npm test` includes `tests/docs/documentation.test.ts`. It fails when a new module has no header comment, when an
exported symbol has no JSDoc comment, or when `_docs/generated/*` is out of date. After adding exports, run
`npm run docs:generate`.

## Background

### Coordinates

Cell-local frame: x east, y north, z up, meters (`_docs/MATHEMATICAL_MODEL.md` §1). Yaw is about +z.

The torus cell `"torus-room"` has footprint vertices v0, v1, v2, v3 (counter-clockwise), built by
`buildTorusParallelogramVertices` (`torusSkewDeformation.ts:120-132`):

```ts
const u = { x: state.widthMeters, y: 0 };
const v = { x: state.skewXMeters, y: state.depthMeters };
return [ -u/2 - v/2,  u/2 - v/2,  u/2 + v/2,  -u/2 + v/2 ];   // (written per component in the code)
```

So u = (w, 0), v = (a, b), and the footprint is centred on the origin. Side i runs from vertex i to vertex i+1; sides 0
and 2 are glued, sides 1 and 3 are glued (all four sides are portals, there are no walls). Every vertex is a portal
junction, so each has a forbidden zone: a vertical cylinder of radius 0.15 m (`forbiddenZones.ts:9`).

A point p has lattice coordinates (α, β) with p = o + α·u + β·v and o = −(u + v)/2. A commit maps p to
o' + α·u' + β·v' (`createTorusSkewCellDeformationMaps`, `torusSkewDeformation.ts:137-168`). In matrix terms the
linear part is `A = [u' v'] · [u v]⁻¹` (columns are the lattice vectors). A is not a rotation, so it can move a body closer to a vertex.

### Defect 1: the trap (issue 53 item 1)

`transformPlayerForGeometryCommit` (`createThreeApp.ts:1596-1618`, the issue's `:1529-1551` is out of date) writes
the mapped pose with no collision test:

```ts
playerPose = {
  ...playerPose,
  cellId: transformed.cellId,
  position: transformed.localPose.translation,
  yawRadians: yawFromPose(transformed.localPose),
};
```

Creatures (`runtime.transformGeometry(mapByCellId)`, `createThreeApp.ts:1624-1626`) and placed flags
(`createThreeApp.ts:1636-1651`) are mapped the same way.

After that, `testCellCollision` (`collision.ts:100-105`) blocks every move whose end position overlaps a zone, even a
move that reduces the overlap, and `moveDynamicObject` (`moveDynamicObject.ts:133-154`) then keeps the old pose. A
portal crossing is refused when the crossed body overlaps a zone in the target cell (`moveDynamicObject.ts:96-117`,
check at `:113`). On the torus every zone is the same vertex, so the player is stuck for good.

Verified numbers (checked by running the current code). Start at w = b = 15, a = 0. The player (radius 0.25 m)
stands at (7.1, −7.3, 0): vertex v1 = (7.5, −7.5) plus d = (−0.4, 0.2). Distance to v1 is 0.447 m, more than
0.15 + 0.25 = 0.40, so the pose is legal. Commit to a = 30, b = 7.5. Then A = [[1, 2], [0, 0.5]], the new vertices are
(−22.5, −3.75), (−7.5, −3.75), (22.5, 3.75), (7.5, 3.75), and the mapped player is at (−7.5, −3.65): 0.10 m from the
new v1. `testCellCollision` reports `{ blocked: true, reason: "forbidden-zone" }`.

Which bodies test zones today:

- the player: yes (`movePlayer` calls `moveDynamicObject` without `ignoreForbiddenZones`);
- marmots (`geodesicMarmot.ts:147-152`): yes;
- geo creatures (`simpleGeoCreature.ts:237-243`): no, they pass `ignoreForbiddenZones: true`;
- placed flags: yes, at placement (`placedFlags.ts:277`, `testCellCollision({ cell, object: candidateState })`). The
  default flag collision is radius 0.475 m, height 1.15 m, offset z 0.575 (`placedFlags.ts:106-110`).

### Defect 3: the frame is assumed, not checked (issue 53 item 3)

`inferTorusSkewState` (`torusSkewDeformation.ts:242-258`) reads w = |v1 − v0| and (a, b) = v3 − v0 from the base
footprint. `torusLatticeFrame` (`:338-350`) then assumes the footprint is centred with u = (w, 0):

```ts
function torusLatticeFrame(state: TorusSkewDeformationState): TorusLatticeFrame {
  const u = { x: state.widthMeters, y: 0 };
  const v = { x: state.skewXMeters, y: state.depthMeters };
  return { origin: { x: -0.5 * u.x - 0.5 * v.x, y: -0.5 * u.y - 0.5 * v.y }, u, v };
}
```

`validateTorusSkewBaseSpec` (`:200-237`) checks the cell id, the vertex count, the portal pairing and the height, not
the footprint position. A torus authored on [0, 15]² is accepted, `applyToSpec` maps its objects with a frame that is
off by (7.5, 7.5) m, and the rebuilt footprint is re-centred, so the whole world jumps. A rotated quad gives a
meaningless A.

### Defect 4: the width step (issue 53 item 4)

`nextTorusSkewStep` (`:173-195`) steps (a, b) by at most `maxStepMeters`, but takes the target width at once (`:191`):

```ts
return normalizeTorusSkewState({
  ...current,
  widthMeters: target.widthMeters,
  depthMeters: current.depthMeters + deltaB * stepScale,
  skewXMeters: current.skewXMeters + deltaA * stepScale,
});
```

`normalizeTorusSkewState` requires b ∈ [w/2, 2w] (`:304`) and a ∈ [0, 2w] (`:310`). Example: from (w, a, b) =
(15, 0, 15) to the valid target (40, 0, 20), the first step is (40, 0, 15.05), and 15.05 < 40/2 throws. The throw
lands in `lastError` (`worldGeometrySession.ts:218-222`) and the target is never reached. Today no UI changes the
width (`geometryComputerMenu.ts` and `paletteDefinition.ts` always pass the current width), but `setTarget` accepts it.

### Other facts you need

- `commitWorldGeometrySnapshot` (`createThreeApp.ts:1554-1594`) maps the player and objects **before** it swaps
  `activeWorldBundle`, so inside those helpers `activeWorld()` is still the **old** world. The new world is
  `snapshot.world`.
- `createPlayerCollisionState(pose)` (`createThreeApp.ts:3367-3375`) builds the player's `DynamicObjectState` with
  `simpleCollisionCylinder(radius, height, { x: 0, y: 0, z: height / 2 })`.
- `runtimeObjectToDynamicObjectState` is already imported in `createThreeApp.ts` (line 155).
- Collision is only ever tested against the body's own cell (`collision.ts` header).

## Decisions

1. **Where depenetration lives.** Decided: a new pure module `src/movement/depenetrateDynamicObject.ts` exporting
   `depenetrateDynamicObject(world, object, options)`. Why: the `movement` layer may import `cell-complex` and `math`
   (see `layers` in `scripts/docs/lib.mjs`), it already owns `testCellCollision` and portal crossing, and both
   `createThreeApp.ts` (render) and the creatures (world-objects) may import `movement`. It takes the whole compiled
   world, not a single cell, so it can apply a portal crossing. Alternative considered: a function in
   `src/runtime/worldGeometryDeformations.ts` taking one cell; rejected because it could not follow a portal.
2. **Algorithm.** Decided: up to 4 rounds of "push radially out of every overlapping zone to
   r_zone + r_body + 1e-6, then push along the inward normal out of every overlapping wall to r_body + 1e-6, then cross
   a portal if the anchor left the cell"; stop as soon as `testCellCollision` passes. If 4 rounds do not fix it,
   sample a grid over the cell and take the free sample nearest to the mapped position. If even that fails, return
   `"failed"` and leave the body where the map put it. Why: matches issue 53 §Proposed change 1, and a radial push
   is the shortest way out of a single cylinder. Alternative considered: removing the cylinders at flat vertices
   (job 18 step 3); that needs job 12 first and does not help walls or cone points.
3. **Failure handling.** Decided: on `"failed"`, keep the mapped pose and `console.warn` once per commit; do not call
   `resetPlayerToHome()`. Why: `resetPlayerToHome` reads `activeWorld().startingPosition`, which during the commit is
   the old world's; and failure needs every grid sample to be blocked, which does not happen in shipped worlds.
   Alternative considered: teleport home.
4. **Which bodies, which zones.** Decided: the player and placed flags with zones on; marmots with zones on; geo
   creatures (`simpleGeoCreature`) with `ignoreForbiddenZones: true`, i.e. walls only, matching how each one moves.
   Geodesic cannons are not depenetrated. Why: a body must be legal by the same rules its own mover enforces.
   Alternative considered: zones on for everything; that would move creatures that are never blocked by zones.
5. **Width step.** Decided: interpolate (w, a, b) jointly along the straight segment in (w, a, b) space, with step
   length measured as `Math.hypot(Δw, Δa, Δb)`, then clamp b into [w/2, 2w] and a into [0, 2w] to absorb rounding.
   Why: the constraints b − w/2 ≥ 0, 2w − b ≥ 0, a ≥ 0, 2w − a ≥ 0 are linear in (w, a, b), so the allowed set is
   convex and every point of a straight segment between two allowed states is allowed; the clamp only removes
   floating-point error of order 1e-15. When Δw = 0 the step is exactly today's step, so existing tests keep passing.
   The family's `normalizeState` already accepts any positive width, so this is the smallest change that "reaches
   it". Alternative considered: reject targets whose width differs from the current one in `setTarget`; that needs
   the current state inside `normalizeState`, which does not have it.
6. **Base-frame check.** Decided: `validateTorusSkewBaseSpec` rejects a footprint that differs, in any coordinate,
   by more than `dimensionToleranceMeters` (1e-6, `torusSkewDeformation.ts:46`) from
   `buildTorusParallelogramVertices` of the raw values w = |v1 − v0|, (a, b) = v3 − v0 (raw: not range-checked).
   Because `canApplyToSpec` returns `validateTorusSkewBaseSpec(baseSpec).length === 0`, such a world falls back to
   `static-world` in `createInitialWorldDeformationState`. Why: the shipped torus worlds are already centred, and
   this is a few lines; the issue explicitly allows it. Alternative considered: read o, u, v from the vertices and
   solve a general 2×2 system in `latticeCoordinates`; more code, and `inferTorusSkewState` would also need a
   rotation-invariant shape parameter (that belongs to job 35).

## Steps

Do the steps in order. Run `npm run typecheck` after each step that changes source.

### Part A: depenetration

1. Create `src/movement/depenetrateDynamicObject.ts`. Start the file with a module header comment, as every other
   module does (for example the first lines of `src/movement/collision.ts`). Give every export a JSDoc comment.
   Sketch (adapt names of imports if `typecheck` complains, but keep the exported names):

   ```ts
   /**
    * Pushes a body that overlaps forbidden-zone cylinders or walls of its cell back to a legal pose. Used after a
    * deformation commit, which maps poses by a non-rigid map and can leave a body inside an obstacle.
    * (Expand: radial push out of zones to r_zone + r_body + 1e-6, push along wall normals, at most 4 rounds,
    * portal crossing when the anchor leaves the cell, nearest-free-grid-sample fallback.)
    */
   import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
   import type { CompiledPrismCell } from "../cell-complex/prismCells";
   import { rigidTransform3 } from "../math/rigidTransform3";
   import { vec3 } from "../math/vec3";
   import { getDynamicObjectCollisionBounds, signedDistanceToSide, testCellCollision } from "./collision";
   import type { DynamicObjectState } from "./dynamicObject";
   import { crossDynamicObjectPortal } from "./portalCrossing";

   /** Extra clearance, meters, added beyond exact contact so the pushed pose is strictly legal. */
   export const depenetrationMarginMeters = 1e-6;
   /** Maximum push rounds before falling back to grid sampling. */
   export const maxDepenetrationRounds = 4;

   /** Options for {@link depenetrateDynamicObject}. */
   export interface DepenetrationOptions {
     /** If true, forbidden zones are ignored and only walls (and floor/ceiling) count. */
     readonly ignoreForbiddenZones?: boolean;
   }

   /**
    * Outcome: "unchanged" (already legal; `object` is the input object itself), "pushed" (fixed by pushes),
    * "sampled" (fixed by the grid fallback), "failed" (no legal pose found; `object` is the input object).
    */
   export interface DepenetrationResult {
     readonly kind: "unchanged" | "pushed" | "sampled" | "failed";
     readonly object: DynamicObjectState;
   }

   /** (JSDoc: what it does, the order of the rules, that it never throws for a missing cell but returns "failed".) */
   export function depenetrateDynamicObject(
     world: CompiledCellComplex,
     object: DynamicObjectState,
     options: DepenetrationOptions = {},
   ): DepenetrationResult {
     if (!object.collision || !isBlocked(world, object, options)) {
       return { kind: "unchanged", object };
     }
     let current = object;
     for (let round = 0; round < maxDepenetrationRounds; round += 1) {
       const cell = world.cellsById.get(current.cellId);
       if (!cell) {
         return { kind: "failed", object };
       }
       current = pushOutOfZonesAndWalls(cell, current, options);
       current = crossPortalIfAnchorLeft(cell, current);
       if (!isBlocked(world, current, options)) {
         return { kind: "pushed", object: current };
       }
     }
     const sampled = nearestFreeGridSample(world, object, options);
     return sampled ? { kind: "sampled", object: sampled } : { kind: "failed", object };
   }
   ```

2. In the same file write the private helpers.

   - `isBlocked(world, object, options)`: get the cell with `world.cellsById.get(object.cellId)`; if missing return
     `true`; else return
     `testCellCollision({ cell, object, ignoreForbiddenZones: options.ignoreForbiddenZones }).blocked`. Do not pass
     `previousObject` (no swept test: there is no motion here).
   - `translateBy(object, dx, dy)`: returns
     `{ ...object, localPose: rigidTransform3(object.localPose.rotation, vec3(t.x + dx, t.y + dy, t.z)) }` with
     `t = object.localPose.translation`. The collision center moves by the same (dx, dy) as the pose translation,
     because the offset is rotated by the unchanged rotation.
   - `pushOutOfZonesAndWalls(cell, object, options)`:

     ```ts
     let current = object;
     if (!options.ignoreForbiddenZones) {
       for (const zone of cell.singularityColumns) {
         const bounds = getDynamicObjectCollisionBounds(current)!;   // object.collision is set, see step 1
         const dx = bounds.center.x - zone.center.x;
         const dy = bounds.center.y - zone.center.y;
         const distance = Math.hypot(dx, dy);
         const required = zone.radius + bounds.radius + depenetrationMarginMeters;
         if (distance >= required) continue;
         // Direction away from the zone axis; if the center is on the axis, head for the cell centroid.
         let nx = dx / distance;
         let ny = dy / distance;
         if (!(distance > 1e-9)) {
           const c = centroid(cell.baseVertices);          // mean of the base vertices
           const cx = c.x - zone.center.x;
           const cy = c.y - zone.center.y;
           const cLength = Math.hypot(cx, cy);
           nx = cx / cLength;
           ny = cy / cLength;
         }
         const push = required - (distance > 1e-9 ? distance : 0);
         current = translateBy(current, nx * push, ny * push);
       }
     }
     for (const side of cell.sides) {
       if (side.portal) continue;                          // portal sides never block (collision.ts:120-123)
       const bounds = getDynamicObjectCollisionBounds(current)!;
       const clearance = signedDistanceToSide(side, bounds.center) - bounds.radius;
       if (clearance >= 0) continue;
       const push = -clearance + depenetrationMarginMeters;
       current = translateBy(current, side.inwardNormal.x * push, side.inwardNormal.y * push);
     }
     return current;
     ```

     Zones have infinite height (`forbiddenZones.ts:13`), so z never matters for them.
   - `crossPortalIfAnchorLeft(cell, object)`: find the side with the most negative
     `signedDistanceToSide(side, object.localPose.translation)`. If that value is `< 0` and the side has a `portal`,
     return `crossDynamicObjectPortal(object, side.portal)`; otherwise return `object` unchanged. (This is the anchor
     rule of `moveDynamicObject`, simplified: one crossing per round.)
   - `nearestFreeGridSample(world, object, options)`:
     - cell = `world.cellsById.get(object.cellId)`; if missing return `undefined`;
     - bounding box of `cell.baseVertices`; `span = max(width, height)`;
       `spacing = Math.max(0.1, span / 200)` (at most about 200 × 200 samples);
     - for every grid point (x, y) from (minX, minY) in steps of `spacing`: skip it if
       `signedDistanceToSide(side, p) < 0` for any side (outside the cell); build the candidate with the original
       rotation and z (`rigidTransform3(object.localPose.rotation, vec3(x, y, t.z))`); skip it if `isBlocked`; keep
       the one with the smallest squared horizontal distance to the original translation;
     - return the best candidate or `undefined`.

3. Wire the player. In `src/render/three/createThreeApp.ts`:
   - Add `playerPoseFromDynamicObject` to the existing import from `"../../movement/playerPose"` (line 79), and import
     `depenetrateDynamicObject` from `"../../movement/depenetrateDynamicObject"`.
   - In `commitWorldGeometrySnapshot` change the call to `transformPlayerForGeometryCommit(mapByCellId, snapshot.world);`.
   - Change `transformPlayerForGeometryCommit` to take `nextWorld: CompiledCellComplex` (the type is already used in
     this file; if not imported, import it as a type from `"../../cell-complex/compileCellComplex"`). Replace the
     body after `transformPoseWithCellMaps` with:

     ```ts
     if (!transformed || !nextWorld.cellsById.has(transformed.cellId)) {
       resetPlayerToHome();
       return;
     }
     const mappedPose: PlayerPose = {
       ...playerPose,
       cellId: transformed.cellId,
       position: transformed.localPose.translation,
       yawRadians: yawFromPose(transformed.localPose),
     };
     const result = depenetrateDynamicObject(nextWorld, createPlayerCollisionState(mappedPose));
     if (result.kind === "failed") {
       console.warn("Deformation commit: no legal player pose found; keeping the mapped pose.");
       playerPose = mappedPose;
       return;
     }
     playerPose = playerPoseFromDynamicObject(result.object, mappedPose.pitchRadians);
     ```

     Note: `playerPoseFromDynamicObject` recomputes yaw from the rotation, which is the same yaw, and keeps pitch.

4. Wire placed flags. In `transformRuntimeObjectsForGeometryCommit` (`createThreeApp.ts:1620-1663`), in the
   `placed-flag` branch, after `transformed` is known and before `nextObject` is built:

   ```ts
   const depenetrated = depenetrateDynamicObject(
     snapshot.world,
     runtimeObjectToDynamicObjectState({ ...object, cellId: transformed.cellId, localPose: transformed.localPose }),
   );
   const nextObject = {
     ...object,
     cellId: depenetrated.object.cellId,
     localPose: depenetrated.object.localPose,
   };
   ```

   On `"failed"` the result object is the mapped pose, so no special case is needed.

5. Wire the creatures.
   - In `src/world-objects/geodesicMarmot.ts` and `src/world-objects/simpleGeoCreature.ts`, change the interface
     method to `transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;`
     (lines 60 and 78) and update the JSDoc. The parameter is optional so the existing call in
     `tests/runtime/worldGeometryRuntimeTransforms.test.ts:70` still compiles.
   - In each implementation (`geodesicMarmot.ts:169`, `simpleGeoCreature.ts:261`), after `state` and `initialState`
     are set and before `syncRegistryObject(...)`:

     ```ts
     if (nextWorld) {
       state = depenetrateDynamicObject(nextWorld, state).object;               // marmot: zones on
       initialState = depenetrateDynamicObject(nextWorld, initialState).object;
     }
     ```

     In `simpleGeoCreature.ts` pass `{ ignoreForbiddenZones: true }` as the third argument (it moves with zones
     ignored, `simpleGeoCreature.ts:242`).
   - In `createThreeApp.ts:1625` call `runtime.transformGeometry(mapByCellId, snapshot.world);`.

### Part B: base-frame check

6. In `validateTorusSkewBaseSpec` (`torusSkewDeformation.ts:200-237`), after the vertex-count check, add:

   ```ts
   if (cell.baseVertices.length === 4) {
     const [v0, v1, , v3] = cell.baseVertices;
     const expected = buildTorusParallelogramVertices({
       widthMeters: Math.hypot(v1.x - v0.x, v1.y - v0.y),
       skewXMeters: v3.x - v0.x,
       depthMeters: v3.y - v0.y,
     });
     const matches = cell.baseVertices.every(
       (vertex, index) =>
         Math.abs(vertex.x - expected[index].x) <= dimensionToleranceMeters &&
         Math.abs(vertex.y - expected[index].y) <= dimensionToleranceMeters,
     );
     if (!matches) {
       errors.push(
         `Cell "${torusCellId}" footprint must be the centred parallelogram with u = (w, 0) and v = (a, b), vertices -u/2-v/2, u/2-v/2, u/2+v/2, -u/2+v/2.`,
       );
     }
   }
   ```

   Do not call `inferTorusSkewState` here: it range-checks and throws, and
   `tests/runtime/worldGeometryDeformations.test.ts` "falls back to the 15 m default when inference is impossible"
   needs a centred but out-of-range footprint (w = 100) to stay accepted.
   Update the JSDoc of `validateTorusSkewBaseSpec` (line 198) to mention the footprint check.

7. Update `tests/runtime/worldGeometryDeformations.test.ts` "infers non-default width, depth and skew instead of
   15 m" (lines 40-54). Its footprint (−5,−3), (5,−3), (6,3), (−4,3) is not centred and is now rejected. Replace the
   vertices with the centred footprint of the same shape: (−5.5, −3), (4.5, −3), (5.5, 3), (−4.5, 3). The expected
   `{ widthMeters: 10, depthMeters: 6, skewXMeters: 1 }` stays.

### Part C: width step

8. Replace the body of `nextTorusSkewStep` (`torusSkewDeformation.ts:173-195`) with:

   ```ts
   const maxStepMeters = Math.max(0, options.maxStepMeters);
   const snapToleranceMeters = options.snapToleranceMeters ?? 1e-9;
   const deltaW = target.widthMeters - current.widthMeters;
   const deltaA = target.skewXMeters - current.skewXMeters;
   const deltaB = target.depthMeters - current.depthMeters;
   const distance = Math.hypot(deltaW, deltaA, deltaB);

   if (distance <= Math.max(maxStepMeters, snapToleranceMeters)) {
     return normalizeTorusSkewState(target);
   }

   const stepScale = maxStepMeters / distance;
   const widthMeters = current.widthMeters + deltaW * stepScale;
   // The allowed set is convex in (w, a, b), so the exact point is in range; the clamps only remove rounding error.
   const depthMeters = clamp(current.depthMeters + deltaB * stepScale, widthMeters / 2, widthMeters * 2);
   const skewXMeters = clamp(current.skewXMeters + deltaA * stepScale, 0, widthMeters * 2);
   return normalizeTorusSkewState({ ...current, widthMeters, depthMeters, skewXMeters });
   ```

   Add a small private `clamp(value, min, max)` helper at the bottom of the file. Update the JSDoc of
   `nextTorusSkewStep` (line 171) and the module header (line 5: "w is taken from the target at once" becomes
   "(w, a, b) move together along a straight segment"). Also update the field comment at line 3 ("width w (kept
   fixed)") to say the shipped UI keeps w fixed but the family allows a width change.

### Part D: documentation

9. `_docs/MATHEMATICAL_MODEL.md` §9 (lines 334-361):
   - replace "The width $w$ is fixed" with: the shipped UI keeps $w$ fixed; a step moves $(w,a,b)$ together along a
     straight segment, which stays in the allowed set because that set is convex;
   - add that the base footprint must be the centred parallelogram (otherwise the family does not apply);
   - add a paragraph "Depenetration after a commit": the map is not rigid, so after mapping every body is pushed out
     of zones and walls by `src/movement/depenetrateDynamicObject.ts#depenetrateDynamicObject`, with the rules of
     Decision 2.
10. Run `npm run docs:generate`, then `npm run typecheck` and `npm test`.

## Tests and checks

Add these tests. Use `toBeCloseTo(x, 9)` for 1e-9 comparisons.

### New file `tests/movement/depenetrateDynamicObject.test.ts`

Imports you will need: `torusModuli` from `src/authoring/exampleWorlds`, `compileCellComplex`,
`createTorusSkewDeformationFamily` and `createTorusSkewCellDeformationMaps` from
`src/runtime/deformations/torusSkewDeformation`, `transformPoseWithCellMaps` from
`src/runtime/worldGeometryDeformations`, `yawRigidTransform3`, `vec3`, `simpleCollisionCylinder`,
`testCellCollision`, `moveDynamicObject`, and the new function. Shared setup:

```ts
const rest = { kind: "torus-skew", cellId: "torus-room", widthMeters: 15, depthMeters: 15, skewXMeters: 0 } as const;
const trap = { ...rest, depthMeters: 7.5, skewXMeters: 30 } as const;
const playerCollision = simpleCollisionCylinder(0.25, 1.6, { x: 0, y: 0, z: 0.8 });   // same as createPlayerCollisionState
const trapWorld = compileCellComplex(createTorusSkewDeformationFamily().applyToSpec(torusModuli, trap));
```

1. `it("pushes the player out of the junction zone after the issue-53 trap commit")`
   - player at `vec3(7.1, -7.3, 0)` in `"torus-room"`, yaw 0, `playerCollision`;
   - assert it is legal before: `testCellCollision({ cell: compileCellComplex(torusModuli).cellsById.get("torus-room")!, object })`
     has `blocked: false`;
   - map with `transformPoseWithCellMaps(object, createTorusSkewCellDeformationMaps(rest, trap))`; assert the mapped
     translation is (−7.5, −3.65) to 1e-9 and that `testCellCollision` in `trapWorld` gives
     `{ blocked: true, reason: "forbidden-zone" }` (this proves the test reproduces the bug);
   - `const result = depenetrateDynamicObject(trapWorld, mapped)`; expect `result.kind` to be `"pushed"`;
   - expect the translation to be (−7.5, −3.349999) to 1e-9 (pushed straight up from v1 = (−7.5, −3.75) to distance
     0.400001), and the cell id still `"torus-room"`;
   - for every vertex of `trapWorld.cellsById.get("torus-room")!.baseVertices`, expect the horizontal distance to be
     `>= 0.40`;
   - expect `moveDynamicObject({ world: trapWorld, object: result.object, displacement: vec3(0, 0.01, 0) }).blocked`
     to be `false` and `moveDynamicObject({ ..., displacement: vec3(0.01, 0, 0) }).blocked` to be `false` (both checked
     against the current code with the pushed pose).
2. `it("returns the same object when nothing overlaps")`: player at (0, 0, 0) in `trapWorld`; expect
   `result.kind === "unchanged"` and `result.object` `toBe` the input object.
3. `it("pushes a body sitting exactly on a vertex toward the cell centroid")`: player at v1 = (−7.5, −3.75) in
   `trapWorld`; expect `kind` `"pushed"`, `testCellCollision` not blocked, and distance `>= 0.40` from every vertex.
4. `it("leaves no body blocked for legal rest poses near the corners")`: rest poses are
   `vertex + r·(cos θ, sin θ)` for every vertex of the rest footprint, r in {0.41, 0.45, 0.5, 0.6} and θ = k·10°,
   k = 0..35, keeping only points with |x| ≤ 7.5 and |y| ≤ 7.5 that are not blocked at rest. Target states:
   `trap`, `{ ...rest, skewXMeters: 15 }` and `{ ...rest, skewXMeters: 30, depthMeters: 30 }`. Map each pose,
   depenetrate in the target world, and expect `kind` not to be `"failed"` and `testCellCollision` not blocked. A
   prototype of the step 1-2 algorithm gave 400 `"unchanged"`, 80 `"pushed"` and nothing else over these 480 poses.
   If you get any `"sampled"` results, keep the test as written but list the count under `### Uncertain`.
5. `it("pushes a body out of a wall along the inward normal")`: a spec with one cell `"room"`, height 2, base
   (−1,−1), (1,−1), (1,1), (−1,1), no portals (copy `singleRoom()` from `tests/movement/moveDynamicObject.test.ts:426-437`
   and its `squareRoomBase`); body radius 0.1, height 1 (`simpleCollisionCylinder(0.1, 1)`), at (−0.95, 0, 0.5);
   expect `"pushed"` and x = −0.899999 to 1e-9, y = 0.
6. `it("pushes a body out of a corner in one call")`: same room, body at (−0.95, −0.95, 0.5); expect x and y both
   −0.899999 to 1e-9.
7. `it("ignores zones when asked")`: the trap-mapped player from test 1 with `{ ignoreForbiddenZones: true }`; expect
   `"unchanged"`.

### `tests/runtime/torusSkewDeformation.test.ts`

8. `it("rejects a torus footprint that is not centred")`: spec
   `{ ...torus, cells: [{ ...torus.cells[0], baseVertices: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 15 }, { x: 0, y: 15 }] }] }`;
   expect `createTorusSkewDeformationFamily().canApplyToSpec(spec)` to be `false` and
   `validateTorusSkewBaseSpec(spec)` to contain a string matching `/centred parallelogram/`. Also expect
   `createInitialWorldDeformationState(spec)` (from `src/runtime/worldGeometryDeformationFamilies`) to equal
   `{ kind: "static-world" }`.
9. `it("rejects a rotated torus footprint")`: rotate the shipped square by 30° about the origin (x' = x cos − y sin,
   y' = x sin + y cos); expect `canApplyToSpec` `false`.
10. `it("still accepts the shipped torus worlds")`: `canApplyToSpec(torus)` and `canApplyToSpec(torusModuli)` are `true`.
11. `it("steps width, skew and depth together and reaches a wider target")`: current = `rest`, target
    `{ ...rest, widthMeters: 40, depthMeters: 20 }`, `maxStepMeters: 0.08`. Loop `state = nextTorusSkewStep(state, target, options)`
    at most 1000 times until `deformationStatesEqual(state, target)`; expect no throw, that it ends equal to the
    target, and that each step's `Math.hypot(Δw, Δa, Δb)` is `<= 0.08 + 1e-12`. Expected step count: the distance is
    hypot(25, 0, 5) = 25.495, so 319 steps.
12. `it("stays in range on the boundary b = w/2 while the width changes")`: current
    `{ ...rest, widthMeters: 15, depthMeters: 7.5, skewXMeters: 0 }`, target
    `{ ...rest, widthMeters: 20, depthMeters: 10, skewXMeters: 0 }`, `maxStepMeters: 0.08`; same loop; expect no throw
    and the final state equal to the target.

### `tests/runtime/worldGeometrySession.test.ts`

13. `it("reaches a target with a different width without recording an error")`: use `createTestSession(client, { maxStepMeters: 1 })`
    with `createDeferredBuildClient()`; `session.setTarget({ kind: "torus-skew", cellId: "torus-room", widthMeters: 40, depthMeters: 20, skewXMeters: 0 })`.
    Expect `session.state.lastError` to be `undefined` right after `setTarget`. Then loop: take the last entry of
    `client.requests`, `client.resolve(request.requestId, buildWorldGeometrySnapshotForRequest(request))`,
    `await flushPromises()`, `session.pollReadySnapshot()`; after each round expect `session.state.lastError` to be
    `undefined`; stop when `deformationStatesEqual(session.state.current, session.state.target)` (at most 40 rounds;
    the distance hypot(25, 0, 5) = 25.5 needs 26 steps). Expect `session.state.current.widthMeters` to be 40. With
    the old code this test fails right after `setTarget`: the first old step is (w, a, b) = (40, 0, 16), and
    `lastError` is "World deformation B must be between 20m and 80m; received 16.". Import `deformationStatesEqual`
    from `src/runtime/worldGeometryDeformations`.

Commands:

```bash
npx vitest run tests/movement/depenetrateDynamicObject.test.ts
npx vitest run tests/runtime/torusSkewDeformation.test.ts tests/runtime/worldGeometryDeformations.test.ts tests/runtime/worldGeometrySession.test.ts tests/runtime/worldGeometryRuntimeTransforms.test.ts
npm run docs:generate
npm run typecheck
npm test
```

Manual check (optional, record the result under `### Checks`): `npm run dev`, open the `torus-moduli` world, stand
about 0.45 m from a corner, use the computer to set A = 30, B = 8 (the UI uses whole meters), and check you can walk
away after the deformation.

Risky points:

- If test 4 finds `"failed"` poses, do not loosen the test. Increase `maxDepenetrationRounds` to 8 first; if that does
  not help, keep 4, mark the test `it.skip` with a comment, and describe the failing poses under `### Uncertain`.
- If an existing test outside the files above fails because a torus footprint in it is not centred (search with
  `grep -rn "torus-room" tests`), centre that footprint the same way as in step 7 and list it under `### Deviations`.
- If `tests/docs/documentation.test.ts` reports a layering violation for the new import in
  `src/world-objects/*.ts`, check `scripts/docs/lib.mjs` `layers`: `world-objects` may import `movement`, so it
  should not. If it does, record the message under `### Uncertain` and do not edit `scripts/docs/layering-baseline.json`.

## Do not

- Do not change how headings are transported (`transformRigidPoseWithMap`, the test "maps a vertical-lattice heading
  into the skewed heading"). That is issue 53 item 2, [job 07](07_forward_heading_convention.md).
- Do not change `moveDynamicObject` or `testCellCollision` behaviour (swept tests, corner handling): jobs 13 and 14.
- Do not remove forbidden zones at flat vertices: [job 18](18_vertex_classes_and_gluing_validation.md).
- Do not make the commit incremental or change the rebuild pipeline: [job 30](30_deformation_rebuild_pipeline.md).
- Do not change the step units or the session's scheduling: job 30 / issue 55.
- Do not generalise the lattice frame to rotated or offset footprints: [job 35](35_torus_family_as_teichmuller_space.md).
- Do not touch floor UVs: [job 10](10_floor_texture_in_lattice_coordinates.md).
- Do not edit `scripts/docs/layering-baseline.json`.

## Done when

- [ ] Tests 1-13 above exist and pass; `npm run typecheck` and `npm test` pass.
- [ ] `npm run docs:generate` was run and `_docs/generated/*` changes are committed.
- [ ] `_docs/MATHEMATICAL_MODEL.md` §9 is updated (step 9).
- [ ] Issue 53. It closes only when **both** this job and [job 07](07_forward_heading_convention.md) are done.
  - If job 07 is **not** done yet: do not move the issue. Add a dated entry at the top of its "Status update" area,
    for example `## Status update <date> (job 09)`, saying: items 1, 3 and 4 are fixed by job 09 (commit hashes), with
    the test names that cover them; item 2 (heading) is still open and is job 07. Change its `Status:` line to
    `open; items 1, 3, 4 fixed by job 09 on <date>; item 2 waits for job 07.`
  - If job 07 **is** done (it is in `.agents/jobs/_done/`): move the issue to `_issues/_closed/`, set
    `Status: closed on <date>.`, fix its relative links (they gain one `../`, see
    `_issues/_closed/74_frame_loop_error_containment_and_dispose_leaks.md`), and add `## Outcome` (what changed) and
    `## Closing evidence` (test files and test names for every acceptance criterion, from both jobs).
- [ ] Move this file to `.agents/jobs/_done/09_deformation_commit_safety.md`, fix its relative links (one more `../`),
  and set `Status: done on <date>.` if `### Uncertain` is empty, otherwise `Status: done, needs review on <date>.`
- [ ] Add a `## Report` section at the end of this file with these subsections (write "None." where empty):
  - `### Done`: what changed, file by file, with commit hashes;
  - `### Deviations`: where the work differs from the steps, and why;
  - `### Uncertain`: decisions or results you are not sure of, and what would confirm them;
  - `### Not done`: anything skipped, and why;
  - `### Checks`: every command you ran and its result, including failures.
- [ ] Update row 09 in the queue table of `.agents/jobs/README.md`: link to `_done/09_deformation_commit_safety.md`,
  strike the title and add "(done)", as row 01 does.
- [ ] Commit with a message like `Depenetrate bodies after torus deformation commits; check the base frame; step width (job 09)`.
  Do not push unless asked.
