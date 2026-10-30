/**
 * Immutable 3D vector type and the small set of free functions used throughout the engine.
 * Vectors are plain {x, y, z} records. In cell-local coordinates x is horizontal right/east, y is horizontal forward, and z is vertical up, so the coordinate frame is right-handed (x cross y = z). Lengths are in meters. All functions are pure and allocate a new vector; none mutate their arguments.
 */
import { geometryTolerance } from "./tolerances";

/**
 * Immutable 3D point or direction in meters, in the (right-handed) cell-local frame x right/east, y forward, z up.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Constructs a {@link Vec3} from its components (x right/east, y forward, z up).
 */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * Returns the component-wise sum a + b.
 */
export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

/**
 * Returns the component-wise difference a - b.
 */
export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Returns v multiplied by the scalar `scale`.
 */
export function scaleVec3(v: Vec3, scale: number): Vec3 {
  return vec3(v.x * scale, v.y * scale, v.z * scale);
}

/**
 * Returns the Euclidean dot product a . b.
 */
export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Returns the right-handed cross product a x b.
 */
export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

/**
 * Returns the Euclidean norm of v.
 */
export function lengthVec3(v: Vec3): number {
  return Math.sqrt(dotVec3(v, v));
}

/**
 * Returns v scaled to unit length.
 * @throws Error if |v| <= tolerance (default {@link geometryTolerance}).
 */
export function normalizeVec3(v: Vec3, tolerance = geometryTolerance): Vec3 {
  const length = lengthVec3(v);

  if (length <= tolerance) {
    throw new Error("Cannot normalize a near-zero Vec3.");
  }

  return scaleVec3(v, 1 / length);
}

/**
 * Returns the Euclidean distance between points a and b.
 */
export function distanceVec3(a: Vec3, b: Vec3): number {
  return lengthVec3(subVec3(a, b));
}

/**
 * Returns the squared Euclidean distance between points a and b.
 */
export function distanceSquaredVec3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Returns true if every component of a and b differs by at most `tolerance`.
 * This is a per-component (Chebyshev) comparison, not a Euclidean-norm test.
 */
export function almostEqualVec3(a: Vec3, b: Vec3, tolerance = geometryTolerance): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.z - b.z) <= tolerance
  );
}
