/**
 * Oriented planes in 3D and point-versus-plane classification.
 * A plane is stored in implicit form n . x + offset = 0 with unit normal n, so the signed distance of a point is exactly n . x + offset (positive on the side the normal points to, in meters). Used by the segment/plane intersection helpers and by movement code that tests positions against vertical side planes.
 */
import { dotVec3, normalizeVec3, type Vec3 } from "./vec3";
import { geometryTolerance } from "./tolerances";

/**
 * Oriented plane {x : normal . x + offset = 0}; `normal` is expected to have unit length so that signed distances are in meters.
 */
export interface Plane {
  readonly normal: Vec3;
  /**
   * Constant term of the implicit equation; equals -(normal . p) for any point p on the plane.
   */
  readonly offset: number;
}

/**
 * Side of a plane a point lies on: "front" (positive signed distance), "back" (negative), or "boundary" (within tolerance).
 */
export type PlanePointClassification = "front" | "back" | "boundary";

/**
 * Builds the plane through `point` whose unit normal is `normal` normalized.
 * @throws Error if `normal` is near zero.
 */
export function planeFromPointAndNormal(point: Vec3, normal: Vec3): Plane {
  const normalized = normalizeVec3(normal);

  return {
    normal: normalized,
    offset: -dotVec3(normalized, point),
  };
}

/**
 * Returns the signed distance in meters from `point` to the plane, positive on the side the normal points to.
 * Exact only if the plane's normal is unit length.
 */
export function signedDistanceToPlane(plane: Plane, point: Vec3): number {
  return dotVec3(plane.normal, point) + plane.offset;
}

/**
 * Classifies a point as front, back or boundary of a plane, treating |signed distance| <= tolerance as boundary.
 */
export function classifyPointToPlane(
  plane: Plane,
  point: Vec3,
  tolerance = geometryTolerance,
): PlanePointClassification {
  const distance = signedDistanceToPlane(plane, point);

  if (distance > tolerance) {
    return "front";
  }

  if (distance < -tolerance) {
    return "back";
  }

  return "boundary";
}
