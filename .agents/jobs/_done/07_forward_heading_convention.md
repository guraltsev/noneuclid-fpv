# Job 07 - One forward-heading convention: marmot heading and deformation transport

Status: done on 2026-10-29.
Resolves: issue [64](../../../_issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md) item 2 (marmot
heading and zone freeze), issue [53](../../../_issues/53_torus_deformation_commit_transport_defects.md) item 2 (heading
transport). Both issues stay open after this job; see "Done when".

## Goal

"Forward" for every yaw pose in this project is the body +y axis, `R·e_y = (-sin yaw, cos yaw)`. Make the code agree
everywhere:

1. The geodesic marmot walks in its authored velocity direction (today it walks along the mirror image `(-vx, vy)`).
2. The marmot no longer freezes forever at the first forbidden zone (portal-junction cylinder) it hits.
3. A torus deformation commit transports the forward vector `R·e_y` of every pose, not the right vector `R·e_x`.
   Live marmots and authored marmot specs then agree after a commit.
4. The geodesic cannon aim yaw, which is a *direction angle* (aim along `(cos yaw, sin yaw)`), keeps its current,
   already-correct transport.

## Depends on

Nothing. Jobs 05 and 06 touch other files and can land before or after this one.

## Before you start

Read these (line numbers are for commit `e094b82`; they may drift a little):

- `src/math/rigidTransform3.ts:113-131` - `yawRigidTransform3`, the rotation convention.
- `src/world-objects/geodesicMarmot.ts` - whole file (264 lines). Key parts: header comment line 4, `update` 140-157,
  `transformGeometry` 169-189, `createRuntimeCreatureObject` 214-233, `yawFromVelocity` 257-260.
- `src/runtime/worldGeometryDeformations.ts:137-244` (`transformPoseWithCellMaps`, `transformRigidPoseWithMap`,
  `transformPositionedObjectSpecWithMap`, `transformStartingPositionWithMap`) and `:429-436` (`yawFromMappedHeading`,
  `yawFromRigidPose`).
- `src/render/three/runtimeSceneUtils.ts:1-14` (imports) and `:154-166` (`yawFromPose`, `transformYawWithMap`).
- `src/render/three/createThreeApp.ts:1596-1692` (`transformPlayerForGeometryCommit`,
  `transformRuntimeObjectsForGeometryCommit`, `transformGeodesicCannonForGeometryCommit`). Read only; do not edit.
- `src/world-objects/simpleGeoCreature.ts:220-282` (`update` moves along body +y; `transformGeometry`). Read only.
- `src/movement/moveDynamicObject.ts:82-180` (what a blocked result returns). Read only.
- `src/runtime/deformations/torusSkewDeformation.ts:137-170` (`createTorusSkewCellDeformationMaps`) and `:338-350`
  (`torusLatticeFrame`). Read only.
- Tests: `tests/world-objects/geodesicMarmot.test.ts` (whole file), `tests/runtime/torusSkewDeformation.test.ts:1-20`,
  `:68-77`, `:119-146`, `:169-177`, `tests/runtime/worldGeometryRuntimeTransforms.test.ts:14-57`.
- `_docs/MATHEMATICAL_MODEL.md` §9 (lines 334-362) and §11 "Yaw conventions" (lines 393-396).

Baseline, in Windows Git Bash from the repository root:

```sh
npm run typecheck
npm test
```

Both must pass before you change anything. If they do not, write the failures under `### Checks` in the Report and
continue; do not fix unrelated failures. Untracked files under `tests/scratch/` (if any) belong to someone else: do
not edit or commit them; if they fail, note it in the Report.

Run one test file with `npx vitest run tests/world-objects/geodesicMarmot.test.ts` (any path works the same way).

## Background

### Rotation convention

`src/math/rigidTransform3.ts:113`:

```ts
export function yawRigidTransform3(radians: number, translation: Vec3 = vec3(0, 0, 0)): RigidTransform3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { rotation: { m00: cos, m01: -sin, m02: 0, m10: sin, m11: cos, m12: 0, m20: 0, m21: 0, m22: 1 }, translation };
```

So `R(yaw) = [[c, -s], [s, c]]` (counterclockwise). The columns are:

- right vector `R·e_x = (m00, m10) = (cos yaw, sin yaw)`;
- forward vector `R·e_y = (m01, m11) = (-sin yaw, cos yaw)`.

The yaw of a pose is read back as `atan2(m10, m00)` (`yawFromRigidPose`, `yawFromPose`).

Forward is `R·e_y` for: the player (`src/movement/movePlayer.ts:130-145`, `resolveLocalDisplacement` maps local
`(0, 1)` to `(-sin, cos)`), the marmot (`geodesicMarmot.ts:146` steps by `transformDirection3(pose, (0, speed·dt, 0))`),
geo creatures (`simpleGeoCreature.ts:236`, local `(lateral, forward, vertical)`), and placed flags
(`src/world-objects/placedFlags.ts:264`, "front (local +y)").

**Exception - the geodesic cannon.** `aimYawRadians` and `geodesicEmitterYawRadiansById` are direction angles: the beam
goes along `(cos yaw, sin yaw)`. Evidence: `src/render/three/geodesicCannonTools.ts:244`
`const aimYawRadians = Math.atan2(horizontalForward.y, horizontalForward.x);` and `src/render/three/aimTarget.ts:927-935`
(`handleDirection = { x: Math.cos(yawRadians), y: Math.sin(yawRadians) }`). For the cannon, transporting
`(cos, sin) = R·e_x` is therefore *correct*. Issue 53 lists the cannon as affected; that is wrong, and this job must
keep the cannon's numbers unchanged.

### The marmot mirror (issue 64 item 2)

`src/world-objects/geodesicMarmot.ts:257-260`:

```ts
// Known mirrored convention: a yaw of psi heads towards (-sin psi, cos psi), so atan2(vx, vy) walks towards (-vx, vy). ...
function yawFromVelocity(velocity: GeodesicMarmotObjectSpec["velocity"]): number {
  return Math.atan2(velocity.x, velocity.y);
}
```

With `yaw = atan2(vx, vy)`, `sin yaw = vx/|v|`, `cos yaw = vy/|v|`, so forward is `(-vx, vy)/|v|`. Authored velocity
`(1, 0)` walks west. The fix is `yaw = atan2(-vx, vy)`: then forward = `(-sin, cos) = (vx, vy)/|v|`.

### The zone freeze (issue 64 item 2)

`geodesicMarmot.ts:146-153` calls `moveDynamicObject` without `ignoreForbiddenZones`. A forbidden-zone block returns
the unchanged object (`moveDynamicObject.ts:113-114` for a refused crossing, `:133-154` inside the cell; only a wall
block moves the object). The heading never changes, so every later frame is blocked again. Verified by a prototype:
a marmot at `(5, 5, 0)` with velocity `(1, 1)` in the `torus` world (with the yaw fix) moves on only about 2% of 6000
frames at dt = 1/60 s; with the reflection rule in Step 4 it moves on 99.9%.

### Heading transport at a deformation commit (issue 53 item 2)

`src/runtime/worldGeometryDeformations.ts:156-165`:

```ts
export function transformRigidPoseWithMap(pose: RigidTransform3, map: CellDeformationMap): RigidTransform3 {
  const translation = map.mapPoint(pose.translation);
  const heading = map.mapDirection(vec3(pose.rotation.m00, pose.rotation.m10, 0), pose.translation);
  const yawRadians = yawFromMappedHeading(heading);   // atan2(h.y, h.x) at :429-432
  return yawRigidTransform3(yawRadians, translation);
}
```

It maps the right vector `(m00, m10)`. Callers: `transformPoseWithCellMaps` (`:138-151`), which is used for the player
(`createThreeApp.ts:1599`), placed flags (`createThreeApp.ts:1636`), live marmots (`geodesicMarmot.ts:170-171`), geo
creatures (`simpleGeoCreature.ts:262-263`) and `transformStartingPositionWithMap` (`:226`); also
`transformPositionedObjectSpecWithMap` (`:175`) and `transformYawWithMap` (`runtimeSceneUtils.ts:165`, used only for the
cannon at `createThreeApp.ts:1675` and `:1680`).

`transformPositionedObjectSpecWithMap` (`:187-210`) has a special marmot branch that transports the *real* (mirrored)
walking direction `(-vx, vy)`. After the yaw fix the real direction is `v` itself, so that branch simplifies.

### The math

Let `A` be the linear part of the cell map (`map.mapDirection`). For the torus family going from `(a, b)` to
`(a', b')` with fixed width `w`, `A = [u' v'][u v]^-1` with `u = (w, 0)`, `v = (a, b)`. With `w = b = b' = 15` and
`a = 0`:

- `a' = 2`: `A = [[1, 2/15], [0, 1]]`.
- `a' = 6`: `A = [[1, 6/15], [0, 1]] = [[1, 0.4], [0, 1]]`.
- `a' = 15`: `A = [[1, 1], [0, 1]]`.

New rule for a pose with yaw `ψ`:

```text
f  = R(ψ)·e_y = (-sin ψ, cos ψ)
f' = normalize(A·f)                (horizontal part only; z = 0)
ψ' = atan2(-f'_x, f'_y)            so that R(ψ')·e_y = f'
```

Check: `R(ψ')·e_y = (-sin ψ', cos ψ')`. With `ψ' = atan2(-f'_x, f'_y)` and `|f'| = 1`, `sin ψ' = -f'_x`,
`cos ψ' = f'_y`, so `R(ψ')·e_y = (f'_x, f'_y)`. Correct.

For a marmot spec, the velocity is transported the same way: `v' = |v| · normalize(A·v)`, `yaw' = atan2(-v'_x, v'_y)`.

Worked examples (use these numbers in tests):

| map | input yaw ψ | f = R·e_y | A·f | new yaw ψ' | old code gave |
| --- | --- | --- | --- | --- | --- |
| a 0→2 | 0 | (0, 1) | (2/15, 1) | `-atan(2/15)` = -0.13255153229667402 | 0 |
| a 0→15 | -π/2 | (1, 0) | (1, 0) | -π/2 (forward stays (1, 0)) | -3π/4 (forward (1, -1)/√2) |
| a 0→15 | 0 | (0, 1) ∝ v = (0, 15) | (1, 1) ∝ v' = (15, 15) | -π/4 | 0 |
| a 0→2 or 0→3 | π/2 | (-1, 0) | (-1, 0) | π/2 | atan2(15, a) |

Marmot spec example (map a 0→6): velocity `(0.6, 0.8)` (speed 1) maps to
`A·v = (0.6 + 0.8·0.4, 0.8) = (0.92, 0.8)`, normalized `(0.7546055221635046, 0.6561787149247866)`,
new yaw `atan2(-0.7546055221635046, 0.6561787149247866) = -0.8550527371260165`.

Cannon direction angle (unchanged behaviour, map a 0→15): yaw 0 → direction (1, 0) → (1, 0) → 0;
yaw π/2 → direction (0, 1) → (1, 1) → π/4.

### Authored marmot data

Verified with `grep -rni marmot` over the whole repository (excluding `node_modules`, `dist`, `.git`): **no world
script or example world contains a marmot.** `src/examples/*.world.js` and `src/authoring/exampleWorlds.ts` have no
`geodesic_marmot(...)` call and no `velocity`. The only marmot data in the repository is in tests:

- `tests/world-objects/geodesicMarmot.test.ts:14` - `velocity: { x: -2, y: 0 }` in "uses anchor crossing semantics and
  reparents on the same crossing frame". This encodes the mirror (it expects motion towards +x).
- `tests/runtime/torusSkewDeformation.test.ts:119-146` - "transports the marmot's real walking direction by the linear
  part of the map", which encodes the mirror in its comments and assertions.
- `tests/render-contract/cellRenderArchetypes.test.ts:127` - `velocity: { x: 0, y: 0 }`. Not affected (zero).

## Decisions

1. **Marmot heading.** Decided: fix `yawFromVelocity` to `Math.atan2(-velocity.x, velocity.y)` and negate the x
   component of every authored marmot velocity, so that every world looks exactly as before. Why: authored velocity
   then means what it says, and nothing visible changes. Since no world in the repository has a marmot, the "negate"
   part only touches the anchor-crossing test (`velocity: { x: -2, y: 0 }` becomes `{ x: 2, y: 0 }`). Alternative
   considered: fix the code and accept new directions for existing data (identical here, since there is no data), or
   keep the code and document the mirror (rejected: it is the defect).
2. **Zone response.** Decided: on a `"forbidden-zone"` block, reflect the marmot's forward vector off the nearest
   forbidden-zone cylinder of its current cell (specular reflection about the radial normal); if that would not turn
   it away, reverse it. Position is unchanged on that frame. Why: simple, local, deterministic, and keeps the marmot a
   straight-line walker between hits; the prototype gives 99.9% moving frames. Alternative considered: the geodesic
   continuation around the cone point (turn by `π - θ/2`, needs the cone angle from job 18) or the swept slide of
   job 13; both are larger changes.
3. **Which vector a pose transport carries.** Decided: `transformRigidPoseWithMap` transports the forward vector
   `R·e_y` for every caller (player, flags, creatures, marmots, starting position, static asset yaw). Why: forward is
   the project convention and the Teichmüller map then keeps a closed geodesic `(p, q)` closed. Alternative
   considered: a per-object choice of axis (rejected: more API for no current need).
4. **Cannon yaw.** Decided: `transformYawWithMap` keeps its current numbers by transporting the direction
   `(cos yaw, sin yaw)` itself, no longer through `transformRigidPoseWithMap`. Why: cannon yaws are direction angles
   (see Background). Alternative considered: convert cannon yaws to the forward convention (rejected: touches the
   cannon, aim and protractor code, out of scope).
5. **Protractor and other direction-angle yaws** (for example `ProtractorAngleObject.first.yawRadians`) are not
   touched; they are rebuilt or deleted after a commit by `applyGeometryCommitComputedObjectPolicy`.

## Steps

Do the steps in order. After each step run the named test file.

### Step 1 - Fix the marmot yaw

In `src/world-objects/geodesicMarmot.ts`:

1. Replace lines 257-260 with:

   ```ts
   // Forward is the body +y axis R·e_y = (-sin yaw, cos yaw); yaw = atan2(-vx, vy) makes it point along the velocity.
   function yawFromVelocity(velocity: GeodesicMarmotObjectSpec["velocity"]): number {
     return Math.atan2(-velocity.x, velocity.y);
   }
   ```

2. Rewrite the module header (line 4) so it no longer mentions the mirror. Say: the heading is
   `yaw = atan2(-vx, vy)`, so the marmot walks along its authored velocity; forward speed is `|v|` and constant; the
   marmot turns only when a forbidden zone blocks it (Step 4).

In `tests/world-objects/geodesicMarmot.test.ts`:

3. Line 14: change `velocity: { x: -2, y: 0 }` to `velocity: { x: 2, y: 0 }`. Do not change any expected number in
   that test (0.95, then room-b at -0.95): the marmot still walks towards +x.
4. Line 99-100: delete the "Skipped:" comment and change `it.skip(` to `it(` for "walks along its body +y axis in the
   authored velocity direction". Also remove the `as never` cast on line 102 if typecheck accepts it without the cast
   (it should: the object literal matches `CreateGeodesicMarmotOptions`).

Run `npx vitest run tests/world-objects/geodesicMarmot.test.ts`. Both tests must pass.

### Step 2 - Transport the forward vector

In `src/runtime/worldGeometryDeformations.ts`:

1. In `transformRigidPoseWithMap` (line 161-162) map the forward column:

   ```ts
   const translation = map.mapPoint(pose.translation);
   // Forward is R·e_y = (m01, m11); carry it through the linear part of the map and rebuild the yaw from it.
   const forward = map.mapDirection(vec3(pose.rotation.m01, pose.rotation.m11, 0), pose.translation);
   const yawRadians = yawFromMappedForward(forward);
   return yawRigidTransform3(yawRadians, translation);
   ```

2. Rename `yawFromMappedHeading` (line 429) to `yawFromMappedForward` and change its body to:

   ```ts
   function yawFromMappedForward(forward: Vec3): number {
     const horizontal = normalizeVec3({ x: forward.x, y: forward.y, z: 0 });
     return Math.atan2(-horizontal.x, horizontal.y);
   }
   ```

3. Update the JSDoc of `transformRigidPoseWithMap` (line 153-155): "Maps a pose by sending its translation through
   mapPoint and its forward vector R·e_y (the rotation's second column, projected to the horizontal plane) through
   mapDirection; the new yaw makes R'·e_y parallel to the mapped forward vector. The result is a pure yaw rotation, so
   pitch and roll are discarded."

4. Replace the marmot branch of `transformPositionedObjectSpecWithMap` (lines 187-210, including the long
   "Convention note" comment) with:

   ```ts
   if (object.kind === "geodesci-marmot") {
     // The marmot walks along its velocity (yaw = atan2(-vx, vy)); carry the velocity direction by the map, keep the speed.
     const speedMetersPerSecond = Math.hypot(object.velocity.x, object.velocity.y);
     if (speedMetersPerSecond === 0) {
       return transformedObject as TObject;
     }
     const forward = normalizeVec3(map.mapDirection(vec3(object.velocity.x, object.velocity.y, 0), object.position));
     return {
       ...transformedObject,
       velocity: { x: forward.x * speedMetersPerSecond, y: forward.y * speedMetersPerSecond },
       yawRadians: Math.atan2(-forward.x, forward.y),
     } as TObject;
   }
   ```

   Note the kind string really is `"geodesci-marmot"` (misspelled in the codebase). Do not fix the spelling.

5. Update the JSDoc of `transformPositionedObjectSpecWithMap` (line 167-169): drop the "(see the convention note ...
   (-vx, vy) ...)" part; say that for marmots the velocity direction is mapped by the linear part, its speed kept, and
   the yaw re-derived as atan2(-v'x, v'y).

### Step 3 - Keep the cannon numbers

In `src/render/three/runtimeSceneUtils.ts`:

1. Replace the body of `transformYawWithMap` (line 160-166) with:

   ```ts
   /**
    * Maps a direction angle (the direction (cos yaw, sin yaw), as used by geodesic cannon aim and emitter yaws) at
    * atPoint through a deformation map's linear part and returns the angle of the image, atan2(d'.y, d'.x).
    */
   export function transformYawWithMap(yawRadians: number, atPoint: Vec3, map: CellDeformationMap): number {
     const direction = map.mapDirection(vec3(Math.cos(yawRadians), Math.sin(yawRadians), 0), atPoint);
     return Math.atan2(direction.y, direction.x);
   }
   ```

2. Fix the imports at the top: `import { vec3, type Vec3 } from "../../math/vec3";`, and import only
   `type CellDeformationMap` from `../../runtime/worldGeometryDeformations`. Remove `yawRigidTransform3` from the
   imports if nothing else in the file uses it (today line 165 is its only use). `npm run typecheck` reports unused
   imports (`noUnusedLocals` is on).

### Step 4 - Unfreeze the marmot at a zone

In `src/world-objects/geodesicMarmot.ts`:

1. Add the import `import type { CompiledPrismCell } from "../cell-complex/prismCells";`.
2. Add this private (not exported) helper near `yawFromVelocity`:

   ```ts
   /**
    * Returns the pose turned away from the nearest forbidden-zone cylinder of the cell: the forward vector is reflected
    * about the radial normal from the zone center to the marmot, or reversed if that reflection would not point away.
    */
   function turnAwayFromNearestForbiddenZone(pose: RigidTransform3, cell: CompiledPrismCell | undefined): RigidTransform3 {
     const forward = transformDirection3(pose, vec3(0, 1, 0));
     const position = pose.translation;
     let nearestCenter: { readonly x: number; readonly y: number } | undefined;
     let nearestDistance = Infinity;
     for (const column of cell?.singularityColumns ?? []) {
       const distance = Math.hypot(position.x - column.center.x, position.y - column.center.y);
       if (distance < nearestDistance) {
         nearestDistance = distance;
         nearestCenter = column.center;
       }
     }
     let next = { x: -forward.x, y: -forward.y };
     if (nearestCenter && nearestDistance > 1e-9) {
       const normalX = (position.x - nearestCenter.x) / nearestDistance;
       const normalY = (position.y - nearestCenter.y) / nearestDistance;
       const dot = forward.x * normalX + forward.y * normalY;
       if (dot < 0) {
         next = { x: forward.x - 2 * dot * normalX, y: forward.y - 2 * dot * normalY };
       }
     }
     return yawRigidTransform3(Math.atan2(-next.x, next.y), position);
   }
   ```

3. In `update` (lines 147-156) replace `state = result.object;` with:

   ```ts
   state = result.blocked && result.blockingReason === "forbidden-zone"
     ? { ...state, localPose: turnAwayFromNearestForbiddenZone(state.localPose, world.cellsById.get(state.cellId)) }
     : result.object;
   ```

   Keep the following `syncRegistryObject`, `applyObjectPose` and `refreshCollisionWireframe` calls as they are.
4. Update the JSDoc of `update` in the `GeodesicMarmotRuntime` interface (line 53) to add: "when a forbidden zone
   blocks the step it turns away from the nearest zone (reflection) instead of moving".

If `world.cellsById.get(...)` has a different value type than `CompiledPrismCell`, use the type typecheck reports, and
note it under `### Deviations`.

### Step 5 - Documentation

In `_docs/MATHEMATICAL_MODEL.md`:

1. §9 (after the paragraph ending "and snaps when close.", line 350): add a paragraph:
   "**Headings.** Forward is the body +y axis $R e_y=(-\sin\psi,\cos\psi)$ for every yaw pose (player, creatures,
   marmots, flags). A commit carries the forward vector by the linear part $A$ of the cell map,
   $f'=A f/|A f|$, and rebuilds the yaw as $\psi'=\operatorname{atan2}(-f'_x,f'_y)$
   (`src/runtime/worldGeometryDeformations.ts#transformRigidPoseWithMap`); a marmot's velocity becomes $|v|\,f'$.
   Because $A$ maps the lattice to the lattice, a body walking along a closed geodesic of class $(p,q)\in\mathbb Z^2$
   still walks along one of class $(p,q)$ after the commit. Geodesic cannon yaws are direction angles
   ($(\cos\psi,\sin\psi)$) and are carried as directions (`src/render/three/runtimeSceneUtils.ts#transformYawWithMap`)."
2. §11, the "Yaw conventions" bullet (lines 393-396): replace it with "**Yaw conventions.** Rigid-transform yaw is
   $\operatorname{atan2}(R_{10},R_{00})$ and forward is $R e_y$. The marmot derives its yaw from its velocity as
   $\operatorname{atan2}(-v_x,v_y)$, so it walks along $v$. Geodesic cannon and protractor yaws are direction angles
   along $(\cos\psi,\sin\psi)$."
3. Any `path#symbol` reference you write must name an existing exported symbol; the docs test checks them.

## Tests and checks

### Updated tests

1. `tests/world-objects/geodesicMarmot.test.ts`
   - "uses anchor crossing semantics and reparents on the same crossing frame": velocity `{ x: 2, y: 0 }`, same
     expectations (Step 1).
   - "walks along its body +y axis in the authored velocity direction": un-skipped (Step 1). It checks
     velocities `(1, 0)`, `(-0.5, 1)`, `(0.3, -0.8)` to 9 digits. This is the issue 64 acceptance "velocity (1, 0)
     gives Δx > 0".
2. `tests/runtime/torusSkewDeformation.test.ts`, "maps a vertical-lattice heading into the skewed heading" (line 68):
   rename to "maps the forward vector through the linear part of the lattice map" and replace lines 74-76 with:

   ```ts
   const pose = transformRigidPoseWithMap(yawRigidTransform3(0, vec3(0, 0, 0)), map);
   expect(Math.atan2(pose.rotation.m10, pose.rotation.m00)).toBeCloseTo(-Math.atan(2 / 15), 10);
   // New forward R'·e_y = (m01, m11) is parallel to A·e_y = (2/15, 1).
   expect(pose.rotation.m01 / pose.rotation.m11).toBeCloseTo(2 / 15, 10);
   ```

   Keep lines 69-72 (the `mapDirection` ratio check) as they are.
3. Same file, "transports the marmot's real walking direction by the linear part of the map" (line 119): rename to
   "transports the marmot velocity direction by the linear part of the map" and rewrite the body:

   ```ts
   const map = createTorusSkewCellDeformationMaps(skewState(0), skewState(6)).get("torus-room")!;
   const velocity = { x: 0.6, y: 0.8 };
   const marmot = {
     kind: "geodesci-marmot", id: "m", position: vec3(1, 2, 0), velocity,
     yawRadians: Math.atan2(-velocity.x, velocity.y),
   } as unknown as CellObjectSpec;
   const mapped = transformPositionedObjectSpecWithMap(marmot, map) as unknown as {
     velocity: { x: number; y: number }; yawRadians: number;
   };
   expect(mapped.velocity.x).toBeCloseTo(0.7546055221635046, 10);
   expect(mapped.velocity.y).toBeCloseTo(0.6561787149247866, 10);
   expect(mapped.yawRadians).toBeCloseTo(-0.8550527371260165, 10);
   // The body +y axis of the new yaw points along the new velocity.
   expect(-Math.sin(mapped.yawRadians)).toBeCloseTo(mapped.velocity.x, 10);
   expect(Math.cos(mapped.yawRadians)).toBeCloseTo(mapped.velocity.y, 10);
   ```

4. `tests/runtime/worldGeometryRuntimeTransforms.test.ts`:
   - "recomputes authored starting position from the deformed spec", line 22: expected yaw becomes
     `Math.PI / 2` (was `Math.atan2(15, 3)`). Forward of yaw π/2 is (-1, 0), and A maps (-1, 0) to itself.
   - "transforms placed sign pose and yaw through the dynamic-object map", lines 55-56: expected yaw becomes
     `Math.PI / 2` (was `Math.atan2(15, 2)`). Positions are unchanged.

### New tests

Add to `tests/runtime/torusSkewDeformation.test.ts` (it already has `skewState`, `vec3`, `yawRigidTransform3`,
`createTorusSkewCellDeformationMaps`, `transformRigidPoseWithMap`, `transformPositionedObjectSpecWithMap`):

5. "keeps a closed-geodesic forward vector closed under a full shear" (issue 53 acceptance):

   ```ts
   const map = createTorusSkewCellDeformationMaps(skewState(0), skewState(15)).get("torus-room")!;
   // Forward (1, 0) is yaw -π/2; A·(1, 0) = (1, 0).
   const east = transformRigidPoseWithMap(yawRigidTransform3(-Math.PI / 2, vec3(1, 2, 0)), map);
   expect(east.rotation.m01).toBeCloseTo(1, 10);
   expect(east.rotation.m11).toBeCloseTo(0, 10);
   // Forward ∝ v = (0, 15) is yaw 0; it must become ∝ v' = (15, 15), yaw -π/4.
   const north = transformRigidPoseWithMap(yawRigidTransform3(0, vec3(1, 2, 0)), map);
   expect(Math.atan2(north.rotation.m10, north.rotation.m00)).toBeCloseTo(-Math.PI / 4, 10);
   expect(north.rotation.m01).toBeCloseTo(Math.SQRT1_2, 10);
   expect(north.rotation.m11).toBeCloseTo(Math.SQRT1_2, 10);
   ```

6. "keeps geodesic cannon direction angles as directions": import `transformYawWithMap` from
   `../../src/render/three/runtimeSceneUtils`; with the a 0→15 map, `transformYawWithMap(0, vec3(0, 0, 0), map)` is
   close to `0` and `transformYawWithMap(Math.PI / 2, vec3(0, 0, 0), map)` is close to `Math.PI / 4` (10 digits).
   These are the same numbers the old code gave; the test guards that the cannon did not change.
7. "live and authored marmots get the same heading after a commit": import `createGeodesicMarmot` and
   `createGeodesicMarmotRuntimeObject` from `../../src/world-objects/geodesicMarmot` and `transformPoseWithCellMaps`
   from `../../src/runtime/worldGeometryDeformations`.

   ```ts
   const maps = createTorusSkewCellDeformationMaps(skewState(0), skewState(6));
   const spec = createGeodesicMarmot({ id: "m", position: { x: 1, y: 2, z: 0 }, velocity: { x: 0.6, y: 0.8 } });
   const live = transformPoseWithCellMaps(createGeodesicMarmotRuntimeObject(spec, "torus-room"), maps)!;
   const authored = transformPositionedObjectSpecWithMap(spec, maps.get("torus-room")!);
   const liveYaw = Math.atan2(live.localPose.rotation.m10, live.localPose.rotation.m00);
   expect(liveYaw).toBeCloseTo(-0.8550527371260165, 10);
   expect(authored.yawRadians!).toBeCloseTo(liveYaw, 10);
   ```

Add to `tests/world-objects/geodesicMarmot.test.ts` (it already has `stubAssets`, `createGeodesicMarmot`,
`createGeodesicMarmotRuntime`, `compileCellComplex`; add `import { torus } from "../../src/authoring/exampleWorlds";`):

8. "turns away from a forbidden zone instead of freezing" (issue 64 acceptance "moves on at least 90% of later
   frames"):

   ```ts
   const world = compileCellComplex(torus);
   // Walks diagonally into the zone at the corner (7.5, 7.5) of the 15 m torus room.
   const spec = createGeodesicMarmot({ id: "m", position: { x: 5, y: 5, z: 0 }, velocity: { x: 1, y: 1 } });
   const runtime = createGeodesicMarmotRuntime(spec, "torus-room", stubAssets());
   const frames = 1200;
   let movedFrames = 0;
   let sawTurn = false;
   for (let frame = 0; frame < frames; frame += 1) {
     const before = runtime.root.position.clone();
     runtime.update(world, 1 / 60);
     const after = runtime.root.position;
     if (after.distanceTo(before) > 1e-9) movedFrames += 1;
     if (after.x < before.x - 1e-9) sawTurn = true;
   }
   expect(movedFrames / frames).toBeGreaterThanOrEqual(0.9);
   expect(sawTurn).toBe(true);
   ```

   Expected: the marmot reaches the zone after about 127 frames, reverses, walks to the opposite corner, and reverses
   again; about 1198 of 1200 frames move. Without Step 4 only about 127 frames move and the test fails.
   `root.position.x` equals the game x (`worldPointToThree` maps (x, y, z) to (x, z, -y)).

   If this test fails after Step 4, print the marmot's cell and position at the blocked frames. If the cause is a
   block in the target cell of a portal crossing whose zone is not the nearest one in the source cell, record it under
   `### Uncertain` and try "reverse the heading" (`next = -forward`) for crossing-refused blocks
   (`result.crossedPortal` is false in both cases, so detect it by the anchor being within 1e-6 m of a portal side);
   record what you did.

### Commands

```sh
npx vitest run tests/world-objects/geodesicMarmot.test.ts
npx vitest run tests/runtime/torusSkewDeformation.test.ts
npx vitest run tests/runtime/worldGeometryRuntimeTransforms.test.ts
npm run docs:generate
npm run typecheck
npm test
```

`npm run docs:generate` is needed because exported JSDoc changed (`transformRigidPoseWithMap`,
`transformPositionedObjectSpecWithMap`, `transformYawWithMap`, `GeodesicMarmotRuntime`) and file line counts changed;
`tests/docs/documentation.test.ts` fails if `_docs/generated/` is stale.

## Do not

- Do not change the cannon, protractor or aim code (`geodesicCannonTools.ts`, `aimTarget.ts`,
  `geodesicCannonRenderer.ts`, protractor files). Only `transformYawWithMap`'s body changes, with the same results.
- Do not touch the XR slide or the player/object trap (issue 64 items 1 and 3): that is job 08.
- Do not add depenetration after a commit, the lattice-frame check or the width step (issue 53 items 1, 3, 4): job 09.
- Do not add swept collide-and-slide or make the marmot slide around zones or walls: job 13. The marmot may still
  slide along a wall into a corner and stop there; that is out of scope.
- Do not use the cone angle at a vertex for the turn (job 18 adds vertex classes).
- Do not rename the misspelled kind `"geodesci-marmot"`.
- Do not edit `src/examples/*.world.js`: none contains a marmot.

## Done when

- [ ] All tests listed above exist and pass; `npm run typecheck` and `npm test` pass.
- [ ] `_docs/MATHEMATICAL_MODEL.md` §9 has the "Headings" paragraph and §11 has the new "Yaw conventions" bullet.
- [ ] `npm run docs:generate` was run and the regenerated files under `_docs/generated/` are committed.
- [ ] Issue 64 is **not** closed (job 08 still owns items 1 and 3). Add to
  `_issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md`, directly under its "Status update
  2026-10-28" section, a section:

  ```markdown
  ## Status update <date> (job 07)

  Item 2 is fixed by job 07 (commit <hash>): `yawFromVelocity` is `atan2(-vx, vy)`, so the marmot walks along its
  authored velocity, and a forbidden-zone block reflects its heading off the nearest zone instead of freezing it.
  Tests: "walks along its body +y axis in the authored velocity direction" and "turns away from a forbidden zone
  instead of freezing" in `tests/world-objects/geodesicMarmot.test.ts`. Items 1 and 3 remain open (job 08).
  ```

  Change its `Status:` line to `Status: open; item 2 fixed by job 07 on <date>.`
- [ ] Issue 53 is **not** closed (job 09 owns items 1, 3, 4). Add to
  `_issues/53_torus_deformation_commit_transport_defects.md`, directly under its "Status update 2026-10-28" section:

  ```markdown
  ## Status update <date> (job 07)

  Item 2 is fixed by job 07 (commit <hash>): `transformRigidPoseWithMap` carries the forward vector R·e_y and rebuilds
  yaw as atan2(-f'x, f'y); marmot specs carry their velocity the same way. Correction to the evidence above: the
  geodesic cannon's yaws are direction angles along (cos, sin), so the old right-vector transport was correct for the
  cannon; `transformYawWithMap` now carries that direction explicitly and its results are unchanged. Test:
  "keeps a closed-geodesic forward vector closed under a full shear" in `tests/runtime/torusSkewDeformation.test.ts`.
  Items 1, 3 and 4 remain open (job 09).
  ```

  Change its `Status:` line to `Status: open; item 2 fixed by job 07 on <date>.`
- [ ] The job file is moved with `git mv .agents/jobs/07_forward_heading_convention.md .agents/jobs/_done/`. In the
  moved file, fix relative links (`../../_issues/...` becomes `../../../_issues/...`). Update every link to the old
  path: `.agents/jobs/README.md` (queue row), `_issues/53_...md` line 8 and `_issues/64_...md` line 7 (they become
  `../.agents/jobs/_done/07_forward_heading_convention.md`). Run `grep -rn "jobs/07_forward" --exclude-dir=node_modules .`
  to find any other.
- [ ] The queue row in `.agents/jobs/README.md` reads like job 01's:
  `| [07](_done/07_forward_heading_convention.md) | ~~One forward-heading convention: marmot heading and deformation transport~~ (done) | [64](...), [53](...) |  |`
  (issues still open, so keep their links to `../../_issues/...`).
- [ ] The job file has `Status: done on <date>.` if `### Uncertain` is empty, otherwise
  `Status: done, needs review on <date>.`, and a `## Report` section at the end with these subsections:
  - `### Done` - what changed, with files and commit hashes.
  - `### Deviations` - where the work differs from the Steps, and why.
  - `### Uncertain` - decisions or results you are not sure of, and what would confirm them.
  - `### Not done` - anything skipped, and why.
  - `### Checks` - the commands you ran and their results, including failures.
- [ ] One commit (or a few) whose subject names the job, for example
  "Use one forward-heading convention for marmots and deformation commits (job 07)", with a body in the style of
  commit `e094b82` (`git log -1 e094b82`). Do not push unless asked; if you push, the pre-push hook runs typecheck and
  tests.

Never stop to ask. If something in this job turns out to be wrong (a line number, a name, an expected number), do the
closest correct thing, and record it under `### Deviations` or `### Uncertain`.

## Report

### Done
- Commit e768cd2. `src/world-objects/geodesicMarmot.ts`: `yawFromVelocity` is `atan2(-vx, vy)`; new private
  `turnAwayFromNearestForbiddenZone` and `update` uses it on a `"forbidden-zone"` block; header and JSDoc updated.
- `src/runtime/worldGeometryDeformations.ts`: `transformRigidPoseWithMap` carries forward `(m01, m11)`;
  `yawFromMappedHeading` renamed `yawFromMappedForward`; marmot branch of `transformPositionedObjectSpecWithMap`
  simplified; JSDoc updated.
- `src/render/three/runtimeSceneUtils.ts`: `transformYawWithMap` transports `(cos yaw, sin yaw)` directly (cannon numbers unchanged).
- Tests: marmot velocity `{x: 2}`, un-skipped heading test, new zone-freeze test; torusSkewDeformation tests renamed/rewritten plus 4 new; two expected yaws in worldGeometryRuntimeTransforms changed to pi/2.
- Docs: MATHEMATICAL_MODEL.md section 9 "Headings" paragraph and section 11 yaw bullet; `_docs/generated/` regenerated.
- Issues 53 and 64 updated (left open); job moved to `_done/`, links and queue row updated (follow-up bookkeeping commit).
### Deviations
- Two commits: the code commit, then a bookkeeping commit, because the issue notes need the code commit's hash.
- The test edits the job prescribed were applied as written; the `as never` cast in the heading test was removed (typecheck accepts it).
### Uncertain
(none)
### Not done
(none)
### Checks
- Baseline: `npm run typecheck` and `npm test` passed (672 passed, 9 skipped).
- After changes: `npx vitest run` on the three named test files passed; `npm run typecheck` clean; `npm test` 677 passed, 8 skipped; `npm run docs:generate` then `npm run docs:check` ok.
