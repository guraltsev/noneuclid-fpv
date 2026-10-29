/**
 * Aim picking: finds what an aim ray (desktop crosshair or XR controller) hits, across portals.
 *
 * The ray is given in the root (Three.js) frame, which is the local frame of the player's root cell. It is walked through the
 * glued cells with the segment-walk kernel: it starts in the cell that contains its origin, crosses a portal exactly where it
 * passes the portal side, and stops at walls, ceilings, too-low apertures and the floor. In every cell copy the ray is tested
 * against the floor plane z = 0 (restricted to the cell polygon, minus forbidden singularity columns) and against analytic
 * proxies of the runtime objects (vertical cylinders, spheres, oriented boxes, capsules), accepting only hits inside that
 * cell's parameter window. Hits are ordered by distance along the ray, with tolerance-based priority rules that prefer
 * interactive things (protractor label, cannon, geodesic intersection, geodesic segment) over nearly co-distant ones.
 * Results carry both cell-local and root-frame points/normals and the number of portal hops.
 * Invariants: ray directions are unit length; rays are tested for positive distance only (hits within 1e-5 m are ignored);
 * geodesic-segment tests assume horizontal segment directions.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import { dotVec3, normalizeVec3, subVec3, type Vec3 } from "../../math/vec3";
import { getDynamicObjectCollisionBounds, signedDistanceToSide, type SimpleCylinderBounds } from "../../movement/collision";
import { geodesicRayBeamHeightMeters, geodesicRayBeamStartOffsetMeters } from "../../world-objects/geodesicCannon";
import { createProtractorAngleLabelHitbox } from "../../world-objects/protractorTool";
import { runtimeObjectToDynamicObjectState, type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { locateDevelopedPoint, walkDevelopedSegment, type SegmentWalkPiece } from "../../cell-complex/segmentWalk";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformDirection3,
  transformPoint3,
  type RigidTransform3,
} from "../../math/rigidTransform3";
import { threeDirectionToWorld, threePointToWorld } from "./worldAxes";

/** Whether an aim target is the floor or a world object. */
export type AimTargetKind = "floor" | "object";

/** One thing the aim ray hits, expressed both in the hit cell's local frame and in the root (viewer) frame. */
export interface AimTarget {
  readonly kind: AimTargetKind;
  /** Cell copy in which the hit was found (reached by walking the ray through portals). */
  readonly cellId: string;
  /** Ray origin in the hit cell's local frame (the eye as seen through the portals walked), meters. */
  readonly localEyePosition: Vec3;
  /** Aim point in the hit cell's local frame, meters; for objects this may be a sticky or centre target rather than the surface hit. */
  readonly localPoint: Vec3;
  /** Unit surface normal at the hit in the cell-local frame. */
  readonly localNormal: Vec3;
  /** `localPoint` mapped to the root world frame (world axes, meters) through the portals walked. */
  readonly rootPoint: Vec3;
  /** `localNormal` mapped to the root world frame, normalized. */
  readonly rootNormal: Vec3;
  /** Distance from the ray origin to the surface hit along the 3-D ray (the ray parameter), meters. */
  readonly distanceMeters: number;
  /** Portal crossings between the ray origin's cell and the hit cell. */
  readonly hopCount: number;
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
  /** The player's (render root) cell; the Three.js root frame is this cell's local frame. */
  readonly rootCellId: string;
  /** A point inside the root cell (world axes, root frame), e.g. the player at eye height; defaults to the ray origin. */
  readonly rootAnchorPoint?: Vec3;
  /** Maximum hit distance for floor and ordinary objects, meters (default 24). */
  readonly maxDistanceMeters?: number;
  /** Maximum hit distance for cannons, meters (default 200). */
  readonly maxEmitterDistanceMeters?: number;
  /** Geodesic ids whose segments, handles and emitters are skipped (e.g. the geodesic currently being manipulated). */
  readonly ignoredGeodesicIds?: readonly string[];
}

// The aim ray expressed in one cell copy's local world frame; origin/direction in meters/unit.
interface CellRay {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly rootFromCell: RigidTransform3;
}

// Allowed 3-D ray parameters [tMin, tMax] of hits in one cell copy.
interface HitWindow {
  readonly tMin: number;
  readonly tMax: number;
}

const hitWindowToleranceMeters = 1e-6;
const maxRayWalkCrossings = 64;

// Result of one ray-vs-object test, in the cell-local frame. `point` is the surface hit (defaults to origin + distance * direction); `targetPoint` is where the aim should snap (e.g. centerline).
interface ObjectAimHit {
  readonly distance: number;
  readonly normal: Vec3;
  readonly point?: Vec3;
  readonly targetPoint?: Vec3;
  readonly geodesicSegmentDistanceMeters?: number;
  readonly geodesicEmitterGeodesicId?: string;
}

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
 * Returns every aim target along the ray, best first, found by walking the ray through the glued cells.
 *
 * The ray is read from the camera (world position, forward -z axis; root Three.js frame, which is the frame of
 * `rootCellId`). It starts in the cell that contains its origin, continues through a portal exactly where it crosses the
 * portal side, and stops at walls, at a ceiling, at a portal whose target is lower than the ray, and at the floor.
 * Each cell copy is tested once, for hits inside its parameter window. Ordering is by distance along the ray, except hits
 * within the priority tolerances are ordered by object kind (protractor label > cannon > geodesic intersection >
 * geodesic segment > floor). Updates the camera's world matrix.
 */
export function resolveAimTargetsByRayWalk(request: ResolveAimTargetRequest): readonly AimTarget[] {
  const maxDistanceMeters = request.maxDistanceMeters ?? 24;
  const maxEmitterDistanceMeters = Math.max(
    request.maxEmitterDistanceMeters ?? defaultMaxEmitterAimDistanceMeters,
    maxDistanceMeters,
  );
  const ignoredGeodesicIds = new Set(request.ignoredGeodesicIds ?? []);
  request.camera.updateMatrixWorld(true);
  const originThree = new THREE.Vector3().setFromMatrixPosition(request.camera.matrixWorld);
  const cameraQuaternion = new THREE.Quaternion();
  request.camera.getWorldQuaternion(cameraQuaternion);
  const directionThree = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion).normalize();

  // The Three.js root frame is the root cell's local frame (x, y, z-up after the axis conversion).
  const origin = threePointToWorld(originThree);
  const direction = normalizeVec3(threeDirectionToWorld(directionThree));
  const anchor = request.rootAnchorPoint ?? origin;
  const located = locateDevelopedPoint(
    request.world,
    request.rootCellId,
    { x: anchor.x, y: anchor.y },
    { x: origin.x, y: origin.y },
    maxRayWalkCrossings,
  );
  // An anchor outside the root cell (or a degenerate setup) falls back to treating the origin as lying in the root cell.
  const originInRoot = located.status === "start-outside";
  if (located.status !== "end" && !originInRoot) {
    return [];
  }

  const originCellId = originInRoot ? request.rootCellId : located.cellId;
  const originFromRoot = originInRoot ? identityRigidTransform3 : located.cellFromStart;
  const o = transformPoint3(originFromRoot, origin);
  const d = transformDirection3(originFromRoot, direction);
  const s = Math.hypot(d.x, d.y);
  const verticalRay = s < 1e-6;
  const pieces: readonly SegmentWalkPiece[] = verticalRay
    ? [singleCellPiece(originCellId, maxEmitterDistanceMeters)]
    : walkRayPieces(request.world, originCellId, o, d, s, maxEmitterDistanceMeters);

  const candidates: AimTarget[] = [];
  for (let k = 0; k < pieces.length; k += 1) {
    const piece = pieces[k];
    const cell = request.world.cellsById.get(piece.cellId);
    if (!cell) {
      break;
    }

    let tMin = verticalRay ? 0 : piece.tEnter / s;
    let tMax = verticalRay ? maxEmitterDistanceMeters : piece.tExit / s;
    let stop = false;
    let floorT: number | undefined;
    if (d.z < -1e-9) {
      const t = -o.z / d.z;
      if (t >= tMin - hitWindowToleranceMeters && t <= tMax + hitWindowToleranceMeters) {
        tMax = Math.max(tMin, t);
        floorT = t;
        stop = true;
      }
    } else if (d.z > 1e-9) {
      const t = (cell.heightMeters - o.z) / d.z;
      if (t >= tMin - hitWindowToleranceMeters && t <= tMax + hitWindowToleranceMeters) {
        tMax = Math.max(tMin, t);
        stop = true;
      }
    }

    const cellFromRoot = composeRigidTransform3(piece.cellFromStart, originFromRoot);
    const rootFromCell = invertRigidTransform3(cellFromRoot);
    const ray: CellRay = {
      origin: transformPoint3(piece.cellFromStart, o),
      direction: transformDirection3(piece.cellFromStart, d),
      rootFromCell,
    };
    candidates.push(
      ...resolveObjectAimTargets(
        request.registry,
        cell,
        ray,
        { tMin, tMax },
        maxDistanceMeters,
        maxEmitterDistanceMeters,
        ignoredGeodesicIds,
        k,
      ),
    );
    if (floorT !== undefined && floorT <= maxDistanceMeters) {
      candidates.push(...resolveFloorAimTarget(cell, ray, floorT, k));
    }

    if (stop || piece.exit.kind === "wall") {
      break;
    }

    if (piece.exit.kind === "portal") {
      // The ray must clear the lower of the two apertures' cells where it crosses the portal side.
      const target = request.world.cellsById.get(piece.exit.portal.targetCellId);
      const zAtExit = o.z + d.z * (piece.tExit / s);
      if (!target || zAtExit > Math.min(cell.heightMeters, target.heightMeters) + aimPointToleranceMeters) {
        break;
      }
    }
  }

  return candidates.sort(compareAimTargets);
}

/**
 * Returns the best aim target along the ray, or `undefined` if nothing is hit.
 */
export function resolveAimTargets(request: ResolveAimTargetRequest): readonly AimTarget[] {
  return resolveAimTargetsByRayWalk(request);
}

// A zero-length piece-like window used for vertical rays and as the fallback: only the origin cell, identity frame.
function singleCellPiece(cellId: string, lengthMeters: number): SegmentWalkPiece {
  return { cellId, cellFromStart: identityRigidTransform3, tEnter: 0, tExit: lengthMeters, exit: { kind: "end" } };
}

// Horizontal walk of the ray; if the start lies outside its cell the ray is tested in that cell alone, without crossings.
function walkRayPieces(
  world: CompiledCellComplex,
  cellId: string,
  o: Vec3,
  d: Vec3,
  s: number,
  maxEmitterDistanceMeters: number,
): readonly SegmentWalkPiece[] {
  const result = walkDevelopedSegment({
    world,
    cellId,
    start: { x: o.x, y: o.y },
    direction: { x: d.x / s, y: d.y / s },
    lengthMeters: maxEmitterDistanceMeters * s,
    maxCrossings: maxRayWalkCrossings,
  });
  return result.pieces.length > 0 ? result.pieces : [singleCellPiece(cellId, maxEmitterDistanceMeters * s)];
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

// Object proxy hit for one object in the cell-local frame (before the window test).
function intersectAimObject(
  object: RuntimeWorldObject,
  origin: Vec3,
  direction: Vec3,
  ignoredGeodesicIds: ReadonlySet<string>,
): ObjectAimHit | undefined {
  const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(object));
  // Pick the proxy shape by object kind: protractor label box, geodesic capsule, cannon cylinder+sphere+handles, collision cylinder, else a small sphere at the pose.
  return object.kind === "protractor-angle"
    ? intersectRayWithProtractorAngleLabelHitbox(object, origin, direction)
    : object.kind === "geodesic-segment"
    ? intersectRayWithSelectableSegment(object, origin, direction)
    : object.kind === "geodesic-cannon"
      ? intersectRayWithGeodesicEmitterAimCylinder(origin, direction, object, ignoredGeodesicIds)
    : bounds
      ? intersectRayWithVerticalCylinder(origin, direction, bounds)
      : intersectRayWithSphere(origin, direction, object.localPose.translation, fallbackObjectRadiusMeters);
}

function resolveObjectAimTargets(
  registry: RuntimeObjectRegistry,
  cell: CompiledPrismCell,
  ray: CellRay,
  window: HitWindow,
  maxDistanceMeters: number,
  maxEmitterDistanceMeters: number,
  ignoredGeodesicIds: ReadonlySet<string>,
  hopCount: number,
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

    let hit = intersectAimObject(object, ray.origin, ray.direction, ignoredGeodesicIds);
    if (hit && hit.distance < window.tMin - hitWindowToleranceMeters && window.tMin > 0) {
      // The nearest surface lies before this cell copy (the proxy pokes across the entry portal); the part of the proxy
      // inside this cell is what the ray can hit here, so test again from the window start.
      const shifted = intersectAimObject(object, pointOnRay(ray.origin, ray.direction, window.tMin), ray.direction, ignoredGeodesicIds);
      hit = shifted ? { ...shifted, distance: shifted.distance + window.tMin } : undefined;
    }

    const targetMaxDistanceMeters = object.kind === "geodesic-cannon" ? maxEmitterDistanceMeters : maxDistanceMeters;
    if (
      !hit ||
      hit.distance > targetMaxDistanceMeters ||
      hit.distance < window.tMin - hitWindowToleranceMeters ||
      hit.distance > window.tMax + hitWindowToleranceMeters
    ) {
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
      rootPoint: transformPoint3(ray.rootFromCell, targetLocalPoint),
      rootNormal: normalizeVec3(transformDirection3(ray.rootFromCell, hit.normal)),
      // The cell maps are rigid, so the ray parameter equals the distance in every frame.
      distanceMeters: hit.distance,
      hopCount,
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
  distance: number,
  hopCount: number,
): readonly AimTarget[] {
  if (!Number.isFinite(distance) || distance <= aimPointToleranceMeters) {
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
    rootPoint: transformPoint3(ray.rootFromCell, floorPoint),
    rootNormal: normalizeVec3(transformDirection3(ray.rootFromCell, { x: 0, y: 0, z: 1 })),
    distanceMeters: distance,
    hopCount,
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
