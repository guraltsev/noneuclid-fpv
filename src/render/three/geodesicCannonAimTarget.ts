/**
 * Computes the yaw a geodesic cannon should adopt to face a target point.
 *
 * Pure planar math in the world frame (x right, y forward, z up; meters). Both points must
 * already be expressed in the same frame (cell-local or unfolded/absolute); no portal
 * traversal is performed here. Only the horizontal (x, y) components matter, so height is ignored.
 */
import type { Vec3 } from "../../math/vec3";

// Horizontal separations at or below this (meters) are treated as coincident; yaw is undefined there.
const aimPointToleranceMeters = 1e-7;

/**
 * Returns the world-frame yaw (radians, atan2(dy, dx) from the +x axis, counter-clockwise about +z) pointing from `source` to `target`.
 *
 * Returns `undefined` when either point is missing, when the horizontal delta is non-finite, or when
 * the horizontal distance is within 1e-7 m (direction would be numerically meaningless).
 */
export function resolveGeodesicCannonAimYawFromAbsolutePoints(options: {
  readonly source: Vec3 | undefined;
  readonly target: Vec3 | undefined;
}): number | undefined {
  if (!options.source || !options.target) {
    return undefined;
  }

  const dx = options.target.x - options.source.x;
  const dy = options.target.y - options.source.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) <= aimPointToleranceMeters) {
    return undefined;
  }

  return Math.atan2(dy, dx);
}
