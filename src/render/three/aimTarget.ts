/**
 * Crosshair aim picking: finds what the camera's centre ray hits, across portals.
 *
 * The camera ray is given in the root (Three.js) frame, then for every visible portal path whose clip polygon contains the
 * screen centre it is mapped into that path's destination cell (via the inverse of `rootFromDestinationMatrix`) and converted
 * to the cell-local world frame (x right, y forward, z up, meters). In each cell the ray is tested against the floor plane z = 0
 * (restricted to the cell polygon, minus forbidden singularity columns) and against analytic proxies of the runtime objects
 * (vertical cylinders, spheres, oriented boxes, capsules). Hits from all paths are merged and ordered by distance in the root
 * frame, with tolerance-based priority rules that prefer interactive things (protractor label, cannon, geodesic intersection,
 * geodesic segment) over nearly co-distant ones. Results carry both cell-local and root-frame points/normals.
 * Invariants: ray directions are unit length; rays are tested for positive distance only (hits within 1e-5 m are ignored);
 * geodesic-segment tests assume horizontal segment directions.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import { distanceVec3, dotVec3, normalizeVec3, subVec3, type Vec3 } from "../../math/vec3";
import { getDynamicObjectCollisionBounds, signedDistanceToSide, type SimpleCylinderBounds } from "../../movement/collision";
import { geodesicRayBeamHeightMeters, geodesicRayBeamStartOffsetMeters } from "../../world-objects/geodesicCannon";
import { createProtractorAngleLabelHitbox } from "../../world-objects/protractorTool";
import { runtimeObjectToDynamicObjectState, type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import type { VisiblePortalPath } from "./visiblePortalPaths";
import { threeDirectionToWorld, threePointToWorld, worldPointToThree } from "./worldAxes";

/** Whether an aim target is the floor or a world object. */
export type AimTargetKind = "floor" | "object";

/** One thing the aim ray hits, expressed both in the hit cell's local frame and in the root (viewer) frame. */
export interface AimTarget {
  readonly kind: AimTargetKind;
  /** Cell in which the hit was found (the destination cell of the visible portal path). */
  readonly cellId: string;
  /** Ray origin in the hit cell's local frame (the eye as seen through the portal path), meters. */
  readonly localEyePosition: Vec3;
  /** Aim point in the hit cell's local frame, meters; for objects this may be a sticky or centre target rather than the surface hit. */
  readonly localPoint: Vec3;
  /** Unit surface normal at the hit in the cell-local frame. */
  readonly localNormal: Vec3;
  /** `localPoint` mapped to the root world frame (world axes, meters) through the portal path. */
  readonly rootPoint: Vec3;
  /** `localNormal` mapped to the root world frame, normalized. */
  readonly rootNormal: Vec3;
  /** Distance from the eye to the surface hit measured in the root frame, meters. */
  readonly distanceMeters: number;
  /** Id of the visible portal path through which the target was reached. */
  readonly portalPathId: number;
  /** The hit object; absent for floor targets. */
  readonly object?: RuntimeWorldObject;
  /** For geodesic segments and cannon handles: arc-length position of the aimed point along the segment, clamped to [0, length], meters. */
  readonly geodesicSegmentDistanceMeters?: number;
  /** For cannon hits: the geodesic emitter id the player is aiming at (handle hit, else the active or first non-ignored geodesic). */
  readonly geodesicEmitterGeodesicId?: string;
}

/** Inputs for {@link resolveAimTarget} and {@link resolveAimTargets}. */
export interface ResolveAimTargetRequest {
  /** Compiled cell complex used to look up destination cells. */
  readonly world: CompiledCellComplex;
  /** Runtime objects, queried per cell. */
  readonly registry: RuntimeObjectRegistry;
  /** Camera whose world position and forward (-z) axis define the ray, in the root Three.js frame. */
  readonly camera: THREE.Camera;
  /** Visible portal paths; only those whose clip polygon contains the screen centre are tested. */
  readonly visiblePortalPaths: readonly VisiblePortalPath[];
  /** Maximum hit distance for floor and ordinary objects, meters (default 24). */
  readonly maxDistanceMeters?: number;
  /** Maximum hit distance for cannons, meters (default 200). */
  readonly maxEmitterDistanceMeters?: number;
  /** Geodesic ids whose segments, handles and emitters are skipped (e.g. the geodesic currently being manipulated). */
  readonly ignoredGeodesicIds?: readonly string[];
}

// The aim ray expressed in a destination cell's local world frame; origin/direction in meters/unit.
interface CellRay {
  readonly path: VisiblePortalPath;
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly rootFromCellMatrix: THREE.Matrix4;
}

// Result of one ray-vs-object test, in the cell-local frame. `point` is the surface hit (defaults to origin + distance * direction); `targetPoint` is where the aim should snap (e.g. centerline).
interface ObjectAimHit {
  readonly distance: number;
  readonly normal: Vec3;
  readonly point?: Vec3;
  readonly targetPoint?: Vec3;
  readonly geodesicSegmentDistanceMeters?: number;
  readonly geodesicEmitterGeodesicId?: string;
}

// The ray always goes through the screen centre (crosshair).
const centerNdc = { x: 0, y: 0 };
// Numerical epsilon (meters) for hit validity and containment tests.
const aimPointToleranceMeters = 1e-5;
// Targets closer than this (meters) to the nearest hit are ordered by kind priority instead of strict distance.
const aimTargetPriorityDistanceToleranceMeters = 0.4;
// Wider tolerance (meters) used when choosing between a geodesic segment/intersection and a cannon.
const geodesicSegmentVsEmitterPriorityDistanceToleranceMeters = 3;
// Sphere radius used for objects with no collision bounds.
const fallbackObjectRadiusMeters = 0.25;
// Padding added to the cannon's collision bounds to make the aim proxy easier to hit.
const geodesicEmitterAimCylinderRadiusPaddingMeters = 0.08;
const geodesicEmitterAimCylinderHalfHeightPaddingMeters = 0.1;
// Vertical offset (meters) of the cannon aim sphere relative to the beam height.
const geodesicEmitterAimSphereOffsetMeters = -0.3;
// Length of the capsule used to pick an individual geodesic emitter handle.
const geodesicEmitterGeodesicHandleLengthMeters = 0.65;
const geodesicEmitterGeodesicHandleRadiusMeters = 0.16 / 2.5;
// Cannons can be targeted from much farther than other objects.
const defaultMaxEmitterAimDistanceMeters = 200;
/** Radius of the capsule used to pick geodesic segments, meters. */
export const geodesicSegmentAimRadiusMeters = 0.28 / 1.5;

/**
 * Returns the best aim target under the camera crosshair, or `undefined` if nothing is hit.
 *
 * Equivalent to the first element of {@link resolveAimTargets}.
 */
export function resolveAimTarget(request: ResolveAimTargetRequest): AimTarget | undefined {
  return resolveAimTargets(request)[0];
}

/**
 * Returns every aim target along the centre ray through all visible portal paths, best first.
 *
 * Updates the camera's world matrix. The ray starts at the camera position and points along its forward (-z) axis,
 * both in the root Three.js frame. Ordering is by root-frame distance, except hits within the priority tolerances are
 * ordered by object kind (protractor label > cannon > geodesic intersection > geodesic segment > floor). Cost is linear in
 * the number of visible paths times objects per destination cell.
 */
export function resolveAimTargets(request: ResolveAimTargetRequest): readonly AimTarget[] {
  const maxDistanceMeters = request.maxDistanceMeters ?? 24;
  request.camera.updateMatrixWorld(true);
  const originRootThree = new THREE.Vector3().setFromMatrixPosition(request.camera.matrixWorld);
  const directionRootThree = new THREE.Vector3(0, 0, -1);
  const cameraQuaternion = new THREE.Quaternion();
  request.camera.getWorldQuaternion(cameraQuaternion);
  directionRootThree.applyQuaternion(cameraQuaternion).normalize();

  return resolveAimTargetsFromRootThreeRay({
    world: request.world,
    registry: request.registry,
    rootOriginThree: originRootThree,
    rootDirectionThree: directionRootThree,
    ndcPoint: centerNdc,
    visiblePortalPaths: request.visiblePortalPaths,
    maxDistanceMeters,
    maxEmitterDistanceMeters: request.maxEmitterDistanceMeters ?? defaultMaxEmitterAimDistanceMeters,
    ignoredGeodesicIds: new Set(request.ignoredGeodesicIds ?? []),
  });
}

// Core of the picker: expects a root-frame Three.js ray; result is sorted with the priority comparator.
function resolveAimTargetsFromRootThreeRay(request: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly rootOriginThree: THREE.Vector3;
  readonly rootDirectionThree: THREE.Vector3;
  readonly ndcPoint: { readonly x: number; readonly y: number };
  readonly visiblePortalPaths: readonly VisiblePortalPath[];
  readonly maxDistanceMeters: number;
  readonly maxEmitterDistanceMeters: number;
  readonly ignoredGeodesicIds: ReadonlySet<string>;
}): readonly AimTarget[] {
  const rootDirectionThree = request.rootDirectionThree.clone().normalize();

  const candidates: AimTarget[] = [];

  for (const path of request.visiblePortalPaths) {
    if (!pathContainsNdcPoint(path, request.ndcPoint)) {
      continue;
    }

    const cell = request.world.cellsById.get(path.destinationCellId);
    if (!cell) {
      continue;
    }

    // Re-express the ray in the destination cell's local frame, then collect object and floor hits there.
    const ray = buildCellRayFromRootThreeRay(request.rootOriginThree, rootDirectionThree, path);
    candidates.push(
      ...resolveObjectAimTargets(
        request.registry,
        cell,
        ray,
        request.maxDistanceMeters,
        request.maxEmitterDistanceMeters,
        request.ignoredGeodesicIds,
      ),
      ...resolveFloorAimTarget(cell, ray, request.maxDistanceMeters),
    );
  }

  return candidates.sort(compareAimTargets);
}

// Sort comparator derived from the (non-transitive-by-design) pairwise preference in isBetterAimTarget.
function compareAimTargets(left: AimTarget, right: AimTarget): number {
  if (isBetterAimTarget(left, right)) {
    return -1;
  }
  if (isBetterAimTarget(right, left)) {
    return 1;
  }
  return 0;
}

// Maps a root Three.js ray into a cell's local world frame: invert root-from-destination, apply to origin (point) and direction (vector), then Three-to-world axes.
function buildCellRayFromRootThreeRay(
  originRootThree: THREE.Vector3,
  directionRootThree: THREE.Vector3,
  path: VisiblePortalPath,
): CellRay {
  const cellFromRootMatrix = path.rootFromDestinationMatrix.clone().invert();
  const originCellThree = originRootThree.clone().applyMatrix4(cellFromRootMatrix);
  const directionCellThree = directionRootThree.clone().transformDirection(cellFromRootMatrix).normalize();

  return {
    path,
    origin: threePointToWorld(originCellThree),
    direction: threeDirectionToWorld(directionCellThree),
    rootFromCellMatrix: path.rootFromDestinationMatrix,
  };
}

function resolveObjectAimTargets(
  registry: RuntimeObjectRegistry,
  cell: CompiledPrismCell,
  ray: CellRay,
  maxDistanceMeters: number,
  maxEmitterDistanceMeters: number,
  ignoredGeodesicIds: ReadonlySet<string>,
): readonly AimTarget[] {
  const hits: AimTarget[] = [];

  for (const object of registry.getObjectsInCell(cell.id)) {
    if (object.kind === "protractor-angle" && !object.portalRenderable) {
      continue;
    }

    if (object.kind === "geodesic-segment" && ignoredGeodesicIds.has(object.geodesicId)) {
      continue;
    }

    if (object.kind === "geodesic-segment" && object.connectionState === "straightening") {
      continue;
    }

    const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(object));
    // Pick the proxy shape by object kind: protractor label box, geodesic capsule, cannon cylinder+sphere+handles, collision cylinder, else a small sphere at the pose.
    const hit = object.kind === "protractor-angle"
      ? intersectRayWithProtractorAngleLabelHitbox(object, ray.origin, ray.direction)
      : object.kind === "geodesic-segment"
      ? intersectRayWithSelectableSegment(object, ray.origin, ray.direction)
      : object.kind === "geodesic-cannon"
        ? intersectRayWithGeodesicEmitterAimCylinder(ray.origin, ray.direction, object, ignoredGeodesicIds)
      : bounds
        ? intersectRayWithVerticalCylinder(ray.origin, ray.direction, bounds)
        : intersectRayWithSphere(ray.origin, ray.direction, object.localPose.translation, fallbackObjectRadiusMeters);

    const targetMaxDistanceMeters = object.kind === "geodesic-cannon" ? maxEmitterDistanceMeters : maxDistanceMeters;
    if (!hit || hit.distance > targetMaxDistanceMeters) {
      continue;
    }

    const localPoint = hit.point ?? pointOnRay(ray.origin, ray.direction, hit.distance);
    // Sticky targets (saved aim points) override the raw hit, except protractor labels prefer the live hitbox centre.
    const targetLocalPoint = object.kind === "protractor-angle"
      ? hit.targetPoint ?? object.aimStickyTarget?.localPoint ?? localPoint
      : object.aimStickyTarget?.localPoint ?? hit.targetPoint ?? localPoint;
    hits.push({
      kind: "object",
      cellId: cell.id,
      localEyePosition: ray.origin,
      localPoint: targetLocalPoint,
      localNormal: hit.normal,
      rootPoint: transformCellPointToRoot(ray.rootFromCellMatrix, targetLocalPoint),
      rootNormal: transformCellDirectionToRoot(ray.rootFromCellMatrix, hit.normal),
      // Distance is measured in the root frame (portal transforms are rigid, so equal to the cell-local distance).
      distanceMeters: rootDistance(ray, localPoint),
      portalPathId: ray.path.pathId,
      object,
      geodesicSegmentDistanceMeters: hit.geodesicSegmentDistanceMeters,
      geodesicEmitterGeodesicId: hit.geodesicEmitterGeodesicId,
    });
  }

  return hits;
}

// Pairwise preference: geodesic-vs-cannon uses a wide tolerance, otherwise strictly nearer wins unless within the priority tolerance, where kind priority decides.
function isBetterAimTarget(candidate: AimTarget, current: AimTarget): boolean {
  if (isGeodesicVsEmitterChoice(candidate, current)) {
    const distanceDelta = Math.abs(candidate.distanceMeters - current.distanceMeters);
    if (distanceDelta <= geodesicSegmentVsEmitterPriorityDistanceToleranceMeters) {
      return getAimTargetPriority(candidate) > getAimTargetPriority(current);
    }
  }

  if (candidate.distanceMeters < current.distanceMeters - aimPointToleranceMeters) {
    return true;
  }

  if (Math.abs(candidate.distanceMeters - current.distanceMeters) > aimTargetPriorityDistanceToleranceMeters) {
    return false;
  }

  return getAimTargetPriority(candidate) > getAimTargetPriority(current);
}

// True if exactly one side is a cannon and the other a geodesic segment or intersection.
function isGeodesicVsEmitterChoice(left: AimTarget, right: AimTarget): boolean {
  const leftKind = left.object?.kind;
  const rightKind = right.object?.kind;
  return (isGeodesicAimObjectKind(leftKind) && rightKind === "geodesic-cannon") ||
    (leftKind === "geodesic-cannon" && isGeodesicAimObjectKind(rightKind));
}

function isGeodesicAimObjectKind(kind: RuntimeWorldObject["kind"] | undefined): boolean {
  return kind === "geodesic-segment" || kind === "geodesic-intersection";
}

// Higher is preferred: protractor 5, cannon 4, geodesic intersection 3, geodesic segment 1, everything else (floor, plain objects) 0.
function getAimTargetPriority(target: AimTarget): number {
  if (target.object?.kind === "protractor-angle") {
    return 5;
  }

  if (target.object?.kind === "geodesic-intersection") {
    return 3;
  }

  if (target.object?.kind === "geodesic-segment") {
    return 1;
  }

  if (target.object?.kind === "geodesic-cannon") {
    return 4;
  }

  return 0;
}

// Capsule hit for a geodesic segment with the aimed distance clamped to the segment and the aim point snapped to the centerline.
function intersectRayWithSelectableSegment(
  segment: Extract<RuntimeWorldObject, { readonly kind: "geodesic-segment" }>,
  rayOrigin: Vec3,
  rayDirection: Vec3,
): ObjectAimHit | undefined {
  const hit = intersectRayWithSegmentCapsule(
    rayOrigin,
    rayDirection,
    segment.start,
    segment.direction,
    segment.lengthMeters,
  );
  if (!hit || hit.geodesicSegmentDistanceMeters === undefined) {
    return hit;
  }

  const segmentDistanceMeters = Math.min(
    segment.lengthMeters,
    Math.max(0, hit.geodesicSegmentDistanceMeters),
  );
  return {
    ...hit,
    geodesicSegmentDistanceMeters: segmentDistanceMeters,
    targetPoint: pointOnSegmentCenterline(segment.start, segment.direction, segmentDistanceMeters),
  };
}

// Ray vs capsule (cylinder + two end spheres) around a segment, solved in a frame with x along the segment, y lateral (horizontal perpendicular) and z world up;
// this is an orthonormal frame only for horizontal segment directions. The aim point is the centerline point closest to the ray, not the surface hit.
function intersectRayWithSegmentCapsule(
  origin: Vec3,
  direction: Vec3,
  segmentStart: Vec3,
  segmentDirection: Vec3,
  segmentLengthMeters: number,
  radiusMeters = geodesicSegmentAimRadiusMeters,
): ObjectAimHit | undefined {
  if (!(segmentLengthMeters > 0)) {
    return undefined;
  }

  // Horizontal perpendicular to the segment direction (rotate by +90 degrees in the xy plane).
  const lateral = normalizeVec3OrFallback({
    x: -segmentDirection.y,
    y: segmentDirection.x,
    z: 0,
  });
  const offset = subVec3(origin, segmentStart);
  const localOrigin = {
    x: dotVec3(offset, segmentDirection),
    y: dotVec3(offset, lateral),
    z: offset.z,
  };
  const localDirection = {
    x: dotVec3(direction, segmentDirection),
    y: dotVec3(direction, lateral),
    z: direction.z,
  };
  const hits: ObjectAimHit[] = [];

  pushSegmentCylinderHit(hits, localOrigin, localDirection, origin, direction, segmentStart, segmentDirection, segmentLengthMeters, radiusMeters);
  pushSegmentSphereHit(hits, localOrigin, localDirection, origin, direction, segmentStart, segmentDirection, 0, radiusMeters);
  pushSegmentSphereHit(
    hits,
    localOrigin,
    localDirection,
    origin,
    direction,
    segmentStart,
    segmentDirection,
    segmentLengthMeters,
    radiusMeters,
  );

  if (hits.length === 0) {
    return undefined;
  }

  const best = hits.reduce((currentBest, hit) => hit.distance < currentBest.distance ? hit : currentBest);
  const closestSegmentDistance = resolveClosestSegmentDistanceOnRay(
    localOrigin,
    localDirection,
    segmentLengthMeters,
  );
  const targetDistance = closestSegmentDistance ?? best.geodesicSegmentDistanceMeters;
  return targetDistance === undefined
    ? best
    : {
        ...best,
        geodesicSegmentDistanceMeters: targetDistance,
        targetPoint: pointOnSegmentCenterline(segmentStart, segmentDirection, targetDistance),
      };
}

// Segment parameter of the point closest to the ray (minimising lateral distance), clamped to [0, length]; undefined if that point lies behind the ray origin.
function resolveClosestSegmentDistanceOnRay(
  localOrigin: Vec3,
  localDirection: Vec3,
  segmentLengthMeters: number,
): number | undefined {
  const lateralMagnitudeSquared = localDirection.y * localDirection.y + localDirection.z * localDirection.z;
  if (lateralMagnitudeSquared <= aimPointToleranceMeters) {
    return Math.min(segmentLengthMeters, Math.max(0, localOrigin.x));
  }

  // Ray parameter minimising the lateral distance: d/dt |o_perp + t d_perp|^2 = 0.
  const rayDistance = -(localOrigin.y * localDirection.y + localOrigin.z * localDirection.z) /
    lateralMagnitudeSquared;
  if (!Number.isFinite(rayDistance) || rayDistance < 0) {
    return undefined;
  }

  return Math.min(segmentLengthMeters, Math.max(0, localOrigin.x + localDirection.x * rayDistance));
}

// Infinite-cylinder quadratic in the lateral (y,z) plane; hits are later filtered to the segment's extent.
function pushSegmentCylinderHit(
  hits: ObjectAimHit[],
  localOrigin: Vec3,
  localDirection: Vec3,
  origin: Vec3,
  direction: Vec3,
  segmentStart: Vec3,
  segmentDirection: Vec3,
  segmentLengthMeters: number,
  radiusMeters: number,
): void {
  const a = localDirection.y * localDirection.y + localDirection.z * localDirection.z;
  if (a <= aimPointToleranceMeters) {
    return;
  }

  const b = 2 * (localOrigin.y * localDirection.y + localOrigin.z * localDirection.z);
  const c = localOrigin.y * localOrigin.y + localOrigin.z * localOrigin.z - radiusMeters * radiusMeters;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return;
  }

  const root = Math.sqrt(discriminant);
  pushSegmentCylinderDistance(
    hits,
    (-b - root) / (2 * a),
    localOrigin,
    localDirection,
    origin,
    direction,
    segmentStart,
    segmentDirection,
    segmentLengthMeters,
  );
  pushSegmentCylinderDistance(
    hits,
    (-b + root) / (2 * a),
    localOrigin,
    localDirection,
    origin,
    direction,
    segmentStart,
    segmentDirection,
    segmentLengthMeters,
  );
}

// Accepts a cylinder intersection only if its axial coordinate lies within [0, length] (with tolerance); normal is from the centerline.
function pushSegmentCylinderDistance(
  hits: ObjectAimHit[],
  distance: number,
  localOrigin: Vec3,
  localDirection: Vec3,
  origin: Vec3,
  direction: Vec3,
  segmentStart: Vec3,
  segmentDirection: Vec3,
  segmentLengthMeters: number,
): void {
  if (distance <= aimPointToleranceMeters) {
    return;
  }

  const segmentDistance = localOrigin.x + localDirection.x * distance;
  if (segmentDistance < -aimPointToleranceMeters || segmentDistance > segmentLengthMeters + aimPointToleranceMeters) {
    return;
  }

  const point = pointOnRay(origin, direction, distance);
  const centerlinePoint = pointOnSegmentCenterline(segmentStart, segmentDirection, segmentDistance);
  hits.push({
    distance,
    normal: normalizeVec3OrFallback(subVec3(point, centerlinePoint)),
    point,
    targetPoint: centerlinePoint,
    geodesicSegmentDistanceMeters: segmentDistance,
  });
}

// End-cap sphere at axial position `segmentDistance`; uses the nearer positive root, else the far root (origin inside).
function pushSegmentSphereHit(
  hits: ObjectAimHit[],
  localOrigin: Vec3,
  localDirection: Vec3,
  origin: Vec3,
  direction: Vec3,
  segmentStart: Vec3,
  segmentDirection: Vec3,
  segmentDistance: number,
  radiusMeters: number,
): void {
  const sphereOrigin = {
    x: localOrigin.x - segmentDistance,
    y: localOrigin.y,
    z: localOrigin.z,
  };
  const b = 2 * dotVec3(sphereOrigin, localDirection);
  const c = dotVec3(sphereOrigin, sphereOrigin) - radiusMeters * radiusMeters;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) {
    return;
  }

  const root = Math.sqrt(discriminant);
  const near = (-b - root) / 2;
  const far = (-b + root) / 2;
  const distance = near > aimPointToleranceMeters
    ? near
    : far > aimPointToleranceMeters
      ? far
      : undefined;
  if (distance === undefined) {
    return;
  }

  const point = pointOnRay(origin, direction, distance);
  const center = pointOnSegmentCenterline(segmentStart, segmentDirection, segmentDistance);
  hits.push({
    distance,
    normal: normalizeVec3OrFallback(subVec3(point, center)),
    point,
    targetPoint: center,
    geodesicSegmentDistanceMeters: segmentDistance,
  });
}

function pointOnSegmentCenterline(segmentStart: Vec3, segmentDirection: Vec3, distance: number): Vec3 {
  return {
    x: segmentStart.x + segmentDirection.x * distance,
    y: segmentStart.y + segmentDirection.y * distance,
    z: segmentStart.z + segmentDirection.z * distance,
  };
}

// Ray vs the floor plane z = 0 in cell-local frame: requires a downward ray, a hit within maxDistance, inside the cell polygon and outside forbidden columns.
function resolveFloorAimTarget(
  cell: CompiledPrismCell,
  ray: CellRay,
  maxDistanceMeters: number,
): readonly AimTarget[] {
  if (ray.direction.z >= -aimPointToleranceMeters) {
    return [];
  }

  const distance = -ray.origin.z / ray.direction.z;
  if (!Number.isFinite(distance) || distance <= aimPointToleranceMeters || distance > maxDistanceMeters) {
    return [];
  }

  const localPoint = pointOnRay(ray.origin, ray.direction, distance);
  const floorPoint = { ...localPoint, z: 0 };
  if (!cellContainsPoint(cell, floorPoint) || pointIntersectsForbiddenZone(cell, floorPoint)) {
    return [];
  }

  return [{
    kind: "floor",
    cellId: cell.id,
    localEyePosition: ray.origin,
    localPoint: floorPoint,
    localNormal: { x: 0, y: 0, z: 1 },
    rootPoint: transformCellPointToRoot(ray.rootFromCellMatrix, floorPoint),
    rootNormal: transformCellDirectionToRoot(ray.rootFromCellMatrix, { x: 0, y: 0, z: 1 }),
    distanceMeters: rootDistance(ray, floorPoint),
    portalPathId: ray.path.pathId,
  }];
}

/**
 * Returns the vertical-cylinder proxy used to pick a geodesic cannon, or `undefined` if the cannon has no collision bounds.
 *
 * Derived from the cannon's collision bounds in the cell-local frame (meters): the radius becomes
 * (collision radius + padding) / 2 and the half-height is padded by 0.1 m.
 */
export function getGeodesicEmitterAimCylinderBounds(
  emitter: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
): SimpleCylinderBounds | undefined {
  const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(emitter));
  if (!bounds) {
    return undefined;
  }

  return {
    center: bounds.center,
    radius: (bounds.radius + geodesicEmitterAimCylinderRadiusPaddingMeters) / 2,
    halfHeight: bounds.halfHeight + geodesicEmitterAimCylinderHalfHeightPaddingMeters,
  };
}

/**
 * Returns the centre of the sphere used to pick (and snap the aim to) a geodesic cannon, in the cell-local frame (meters).
 *
 * It sits above the cannon's base at beam height shifted down by 0.3 m.
 */
export function getGeodesicEmitterAimSphereCenter(
  emitter: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
): Vec3 {
  return {
    x: emitter.localPose.translation.x,
    y: emitter.localPose.translation.y,
    z: emitter.localPose.translation.z + geodesicRayBeamHeightMeters + geodesicEmitterAimSphereOffsetMeters,
  };
}

// Point inside all side half-spaces of the prism cell (signed distance >= -eps).
function cellContainsPoint(cell: CompiledPrismCell, point: Vec3): boolean {
  return cell.sides.every((side) => signedDistanceToSide(side, point) >= -aimPointToleranceMeters);
}

// Singularity column test: horizontal distance within radius and, for finite columns, within half the height of the centre.
function pointIntersectsForbiddenZone(cell: CompiledPrismCell, point: Vec3): boolean {
  return cell.singularityColumns.some((zone) => {
    const dz = Math.abs(point.z - zone.center.z);
    const vertical = !Number.isFinite(zone.height) || dz <= zone.height / 2;
    return vertical && distanceSquared2(point, zone.center) <= zone.radius * zone.radius;
  });
}

// Ray vs capped vertical (z-axis) cylinder: side quadratic in xy plus two cap planes; nearest positive hit wins.
function intersectRayWithVerticalCylinder(
  origin: Vec3,
  direction: Vec3,
  bounds: SimpleCylinderBounds,
): ObjectAimHit | undefined {
  const hits: Array<{ readonly distance: number; readonly normal: Vec3 }> = [];
  const dx = origin.x - bounds.center.x;
  const dy = origin.y - bounds.center.y;
  const a = direction.x * direction.x + direction.y * direction.y;
  const b = 2 * (dx * direction.x + dy * direction.y);
  const c = dx * dx + dy * dy - bounds.radius * bounds.radius;

  if (Math.abs(a) > aimPointToleranceMeters) {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      pushCylinderSideHit(hits, origin, direction, bounds, (-b - root) / (2 * a));
      pushCylinderSideHit(hits, origin, direction, bounds, (-b + root) / (2 * a));
    }
  }

  pushCylinderCapHit(hits, origin, direction, bounds, bounds.center.z - bounds.halfHeight);
  pushCylinderCapHit(hits, origin, direction, bounds, bounds.center.z + bounds.halfHeight);

  const positiveHits = hits.filter((hit) => hit.distance > aimPointToleranceMeters);
  return positiveHits.length > 0
    ? positiveHits.reduce((best, hit) => hit.distance < best.distance ? hit : best)
    : undefined;
}

// Label hitbox is a yawed box (half-extents from width/depth/height); the aim target is the box centre.
function intersectRayWithProtractorAngleLabelHitbox(
  angle: Extract<RuntimeWorldObject, { readonly kind: "protractor-angle" }>,
  origin: Vec3,
  direction: Vec3,
): ObjectAimHit | undefined {
  const hitbox = angle.labelHitbox ?? createProtractorAngleLabelHitbox({
    centerPoint: angle.centerPoint,
    firstYawRadians: angle.first.yawRadians,
    angleRadians: angle.angleRadians,
    radiusMeters: angle.radiusMeters,
  });
  return intersectRayWithOrientedBox(origin, direction, {
    center: hitbox.center,
    yawRadians: hitbox.yawRadians,
    halfExtents: {
      x: hitbox.widthMeters / 2,
      y: hitbox.depthMeters / 2,
      z: hitbox.heightMeters / 2,
    },
  });
}

// Transforms the ray into the box's frame (yaw about z), runs a slab test, and rotates the local normal back.
function intersectRayWithOrientedBox(
  origin: Vec3,
  direction: Vec3,
  box: {
    readonly center: Vec3;
    readonly yawRadians: number;
    readonly halfExtents: Vec3;
  },
): ObjectAimHit | undefined {
  const xAxis = { x: Math.cos(box.yawRadians), y: Math.sin(box.yawRadians), z: 0 };
  const yAxis = { x: -Math.sin(box.yawRadians), y: Math.cos(box.yawRadians), z: 0 };
  const zAxis = { x: 0, y: 0, z: 1 };
  const offset = subVec3(origin, box.center);
  const localOrigin = {
    x: dotVec3(offset, xAxis),
    y: dotVec3(offset, yAxis),
    z: dotVec3(offset, zAxis),
  };
  const localDirection = {
    x: dotVec3(direction, xAxis),
    y: dotVec3(direction, yAxis),
    z: dotVec3(direction, zAxis),
  };
  const hit = intersectLocalRayWithAxisAlignedBox(localOrigin, localDirection, box.halfExtents);
  if (!hit) {
    return undefined;
  }

  return {
    distance: hit.distance,
    normal: normalizeVec3OrFallback({
      x: xAxis.x * hit.localNormal.x + yAxis.x * hit.localNormal.y + zAxis.x * hit.localNormal.z,
      y: xAxis.y * hit.localNormal.x + yAxis.y * hit.localNormal.y + zAxis.y * hit.localNormal.z,
      z: xAxis.z * hit.localNormal.x + yAxis.z * hit.localNormal.y + zAxis.z * hit.localNormal.z,
    }),
    point: pointOnRay(origin, direction, hit.distance),
    targetPoint: box.center,
  };
}

// Slab method over x, y, z; returns the entry hit, or the exit hit if the origin is inside the box.
function intersectLocalRayWithAxisAlignedBox(
  origin: Vec3,
  direction: Vec3,
  halfExtents: Vec3,
): { readonly distance: number; readonly localNormal: Vec3 } | undefined {
  let tMin = -Infinity;
  let tMax = Infinity;
  let enterNormal: Vec3 = { x: 0, y: 0, z: 1 };
  let exitNormal: Vec3 = { x: 0, y: 0, z: 1 };

  const x = updateBoxSlabInterval(tMin, tMax, enterNormal, exitNormal, origin.x, direction.x, halfExtents.x, { x: 1, y: 0, z: 0 });
  if (!x) {
    return undefined;
  }
  tMin = x.tMin;
  tMax = x.tMax;
  enterNormal = x.enterNormal;
  exitNormal = x.exitNormal;

  const y = updateBoxSlabInterval(tMin, tMax, enterNormal, exitNormal, origin.y, direction.y, halfExtents.y, { x: 0, y: 1, z: 0 });
  if (!y) {
    return undefined;
  }
  tMin = y.tMin;
  tMax = y.tMax;
  enterNormal = y.enterNormal;
  exitNormal = y.exitNormal;

  const z = updateBoxSlabInterval(tMin, tMax, enterNormal, exitNormal, origin.z, direction.z, halfExtents.z, { x: 0, y: 0, z: 1 });
  if (!z) {
    return undefined;
  }
  tMin = z.tMin;
  tMax = z.tMax;
  enterNormal = z.enterNormal;
  exitNormal = z.exitNormal;

  if (tMax <= aimPointToleranceMeters) {
    return undefined;
  }

  return tMin > aimPointToleranceMeters
    ? { distance: tMin, localNormal: enterNormal }
    : { distance: tMax, localNormal: exitNormal };
}

// Narrows [tMin, tMax] by one axis slab and tracks which face normals bound the interval; parallel rays must start within the slab.
function updateBoxSlabInterval(
  tMin: number,
  tMax: number,
  enterNormal: Vec3,
  exitNormal: Vec3,
  origin: number,
  direction: number,
  halfExtent: number,
  axis: Vec3,
): {
  readonly tMin: number;
  readonly tMax: number;
  readonly enterNormal: Vec3;
  readonly exitNormal: Vec3;
} | undefined {
  if (Math.abs(direction) <= aimPointToleranceMeters) {
    return Math.abs(origin) <= halfExtent + aimPointToleranceMeters
      ? { tMin, tMax, enterNormal, exitNormal }
      : undefined;
  }

  const nearNormal = scaleVec3Like(axis, direction > 0 ? -1 : 1);
  const farNormal = scaleVec3Like(axis, direction > 0 ? 1 : -1);
  let near = (-halfExtent - origin) / direction;
  let far = (halfExtent - origin) / direction;
  let nextEnterNormal = nearNormal;
  let nextExitNormal = farNormal;
  if (near > far) {
    [near, far] = [far, near];
    nextEnterNormal = farNormal;
    nextExitNormal = nearNormal;
  }

  if (near > tMin) {
    tMin = near;
    enterNormal = nextEnterNormal;
  }
  if (far < tMax) {
    tMax = far;
    exitNormal = nextExitNormal;
  }

  return tMin <= tMax + aimPointToleranceMeters
    ? { tMin, tMax, enterNormal, exitNormal }
    : undefined;
}

function scaleVec3Like(vector: Vec3, scale: number): Vec3 {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

// Cannon proxy: union of padded cylinder and sphere, plus per-geodesic handle capsules which win if within the priority tolerance of the body hit.
function intersectRayWithGeodesicEmitterAimCylinder(
  origin: Vec3,
  direction: Vec3,
  emitter: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ignoredGeodesicIds: ReadonlySet<string>,
): ObjectAimHit | undefined {
  const bounds = getGeodesicEmitterAimCylinderBounds(emitter);
  if (!bounds) {
    return undefined;
  }

  const sphereCenter = getGeodesicEmitterAimSphereCenter(emitter);
  const cylinderHit = intersectRayWithVerticalCylinder(origin, direction, bounds);
  const sphereHit = intersectRayWithSphere(origin, direction, sphereCenter, bounds.radius);
  const emitterHit = chooseNearestHit(cylinderHit, sphereHit);
  const geodesicHit = intersectRayWithEmitterGeodesicHandles(origin, direction, emitter, ignoredGeodesicIds);
  const hit = chooseEmitterAimHit(emitterHit, geodesicHit);
  if (!hit) {
    return undefined;
  }

  return {
    ...hit,
    targetPoint: sphereCenter,
    geodesicEmitterGeodesicId: hit.geodesicEmitterGeodesicId ??
      resolveDefaultEmitterGeodesicId(emitter, ignoredGeodesicIds),
  };
}

// One capsule per non-ignored geodesic along its emission yaw, starting at the beam start offset at beam height; nearest wins.
function intersectRayWithEmitterGeodesicHandles(
  origin: Vec3,
  direction: Vec3,
  emitter: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ignoredGeodesicIds: ReadonlySet<string>,
): ObjectAimHit | undefined {
  const center = {
    x: emitter.localPose.translation.x,
    y: emitter.localPose.translation.y,
    z: emitter.localPose.translation.z + geodesicRayBeamHeightMeters,
  };
  let best: ObjectAimHit | undefined;

  for (const geodesicId of emitter.geodesicIds) {
    if (ignoredGeodesicIds.has(geodesicId)) {
      continue;
    }

    const yawRadians = emitter.geodesicEmitterYawRadiansById?.[geodesicId] ?? emitter.aimYawRadians;
    const handleStart = {
      x: center.x + Math.cos(yawRadians) * geodesicRayBeamStartOffsetMeters,
      y: center.y + Math.sin(yawRadians) * geodesicRayBeamStartOffsetMeters,
      z: center.z,
    };
    const handleDirection = {
      x: Math.cos(yawRadians),
      y: Math.sin(yawRadians),
      z: 0,
    };
    const hit = intersectRayWithSegmentCapsule(
      origin,
      direction,
      handleStart,
      handleDirection,
      geodesicEmitterGeodesicHandleLengthMeters,
      geodesicEmitterGeodesicHandleRadiusMeters,
    );
    if (!hit) {
      continue;
    }

    const withGeodesicId = {
      ...hit,
      targetPoint: center,
      geodesicEmitterGeodesicId: geodesicId,
    };
    if (!best || withGeodesicId.distance < best.distance) {
      best = withGeodesicId;
    }
  }

  return best;
}

function resolveDefaultEmitterGeodesicId(
  emitter: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ignoredGeodesicIds: ReadonlySet<string>,
): string | undefined {
  if (emitter.activeGeodesicId && !ignoredGeodesicIds.has(emitter.activeGeodesicId)) {
    return emitter.activeGeodesicId;
  }

  return emitter.geodesicIds.find((geodesicId) => !ignoredGeodesicIds.has(geodesicId));
}

// Prefers the handle hit unless it is farther than the body hit by more than the priority tolerance.
function chooseEmitterAimHit(
  cylinderHit: ObjectAimHit | undefined,
  geodesicHit: ObjectAimHit | undefined,
): ObjectAimHit | undefined {
  if (!geodesicHit) {
    return cylinderHit;
  }

  if (!cylinderHit) {
    return geodesicHit;
  }

  return geodesicHit.distance <= cylinderHit.distance + aimTargetPriorityDistanceToleranceMeters
    ? geodesicHit
    : cylinderHit;
}

function chooseNearestHit(
  left: ObjectAimHit | undefined,
  right: ObjectAimHit | undefined,
): ObjectAimHit | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return left.distance <= right.distance ? left : right;
}

// Side hit counts only if its height lies within the cylinder's z extent.
function pushCylinderSideHit(
  hits: Array<{ readonly distance: number; readonly normal: Vec3 }>,
  origin: Vec3,
  direction: Vec3,
  bounds: SimpleCylinderBounds,
  distance: number,
): void {
  if (distance <= aimPointToleranceMeters) {
    return;
  }

  const z = origin.z + direction.z * distance;
  if (Math.abs(z - bounds.center.z) <= bounds.halfHeight + aimPointToleranceMeters) {
    const point = pointOnRay(origin, direction, distance);
    hits.push({
      distance,
      normal: normalizeVec3({ x: point.x - bounds.center.x, y: point.y - bounds.center.y, z: 0 }),
    });
  }
}

// Cap plane hit counts only if the point lies within the cylinder radius; normal points away from the cylinder centre.
function pushCylinderCapHit(
  hits: Array<{ readonly distance: number; readonly normal: Vec3 }>,
  origin: Vec3,
  direction: Vec3,
  bounds: SimpleCylinderBounds,
  capZ: number,
): void {
  if (Math.abs(direction.z) <= aimPointToleranceMeters) {
    return;
  }

  const distance = (capZ - origin.z) / direction.z;
  if (distance <= aimPointToleranceMeters) {
    return;
  }

  const point = pointOnRay(origin, direction, distance);
  if (distanceSquared2(point, bounds.center) <= bounds.radius * bounds.radius) {
    hits.push({
      distance,
      normal: { x: 0, y: 0, z: capZ < bounds.center.z ? -1 : 1 },
    });
  }
}

// Quadratic ray-sphere; uses the near root, or the far root when the origin is inside. Direction is assumed unit.
function intersectRayWithSphere(
  origin: Vec3,
  direction: Vec3,
  center: Vec3,
  radius: number,
): ObjectAimHit | undefined {
  const offset = {
    x: origin.x - center.x,
    y: origin.y - center.y,
    z: origin.z - center.z,
  };
  const b = 2 * dotVec3(offset, direction);
  const c = dotVec3(offset, offset) - radius * radius;
  const discriminant = b * b - 4 * c;

  if (discriminant < 0) {
    return undefined;
  }

  const root = Math.sqrt(discriminant);
  const near = (-b - root) / 2;
  const far = (-b + root) / 2;

  const distance = near > aimPointToleranceMeters
    ? near
    : far > aimPointToleranceMeters
      ? far
      : undefined;
  if (distance === undefined) {
    return undefined;
  }

  const point = pointOnRay(origin, direction, distance);
  return {
    distance,
    normal: normalizeVec3({
      x: point.x - center.x,
      y: point.y - center.y,
      z: point.z - center.z,
    }),
  };
}

function pointOnRay(origin: Vec3, direction: Vec3, distance: number): Vec3 {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance,
  };
}

// Cell-local world point to root world point: world to Three axes, apply the root-from-cell matrix, Three back to world.
function transformCellPointToRoot(rootFromCellMatrix: THREE.Matrix4, point: Vec3): Vec3 {
  return threePointToWorld(worldPointToThree(point).applyMatrix4(rootFromCellMatrix));
}

// As above for a direction (no translation), renormalized.
function transformCellDirectionToRoot(rootFromCellMatrix: THREE.Matrix4, direction: Vec3): Vec3 {
  return normalizeVec3(threeDirectionToWorld(worldPointToThree(direction).transformDirection(rootFromCellMatrix)));
}

function rootDistance(ray: CellRay, localPoint: Vec3): number {
  const originRoot = transformCellPointToRoot(ray.rootFromCellMatrix, ray.origin);
  const pointRoot = transformCellPointToRoot(ray.rootFromCellMatrix, localPoint);
  return distanceVec3(originRoot, pointRoot);
}

function distanceSquared2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function normalizeVec3OrFallback(direction: Vec3): Vec3 {
  try {
    return normalizeVec3(direction);
  } catch {
    return { x: 0, y: 0, z: 1 };
  }
}

// Screen-space test: bounding rect first, then even-odd ray casting against the clip polygon (vertices count as inside).
function pathContainsNdcPoint(path: VisiblePortalPath, point: { readonly x: number; readonly y: number }): boolean {
  if (
    point.x < path.clipRectNdc.minX - aimPointToleranceMeters ||
    point.x > path.clipRectNdc.maxX + aimPointToleranceMeters ||
    point.y < path.clipRectNdc.minY - aimPointToleranceMeters ||
    point.y > path.clipRectNdc.maxY + aimPointToleranceMeters
  ) {
    return false;
  }

  let inside = false;
  const polygon = path.clipPolygonNdc;
  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex++) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    if (
      (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    ) {
      inside = !inside;
    }
  }

  return inside || polygon.some((vertex) =>
    Math.abs(vertex.x - point.x) <= aimPointToleranceMeters &&
    Math.abs(vertex.y - point.y) <= aimPointToleranceMeters
  );
}
