/**
 * Rigid (orientation-preserving, distance-preserving) transforms of 3D space and 3x3 rotation matrices.
 * A transform g = (R, t) acts on points as x -> R x + t and on directions as d -> R d (translation ignored); R is stored row-major in a {@link Mat3} and is assumed to be a proper rotation (R^T R = I, det R = +1), which is what makes the inverse (R^T, -R^T t) valid. These transforms are the gluing maps that carry one cell's local frame to a neighboring cell's frame across a portal, and compositions of them express whole portal words. Composition follows function-composition order: composeRigidTransform3(a, b) = a after b. Lengths are in meters, angles in radians; yaw is rotation about +z.
 */
import { addVec3, dotVec3, vec3, type Vec3 } from "./vec3";

/**
 * Row-major 3x3 matrix; mRC is the entry in row R, column C. Used here as a rotation matrix (orthonormal, determinant +1).
 */
export interface Mat3 {
  readonly m00: number;
  readonly m01: number;
  readonly m02: number;
  readonly m10: number;
  readonly m11: number;
  readonly m12: number;
  readonly m20: number;
  readonly m21: number;
  readonly m22: number;
}

/**
 * Rigid transform g = (rotation R, translation t), acting on points as x -> R x + t.
 * The rotation is assumed to be a proper rotation; no check is performed.
 */
export interface RigidTransform3 {
  readonly rotation: Mat3;
  readonly translation: Vec3;
}

/**
 * The 3x3 identity matrix.
 */
export const identityMat3: Mat3 = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: 0,
  m20: 0,
  m21: 0,
  m22: 1,
};

/**
 * The identity transform (R = I, t = 0).
 */
export const identityRigidTransform3: RigidTransform3 = {
  rotation: identityMat3,
  translation: { x: 0, y: 0, z: 0 },
};

/**
 * Packs a rotation and a translation into a {@link RigidTransform3} without validating the rotation.
 */
export function rigidTransform3(rotation: Mat3, translation: Vec3): RigidTransform3 {
  return { rotation, translation };
}

/**
 * Applies the transform to a point: returns R point + t.
 */
export function transformPoint3(transform: RigidTransform3, point: Vec3): Vec3 {
  return addVec3(transformDirection3(transform, point), transform.translation);
}

/**
 * Applies only the rotation to a direction or free vector: returns R direction (translation is ignored).
 */
export function transformDirection3(transform: RigidTransform3, direction: Vec3): Vec3 {
  return multiplyMat3Vec3(transform.rotation, direction);
}

/**
 * Alias of {@link transformPoint3}: returns R point + t.
 */
export function applyRigidTransform3(transform: RigidTransform3, point: Vec3): Vec3 {
  return transformPoint3(transform, point);
}

/**
 * Returns the composite transform "a after b", i.e. (a o b)(x) = a(b(x)).
 * Rotation is R_a R_b and translation is R_a t_b + t_a. Order matters: compose(a, b) applies b first, so extending a chain of transforms by one more step on the "outer" side is compose(step, chain).
 */
export function composeRigidTransform3(a: RigidTransform3, b: RigidTransform3): RigidTransform3 {
  return {
    rotation: multiplyMat3(a.rotation, b.rotation),
    translation: addVec3(multiplyMat3Vec3(a.rotation, b.translation), a.translation),
  };
}

/**
 * Returns the inverse transform (R^T, -R^T t), so that compose(inverse, g) is the identity up to round-off.
 * Relies on R being orthonormal; it is a transpose, not a general matrix inverse.
 */
export function invertRigidTransform3(transform: RigidTransform3): RigidTransform3 {
  const rotation = transposeMat3(transform.rotation);

  return {
    rotation,
    translation: multiplyMat3Vec3(
      rotation,
      vec3(-transform.translation.x, -transform.translation.y, -transform.translation.z),
    ),
  };
}

/**
 * Builds the transform that rotates counterclockwise by `radians` about the +z axis (viewed from above) and then translates by `translation`.
 * Its rotation block is [[cos, -sin, 0], [sin, cos, 0], [0, 0, 1]].
 */
export function yawRigidTransform3(radians: number, translation: Vec3 = vec3(0, 0, 0)): RigidTransform3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    rotation: {
      m00: cos,
      m01: -sin,
      m02: 0,
      m10: sin,
      m11: cos,
      m12: 0,
      m20: 0,
      m21: 0,
      m22: 1,
    },
    translation,
  };
}

function multiplyMat3Vec3(matrix: Mat3, vector: Vec3): Vec3 {
  return vec3(
    dotVec3(vec3(matrix.m00, matrix.m01, matrix.m02), vector),
    dotVec3(vec3(matrix.m10, matrix.m11, matrix.m12), vector),
    dotVec3(vec3(matrix.m20, matrix.m21, matrix.m22), vector),
  );
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10 + a.m02 * b.m20,
    m01: a.m00 * b.m01 + a.m01 * b.m11 + a.m02 * b.m21,
    m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02 * b.m22,
    m10: a.m10 * b.m00 + a.m11 * b.m10 + a.m12 * b.m20,
    m11: a.m10 * b.m01 + a.m11 * b.m11 + a.m12 * b.m21,
    m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12 * b.m22,
    m20: a.m20 * b.m00 + a.m21 * b.m10 + a.m22 * b.m20,
    m21: a.m20 * b.m01 + a.m21 * b.m11 + a.m22 * b.m21,
    m22: a.m20 * b.m02 + a.m21 * b.m12 + a.m22 * b.m22,
  };
}

function transposeMat3(matrix: Mat3): Mat3 {
  return {
    m00: matrix.m00,
    m01: matrix.m10,
    m02: matrix.m20,
    m10: matrix.m01,
    m11: matrix.m11,
    m12: matrix.m21,
    m20: matrix.m02,
    m21: matrix.m12,
    m22: matrix.m22,
  };
}

/**
 * Returns the transform with the same translation and the exact yaw rotation closest to the given rotation, `yaw = atan2(m10, m00)`.
 * Only valid for transforms whose rotation is a yaw about +z (every gluing rotation and every object pose in this model is); any pitch or roll in the input is discarded. Use it after composing many yaw transforms to remove accumulated round-off.
 */
export function orthonormalizeYawRigidTransform3(transform: RigidTransform3): RigidTransform3 {
  return yawRigidTransform3(Math.atan2(transform.rotation.m10, transform.rotation.m00), transform.translation);
}
