/**
 * Protractor tool: persistent angle measurements between two geodesic directions at a common vertex.
 * A protractor angle is anchored at a centre object (a geodesic cannon/emitter or a geodesic-intersection object) in one cell. It measures the angle, at that point, between two geodesic rays leaving the point, each given as a "directed geodesic": the horizontal direction of a geodesic segment through the vertex (forward or backward along the segment) or the aim direction of an emitter attached to the vertex. Everything lives in a single cell's local frame, so no portal transport is involved: both rays are expressed in the vertex cell.
 * Angles are radians (degrees stored alongside for display); yaw here is atan2(y, x), counterclockwise from cell-local +x viewed from above, and vertical components of directions are ignored. The measured angle is counterclockwise from the first ray to the second, in [0, 2π).
 */
import { yawRigidTransform3 } from "../math/rigidTransform3";
import { dotVec3, type Vec3 } from "../math/vec3";
import {
  getGeodesicEndpointAttachmentsForAnchor,
  geodesicRayBeamHeightMeters,
  getRememberedGeodesicIntersectionObject,
  resolveEndpointTangentAtAnchor,
  type GeodesicEndRole,
  type GeodesicCannonObject,
  type GeodesicIntersectionObject,
  type GeodesicSegmentObject,
} from "./geodesicCannon";
import type { RuntimeObjectRegistry, RuntimeWorldObjectBase } from "./runtimeObjectRegistry";

/**
 * Radius in meters of the drawn angle arc; also the maximum distance from the centre to a segment for that segment to be selectable as an angle side, and the tolerance for treating the centre as a segment endpoint.
 */
export const protractorAngleRadiusMeters = 0.3;
/**
 * Width in meters of the angle label badge as drawn.
 */
export const protractorAngleLabelBadgeWidthMeters = 0.42;
/**
 * Height in meters of the angle label badge as drawn.
 */
export const protractorAngleLabelBadgeHeightMeters = 0.1575;
/**
 * Height in meters by which the label sits above the centre point.
 */
export const protractorAngleLabelVerticalOffsetMeters = 0.3;
/**
 * Padding in meters added on each side of the badge to form the (more forgiving) aiming hitbox.
 */
export const protractorAngleLabelAimPaddingMeters = 0.04;
/**
 * Thickness in meters of the label's aiming hitbox along its normal.
 */
export const protractorAngleLabelAimDepthMeters = 0.12;

/**
 * Registry record for a persistent angle measurement.
 * `localPose` is the centre point with the first ray's yaw, `cellId` is the centre's cell, and all points are in that cell's local frame (meters). `angleRadians` is counterclockwise from `first` to `second` in [0, 2π).
 */
export interface ProtractorAngleObject extends RuntimeWorldObjectBase {
  readonly kind: "protractor-angle";
  /** Id of the cannon or intersection object at the vertex; the angle is recomputed from it on refresh. */
  readonly centerObjectId: string;
  /** Vertex position in the cell-local frame (meters). */
  readonly centerPoint: Vec3;
  /** First side; the angle is measured counterclockwise from this ray. */
  readonly first: ProtractorDirectedGeodesic;
  /** Second side; the angle ends at this ray. */
  readonly second: ProtractorDirectedGeodesic;
  /** Counterclockwise angle from `first` to `second`, in [0, 2π). */
  readonly angleRadians: number;
  /** `angleRadians` converted to degrees, for display. */
  readonly angleDegrees: number;
  /** Arc radius in meters used for drawing and label placement. */
  readonly radiusMeters: number;
  /** Aiming box around the label, used to select the measurement for removal. */
  readonly labelHitbox?: ProtractorAngleLabelHitbox;
}

/**
 * Oriented box around an angle label used for aim picking, in the vertex cell's local frame.
 * `center` is in meters, `yawRadians` rotates the box about +z, and the three extents are full widths in meters.
 */
export interface ProtractorAngleLabelHitbox {
  readonly center: Vec3;
  readonly yawRadians: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly depthMeters: number;
}

/**
 * The vertex chosen as the centre of an angle: where it is, which cell, and which geodesics pass through it.
 * `point` is in `cellId`'s local frame (meters); `geodesicIds` are the geodesics whose rays may be chosen as sides.
 */
export interface ProtractorCenterSelection {
  readonly objectId: string;
  readonly cellId: string;
  readonly point: Vec3;
  readonly geodesicIds: readonly string[];
}

/**
 * One side of an angle: a geodesic ray leaving the vertex.
 * Identifies the geodesic (and which end of it, for emitter endpoints), the segment or emitter used to read the direction, and the resolved horizontal yaw of the ray.
 */
export interface ProtractorDirectedGeodesic {
  readonly geodesicId: string;
  /** Which end of the geodesic interval this ray belongs to (start or end half), when relevant; two sides of the same geodesic are distinct only if their end roles differ. */
  readonly endRole?: GeodesicEndRole;
  readonly label?: string;
  /** Registry id of the segment this ray was read from, or a synthetic "<emitterId>:<geodesicId>:emitter" id for rays defined by an emitter's aim. */
  readonly segmentId: string;
  /** Direction of the ray as atan2(y, x) in the vertex cell's frame, normalised to (-π, π]. */
  readonly yawRadians: number;
  /** +1 if the ray points along the segment's stored direction, -1 if against it (pointing back towards the segment start). */
  readonly directionSign?: 1 | -1;
}

/**
 * Builds the centre selection for a cannon or intersection object.
 * The centre point is the object's `aimStickyTarget` if present, otherwise its pose translation (raised by the ray beam height for cannons so it lies on the drawn beam).
 */
export function resolveProtractorCenterSelection(
  object: GeodesicCannonObject | GeodesicIntersectionObject,
): ProtractorCenterSelection {
  return {
    objectId: object.id,
    cellId: object.cellId,
    point: resolveProtractorCenterPoint(object),
    geodesicIds: object.geodesicIds,
  };
}

function resolveProtractorCenterPoint(object: GeodesicCannonObject | GeodesicIntersectionObject): Vec3 {
  if (object.aimStickyTarget?.localPoint) {
    return object.aimStickyTarget.localPoint;
  }

  return {
    x: object.localPose.translation.x,
    y: object.localPose.translation.y,
    z: object.localPose.translation.z + (object.kind === "geodesic-cannon" ? geodesicRayBeamHeightMeters : 0),
  };
}

/**
 * Resolves a clicked geodesic segment into a ray leaving the centre, or undefined if the segment is not a valid side.
 * Valid only if the segment is in the centre's cell, belongs to one of the centre's geodesics, and passes within `protractorAngleRadiusMeters` of the centre. The ray points forward (+1) when the centre lies within that distance of the segment start, backward (-1) when within it of the segment end (the start test wins on very short segments), and otherwise towards the side of the centre that `hitPoint` was clicked on.
 */
export function resolveProtractorDirectedGeodesicSelection(options: {
  readonly center: ProtractorCenterSelection;
  readonly segment: GeodesicSegmentObject;
  readonly hitPoint: Vec3;
}): ProtractorDirectedGeodesic | undefined {
  const { center, segment, hitPoint } = options;
  if (center.cellId !== segment.cellId || !center.geodesicIds.includes(segment.geodesicId)) {
    return undefined;
  }

  // Distance of the centre's projection along the segment, clamped below to find the nearest point on the finite segment.
  const centerDistance = getDistanceAlongSegment(segment, center.point);
  const clampedCenterDistance = Math.min(segment.lengthMeters, Math.max(0, centerDistance));
  const nearestPoint = getPointOnSegment(segment, clampedCenterDistance);
  if (distance2(center.point, nearestPoint) > protractorAngleRadiusMeters * protractorAngleRadiusMeters) {
    return undefined;
  }

  // Horizontal offset of the click from the vertex; its dot with the segment direction says which side of the vertex was picked.
  const hitOffset = {
    x: hitPoint.x - center.point.x,
    y: hitPoint.y - center.point.y,
    z: 0,
  };
  const hitDirectionDot = dotVec3(hitOffset, segment.direction);
  const sign = resolveSelectedSegmentDirectionSign(segment, centerDistance, hitDirectionDot);
  const yawRadians = normalizeSignedRadians(
    Math.atan2(segment.direction.y * sign, segment.direction.x * sign),
  );

  return {
    geodesicId: segment.geodesicId,
    endRole: segment.halfRole,
    segmentId: segment.id,
    yawRadians,
    directionSign: sign,
  };
}

/**
 * Resolves an emitter at the centre into a ray along one of its geodesics, or undefined if it is not in the centre's cell or shares no geodesic with it.
 * The geodesic defaults to the emitter's active one, else the first shared one. Direction priority: the endpoint tangent read from the registry (when the attached end can be determined), then the emitter's stored per-geodesic yaw, then its aim yaw. The direction sign is always +1 and the segment id is synthetic.
 */
export function resolveProtractorEmitterGeodesicSelection(options: {
  readonly center: ProtractorCenterSelection;
  readonly emitter: GeodesicCannonObject;
  readonly registry?: RuntimeObjectRegistry;
  readonly geodesicId?: string;
  readonly endRole?: GeodesicEndRole;
}): ProtractorDirectedGeodesic | undefined {
  const { center, emitter } = options;
  if (center.cellId !== emitter.cellId) {
    return undefined;
  }

  const geodesicId = options.geodesicId ??
    emitter.activeGeodesicId ??
    emitter.geodesicIds.find((candidate) => center.geodesicIds.includes(candidate));
  if (!geodesicId || !center.geodesicIds.includes(geodesicId) || !emitter.geodesicIds.includes(geodesicId)) {
    return undefined;
  }

  const selectedEndRole = options.registry
    ? selectEmitterEndpointRole({
      registry: options.registry,
      emitterId: emitter.id,
      geodesicId,
      endRole: options.endRole,
    })
    : options.endRole;
  const tangent = options.registry && selectedEndRole
    ? resolveEndpointTangentAtAnchor({
      registry: options.registry,
      geodesicId,
      endRole: selectedEndRole,
    })
    : undefined;
  return {
    geodesicId,
    ...(selectedEndRole ? { endRole: selectedEndRole } : {}),
    segmentId: `${emitter.id}:${geodesicId}:emitter`,
    yawRadians: normalizeSignedRadians(tangent?.yawRadians ?? emitter.geodesicEmitterYawRadiansById?.[geodesicId] ?? emitter.aimYawRadians),
    directionSign: 1,
  };
}

/**
 * Creates an angle measurement between two rays at a centre.
 * Throws if both sides refer to the same geodesic end. The angle is `second.yaw - first.yaw` reduced to [0, 2π), i.e. counterclockwise from the first ray to the second (so swapping the sides gives 2π minus the angle).
 */
export function createProtractorAngleObject(options: {
  readonly id: string;
  readonly center: ProtractorCenterSelection;
  readonly first: ProtractorDirectedGeodesic;
  readonly second: ProtractorDirectedGeodesic;
}): ProtractorAngleObject {
  if (!protractorSelectionsUseDifferentGeodesics(options.first, options.second)) {
    throw new Error("Cannot create a protractor angle from the same geodesic endpoint twice.");
  }

  const angleRadians = normalizePositiveRadians(options.second.yawRadians - options.first.yawRadians);
  const angleDegrees = angleRadians * 180 / Math.PI;
  const label = formatProtractorAngleLabel(options.first, options.second, angleDegrees);
  const labelHitbox = createProtractorAngleLabelHitbox({
    centerPoint: options.center.point,
    firstYawRadians: options.first.yawRadians,
    angleRadians,
    radiusMeters: protractorAngleRadiusMeters,
  });

  return {
    id: options.id,
    kind: "protractor-angle",
    cellId: options.center.cellId,
    localPose: yawRigidTransform3(options.first.yawRadians, options.center.point),
    aimStickyTarget: {
      localPoint: labelHitbox.center,
    },
    portalRenderable: true,
    displayHelpMessage: "A persistent angle result between two selected geodesic sides. Use the primary action to remove it.",
    tooltip: {
      label,
      rangeMeters: 3,
    },
    centerObjectId: options.center.objectId,
    centerPoint: options.center.point,
    first: options.first,
    second: options.second,
    angleRadians,
    angleDegrees,
    radiusMeters: protractorAngleRadiusMeters,
    labelHitbox,
  };
}

/**
 * Returns true when two sides differ in geodesic id or end role, i.e. they are not the same geodesic end selected twice.
 */
export function protractorSelectionsUseDifferentGeodesics(
  first: Pick<ProtractorDirectedGeodesic, "geodesicId" | "endRole">,
  second: Pick<ProtractorDirectedGeodesic, "geodesicId" | "endRole">,
): boolean {
  return first.geodesicId !== second.geodesicId || first.endRole !== second.endRole;
}

/**
 * Computes the aiming hitbox for the label of an angle.
 * The box is centred at `radiusMeters` from the vertex along the angle bisector, raised by the label vertical offset, and oriented perpendicular to the bisector; its size is the badge plus padding.
 */
export function createProtractorAngleLabelHitbox(options: {
  readonly centerPoint: Vec3;
  readonly firstYawRadians: number;
  readonly angleRadians: number;
  readonly radiusMeters: number;
}): ProtractorAngleLabelHitbox {
  const bisectorYawRadians = normalizeSignedRadians(options.firstYawRadians + options.angleRadians / 2);
  return {
    center: {
      x: options.centerPoint.x + Math.cos(bisectorYawRadians) * options.radiusMeters,
      y: options.centerPoint.y + Math.sin(bisectorYawRadians) * options.radiusMeters,
      z: options.centerPoint.z + protractorAngleLabelVerticalOffsetMeters,
    },
    yawRadians: normalizeSignedRadians(bisectorYawRadians + Math.PI / 2),
    widthMeters: protractorAngleLabelBadgeWidthMeters + protractorAngleLabelAimPaddingMeters * 2,
    heightMeters: protractorAngleLabelBadgeHeightMeters + protractorAngleLabelAimPaddingMeters * 2,
    depthMeters: protractorAngleLabelAimDepthMeters,
  };
}

/**
 * Recomputes an angle from the live registry after geodesics or emitters have moved.
 * Re-resolves the centre and both sides (matching segments by id, else by nearest segment of the same geodesic/end role near the centre). Returns undefined if a side can no longer be found; if the centre object is gone but a remembered intersection still exists, returns the angle unchanged but not portal-renderable.
 */
export function refreshProtractorAngleObject(options: {
  readonly registry: RuntimeObjectRegistry;
  readonly angle: ProtractorAngleObject;
}): ProtractorAngleObject | undefined {
  const centerObject = options.registry.get(options.angle.centerObjectId);
  if (centerObject?.kind !== "geodesic-cannon" && centerObject?.kind !== "geodesic-intersection") {
    const rememberedCenter = getRememberedGeodesicIntersectionObject(options.registry, options.angle.centerObjectId);
    return rememberedCenter ? {
      ...options.angle,
      portalRenderable: false,
    } : undefined;
  }

  const center = resolveProtractorCenterSelection(centerObject);
  const first = resolveLiveProtractorDirectedGeodesic(options.registry, center, options.angle.first);
  const second = resolveLiveProtractorDirectedGeodesic(options.registry, center, options.angle.second);
  if (!first || !second) {
    return undefined;
  }

  return createProtractorAngleObject({
    id: options.angle.id,
    center,
    first,
    second,
  });
}

/**
 * Formats the label text "<first> ∠ <second> = <degrees>°".
 * Names are the sides' labels or geodesic ids; degrees are rounded to one decimal.
 */
export function formatProtractorAngleLabel(
  first: Pick<ProtractorDirectedGeodesic, "geodesicId" | "label">,
  second: Pick<ProtractorDirectedGeodesic, "geodesicId" | "label">,
  angleDegrees: number,
): string {
  return `${formatGeodesicLabel(first)} ∠ ${formatGeodesicLabel(second)} = ${formatDegrees(angleDegrees)}°`;
}

function getDistanceAlongSegment(segment: GeodesicSegmentObject, point: Vec3): number {
  return (point.x - segment.start.x) * segment.direction.x +
    (point.y - segment.start.y) * segment.direction.y +
    (point.z - segment.start.z) * segment.direction.z;
}

function resolveLiveProtractorDirectedGeodesic(
  registry: RuntimeObjectRegistry,
  center: ProtractorCenterSelection,
  previous: ProtractorDirectedGeodesic,
): ProtractorDirectedGeodesic | undefined {
  const emitter = resolveEmitterSelectionObject(registry, previous);
  if (emitter) {
    const selected = resolveProtractorEmitterGeodesicSelection({
      center,
      emitter,
      registry,
      geodesicId: previous.geodesicId,
      endRole: previous.endRole,
    });
    return selected ? { ...selected, label: previous.label } : undefined;
  }

  const segment = resolveSegmentSelectionObject(registry, center, previous);
  if (!segment) {
    return undefined;
  }

  return {
    geodesicId: segment.geodesicId,
    endRole: previous.endRole ?? segment.halfRole,
    label: previous.label,
    segmentId: segment.id,
    yawRadians: resolveSegmentYawFromCenter(segment, center, previous),
    directionSign: resolveSegmentDirectionSign(segment, center, previous),
  };
}

function resolveEmitterSelectionObject(
  registry: RuntimeObjectRegistry,
  previous: ProtractorDirectedGeodesic,
): GeodesicCannonObject | undefined {
  const suffix = `:${previous.geodesicId}:emitter`;
  if (!previous.segmentId.endsWith(suffix)) {
    return undefined;
  }

  const object = registry.get(previous.segmentId.slice(0, -suffix.length));
  return object?.kind === "geodesic-cannon" ? object : undefined;
}

function selectEmitterEndpointRole(options: {
  readonly registry: RuntimeObjectRegistry;
  readonly emitterId: string;
  readonly geodesicId: string;
  readonly endRole?: GeodesicEndRole;
}): GeodesicEndRole | undefined {
  const attachments = getGeodesicEndpointAttachmentsForAnchor(options.registry, options.emitterId)
    .filter((attachment) => attachment.geodesicId === options.geodesicId);
  if (options.endRole && attachments.some((attachment) => attachment.role === options.endRole)) {
    return options.endRole;
  }
  return attachments[0]?.role;
}

function resolveSegmentSelectionObject(
  registry: RuntimeObjectRegistry,
  center: ProtractorCenterSelection,
  previous: ProtractorDirectedGeodesic,
): GeodesicSegmentObject | undefined {
  const current = registry.get(previous.segmentId);
  if (
    current?.kind === "geodesic-segment" &&
    (previous.endRole === undefined || current.halfRole === previous.endRole) &&
    segmentCanAnchorProtractorSelection(center, current)
  ) {
    return current;
  }

  return registry.getAll()
    .filter((object): object is GeodesicSegmentObject => object.kind === "geodesic-segment")
    .filter((segment) =>
      segment.geodesicId === previous.geodesicId &&
      (previous.endRole === undefined || segment.halfRole === previous.endRole) &&
      segmentCanAnchorProtractorSelection(center, segment)
    )
    .sort((left, right) =>
      Math.abs(getDistanceAlongSegment(left, center.point)) -
      Math.abs(getDistanceAlongSegment(right, center.point))
    )[0];
}

function segmentCanAnchorProtractorSelection(
  center: ProtractorCenterSelection,
  segment: GeodesicSegmentObject,
): boolean {
  if (center.cellId !== segment.cellId || !center.geodesicIds.includes(segment.geodesicId)) {
    return false;
  }

  const centerDistance = getDistanceAlongSegment(segment, center.point);
  const clampedCenterDistance = Math.min(segment.lengthMeters, Math.max(0, centerDistance));
  return distance2(center.point, getPointOnSegment(segment, clampedCenterDistance)) <=
    protractorAngleRadiusMeters * protractorAngleRadiusMeters;
}

function resolveSegmentYawFromCenter(
  segment: GeodesicSegmentObject,
  center: ProtractorCenterSelection,
  previous: ProtractorDirectedGeodesic,
): number {
  const sign = resolveSegmentDirectionSign(segment, center, previous);
  return normalizeSignedRadians(Math.atan2(segment.direction.y * sign, segment.direction.x * sign));
}

function resolveSegmentDirectionSign(
  segment: GeodesicSegmentObject,
  center: ProtractorCenterSelection,
  previous: ProtractorDirectedGeodesic,
): 1 | -1 {
  if (previous.directionSign) {
    return previous.directionSign;
  }

  const centerDistance = getDistanceAlongSegment(segment, center.point);
  const endpointSign = resolveSegmentEndpointDirectionSign(segment, centerDistance);
  if (endpointSign) {
    return endpointSign;
  }

  const forwardYaw = normalizeSignedRadians(Math.atan2(segment.direction.y, segment.direction.x));
  const backwardYaw = normalizeSignedRadians(forwardYaw + Math.PI);
  return Math.abs(normalizeSignedRadians(forwardYaw - previous.yawRadians)) <=
      Math.abs(normalizeSignedRadians(backwardYaw - previous.yawRadians))
    ? 1
    : -1;
}

function resolveSelectedSegmentDirectionSign(
  segment: GeodesicSegmentObject,
  centerDistance: number,
  hitDirectionDot: number,
): 1 | -1 {
  const endpointSign = resolveSegmentEndpointDirectionSign(segment, centerDistance);
  if (endpointSign) {
    return endpointSign;
  }

  return toDirectionSign(Math.abs(hitDirectionDot) > 1e-6 ? Math.sign(hitDirectionDot) : 1);
}

function resolveSegmentEndpointDirectionSign(
  segment: GeodesicSegmentObject,
  centerDistance: number,
): 1 | -1 | undefined {
  const endpointToleranceMeters = protractorAngleRadiusMeters;
  if (centerDistance <= endpointToleranceMeters) {
    return 1;
  }
  if (centerDistance >= segment.lengthMeters - endpointToleranceMeters) {
    return -1;
  }

  return undefined;
}

function getPointOnSegment(segment: GeodesicSegmentObject, distanceMeters: number): Vec3 {
  return {
    x: segment.start.x + segment.direction.x * distanceMeters,
    y: segment.start.y + segment.direction.y * distanceMeters,
    z: segment.start.z + segment.direction.z * distanceMeters,
  };
}

function distance2(left: Vec3, right: Vec3): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
}

// Reduces an angle to [0, 2π).
function normalizePositiveRadians(radians: number): number {
  const twoPi = Math.PI * 2;
  return ((radians % twoPi) + twoPi) % twoPi;
}

// Reduces an angle to (-π, π] via atan2, which is robust to large multiples of 2π.
function normalizeSignedRadians(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

function toDirectionSign(value: number): 1 | -1 {
  return value < 0 ? -1 : 1;
}

function formatDegrees(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatGeodesicLabel(geodesic: Pick<ProtractorDirectedGeodesic, "geodesicId" | "label">): string {
  return geodesic.label ?? geodesic.geodesicId;
}
