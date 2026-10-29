/**
 * Collision tests of a dynamic object against its current cell, and helpers for side-relative geometry.
 * Everything is in the cell-local frame in meters (z up). The object's collision shape is an upright cylinder; the cell is a convex prism whose sides have unit inward normals, so the signed distance of a point to a side plane is positive inside the cell. Non-portal sides are walls that keep the cylinder's axis at least its radius away; portal sides never block here because crossing them is handled by moveDynamicObject. Vertical cylinders around portal-junction vertices (forbidden zones) are tested both at the new position and, to catch tunnelling, along the swept path from the previous position. Collision is only evaluated against the object's own cell, never against neighboring cells.
 */
import type { CompiledPrismCell, CompiledPrismSide } from "../cell-complex/prismCells";
import type { SingularityCollisionCylinder } from "../cell-complex/forbiddenZones";
import { transformDirection3 } from "../math/rigidTransform3";
import type { Vec3 } from "../math/vec3";
import type { DynamicObjectState, SimpleCollisionCylinder } from "./dynamicObject";

/**
 * Why a move was blocked: a non-portal side ("wall"), the floor, the ceiling, or a portal-junction cylinder ("forbidden-zone").
 */
export type BlockingReason = "wall" | "floor" | "ceiling" | "forbidden-zone";

/**
 * Result of a collision test; `sideIndex` is set only for reason "wall".
 */
export interface CollisionResult {
  readonly blocked: boolean;
  readonly reason?: BlockingReason;
  readonly sideIndex?: number;
}

/**
 * Inputs to {@link testCellCollision}: the proposed object state in its cell and optional context.
 */
export interface CollisionCandidate {
  readonly cell: CompiledPrismCell;
  /**
   * Proposed (post-move) state to test.
   */
  readonly object: DynamicObjectState;
  /**
   * State before the move; enables the swept forbidden-zone test between the two positions.
   */
  readonly previousObject?: DynamicObjectState;
  /**
   * Side to skip in the wall test even if it is not a portal side.
   */
  readonly ignoredPortalSideIndex?: number;
  /**
   * If true, skip both the point and swept tests against forbidden-zone cylinders.
   */
  readonly ignoreForbiddenZones?: boolean;
}

/**
 * World (cell-local) placement of an upright cylinder: center in meters, radius in meters and half of its height.
 */
export interface SimpleCylinderBounds {
  readonly center: Vec3;
  readonly radius: number;
  readonly halfHeight: number;
}

/**
 * A side whose clearance went from non-negative to negative during a move; see {@link findBoundaryCrossing}.
 */
export interface BoundaryCrossing {
  readonly side: CompiledPrismSide;
  /**
   * Signed distance from the start center to the side plane minus the body support, meters (>= 0).
   */
  readonly startClearance: number;
  /**
   * The same quantity at the end position (< 0); negative means the body overlaps or has passed the side.
   */
  readonly endClearance: number;
  /**
   * Position of the end center along the side measured from its start vertex, meters (may lie outside [0, side length]).
   */
  readonly endProjection: number;
}

const zeroOffset = { x: 0, y: 0, z: 0 };

/**
 * Tests whether the candidate state collides with the floor, ceiling, forbidden-zone cylinders or walls of its cell, returning the first collision found.
 * Checks in order: floor (cylinder bottom below z = 0), ceiling (top above the cell height), forbidden zones (overlap at the new position, then overlap of the swept path from previousObject when given), then walls: every side that has no portal (and is not ignored) blocks if the cylinder center is closer than its radius to the side plane. Objects without a collision shape never block. Comparisons are strict with no tolerance. The movers keep bodies `collisionSkinMeters` clear of every obstacle, so a body at rest after a move is never reported blocked.
 */
export function testCellCollision(candidate: CollisionCandidate): CollisionResult {
  const bounds = getDynamicObjectCollisionBounds(candidate.object);

  if (!bounds) {
    return { blocked: false };
  }

  const { center, halfHeight } = bounds;

  // Cylinder bottom is below the floor plane z = 0.
  if (center.z - halfHeight < 0) {
    return { blocked: true, reason: "floor" };
  }

  if (center.z + halfHeight > candidate.cell.heightMeters) {
    return { blocked: true, reason: "ceiling" };
  }

  if (!candidate.ignoreForbiddenZones) {
    for (const exclusionCylinder of candidate.cell.singularityColumns) {
      if (simpleCylinderIntersectsSingularityCylinder(bounds, exclusionCylinder)) {
        return { blocked: true, reason: "forbidden-zone" };
      }
    }

    const previousBounds = candidate.previousObject
      ? getDynamicObjectCollisionBounds(candidate.previousObject)
      : undefined;

    if (previousBounds) {
      for (const exclusionCylinder of candidate.cell.singularityColumns) {
        if (sweptCylinderIntersectsSingularityCylinder(previousBounds, bounds, exclusionCylinder)) {
          return { blocked: true, reason: "forbidden-zone" };
        }
      }
    }
  }

  for (const side of candidate.cell.sides) {
    if (side.portal || side.sideIndex === candidate.ignoredPortalSideIndex) {
      continue;
    }

    // Distance from the cylinder axis to the side plane; the body touches the wall when this drops below its radius. Portal sides were skipped above: they are crossed, not collided with.
    const distance = signedDistanceToSide(side, center);

    if (distance < bounds.radius) {
      return { blocked: true, reason: "wall", sideIndex: side.sideIndex };
    }
  }

  return { blocked: false };
}

/**
 * Cylinder bounds for a collision shape placed at `position`, adding the shape's offset unrotated; undefined if there is no shape.
 */
export function getCollisionBounds(
  position: Vec3,
  collision?: SimpleCollisionCylinder,
): SimpleCylinderBounds | undefined {
  if (!collision) {
    return undefined;
  }

  const offset = collision.offset ?? zeroOffset;

  return {
    center: {
      x: position.x + offset.x,
      y: position.y + offset.y,
      z: position.z + offset.z,
    },
    radius: collision.radius,
    halfHeight: collision.height / 2,
  };
}

/**
 * Cylinder bounds of a dynamic object, with the shape's offset rotated by the pose rotation before being added to the pose translation; undefined if the object has no shape.
 * Only the center is rotated; the cylinder axis stays vertical.
 */
export function getDynamicObjectCollisionBounds(object: DynamicObjectState): SimpleCylinderBounds | undefined {
  const collision = object.collision;

  if (!collision) {
    return undefined;
  }

  const rotatedOffset = transformDirection3(
    object.localPose,
    collision.offset ?? zeroOffset,
  );

  return {
    center: {
      x: object.localPose.translation.x + rotatedOffset.x,
      y: object.localPose.translation.y + rotatedOffset.y,
      z: object.localPose.translation.z + rotatedOffset.z,
    },
    radius: collision.radius,
    halfHeight: collision.height / 2,
  };
}

/**
 * True if two upright cylinders overlap: horizontal center distance less than the sum of radii and vertical center distance less than the sum of half heights (strict).
 */
export function simpleCylinderIntersectsSimpleCylinder(
  a: SimpleCylinderBounds,
  b: SimpleCylinderBounds,
): boolean {
  const radius = a.radius + b.radius;

  return (
    horizontalDistanceSquared(a.center, b.center) < radius * radius &&
    Math.abs(a.center.z - b.center.z) < a.halfHeight + b.halfHeight
  );
}

/**
 * Point-in-time overlap test between a body and a forbidden-zone cylinder.
 */
function simpleCylinderIntersectsSingularityCylinder(
  cylinder: SimpleCylinderBounds,
  exclusionCylinder: SingularityCollisionCylinder,
): boolean {
  return simpleCylinderIntersectsSimpleCylinder(cylinder, {
    center: exclusionCylinder.center,
    radius: exclusionCylinder.radius,
    halfHeight: exclusionCylinder.height / 2,
  });
}

/**
 * Conservative swept test of a body moving from `start` to `end` against a forbidden-zone cylinder.
 * Treats the motion as the segment between the two centers thickened by the larger of the two radii, and overlaps its vertical extent (union of both heights) with the zone's; this catches a step that jumps over a zone without ever overlapping it at the sampled end points.
 */
function sweptCylinderIntersectsSingularityCylinder(
  start: SimpleCylinderBounds,
  end: SimpleCylinderBounds,
  exclusionCylinder: SingularityCollisionCylinder,
): boolean {
  const combinedRadius = Math.max(start.radius, end.radius) + exclusionCylinder.radius;
  const sweptMinZ = Math.min(start.center.z - start.halfHeight, end.center.z - end.halfHeight);
  const sweptMaxZ = Math.max(start.center.z + start.halfHeight, end.center.z + end.halfHeight);
  const exclusionHalfHeight = exclusionCylinder.height / 2;
  const exclusionMinZ = exclusionCylinder.center.z - exclusionHalfHeight;
  const exclusionMaxZ = exclusionCylinder.center.z + exclusionHalfHeight;

  return (
    sweptMinZ < exclusionMaxZ &&
    sweptMaxZ > exclusionMinZ &&
    distanceSquaredPointToSegment2(
      exclusionCylinder.center.x,
      exclusionCylinder.center.y,
      start.center.x,
      start.center.y,
      end.center.x,
      end.center.y,
    ) < combinedRadius * combinedRadius
  );
}

/**
 * Signed distance in meters from a point to the side's vertical plane, positive on the inner (cell) side; only x and y are used.
 */
export function signedDistanceToSide(side: CompiledPrismSide, point: Vec3): number {
  return (point.x - side.start.x) * side.inwardNormal.x + (point.y - side.start.y) * side.inwardNormal.y;
}

/**
 * Extent of the body toward a side, in meters; for a cylinder it is the radius in every direction (the side argument is unused).
 */
export function getSideSupport(_side: CompiledPrismSide, bounds: SimpleCylinderBounds): number {
  return bounds.radius;
}

/**
 * Distance in meters from the side's start vertex to the orthogonal projection of the point onto the side's line; negative or greater than the side length means the point lies beyond the side's ends.
 */
export function projectPointAlongSide(side: CompiledPrismSide, point: Vec3): number {
  const edgeX = side.end.x - side.start.x;
  const edgeY = side.end.y - side.start.y;

  return ((point.x - side.start.x) * edgeX + (point.y - side.start.y) * edgeY) / side.lengthMeters;
}

/**
 * Finds the side the body is leaving between two states of the same cell, if any.
 * For each side the clearance is the signed distance of the body center minus its radius (just the center for objects without a shape). A side qualifies when the clearance is >= 0 at the start and < 0 at the end; among several, the one with the most negative end clearance wins. This is the "bounds" criterion (any part of the body crosses), as opposed to the anchor criterion used by moveDynamicObject.
 */
export function findBoundaryCrossing(
  cell: CompiledPrismCell,
  startObject: DynamicObjectState,
  endObject: DynamicObjectState,
): BoundaryCrossing | undefined {
  const startBounds = getDynamicObjectCollisionBounds(startObject);
  const endBounds = getDynamicObjectCollisionBounds(endObject);
  const startPoint = startBounds?.center ?? startObject.localPose.translation;
  const endPoint = endBounds?.center ?? endObject.localPose.translation;

  let crossing: BoundaryCrossing | undefined;

  for (const side of cell.sides) {
    const startSupport = startBounds ? getSideSupport(side, startBounds) : 0;
    const endSupport = endBounds ? getSideSupport(side, endBounds) : 0;
    const startClearance = signedDistanceToSide(side, startPoint) - startSupport;
    const endClearance = signedDistanceToSide(side, endPoint) - endSupport;

    if (startClearance >= 0 && endClearance < 0) {
      if (!crossing || endClearance < crossing.endClearance) {
        crossing = {
          side,
          startClearance,
          endClearance,
          endProjection: projectPointAlongSide(side, endPoint),
        };
      }
    }
  }

  return crossing;
}

/**
 * Squared distance in the x/y plane.
 */
function horizontalDistanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return dx * dx + dy * dy;
}

/**
 * Squared distance in the plane from a point to the closest point of a segment (degenerate segments reduce to point distance).
 */
function distanceSquaredPointToSegment2(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    const dx = pointX - startX;
    const dy = pointY - startY;

    return dx * dx + dy * dy;
  }

  const t = Math.max(
    0,
    Math.min(1, ((pointX - startX) * segmentX + (pointY - startY) * segmentY) / segmentLengthSquared),
  );
  const closestX = startX + segmentX * t;
  const closestY = startY + segmentY * t;
  const dx = pointX - closestX;
  const dy = pointY - closestY;

  return dx * dx + dy * dy;
}
