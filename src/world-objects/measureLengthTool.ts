/**
 * Measured-length tool: persistent "geodesic length = N m" labels attached to a geodesic.
 * A geodesic (GeodesicIntervalObject) is rendered as a chain of straight GeodesicSegmentObjects, one run per cell it passes through, joined at portals; the measured length is the sum of `lengthMeters` over all registry segments with that `geodesicId`, i.e. the true intrinsic length along the geodesic through portals, not a Euclidean distance within one cell.
 * The label object is placed in the cell-local frame (meters) at the point of the segment, in the player's current cell, nearest to the player, and is refreshed as the geodesic is extended, rebuilt or the player moves.
 */
import { yawRigidTransform3 } from "../math/rigidTransform3";
import type { Vec3 } from "../math/vec3";
import type { GeodesicSegmentObject } from "./geodesic/objects";
import type { RuntimeObjectRegistry, RuntimeWorldObjectBase } from "./runtimeObjectRegistry";

/**
 * Registry record for a length label attached to a geodesic.
 * `lengthMeters` is the total length of all segments of `geodesicId` (across every cell), while `labelPoint` and `segmentId` identify where, in `cellId`'s frame, the label is anchored.
 */
export interface MeasuredGeodesicLengthObject extends RuntimeWorldObjectBase {
  readonly kind: "measured-geodesic-length";
  /** Id of the measured geodesic interval. */
  readonly geodesicId: string;
  /** Optional display name used in place of `geodesicId` in the label text. */
  readonly label?: string;
  /** Total length of the geodesic in meters, summed over all of its segments in every cell. */
  readonly lengthMeters: number;
  /** Anchor point of the label in the cell-local frame of `cellId` (meters), lying on the anchoring segment. */
  readonly labelPoint: Vec3;
  /** Id of the segment (in `cellId`) the label is anchored to. */
  readonly segmentId?: string;
}

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
  readonly label?: string;
  readonly fallbackSegment?: GeodesicSegmentObject;
}): MeasuredGeodesicLengthObject | undefined {
  const segment = findClosestGeodesicSegmentInCell(
    options.registry,
    options.geodesicId,
    options.playerCellId,
    options.playerPoint,
  ) ?? options.fallbackSegment;
  if (!segment) {
    return undefined;
  }

  return createMeasuredGeodesicLengthObjectAtSegment({
    id: options.id,
    registry: options.registry,
    geodesicId: options.geodesicId,
    label: options.label,
    playerPoint: options.playerPoint,
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
}): MeasuredGeodesicLengthObject | undefined {
  const lengthMeters = getGeodesicTotalLengthMeters(options.registry, options.measurement.geodesicId);
  if (!(lengthMeters > 0)) {
    return undefined;
  }

  const closestSegment = findClosestGeodesicSegmentInCell(
    options.registry,
    options.measurement.geodesicId,
    options.playerCellId,
    options.playerPoint,
  );
  if (!closestSegment) {
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
    playerPoint: options.playerPoint,
    segment: closestSegment,
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

function findClosestGeodesicSegmentInCell(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  cellId: string,
  point: Vec3,
): GeodesicSegmentObject | undefined {
  return registry.getAll()
    .filter((object): object is GeodesicSegmentObject =>
      object.kind === "geodesic-segment" &&
      object.geodesicId === geodesicId &&
      object.cellId === cellId
    )
    .map((segment) => ({
      segment,
      distanceSquared: distanceSquared(point, getClosestPointOnSegment(segment, point)),
    }))
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.segment;
}

function getGeodesicTotalLengthMeters(registry: RuntimeObjectRegistry, geodesicId: string): number {
  return registry.getAll()
    .filter((object): object is GeodesicSegmentObject =>
      object.kind === "geodesic-segment" && object.geodesicId === geodesicId
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
