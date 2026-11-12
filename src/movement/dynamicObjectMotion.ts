/**
 * Motion scripts for objects other than the player (NPCs): the trial move of a {@link MotionEnvironment} built on
 * `moveDynamicObject`, so a creature's behavior can run the same scripts as the player (`createMotionRunner`).
 *
 * The runner works on a {@link PlayerPose} (cell, position, yaw, pitch); an object's pose is a pure yaw rotation plus a
 * translation, so the conversion is exact and pitch is carried along unchanged (an object has no look elevation of its own).
 * A behavior using it keeps its `DynamicObjectState`, converts it with `playerPoseFromDynamicObject(state, 0)` before
 * `runner.advance` and back with {@link dynamicObjectFromMotionPose} after, and publishes the result as it does today.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { ObstacleBodyState } from "./developedObstacles";
import type { DynamicObjectState } from "./dynamicObject";
import { AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE, moveDynamicObject } from "./moveDynamicObject";
import type { MotionMoveRequest, MotionTrialMove } from "./motionRunner";
import { playerPoseFromDynamicObject, playerPoseToDynamicObject, type PlayerPose } from "./playerPose";

/** What the trial move of an object needs. */
export interface DynamicObjectMotionOptions {
  world(): CompiledCellComplex;
  /** The object's collision cylinder (as in its DynamicObjectState). */
  readonly collision: DynamicObjectState["collision"];
  /** Bodies that block the object, per cell; the object itself must be left out (or listed in `ignoredObjectIds`). */
  readonly bodiesInCell?: (cellId: string) => readonly ObstacleBodyState[];
  readonly ignoredObjectIds?: ReadonlySet<string>;
  /** Autonomous objects ignore forbidden zones unless this is false. */
  readonly ignoreForbiddenZones?: boolean;
}

/** Returns a trial move for a {@link MotionEnvironment}: turn by the yaw delta, then move by the displacement in the new heading frame, with the object's collisions. */
export function createDynamicObjectMotionMove(options: DynamicObjectMotionOptions): (pose: PlayerPose, request: MotionMoveRequest) => MotionTrialMove {
  return (pose, request) => {
    const yawRadians = pose.yawRadians + request.yawDeltaRadians;
    const cos = Math.cos(yawRadians);
    const sin = Math.sin(yawRadians);
    const local = request.localDisplacement;
    const result = moveDynamicObject({
      world: options.world(),
      object: playerPoseToDynamicObject({ ...pose, yawRadians }, options.collision),
      displacement: { x: cos * local.x - sin * local.y, y: sin * local.x + cos * local.y, z: local.z },
      portalCrossingMode: AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
      ignoreForbiddenZones: options.ignoreForbiddenZones ?? true,
      ...(options.bodiesInCell ? { bodiesInCell: options.bodiesInCell } : {}),
      ...(options.ignoredObjectIds ? { ignoredObjectIds: options.ignoredObjectIds } : {}),
    });
    return {
      pose: playerPoseFromDynamicObject(result.object, pose.pitchRadians + request.pitchDeltaRadians),
      appliedDisplacement: result.appliedDisplacement,
      blocked: result.blocked,
      ...(result.blockingReason !== undefined ? { blockingReason: result.blockingReason } : {}),
      ...(result.blockingObjectId !== undefined ? { blockingObjectId: result.blockingObjectId } : {}),
      crossings: result.crossings,
    };
  };
}

/** The object's state at a pose the runner returned (pitch dropped). */
export function dynamicObjectFromMotionPose(pose: PlayerPose, collision: DynamicObjectState["collision"]): DynamicObjectState {
  return playerPoseToDynamicObject(pose, collision);
}
