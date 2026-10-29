# Job 08 - XR slide replay and the player trapped by objects

Status: done on 2026-10-29.
Resolves: issue [64](../../../_issues/_closed/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md) items 1 (XR
slide replay) and 3 (player trapped by runtime objects). Item 2 belongs to job
[07](07_forward_heading_convention.md); issue 64 is closed only when both jobs are done (see "Done when").

## Goal

1. In XR, room-scale head motion that was already applied to the player must never be applied again. Today a wall
   slide is replayed every frame while the user holds their head against a wall, so the player glides along it.
2. A player who already overlaps a runtime object (a creature, a static asset, a flag) must be able to step away from
   it. Today every move that still overlaps is reverted.

## Depends on

Nothing in code. Job 07 only matters for closing issue 64 at the end.

## Before you start

Read these (line numbers are for commit `e094b82`; they may drift a little):

- `src/movement/moveDynamicObject.ts:43-65` (`MoveDynamicObjectResult`), `:82-180` (`moveDynamicObject`,
  `blockedResult`), `:252-275` (`resolveBlockedWallPosition`).
- `src/movement/movePlayer.ts` - whole file (about 150 lines): `MoveResult` at `:50-58`, `movePlayer` at `:64-116`.
- `src/movement/collision.ts:186-200` (`simpleCylinderIntersectsSimpleCylinder`), `:310-315`
  (`horizontalDistanceSquared`, private), `:51-58` (`SimpleCylinderBounds`).
- `src/render/three/xrPlayerRig.ts:50-67` (interface docs of `consumePhysicalInput` and `acceptPhysicalMove`),
  `:76-205` (`createXrPlayerRig`), `:214-239` (`globalHorizontalDeltaToPlayerLocal`, `rotateHorizontalDelta`).
- `src/render/three/vrLocomotion.ts:98-143` (`computePhysicalRoomScaleDisplacement`).
- `src/render/three/createThreeApp.ts:72-79` (movement imports), `:1303-1355` (movement phase: stick move, then the
  XR physical move), `:3330-3376` (`blockPlayerMoveAgainstRuntimeObjects`, `playerIntersectsRuntimeObject`,
  `createPlayerCollisionState`).
- `src/world-objects/runtimeObjectRegistry.ts:234-238` (`getPlayerBlockingObjectsInCell`), `:263`
  (`runtimeObjectToDynamicObjectState`).
- Tests: `tests/render-contract/vrLocomotion.test.ts:1-20` (imports), `:107-166` (two tests that build `MoveResult`
  literals), `tests/movement/movePlayer.test.ts:80-111`, `tests/movement/collision.test.ts:50-78` (`cylinder` helper).
- `_docs/MATHEMATICAL_MODEL.md` §5 (lines 156-187).

Baseline, in Windows Git Bash from the repository root:

```sh
npm run typecheck
npm test
```

Both must pass before you change anything. If they do not, write the failures under `### Checks` in the Report and
continue; do not fix unrelated failures. Untracked files under `tests/scratch/` (if any) belong to someone else: do
not edit or commit them; if they fail, note it in the Report.

Run one test file with `npx vitest run tests/render-contract/vrLocomotion.test.ts` (any path works the same way).

## Background

### Frames and the XR physical move

Cell-local frame: x right, y forward, z up, meters. Yaw is counterclockwise about +z.

Each XR frame, `createThreeApp.ts:1330-1354` does:

```ts
const physicalReferenceSpaceYawRadians = playerPose.yawRadians - (headLocalYawRadians ?? 0);
const physicalFrame = xrRig.consumePhysicalInput(effectiveHeadLocalMeters, playerPose.yawRadians, physicalReferenceSpaceYawRadians);
const physicalMoveResult = movePlayer({ world: activeWorld(), pose: playerPose, body: appState.playerBody,
  localDisplacement: physicalFrame.localDisplacement, yawDeltaRadians: 0, pitchDeltaRadians: 0, coordinateFrame: "global" });
const runtimeCollisionPhysicalMoveResult = blockPlayerMoveAgainstRuntimeObjects(playerPose, physicalMoveResult);
playerPose = runtimeCollisionPhysicalMoveResult.pose;
xrRig.acceptPhysicalMove(runtimeCollisionPhysicalMoveResult, effectiveHeadLocalMeters);
```

`consumePhysicalInput` (`xrPlayerRig.ts:170-190`) takes the head delta `h = head - previousAccepted` (horizontal only,
zero if there is no baseline or the step is a tracking jump), then
`world = rotateHorizontalDelta(h, referenceSpaceYaw)` and `local = globalHorizontalDeltaToPlayerLocal(world, playerYaw)`.
`movePlayer` rotates `local` back by the same `playerYaw` (`resolveLocalDisplacement`, yaw delta is 0), so the
cell-frame displacement it attempts is exactly

```text
d = R(referenceSpaceYaw) · h        and therefore        h = R(-referenceSpaceYaw) · d
```

(`R(θ)` = counterclockwise rotation, `rotateHorizontalDelta(v, θ)`). So head motion that corresponds to an applied
cell-frame displacement `a` is `R(-referenceSpaceYaw) · a`. (Issue 64's "Proposed change" writes
`R(-referenceSpaceYaw)·R(playerYaw)·applied`; that is for a player-local `applied`. Here `applied` is in the cell
frame, like `attemptedDisplacement`, so only `R(-referenceSpaceYaw)` is needed.)

### Bug 1: the slide is replayed (issue 64 item 1)

`xrPlayerRig.ts:191-199`:

```ts
acceptPhysicalMove(result, currentHeadLocalMeters) {
  if (!currentHeadLocalMeters) { return; }
  if (!result.blocked) { previousAcceptedHeadLocalMeters = currentHeadLocalMeters; }
},
```

A wall hit is resolved by sliding: `moveDynamicObject.ts:133-154` pushes the candidate back along the wall normal and
returns `blocked: true` with the *moved* object. The baseline is not advanced, so on the next frame the same head
delta is attempted again and the tangential part moves the player again. Numbers (verified with `movePlayer`): room
`[-1, 1]²` without portals, player radius 0.25 at `(0.7, 0)`, head held at `(+0.1, +0.1)` from the baseline. Frame 1
ends at `(0.749999, 0.1)` (blocked, slid). Today every later frame moves y by another 0.1 m (6 m/s at 60 Hz).

Neither `MoveDynamicObjectResult` nor `MoveResult` says how much of the displacement was applied.

### Bug 2: trapped inside a runtime object (issue 64 item 3)

`createThreeApp.ts:3330-3349`:

```ts
function blockPlayerMoveAgainstRuntimeObjects(previousPose, result) {
  if (!playerIntersectsRuntimeObject(result.pose)) { return result; }
  return { ...result, pose: { ...previousPose, yawRadians: result.pose.yawRadians, pitchRadians: result.pose.pitchRadians },
    blocked: true, crossedPortal: false, crossedPortalId: undefined };
}
```

`playerIntersectsRuntimeObject` (`:3351-3365`) tests the new pose against
`runtimeObjectRegistry.getPlayerBlockingObjectsInCell(pose.cellId)` with `simpleCylinderIntersectsSimpleCylinder`.
Creatures move on their own (`createThreeApp.ts:1424`) and can step into the player. Then a 4 cm step straight away
still overlaps (0.46 m < 0.5 m between centers) and is reverted, so the player is stuck. Both functions are closures
inside `createThreeApp` and cannot be unit-tested (it needs WebGL), so this job moves the rule into pure functions in
`src/movement/`.

## Decisions

1. **How the rig knows what was applied.** Decided: add a required field `appliedDisplacement: Vec3` to
   `MoveDynamicObjectResult` and `MoveResult`: the displacement actually applied, in the source cell frame, before any
   portal transform. Why: it is exact, cheap, and job 13 (swept slide) can fill it the same way. Alternative
   considered: keep the unapplied remainder as a persistent rig offset (equivalent, but more state in the rig).
2. **Baseline update.** Decided: when the physical move is not blocked, or there is no baseline yet, the baseline
   becomes the current head position (exactly as today). When it is blocked, the baseline advances by
   `R(-referenceSpaceYaw) · appliedDisplacement` (horizontal part; z is ignored by the rig). Why: unblocked behaviour
   stays identical; a blocked move keeps "pushing" with only the unapplied part. Alternative considered: always set
   the baseline to the current head (rejected: the head would drift away from the body through walls).
3. **Overlap rule.** Decided: a move is reverted only if, for some runtime body the new pose overlaps, the horizontal
   distance between the player's and the body's cylinder centers decreased by more than 1e-9 m compared with the
   previous pose. Bodies the player did not overlap before therefore still block as today (any new overlap has a
   smaller distance than a non-overlapping one). If the move crossed a portal (the previous pose is in another cell),
   any overlap reverts the move, as today. Why: this is issue 64's "does not increase penetration" rule,
   `|c_new - c_o| >= min(|c_old - c_o|, r + r_o)`, written in a form that needs no extra case. Alternative
   considered: depenetrate along the contact normal in the swept slide (job 13).
4. **Where the rule lives.** Decided: a pure function `moveIncreasesCylinderOverlap` in `src/movement/collision.ts`
   and a pure function `resolvePlayerMoveAgainstBodies` in `src/movement/movePlayer.ts`; `createThreeApp` only collects
   the obstacle bounds and calls it. Why: unit-testable without WebGL. Alternative considered: keep the closure and
   test nothing (rejected).
5. **A reverted move's applied displacement** is `(0, 0, 0)`, so in XR the head keeps pushing against the object
   (same as today's intent, documented at `xrPlayerRig.ts:64-66`).

## Steps

Do the steps in order. Run `npm run typecheck` after Steps 1 and 2; it lists every place that needs the new field.

### Step 1 - `appliedDisplacement` in `moveDynamicObject`

In `src/movement/moveDynamicObject.ts`:

1. Add `subVec3` to the import from `../math/vec3` (it exists: `src/math/vec3.ts:33`).
2. In `MoveDynamicObjectResult` (after `attemptedDisplacement`, line 54) add:

   ```ts
   /**
    * The part of the displacement actually applied, in meters in the start cell's frame (before any portal transform):
    * the full displacement for a free move or a crossing, the pushed offset for a wall slide, zero when the object stayed put.
    */
   readonly appliedDisplacement: Vec3;
   ```

3. Set it in every return:
   - crossing return (line 117-123): `appliedDisplacement: request.displacement`;
   - free move return (line 157-162): `appliedDisplacement: request.displacement`;
   - `blockedResult` (line 168-180): `appliedDisplacement: subVec3(object.localPose.translation, request.object.localPose.translation)`.
     This gives the slide offset for a wall slide and zero when `object` is `request.object`.
4. Extend the module header / function JSDoc only if they enumerate result fields (they do not today; leave them).

### Step 2 - `appliedDisplacement` in `movePlayer`

In `src/movement/movePlayer.ts`:

1. Add `readonly appliedDisplacement: Vec3;` to `MoveResult` (line 50-58) with a one-line doc comment: "Displacement
   actually applied, in the cell frame before any portal transform (see MoveDynamicObjectResult)."
2. World branch (line 93-101): `appliedDisplacement: result.appliedDisplacement`.
3. No-world branch (line 104-115): `appliedDisplacement: displacement`.
4. In `tests/render-contract/vrLocomotion.test.ts` the two `MoveResult` literals (around lines 111-120 and 141-150)
   now fail typecheck: add `appliedDisplacement: { x: 0, y: 0, z: 0 },` after `attemptedDisplacement` in both.

### Step 3 - Advance the XR baseline by the applied part

In `src/render/three/xrPlayerRig.ts`:

1. Next to `let previousAcceptedHeadLocalMeters` (line 81) add
   `let lastPhysicalReferenceSpaceYawRadians = 0;`.
2. In `reset()` (line 85-91) also set `lastPhysicalReferenceSpaceYawRadians = 0;`.
3. At the start of `consumePhysicalInput` (line 170) add
   `lastPhysicalReferenceSpaceYawRadians = referenceSpaceYawRadians;`.
4. Replace the body of `acceptPhysicalMove` (line 191-199) with:

   ```ts
   acceptPhysicalMove(result, currentHeadLocalMeters) {
     if (!currentHeadLocalMeters) {
       return;
     }

     if (!previousAcceptedHeadLocalMeters || !result.blocked) {
       previousAcceptedHeadLocalMeters = currentHeadLocalMeters;
       return;
     }

     // Blocked or slid: advance the baseline only by the head motion that was actually applied, so applied motion
     // is never replayed and only the unapplied remainder keeps pushing. Inverse of consumePhysicalInput's mapping.
     const appliedHead = rotateHorizontalDelta(result.appliedDisplacement, -lastPhysicalReferenceSpaceYawRadians);
     previousAcceptedHeadLocalMeters = vec3(
       previousAcceptedHeadLocalMeters.x + appliedHead.x,
       previousAcceptedHeadLocalMeters.y + appliedHead.y,
       currentHeadLocalMeters.z,
     );
   },
   ```

   `rotateHorizontalDelta` is a function declaration later in the same file, so it can be called here; `vec3` is
   already imported.
5. Rewrite the interface doc of `acceptPhysicalMove` (lines 63-66): "Updates the reference for the next
   `consumePhysicalInput`. An unblocked move (or the first call) takes `currentHeadLocalMeters` as the reference. A
   blocked move advances the reference only by the head motion matching `result.appliedDisplacement` (mapped back
   with the reference-space yaw of the last `consumePhysicalInput`), so applied motion is never replayed and the
   unapplied remainder keeps pushing against the obstacle."

### Step 4 - The overlap rule as pure functions

In `src/movement/collision.ts`, after `simpleCylinderIntersectsSimpleCylinder` (line 200), add:

```ts
/**
 * True if moving a body from `previous` to `next` makes things worse against some obstacle: `next` overlaps it
 * (simpleCylinderIntersectsSimpleCylinder) and either `previous` is undefined (no comparable earlier position, for
 * example after a portal crossing) or the horizontal center distance shrank by more than 1e-9 m. A body that already
 * overlaps an obstacle may therefore move away from it or keep its distance.
 */
export function moveIncreasesCylinderOverlap(
  previous: SimpleCylinderBounds | undefined,
  next: SimpleCylinderBounds,
  obstacles: readonly SimpleCylinderBounds[],
): boolean {
  for (const obstacle of obstacles) {
    if (!simpleCylinderIntersectsSimpleCylinder(next, obstacle)) {
      continue;
    }
    if (!previous) {
      return true;
    }
    const nextDistance = Math.sqrt(horizontalDistanceSquared(next.center, obstacle.center));
    const previousDistance = Math.sqrt(horizontalDistanceSquared(previous.center, obstacle.center));
    if (nextDistance < previousDistance - 1e-9) {
      return true;
    }
  }
  return false;
}
```

In `src/movement/movePlayer.ts`, add (and import `getDynamicObjectCollisionBounds`, `moveIncreasesCylinderOverlap`
and `type SimpleCylinderBounds` from `./collision`; `vec3` from `../math/vec3`):

```ts
/**
 * Reverts a player move that increases overlap with a runtime body (see moveIncreasesCylinderOverlap): the result
 * keeps the new yaw and pitch, but the position and cell of `previousPose`, is marked blocked, crosses no portal and
 * has a zero applied displacement. `obstaclesInCell(cellId)` returns the bounds of the bodies that block the player in
 * that cell. A move into another cell is compared without a previous position, so any overlap there reverts it.
 */
export function resolvePlayerMoveAgainstBodies(
  previousPose: PlayerPose,
  result: MoveResult,
  body: PlayerBody,
  obstaclesInCell: (cellId: string) => readonly SimpleCylinderBounds[],
): MoveResult {
  const bounds = (pose: PlayerPose) => getDynamicObjectCollisionBounds(playerPoseToDynamicObject(
    pose,
    simpleCollisionCylinder(body.radiusMeters, body.heightMeters, { x: 0, y: 0, z: body.heightMeters / 2 }),
  ));
  const nextBounds = bounds(result.pose);
  if (!nextBounds) {
    return result;
  }
  const previousBounds = previousPose.cellId === result.pose.cellId ? bounds(previousPose) : undefined;
  if (!moveIncreasesCylinderOverlap(previousBounds, nextBounds, obstaclesInCell(result.pose.cellId))) {
    return result;
  }
  return {
    ...result,
    pose: { ...previousPose, yawRadians: result.pose.yawRadians, pitchRadians: result.pose.pitchRadians },
    appliedDisplacement: vec3(0, 0, 0),
    blocked: true,
    crossedPortal: false,
    crossedPortalId: undefined,
  };
}
```

The player cylinder here is built exactly like `createPlayerCollisionState` in `createThreeApp.ts:3367-3376` and like
`movePlayer` itself (`:83-87`).

### Step 5 - Use it in the app shell

In `src/render/three/createThreeApp.ts`:

1. Replace `blockPlayerMoveAgainstRuntimeObjects` (line 3330-3349) with:

   ```ts
   function blockPlayerMoveAgainstRuntimeObjects(
     previousPose: PlayerPose,
     result: ReturnType<typeof movePlayer>,
   ): ReturnType<typeof movePlayer> {
     return resolvePlayerMoveAgainstBodies(previousPose, result, appState.playerBody, (cellId) =>
       runtimeObjectRegistry.getPlayerBlockingObjectsInCell(cellId).flatMap((object) => {
         const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(object));
         return bounds ? [bounds] : [];
       }));
   }
   ```

2. Delete `playerIntersectsRuntimeObject` (line 3351-3365); `grep -n playerIntersectsRuntimeObject src` must then
   find nothing. Keep `createPlayerCollisionState` (still used at lines 1419 and 2878).
3. Imports (line 72-77): import `resolvePlayerMoveAgainstBodies` from `../../movement/movePlayer` next to
   `movePlayer`; remove `simpleCylinderIntersectsSimpleCylinder` from the `../../movement/collision` import if
   typecheck reports it unused.
4. Leave the call sites (line 1324 and 1347) unchanged.

### Step 6 - Documentation

1. `_docs/MATHEMATICAL_MODEL.md` §5, after item 4 "Response" (line 182): add a paragraph:
   "**Applied displacement.** Every move reports the displacement it actually applied in the start cell's frame
   (`src/movement/moveDynamicObject.ts#MoveDynamicObjectResult`). The XR rig advances its head baseline by exactly
   that amount after a blocked move, so room-scale motion is never applied twice
   (`src/render/three/xrPlayerRig.ts#createXrPlayerRig`). **Runtime bodies.** After the cell test, the player is tested
   against the runtime objects of its cell; a move is reverted only if it overlaps one of them and brings the two
   centers closer (`src/movement/collision.ts#moveIncreasesCylinderOverlap`), so a player that is already inside a
   body can always step away."
2. Any `path#symbol` reference must name an existing exported symbol; the docs test checks them.

## Tests and checks

### Updated tests

1. `tests/render-contract/vrLocomotion.test.ts`: the two `MoveResult` literals get
   `appliedDisplacement: { x: 0, y: 0, z: 0 }` (Step 2). Their expectations do not change.

### New tests

2. `tests/movement/movePlayer.test.ts`, "reports the applied part of a wall slide":
   - world: one cell `room-a`, `heightMeters: 2`, base `[-1, -1], [1, -1], [1, 1], [-1, 1]` (as `{x, y}` objects),
     `portals: []` (copy the world from "uses the shared world-aware collision rules when a compiled world is
     provided", line 81-95);
   - pose `{ cellId: "room-a", position: { x: 0.7, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 }`;
   - `movePlayer({ world, pose, localDisplacement: { x: 0.1, y: 0.1, z: 0 }, yawDeltaRadians: 0, pitchDeltaRadians: 0, coordinateFrame: "global" })`;
   - expect `blocked` true, `pose.position.x` close to `0.749999` (5 digits), `appliedDisplacement.x` close to
     `0.049999` (5 digits), `appliedDisplacement.y` close to `0.1` (9 digits), `attemptedDisplacement` equal to
     `{ x: 0.1, y: 0.1, z: 0 }`.
   - Also, from `createDefaultPlayerPose("room-a")` (imported already), a free move of `{ x: 0.2, y: 0, z: 0 }` has
     `appliedDisplacement` close to `(0.2, 0, 0)` and `blocked` false.
3. `tests/movement/collision.test.ts`, "moveIncreasesCylinderOverlap allows leaving an overlap but not deepening it"
   (import `moveIncreasesCylinderOverlap`; use the file's `cylinder(x, y, z, radius, halfHeight)` helper). Obstacle
   `o = cylinder(0, 0, 0.8, 0.25, 0.8)`, player cylinders radius 0.25, half height 0.8, z 0.8:
   - previous x 0.3 (overlapping), next x 0.34 → `false` (moves away);
   - previous x 0.3, next x 0.26 → `true` (moves in);
   - previous x 0.3, next `cylinder(0, 0.3, 0.8, 0.25, 0.8)` (same distance 0.3) → `false`;
   - previous x 0.6 (not overlapping), next x 0.45 → `true` (new overlap);
   - previous `undefined`, next x 0.45 → `true`; previous `undefined`, next x 0.6 → `false`.
4. `tests/movement/movePlayer.test.ts`, "lets a player inside a runtime body step away but not further in" (issue 64
   acceptance "start overlapping a static body and move away; the first frame increases separation"):
   - world: one cell `room-a`, `heightMeters: 2`, base `[-2, 2]²`, `portals: []`;
   - obstacle bounds `{ center: { x: 0, y: 0, z: 0.5 }, radius: 0.25, halfHeight: 0.5 }`; `body =
     { radiusMeters: 0.25, heightMeters: 1.6 }`; pose at `(0.3, 0, 0)`, yaw 0 (centers 0.3 m apart: overlapping);
   - away: `result = movePlayer({ world, pose, body, localDisplacement: { x: 0.04, y: 0, z: 0 }, ... })`, then
     `resolvePlayerMoveAgainstBodies(pose, result, body, () => [obstacle])`: position x close to `0.34`,
     `blocked` false;
   - in: same with `{ x: -0.04, y: 0, z: 0 }`: position x is `0.3`, `blocked` true, `appliedDisplacement` equals
     `{ x: 0, y: 0, z: 0 }`.
5. `tests/render-contract/vrLocomotion.test.ts`, "does not replay a wall slide while the head is held against the
   wall" (issue 64 acceptance "a constant head offset into a wall gives zero body motion on frames 2..N"). Import
   `type PlayerPose` from `../../src/movement/playerPose`; `compileCellComplex`, `movePlayer` and
   `createXrPlayerRig` are already imported.

   ```ts
   const THREE = await import("three");
   const rig = createXrPlayerRig(new THREE.PerspectiveCamera());
   const world = compileCellComplex({ cells: [{ id: "room-a", heightMeters: 3, portals: [],
     baseVertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] }] });
   let pose: PlayerPose = { cellId: "room-a", position: { x: 0.7, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 };
   const step = (head: { x: number; y: number; z: number }) => {
     const frame = rig.consumePhysicalInput(head, pose.yawRadians, 0);
     const result = movePlayer({ world, pose, localDisplacement: frame.localDisplacement,
       yawDeltaRadians: 0, pitchDeltaRadians: 0, coordinateFrame: "global" });
     rig.acceptPhysicalMove(result, head);
     pose = result.pose;
   };
   step({ x: 0, y: 0, z: 1.6 });            // sets the baseline, no motion
   const held = { x: 0.1, y: 0.1, z: 1.6 }; // diagonal into the wall x = 1
   step(held);                               // frame 1: slides to (0.749999, 0.1)
   expect(pose.position.x).toBeCloseTo(0.749999, 5);
   expect(pose.position.y).toBeCloseTo(0.1, 9);
   for (let frame = 2; frame <= 10; frame += 1) {
     const before = pose.position;
     step(held);
     expect(Math.hypot(pose.position.x - before.x, pose.position.y - before.y)).toBeLessThan(1e-9);
   }
   ```

   Today this fails on frame 2 (y grows by 0.1 per frame). If it still fails after Step 3, log the baseline
   (temporarily) and check that `appliedDisplacement` of frame 1 is about `(0.049999, 0.1, 0)`; record what you find
   under `### Uncertain` if you had to change the test.
6. Optional, same file: the same test with `referenceSpaceYaw = Math.PI / 2` passed to `consumePhysicalInput` and
   the head offset rotated accordingly (`held = { x: 0.1, y: -0.1, z: 1.6 }` gives cell-frame `(0.1, 0.1)`). Add it
   if it passes; if it does not, record it under `### Uncertain` - it would mean the inverse mapping in Step 3 is
   wrong.

### Commands

```sh
npx vitest run tests/movement/collision.test.ts
npx vitest run tests/movement/movePlayer.test.ts
npx vitest run tests/movement/moveDynamicObject.test.ts
npx vitest run tests/render-contract/vrLocomotion.test.ts
npm run docs:generate
npm run typecheck
npm test
```

`npm run docs:generate` is needed: exported symbols and JSDoc changed (`MoveDynamicObjectResult`, `MoveResult`,
`moveIncreasesCylinderOverlap`, `resolvePlayerMoveAgainstBodies`, `XrPlayerRig`) and file line counts changed;
`tests/docs/documentation.test.ts` fails if `_docs/generated/` is stale. Every new exported function needs a JSDoc
comment (the docs test checks this).

## Do not

- Do not change how the wall slide itself works or add swept collide-and-slide, corner handling, or runtime bodies as
  obstacles inside `moveDynamicObject`: that is job 13 (issues 61, 62, 63).
- Do not depenetrate bodies after a deformation commit: job 09.
- Do not touch the marmot or heading code: job 07.
- Do not change `computePhysicalRoomScaleDisplacement` or the tracking-jump rule.
- Do not change the creatures' own obstacle checks (`simpleGeoCreature.ts`).

## Done when

- [ ] All tests above exist and pass; `npm run typecheck` and `npm test` pass.
- [ ] `_docs/MATHEMATICAL_MODEL.md` §5 has the "Applied displacement" / "Runtime bodies" paragraph.
- [ ] `npm run docs:generate` was run and the regenerated `_docs/generated/` files are committed.
- [ ] Issue 64:
  - **If job 07 is done** (`.agents/jobs/_done/07_forward_heading_convention.md` exists and issue 64 has a
    "Status update ... (job 07)" section): close issue 64.
    1. `git mv _issues/64_mover_integration_bugs_xr_slide_marmot_heading_object_trap.md _issues/_closed/`.
    2. In the moved file set `Status: closed on <date>.`, change the `Jobs:` line to link
       `../../.agents/jobs/_done/07_forward_heading_convention.md` and
       `../../.agents/jobs/_done/08_xr_slide_replay_and_object_trap.md`, change the link to issue 53 to
       `../53_torus_deformation_commit_transport_defects.md`, and add after the header:

       ```markdown
       ## Outcome

       Fixed by jobs 07 and 08. Item 1: moves report `appliedDisplacement`, and the XR rig advances its head
       baseline by the applied part after a blocked move, so a held head offset no longer replays a wall slide.
       Item 2: see job 07. Item 3: a move that overlaps a runtime body is reverted only if it brings the centers
       closer (`moveIncreasesCylinderOverlap`, `resolvePlayerMoveAgainstBodies`), so the player can step out.

       ## Closing evidence

       - `tests/render-contract/vrLocomotion.test.ts`: "does not replay a wall slide while the head is held against the wall".
       - `tests/movement/movePlayer.test.ts`: "reports the applied part of a wall slide", "lets a player inside a runtime body step away but not further in".
       - `tests/movement/collision.test.ts`: "moveIncreasesCylinderOverlap allows leaving an overlap but not deepening it".
       - Job 07's tests for item 2 (listed in its status update).
       - Not covered: the wiring inside `createThreeApp` (needs WebGL).
       ```

    3. Fix every link to the old path: run
       `grep -rn "64_mover_integration" --exclude-dir=node_modules --exclude-dir=.git .`. Known places:
       `.agents/jobs/README.md` (rows 07 and 08: `../../_issues/_closed/64_...`), the moved job files 07 and 08
       (`../../../_issues/_closed/64_...`), `_issues/50_deep_code_audit_2026_10_09_index.md:81`
       (`_closed/64_...`), `_issues/_closed/17_stage_08_webxr_vr_locomotion_collision_and_controllers.md:18` and
       `_issues/_closed/41_documentation_audit_findings.md:20` (both become `64_...`, same folder),
       `_issues/53_torus_deformation_commit_transport_defects.md` if it links issue 64.
  - **If job 07 is not done:** do not close issue 64. Add a section under its latest status update:

    ```markdown
    ## Status update <date> (job 08)

    Items 1 and 3 are fixed by job 08 (commit <hash>): moves report `appliedDisplacement` and the XR rig advances its
    baseline by the applied part; a move that overlaps a runtime body is reverted only if it brings the centers
    closer. Item 2 remains open (job 07).
    ```

    and set `Status: open; items 1 and 3 fixed by job 08 on <date>.`
- [ ] The job file is moved with `git mv .agents/jobs/08_xr_slide_replay_and_object_trap.md .agents/jobs/_done/`. In
  the moved file fix relative links (`../../../_issues/...` becomes `../../../../_issues/...`, and the link to job 07 becomes
  `07_forward_heading_convention.md` if 07 is in `_done/`, else `../07_forward_heading_convention.md`). Update the link
  in issue 64's `Jobs:` line and anything else `grep -rn "jobs/08_xr_slide" --exclude-dir=node_modules .` finds.
- [ ] The queue row in `.agents/jobs/README.md` reads like job 01's:
  `| [08](_done/08_xr_slide_replay_and_object_trap.md) | ~~XR slide replay and the player trapped by objects~~ (done) | [64](...) |  |`.
- [ ] The job file has `Status: done on <date>.` if `### Uncertain` is empty, otherwise
  `Status: done, needs review on <date>.`, and a `## Report` section at the end with these subsections:
  - `### Done` - what changed, with files and commit hashes.
  - `### Deviations` - where the work differs from the Steps, and why.
  - `### Uncertain` - decisions or results you are not sure of, and what would confirm them.
  - `### Not done` - anything skipped, and why.
  - `### Checks` - the commands you ran and their results, including failures.
- [ ] One commit (or a few) whose subject names the job, for example
  "Stop replaying XR wall slides and let the player leave object overlaps (job 08)", with a body in the style of
  commit `e094b82` (`git log -1 e094b82`). Do not push unless asked; if you push, the pre-push hook runs typecheck and
  tests.

Never stop to ask. If something in this job turns out to be wrong (a line number, a name, an expected number), do the
closest correct thing, and record it under `### Deviations` or `### Uncertain`.

## Report

### Done
- Commit: the single commit that contains this report (subject "Stop replaying XR wall slides and let the player leave object overlaps (job 08)").
- `src/movement/moveDynamicObject.ts`: `MoveDynamicObjectResult.appliedDisplacement` set in the crossing, free-move and blocked returns.
- `src/movement/movePlayer.ts`: `MoveResult.appliedDisplacement`; new `resolvePlayerMoveAgainstBodies`.
- `src/movement/collision.ts`: new `moveIncreasesCylinderOverlap`.
- `src/render/three/xrPlayerRig.ts`: `acceptPhysicalMove` advances the baseline by `R(-referenceSpaceYaw) * appliedDisplacement` after a blocked move; interface doc rewritten.
- `src/render/three/createThreeApp.ts`: `blockPlayerMoveAgainstRuntimeObjects` delegates to `resolvePlayerMoveAgainstBodies`; `playerIntersectsRuntimeObject` and the unused import removed.
- Tests: new cases in `tests/movement/collision.test.ts`, `tests/movement/movePlayer.test.ts`, `tests/render-contract/vrLocomotion.test.ts` (including the optional rotated-reference-space case, which passes); the two `MoveResult` literals got `appliedDisplacement`.
- `_docs/MATHEMATICAL_MODEL.md` section 5 paragraph; regenerated `_docs/generated/`.
- Issue 64 closed (job 07 was done) and links fixed; job moved to `_done/`; queue row updated.

### Deviations
- None. (The rotated-reference-space test was added as its own `it` inside a shared helper rather than a copy of the test body.)

### Uncertain
(none)

### Not done
(none)

### Checks
- Baseline `npm run typecheck` and `npm test`: passed (677 passed, 8 skipped).
- After changes: `npm run docs:generate`, `npm run typecheck` (clean), `npm test` (682 passed, 8 skipped), `npm run docs:check` (all ok).
