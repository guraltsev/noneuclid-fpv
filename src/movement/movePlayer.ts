/**
 * Player locomotion: applies look and move input to a player pose, with collision and portal crossing when a world is given.
 * Yaw and pitch deltas are in radians and pitch is clamped to just under plus or minus pi / 2. The local displacement (x right, y forward at yaw 0, z up, meters) is rotated counterclockwise about +z by the new yaw to give a cell-frame displacement. With a world, the move is delegated to moveDynamicObject using the player's cylinder body and anchor-based portal crossing, so the returned pose may be in a different cell with a different yaw; without a world the player flies freely in a single frame.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { addVec3, type Vec3 } from "../math/vec3";
import { DEFAULT_PLAYER_HEIGHT_METERS, DEFAULT_PLAYER_RADIUS_METERS, type PlayerBody } from "./playerBody";
import type { PlayerPose } from "./playerPose";
import { playerPoseFromDynamicObject, playerPoseToDynamicObject } from "./playerPose";
import { simpleCollisionCylinder } from "./dynamicObject";
import { moveDynamicObject } from "./moveDynamicObject";
import type { BlockingReason } from "./collision";

/**
 * Declares in which frame a local displacement is expressed ("global" or "current-cell"); movePlayer currently treats both identically (rotated by yaw into the current cell's frame).
 */
export type MovementCoordinateFrame = "global" | "current-cell";

/**
 * Input to {@link movePlayer}: current pose, optional world and body, movement and look deltas.
 */
export interface MoveRequest {
  /**
   * Compiled world to collide with and cross portals in; if absent, movement is unconstrained.
   */
  readonly world?: CompiledCellComplex;
  readonly pose: PlayerPose;
  /**
   * Collision cylinder dimensions; defaults to the default player radius and height.
   */
  readonly body?: PlayerBody;
  /**
   * Desired displacement in meters in the player's heading frame (x right, y forward, z up), before yaw rotation.
   */
  readonly localDisplacement: Vec3;
  /**
   * Change of heading in radians, applied before the displacement is resolved.
   */
  readonly yawDeltaRadians: number;
  /**
   * Change of look elevation in radians.
   */
  readonly pitchDeltaRadians: number;
  readonly coordinateFrame: MovementCoordinateFrame;
}

/**
 * Result of {@link movePlayer}: the new pose and what happened to the attempted displacement.
 */
export type MoveResult = {
  readonly kind: "moved";
  readonly pose: PlayerPose;
  readonly attemptedDisplacement: Vec3;
  readonly blocked: boolean;
  readonly blockingReason?: BlockingReason;
  readonly crossedPortal: boolean;
  readonly crossedPortalId?: string;
};

/**
 * Applies the yaw and pitch deltas, rotates the local displacement by the new yaw, and moves the player, returning the new pose and collision/portal outcome.
 * With a world the player is a cylinder standing on its pose position (center at half the body height), so position.z is the feet height. Without a world the displacement is added directly and never blocked. The attempted displacement reported is the cell-frame displacement before any portal transform.
 */
export function movePlayer(request: MoveRequest): MoveResult {
  const yawRadians = request.pose.yawRadians + request.yawDeltaRadians;
  const pitchRadians = clampPitch(request.pose.pitchRadians + request.pitchDeltaRadians);
  const displacement = resolveLocalDisplacement(request.localDisplacement, yawRadians, request.coordinateFrame);
  const rotatedPose = {
    ...request.pose,
    yawRadians,
    pitchRadians,
  };

  if (request.world) {
    const body = request.body ?? {
      radiusMeters: DEFAULT_PLAYER_RADIUS_METERS,
      heightMeters: DEFAULT_PLAYER_HEIGHT_METERS,
    };
    const result = moveDynamicObject({
      world: request.world,
      object: playerPoseToDynamicObject(
        rotatedPose,
        simpleCollisionCylinder(body.radiusMeters, body.heightMeters, {
          x: 0,
          y: 0,
          z: body.heightMeters / 2,
        }),
      ),
      displacement,
      portalCrossingMode: "anchor",
    });

    return {
      kind: "moved",
      pose: playerPoseFromDynamicObject(result.object, pitchRadians),
      attemptedDisplacement: result.attemptedDisplacement,
      blocked: result.blocked,
      blockingReason: result.blockingReason,
      crossedPortal: result.crossedPortal,
      crossedPortalId: result.crossedPortalId,
    };
  }

  return {
    kind: "moved",
    pose: {
      ...request.pose,
      yawRadians,
      pitchRadians,
      position: addVec3(request.pose.position, displacement),
    },
    attemptedDisplacement: displacement,
    blocked: false,
    crossedPortal: false,
  };
}

/**
 * Limits pitch to plus or minus (pi / 2 - 0.01) radians to avoid the gimbal singularity at straight up or down.
 */
function clampPitch(pitchRadians: number): number {
  const maxPitchRadians = Math.PI / 2 - 0.01;

  return Math.max(-maxPitchRadians, Math.min(maxPitchRadians, pitchRadians));
}

/**
 * Rotates the (x right, y forward) part of the displacement counterclockwise by the yaw about +z and leaves z unchanged.
 * Both coordinate-frame options currently give the same result.
 */
function resolveLocalDisplacement(
  localDisplacement: Vec3,
  yawRadians: number,
  _coordinateFrame: MovementCoordinateFrame,
): Vec3 {
  const sinYaw = Math.sin(yawRadians);
  const cosYaw = Math.cos(yawRadians);
  return {
    x: cosYaw * localDisplacement.x - sinYaw * localDisplacement.y,
    y: sinYaw * localDisplacement.x + cosYaw * localDisplacement.y,
    z: localDisplacement.z,
  };
}
