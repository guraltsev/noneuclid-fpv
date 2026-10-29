/**
 * Segment-versus-plane intersection.
 * Given a line segment start->end and an oriented {@link Plane}, computes the parameter t in [0, 1] at which the segment meets the plane (using the signed distances of both endpoints), with an absolute tolerance to absorb round-off at the ends. Pure 3D, frame-agnostic: points and the plane just need to be expressed in the same frame, in meters.
 */
import type { Plane } from "./planes";
import { signedDistanceToPlane } from "./planes";
import { geometryTolerance } from "./tolerances";
import { addVec3, lengthVec3 as vecLength, scaleVec3, subVec3, type Vec3 } from "./vec3";

/**
 * Result of {@link intersectSegmentWithPlane}: no hit, a single hit point with parameter t along the segment, or both endpoints lying on the plane.
 */
export type SegmentPlaneIntersection =
  | { readonly kind: "none" }
  | { readonly kind: "point"; readonly t: number; readonly point: Vec3 }
  | { readonly kind: "coplanar" };

/**
 * Generic hit/miss result with an optional hit distance in meters (only meaningful when `hit` is true).
 */
export interface IntersectionResult {
  readonly hit: boolean;
  readonly distanceMeters?: number;
}

/**
 * Intersects the segment start->end with a plane, returning the hit point and its parameter t in [0, 1] when the segment crosses it.
 * `tolerance` is in meters and is applied to distances only; the dimensionless t is compared against `tolerance / length`. A strict sign change of the endpoint distances is always a hit, however short the segment. Returns "coplanar" when both endpoints are within `tolerance` of the plane without a strict sign change, and "none" when both lie strictly on the same side with distances differing by <= `tolerance`, or when t falls outside [-tolerance / length, 1 + tolerance / length]. A touching endpoint counts as a hit; t is clamped to [0, 1] and the point is start + t (end - start).
 */
export function intersectSegmentWithPlane(
  start: Vec3,
  end: Vec3,
  plane: Plane,
  tolerance = geometryTolerance,
): SegmentPlaneIntersection {
  const startDistance = signedDistanceToPlane(plane, start);
  const endDistance = signedDistanceToPlane(plane, end);
  const strictlyCrossing = startDistance * endDistance < 0;

  if (!strictlyCrossing && Math.abs(startDistance) <= tolerance && Math.abs(endDistance) <= tolerance) {
    return { kind: "coplanar" };
  }

  const denominator = startDistance - endDistance;

  if (!strictlyCrossing && startDistance * endDistance > 0 && Math.abs(denominator) <= tolerance) {
    return { kind: "none" };
  }

  if (denominator === 0) {
    return { kind: "none" };
  }

  const t = startDistance / denominator;
  const parameterTolerance = tolerance / Math.max(vecLength(subVec3(end, start)), minimumSegmentLengthMeters);

  if (t < -parameterTolerance || t > 1 + parameterTolerance) {
    return { kind: "none" };
  }

  const clampedT = Math.min(1, Math.max(0, t));

  return {
    kind: "point",
    t: clampedT,
    point: addVec3(start, scaleVec3(subVec3(end, start), clampedT)),
  };
}

/**
 * Floor, in meters, for the segment length when converting a metric tolerance into a ray parameter tolerance (avoids dividing by zero).
 */
const minimumSegmentLengthMeters = 1e-300;