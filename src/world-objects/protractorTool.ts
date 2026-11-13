/**
 * Protractor tool: persistent angle measurements between two geodesic directions at a common vertex.
 * A protractor angle is anchored at a centre object (a geodesic cannon/emitter or a geodesicModel/crossing object) in one cell. It measures the angle, at that point, between two geodesic rays leaving the point, each given as a "directed geodesic": the horizontal direction of a geodesic segment through the vertex (forward or backward along the segment) or the aim direction of an emitter attached to the vertex. Everything lives in a single cell's local frame, so no portal transport is involved: both rays are expressed in the vertex cell.
 * Angles are radians (degrees stored alongside for display); yaw here is atan2(y, x), counterclockwise from cell-local +x viewed from above, and vertical components of directions are ignored. The measured angle is counterclockwise from the first ray to the second, in [0, 2π).
 */
import { yawRigidTransform3 } from "../math/rigidTransform3";
import { dotVec3, type Vec3 } from "../math/vec3";
import {
  geodesicRayBeamHeightMeters,
  type GeodesicEndRole,
  type GeodesicEmitterObject,
  type GeodesicCrossingObject,
  type GeodesicSegmentObject,
} from "./geodesic/objects";
import { findGeodesicIntersectionNear, getRememberedGeodesicIntersectionObject } from "./geodesic/intersections";
import { getEmitterGeodesicIds, getGeodesicEndpointAttachmentsForAnchor } from "./geodesic/endpoints";
import { resolveEndpointTangentAtAnchor } from "./geodesic/segments";
import { geodesicDisplayName } from "./measureLengthTool";
import type { RuntimeObjectReader, RuntimeObjectRegistry } from "./runtimeObjectRegistry";
import type {
  ProtractorAngleLabelHitbox,
  ProtractorAngleObject,
  ProtractorDirectedGeodesic,
} from "./toolObjects";

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
 * World seconds an angle waits for its crossing after the aiming stopped (design 013 section 17, item 6).
 */
export const vanishedAngleSeconds = 3;

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
 * Selections made so far by the protractor tool: the centre vertex, then the first side. Empty when the tool is idle.
 */
export interface ProtractorToolState {
  readonly center?: ProtractorCenterSelection;
  readonly first?: ProtractorDirectedGeodesic;
}

/**
 * Builds the centre selection for a cannon or intersection object.
 * The centre point is the object's `aimStickyTarget` if present, otherwise its pose translation (raised by the ray beam height for cannons so it lies on the drawn beam).
 */
export function resolveProtractorCenterSelection(
  registry: RuntimeObjectReader,
  object: GeodesicEmitterObject | GeodesicCrossingObject,
): ProtractorCenterSelection {
  return {
    objectId: object.id,
    cellId: object.cellId,
    point: resolveProtractorCenterPoint(object),
    geodesicIds: object.kind === "geodesicEmitters/emitter" ? getEmitterGeodesicIds(registry, object.id) : object.geodesicIds,
  };
}

function resolveProtractorCenterPoint(object: GeodesicEmitterObject | GeodesicCrossingObject): Vec3 {
  if (object.aimStickyTarget?.localPoint) {
    return object.aimStickyTarget.localPoint;
  }

  return {
    x: object.localPose.translation.x,
    y: object.localPose.translation.y,
    z: object.localPose.translation.z + (object.kind === "geodesicEmitters/emitter" ? geodesicRayBeamHeightMeters : 0),
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
 * The geodesic defaults to the first one the centre lists. Direction priority: the endpoint tangent read from the registry (when the attached end can be determined), then the emitter's aim yaw. The direction sign is always +1 and the segment id is synthetic.
 */
export function resolveProtractorEmitterGeodesicSelection(options: {
  readonly center: ProtractorCenterSelection;
  readonly emitter: GeodesicEmitterObject;
  readonly registry?: RuntimeObjectReader;
  readonly geodesicId?: string;
  readonly endRole?: GeodesicEndRole;
}): ProtractorDirectedGeodesic | undefined {
  const { center, emitter } = options;
  if (center.cellId !== emitter.cellId) {
    return undefined;
  }

  const geodesicId = options.geodesicId ?? center.geodesicIds[0];
  if (!geodesicId || !center.geodesicIds.includes(geodesicId)) {
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
    yawRadians: normalizeSignedRadians(tangent?.yawRadians ?? emitter.aimYawRadians),
    directionSign: 1,
  };
}

/**
 * Reads a side off a thing aimed at: a segment through the centre, or an emitter at it, named by a person with its geodesic's display name; undefined for anything else.
 * `objectId` is the thing hit, `point` where (in its cell's frame), `emitterGeodesicId` the geodesic of an emitter the aim points along.
 */
export function resolveProtractorSideAt(
  registry: RuntimeObjectReader,
  center: ProtractorCenterSelection,
  at: { readonly objectId?: string; readonly point: Vec3; readonly emitterGeodesicId?: string },
): ProtractorDirectedGeodesic | undefined {
  const object = at.objectId === undefined ? undefined : registry.get(at.objectId);
  const selected = object?.kind === "geodesicModel/segment"
    ? resolveProtractorDirectedGeodesicSelection({ center, segment: object, hitPoint: at.point })
    : object?.kind === "geodesicEmitters/emitter"
      ? resolveProtractorEmitterGeodesicSelection({ center, emitter: object, registry, geodesicId: at.emitterGeodesicId })
      : undefined;
  return selected === undefined ? undefined : { ...selected, label: geodesicDisplayName(registry, selected.geodesicId) };
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
    kind: "geodesicMeasurements/angle",
    cellId: options.center.cellId,
    localPose: yawRigidTransform3(options.first.yawRadians, options.center.point),
    aimStickyTarget: {
      localPoint: labelHitbox.center,
    },
    portalRenderable: true,
    displayHelpMessage: "A measurement of the angle between two beams. Use the primary action to delete it.",
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
 * Re-resolves the centre and both sides (matching segments by id, else by nearest segment of the same geodesic/end role near the centre). Returns undefined if a side can no longer be found; a side of an angle coming back from hidden may be found on the other half of its arc.
 * A centre that is gone is looked for again as a crossing of the two sides' geodesics near the last centre point: its id is not real state, so that is also what finds it after a load. A crossing that is not there hides the angle ({@link hiddenProtractorAngle}); a centre that was anything else takes the angle with it.
 */
export function refreshProtractorAngleObject(options: {
  readonly registry: RuntimeObjectRegistry;
  readonly angle: ProtractorAngleObject;
}): ProtractorAngleObject | undefined {
  const centerObject = resolveAngleCenterObject(options.registry, options.angle);
  if (centerObject === undefined) {
    return hiddenProtractorAngle(options.registry, options.angle);
  }

  const center = resolveProtractorCenterSelection(options.registry, centerObject);
  const returning = options.angle.vanishedSecondsLeft !== undefined;
  const first = resolveAngleSide(options.registry, center, options.angle.first, returning);
  const second = resolveAngleSide(options.registry, center, options.angle.second, returning);
  if (!first || !second || !protractorSelectionsUseDifferentGeodesics(first, second)) {
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
 * Resolves the two sides of a `createAngle` against the world, as a refresh does; undefined when one is not a ray of the centre.
 */
export function resolveProtractorSides(
  registry: RuntimeObjectRegistry,
  center: ProtractorCenterSelection,
  first: ProtractorDirectedGeodesic,
  second: ProtractorDirectedGeodesic,
): { readonly first: ProtractorDirectedGeodesic; readonly second: ProtractorDirectedGeodesic } | undefined {
  const liveFirst = resolveLiveProtractorDirectedGeodesic(registry, center, first);
  const liveSecond = resolveLiveProtractorDirectedGeodesic(registry, center, second);
  return liveFirst && liveSecond ? { first: liveFirst, second: liveSecond } : undefined;
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

// A side of an angle that returns with its crossing may find the crossing on the other half of its arc. The half was only where the side lay, so the side keeps what still means something there: its geodesic and its direction along it, towards the same end. `endRole` becomes the half it lies on now. Two sides that were told apart by their halves alone are then one side, and the refresh gives the angle up.
function resolveAngleSide(
  registry: RuntimeObjectRegistry,
  center: ProtractorCenterSelection,
  side: ProtractorDirectedGeodesic,
  returning: boolean,
): ProtractorDirectedGeodesic | undefined {
  const live = resolveLiveProtractorDirectedGeodesic(registry, center, side);
  return live === undefined && returning
    ? resolveLiveProtractorDirectedGeodesic(registry, center, { ...side, endRole: undefined })
    : live;
}

function resolveAngleCenterObject(registry: RuntimeObjectRegistry, angle: ProtractorAngleObject): GeodesicEmitterObject | GeodesicCrossingObject | undefined {
  const object = registry.get(angle.centerObjectId);
  if (object?.kind === "geodesicEmitters/emitter" || object?.kind === "geodesicModel/crossing") {
    return object;
  }

  return findGeodesicIntersectionNear(registry, {
    cellId: angle.cellId,
    geodesicIds: [angle.first.geodesicId, angle.second.geodesicId],
    point: angle.centerPoint,
  });
}

// The angle whose centre is not in the registry. A crossing that just vanished is still remembered, and an angle already waiting says so itself: the memory is a memo, and does not survive a load. Either way it waits, unless a side's geodesic is gone, when its crossing cannot return. Anything else, a removed emitter, takes the angle with it.
function hiddenProtractorAngle(registry: RuntimeObjectRegistry, angle: ProtractorAngleObject): ProtractorAngleObject | undefined {
  const waits = angle.vanishedSecondsLeft !== undefined || getRememberedGeodesicIntersectionObject(registry, angle.centerObjectId) !== undefined;
  if (!waits || registry.getSegmentsOfGeodesic(angle.first.geodesicId).length === 0 || registry.getSegmentsOfGeodesic(angle.second.geodesicId).length === 0) {
    return undefined;
  }

  return { ...angle, portalRenderable: false, vanishedSecondsLeft: angle.vanishedSecondsLeft ?? vanishedAngleSeconds };
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
): GeodesicEmitterObject | undefined {
  const suffix = `:${previous.geodesicId}:emitter`;
  if (!previous.segmentId.endsWith(suffix)) {
    return undefined;
  }

  const object = registry.get(previous.segmentId.slice(0, -suffix.length));
  return object?.kind === "geodesicEmitters/emitter" ? object : undefined;
}

function selectEmitterEndpointRole(options: {
  readonly registry: RuntimeObjectReader;
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
    current?.kind === "geodesicModel/segment" &&
    (previous.endRole === undefined || current.halfRole === previous.endRole) &&
    segmentCanAnchorProtractorSelection(center, current)
  ) {
    return current;
  }

  return registry.getSegmentsOfGeodesic(previous.geodesicId)
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
