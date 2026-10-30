/**
 * Emitter (cannon) operations: shooting, extending and re-aiming geodesics, connecting a geodesic to an emitter, rebuilding locked geodesics between emitters, and placing cannons on the floor, on a geodesic or at a geodesic vertex.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { getDynamicObjectCollisionBounds, simpleCylinderIntersectsSimpleCylinder, testCellCollision } from "../../movement/collision";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { addVec3, distanceSquaredVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import { type RuntimeObjectRegistry, runtimeObjectToDynamicObjectState } from "../runtimeObjectRegistry";
import {
  canExtendGeodesicSegment,
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  defaultTraceLengthMeters,
  directionFromYaw,
  emitterConnectionToleranceMeters,
  type GeodesicCannonObject,
  type GeodesicCarryPortalTransition,
  type GeodesicEndRole,
  type GeodesicPortalTraversal,
  geodesicRayBeamStartOffsetMeters,
  type GeodesicSegmentObject,
  getGeodesicCannonEmitterPoint,
  getOppositeEndRole,
  intersectionTolerance,
  isGeodesicSegmentObject,
  minGeodesicSegmentLengthMeters,
  type PlaceGeodesicCannonResult,
  sanitizeYaw,
} from "./objects";
import { findNearestEmitterHitOnTrace, traceGeodesicSegment } from "./trace";
import { updateGeodesicIntersectionObjects } from "./intersections";
import { isAimableFreeGeodesic } from "./endpoints";
import {
  canConnectGeodesicSegmentAtDistance,
  distanceAlongSegment,
  getGeodesicSegments,
  getGeodesicTail,
  getGeodesicTotalLengthMeters,
  removeGeodesicSegments,
  resolveEndpointTangentAtAnchor,
  syncLegacyEmitterGeodesicFields,
  totalGeodesicLengthFromSegments,
  totalLengthThroughSegment,
} from "./segments";
import { isGeodesicLocked, removeGeodesic } from "./lifecycle";
import {
  aimFreeGeodesicFromEndpoint,
  lockedIntervalRebuildHitsForbiddenZone,
  rebuildLockedGeodesicFromEndpointsAndPortalWord,
  splitGeodesicIntervalAtSegmentHit,
} from "./intervals";

/**
 * Input for `shootGeodesic`: aim a cannon's geodesic along the cannon's yaw and trace it for `maxLengthMeters`.
 */
export interface ShootGeodesicInput {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** Emitter snapshot to shoot from; its pose, cell and `aimYawRadians` are written back to the registry copy. */
  readonly cannon: GeodesicCannonObject;
  /** Id of the geodesic interval to create (or to re-aim if it already exists). */
  readonly geodesicId: string;
  /** Total chord length to trace in meters; defaults to `defaultTraceLengthMeters` (2). */
  readonly maxLengthMeters?: number;
  /** If true (default), a trace that ends at another emitter attaches the free end to it, producing a locked geodesic. */
  readonly connectEmitters?: boolean;
}

/**
 * Input for `extendGeodesic`: lengthen an aimable free geodesic by `maxLengthMeters` along its emitter tangent.
 */
export interface ExtendGeodesicInput {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** Id of the geodesic interval to extend. */
  readonly geodesicId: string;
  /** Extra length in meters added beyond the current total; defaults to `defaultTraceLengthMeters` (2). */
  readonly maxLengthMeters?: number;
  readonly connectEmitters?: boolean;
}

/**
 * Input for `rebuildGeodesicToLength`: re-shoot a geodesic from its cannon with a new total length.
 */
export interface RebuildGeodesicToLengthInput {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly cannon: GeodesicCannonObject;
  readonly geodesicId: string;
  /** Desired total length in meters; a non-positive or non-finite value clears the geodesic's segments and returns `[]`. */
  readonly totalLengthMeters: number;
  /** If true (default), the trace may end by attaching to an emitter it reaches. */
  readonly connectEmitters?: boolean;
  /** If true, the cannon is first re-aimed at the nearest emitter lying on its straight ray (within tolerance). */
  readonly snapToEmitter?: boolean;
  /** If true, the geodesic is deleted when its trace ends in a forbidden zone. */
  readonly breakOnForbiddenZone?: boolean;
  /** If false/absent, a locked (emitter-to-emitter) geodesic is returned unchanged instead of being re-shot. */
  readonly rebuildLocked?: boolean;
}

/** Request for `placeGeodesicCannonAtFloorPoint`: put a new cannon with id `id` on the floor of `cellId`. */
export interface PlaceGeodesicCannonAtFloorPointRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly cellId: string;
  /** Floor position in `cellId`'s frame (meters); only x and y are used, z is forced to 0. */
  readonly floorPoint: Vec3;
  readonly aimYawRadians: number;
  readonly id: string;
}

/** Request for `placeGeodesicCannonOnGeodesic`: put a new cannon on a segment of an existing free geodesic, splitting it there. */
export interface PlaceGeodesicCannonOnGeodesicRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** Id of the geodesic interval to split. */
  readonly geodesicId: string;
  /** Segment of that geodesic that carries the placement point; must belong to `geodesicId`. */
  readonly segmentId: string;
  /** Distance from the segment start to the placement point, meters; clamped to `[0, segment.lengthMeters]`. */
  readonly distanceAlongSegmentMeters: number;
  readonly aimYawRadians: number;
  readonly id: string;
}

/** Request for `placeGeodesicCannonAtGeodesicVertex`: put a cannon at a point where geodesics cross in a cell, cutting each passing geodesic there. */
export interface PlaceGeodesicCannonAtGeodesicVertexRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly cellId: string;
  /** Vertex position in `cellId`'s frame, meters (z ignored). */
  readonly vertexPoint: Vec3;
  readonly aimYawRadians: number;
  readonly id: string;
  /** Id factory for the geodesic that continues beyond the new cannon; `sideIndex` counts continuations created so far in this request. */
  readonly createContinuationGeodesicId: (sourceGeodesicId: string, sideIndex: number) => string;
}

/** Request for `connectGeodesicToEmitter`: close a free geodesic onto a second emitter. */
export interface ConnectGeodesicToEmitterRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** Geodesic to close. */
  readonly geodesicId: string;
  /** Emitter the geodesic must end at. */
  readonly incomingEmitterId: string;
  /** Length in meters to trace from the source emitter along its tangent when looking for the incoming emitter. */
  readonly totalLengthMeters: number;
}

/** Request for `rebuildConnectedGeodesicBetweenEmitters`: recompute a locked geodesic after one of its emitters moved. */
export interface RebuildConnectedGeodesicBetweenEmittersRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** The locked geodesic to rebuild. */
  readonly geodesicId: string;
  /** Emitter that was just carried (moved); a portal crossing it made is folded into the portal word. Absent: rebuild with the stored word. */
  readonly carriedEmitterId?: string;
  /** Snapshot of the carried emitter before the move; used to infer which portal it crossed. */
  readonly carriedEmitterBeforeMove?: GeodesicCannonObject;
  /** Portal crossing reported by the mover; used when it matches the cells of the move. */
  readonly carriedEmitterPortalTransition?: GeodesicCarryPortalTransition;
  /** Explicit replacement portal word (highest precedence); must chain from the start anchor's cell to the end anchor's cell. */
  readonly carriedPortalWord?: readonly GeodesicPortalTraversal[];
  /** If true, a failed rebuild keeps the old geodesic instead of deleting it (a forbidden-zone hit still deletes it). */
  readonly preserveGeodesicOnRebuildFailure?: boolean;
  /** If true, the rebuild may realize a different portal word than the expected one (the carried endpoint may leave the expected cell chain). */
  readonly allowOutOfBoundsCarriedEndpoint?: boolean;
}

/**
 * Adds a new cannon standing on the floor at `floorPoint` unless the spot is blocked.
 *
 * Returns `{ placed: false, reason }` with `"missing-cell"` (unknown cell), `"cell-collision"` (cannon cylinder would
 * intersect walls/forbidden zones, per `testCellCollision`) or `"runtime-object-collision"` (overlaps another collidable
 * object in the cell); never throws. On success the cannon is added to the registry. Frame: cell-local, z forced to 0.
 */
export function placeGeodesicCannonAtFloorPoint(
  request: PlaceGeodesicCannonAtFloorPointRequest,
): PlaceGeodesicCannonResult {
  const cell = request.world.cellsById.get(request.cellId);
  if (!cell) {
    return { placed: false, reason: "missing-cell" };
  }

  const candidate = createGeodesicCannonObject({
    id: request.id,
    cellId: request.cellId,
    localPose: yawRigidTransform3(request.aimYawRadians, {
      x: request.floorPoint.x,
      y: request.floorPoint.y,
      z: 0,
    }),
    aimYawRadians: request.aimYawRadians,
  });
  const candidateState = runtimeObjectToDynamicObjectState(candidate);
  const collision = testCellCollision({ cell, object: candidateState });
  if (collision.blocked) {
    return { placed: false, reason: "cell-collision" };
  }

  const candidateBounds = getDynamicObjectCollisionBounds(candidateState);
  if (candidateBounds) {
    for (const object of request.registry.getCollidableObjectsInCell(request.cellId)) {
      const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(object));
      if (bounds && simpleCylinderIntersectsSimpleCylinder(candidateBounds, bounds)) {
        return { placed: false, reason: "runtime-object-collision" };
      }
    }
  }

  request.registry.add(candidate);
  return { placed: true, object: candidate };
}

// ---- Shooting, extending, rebuilding by length ----

/**
 * Emits (or re-aims) a free geodesic from a cannon along its yaw and returns its first derived segment.
 *
 * If the interval `geodesicId` does not exist, creates a free end `<geodesicId>:free-end` at the straight-line target point and a
 * stable interval from the cannon to it, then re-aims it with `aimFreeGeodesicFromEndpoint`, which develops the ray through
 * portals and fixes the portal word from the actual trace. Updates the cannon's caches (active geodesic, yaw) and refreshes
 * intersections. Throws `Error` if the trace produced no segment (for example the existing interval is not an aimable free
 * geodesic, or the length is below the minimum). Units: meters, radians.
 */
export function shootGeodesic(input: ShootGeodesicInput): GeodesicSegmentObject {
  const aimYawRadians = sanitizeYaw(input.cannon.aimYawRadians);
  const direction = directionFromYaw(aimYawRadians);
  const start = getGeodesicCannonEmitterPoint(input.cannon);
  const targetPoint = addVec3(start, scaleVec3(direction, input.maxLengthMeters ?? defaultTraceLengthMeters));
  let interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    const freeEndId = `${input.geodesicId}:free-end`;
    input.registry.add(createFreeGeodesicEndObject({
      id: freeEndId,
      cellId: input.cannon.cellId,
      point: targetPoint,
    }));
    input.registry.add(createGeodesicIntervalObject({
      id: input.geodesicId,
      startAnchorObjectId: input.cannon.id,
      endAnchorObjectId: freeEndId,
      startCellId: input.cannon.cellId,
    }));
  }
  const result = aimFreeGeodesicFromEndpoint({
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    emitterEndRole: "start",
    targetPointInEmitterCell: targetPoint,
    connectEmitters: input.connectEmitters ?? true,
  });
  const segment = result?.segments[0];
  if (!segment) {
    throw new Error(`Failed to shoot geodesic "${input.geodesicId}".`);
  }
  const currentCannon = input.registry.get(input.cannon.id);
  const cannonForUpdate = currentCannon?.kind === "geodesic-cannon"
    ? {
        ...currentCannon,
        cellId: input.cannon.cellId,
        localPose: input.cannon.localPose,
        aimYawRadians: input.cannon.aimYawRadians,
      }
    : input.cannon;
  input.registry.update({
    ...cannonForUpdate,
    activeGeodesicId: input.geodesicId,
    geodesicIds: cannonForUpdate.geodesicIds.includes(input.geodesicId)
      ? cannonForUpdate.geodesicIds
      : [...cannonForUpdate.geodesicIds, input.geodesicId],
    geodesicEmitterYawRadiansById: {
      ...cannonForUpdate.geodesicEmitterYawRadiansById,
      [input.geodesicId]: aimYawRadians,
    },
  });
  syncLegacyEmitterGeodesicFields(input.registry, input.geodesicId);
  updateGeodesicIntersectionObjects(input.registry);
  return segment;
}

/**
 * Lengthens an aimable free geodesic by re-aiming it from its emitter along the current tangent, and returns its new last segment.
 *
 * The new target is the emitter point plus the tangent direction times (current total length + extension); tracing through
 * portals then yields the new portal word. Returns `undefined` if the interval is not an aimable free geodesic, the emitter is
 * missing, the tail segment ended at a wall/zone/emitter (see `canExtendGeodesicSegment`), or the re-aim fails.
 */
export function extendGeodesic(input: ExtendGeodesicInput): GeodesicSegmentObject | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval" || !isAimableFreeGeodesic(input.registry, interval)) {
    return undefined;
  }
  const emitterRole: GeodesicEndRole = input.registry.get(interval.start.anchorObjectId)?.kind === "geodesic-cannon"
    ? "start"
    : "end";
  const emitter = input.registry.get(interval[emitterRole].anchorObjectId);
  const tail = getGeodesicTail(input.registry, input.geodesicId);
  if (emitter?.kind !== "geodesic-cannon" || !tail || !canExtendGeodesicSegment(tail)) {
    return undefined;
  }
  const tangent = resolveEndpointTangentAtAnchor({
    registry: input.registry,
    geodesicId: input.geodesicId,
    endRole: emitterRole,
  });
  const yaw = tangent?.yawRadians ?? emitter.aimYawRadians;
  const targetPoint = addVec3(
    getGeodesicCannonEmitterPoint(emitter),
    scaleVec3(directionFromYaw(yaw), getGeodesicTotalLengthMeters(input.registry, input.geodesicId) + (input.maxLengthMeters ?? defaultTraceLengthMeters)),
  );
  const result = aimFreeGeodesicFromEndpoint({
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    emitterEndRole: emitterRole,
    targetPointInEmitterCell: targetPoint,
    connectEmitters: input.connectEmitters ?? true,
  });
  return result?.segments.at(-1);
}

/**
 * Re-shoots a geodesic from its cannon so that its total length is `totalLengthMeters`, returning the new segments.
 *
 * Locked geodesics are returned unchanged unless `rebuildLocked` is set. Never throws on bad lengths (clears and returns `[]`),
 * but may throw via `shootGeodesic` if the shot yields nothing.
 */
export function rebuildGeodesicToLength(input: RebuildGeodesicToLengthInput): readonly GeodesicSegmentObject[] {
  if (!input.rebuildLocked && isGeodesicLocked(input.registry, input.geodesicId)) {
    return getGeodesicSegments(input.registry, input.geodesicId);
  }

  return rebuildUnlockedGeodesicToLength(input);
}

// Core of `rebuildGeodesicToLength`: optionally snap the aim to an emitter, delete the old segments, re-shoot, and optionally
// delete the geodesic if it ended in a forbidden zone.
function rebuildUnlockedGeodesicToLength(input: RebuildGeodesicToLengthInput): readonly GeodesicSegmentObject[] {
  if (!(input.totalLengthMeters > 0) || !Number.isFinite(input.totalLengthMeters)) {
    removeGeodesicSegments(input.registry, input.geodesicId);
    return [];
  }

  const yawAdjustedCannon = resolveCannonForGeodesic(input.cannon, input.geodesicId);
  const cannon = input.snapToEmitter
    ? resolveCannonSnappedToEmitter({ ...input, cannon: yawAdjustedCannon }) ?? yawAdjustedCannon
    : yawAdjustedCannon;

  if (cannon !== input.cannon) {
    input.registry.update(cannon);
  }

  // The old segments are replaced by the re-shot (`replaceDerivedSegmentsFromTraces`), which keeps the display number.
  shootGeodesic({
    world: input.world,
    registry: input.registry,
    cannon,
    geodesicId: input.geodesicId,
    maxLengthMeters: input.totalLengthMeters,
    connectEmitters: input.connectEmitters ?? true,
  });
  if (input.breakOnForbiddenZone && getGeodesicTail(input.registry, input.geodesicId)?.terminal.kind === "forbidden-zone-hit") {
    removeGeodesic(input.registry, input.geodesicId);
    return [];
  }
  updateGeodesicIntersectionObjects(input.registry);
  return getGeodesicSegments(input.registry, input.geodesicId);
}

// Re-aims the cannon at the nearest emitter that lies within `emitterConnectionToleranceMeters` of the first straight piece
// (an unconnected single-cell trace), so a geodesic aimed almost exactly at an emitter is snapped onto it.
// Only the first cell's piece is examined; emitters beyond a portal are not candidates.
function resolveCannonSnappedToEmitter(input: RebuildGeodesicToLengthInput): GeodesicCannonObject | undefined {
  if (!(input.totalLengthMeters > 0) || !Number.isFinite(input.totalLengthMeters)) {
    return undefined;
  }

  const direction = directionFromYaw(input.cannon.aimYawRadians);
  const start = addVec3(
    getGeodesicCannonEmitterPoint(input.cannon),
    scaleVec3(direction, geodesicRayBeamStartOffsetMeters),
  );
  const unconnectedTrace = traceGeodesicSegment({
    world: input.world,
    cellId: input.cannon.cellId,
    start,
    direction,
    maxLengthMeters: input.totalLengthMeters,
  });
  const hit = findNearestEmitterHitOnTrace({
    registry: input.registry,
    sourceEmitterId: input.cannon.id,
    geodesicId: input.geodesicId,
    cellId: unconnectedTrace.cellId,
    start: unconnectedTrace.start,
    direction: unconnectedTrace.direction,
    maxLengthMeters: unconnectedTrace.lengthMeters,
  });
  if (!hit) {
    return undefined;
  }

  const nextYaw = sanitizeYaw(Math.atan2(
    hit.emitter.localPose.translation.y - input.cannon.localPose.translation.y,
    hit.emitter.localPose.translation.x - input.cannon.localPose.translation.x,
  ));
  return {
    ...input.cannon,
    aimYawRadians: nextYaw,
    localPose: yawRigidTransform3(nextYaw, input.cannon.localPose.translation),
    activeGeodesicId: input.geodesicId,
    geodesicIds: input.cannon.geodesicIds.includes(input.geodesicId)
      ? input.cannon.geodesicIds
      : [...input.cannon.geodesicIds, input.geodesicId],
    geodesicEmitterYawRadiansById: {
      ...input.cannon.geodesicEmitterYawRadiansById,
      [input.geodesicId]: nextYaw,
    },
  };
}

function resolveEmitterYawForGeodesic(cannon: GeodesicCannonObject, geodesicId: string): number {
  return sanitizeYaw(cannon.geodesicEmitterYawRadiansById?.[geodesicId] ?? cannon.aimYawRadians);
}

function resolveCannonForGeodesic(cannon: GeodesicCannonObject, geodesicId: string): GeodesicCannonObject {
  const aimYawRadians = resolveEmitterYawForGeodesic(cannon, geodesicId);
  if (Math.abs(sanitizeYaw(cannon.aimYawRadians - aimYawRadians)) <= intersectionTolerance) {
    return cannon;
  }

  return {
    ...cannon,
    aimYawRadians,
    localPose: yawRigidTransform3(aimYawRadians, cannon.localPose.translation),
  };
}

// ---- Connection and locking ----

/**
 * Tries to close a free geodesic onto the emitter `incomingEmitterId`, producing a locked geodesic.
 *
 * Interval path: re-aims along the emitter tangent for `totalLengthMeters` with emitter connection enabled and only keeps the
 * result if the trace ends exactly at `incomingEmitterId` (otherwise the free geodesic is re-aimed but no connection is made;
 * the current segments are returned). A non-interval id changes nothing and returns its current segments. Always returns the geodesic's segments
 * (possibly empty); does not throw.
 */
export function connectGeodesicToEmitter(
  request: ConnectGeodesicToEmitterRequest,
): readonly GeodesicSegmentObject[] {
  const interval = request.registry.get(request.geodesicId);
  const incoming = request.registry.get(request.incomingEmitterId);
  if (interval?.kind === "geodesic-interval") {
    if (incoming?.kind !== "geodesic-cannon") {
      return getGeodesicSegments(request.registry, request.geodesicId);
    }
    const freeRole = request.registry.get(interval.start.anchorObjectId)?.kind === "free-geodesic-end"
      ? "start"
      : request.registry.get(interval.end.anchorObjectId)?.kind === "free-geodesic-end"
        ? "end"
        : undefined;
    const emitterRole = freeRole ? getOppositeEndRole(freeRole) : undefined;
    if (!freeRole || !emitterRole) {
      return getGeodesicSegments(request.registry, request.geodesicId);
    }
    const emitter = request.registry.get(interval[emitterRole].anchorObjectId);
    if (emitter?.kind !== "geodesic-cannon") {
      return getGeodesicSegments(request.registry, request.geodesicId);
    }
    const tangent = resolveEndpointTangentAtAnchor({
      registry: request.registry,
      geodesicId: request.geodesicId,
      endRole: emitterRole,
    });
    const yaw = tangent?.yawRadians ?? emitter.aimYawRadians;
    const targetPoint = addVec3(
      getGeodesicCannonEmitterPoint(emitter),
      scaleVec3(directionFromYaw(yaw), request.totalLengthMeters),
    );
    const result = aimFreeGeodesicFromEndpoint({
      world: request.world,
      registry: request.registry,
      geodesicId: request.geodesicId,
      emitterEndRole: emitterRole,
      targetPointInEmitterCell: targetPoint,
      connectEmitters: true,
    });
    const tail = result?.segments.at(-1);
    if (!result || tail?.terminal.kind !== "emitter-hit") {
      return getGeodesicSegments(request.registry, request.geodesicId);
    }
    if (tail.terminal.emitterId !== request.incomingEmitterId) {
      return getGeodesicSegments(request.registry, request.geodesicId);
    }
    syncLegacyEmitterGeodesicFields(request.registry, request.geodesicId);
    updateGeodesicIntersectionObjects(request.registry);
    return getGeodesicSegments(request.registry, request.geodesicId);
  }

  return getGeodesicSegments(request.registry, request.geodesicId);
}

/**
 * Recomputes a locked geodesic after one of its emitters moved, keeping its homotopy class when possible.
 *
 * Interval path: delegates to `rebuildLockedGeodesicFromEndpointsAndPortalWord`. On failure the geodesic is deleted if the new chord
 * would hit a forbidden zone (checked read-only by `lockedIntervalRebuildHitsForbiddenZone`), kept as is when
 * `preserveGeodesicOnRebuildFailure`, and otherwise deleted. Returns the segments (empty when deleted).
 * A non-interval id changes nothing and returns its current segments.
 */
export function rebuildConnectedGeodesicBetweenEmitters(
  request: RebuildConnectedGeodesicBetweenEmittersRequest,
): readonly GeodesicSegmentObject[] {
  const interval = request.registry.get(request.geodesicId);
  if (interval?.kind === "geodesic-interval") {
    if (!isGeodesicLocked(request.registry, request.geodesicId)) {
      return getGeodesicSegments(request.registry, request.geodesicId);
    }
    const result = rebuildLockedGeodesicFromEndpointsAndPortalWord({
      world: request.world,
      registry: request.registry,
      geodesicId: request.geodesicId,
      carriedAnchorObjectId: request.carriedEmitterId,
      carriedAnchorBeforeMove: request.carriedEmitterBeforeMove,
      carriedPortalTransition: request.carriedEmitterPortalTransition,
      carriedPortalWord: request.carriedPortalWord,
      allowOutOfBoundsCarriedEndpoint: request.allowOutOfBoundsCarriedEndpoint,
    });
    if (!result) {
      if (lockedIntervalRebuildHitsForbiddenZone({
        world: request.world,
        registry: request.registry,
        geodesicId: request.geodesicId,
      })) {
        removeGeodesic(request.registry, request.geodesicId);
        return [];
      }
      if (request.preserveGeodesicOnRebuildFailure) {
        return getGeodesicSegments(request.registry, request.geodesicId);
      }
      removeGeodesic(request.registry, request.geodesicId);
      return [];
    }
    return result.segments;
  }

  return getGeodesicSegments(request.registry, request.geodesicId);
}

// ---- Placing cannons on geodesics ----

/**
 * Places a new cannon at a point of a free geodesic and splits the geodesic there into two intervals.
 *
 * The point is `distanceAlongSegmentMeters` (clamped to the segment) along the segment; it must be at least `minGeodesicSegmentLengthMeters`
 * from the segment start. The cannon is first placed on the floor below the point (`placeGeodesicCannonAtFloorPoint`), then
 * `splitGeodesicIntervalAtSegmentHit` is applied; if the split is refused the cannon is removed again.
 * Returns the stored cannon on success. Failure reasons are coarse: `"missing-cell"` for an unknown/foreign segment, `"cell-collision"`
 * for a too-near cut or refused split, or the collision reasons of the floor placement. Mutates the registry; does not throw.
 */
export function placeGeodesicCannonOnGeodesic(
  request: PlaceGeodesicCannonOnGeodesicRequest,
): PlaceGeodesicCannonResult {
  const segment = request.registry.get(request.segmentId);
  if (segment?.kind !== "geodesic-segment" || segment.geodesicId !== request.geodesicId) {
    return { placed: false, reason: "missing-cell" };
  }

  const clampedDistance = Math.min(segment.lengthMeters, Math.max(0, request.distanceAlongSegmentMeters));
  if (!canConnectGeodesicSegmentAtDistance(clampedDistance)) {
    return { placed: false, reason: "cell-collision" };
  }
  const floorPoint = {
    x: segment.start.x + segment.direction.x * clampedDistance,
    y: segment.start.y + segment.direction.y * clampedDistance,
    z: 0,
  };
  const result = placeGeodesicCannonAtFloorPoint({
    world: request.world,
    registry: request.registry,
    cellId: segment.cellId,
    floorPoint,
    aimYawRadians: request.aimYawRadians,
    id: request.id,
  });
  if (!result.placed || !result.object) {
    return result;
  }

  const split = splitGeodesicIntervalAtSegmentHit({
    world: request.world,
    registry: request.registry,
    geodesicId: request.geodesicId,
    segmentId: request.segmentId,
    distanceAlongSegmentMeters: clampedDistance,
    placedEmitterId: result.object.id,
    createContinuationGeodesicId: (sourceGeodesicId) => `${sourceGeodesicId}:continuation:${result.object?.id ?? request.id}`,
  });
  if (split.length === 0) {
    request.registry.remove(result.object.id);
    return { placed: false, reason: "cell-collision" };
  }

  const placed = request.registry.get(result.object.id);
  return placed?.kind === "geodesic-cannon" ? { placed: true, object: placed } : result;
}

/**
 * Places a cannon at a vertex where segments pass and cuts every passing geodesic there, connecting the pieces to the new cannon.
 *
 * Vertex discovery (`findSegmentsPassingThroughVertex`) accepts segments of the cell that pass within `emitterConnectionToleranceMeters`
 * of `vertexPoint` at least `minGeodesicSegmentLengthMeters` from their start. For each match the geodesic is retraced to the cut and
 * connected to the new cannon (`connectGeodesicToEmitter`) and, if enough length remains, a continuation geodesic is shot from the cannon
 * along the old direction (and re-connected to the old terminal emitter if there was one). Returns the stored cannon on success;
 * `{ placed: false, reason: "missing-cell" }` when no segment passes through the vertex, or the floor-placement failure reason.
 * Mutates the registry; does not throw. Geodesics matched at this vertex are processed in geodesic-id order.
 */
export function placeGeodesicCannonAtGeodesicVertex(
  request: PlaceGeodesicCannonAtGeodesicVertexRequest,
): PlaceGeodesicCannonResult {
  const connectedSegments = findSegmentsPassingThroughVertex(
    request.registry,
    request.cellId,
    request.vertexPoint,
  );
  if (connectedSegments.length === 0) {
    return { placed: false, reason: "missing-cell" };
  }

  const floorPoint = { x: request.vertexPoint.x, y: request.vertexPoint.y, z: 0 };
  const result = placeGeodesicCannonAtFloorPoint({
    world: request.world,
    registry: request.registry,
    cellId: request.cellId,
    floorPoint,
    aimYawRadians: request.aimYawRadians,
    id: request.id,
  });
  if (!result.placed || !result.object) {
    return result;
  }

  const originalSegmentsByGeodesicId = new Map<string, readonly GeodesicSegmentObject[]>();
  for (const match of connectedSegments) {
    if (!originalSegmentsByGeodesicId.has(match.segment.geodesicId)) {
      originalSegmentsByGeodesicId.set(
        match.segment.geodesicId,
        getGeodesicSegments(request.registry, match.segment.geodesicId),
      );
    }
  }

  let continuationSideIndex = 0;
  for (const match of connectedSegments) {
    const originalSegments = originalSegmentsByGeodesicId.get(match.segment.geodesicId) ?? [];
    const totalLengthMeters = totalLengthThroughSegment(originalSegments, match.segment, match.distanceAlongSegmentMeters);
    const continuationLengthMeters = totalGeodesicLengthFromSegments(originalSegments) - totalLengthMeters;
    const continuationTerminal = originalSegments.at(-1)?.terminal;
    const shouldCreateContinuation = continuationLengthMeters >=
      geodesicRayBeamStartOffsetMeters + minGeodesicSegmentLengthMeters - intersectionTolerance;

    connectGeodesicToEmitter({
      world: request.world,
      registry: request.registry,
      geodesicId: match.segment.geodesicId,
      incomingEmitterId: result.object.id,
      totalLengthMeters,
    });

    if (!shouldCreateContinuation) {
      continue;
    }

    const continuationGeodesicId = request.createContinuationGeodesicId(
      match.segment.geodesicId,
      continuationSideIndex++,
    );
    const yaw = Math.atan2(match.segment.direction.y, match.segment.direction.x);
    const placed = request.registry.get(result.object.id);
    if (placed?.kind !== "geodesic-cannon") {
      break;
    }

    const continuationSource = createGeodesicCannonObject({
      ...placed,
      aimYawRadians: yaw,
      geodesicIds: placed.geodesicIds.includes(continuationGeodesicId)
        ? placed.geodesicIds
        : [...placed.geodesicIds, continuationGeodesicId],
      geodesicEmitterYawRadiansById: {
        ...placed.geodesicEmitterYawRadiansById,
        [continuationGeodesicId]: yaw,
      },
    });
    request.registry.update(continuationSource);
    const created = shootGeodesic({
      world: request.world,
      registry: request.registry,
      cannon: continuationSource,
      geodesicId: continuationGeodesicId,
      maxLengthMeters: continuationLengthMeters - geodesicRayBeamStartOffsetMeters,
    });
    if (continuationTerminal?.kind === "emitter-hit") {
      connectGeodesicToEmitter({
        world: request.world,
        registry: request.registry,
        geodesicId: continuationGeodesicId,
        incomingEmitterId: continuationTerminal.emitterId,
        totalLengthMeters: continuationLengthMeters - geodesicRayBeamStartOffsetMeters,
      });
    } else if (created.lengthMeters < minGeodesicSegmentLengthMeters - intersectionTolerance) {
      removeGeodesic(request.registry, continuationGeodesicId);
    }
  }

  updateGeodesicIntersectionObjects(request.registry);
  const placed = request.registry.get(result.object.id);
  return placed?.kind === "geodesic-cannon" ? { placed: true, object: placed } : result;
}

// A cut point must leave at least the minimum length on BOTH sides within the segment.
function canSplitGeodesicSegmentAtDistance(
  segment: GeodesicSegmentObject,
  distanceAlongSegmentMeters: number,
): boolean {
  return canConnectGeodesicSegmentAtDistance(distanceAlongSegmentMeters) &&
    segment.lengthMeters - distanceAlongSegmentMeters >= minGeodesicSegmentLengthMeters - intersectionTolerance;
}

// Segments in the cell that pass within the emitter tolerance of the vertex (measured after orthogonal projection onto the segment line)
// and can be split there. The projection parameter may lie anywhere on the infinite line; `canSplitGeodesicSegmentAtDistance` restricts it to the segment.
function findSegmentsPassingThroughVertex(
  registry: RuntimeObjectRegistry,
  cellId: string,
  vertexPoint: Vec3,
): readonly { readonly segment: GeodesicSegmentObject; readonly distanceAlongSegmentMeters: number }[] {
  return registry.getObjectsInCell(cellId)
    .filter(isGeodesicSegmentObject)
    .map((segment) => ({
      segment,
      distanceAlongSegmentMeters: distanceAlongSegment(segment, vertexPoint),
    }))
    .filter(({ segment, distanceAlongSegmentMeters }) =>
      canSplitGeodesicSegmentAtDistance(segment, distanceAlongSegmentMeters) &&
      distanceSquaredVec3(
        addVec3(segment.start, scaleVec3(segment.direction, distanceAlongSegmentMeters)),
        { x: vertexPoint.x, y: vertexPoint.y, z: segment.start.z },
      ) <= emitterConnectionToleranceMeters * emitterConnectionToleranceMeters
    )
    .sort((left, right) => left.segment.geodesicId.localeCompare(right.segment.geodesicId));
}
