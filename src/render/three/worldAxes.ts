/**
 * Conversion between the simulation's world frame and the Three.js scene frame.
 *
 * World/cell-local coordinates are right-handed with x right, y forward, z up (meters). Three.js uses x right,
 * y up, and the camera looks down -z, so a world point (x, y, z) becomes the Three point (x, z, -y). This is the
 * linear map B = [[1,0,0],[0,0,1],[0,-1,0]] (a proper rotation, det +1, so handedness and winding are preserved).
 * A rigid transform M expressed in world coordinates is expressed in Three coordinates as B * M * B^-1
 * (`rigidTransformToThreeMatrix`). Yaw about world +z equals the same angle about Three +y, so yaw needs no conversion.
 * The root cell's frame is used directly as the Three.js world frame; every other cell is placed by
 * `rootFromDestination` matrices produced with this module.
 */

import * as THREE from "three";
import type { RigidTransform3 } from "../../math/rigidTransform3";
import type { Vec3 } from "../../math/vec3";

// Map right-handed world coordinates (x right, y forward, z up)
// into Three.js coordinates (x right, y up, -z forward).
// Row-major arguments to Matrix4.set: rows give Three x = world x, Three y = world z, Three z = -world y.
const worldToThreeBasis = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);
const threeToWorldBasis = worldToThreeBasis.clone().invert();

/** Converts a world-frame point (x right, y forward, z up) to a new Three.js vector (x, z, -y). */
export function worldPointToThree(point: Vec3): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.z, -point.y);
}

/** Inverse of `worldPointToThree`: converts a Three.js point (x, y up, -z forward) to a world-frame point (x, -z, y). */
export function threePointToWorld(point: THREE.Vector3): Vec3 {
  return {
    x: point.x,
    y: -point.z,
    z: point.y,
  };
}

/** Converts a Three.js direction vector to a world-frame direction; identical to the point mapping because B is purely linear. */
export function threeDirectionToWorld(direction: THREE.Vector3): Vec3 {
  return threePointToWorld(direction);
}

/** Returns a world yaw (radians about +z, counter-clockwise seen from above) as the equivalent rotation about Three's +y axis, which is numerically identical. */
export function worldYawRadiansToThree(yawRadians: number): number {
  return yawRadians;
}

/**
 * Converts a world-frame rigid transform into the equivalent Three.js `Matrix4` (basis-changed by B * M * B^-1).
 *
 * The transform maps destination-local points to source points, `p_source = R p + t`; the result applies the same
 * map to column vectors in Three axes, so it can be used directly as an object or instance matrix. Allocates a new
 * matrix unless `target` is given, in which case the result is written to (and returned as) `target`.
 */
export function rigidTransformToThreeMatrix(transform: RigidTransform3, target?: THREE.Matrix4): THREE.Matrix4 {
  const worldMatrix = rigidTransformWorldMatrixScratch.set(
    transform.rotation.m00,
    transform.rotation.m01,
    transform.rotation.m02,
    transform.translation.x,
    transform.rotation.m10,
    transform.rotation.m11,
    transform.rotation.m12,
    transform.translation.y,
    transform.rotation.m20,
    transform.rotation.m21,
    transform.rotation.m22,
    transform.translation.z,
    0,
    0,
    0,
    1,
  );

  return (target ?? new THREE.Matrix4()).multiplyMatrices(worldToThreeBasis, worldMatrix).multiply(threeToWorldBasis);
}

// Inner matrix of rigidTransformToThreeMatrix; always fully overwritten, never escapes the function.
const rigidTransformWorldMatrixScratch = new THREE.Matrix4();

/** Sets an object's position and quaternion from a world-frame rigid transform (converted to Three axes); scale is left untouched. */
export function applyWorldRigidTransform(object: THREE.Object3D, transform: RigidTransform3): void {
  const matrix = rigidTransformToThreeMatrix(transform);
  object.position.setFromMatrixPosition(matrix);
  object.quaternion.setFromRotationMatrix(matrix);
}
