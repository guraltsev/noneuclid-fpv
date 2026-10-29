/**
 * Re-expressing an object's or player's pose in the target cell's frame when it passes through a portal.
 * Crossing applies the portal's gluing transform g (source-cell frame to target-cell frame) to the pose, so the new pose is g composed with the old one: the position is mapped as x -> R x + t and the heading is rotated by R, which changes the yaw by the portal's rotation angle but keeps z and pitch. No collision or bounds checking happens here; deciding when to cross is done in moveDynamicObject.ts.
 */
import type { CompiledPortal } from "../cell-complex/specs";
import { composeRigidTransform3, orthonormalizeYawRigidTransform3 } from "../math/rigidTransform3";
import type { PlayerPose } from "./playerPose";
import type { DynamicObjectState } from "./dynamicObject";
import { playerPoseToDynamicObject, playerPoseFromDynamicObject } from "./playerPose";

/**
 * Returns the object moved into the portal's target cell, with its pose composed with the portal transform (new pose = transformToTarget after old pose).
 */
export function crossDynamicObjectPortal(object: DynamicObjectState, portal: CompiledPortal): DynamicObjectState {
  return {
    ...object,
    cellId: portal.targetCellId,
    localPose: orthonormalizeYawRigidTransform3(composeRigidTransform3(portal.transformToTarget, object.localPose)),
  };
}

/**
 * Returns the player pose in the portal's target cell, carrying the pitch over unchanged.
 * Goes through a dynamic object, so only position and yaw are transformed.
 */
export function crossPortal(pose: PlayerPose, portal: CompiledPortal): PlayerPose {
  return playerPoseFromDynamicObject(
    crossDynamicObjectPortal(playerPoseToDynamicObject(pose), portal),
    pose.pitchRadians,
  );
}
