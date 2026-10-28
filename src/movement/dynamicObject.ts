/**
 * State of a movable object (player body, creature, geodesic emitter) inside a compiled cell complex.
 * An object lives in exactly one cell and is located by a rigid pose in that cell's local frame (x right/east, y forward, z up, meters): the translation is the object's anchor point and the rotation, normally a pure yaw about +z, its heading. An optional vertical collision cylinder is attached to the pose. Crossing a portal replaces the cell id and re-expresses the pose in the target cell's frame; see portalCrossing.ts.
 */
import type { RigidTransform3 } from "../math/rigidTransform3";
import type { Vec3 } from "../math/vec3";

/**
 * Where a movable object is: the id of its cell, its pose in that cell's local frame, and an optional collision shape.
 */
export interface DynamicObjectState {
  readonly cellId: string;
  /**
   * Rigid transform from the object's own frame to the cell-local frame: translation = anchor position in meters, rotation = heading (yaw about +z).
   */
  readonly localPose: RigidTransform3;
  readonly collision?: DynamicObjectCollisionShape;
}

/**
 * Collision shapes an object may use; currently only the vertical cylinder.
 */
export type DynamicObjectCollisionShape = SimpleCollisionCylinder;

/**
 * Upright cylinder with its axis parallel to +z, described in the object's own frame.
 */
export interface SimpleCollisionCylinder {
  /**
   * Cylinder radius in meters.
   */
  readonly radius: number;
  /**
   * Total cylinder height in meters; the cylinder spans height / 2 above and below its center.
   */
  readonly height: number;
  /**
   * Cylinder center relative to the object's anchor, in the object's own frame (rotated by the heading when placed in the cell); defaults to zero.
   */
  readonly offset?: Vec3;
}

/**
 * Creates a {@link SimpleCollisionCylinder} from radius and height in meters and an optional center offset.
 */
export function simpleCollisionCylinder(radius: number, height: number, offset?: Vec3): SimpleCollisionCylinder {
  return { radius, height, offset };
}
