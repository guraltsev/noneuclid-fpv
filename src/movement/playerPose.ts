/**
 * Player pose (cell, position, yaw, pitch) and its conversion to and from the generic dynamic-object representation.
 * Position is in the current cell's local frame in meters, with position.z the height of the player's feet above that cell's floor. Yaw is a counterclockwise rotation about +z in radians; pitch is the look elevation in radians. Only position and yaw take part in movement and portal crossing, so pitch is carried alongside and restored on conversion back.
 */
import { yawRigidTransform3 } from "../math/rigidTransform3";
import type { DynamicObjectState } from "./dynamicObject";
import type { Vec3 } from "../math/vec3";

/**
 * Where the player is and which way they look, in the coordinates of cell `cellId`.
 */
export interface PlayerPose {
  readonly cellId: string;
  /**
   * Feet position in the cell-local frame, meters.
   */
  readonly position: Vec3;
  /**
   * Heading about +z, counterclockwise from above, radians.
   */
  readonly yawRadians: number;
  /**
   * Look elevation in radians; clamped by movePlayer to just under plus or minus pi / 2.
   */
  readonly pitchRadians: number;
}

/**
 * Creates a pose at the local origin of the given cell, facing yaw 0 and pitch 0.
 */
export function createDefaultPlayerPose(cellId: string): PlayerPose {
  return {
    cellId,
    position: { x: 0, y: 0, z: 0 },
    yawRadians: 0,
    pitchRadians: 0,
  };
}

/**
 * Converts a pose to a {@link DynamicObjectState} whose pose is a pure yaw rotation plus the position translation; pitch is dropped.
 */
export function playerPoseToDynamicObject(pose: PlayerPose, collision?: DynamicObjectState["collision"]): DynamicObjectState {
  return {
    cellId: pose.cellId,
    localPose: yawRigidTransform3(pose.yawRadians, pose.position),
    collision,
  };
}

/**
 * Converts a dynamic object back to a pose, recovering yaw as atan2(R10, R00) of the pose rotation and attaching the supplied pitch.
 */
export function playerPoseFromDynamicObject(object: DynamicObjectState, pitchRadians: number): PlayerPose {
  return {
    cellId: object.cellId,
    position: object.localPose.translation,
    yawRadians: Math.atan2(object.localPose.rotation.m10, object.localPose.rotation.m00),
    pitchRadians,
  };
}
