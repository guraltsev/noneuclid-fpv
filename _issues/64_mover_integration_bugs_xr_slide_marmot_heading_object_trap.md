# 64 - Mover integration bugs: XR slide replay, marmot heading and freeze, player trapped by objects

Status: open as of 2026-10-08.

Priority: P2 (correctness). Three independent bugs in the callers of `moveDynamicObject` / `movePlayer`.

## Summary

1. **XR room-scale slide is replayed every frame.** A wall slide returns `blocked: true` with a *moved* pose. The XR rig
   advances its accepted head baseline only when `!result.blocked`, so the same accumulated head delta is applied again on
   the next frame, and the tangential part moves the player again.
2. **Marmot walks in the mirrored direction of its authored velocity and freezes permanently at the first zone.**
3. **The player cannot leave an existing overlap with a runtime object.** Any move that still overlaps is reverted whole.

## Evidence

1. `src/render/three/xrPlayerRig.ts:191-198`: `if (!result.blocked) previousAcceptedHeadLocalMeters = current`.
   `src/render/three/createThreeApp.ts:1278-1291` sends the physical move through `movePlayer`. The slide result is built
   at `src/movement/moveDynamicObject.ts:116-125` (`blocked: true`, object = pushed candidate). Scenario: the user leans
   5 cm diagonally into a wall and holds still. `D` stays ≈ 5 cm and every frame slides the body by `D_t ≈ 3.5 cm`, which
   is 3.2 m/s at 90 Hz. The player glides along the wall without moving and continues through the corner (issue 61).
2. `src/world-objects/geodesicMarmot.ts:249-251` gives `yaw = atan2(v_x, v_y)`, and the step is
   `R(yaw)·(0, |v|, 0) = |v|(-sin yaw, cos yaw)` (`geodesicMarmot.ts:139`, with `yawRigidTransform3` rows
   `[[c,-s],[s,c]]`). Hence the direction is `(-v_x, v_y)/|v|`: an authored `velocity: {x: 1, y: 0}` walks **west**. Issue 41
   notes the convention mismatch; this is its concrete consequence.

   The marmot also does not set `ignoreForbiddenZones` (`geodesicMarmot.ts:140-145`). A zone hit reverts the pose, and the
   heading never changes, so it is blocked again on every later frame. Straight-line flow on these flat cone-surfaces is
   generically dense, so every marmot eventually freezes for good.
3. `src/render/three/createThreeApp.ts:3182-3215` (`blockPlayerMoveAgainstRuntimeObjects`) reverts to `previousPose` whenever
   the *new* pose overlaps. Creatures move independently (`createThreeApp.ts:1362`). If a creature steps into the player
   (it only checks same-cell obstacles, issue 63), a 4 cm step directly away still leaves 0.46 m < 0.5 m between centers,
   so the step is reverted. The player is stuck until the creature leaves.

## Proposed change

1. Add `appliedDisplacement` (in the source cell frame, before any crossing) to `MoveDynamicObjectResult` / `MoveResult`.
   Then in `acceptPhysicalMove` advance the baseline by the applied part:
   `previousAccepted += R(-referenceSpaceYaw) · R(playerYaw) · applied` (the inverse of `consumePhysicalInput`'s mapping).
   Equivalently, express the unapplied remainder as a persistent rig offset. Never replay applied motion.
2. Change `yawFromVelocity` to `Math.atan2(-velocity.x, velocity.y)` and add a test that the first step is parallel to
   `velocity`. For the zone: either reflect or rotate the heading on a `forbidden-zone` block (for example by the geodesic
   continuation around the cone point: turn by `π - θ/2`), or use the swept slide of issue 62 so the marmot skirts the
   zone tangentially.
3. Accept a move against bodies if it does not increase penetration: for each overlapping body, require
   `|c_new - c_o| >= min(|c_old - c_o|, r + r_o)`. Better, include runtime bodies as disc obstacles in the swept slide of
   issue 62, which depenetrates along the contact normal.

## Acceptance criteria

- XR unit test: a constant head offset into a wall gives zero body motion on frames 2..N.
- Marmot test: velocity `(1, 0)` gives `Δx > 0`. A marmot aimed at a zone does not freeze (it moves on at least 90% of
  later frames).
- Player test: start overlapping a static body and move away; the first frame increases separation.
