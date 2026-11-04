/**
 * Measured-length tool: persistent "geodesic length = N m" labels attached to a geodesic.
 * A geodesic (GeodesicArcObject) is rendered as a chain of straight GeodesicSegmentObjects, one run per cell it passes through, joined at portals; the measured length is the sum of `lengthMeters` over all registry segments with that `geodesicId`, i.e. the true intrinsic length along the geodesic through portals, not a Euclidean distance within one cell.
 * The label object is placed in the cell-local frame (meters) at the point of the segment, in the player's current cell, nearest to the player, and is refreshed as the geodesic is extended, rebuilt or the player moves.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { enumerateCellImages } from "../cell-complex/portalRoute";
import { identityRigidTransform3, transformPoint3, yawRigidTransform3 } from "../math/rigidTransform3";
import type { Vec3 } from "../math/vec3";
import type { GeodesicSegmentObject } from "./geodesic/objects";
import type { RuntimeObjectRegistry } from "./runtimeObjectRegistry";
import type { MeasuredGeodesicLengthObject } from "./toolObjects";

/**
 * Creates a length label for a geodesic, anchored on the segment of that geodesic in the player's cell that is closest to the player.
 * If the geodesic has no segment in `playerCellId`, `fallbackSegment` is used (its own cell then hosts the label); returns undefined when neither exists. `playerPoint` is in `playerCellId`'s local frame (meters); the label faces the player.
 */
export function createMeasuredGeodesicLengthObject(options: {
  readonly id: string;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly playerCellId: string;
  readonly playerPoint: Vec3;
  /** The compiled world; when given, segments seen through the portals of the player's cell are candidates too. */
  readonly world?: CompiledCellComplex;
  readonly label?: string;
  readonly fallbackSegment?: GeodesicSegmentObject;
}): MeasuredGeodesicLengthObject | undefined {
  const closest = findClosestGeodesicSegment(
    options.registry,
    options.world,
    options.geodesicId,
    options.playerCellId,
    options.playerPoint,
  );
  const segment = closest?.segment ?? options.fallbackSegment;
  if (!segment) {
    return undefined;
  }

  return createMeasuredGeodesicLengthObjectAtSegment({
    id: options.id,
    registry: options.registry,
    geodesicId: options.geodesicId,
    label: options.label,
    playerPoint: closest?.playerPoint ?? options.playerPoint,
    segment,
  });
}

/**
 * Recomputes a length label against the current registry and player position.
 * Returns undefined when the geodesic no longer has positive total length (the measurement should be dropped). If the geodesic has no segment in the player's cell the previous anchor is kept and only the length (and tooltip) is updated; otherwise the label is re-anchored to the nearest segment in the player's cell.
 */
export function refreshMeasuredGeodesicLengthObject(options: {
  readonly registry: RuntimeObjectRegistry;
  readonly measurement: MeasuredGeodesicLengthObject;
  readonly playerCellId: string;
  readonly playerPoint: Vec3;
  /** The compiled world; when given, segments seen through the portals of the player's cell are candidates too. */
  readonly world?: CompiledCellComplex;
}): MeasuredGeodesicLengthObject | undefined {
  const lengthMeters = getGeodesicTotalLengthMeters(options.registry, options.measurement.geodesicId);
  if (!(lengthMeters > 0)) {
    return undefined;
  }

  const closest = findClosestGeodesicSegment(
    options.registry,
    options.world,
    options.measurement.geodesicId,
    options.playerCellId,
    options.playerPoint,
  );
  if (!closest) {
    return withMeasuredGeodesicLengthTooltip({
      ...options.measurement,
      lengthMeters,
    });
  }

  return createMeasuredGeodesicLengthObjectAtSegment({
    id: options.measurement.id,
    registry: options.registry,
    geodesicId: options.measurement.geodesicId,
    label: options.measurement.label,
    playerPoint: closest.playerPoint,
    segment: closest.segment,
  });
}

/**
 * Formats the label text "<name> length = <value> m".
 * The name is `geodesic.label` or the geodesic id; the value is rounded to two decimals with trailing zeros stripped.
 */
export function formatMeasuredGeodesicLengthLabel(
  geodesic: { readonly geodesicId: string; readonly label?: string },
  lengthMeters: number,
): string {
  return `${geodesic.label ?? geodesic.geodesicId} length = ${formatMeters(lengthMeters)}`;
}

function createMeasuredGeodesicLengthObjectAtSegment(options: {
  readonly id: string;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly label?: string;
  readonly playerPoint: Vec3;
  readonly segment: GeodesicSegmentObject;
}): MeasuredGeodesicLengthObject {
  // Orthogonal projection of the player onto the segment's line, clamped to the segment so the label always sits on the drawn geodesic.
  const distanceMeters = getDistanceAlongSegment(options.segment, options.playerPoint);
  const clampedDistanceMeters = Math.min(options.segment.lengthMeters, Math.max(0, distanceMeters));
  const labelPoint = getPointOnSegment(options.segment, clampedDistanceMeters);
  const yawRadians = resolveLabelYawFacingPoint(labelPoint, options.playerPoint, options.segment);

  return withMeasuredGeodesicLengthTooltip({
    id: options.id,
    kind: "measured-geodesic-length",
    cellId: options.segment.cellId,
    localPose: yawRigidTransform3(yawRadians, labelPoint),
    aimStickyTarget: {
      localPoint: labelPoint,
    },
    portalRenderable: true,
    geodesicId: options.geodesicId,
    label: options.label,
    lengthMeters: getGeodesicTotalLengthMeters(options.registry, options.geodesicId),
    labelPoint,
    segmentId: options.segment.id,
  });
}

function withMeasuredGeodesicLengthTooltip(
  object: Omit<MeasuredGeodesicLengthObject, "tooltip">,
): MeasuredGeodesicLengthObject {
  const label = formatMeasuredGeodesicLengthLabel(object, object.lengthMeters);
  return {
    ...object,
    displayHelpMessage: "A persistent length result attached to a geodesic. Use the primary action to remove it.",
    tooltip: {
      label,
      rangeMeters: 3,
    },
  };
}

// Most portals between the player's cell and a segment that may still make that segment the nearest one.
const closestSegmentMaxHops = 2;

// The segment of the geodesic nearest the player, and the player's point in that segment's cell frame. Without the world only the player's
// own cell is searched. With it, segments seen through the portals of the player's cell are searched too, each measured in the player's
// frame (the player's point mapped into the segment's cell), so the nearest one changes continuously as the player moves, also when
// the player crosses into the next cell.
function findClosestGeodesicSegment(
  registry: RuntimeObjectRegistry,
  world: CompiledCellComplex | undefined,
  geodesicId: string,
  cellId: string,
  point: Vec3,
): { readonly segment: GeodesicSegmentObject; readonly playerPoint: Vec3 } | undefined {
  const segments = registry.getAll().filter((object): object is GeodesicSegmentObject =>
    object.kind === "geodesicModel/segment" && object.geodesicId === geodesicId
  );
  const images = world
    ? enumerateCellImages(world, cellId, closestSegmentMaxHops)
    : [{ cellId, cellFromStart: identityRigidTransform3, hops: 0 }];
  let best: { readonly segment: GeodesicSegmentObject; readonly playerPoint: Vec3; readonly distanceSquared: number } | undefined;

  for (const image of images) {
    const playerPoint = transformPoint3(image.cellFromStart, point);
    for (const segment of segments) {
      if (segment.cellId !== image.cellId) {
        continue;
      }
      const distance = distanceSquared(playerPoint, getClosestPointOnSegment(segment, playerPoint));
      if (!best || distance < best.distanceSquared) {
        best = { segment, playerPoint, distanceSquared: distance };
      }
    }
  }

  return best;
}

function getGeodesicTotalLengthMeters(registry: RuntimeObjectRegistry, geodesicId: string): number {
  return registry.getAll()
    .filter((object): object is GeodesicSegmentObject =>
      object.kind === "geodesicModel/segment" && object.geodesicId === geodesicId
    )
    .reduce((total, segment) => total + segment.lengthMeters, 0);
}

function getClosestPointOnSegment(segment: GeodesicSegmentObject, point: Vec3): Vec3 {
  const distanceMeters = getDistanceAlongSegment(segment, point);
  return getPointOnSegment(segment, Math.min(segment.lengthMeters, Math.max(0, distanceMeters)));
}

function getDistanceAlongSegment(segment: GeodesicSegmentObject, point: Vec3): number {
  // Signed arclength coordinate of the projection onto the segment (direction is unit length).
  return (point.x - segment.start.x) * segment.direction.x +
    (point.y - segment.start.y) * segment.direction.y +
    (point.z - segment.start.z) * segment.direction.z;
}

function getPointOnSegment(segment: GeodesicSegmentObject, distanceMeters: number): Vec3 {
  return {
    x: segment.start.x + segment.direction.x * distanceMeters,
    y: segment.start.y + segment.direction.y * distanceMeters,
    z: segment.start.z + segment.direction.z * distanceMeters,
  };
}

function resolveLabelYawFacingPoint(labelPoint: Vec3, targetPoint: Vec3, fallbackSegment: GeodesicSegmentObject): number {
  const dx = targetPoint.x - labelPoint.x;
  const dy = targetPoint.y - labelPoint.y;
  // Yaw (atan2(y, x), counterclockwise from cell +x) that turns the label towards the player in the horizontal plane; degenerate case falls back to the segment direction.
  if (Math.hypot(dx, dy) > 1e-6) {
    return Math.atan2(dy, dx);
  }

  return Math.atan2(fallbackSegment.direction.y, fallbackSegment.direction.x);
}

function distanceSquared(left: Vec3, right: Vec3): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
}

function formatMeters(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text} m`;
}
