/**
 * Facade that re-exports the geodesic modules of `src/world-objects/geodesic/` under their old names while they are being split
 * (job 25); it will be deleted.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { getDynamicObjectCollisionBounds, simpleCylinderIntersectsSimpleCylinder, testCellCollision } from "../movement/collision";
import { AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE, moveDynamicObject } from "../movement/moveDynamicObject";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  yawRigidTransform3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import { crossXY } from "../math/vec2";
import { addVec3, distanceSquaredVec3, distanceVec3, scaleVec3, subVec3, type Vec3 } from "../math/vec3";
import { type RuntimeObjectRegistry, type RuntimeWorldObject, runtimeObjectToDynamicObjectState } from "./runtimeObjectRegistry";
import {
  canExtendGeodesicSegment,
  canObjectAttachGeodesics,
  createCurveShorteningPairObject,
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  type CurveShorteningPairObject,
  defaultTraceLengthMeters,
  directionFromYaw,
  emitterConnectionToleranceMeters,
  type FreeGeodesicEndObject,
  GEODESIC_MIN_LENGTH_METERS,
  type GeodesicCannonObject,
  type GeodesicCarryPortalTransition,
  type GeodesicEmitterConnection,
  type GeodesicEndpointAttachment,
  type GeodesicEndpointSelection,
  type GeodesicEndRole,
  type GeodesicHalfRole,
  type GeodesicIntersectionObject,
  type GeodesicIntervalObject,
  type GeodesicPortalTraversal,
  geodesicRayBeamHeightMeters,
  geodesicRayBeamStartOffsetMeters,
  type GeodesicSegmentObject,
  type GeodesicSegmentTerminal,
  type GeodesicTraceBuildResult,
  getAnchorBeamPoint,
  getGeodesicCannonEmitterPoint,
  getGeodesicSegmentEnd,
  getOppositeEndRole,
  intersectionTolerance,
  isCurveShorteningPairObject,
  isFreeGeodesicEndObject,
  isGeodesicIntervalObject,
  isGeodesicSegmentObject,
  type LiftedGeodesicEndpoint,
  minGeodesicSegmentLengthMeters,
  normalizeHorizontalDirection,
  type PlaceGeodesicCannonResult,
  sanitizeYaw,
  type TraceGeodesicSegmentResult,
} from "./geodesic/objects";
import {
  applyAnchorCrossingTraversals,
  collectPortalWordFromTraces,
  getPortalTraversalFromSource,
  getPortalWordBetweenEndpointRoles,
  portalTraversalFromCarryTransition,
  portalWordAfterAnchorCrossing,
  reduceAdjacentInversePortalTraversals,
  reverseGeodesicPortalWord,
  samePortalWord,
} from "./geodesic/portalWord";
import { inversePortalTransform } from "./geodesic/development";
import {
  findNearestEmitterHitOnTrace,
  traceGeodesicPathForConnectionMode,
  traceGeodesicSegment,
  traceTerminalToBuildTerminal,
} from "./geodesic/trace";

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

/** Legacy: request for `tieAndDetachIncidentGeodesics`, the geodesic-id-keyed entry point kept for the retired straightening model. */
export interface TieAndDetachIncidentGeodesicsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** Emitter being detached. */
  readonly emitterId: string;
  /** Id reused for the pair object (and `<id>:free-end`) created, and for the legacy straightening geodesic. */
  readonly geodesicId: string;
  /** The two locked geodesics to tie; if omitted, the emitter must have exactly two selectable attachments. */
  readonly incidentGeodesicIds?: readonly [string, string];
}

/** Request for `tieAndDetachGeodesicEndpoints`: detach two endpoint roles from one emitter and tie them at a new shared free end. */
export interface TieAndDetachGeodesicEndpointsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly detachedEmitterId: string;
  readonly first: GeodesicEndpointSelection;
  readonly second: GeodesicEndpointSelection;
  readonly createPairId: () => string;
  readonly createFreeEndId: () => string;
}

/** Legacy: request for `advanceStraighteningGeodesics`; same shape as `AdvanceCurveShorteningPairsRequest` without the debug sink. */
export interface AdvanceStraighteningGeodesicsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  readonly speedMetersPerSecond?: number;
}

/** Request for `advanceCurveShorteningPairs`: advance every moving pair by `deltaSeconds`. */
export interface AdvanceCurveShorteningPairsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  readonly speedMetersPerSecond?: number;
  readonly onDebugMessage?: (message: string, detail?: unknown) => void;
}

/** Maximum distance (meters) between two geodesic points for them to count as one vertex when placing at a vertex; deliberately generous. */
const vertexContinuityToleranceMeters = 10;

/** Distance (meters) from a geodesic's anchor within which a crossing counts as the anchor itself and is not reported. */
const geodesicAnchorCrossingToleranceMeters = 1e-6;

/** Extra height (meters) above the beam at which an intersection marker is placed. */
const geodesicIntersectionBalloonHeightOffsetMeters = 0.25;

/** Legacy: default speed (m/s) of the retired same-cell straightening model. */
export const geodesicStraighteningSpeedMetersPerSecond = 0.4;

/** Legacy: distance (meters) at which the retired straightening model considers a geodesic straight. */
const geodesicStraighteningToleranceMeters = 0.01;

/** Default speed (m/s) at which a curve-shortening pair's shared free end moves downhill. */
export const curveShorteningDefaultSpeedMetersPerSecond = 0.4;

/** Turn-angle tolerance (radians) below which the free end counts as locally straight, so the pair is ready to fuse. */
export const curveShorteningFuseAngleToleranceRadians = 0.03;

/** Length tolerance (meters): a two-arc pair whose shorter arc is below this is absorbed into one geodesic (`absorbShortCurveShorteningHalf`); slightly above the minimum geodesic length. */
export const curveShorteningFuseStepToleranceMeters = 1.1 * GEODESIC_MIN_LENGTH_METERS;

/** Floor (meters) applied to the arc lengths in the curve-shortening step's distance-to-straight estimate, so that a vanishing arc cannot divide by zero. It no longer gates the step. */
export const curveShorteningMinStepMeters = 0.002;

/**
 * Length tolerance (meters) for the monotone-descent check of curve shortening: a previewed step is committed only if the new total
 * length of the pair's arcs is at most `previousTotalLengthMeters + curveShorteningLengthIncreaseToleranceMeters`.
 */
export const curveShorteningLengthIncreaseToleranceMeters = 1e-4;

/** Per-registry memory of intersection markers so ids remain stable while two segments keep crossing. */
const geodesicIntersectionMemoryByRegistry = new WeakMap<RuntimeObjectRegistry, Map<string, GeodesicIntersectionObject>>();

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

// ---- Registry queries and edits of endpoint attachments ----

/**
 * Lists every interval endpoint attachment (start or end of any interval) whose anchor is `anchorObjectId`.
 *
 * An interval whose both ends attach to the same anchor appears twice (once per role). Order follows registry order.
 */
export function getGeodesicEndpointAttachmentsForAnchor(
  registry: RuntimeObjectRegistry,
  anchorObjectId: string,
): readonly GeodesicEndpointAttachment[] {
  return registry.getAll()
    .filter(isGeodesicIntervalObject)
    .flatMap((interval) => [interval.start, interval.end])
    .filter((attachment) => attachment.anchorObjectId === anchorObjectId);
}

/** Returns `[start, end]` attachments of the interval `geodesicId`, or `undefined` if no such interval exists. */
export function getGeodesicEndpoints(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly [GeodesicEndpointAttachment, GeodesicEndpointAttachment] | undefined {
  const interval = registry.get(geodesicId);
  return interval?.kind === "geodesic-interval" ? [interval.start, interval.end] : undefined;
}

/**
 * Re-attaches one endpoint role of an interval to another anchor object and returns the updated interval.
 *
 * Returns `undefined` (and changes nothing) if the interval does not exist or the new anchor cannot attach geodesics.
 * Does NOT update `startCellId`, the portal word or the derived segments: the caller must keep them consistent and
 * rebuild. Side effects: drops the geodesic id from the previous emitter's lists when no role still uses it, and
 * deletes free ends that became unreferenced.
 */
export function replaceGeodesicEndpointAttachment(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  endRole: GeodesicEndRole,
  nextAnchorObjectId: string,
): GeodesicIntervalObject | undefined {
  const interval = registry.get(geodesicId);
  if (interval?.kind !== "geodesic-interval" || !canObjectAttachGeodesics(registry.get(nextAnchorObjectId))) {
    return undefined;
  }
  const previousAnchorObjectId = interval[endRole].anchorObjectId;

  const next: GeodesicIntervalObject = {
    ...interval,
    [endRole]: {
      geodesicId,
      role: endRole,
      anchorObjectId: nextAnchorObjectId,
    },
  };
  registry.update(next);
  if (
    previousAnchorObjectId !== nextAnchorObjectId &&
    !(["start", "end"] as const).some((role) => next[role].anchorObjectId === previousAnchorObjectId)
  ) {
    removeGeodesicAssociationFromEmitter(registry, previousAnchorObjectId, geodesicId);
  }
  removeUnusedFreeGeodesicEnds(registry);
  return next;
}

/**
 * Deletes an interval together with everything derived from or pointing at it.
 *
 * Removes its segments, the interval, measurements and protractor angles referring to it, intersection markers
 * involving it, emitter list entries, and any free ends left unreferenced; then refreshes intersection markers.
 * No-op for unknown ids (the sweeps simply find nothing).
 */
export function removeGeodesicIntervalAndDerivedObjects(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): void {
  removeGeodesicSegments(registry, geodesicId);
  for (const object of registry.getAll()) {
    if (
      (object.kind === "geodesic-interval" && object.id === geodesicId) ||
      (object.kind === "measured-geodesic-length" && object.geodesicId === geodesicId) ||
      (object.kind === "protractor-angle" &&
        (object.first.geodesicId === geodesicId || object.second.geodesicId === geodesicId)) ||
      (object.kind === "geodesic-intersection" && object.geodesicIds.includes(geodesicId))
    ) {
      registry.remove(object.id);
    }
  }
  removeGeodesicAssociations(registry, geodesicId);
  removeUnusedFreeGeodesicEnds(registry);
  updateGeodesicIntersectionObjects(registry);
}

/** Returns the stored portal word of an interval (ordered `start` -> `end`), or `undefined` if `geodesicId` is not an interval. */
export function getGeodesicPortalWord(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly GeodesicPortalTraversal[] | undefined {
  const interval = registry.get(geodesicId);
  return interval?.kind === "geodesic-interval" ? interval.portalWord : undefined;
}

/**
 * Develops an interval into the source endpoint's cell: pulls the opposite endpoint back through the inverse portal transforms.
 *
 * Math: let the word read from the source be `t_1 ... t_n` with `T_i` = `transformToTarget` of the portal of `t_i`
 * (source-cell frame to target-cell frame). The target anchor lives in the frame of the last target cell; applying
 * `T_n^{-1}`, then `T_{n-1}^{-1}`, ... , `T_1^{-1}` expresses it in the source cell's frame. The geodesic is then the
 * straight segment from `sourcePoint` to that pulled-back point (so both its direction and its length are read off the
 * x/y difference), and it is the unique locally straight path realizing this word between the two anchors.
 *
 * Returns `undefined` if either anchor is missing or cannot attach geodesics, or a traversal names a portal not in
 * `world`. Also returns `undefined` when the stored word does not chain from the start anchor's cell to the end anchor's
 * cell (`portalWordMatchesEndpointCellsWithAnchors`). It does not check that the lifted chord is long enough.
 * Units: meters; z of both points is the anchors' beam height.
 */
export function liftGeodesicEndpoint(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly sourceRole: GeodesicEndRole;
}): LiftedGeodesicEndpoint | undefined {
  const sourceAttachment = input.interval[input.sourceRole];
  const targetRole: GeodesicEndRole = input.sourceRole === "start" ? "end" : "start";
  const targetAttachment = input.interval[targetRole];
  const sourceAnchor = input.registry.get(sourceAttachment.anchorObjectId);
  const targetAnchor = input.registry.get(targetAttachment.anchorObjectId);
  if (!canObjectAttachGeodesics(sourceAnchor) || !canObjectAttachGeodesics(targetAnchor)) {
    return undefined;
  }
  if (!portalWordMatchesEndpointCellsWithAnchors({
    registry: input.registry,
    interval: input.interval,
    word: input.interval.portalWord,
  })) {
    return undefined;
  }

  const portalWordFromSourceToTarget = input.sourceRole === "start"
    ? input.interval.portalWord
    : reverseGeodesicPortalWord(input.interval.portalWord);
  const sourcePoint = getAnchorBeamPoint(sourceAnchor);
  let targetPointInSourceCell = getAnchorBeamPoint(targetAnchor);
  // Pull-back (development): the target anchor is expressed in the frame of the LAST target cell, so undo the traversals from the last
  // to the first: p <- T_i^{-1}(p). After the loop `targetPointInSourceCell` is in the source cell's frame and the geodesic is the
  // straight segment from `sourcePoint` to it. A traversal that names an unknown portal makes the lift fail.
  for (const traversal of portalWordFromSourceToTarget.slice().reverse()) {
    const portal = input.world.cellsById.get(traversal.sourceCellId)?.portalsById.get(traversal.sourcePortalId);
    if (!portal) {
      return undefined;
    }
    targetPointInSourceCell = transformPoint3(inversePortalTransform(portal), targetPointInSourceCell);
  }

  return {
    sourceRole: input.sourceRole,
    targetRole,
    sourceAnchorObjectId: sourceAttachment.anchorObjectId,
    targetAnchorObjectId: targetAttachment.anchorObjectId,
    sourceCellId: sourceAnchor.cellId,
    sourcePoint,
    targetPointInSourceCell,
    portalWordFromSourceToTarget,
  };
}

// Same as `liftGeodesicEndpoint`, but anchors found in `candidateAnchorsById` shadow the registry, so a tick can be
// previewed with a hypothetical free-end position without mutating the registry.
function liftGeodesicEndpointWithAnchors(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly sourceRole: GeodesicEndRole;
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): LiftedGeodesicEndpoint | undefined {
  const sourceAttachment = input.interval[input.sourceRole];
  const targetRole: GeodesicEndRole = input.sourceRole === "start" ? "end" : "start";
  const targetAttachment = input.interval[targetRole];
  const sourceAnchor = input.candidateAnchorsById?.get(sourceAttachment.anchorObjectId) ??
    input.registry.get(sourceAttachment.anchorObjectId);
  const targetAnchor = input.candidateAnchorsById?.get(targetAttachment.anchorObjectId) ??
    input.registry.get(targetAttachment.anchorObjectId);
  if (!canObjectAttachGeodesics(sourceAnchor) || !canObjectAttachGeodesics(targetAnchor)) {
    return undefined;
  }
  if (!portalWordMatchesEndpointCellsWithAnchors({
    registry: input.registry,
    interval: input.interval,
    word: input.interval.portalWord,
    candidateAnchorsById: input.candidateAnchorsById,
  })) {
    return undefined;
  }

  const portalWordFromSourceToTarget = input.sourceRole === "start"
    ? input.interval.portalWord
    : reverseGeodesicPortalWord(input.interval.portalWord);
  const sourcePoint = getAnchorBeamPoint(sourceAnchor);
  let targetPointInSourceCell = getAnchorBeamPoint(targetAnchor);
  for (const traversal of portalWordFromSourceToTarget.slice().reverse()) {
    const portal = input.world.cellsById.get(traversal.sourceCellId)?.portalsById.get(traversal.sourcePortalId);
    if (!portal) {
      return undefined;
    }
    targetPointInSourceCell = transformPoint3(inversePortalTransform(portal), targetPointInSourceCell);
  }

  return {
    sourceRole: input.sourceRole,
    targetRole,
    sourceAnchorObjectId: sourceAttachment.anchorObjectId,
    targetAnchorObjectId: targetAttachment.anchorObjectId,
    sourceCellId: sourceAnchor.cellId,
    sourcePoint,
    targetPointInSourceCell,
    portalWordFromSourceToTarget,
  };
}

/**
 * True when the interval's lifted start-to-end chord is at least `GEODESIC_MIN_LENGTH_METERS` long (horizontally).
 *
 * False also when the lift fails (missing anchors/portals). Used to reject degenerate (point-like) geodesics, e.g. a
 * closed loop that has shrunk to nothing.
 */
export function geodesicHasNonzeroLiftedDisplacement(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
}): boolean {
  const lifted = liftGeodesicEndpoint({ ...input, sourceRole: "start" });
  if (!lifted) {
    return false;
  }
  return Math.hypot(
    lifted.targetPointInSourceCell.x - lifted.sourcePoint.x,
    lifted.targetPointInSourceCell.y - lifted.sourcePoint.y,
  ) >= GEODESIC_MIN_LENGTH_METERS - intersectionTolerance;
}

// ---- Derived-segment and connection queries ----

/** Returns the derived segments of a geodesic sorted by `segmentIndex` (empty if none). */
export function getGeodesicSegments(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly GeodesicSegmentObject[] {
  return registry.getAll()
    .filter((object): object is GeodesicSegmentObject => object.kind === "geodesic-segment")
    .filter((segment) => segment.geodesicId === geodesicId)
    .sort((a, b) => a.segmentIndex - b.segmentIndex);
}

/** Returns the last (highest `segmentIndex`) segment of a geodesic, or `undefined` if it has none. */
export function getGeodesicTail(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): GeodesicSegmentObject | undefined {
  return getGeodesicSegments(registry, geodesicId).at(-1);
}

/**
 * Describes the emitter connection of a geodesic.
 *
 * For an interval it is derived from the attachments: start on an emitter gives `outgoing = start`, and `connected`
 * when the end is also an emitter (else `open`); an interval with only its end on an emitter reports that emitter as
 * outgoing and `open`. Legacy: otherwise falls back to the cannon-stored `geodesicConnectionsById` records and finally to
 * the source emitter, reporting `open`. Returns `undefined` when nothing owns the geodesic.
 */
export function getGeodesicConnection(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): GeodesicEmitterConnection | undefined {
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesic-interval") {
    const start = registry.get(interval.start.anchorObjectId);
    const end = registry.get(interval.end.anchorObjectId);
    if (start?.kind === "geodesic-cannon") {
      return {
        outgoingEmitterId: start.id,
        incomingEmitterId: end?.kind === "geodesic-cannon" ? end.id : undefined,
        state: end?.kind === "geodesic-cannon" ? "connected" : "open",
      };
    }
    if (end?.kind === "geodesic-cannon") {
      return {
        outgoingEmitterId: end.id,
        state: "open",
      };
    }
  }

  for (const object of registry.getAll()) {
    if (object.kind !== "geodesic-cannon") {
      continue;
    }

    const connection = object.geodesicConnectionsById?.[geodesicId];
    if (connection) {
      return connection;
    }
  }

  const source = findSourceEmitterForGeodesic(registry, geodesicId);
  return source ? { outgoingEmitterId: source.id, state: "open" } : undefined;
}

/**
 * True when both endpoints of the geodesic are emitters (a "locked" geodesic that cannot be extended or aimed freely).
 *
 * Legacy: for non-interval geodesics, falls back to `connected`/`straightening` connection state or an `emitter-hit` tail.
 */
export function isGeodesicLocked(registry: RuntimeObjectRegistry, geodesicId: string): boolean {
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesic-interval") {
    return registry.get(interval.start.anchorObjectId)?.kind === "geodesic-cannon" &&
      registry.get(interval.end.anchorObjectId)?.kind === "geodesic-cannon";
  }

  const state = getGeodesicConnection(registry, geodesicId)?.state;
  if (state === "connected" || state === "straightening") {
    return true;
  }

  return getGeodesicTail(registry, geodesicId)?.terminal.kind === "emitter-hit";
}

/** Legacy: true when the geodesic (or any segment) is in the retired `"straightening"` connection state. */
export function isGeodesicStraightening(registry: RuntimeObjectRegistry, geodesicId: string): boolean {
  if (getGeodesicConnection(registry, geodesicId)?.state === "straightening") {
    return true;
  }

  return getGeodesicSegments(registry, geodesicId).some((segment) => segment.connectionState === "straightening");
}

/** Lists the ids of locked geodesics (see `isGeodesicLocked`) that have an endpoint on the emitter. */
export function collectLockedIncidentGeodesicIdsForEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
): readonly string[] {
  return collectIncidentGeodesicIdsForEmitter(registry, emitterId)
    .filter((geodesicId) => isGeodesicLocked(registry, geodesicId));
}

/** Returns the 1-based display number of a geodesic, defaulting to 1 when it has none. */
export function resolveGeodesicNumber(registry: RuntimeObjectRegistry, geodesicId: string): number {
  return getGlobalGeodesicNumbers(registry, geodesicId).get(geodesicId) ?? 1;
}

// ---- Removal ----

/** Removes a geodesic and its derived objects (interval path via `removeGeodesicIntervalAndDerivedObjects`; legacy path removes segments and emitter associations), then refreshes intersections. */
export function removeGeodesic(registry: RuntimeObjectRegistry, geodesicId: string): void {
  if (registry.get(geodesicId)?.kind === "geodesic-interval") {
    removeGeodesicIntervalAndDerivedObjects(registry, geodesicId);
    return;
  }
  removeGeodesicSegments(registry, geodesicId);
  removeGeodesicAssociations(registry, geodesicId);
  updateGeodesicIntersectionObjects(registry);
}

/** Removes every non-locked geodesic listed on the cannon and returns the removed ids (empty if the id is not a cannon). */
export function removeUnlockedGeodesicsFromCannon(
  registry: RuntimeObjectRegistry,
  cannonId: string,
): readonly string[] {
  const cannon = registry.get(cannonId);
  if (cannon?.kind !== "geodesic-cannon") {
    return [];
  }

  const removed: string[] = [];
  for (const geodesicId of cannon.geodesicIds) {
    if (isGeodesicLocked(registry, geodesicId)) {
      continue;
    }

    removeGeodesic(registry, geodesicId);
    removed.push(geodesicId);
  }

  return removed;
}

/** Legacy: true when any geodesic incident on the emitter is in the retired straightening state. */
export function hasStraighteningIncidentGeodesic(registry: RuntimeObjectRegistry, emitterId: string): boolean {
  return collectIncidentGeodesicIdsForEmitter(registry, emitterId)
    .some((geodesicId) => isGeodesicStraightening(registry, geodesicId));
}

/**
 * Deletes a cannon and every geodesic that starts, ends, or connects (as incoming emitter) on it.
 *
 * Geodesics owned by other emitters but arriving here are removed as well. Safe for non-cannon ids (only the final
 * remove and intersection refresh run).
 */
export function removeGeodesicCannonAndSegments(registry: RuntimeObjectRegistry, cannonId: string): void {
  const cannon = registry.get(cannonId);
  if (cannon?.kind === "geodesic-cannon") {
    const geodesicIds = new Set(getGeodesicEndpointAttachmentsForAnchor(registry, cannonId).map((attachment) => attachment.geodesicId));
    for (const geodesicId of cannon.geodesicIds) {
      geodesicIds.add(geodesicId);
    }
    if (cannon.activeGeodesicId) {
      geodesicIds.add(cannon.activeGeodesicId);
    }
    for (const geodesicId of geodesicIds) {
      removeGeodesic(registry, geodesicId);
    }
  }
  for (const object of registry.getAll()) {
    if (
      object.kind === "geodesic-cannon" &&
      object.id !== cannonId &&
      object.geodesicIds.some((geodesicId) =>
        getGeodesicConnection(registry, geodesicId)?.incomingEmitterId === cannonId
      )
    ) {
      for (const geodesicId of object.geodesicIds) {
        if (getGeodesicConnection(registry, geodesicId)?.incomingEmitterId === cannonId) {
          removeGeodesic(registry, geodesicId);
        }
      }
    }
  }
  registry.remove(cannonId);
  updateGeodesicIntersectionObjects(registry);
}

/**
 * Realizes an interval's geometry by tracing the lifted chord, and replaces the interval's derived segments with it.
 *
 * Traces from `sourcePoint` in cell `sourceCellId` along `yawRadians` for exactly `lengthMeters`. Returns `undefined`
 * (leaving existing segments untouched) when the interval is missing, `lengthMeters < minGeodesicSegmentLengthMeters`,
 * the realized portal word differs from `expectedPortalWord` (unless `allowUnexpectedPortalWord`), or any piece hits a
 * forbidden zone or a wall (consistent with `previewRebuildGeodesicInterval`).
 * Side effect: on success the segments are rewritten (an `open` last piece becomes `emitter-hit` if the end anchor is an
 * emitter).
 */
export function traceGeodesicFromLiftedChord(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly sourceCellId: string;
  readonly sourcePoint: Vec3;
  readonly yawRadians: number;
  readonly lengthMeters: number;
  readonly expectedPortalWord?: readonly GeodesicPortalTraversal[];
  readonly allowUnexpectedPortalWord?: boolean;
}): GeodesicTraceBuildResult | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval" || input.lengthMeters < minGeodesicSegmentLengthMeters) {
    return undefined;
  }
  // Emitter connection is disabled for this trace (chord already encodes the endpoint), so the id is only used for bookkeeping.
  const sourceAnchorId = interval.start.anchorObjectId;
  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: false,
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    sourceEmitterId: sourceAnchorId,
    cellId: input.sourceCellId,
    start: input.sourcePoint,
    direction: directionFromYaw(input.yawRadians),
    maxLengthMeters: input.lengthMeters,
  });
  const portalWord = collectPortalWordFromTraces(input.world, traces);
  // Homotopy check: the straight chord must cross exactly the portals of the stored word, else it realizes a different class and is refused.
  if (input.expectedPortalWord && !input.allowUnexpectedPortalWord && !samePortalWord(portalWord, input.expectedPortalWord)) {
    return undefined;
  }
  if (traces.some((trace) => trace.terminal.kind === "forbidden-zone-hit" || trace.terminal.kind === "wall-hit")) {
    return undefined;
  }

  // Commit: the segments are replaced only after all checks passed.
  const realizedTraces = withAnchoredTargetTerminal(input.registry, interval, traces);
  const segments = replaceDerivedSegmentsFromTraces({
    registry: input.registry,
    geodesicId: input.geodesicId,
    traces: realizedTraces,
  });
  return {
    interval,
    segments,
    terminal: traceTerminalToBuildTerminalForInterval(interval, realizedTraces.at(-1), input.registry),
  };
}

/**
 * Re-aims a free geodesic (emitter at one role, a singly attached free end at the other) toward a target point.
 *
 * The free end is moved to wherever the new ray ends (cell, position), the interval's start cell and portal word are
 * recomputed from the actual trace, and segments are replaced. If `connectEmitters` (default true) and the ray ends at
 * another emitter, the free role is re-attached to that emitter and the interval is rebuilt as a locked geodesic.
 * Returns `undefined` for non-interval ids, non-(emitter, free end) attachments, a free end shared with other
 * attachments, or a target within `intersectionTolerance` of the emitter (length is otherwise at least `minGeodesicSegmentLengthMeters`).
 * Mutates the registry.
 */
export function aimFreeGeodesicFromEndpoint(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly emitterEndRole: GeodesicEndRole;
  readonly targetPointInEmitterCell: Vec3;
  readonly connectEmitters?: boolean;
}): GeodesicTraceBuildResult | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return undefined;
  }
  const emitterAttachment = interval[input.emitterEndRole];
  const freeRole = getOppositeEndRole(input.emitterEndRole);
  const freeAttachment = interval[freeRole];
  const emitter = input.registry.get(emitterAttachment.anchorObjectId);
  const freeEnd = input.registry.get(freeAttachment.anchorObjectId);
  if (emitter?.kind !== "geodesic-cannon" || freeEnd?.kind !== "free-geodesic-end") {
    return undefined;
  }
  // A free end shared with another attachment (e.g. a curve-shortening vertex) must not be dragged around.
  if (getGeodesicEndpointAttachmentsForAnchor(input.registry, freeEnd.id).length !== 1) {
    return undefined;
  }

  const emitterPoint = getGeodesicCannonEmitterPoint(emitter);
  const dx = input.targetPointInEmitterCell.x - emitterPoint.x;
  const dy = input.targetPointInEmitterCell.y - emitterPoint.y;
  if (Math.hypot(dx, dy) <= intersectionTolerance) {
    return undefined;
  }
  // Direction and length of the chord in the emitter's cell; the length is floored so tiny aims still produce a visible geodesic.
  const lengthMeters = Math.max(Math.hypot(dx, dy), minGeodesicSegmentLengthMeters);
  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: input.connectEmitters ?? true,
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    sourceEmitterId: emitter.id,
    cellId: emitter.cellId,
    start: emitterPoint,
    direction: directionFromYaw(Math.atan2(dy, dx)),
    maxLengthMeters: lengthMeters,
  });
  const tail = traces.at(-1);
  if (!tail) {
    return undefined;
  }

  const portalWord = collectPortalWordFromTraces(input.world, traces);
  const terminalPoint = addVec3(tail.start, scaleVec3(tail.direction, tail.lengthMeters));
  const terminalCellId = tail.cellId;
  // The free end moves to wherever the trace actually ended, possibly in another cell after portal crossings; the portal word
  // below is read off the realized traces, so the interval's homotopy class always matches the picture.
  // Caveat: the traces start at the EMITTER. The stored word/`startCellId` follow that order, which equals the interval's
  // start-to-end convention only when the emitter holds the `start` role.
  const nextFreeEnd = {
    ...freeEnd,
    cellId: terminalCellId,
    localPose: yawRigidTransform3(0, terminalPoint),
  };
  input.registry.update(nextFreeEnd);

  let nextInterval: GeodesicIntervalObject = {
    ...interval,
    startCellId: emitter.cellId,
    cellId: emitter.cellId,
    portalWord,
  };
  input.registry.update(nextInterval);
  if ((input.connectEmitters ?? true) && tail.terminal.kind === "emitter-hit") {
    nextInterval = replaceGeodesicEndpointAttachment(
      input.registry,
      input.geodesicId,
      freeRole,
      tail.terminal.emitterId,
    ) ?? nextInterval;
    const rebuilt = rebuildDerivedGeodesicSegments({
      world: input.world,
      registry: input.registry,
      geodesicId: input.geodesicId,
    });
    if (rebuilt) {
      syncLegacyEmitterGeodesicFields(input.registry, input.geodesicId);
      updateGeodesicIntersectionObjects(input.registry);
      return {
        interval: rebuilt.interval,
        segments: rebuilt.segments,
        terminal: { kind: "emitter-hit", emitterId: tail.terminal.emitterId },
      };
    }
  }

  const segments = replaceDerivedSegmentsFromTraces({
    registry: input.registry,
    geodesicId: input.geodesicId,
    traces,
  });
  syncLegacyEmitterGeodesicFields(input.registry, input.geodesicId);
  updateGeodesicIntersectionObjects(input.registry);
  return {
    interval: nextInterval,
    segments,
    terminal: (input.connectEmitters ?? true) && tail.terminal.kind === "emitter-hit"
      ? { kind: "emitter-hit", emitterId: tail.terminal.emitterId }
      : { kind: "free-end", freeEndObjectId: freeEnd.id },
  };
}

/**
 * Regenerates an interval's segments from its endpoint anchors and portal word (the fundamental "development" step).
 *
 * Lifts the end anchor into the start anchor's cell with `liftGeodesicEndpoint`, takes the straight chord, and traces
 * it with `traceGeodesicFromLiftedChord` expecting the stored portal word. Returns `undefined` when the lift fails or
 * the trace is rejected (missing interval, wrong word, forbidden zone).
 * Destructive failure: if the lifted chord is shorter than `GEODESIC_MIN_LENGTH_METERS` the whole interval and its
 * derived objects are DELETED before returning `undefined`. `allowUnexpectedPortalWord` accepts a different realized word.
 */
export function rebuildDerivedGeodesicSegments(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly allowUnexpectedPortalWord?: boolean;
}): GeodesicTraceBuildResult | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return undefined;
  }
  const lifted = liftGeodesicEndpoint({
    world: input.world,
    registry: input.registry,
    interval,
    sourceRole: "start",
  });
  if (!lifted) {
    return undefined;
  }
  // Chord of the development: direction yaw = atan2(dy, dx) and length = |(dx, dy)| (horizontal; heights are equal by construction).
  // A chord shorter than the minimum means the endpoints (essentially) coincide in the development: the geodesic is degenerate, so the
  // interval and everything derived from it is DELETED (destructive failure path).
  const dx = lifted.targetPointInSourceCell.x - lifted.sourcePoint.x;
  const dy = lifted.targetPointInSourceCell.y - lifted.sourcePoint.y;
  const lengthMeters = Math.hypot(dx, dy);
  if (lengthMeters < GEODESIC_MIN_LENGTH_METERS - intersectionTolerance) {
    removeGeodesicIntervalAndDerivedObjects(input.registry, input.geodesicId);
    return undefined;
  }
  // Trace the chord through the world. Success requires crossing exactly the stored portal word (unless explicitly allowed otherwise).
  return traceGeodesicFromLiftedChord({
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    sourceCellId: lifted.sourceCellId,
    sourcePoint: lifted.sourcePoint,
    yawRadians: Math.atan2(dy, dx),
    lengthMeters,
    expectedPortalWord: lifted.portalWordFromSourceToTarget,
    allowUnexpectedPortalWord: input.allowUnexpectedPortalWord,
  });
}

// Read-only dry run of the rebuild trace: true if the chord realizing the interval would enter a forbidden zone.
// Returns false (not "unknown") when the lift fails or the chord is degenerate; callers must treat that as "no zone hit".
function lockedIntervalRebuildHitsForbiddenZone(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
}): boolean {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return false;
  }
  const lifted = liftGeodesicEndpoint({
    world: input.world,
    registry: input.registry,
    interval,
    sourceRole: "start",
  });
  if (!lifted) {
    return false;
  }

  const dx = lifted.targetPointInSourceCell.x - lifted.sourcePoint.x;
  const dy = lifted.targetPointInSourceCell.y - lifted.sourcePoint.y;
  const lengthMeters = Math.hypot(dx, dy);
  if (lengthMeters < GEODESIC_MIN_LENGTH_METERS - intersectionTolerance) {
    return false;
  }

  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: false,
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    sourceEmitterId: interval.start.anchorObjectId,
    cellId: lifted.sourceCellId,
    start: lifted.sourcePoint,
    direction: directionFromYaw(Math.atan2(dy, dx)),
    maxLengthMeters: lengthMeters,
  });
  return traces.some((trace) => trace.terminal.kind === "forbidden-zone-hit");
}

/**
 * Labels segments with `halfRole`, cutting the one that straddles the midpoint of the total length into two.
 *
 * Output ids are renumbered `<geodesicId>:segment:<i>` with consecutive indices. A cut segment's first piece gets
 * terminal `open`; its second piece keeps the original terminal. Pieces ending at or before the midpoint are the `start`
 * half, the rest the `end` half. Pure.
 */
export function splitDerivedSegmentsIntoEndpointHalves(
  segments: readonly GeodesicSegmentObject[],
): readonly GeodesicSegmentObject[] {
  const totalLengthMeters = totalGeodesicLengthFromSegments(segments);
  // Halves are defined by arc length: everything before the midpoint is attached to the `start` role, everything after to `end`.
  const midpointMeters = totalLengthMeters / 2;
  let beforeMeters = 0;
  const split: GeodesicSegmentObject[] = [];
  let index = 0;
  for (const segment of segments) {
    const segmentStartMeters = beforeMeters;
    const segmentEndMeters = beforeMeters + segment.lengthMeters;
    if (
      midpointMeters > segmentStartMeters + intersectionTolerance &&
      midpointMeters < segmentEndMeters - intersectionTolerance
    ) {
      const firstLength = midpointMeters - segmentStartMeters;
      const secondLength = segment.lengthMeters - firstLength;
      const midpoint = addVec3(segment.start, scaleVec3(segment.direction, firstLength));
      split.push({
        ...segment,
        id: `${segment.geodesicId}:segment:${index++}`,
        segmentIndex: index - 1,
        lengthMeters: firstLength,
        terminal: { kind: "open" },
        halfRole: "start",
      });
      split.push({
        ...segment,
        id: `${segment.geodesicId}:segment:${index++}`,
        segmentIndex: index - 1,
        start: midpoint,
        localPose: yawRigidTransform3(Math.atan2(segment.direction.y, segment.direction.x), midpoint),
        lengthMeters: secondLength,
        halfRole: "end",
      });
    } else {
      const halfRole: GeodesicHalfRole = segmentEndMeters <= midpointMeters + intersectionTolerance ? "start" : "end";
      split.push({
        ...segment,
        id: `${segment.geodesicId}:segment:${index++}`,
        segmentIndex: index - 1,
        halfRole,
      });
    }
    beforeMeters = segmentEndMeters;
  }
  return split;
}

/** Maps a clicked segment (by id) to the endpoint attachment of its half, or `undefined` if it is not a half-labelled segment of an existing interval. */
export function resolveGeodesicEndpointSelectionFromSegmentHit(
  registry: RuntimeObjectRegistry,
  segmentId: string,
): GeodesicEndpointSelection | undefined {
  const segment = registry.get(segmentId);
  if (segment?.kind !== "geodesic-segment" || !segment.halfRole) {
    return undefined;
  }
  const interval = registry.get(segment.geodesicId);
  return interval?.kind === "geodesic-interval" ? interval[segment.halfRole] : undefined;
}

/**
 * Yaw (radians) of the geodesic's tangent at the anchor of the given role, pointing away from the anchor along the geodesic.
 *
 * For `start` it is the first segment's direction; for `end` it is the last segment's direction rotated by pi (so it
 * points back into the geodesic). The yaw is expressed in the frame of that segment's cell, which is the anchor's
 * cell. Returns `undefined` if the interval or its segments are missing.
 */
export function resolveEndpointTangentAtAnchor(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly endRole: GeodesicEndRole;
}): { readonly anchorObjectId: string; readonly yawRadians: number } | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return undefined;
  }
  const attachment = interval[input.endRole];
  const segment = input.endRole === "start"
    ? getGeodesicSegments(input.registry, input.geodesicId)[0]
    : getGeodesicSegments(input.registry, input.geodesicId).at(-1);
  if (!segment) {
    return undefined;
  }
  // Outward tangent at the anchor: the first segment's direction at `start`; at `end` the last segment points INTO the anchor, so reverse it.
  // Relies on segments being ordered from `start` to `end`.
  const yawRadians = Math.atan2(segment.direction.y, segment.direction.x) + (input.endRole === "start" ? 0 : Math.PI);
  return {
    anchorObjectId: attachment.anchorObjectId,
    yawRadians: sanitizeYaw(yawRadians),
  };
}

/**
 * Splits a free geodesic at a point on one of its segments, ending the first part at a newly placed emitter.
 *
 * Preconditions: the interval is an aimable free geodesic (emitter at one role, free end at the other; see
 * `isAimableFreeGeodesic`), the segment belongs to it, `placedEmitterId` is a cannon in the registry, and the clamped
 * cut distance leaves a long enough prefix (`canConnectGeodesicSegmentAtDistance`). Otherwise returns `[]` and changes
 * nothing. The original interval is shortened so its free role now attaches to the placed emitter (its portal word becomes
 * the word of the prefix traces); the remainder (if at least `minGeodesicSegmentLengthMeters`) becomes a new interval from
 * the placed emitter to the old free end, rebuilt along the same direction. Returns the surviving intervals
 * (prefix first, continuation second if created). Mutates the registry.
 */
export function splitGeodesicIntervalAtSegmentHit(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly segmentId: string;
  readonly distanceAlongSegmentMeters: number;
  readonly placedEmitterId: string;
  readonly createContinuationGeodesicId: (sourceGeodesicId: string, sideIndex: number) => string;
}): readonly GeodesicIntervalObject[] {
  const interval = input.registry.get(input.geodesicId);
  const segment = input.registry.get(input.segmentId);
  const placed = input.registry.get(input.placedEmitterId);
  if (
    interval?.kind !== "geodesic-interval" ||
    segment?.kind !== "geodesic-segment" ||
    segment.geodesicId !== input.geodesicId ||
    placed?.kind !== "geodesic-cannon" ||
    !isAimableFreeGeodesic(input.registry, interval)
  ) {
    return [];
  }
  // Cut point: arc length `prefixLengthMeters` from the geodesic's emitter-side start (all earlier segments plus the distance in this one).
  // The prefix must be at least the minimum length, otherwise the new emitter would sit on the old one.
  const clampedDistance = Math.min(segment.lengthMeters, Math.max(0, input.distanceAlongSegmentMeters));
  if (!canConnectGeodesicSegmentAtDistance(clampedDistance)) {
    return [];
  }

  const segments = getGeodesicSegments(input.registry, input.geodesicId);
  const totalLengthMeters = totalGeodesicLengthFromSegments(segments);
  const prefixLengthMeters = totalLengthThroughSegment(segments, segment, clampedDistance);
  const continuationLengthMeters = totalLengthMeters - prefixLengthMeters;
  // `freeRole` holds the free end, the other role is the original source emitter.
  const freeRole: GeodesicEndRole = input.registry.get(interval.start.anchorObjectId)?.kind === "free-geodesic-end"
    ? "start"
    : "end";
  const sourceRole = getOppositeEndRole(freeRole);
  const sourceAnchor = input.registry.get(interval[sourceRole].anchorObjectId);
  const freeEnd = input.registry.get(interval[freeRole].anchorObjectId);
  if (sourceAnchor?.kind !== "geodesic-cannon" || freeEnd?.kind !== "free-geodesic-end") {
    return [];
  }

  // Prefix path = the whole segments before the hit plus the hit segment truncated at the cut point, ending at the new emitter.
  // Its portal word is the word of the shortened geodesic (portal-hit terminals of the whole segments).
  const prefixTraces = segments
    .filter((entry) => entry.segmentIndex < segment.segmentIndex)
    .map(segmentToTrace);
  prefixTraces.push({
    cellId: segment.cellId,
    start: segment.start,
    direction: segment.direction,
    lengthMeters: clampedDistance,
    terminal: { kind: "emitter-hit", emitterId: placed.id },
  });
  const prefixPortalWord = collectPortalWordFromTraces(input.world, prefixTraces);
  const continuationId = continuationLengthMeters >= minGeodesicSegmentLengthMeters - intersectionTolerance
    ? input.createContinuationGeodesicId(input.geodesicId, 0)
    : undefined;
  // The continuation takes over the old free end: placed emitter -> old free end. Its word/geometry is filled in by rebuildContinuationFromCut.
  if (continuationId) {
    input.registry.add(createGeodesicIntervalObject({
      id: continuationId,
      startAnchorObjectId: placed.id,
      endAnchorObjectId: freeEnd.id,
      startCellId: placed.cellId,
      motionState: "stable",
    }));
  }
  // Shorten the original interval: its free role now attaches to the placed emitter, and its portal word becomes the prefix word.
  // Caveat: the prefix word is ordered from the source emitter, which matches the start-to-end convention only if the source holds `start`.
  input.registry.update({
    ...interval,
    [freeRole]: {
      geodesicId: interval.id,
      role: freeRole,
      anchorObjectId: placed.id,
    },
    startCellId: sourceAnchor.cellId,
    cellId: sourceAnchor.cellId,
    portalWord: prefixPortalWord,
  });
  replaceDerivedSegmentsFromTraces({
    registry: input.registry,
    geodesicId: input.geodesicId,
    traces: prefixTraces,
  });

  if (continuationId) {
    rebuildContinuationFromCut({
      world: input.world,
      registry: input.registry,
      geodesicId: continuationId,
      placed,
      freeEnd,
      yawRadians: Math.atan2(segment.direction.y, segment.direction.x),
      lengthMeters: continuationLengthMeters,
    });
  }
  removeUnusedFreeGeodesicEnds(input.registry);
  syncLegacyEmitterGeodesicFields(input.registry, input.geodesicId);
  if (continuationId) {
    syncLegacyEmitterGeodesicFields(input.registry, continuationId);
  }
  updateGeodesicIntersectionObjects(input.registry);
  return [input.registry.get(input.geodesicId), continuationId ? input.registry.get(continuationId) : undefined]
    .filter((object): object is GeodesicIntervalObject => object?.kind === "geodesic-interval");
}

/**
 * Rebuilds a locked (emitter-to-emitter) interval after an endpoint was carried, updating its portal word first.
 *
 * The new portal word is, in order of precedence: the explicit `carriedPortalWord`; otherwise the old word extended
 * by the portal the carried anchor crossed (inferred by `resolveCarriedPortalTraversalFromAnchorMotion` or taken from
 * `carriedPortalTransition`) at the end (append) or start (prepend the inverse), with adjacent inverse traversals
 * cancelled; otherwise the old word. The interval's `startCellId` follows the start anchor's current cell. Then
 * `rebuildDerivedGeodesicSegments` runs (with `allowUnexpectedPortalWord = allowOutOfBoundsCarriedEndpoint`).
 * Returns `undefined` on failure; note the interval may already have been updated (and a degenerate one deleted).
 */
export function rebuildLockedGeodesicFromEndpointsAndPortalWord(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly carriedAnchorObjectId?: string;
  readonly carriedAnchorBeforeMove?: GeodesicCannonObject;
  readonly carriedPortalTransition?: GeodesicCarryPortalTransition;
  readonly carriedPortalWord?: readonly GeodesicPortalTraversal[];
  readonly allowOutOfBoundsCarriedEndpoint?: boolean;
}): GeodesicTraceBuildResult | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return undefined;
  }

  // Step 1: decide the portal word after the move (explicit word, inferred or reported portal traversal, else unchanged).
  const carriedPortalWord = resolveCarriedIntervalPortalWord({
    world: input.world,
    interval,
    registry: input.registry,
    carriedAnchorObjectId: input.carriedAnchorObjectId,
    carriedAnchorBeforeMove: input.carriedAnchorBeforeMove,
    carriedPortalTransition: input.carriedPortalTransition,
    carriedPortalWord: input.carriedPortalWord,
  });
  const startAnchor = input.registry.get(interval.start.anchorObjectId);
  const nextStartCellId = canObjectAttachGeodesics(startAnchor) ? startAnchor.cellId : interval.startCellId;
  if (
    (carriedPortalWord && !samePortalWord(interval.portalWord, carriedPortalWord)) ||
    nextStartCellId !== interval.startCellId ||
    nextStartCellId !== interval.cellId
  ) {
    input.registry.update({
      ...interval,
      cellId: nextStartCellId,
      startCellId: nextStartCellId,
      portalWord: carriedPortalWord ?? interval.portalWord,
    });
  }

  // Step 2: re-develop the interval with the (possibly updated) word and the anchors' current positions.
  const result = rebuildDerivedGeodesicSegments({
    ...input,
    allowUnexpectedPortalWord: input.allowOutOfBoundsCarriedEndpoint,
  });
  if (result) {
    syncLegacyEmitterGeodesicFields(input.registry, input.geodesicId);
    updateGeodesicIntersectionObjects(input.registry);
  }
  return result;
}

/**
 * Extends an interval's stored portal word with one portal crossing made by a carried anchor, and saves it.
 *
 * Appends the traversal when the carried anchor is the `end` anchor, and prepends the inverse when it is the `start`
 * anchor. A loop with both ends on the anchor gets both, which conjugates the word (`p^-1 w p`). The result is freely
 * reduced. Returns the new word, or `undefined` (nothing written) if the anchor is not an endpoint or the resulting word
 * does not chain between the endpoint anchors' current cells.
 */
export function updateLockedGeodesicPortalWordForCarriedAnchorTraversal(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly carriedAnchorObjectId: string;
  readonly traversal: GeodesicPortalTraversal;
}): readonly GeodesicPortalTraversal[] | undefined {
  return updateLockedGeodesicPortalWordForCarriedAnchorTraversals({
    registry: input.registry,
    geodesicId: input.geodesicId,
    carriedAnchorObjectId: input.carriedAnchorObjectId,
    traversals: [input.traversal],
  });
}

/**
 * Same as {@link updateLockedGeodesicPortalWordForCarriedAnchorTraversal} for a chain of traversals the carried
 * anchor made in one frame, in order. The word is folded through all of them and checked against the endpoint cells once
 * (the anchor already sits in the last target cell), then stored. Returns `undefined` and stores nothing on failure.
 */
export function updateLockedGeodesicPortalWordForCarriedAnchorTraversals(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly carriedAnchorObjectId: string;
  readonly traversals: readonly GeodesicPortalTraversal[];
}): readonly GeodesicPortalTraversal[] | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return undefined;
  }

  // See `portalWordAfterAnchorCrossing`: append at the end role, prepend the inverse at the start role, both for a loop.
  const portalWord = applyAnchorCrossingTraversals({
    interval,
    anchorObjectId: input.carriedAnchorObjectId,
    traversals: input.traversals,
  });
  if (!portalWord || !portalWordMatchesCurrentEndpointCells(input.registry, interval, portalWord)) {
    return undefined;
  }

  const startAnchor = input.registry.get(interval.start.anchorObjectId);
  const nextStartCellId = canObjectAttachGeodesics(startAnchor) ? startAnchor.cellId : interval.startCellId;
  input.registry.update({
    ...interval,
    cellId: nextStartCellId,
    startCellId: nextStartCellId,
    portalWord,
  });
  return portalWord;
}

/**
 * Returns the interval's portal word after one of its endpoints crossed a portal, or `undefined` if the result is inconsistent.
 *
 * `movedRole === "end"` appends `traversal`; `"start"` prepends its inverse. Adjacent inverse traversals are cancelled
 * (so walking back through the same portal restores the old word), then the word must chain from the start anchor's cell
 * to the end anchor's cell as currently stored in the registry. If the other role is on the same anchor (a loop), that role
 * moves too and the word is conjugated. Does not write anything.
 */
export function updatePortalWordForMovedEndpoint(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly movedRole: GeodesicEndRole;
  readonly traversal: GeodesicPortalTraversal;
}): readonly GeodesicPortalTraversal[] | undefined {
  const word = portalWordAfterAnchorCrossing({
    interval: input.interval,
    anchorObjectId: input.interval[input.movedRole].anchorObjectId,
    traversal: input.traversal,
  });
  return word && portalWordMatchesCurrentEndpointCells(input.registry, input.interval, word) ? word : undefined;
}

/**
 * Computes the segments an interval would have, without touching the registry (rollback-safe).
 *
 * Same chord construction as `rebuildDerivedGeodesicSegments`, but anchors can be shadowed by `candidateAnchorsById`
 * and the stored word must be realized exactly. Returns `undefined` if the lift fails, the chord is shorter than
 * `GEODESIC_MIN_LENGTH_METERS`, the realized word differs, or any piece hits a wall or forbidden zone. The returned
 * segments are detached (not in the registry) and the interval is returned unchanged.
 */
export function previewRebuildGeodesicInterval(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): GeodesicTraceBuildResult | undefined {
  const lifted = liftGeodesicEndpointWithAnchors({
    world: input.world,
    registry: input.registry,
    interval: input.interval,
    sourceRole: "start",
    candidateAnchorsById: input.candidateAnchorsById,
  });
  if (!lifted) {
    return undefined;
  }
  const dx = lifted.targetPointInSourceCell.x - lifted.sourcePoint.x;
  const dy = lifted.targetPointInSourceCell.y - lifted.sourcePoint.y;
  const lengthMeters = Math.hypot(dx, dy);
  if (lengthMeters < GEODESIC_MIN_LENGTH_METERS - intersectionTolerance) {
    return undefined;
  }
  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: false,
    world: input.world,
    registry: input.registry,
    geodesicId: input.interval.id,
    sourceEmitterId: input.interval.start.anchorObjectId,
    cellId: lifted.sourceCellId,
    start: lifted.sourcePoint,
    direction: directionFromYaw(Math.atan2(dy, dx)),
    maxLengthMeters: lengthMeters,
  });
  // The realized path must cross exactly the stored word; a wall hit or zone hit anywhere along the way also rejects the preview.
  const portalWord = collectPortalWordFromTraces(input.world, traces);
  if (!samePortalWord(portalWord, lifted.portalWordFromSourceToTarget)) {
    return undefined;
  }
  if (traces.some((trace) => trace.terminal.kind === "forbidden-zone-hit" || trace.terminal.kind === "wall-hit")) {
    return undefined;
  }
  const realizedTraces = withAnchoredTargetTerminalForAnchors(
    input.registry,
    input.interval,
    traces,
    input.candidateAnchorsById,
  );
  return {
    interval: input.interval,
    segments: buildDerivedSegmentsFromTraces({
      registry: input.registry,
      geodesicId: input.interval.id,
      traces: realizedTraces,
    }),
    terminal: traceTerminalToBuildTerminalForInterval(input.interval, realizedTraces.at(-1), input.registry),
  };
}

/** Lists one menu row (`G<n>` label) per distinct geodesic attached to the emitter, in attachment order. */
export function collectGeodesicMenuRowsForEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
): readonly { readonly geodesicId: string; readonly label: string }[] {
  const rows = getGeodesicEndpointAttachmentsForAnchor(registry, emitterId)
    .map((attachment) => attachment.geodesicId)
    .filter((geodesicId, index, ids) => ids.indexOf(geodesicId) === index);
  return rows.map((geodesicId) => ({
    geodesicId,
    label: `G${resolveGeodesicNumber(registry, geodesicId)}`,
  }));
}

// Determines the new portal word of an interval whose endpoint anchor was carried. Precedence: explicit word (reduced and
// validated) > traversal inferred from the anchor's motion > traversal reported by the mover > undefined (no change).
// The traversal is appended for the `end` anchor and prepended inverted for the `start` anchor (both for a loop, which
// conjugates the word; see `portalWordAfterAnchorCrossing`), then reduced and validated against the endpoint cells. Returns `undefined` whenever the candidate word is inconsistent.
function resolveCarriedIntervalPortalWord(input: {
  readonly world: CompiledCellComplex;
  readonly interval: GeodesicIntervalObject;
  readonly registry: RuntimeObjectRegistry;
  readonly carriedAnchorObjectId?: string;
  readonly carriedAnchorBeforeMove?: GeodesicCannonObject;
  readonly carriedPortalTransition?: GeodesicCarryPortalTransition;
  readonly carriedPortalWord?: readonly GeodesicPortalTraversal[];
}): readonly GeodesicPortalTraversal[] | undefined {
  if (input.carriedPortalWord) {
    const reduced = reduceAdjacentInversePortalTraversals(input.carriedPortalWord);
    return portalWordMatchesCurrentEndpointCells(input.registry, input.interval, reduced)
      ? reduced
      : undefined;
  }

  const carriedTraversal = resolveCarriedPortalTraversalFromAnchorMotion(
    input.world,
    input.registry,
    input.carriedAnchorObjectId,
    input.carriedAnchorBeforeMove,
  ) ?? (
    input.carriedAnchorObjectId &&
    input.carriedPortalTransition &&
    carriedTransitionMatchesAnchorMove(
      input.registry,
      input.carriedAnchorObjectId,
      input.carriedAnchorBeforeMove,
      input.carriedPortalTransition,
    )
      ? portalTraversalFromCarryTransition(input.carriedPortalTransition)
      : undefined
  );

  if (
    input.carriedAnchorObjectId &&
    carriedTraversal
  ) {
    const word = portalWordAfterAnchorCrossing({
      interval: input.interval,
      anchorObjectId: input.carriedAnchorObjectId,
      traversal: carriedTraversal,
    });
    return word && portalWordMatchesCurrentEndpointCells(input.registry, input.interval, word) ? word : undefined;
  }

  return undefined;
}

// Infers which portal a carried emitter crossed by comparing the previous and current beam points: among portals of the
// previous cell leading to the current cell, picks the one whose transform maps the old point closest to the new point.
// When the portal leads back into the same cell (self-gluing) the match is only accepted within `emitterConnectionToleranceMeters`,
// since otherwise a tiny non-crossing move would be misread as a crossing.
function resolveCarriedPortalTraversalFromAnchorMotion(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  carriedAnchorObjectId: string | undefined,
  carriedAnchorBeforeMove: GeodesicCannonObject | undefined,
): GeodesicPortalTraversal | undefined {
  if (!carriedAnchorObjectId || carriedAnchorBeforeMove?.id !== carriedAnchorObjectId) {
    return undefined;
  }
  const current = registry.get(carriedAnchorObjectId);
  if (current?.kind !== "geodesic-cannon") {
    return undefined;
  }

  const previousCell = world.cellsById.get(carriedAnchorBeforeMove.cellId);
  if (!previousCell) {
    return undefined;
  }

  const previousPoint = getGeodesicCannonEmitterPoint(carriedAnchorBeforeMove);
  const currentPoint = getGeodesicCannonEmitterPoint(current);
  const toleranceSquared = emitterConnectionToleranceMeters * emitterConnectionToleranceMeters;
  let best: { readonly distanceSquared: number; readonly traversal: GeodesicPortalTraversal } | undefined;

  for (const portal of previousCell.portals) {
    if (portal.targetCellId !== current.cellId) {
      continue;
    }
    const transformedPoint = transformPoint3(portal.transformToTarget, previousPoint);
    const candidateDistanceSquared = distanceSquaredVec3(transformedPoint, currentPoint);
    if (portal.targetCellId === carriedAnchorBeforeMove.cellId && candidateDistanceSquared > toleranceSquared) {
      continue;
    }
    if (!best || candidateDistanceSquared < best.distanceSquared) {
      best = {
        distanceSquared: candidateDistanceSquared,
        traversal: {
          sourceCellId: carriedAnchorBeforeMove.cellId,
          sourcePortalId: portal.id,
          targetCellId: portal.targetCellId,
          targetPortalId: portal.targetPortalId,
        },
      };
    }
  }

  return best?.traversal;
}

function carriedTransitionMatchesAnchorMove(
  registry: RuntimeObjectRegistry,
  carriedAnchorObjectId: string,
  carriedAnchorBeforeMove: GeodesicCannonObject | undefined,
  transition: GeodesicCarryPortalTransition,
): boolean {
  const current = registry.get(carriedAnchorObjectId);
  if (
    current?.kind !== "geodesic-cannon" ||
    carriedAnchorBeforeMove?.id !== carriedAnchorObjectId ||
    carriedAnchorBeforeMove.cellId !== transition.sourceCellId ||
    current.cellId !== transition.targetCellId
  ) {
    return false;
  }

  if (transition.sourceCellId !== transition.targetCellId) {
    return true;
  }

  const transformedPoint = transformPoint3(
    transition.transformToTarget,
    getGeodesicCannonEmitterPoint(carriedAnchorBeforeMove),
  );
  return distanceSquaredVec3(transformedPoint, getGeodesicCannonEmitterPoint(current)) <=
    emitterConnectionToleranceMeters * emitterConnectionToleranceMeters;
}

function portalWordMatchesCurrentEndpointCells(
  registry: RuntimeObjectRegistry,
  interval: GeodesicIntervalObject,
  word: readonly GeodesicPortalTraversal[],
): boolean {
  return portalWordMatchesEndpointCellsWithAnchors({ registry, interval, word });
}

// A word is consistent when it chains (each target cell equals the next source cell) and runs from the start anchor's cell
// to the end anchor's cell; the empty word requires both anchors to share one cell. `candidateAnchorsById` shadows registry anchors.
function portalWordMatchesEndpointCellsWithAnchors(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly word: readonly GeodesicPortalTraversal[];
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): boolean {
  const startAnchor = input.candidateAnchorsById?.get(input.interval.start.anchorObjectId) ??
    input.registry.get(input.interval.start.anchorObjectId);
  const endAnchor = input.candidateAnchorsById?.get(input.interval.end.anchorObjectId) ??
    input.registry.get(input.interval.end.anchorObjectId);
  if (!canObjectAttachGeodesics(startAnchor) || !canObjectAttachGeodesics(endAnchor)) {
    return false;
  }
  if (input.word.length === 0) {
    return startAnchor.cellId === endAnchor.cellId;
  }
  if (input.word[0].sourceCellId !== startAnchor.cellId || input.word.at(-1)?.targetCellId !== endAnchor.cellId) {
    return false;
  }
  return input.word.every((traversal, index) =>
    index === 0 || input.word[index - 1].targetCellId === traversal.sourceCellId
  );
}

// Names the free-end object of a trace that simply ran out. With a registry the end anchor is identified by its object kind
// (`isFreeGeodesicEndObject`); the "free-end" id-substring heuristic is only a fallback when no registry is available or the anchor
// is not registered. A non-free anchor yields an empty `freeEndObjectId`.
function traceTerminalToBuildTerminalForInterval(
  interval: GeodesicIntervalObject,
  tail: TraceGeodesicSegmentResult | undefined,
  registry?: RuntimeObjectRegistry,
): GeodesicTraceBuildResult["terminal"] {
  const terminal = traceTerminalToBuildTerminal(tail);
  if (terminal.kind !== "free-end") {
    return terminal;
  }
  const endAnchorId = interval.end.anchorObjectId;
  const endAnchor = registry?.get(endAnchorId);
  const endsAtFreeEnd = endAnchor
    ? isFreeGeodesicEndObject(endAnchor)
    : endAnchorId.startsWith(`${interval.id}:free-end`) || endAnchorId.includes("free-end");
  return endsAtFreeEnd ? { kind: "free-end", freeEndObjectId: endAnchorId } : terminal;
}

function withAnchoredTargetTerminal(
  registry: RuntimeObjectRegistry,
  interval: GeodesicIntervalObject,
  traces: readonly TraceGeodesicSegmentResult[],
): readonly TraceGeodesicSegmentResult[] {
  return withAnchoredTargetTerminalForAnchors(registry, interval, traces);
}

// When the end anchor is an emitter and the trace simply ran out (`open`), relabels the last piece as `emitter-hit`, since
// by construction the chord ends exactly at that emitter.
function withAnchoredTargetTerminalForAnchors(
  registry: RuntimeObjectRegistry,
  interval: GeodesicIntervalObject,
  traces: readonly TraceGeodesicSegmentResult[],
  candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>,
): readonly TraceGeodesicSegmentResult[] {
  const targetAnchor = candidateAnchorsById?.get(interval.end.anchorObjectId) ??
    registry.get(interval.end.anchorObjectId);
  const tail = traces.at(-1);
  if (targetAnchor?.kind !== "geodesic-cannon" || !tail || tail.terminal.kind !== "open") {
    return traces;
  }

  return traces.map((trace, index) =>
    index === traces.length - 1
      ? { ...trace, terminal: { kind: "emitter-hit", emitterId: targetAnchor.id } }
      : trace
  );
}

// ---- Building derived segments from traces ----

// Writes the registry's segment chain for a geodesic: deletes the old segments, builds new ones from `traces`, and adds them.
// Not rollback-safe by itself; use `buildDerivedSegmentsFromTraces` for a side-effect-free preview.
function replaceDerivedSegmentsFromTraces(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly traces: readonly TraceGeodesicSegmentResult[];
}): readonly GeodesicSegmentObject[] {
  removeGeodesicSegments(input.registry, input.geodesicId);
  const splitSegments = buildDerivedSegmentsFromTraces(input);
  for (const segment of splitSegments) {
    input.registry.add(segment);
  }
  return splitSegments;
}

// Pure counterpart of `replaceDerivedSegmentsFromTraces`: converts traces to segment objects (ids `<geodesicId>:segment:<i>`),
// splits them at the length midpoint into start/end halves, and stamps connection state and tooltip. Nothing is added to the registry.
function buildDerivedSegmentsFromTraces(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly traces: readonly TraceGeodesicSegmentResult[];
}): readonly GeodesicSegmentObject[] {
  const geodesicNumber = resolveGeodesicNumber(input.registry, input.geodesicId);
  const rawSegments = input.traces.map((trace, index) => createSegmentFromTrace({
    id: `${input.geodesicId}:segment:${index}`,
    geodesicId: input.geodesicId,
    geodesicNumber,
    segmentIndex: index,
    trace,
  }));
  const connectionState = resolveDerivedSegmentConnectionState(input.registry, input.geodesicId);
  const splitSegments = splitDerivedSegmentsIntoEndpointHalves(rawSegments)
    .map((segment) => ({
      ...segment,
      connectionState,
      tooltip: createGeodesicSegmentTooltip(segment.geodesicNumber, connectionState),
    }));
  return splitSegments;
}

// Display state of a geodesic's segments. A `"moving"` interval is reported as `"straightening"` (the renderer's moving
// color); a stable emitter-to-emitter interval is `"connected"`; everything else is `"open"`. So `"straightening"` is still
// produced for curve-shortening intervals, even though the old same-cell straightening model is retired.
function resolveDerivedSegmentConnectionState(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): "open" | "connected" | "straightening" {
  const interval = registry.get(geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return getGeodesicTail(registry, geodesicId)?.terminal.kind === "emitter-hit" ? "connected" : "open";
  }
  if (interval.motionState === "moving") {
    return "straightening";
  }
  const start = registry.get(interval.start.anchorObjectId);
  const end = registry.get(interval.end.anchorObjectId);
  return start?.kind === "geodesic-cannon" && end?.kind === "geodesic-cannon" ? "connected" : "open";
}

function segmentToTrace(segment: GeodesicSegmentObject): TraceGeodesicSegmentResult {
  return {
    cellId: segment.cellId,
    start: segment.start,
    direction: segment.direction,
    lengthMeters: segment.lengthMeters,
    terminal: segment.terminal,
  };
}

// Retraces the part of a split free geodesic beyond a newly placed emitter: from the placed emitter along the original yaw
// for the remaining length, moving the old free end to the new terminal point. Deletes the continuation interval if no trace
// came out; if the trace reaches an emitter, the free end is re-attached to that emitter (the interval becomes locked).
function rebuildContinuationFromCut(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly placed: GeodesicCannonObject;
  readonly freeEnd: FreeGeodesicEndObject;
  readonly yawRadians: number;
  readonly lengthMeters: number;
}): void {
  const start = getGeodesicCannonEmitterPoint(input.placed);
  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: true,
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    sourceEmitterId: input.placed.id,
    cellId: input.placed.cellId,
    start,
    direction: directionFromYaw(input.yawRadians),
    maxLengthMeters: input.lengthMeters,
  });
  const tail = traces.at(-1);
  if (!tail) {
    removeGeodesicIntervalAndDerivedObjects(input.registry, input.geodesicId);
    return;
  }
  const terminalPoint = addVec3(tail.start, scaleVec3(tail.direction, tail.lengthMeters));
  input.registry.update({
    ...input.freeEnd,
    cellId: tail.cellId,
    localPose: yawRigidTransform3(0, terminalPoint),
  });
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return;
  }
  input.registry.update({
    ...interval,
    startCellId: input.placed.cellId,
    cellId: input.placed.cellId,
    portalWord: collectPortalWordFromTraces(input.world, traces),
  });
  if (tail.terminal.kind === "emitter-hit") {
    replaceGeodesicEndpointAttachment(input.registry, input.geodesicId, "end", tail.terminal.emitterId);
  }
  replaceDerivedSegmentsFromTraces({
    registry: input.registry,
    geodesicId: input.geodesicId,
    traces,
  });
}

function getGeodesicTotalLengthMeters(registry: RuntimeObjectRegistry, geodesicId: string): number {
  return getGeodesicSegments(registry, geodesicId)
    .reduce((total, segment) => total + segment.lengthMeters, 0);
}

// "Aimable free": a stable interval with exactly one emitter endpoint and one free-end endpoint that no other attachment shares.
function isAimableFreeGeodesic(registry: RuntimeObjectRegistry, interval: GeodesicIntervalObject): boolean {
  if (interval.motionState !== "stable") {
    return false;
  }
  const start = registry.get(interval.start.anchorObjectId);
  const end = registry.get(interval.end.anchorObjectId);
  const hasOneEmitter = (start?.kind === "geodesic-cannon") !== (end?.kind === "geodesic-cannon");
  const freeEnd = start?.kind === "free-geodesic-end" ? start : end?.kind === "free-geodesic-end" ? end : undefined;
  return hasOneEmitter && freeEnd !== undefined &&
    getGeodesicEndpointAttachmentsForAnchor(registry, freeEnd.id).length === 1;
}

// Refreshes the emitter-side caches (`geodesicIds`, `activeGeodesicId`, per-geodesic yaw) from the interval: each emitter endpoint
// lists the geodesic and records the tangent yaw at its anchor. The registry attachments remain the source of truth.
function syncLegacyEmitterGeodesicFields(registry: RuntimeObjectRegistry, geodesicId: string): void {
  const interval = registry.get(geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return;
  }
  for (const role of ["start", "end"] as const) {
    const anchor = registry.get(interval[role].anchorObjectId);
    if (anchor?.kind !== "geodesic-cannon") {
      continue;
    }
    const tangent = resolveEndpointTangentAtAnchor({ registry, geodesicId, endRole: role });
    registry.update({
      ...anchor,
      activeGeodesicId: geodesicId,
      geodesicIds: anchor.geodesicIds.includes(geodesicId) ? anchor.geodesicIds : [...anchor.geodesicIds, geodesicId],
      geodesicEmitterYawRadiansById: tangent
        ? {
            ...anchor.geodesicEmitterYawRadiansById,
            [geodesicId]: tangent.yawRadians,
          }
        : anchor.geodesicEmitterYawRadiansById,
    });
  }
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

  removeGeodesicSegments(input.registry, input.geodesicId);
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

function removeUnusedFreeGeodesicEnds(registry: RuntimeObjectRegistry): void {
  for (const object of registry.getAll()) {
    if (object.kind === "free-geodesic-end" && getGeodesicEndpointAttachmentsForAnchor(registry, object.id).length === 0) {
      registry.remove(object.id);
    }
  }
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
 * the current segments are returned). Legacy: for non-interval geodesics it rebuilds the cannon's geodesic to the length,
 * forces the tail terminal to `emitter-hit` and marks the connection `"connected"`. Always returns the geodesic's segments
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

  const source = findSourceEmitterForGeodesic(request.registry, request.geodesicId);
  if (!source || incoming?.kind !== "geodesic-cannon") {
    return getGeodesicSegments(request.registry, request.geodesicId);
  }

  removeGeodesicSegments(request.registry, request.geodesicId);
  const rebuilt = rebuildUnlockedGeodesicToLength({
    world: request.world,
    registry: request.registry,
    cannon: source,
    geodesicId: request.geodesicId,
    totalLengthMeters: request.totalLengthMeters,
  });
  const tail = rebuilt.at(-1);
  if (!tail) {
    return rebuilt;
  }

  const adjustedTailLengthMeters = request.totalLengthMeters -
    rebuilt.slice(0, -1).reduce((total, segment) => total + segment.lengthMeters, 0);
  if (adjustedTailLengthMeters < minGeodesicSegmentLengthMeters - intersectionTolerance) {
    removeGeodesicSegments(request.registry, request.geodesicId);
    return [];
  }

  request.registry.update({
    ...tail,
    lengthMeters: adjustedTailLengthMeters,
    terminal: { kind: "emitter-hit", emitterId: request.incomingEmitterId },
    connectionState: "connected",
  });
  markGeodesicConnected(request.registry, request.geodesicId, source.id, request.incomingEmitterId);
  updateGeodesicIntersectionObjects(request.registry);
  return getGeodesicSegments(request.registry, request.geodesicId);
}

/**
 * Recomputes a locked geodesic after one of its emitters moved, keeping its homotopy class when possible.
 *
 * Interval path: delegates to `rebuildLockedGeodesicFromEndpointsAndPortalWord`. On failure the geodesic is deleted if the new chord
 * would hit a forbidden zone (checked read-only by `lockedIntervalRebuildHitsForbiddenZone`), kept as is when
 * `preserveGeodesicOnRebuildFailure`, and otherwise deleted. Returns the segments (empty when deleted).
 * Legacy: for non-interval connected geodesics the incoming emitter is unfolded into the source cell
 * (`unfoldIncomingEmitterPointToSourceCell`), the source is re-aimed at it, and the chord is retraced; a chord shorter
 * than `minGeodesicSegmentLengthMeters` deletes the geodesic unless an emitter is being carried (then the old segments stay).
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

  const connection = getGeodesicConnection(request.registry, request.geodesicId);
  if (connection?.state !== "connected" || !connection.incomingEmitterId) {
    return getGeodesicSegments(request.registry, request.geodesicId);
  }

  const source = request.registry.get(connection.outgoingEmitterId);
  const incoming = request.registry.get(connection.incomingEmitterId);
  if (source?.kind !== "geodesic-cannon" || incoming?.kind !== "geodesic-cannon") {
    return getGeodesicSegments(request.registry, request.geodesicId);
  }

  const sourcePoint = getGeodesicCannonEmitterPoint(source);
  const carriedPlan = request.carriedEmitterId
    ? resolveCarriedConnectedGeodesicPlan({
        world: request.world,
        registry: request.registry,
        geodesicId: request.geodesicId,
        source,
        incoming,
        carriedEmitterId: request.carriedEmitterId,
        carriedEmitterBeforeMove: request.carriedEmitterBeforeMove,
        carriedEmitterPortalTransition: request.carriedEmitterPortalTransition,
        carriedPortalWord: request.carriedPortalWord,
      })
    : undefined;
  if (request.carriedEmitterId && !carriedPlan) {
    return getGeodesicSegments(request.registry, request.geodesicId);
  }
  const incomingPointInSourceCell = carriedPlan?.incomingPointInSourceCell ?? unfoldIncomingEmitterPointToSourceCell({
    world: request.world,
    registry: request.registry,
    geodesicId: request.geodesicId,
    sourceCellId: source.cellId,
    incoming,
  });
  if (!incomingPointInSourceCell) {
    return getGeodesicSegments(request.registry, request.geodesicId);
  }

  const dx = incomingPointInSourceCell.x - sourcePoint.x;
  const dy = incomingPointInSourceCell.y - sourcePoint.y;
  const centerDistanceMeters = Math.hypot(dx, dy);
  const totalLengthMeters = centerDistanceMeters - geodesicRayBeamStartOffsetMeters;
  if (totalLengthMeters < minGeodesicSegmentLengthMeters - intersectionTolerance) {
    if (request.carriedEmitterId) {
      return getGeodesicSegments(request.registry, request.geodesicId);
    }

    removeGeodesic(request.registry, request.geodesicId);
    return [];
  }

  const nextYaw = sanitizeYaw(Math.atan2(dy, dx));
  const sourceWithYaw = {
    ...source,
    aimYawRadians: nextYaw,
    localPose: yawRigidTransform3(nextYaw, source.localPose.translation),
    activeGeodesicId: request.geodesicId,
    geodesicEmitterYawRadiansById: {
      ...source.geodesicEmitterYawRadiansById,
      [request.geodesicId]: nextYaw,
    },
  };

  const direction = directionFromYaw(nextYaw);
  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: false,
    world: request.world,
    registry: request.registry,
    geodesicId: request.geodesicId,
    sourceEmitterId: sourceWithYaw.id,
    cellId: sourceWithYaw.cellId,
    start: addVec3(getGeodesicCannonEmitterPoint(sourceWithYaw), scaleVec3(direction, geodesicRayBeamStartOffsetMeters)),
    direction,
    maxLengthMeters: totalLengthMeters,
  });
  if (traces.some((trace) => trace.terminal.kind === "forbidden-zone-hit")) {
    removeGeodesic(request.registry, request.geodesicId);
    return [];
  }

  const rebuilt = replaceConnectedGeodesicSegments({
    registry: request.registry,
    source: sourceWithYaw,
    incomingEmitterId: incoming.id,
    geodesicId: request.geodesicId,
    totalLengthMeters,
    traces,
  });
  return rebuilt ?? getGeodesicSegments(request.registry, request.geodesicId);
}

// ---- Tie and detach ----

/**
 * Legacy entry point of tie-and-detach, keyed by geodesic ids; forwards to the endpoint-role API when it can.
 *
 * Selects two locked, non-straightening endpoint attachments at the emitter (the given `incidentGeodesicIds`, or the only two
 * available) and, if two were found, calls `tieAndDetachGeodesicEndpoints` using `geodesicId` as the pair id and
 * `<geodesicId>:free-end` as the shared free-end id; returns all segments of the resulting moving intervals (empty on failure).
 * If fewer than two attachments are selectable it falls back to the retired same-cell straightening model
 * (`tieAndDetachIncidentGeodesicsLegacy`). Prefer `tieAndDetachGeodesicEndpoints`.
 */
export function tieAndDetachIncidentGeodesics(
  request: TieAndDetachIncidentGeodesicsRequest,
): readonly GeodesicSegmentObject[] {
  const detached = request.registry.get(request.emitterId);
  if (detached?.kind !== "geodesic-cannon") {
    return [];
  }
  const selectable = getGeodesicEndpointAttachmentsForAnchor(request.registry, detached.id)
    .filter((attachment) => isGeodesicLocked(request.registry, attachment.geodesicId))
    .filter((attachment) => !isGeodesicStraightening(request.registry, attachment.geodesicId));
  const selected = request.incidentGeodesicIds
    ? request.incidentGeodesicIds
        .map((geodesicId) => selectable.find((attachment) => attachment.geodesicId === geodesicId))
    : selectable.length === 2 ? [selectable[0], selectable[1]] : [];
  const first = selected[0];
  const second = selected[1];
  if (first && second) {
    const pair = tieAndDetachGeodesicEndpoints({
      world: request.world,
      registry: request.registry,
      detachedEmitterId: detached.id,
      first,
      second,
      createPairId: () => request.geodesicId,
      createFreeEndId: () => `${request.geodesicId}:free-end`,
    });
    return pair
      ? [...new Set([pair.first.geodesicId, pair.second.geodesicId])]
          .flatMap((geodesicId) => getGeodesicSegments(request.registry, geodesicId))
      : [];
  }

  return tieAndDetachIncidentGeodesicsLegacy(request);
}

/**
 * Detaches two endpoint roles from one emitter and ties them to a new shared free end, starting a curve-shortening pair.
 *
 * Preconditions: `first` and `second` are different `(geodesicId, role)` pairs (the two roles of ONE interval are allowed: a loop
 * based at the emitter); both attachments currently point at `detachedEmitterId`; every affected interval exists and is locked
 * (emitter at both ends). Effects on success: a `FreeGeodesicEndObject` is created at the emitter's beam point (so the geometry does
 * not change at detach time), the selected roles are re-attached to it, the affected intervals become `"moving"`, their segments are
 * rebuilt from the stored portal word (the homotopy class is preserved), and a `CurveShorteningPairObject` is added with
 * `previousTotalLengthMeters` equal to the sum of the affected lengths. Returns that pair.
 *
 * Returns `undefined` on failed preconditions (nothing changed) or when a rebuild fails. Rebuild failure rolls back all intervals and
 * segments and removes the free end, EXCEPT when the failure is a forbidden-zone hit, in which case the affected geodesics are deleted
 * (they cannot exist at all). Ids come from `createFreeEndId`/`createPairId`, each called at most once.
 */
export function tieAndDetachGeodesicEndpoints(
  request: TieAndDetachGeodesicEndpointsRequest,
): CurveShorteningPairObject | undefined {
  if (
    request.first.geodesicId === request.second.geodesicId &&
    request.first.role === request.second.role
  ) {
    return undefined;
  }
  const detached = request.registry.get(request.detachedEmitterId);
  if (detached?.kind !== "geodesic-cannon") {
    return undefined;
  }

  const firstInterval = request.registry.get(request.first.geodesicId);
  const secondInterval = request.registry.get(request.second.geodesicId);
  if (firstInterval?.kind !== "geodesic-interval" || secondInterval?.kind !== "geodesic-interval") {
    return undefined;
  }
  // Distinct intervals only: when both selections name the same interval (start and end of a loop) it is rewired and rebuilt once.
  const affected = uniqueIntervals([firstInterval, secondInterval]);
  if (!affected.every((interval) => isGeodesicLocked(request.registry, interval.id))) {
    return undefined;
  }
  if (
    firstInterval[request.first.role].anchorObjectId !== detached.id ||
    secondInterval[request.second.role].anchorObjectId !== detached.id
  ) {
    return undefined;
  }

  // The shared free end is born exactly at the emitter's beam point, so the two endpoint roles (which already coincide there) move
  // from the emitter to the free end without any visible change; the first shortening tick then slides it away.
  const freeEnd = createFreeGeodesicEndObject({
    id: request.createFreeEndId(),
    cellId: detached.cellId,
    point: getGeodesicCannonEmitterPoint(detached),
  });
  // Snapshot for rollback: the intervals themselves are in `affected`, their derived segment chains are saved here.
  const originalSegmentsByGeodesicId = new Map(
    affected.map((interval) => [interval.id, getGeodesicSegments(request.registry, interval.id)]),
  );
  request.registry.add(freeEnd);
  for (const interval of affected) {
    // Re-wire only the selected roles; each interval keeps its portalWord and the other end's anchor. For a loop, both `start` and
    // `end` of the same interval end up on the free end.
    const next: GeodesicIntervalObject = {
      ...interval,
      motionState: "moving",
      start: interval.id === request.first.geodesicId && request.first.role === "start" ||
        interval.id === request.second.geodesicId && request.second.role === "start"
        ? { geodesicId: interval.id, role: "start", anchorObjectId: freeEnd.id }
        : interval.start,
      end: interval.id === request.first.geodesicId && request.first.role === "end" ||
        interval.id === request.second.geodesicId && request.second.role === "end"
        ? { geodesicId: interval.id, role: "end", anchorObjectId: freeEnd.id }
        : interval.end,
    };
    request.registry.update(next);
    // Rebuild failed (note: rebuildDerivedGeodesicSegments itself deletes a degenerate interval). Forbidden zone: the geodesic cannot
    // legally exist, so delete everything. Anything else (wrong word, wall hit): restore the original intervals, segments and
    // emitter attachments and discard the free end, leaving the world as before the request.
    if (!rebuildDerivedGeodesicSegments({ world: request.world, registry: request.registry, geodesicId: interval.id })) {
      if (previewGeodesicIntervalHitsForbiddenZone({ world: request.world, registry: request.registry, interval: next })) {
        cleanupCurveShorteningFailure(request.registry, affected.map(({ id }) => id), freeEnd.id, undefined);
      } else {
        restoreGeodesicIntervalsAndSegments(request.registry, affected, originalSegmentsByGeodesicId);
        request.registry.remove(freeEnd.id);
        removeUnusedFreeGeodesicEnds(request.registry);
        updateGeodesicIntersectionObjects(request.registry);
      }
      return undefined;
    }
    syncLegacyEmitterGeodesicFields(request.registry, interval.id);
  }

  // The pair records the shared vertex's state as "last good" and the starting total length (used for bookkeeping by the tick).
  const pair = createCurveShorteningPairObject({
    id: request.createPairId(),
    first: { geodesicId: request.first.geodesicId, role: request.first.role, anchorObjectId: freeEnd.id },
    second: { geodesicId: request.second.geodesicId, role: request.second.role, anchorObjectId: freeEnd.id },
    freeEndAnchorId: freeEnd.id,
    previousTotalLengthMeters: totalLengthForGeodesicIds(request.registry, affected.map(({ id }) => id)),
    lastGoodFreeEndCellId: freeEnd.cellId,
    lastGoodFreeEndPoint: getAnchorBeamPoint(freeEnd),
  });
  request.registry.add(pair);
  updateGeodesicIntersectionObjects(request.registry);
  return pair;
}

// Legacy: the retired same-cell straightening model. Removes the two locked geodesics at the emitter and replaces them by a two-segment
// polyline emitter A -> detached emitter position -> emitter B, all in ONE cell (so no portals are handled), marked `"straightening"`.
// Returns [] unless both geodesics' other ends are emitters in the same cell as the detached emitter and far enough from it.
function tieAndDetachIncidentGeodesicsLegacy(
  request: TieAndDetachIncidentGeodesicsRequest,
): readonly GeodesicSegmentObject[] {
  const detached = request.registry.get(request.emitterId);
  if (detached?.kind !== "geodesic-cannon") {
    return [];
  }

  const selectableGeodesicIds = collectLockedIncidentGeodesicIdsForEmitter(request.registry, detached.id)
    .filter((geodesicId) => !isGeodesicStraightening(request.registry, geodesicId));
  const incidentGeodesicIds = request.incidentGeodesicIds ?? (
    selectableGeodesicIds.length === 2 ? [selectableGeodesicIds[0], selectableGeodesicIds[1]] : undefined
  );
  if (
    !incidentGeodesicIds ||
    incidentGeodesicIds[0] === incidentGeodesicIds[1] ||
    !incidentGeodesicIds.every((geodesicId) => selectableGeodesicIds.includes(geodesicId))
  ) {
    return [];
  }

  const endpoints = incidentGeodesicIds
    .map((geodesicId) => resolveDetachedEndpoint(request.registry, geodesicId, detached.id));
  const first = endpoints[0];
  const second = endpoints[1];
  if (!first || !second || first.emitter.cellId !== second.emitter.cellId || first.emitter.cellId !== detached.cellId) {
    return [];
  }

  const vertex = getGeodesicCannonEmitterPoint(detached);
  const firstPoint = getGeodesicCannonEmitterPoint(first.emitter);
  const secondPoint = getGeodesicCannonEmitterPoint(second.emitter);
  if (
    distanceVec3(firstPoint, vertex) <= geodesicRayBeamStartOffsetMeters + minGeodesicSegmentLengthMeters ||
    distanceVec3(secondPoint, vertex) <= geodesicRayBeamStartOffsetMeters + minGeodesicSegmentLengthMeters
  ) {
    return [];
  }

  for (const geodesicId of incidentGeodesicIds) {
    removeGeodesic(request.registry, geodesicId);
  }
  const sourceDirection = normalizeHorizontalDirection(subVec3(vertex, firstPoint));
  const start = addVec3(firstPoint, scaleVec3(sourceDirection, geodesicRayBeamStartOffsetMeters));
  const firstHalf = createStraighteningSegment({
    id: `${request.geodesicId}:segment:0`,
    geodesicId: request.geodesicId,
    geodesicNumber: resolveGeodesicNumber(request.registry, request.geodesicId),
    segmentIndex: 0,
    cellId: first.emitter.cellId,
    start,
    end: vertex,
    terminal: { kind: "open" },
  });
  const secondHalf = createStraighteningSegment({
    id: `${request.geodesicId}:segment:1`,
    geodesicId: request.geodesicId,
    geodesicNumber: firstHalf.geodesicNumber,
    segmentIndex: 1,
    cellId: first.emitter.cellId,
    start: vertex,
    end: addVec3(secondPoint, scaleVec3(normalizeHorizontalDirection(subVec3(vertex, secondPoint)), geodesicRayBeamStartOffsetMeters)),
    terminal: { kind: "emitter-hit", emitterId: second.emitter.id },
  });

  request.registry.add(firstHalf);
  request.registry.add(secondHalf);
  markStraighteningGeodesic(request.registry, request.geodesicId, first.emitter.id, second.emitter.id);
  updateGeodesicIntersectionObjects(request.registry);
  return getGeodesicSegments(request.registry, request.geodesicId);
}

/**
 * Legacy: advances curve-shortening pairs, and only if none changed, the retired same-cell straightening polylines. Returns changed ids.
 *
 * Calls `advanceCurveShorteningPairs` first and returns its result when non-empty. Otherwise (and when `deltaSeconds > 0`) it moves the
 * vertex of each two-segment, single-cell `"straightening"` polyline toward the chord of its endpoints by at most speed times
 * `deltaSeconds`; when the vertex is on the chord the polyline is replaced by a locked geodesic (`lockStraightenedGeodesic`), and a
 * polyline entering a forbidden zone or with an unexpected shape is deleted. New code should call `advanceCurveShorteningPairs`.
 */
export function advanceStraighteningGeodesics(
  request: AdvanceStraighteningGeodesicsRequest,
): readonly string[] {
  const shortened = advanceCurveShorteningPairs(request);
  if (shortened.length > 0) {
    return shortened;
  }

  if (!(request.deltaSeconds > 0)) {
    return [];
  }

  const advanced: string[] = [];
  const geodesicIds = new Set(
    request.registry.getAll()
      .filter(isGeodesicSegmentObject)
      .filter((segment) => segment.connectionState === "straightening")
      .map((segment) => segment.geodesicId),
  );

  for (const geodesicId of geodesicIds) {
    const connection = getGeodesicConnection(request.registry, geodesicId);
    if (connection?.state !== "straightening" || !connection.incomingEmitterId) {
      continue;
    }

    const segments = getGeodesicSegments(request.registry, geodesicId);
    const first = segments[0];
    const second = segments[1];
    if (!first || !second || segments.length !== 2 || first.cellId !== second.cellId) {
      removeGeodesic(request.registry, geodesicId);
      advanced.push(geodesicId);
      continue;
    }

    const start = first.start;
    const vertex = getGeodesicSegmentEnd(first);
    const end = getGeodesicSegmentEnd(second);
    // Legacy step: slide the vertex toward the straight chord start->end; `undefined` means it has arrived.
    const nextVertex = moveStraighteningVertex({
      start,
      vertex,
      end,
      maxStepMeters: (request.speedMetersPerSecond ?? geodesicStraighteningSpeedMetersPerSecond) * request.deltaSeconds,
    });
    if (!nextVertex) {
      if (straightSegmentHitsForbiddenZone(request.world, first.cellId, start, end)) {
        removeGeodesic(request.registry, geodesicId);
        advanced.push(geodesicId);
        continue;
      }
      lockStraightenedGeodesic({
        registry: request.registry,
        geodesicId,
        sourceEmitterId: connection.outgoingEmitterId,
        incomingEmitterId: connection.incomingEmitterId,
        cellId: first.cellId,
        start,
        end,
        geodesicNumber: first.geodesicNumber,
      });
      advanced.push(geodesicId);
      continue;
    }

    const nextFirst = createStraighteningSegment({
      id: first.id,
      geodesicId,
      geodesicNumber: first.geodesicNumber,
      segmentIndex: 0,
      cellId: first.cellId,
      start,
      end: nextVertex,
      terminal: { kind: "open" },
    });
    const nextSecond = createStraighteningSegment({
      id: second.id,
      geodesicId,
      geodesicNumber: second.geodesicNumber,
      segmentIndex: 1,
      cellId: second.cellId,
      start: nextVertex,
      end,
      terminal: second.terminal,
    });
    if (straighteningHalfHitsForbiddenZone(request.world, nextFirst) || straighteningHalfHitsForbiddenZone(request.world, nextSecond)) {
      removeGeodesic(request.registry, geodesicId);
      advanced.push(geodesicId);
      continue;
    }

    request.registry.update(nextFirst);
    request.registry.update(nextSecond);
    advanced.push(geodesicId);
  }

  if (advanced.length > 0) {
    updateGeodesicIntersectionObjects(request.registry);
  }
  return advanced;
}

// ---- Curve shortening ----

/**
 * Advances every curve-shortening pair by one tick of `deltaSeconds`, sliding its shared free end downhill, and returns the changed ids.
 *
 * Model: a pair glues two endpoint roles at one free end F; the unit tangents `u`, `v` of the two geodesic arcs at F (pointing away
 * from F) give the first variation of the total length L under a displacement `d` of F: `dL = -(u + v) . d`. So the steepest
 * descent direction is `normalize(u + v)`; when `u + v` vanishes (or the angle between `u` and `v` is within
 * `curveShorteningFuseAngleToleranceRadians` of pi) the corner is locally straight. The portal words keep each arc in its homotopy
 * class, while F crossing a portal is the only allowed change of the words.
 *
 * Per pair, in this order: (1) a `"ready-to-fuse"` pair is fused with `fuseCurveShorteningPair` (fusion happens one call after the
 * pair was flagged); (2) structurally invalid pairs (missing free end, intervals gone, no longer `"moving"`, missing tangents) are
 * silently removed; (3) a straight corner flags the pair `"ready-to-fuse"`; (4) a free loop shorter than `GEODESIC_MIN_LENGTH_METERS` is deleted, and a two-arc pair whose shorter arc is below
 * `curveShorteningFuseStepToleranceMeters` is absorbed (`absorbShortCurveShorteningHalf`; if that is refused the tick goes on). Step
 * length = min(speed times `deltaSeconds`, a quarter of the shorter arc, `delta / (1/a + 1/b)` with `delta` the angle deficit), with no lower bound;
 * (5) F is moved with `moveDynamicObject` (autonomous portal crossing, forbidden zones ignored); a blocked move skips the tick;
 * (6) if F crossed a portal each interval's word is updated by that traversal; (7) every interval is re-traced against the candidate
 * F position WITHOUT touching the registry (`previewRebuildGeodesicInterval`); (8) on success, and if the total length did not grow
 * beyond the tolerance, the free end, the changed intervals,
 * their segments and the pair's `previousTotalLengthMeters`/last-good fields are committed together.
 *
 * Failures of the preview: a degenerate (too short) half is absorbed into the other; a forbidden-zone hit deletes the failing half
 * (the other half survives as a stable free geodesic, see `cleanupCurveShorteningPreviewFailure`); a wall hit or wrong portal word
 * leaves the pair and free end exactly as they were and is NOT reported as a change (the same step is retried next tick). A step is also
 * not committed (and not reported) when the previewed total length exceeds `previousTotalLengthMeters` by more than
 * `curveShorteningLengthIncreaseToleranceMeters`; `previousTotalLengthMeters` is recorded only by committed ticks. A single-interval
 * free loop shorter than `GEODESIC_MIN_LENGTH_METERS` (or whose preview is degenerate and cannot be absorbed) is deleted with its free
 * end and pair. If fusing a `"ready-to-fuse"` pair fails for a reason other than a forbidden zone, the pair reverts to `"moving"`.
 *
 * Returns the unique ids (intervals or pairs) that changed; returns `[]` when `deltaSeconds` is not positive. Units: seconds, meters/second.
 */
export function advanceCurveShorteningPairs(
  request: AdvanceCurveShorteningPairsRequest,
): readonly string[] {
  if (!(request.deltaSeconds > 0)) {
    return [];
  }
  const changed: string[] = [];
  for (const pair of request.registry.getAll().filter(isCurveShorteningPairObject)) {
    // Two-phase finish: a pair flagged on an earlier call is fused now. The returned id is the fused interval (or the pair if fusion failed).
    if (pair.state === "ready-to-fuse") {
      request.onDebugMessage?.("curve-shortening pair fused after ready state", {
        pairId: pair.id,
        first: pair.first,
        second: pair.second,
        freeEndAnchorId: pair.freeEndAnchorId,
        previousTotalLengthMeters: pair.previousTotalLengthMeters,
      });
      const fused = fuseCurveShorteningPair({ world: request.world, registry: request.registry, pairId: pair.id });
      const survivingPair = request.registry.get(pair.id);
      if (!fused && survivingPair?.kind === "curve-shortening-pair" && survivingPair.state === "ready-to-fuse") {
        // Fusion failed for a reason other than a forbidden zone (wall hit, wrong word, degenerate chord): hand the pair back to the
        // descent instead of retrying the same failing fusion forever.
        request.registry.update({ ...survivingPair, state: "moving" });
        request.onDebugMessage?.("curve-shortening pair fusion failed; pair reverted to moving", { pairId: pair.id });
      }
      changed.push(fused?.id ?? pair.id);
      continue;
    }
    // Structural validation. Broken pairs are dropped (the pair object only; intervals are left as they are).
    const freeEnd = request.registry.get(pair.freeEndAnchorId);
    if (freeEnd?.kind !== "free-geodesic-end") {
      request.registry.remove(pair.id);
      continue;
    }
    const owned = resolvePairIntervals(request.registry, pair);
    if (!owned) {
      request.registry.remove(pair.id);
      changed.push(pair.id);
      continue;
    }
    // Unit tangents u, v of the two arcs at the shared free end, pointing away from it. Both are in the free end's cell frame
    // because each arc's end segment lives in the cell of its anchor, and both anchors are the free end.
    const firstTangent = endpointDirectionAwayFromAnchor(request.registry, pair.first);
    const secondTangent = endpointDirectionAwayFromAnchor(request.registry, pair.second);
    if (!firstTangent || !secondTangent) {
      request.registry.remove(pair.id);
      changed.push(pair.id);
      continue;
    }
    // -(u + v) is the gradient of the total length with respect to the free end's position (first variation of arc length).
    const sum = addVec3(firstTangent, secondTangent);
    const sumLength = Math.hypot(sum.x, sum.y);
    // Angle between u and v in [0, pi]; pi means the two arcs continue each other, i.e. the corner at F is straight.
    const turnAngle = Math.acos(Math.max(-1, Math.min(1, firstTangent.x * secondTangent.x + firstTangent.y * secondTangent.y)));
    const angleDeltaFromPiRadians = Math.abs(Math.PI - turnAngle);
    if (sumLength <= intersectionTolerance || Math.abs(Math.PI - turnAngle) <= curveShorteningFuseAngleToleranceRadians) {
      request.onDebugMessage?.("curve-shortening pair marked ready-to-fuse by mobile angle", {
        pairId: pair.id,
        first: pair.first,
        second: pair.second,
        freeEndAnchorId: pair.freeEndAnchorId,
        firstTangent,
        secondTangent,
        tangentSumLength: sumLength,
        zeroSumTolerance: intersectionTolerance,
        turnAngleRadians: turnAngle,
        turnAngleDegrees: radiansToDegrees(turnAngle),
        angleDeltaFromPiRadians,
        angleDeltaFromPiDegrees: radiansToDegrees(angleDeltaFromPiRadians),
        fuseAngleToleranceRadians: curveShorteningFuseAngleToleranceRadians,
        fuseAngleToleranceDegrees: radiansToDegrees(curveShorteningFuseAngleToleranceRadians),
        previousTotalLengthMeters: pair.previousTotalLengthMeters,
      });
      request.registry.update({ ...pair, state: "ready-to-fuse" });
      changed.push(pair.id);
      continue;
    }
    // Arc lengths as seen from the pair's two attachments (for a free loop both name the same interval, so a = b = L).
    const firstArcLengthMeters = totalGeodesicLengthFromSegments(getGeodesicSegments(request.registry, pair.first.geodesicId));
    const secondArcLengthMeters = totalGeodesicLengthFromSegments(getGeodesicSegments(request.registry, pair.second.geodesicId));
    const shortestIncidentLength = Math.min(firstArcLengthMeters, secondArcLengthMeters);
    // Geometry, not the step size, decides when an arc is gone: a free loop below the minimum length is deleted; a two-arc pair
    // whose shorter arc is below the absorb tolerance is absorbed. A refused absorption does not stall the tick.
    if (owned.intervals.length === 1) {
      if (removeDegenerateFreeLoop(request.registry, pair, owned.intervals)) {
        changed.push(pair.id);
        continue;
      }
    } else if (shortestIncidentLength < curveShorteningFuseStepToleranceMeters) {
      const absorbed = absorbShortCurveShorteningHalf({
        world: request.world,
        registry: request.registry,
        pair,
        intervals: owned.intervals,
        onDebugMessage: request.onDebugMessage,
      });
      if (absorbed) {
        changed.push(absorbed.id);
        continue;
      }
    }
    // Step = min(speed * dt, a quarter of the shorter arc, estimated distance to the straight position). The last term is
    // delta / (1/a + 1/b), from delta ~ h (1/a + 1/b) for a vertex at distance h from the chord: it stops the fixed step from
    // jumping back and forth across the chord. No lower bound, so the tick behaves the same at any frame rate.
    const distanceToStraightEstimateMeters = angleDeltaFromPiRadians / (
      1 / Math.max(firstArcLengthMeters, curveShorteningMinStepMeters) +
      1 / Math.max(secondArcLengthMeters, curveShorteningMinStepMeters)
    );
    const stepMeters = Math.min(
      (request.speedMetersPerSecond ?? curveShorteningDefaultSpeedMetersPerSecond) * request.deltaSeconds,
      0.25 * shortestIncidentLength,
      distanceToStraightEstimateMeters,
    );
    if (!(stepMeters > 0)) {
      continue;
    }

    // Steepest-descent direction of total length. The displacement is horizontal (z unchanged).
    const descent = normalizeHorizontalDirection(sum);
    const moveResult = moveDynamicObject({
      world: request.world,
      object: runtimeObjectToDynamicObjectState(freeEnd),
      displacement: scaleVec3(descent, stepMeters),
      portalCrossingMode: AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
      ignoreForbiddenZones: true,
    });
    if (moveResult.blocked) {
      continue;
    }
    // Candidate state of F after the move (not yet committed). `candidateAnchors` makes the previews see it instead of the registry copy.
    const candidateFreeEnd: FreeGeodesicEndObject = {
      ...freeEnd,
      cellId: moveResult.object.cellId,
      localPose: moveResult.object.localPose,
    };
    const candidateAnchors = new Map<string, RuntimeWorldObject>([[candidateFreeEnd.id, candidateFreeEnd]]);
    // If F crossed a portal during the move, F now lives in the neighbouring cell. Each arc's word changes by that traversal
    // (`portalWordAfterAnchorCrossing`: append at an `end` role on F, prepend the inverse at a `start` role on F; a free loop has
    // both roles on F and is conjugated). This is the only change of homotopy class a tick may make. Words that fail the
    // cell-chain check are left unchanged (the preview then fails and nothing is committed).
    // A tick may cross several portals; the traversals are applied once each, in order.
    const traversals: GeodesicPortalTraversal[] = [];
    for (const crossing of moveResult.crossings) {
      const traversal = getPortalTraversalFromSource(request.world, crossing.sourceCellId, crossing.portalId);
      if (!traversal) {
        traversals.length = 0;
        break;
      }
      traversals.push(traversal);
    }
    const candidateIntervals = owned.intervals.map((interval) => {
      if (traversals.length === 0) {
        return interval;
      }
      const portalWord = applyAnchorCrossingTraversals({ interval, anchorObjectId: pair.freeEndAnchorId, traversals });
      if (
        !portalWord ||
        !portalWordMatchesEndpointCellsWithAnchors({
          registry: request.registry,
          interval,
          word: portalWord,
          candidateAnchorsById: candidateAnchors,
        })
      ) {
        return interval;
      }
      const startMoved = interval.start.anchorObjectId === pair.freeEndAnchorId;
      return {
        ...interval,
        cellId: startMoved ? candidateFreeEnd.cellId : interval.cellId,
        startCellId: startMoved ? candidateFreeEnd.cellId : interval.startCellId,
        portalWord,
      };
    });
    // Dry-run re-trace of every arc from its candidate anchors/word: each must realize its word exactly without hitting a wall or zone.
    const previews = candidateIntervals.map((interval) =>
      previewRebuildGeodesicInterval({
        world: request.world,
        registry: request.registry,
        interval,
        candidateAnchorsById: candidateAnchors,
      })
    );
    // At least one arc cannot follow F to the candidate position. If one arc has become shorter than the minimum length it is merged
    // into the other (absorb); otherwise a forbidden-zone hit removes the offending half; any other failure changes nothing.
    if (previews.some((preview) => !preview)) {
      const degenerateInterval = candidateIntervals.find((interval, index) =>
        previews[index] === undefined &&
        previewGeodesicIntervalIsDegenerate({
          world: request.world,
          registry: request.registry,
          interval,
          candidateAnchorsById: candidateAnchors,
        })
      );
      if (degenerateInterval) {
        const absorbed = absorbShortCurveShorteningHalf({
          world: request.world,
          registry: request.registry,
          pair,
          intervals: owned.intervals,
          preferredShortGeodesicId: degenerateInterval.id,
          onDebugMessage: request.onDebugMessage,
        });
        if (absorbed) {
          changed.push(absorbed.id);
        } else if (owned.intervals.length === 1 && removeDegenerateFreeLoop(request.registry, pair, owned.intervals, true)) {
          changed.push(pair.id);
        }
        continue;
      }
      // Only a forbidden-zone failure changes the registry; any other failure leaves the tick uncommitted and unreported.
      const cleanedUp = cleanupCurveShorteningPreviewFailure({
        world: request.world,
        registry: request.registry,
        pair,
        intervals: owned.intervals,
        previews,
        candidateAnchorsById: candidateAnchors,
      });
      if (cleanedUp) {
        changed.push(pair.id);
      }
      continue;
    }
    // All arcs realized: sum their new lengths. Monotone descent: a step that makes the total longer than the last recorded total
    // (beyond the tolerance) is not committed. The corner is already known to be outside the fuse angle tolerance here (a straight
    // corner was flagged `ready-to-fuse` above), so the tick is simply skipped: free end, arcs and recorded total stay as they were.
    const nextTotal = previews.reduce((total, preview) =>
      total + (preview?.segments.reduce((sumMeters, segment) => sumMeters + segment.lengthMeters, 0) ?? 0), 0);
    if (
      pair.previousTotalLengthMeters !== undefined &&
      nextTotal > pair.previousTotalLengthMeters + curveShorteningLengthIncreaseToleranceMeters
    ) {
      request.onDebugMessage?.("curve-shortening step skipped: total length would increase", {
        pairId: pair.id,
        previousTotalLengthMeters: pair.previousTotalLengthMeters,
        candidateTotalLengthMeters: nextTotal,
        toleranceMeters: curveShorteningLengthIncreaseToleranceMeters,
      });
      continue;
    }

    // Commit. Order matters only in that the free end and (possibly new) words are written before the new segments replace the old.
    request.registry.update(candidateFreeEnd);
    for (const preview of previews) {
      if (!preview) {
        continue;
      }
      const candidateInterval = candidateIntervals.find((interval) => interval.id === preview.interval.id);
      const currentInterval = request.registry.get(preview.interval.id);
      if (
        candidateInterval &&
        currentInterval?.kind === "geodesic-interval" &&
        (
          candidateInterval.cellId !== currentInterval.cellId ||
          candidateInterval.startCellId !== currentInterval.startCellId ||
          !samePortalWord(candidateInterval.portalWord, currentInterval.portalWord)
        )
      ) {
        request.registry.update(candidateInterval);
      }
      removeGeodesicSegments(request.registry, preview.interval.id);
      for (const segment of preview.segments) {
        request.registry.add(segment);
      }
      syncLegacyEmitterGeodesicFields(request.registry, preview.interval.id);
    }
    request.registry.update({
      ...pair,
      previousTotalLengthMeters: nextTotal,
      lastGoodFreeEndCellId: candidateFreeEnd.cellId,
      lastGoodFreeEndPoint: getAnchorBeamPoint(candidateFreeEnd),
    });
    changed.push(...owned.intervals.map(({ id }) => id));
  }
  if (changed.length > 0) {
    updateGeodesicIntersectionObjects(request.registry);
  }
  return [...new Set(changed)];
}

/**
 * Finishes a curve-shortening pair: merges its moving arcs into one stable geodesic and deletes the pair and its free end.
 *
 * Free loop (one interval): the interval becomes `"stable"` with both roles still on the shared free end, only the pair object is
 * deleted. Ordinary pair (two intervals): both non-free anchors must be emitters; the surviving interval takes the
 * lexicographically smallest of the two ids (plain string sort), runs from the first arc's non-free emitter to the second arc's
 * non-free emitter, and its portal word is `word(first: nonFree -> free) + word(second: free -> nonFree)` with adjacent inverse
 * traversals cancelled (so a vertex that wrapped back through a portal collapses). The new geometry is previewed first.
 *
 * Returns the stable interval, or `undefined`. Failure semantics: structural problems remove the pair object only; a preview failure
 * caused by a forbidden zone deletes the geodesics, free end and pair; ANY OTHER preview failure (wall hit, wrong word, degenerate
 * chord) returns `undefined` and leaves the pair in `"ready-to-fuse"` state; `advanceCurveShorteningPairs` then reverts it to `"moving"`.
 * A failure of the final destructive rebuild (after the preview succeeded) also returns `undefined` with the pair already gone.
 */
export function fuseCurveShorteningPair(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pairId: string;
}): GeodesicIntervalObject | undefined {
  const pair = input.registry.get(input.pairId);
  if (pair?.kind !== "curve-shortening-pair") {
    return undefined;
  }
  const owned = resolvePairIntervals(input.registry, pair);
  if (!owned) {
    input.registry.remove(pair.id);
    return undefined;
  }

  // One interval owning both roles = a free loop. Its geometry already ends at the shared free end, so fusion only has to make it
  // stable (verifying that it is still realizable) and drop the pair.
  if (owned.intervals.length === 1) {
    const loop = owned.intervals[0];
    const stableLoop: GeodesicIntervalObject = { ...loop, motionState: "stable" };
    const preview = previewRebuildGeodesicInterval({
      world: input.world,
      registry: input.registry,
      interval: stableLoop,
    });
    if (!preview) {
      if (previewGeodesicIntervalHitsForbiddenZone({ world: input.world, registry: input.registry, interval: stableLoop })) {
        cleanupCurveShorteningFailure(input.registry, [loop.id], pair.freeEndAnchorId, pair.id);
      }
      return undefined;
    }
    input.registry.update(stableLoop);
    const rebuilt = rebuildDerivedGeodesicSegments({ world: input.world, registry: input.registry, geodesicId: loop.id });
    if (!rebuilt) {
      return undefined;
    }
    input.registry.remove(pair.id);
    syncLegacyEmitterGeodesicFields(input.registry, loop.id);
    updateGeodesicIntersectionObjects(input.registry);
    return input.registry.get(loop.id) as GeodesicIntervalObject | undefined;
  }

  const firstInterval = input.registry.get(pair.first.geodesicId);
  const secondInterval = input.registry.get(pair.second.geodesicId);
  if (firstInterval?.kind !== "geodesic-interval" || secondInterval?.kind !== "geodesic-interval") {
    input.registry.remove(pair.id);
    return undefined;
  }
  // Each arc's "other end" (not at the shared vertex) must be an emitter; it becomes an endpoint of the fused geodesic.
  // TODO(issue 67): the emitter-at-the-non-free-end assumption (here and in absorbShortCurveShorteningHalf) rejects other anchors.
  const firstNonFreeRole = getOppositeEndRole(pair.first.role);
  const secondNonFreeRole = getOppositeEndRole(pair.second.role);
  const firstAnchor = input.registry.get(firstInterval[firstNonFreeRole].anchorObjectId);
  const secondAnchor = input.registry.get(secondInterval[secondNonFreeRole].anchorObjectId);
  if (firstAnchor?.kind !== "geodesic-cannon" || secondAnchor?.kind !== "geodesic-cannon") {
    input.registry.remove(pair.id);
    return undefined;
  }

  // Reuse the smaller id (string order) for the fused geodesic; the other interval is deleted after the fused one is validated.
  const fusedId = [firstInterval.id, secondInterval.id].sort()[0];
  const removedId = fusedId === firstInterval.id ? secondInterval.id : firstInterval.id;
  // Role-aware word composition: read the first arc from its non-free end to the vertex, then the second arc from the vertex to its
  // non-free end. Both pieces meet in the free end's cell, so the concatenation chains; free reduction cancels back-tracking at the vertex.
  const fusedWord = reduceAdjacentInversePortalTraversals([
    ...getPortalWordBetweenEndpointRoles({
      interval: firstInterval,
      sourceRole: firstNonFreeRole,
      targetRole: pair.first.role,
    }),
    ...getPortalWordBetweenEndpointRoles({
      interval: secondInterval,
      sourceRole: pair.second.role,
      targetRole: secondNonFreeRole,
    }),
  ]);
  const fusedInterval: GeodesicIntervalObject = {
    ...(fusedId === firstInterval.id ? firstInterval : secondInterval),
    id: fusedId,
    cellId: firstAnchor.cellId,
    startCellId: firstAnchor.cellId,
    motionState: "stable",
    portalWord: fusedWord,
    start: { geodesicId: fusedId, role: "start", anchorObjectId: firstAnchor.id },
    end: { geodesicId: fusedId, role: "end", anchorObjectId: secondAnchor.id },
  };
  // Validate the fused geodesic as a pure preview first so a failure leaves the moving arcs intact.
  const preview = previewRebuildGeodesicInterval({
    world: input.world,
    registry: input.registry,
    interval: fusedInterval,
  });
  if (!preview) {
    if (previewGeodesicIntervalHitsForbiddenZone({ world: input.world, registry: input.registry, interval: fusedInterval })) {
      cleanupCurveShorteningFailure(input.registry, owned.intervals.map(({ id }) => id), pair.freeEndAnchorId, pair.id);
    }
    return undefined;
  }
  const existingFused = findEquivalentStableInterval(input.registry, fusedInterval, owned.intervals.map(({ id }) => id));
  if (existingFused) {
    return discardCurveShorteningPairInFavorOf(input.registry, pair, owned.intervals, existingFused);
  }
  // Commit: overwrite the surviving interval, delete the other arc, the free end and the pair, then regenerate the segments.
  input.registry.update(fusedInterval);
  removeGeodesicIntervalAndDerivedObjects(input.registry, removedId);
  input.registry.remove(pair.freeEndAnchorId);
  input.registry.remove(pair.id);
  const rebuilt = rebuildDerivedGeodesicSegments({ world: input.world, registry: input.registry, geodesicId: fusedId });
  const finalInterval = input.registry.get(fusedId);
  if (!rebuilt || finalInterval?.kind !== "geodesic-interval") {
    return undefined;
  }
  syncLegacyEmitterGeodesicFields(input.registry, fusedId);
  updateGeodesicIntersectionObjects(input.registry);
  return finalInterval;
}

// Absorbs a nearly vanished arc of a two-arc pair into the other arc, fusing them into one stable geodesic on the survivor's id.
//
// The short arc (shortest of the two, or `preferredShortGeodesicId`, e.g. one found degenerate in a preview) is below
// `curveShorteningFuseStepToleranceMeters`, so the free end is practically at that arc's emitter: the geodesic then runs from the survivor's
// far emitter to the short arc's far emitter with word = survivor(nonFree -> free) + short(free -> nonFree). Same preview-then-commit
// structure as `fuseCurveShorteningPair` (forbidden-zone failure deletes everything, other failures return undefined and change nothing).
// Unlike fusion, the LONGER arc's id survives. Returns the stable interval or undefined.
function absorbShortCurveShorteningHalf(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pair: CurveShorteningPairObject;
  readonly intervals: readonly GeodesicIntervalObject[];
  readonly preferredShortGeodesicId?: string;
  readonly onDebugMessage?: (message: string, detail?: unknown) => void;
}): GeodesicIntervalObject | undefined {
  if (input.intervals.length !== 2) {
    return undefined;
  }
  const intervalLengths = input.intervals.map((interval) => ({
    interval,
    lengthMeters: totalGeodesicLengthFromSegments(getGeodesicSegments(input.registry, interval.id)),
  })).sort((left, right) => left.lengthMeters - right.lengthMeters);
  const short = intervalLengths[0];
  const survivor = intervalLengths[1];
  const preferredShort = input.preferredShortGeodesicId
    ? intervalLengths.find(({ interval }) => interval.id === input.preferredShortGeodesicId)
    : undefined;
  const preferredSurvivor = preferredShort
    ? intervalLengths.find(({ interval }) => interval.id !== preferredShort.interval.id)
    : undefined;
  const absorbedShort = preferredShort ?? short;
  const absorbedSurvivor = preferredSurvivor ?? survivor;
  if (
    !absorbedShort ||
    !absorbedSurvivor ||
    (
      !input.preferredShortGeodesicId &&
      absorbedShort.lengthMeters > curveShorteningFuseStepToleranceMeters
    )
  ) {
    return undefined;
  }

  const shortFreeRole = getPairFreeRoleForInterval(input.pair, absorbedShort.interval);
  const survivorFreeRole = getPairFreeRoleForInterval(input.pair, absorbedSurvivor.interval);
  if (!shortFreeRole || !survivorFreeRole) {
    return undefined;
  }
  const shortNonFreeRole = getOppositeEndRole(shortFreeRole);
  const survivorNonFreeRole = getOppositeEndRole(survivorFreeRole);
  const shortNonFreeAnchor = input.registry.get(absorbedShort.interval[shortNonFreeRole].anchorObjectId);
  const survivorNonFreeAnchor = input.registry.get(absorbedSurvivor.interval[survivorNonFreeRole].anchorObjectId);
  if (shortNonFreeAnchor?.kind !== "geodesic-cannon" || survivorNonFreeAnchor?.kind !== "geodesic-cannon") {
    return undefined;
  }

  const fusedWord = reduceAdjacentInversePortalTraversals([
    ...getPortalWordBetweenEndpointRoles({
      interval: absorbedSurvivor.interval,
      sourceRole: survivorNonFreeRole,
      targetRole: survivorFreeRole,
    }),
    ...getPortalWordBetweenEndpointRoles({
      interval: absorbedShort.interval,
      sourceRole: shortFreeRole,
      targetRole: shortNonFreeRole,
    }),
  ]);
  const fusedInterval: GeodesicIntervalObject = {
    ...absorbedSurvivor.interval,
    id: absorbedSurvivor.interval.id,
    cellId: survivorNonFreeAnchor.cellId,
    startCellId: survivorNonFreeAnchor.cellId,
    motionState: "stable",
    portalWord: fusedWord,
    start: { geodesicId: absorbedSurvivor.interval.id, role: "start", anchorObjectId: survivorNonFreeAnchor.id },
    end: { geodesicId: absorbedSurvivor.interval.id, role: "end", anchorObjectId: shortNonFreeAnchor.id },
  };
  const preview = previewRebuildGeodesicInterval({
    world: input.world,
    registry: input.registry,
    interval: fusedInterval,
  });
  if (!preview) {
    if (previewGeodesicIntervalHitsForbiddenZone({ world: input.world, registry: input.registry, interval: fusedInterval })) {
      cleanupCurveShorteningFailure(
        input.registry,
        input.intervals.map(({ id }) => id),
        input.pair.freeEndAnchorId,
        input.pair.id,
      );
    }
    return undefined;
  }

  const existingAbsorbed = findEquivalentStableInterval(input.registry, fusedInterval, input.intervals.map(({ id }) => id));
  if (existingAbsorbed) {
    return discardCurveShorteningPairInFavorOf(input.registry, input.pair, input.intervals, existingAbsorbed);
  }

  input.onDebugMessage?.("curve-shortening pair absorbed short incident half", {
    pairId: input.pair.id,
    removedGeodesicId: absorbedShort.interval.id,
    survivorGeodesicId: absorbedSurvivor.interval.id,
    shortLengthMeters: absorbedShort.lengthMeters,
    survivorLengthMeters: absorbedSurvivor.lengthMeters,
    absorbLengthToleranceMeters: curveShorteningFuseStepToleranceMeters,
    fusedPortalWord: fusedWord,
  });
  input.registry.update(fusedInterval);
  removeGeodesicIntervalAndDerivedObjects(input.registry, absorbedShort.interval.id);
  input.registry.remove(input.pair.freeEndAnchorId);
  input.registry.remove(input.pair.id);
  const rebuilt = rebuildDerivedGeodesicSegments({
    world: input.world,
    registry: input.registry,
    geodesicId: absorbedSurvivor.interval.id,
  });
  const finalInterval = input.registry.get(absorbedSurvivor.interval.id);
  if (!rebuilt || finalInterval?.kind !== "geodesic-interval") {
    return undefined;
  }
  syncLegacyEmitterGeodesicFields(input.registry, absorbedSurvivor.interval.id);
  updateGeodesicIntersectionObjects(input.registry);
  return finalInterval;
}

// Finds a stable interval that is the same geodesic as `candidate`: same two endpoint anchors and the same portal word, read in
// either direction (A -> B with word w equals B -> A with the inverse word). The word, not just the anchor pair, is the identity:
// two emitters can be joined by several distinct geodesics in different homotopy classes, and those must stay separate.
// Only called when a curve-shortening pair finishes and its result is about to be locked, never while geodesics are still moving;
// only stable, locked (emitter-to-emitter) intervals are candidates.
function findEquivalentStableInterval(
  registry: RuntimeObjectRegistry,
  candidate: GeodesicIntervalObject,
  excludedIds: readonly string[],
): GeodesicIntervalObject | undefined {
  const reversedCandidateWord = reverseGeodesicPortalWord(candidate.portalWord);
  return registry.getAll().find((object): object is GeodesicIntervalObject =>
    object.kind === "geodesic-interval" &&
    object.motionState === "stable" &&
    isGeodesicLocked(registry, object.id) &&
    !excludedIds.includes(object.id) &&
    (
      (
        object.start.anchorObjectId === candidate.start.anchorObjectId &&
        object.end.anchorObjectId === candidate.end.anchorObjectId &&
        samePortalWord(object.portalWord, candidate.portalWord)
      ) || (
        object.start.anchorObjectId === candidate.end.anchorObjectId &&
        object.end.anchorObjectId === candidate.start.anchorObjectId &&
        samePortalWord(object.portalWord, reversedCandidateWord)
      )
    ));
}

// Ends a curve-shortening pair whose fused result would duplicate `existing`: deletes the moving arcs, the free end and the pair, and
// keeps the geodesic that is already there.
function discardCurveShorteningPairInFavorOf(
  registry: RuntimeObjectRegistry,
  pair: CurveShorteningPairObject,
  intervals: readonly GeodesicIntervalObject[],
  existing: GeodesicIntervalObject,
): GeodesicIntervalObject {
  for (const interval of intervals) {
    removeGeodesicIntervalAndDerivedObjects(registry, interval.id);
  }
  if (registry.get(pair.freeEndAnchorId)) {
    registry.remove(pair.freeEndAnchorId);
  }
  if (registry.get(pair.id)) {
    registry.remove(pair.id);
  }
  updateGeodesicIntersectionObjects(registry);
  return existing;
}

function getPairFreeRoleForInterval(
  pair: CurveShorteningPairObject,
  interval: GeodesicIntervalObject,
): GeodesicEndRole | undefined {
  if (pair.first.geodesicId === interval.id) {
    return pair.first.role;
  }
  if (pair.second.geodesicId === interval.id) {
    return pair.second.role;
  }
  return undefined;
}

/**
 * Returns the portal word of a geodesic: the stored word for an interval, else (legacy) the traversals read off the segment chain.
 *
 * For legacy chains each `portal-hit` terminal contributes its traversal; hits whose portal is unknown to `world` are skipped.
 * Returns `[]` for unknown ids or geodesics that never cross a portal.
 */
export function collectGeodesicPortalWord(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly GeodesicPortalTraversal[] {
  const intervalWord = getGeodesicPortalWord(registry, geodesicId);
  if (intervalWord) {
    return intervalWord;
  }

  const word: GeodesicPortalTraversal[] = [];
  for (const segment of getGeodesicSegments(registry, geodesicId)) {
    if (segment.terminal.kind !== "portal-hit") {
      continue;
    }

    const portal = world.cellsById.get(segment.cellId)?.portalsById.get(segment.terminal.portalId);
    if (!portal) {
      continue;
    }

    word.push({
      sourceCellId: segment.cellId,
      sourcePortalId: portal.id,
      targetCellId: portal.targetCellId,
      targetPortalId: portal.targetPortalId,
    });
  }

  return word;
}

// De-duplicates intervals by id (a loop pair names the same interval twice), keeping the last occurrence.
function uniqueIntervals(intervals: readonly GeodesicIntervalObject[]): readonly GeodesicIntervalObject[] {
  const byId = new Map<string, GeodesicIntervalObject>();
  for (const interval of intervals) {
    byId.set(interval.id, interval);
  }
  return [...byId.values()];
}

// Resolves and validates the intervals owned by a pair: both exist, the named role of each is attached to the pair's free end, and
// every interval is `"moving"`. Returns `undefined` otherwise. One interval is returned for a free loop.
function resolvePairIntervals(
  registry: RuntimeObjectRegistry,
  pair: CurveShorteningPairObject,
): { readonly intervals: readonly GeodesicIntervalObject[] } | undefined {
  const first = registry.get(pair.first.geodesicId);
  const second = registry.get(pair.second.geodesicId);
  if (first?.kind !== "geodesic-interval" || second?.kind !== "geodesic-interval") {
    return undefined;
  }
  if (
    first[pair.first.role].anchorObjectId !== pair.freeEndAnchorId ||
    second[pair.second.role].anchorObjectId !== pair.freeEndAnchorId
  ) {
    return undefined;
  }
  const intervals = uniqueIntervals([first, second]);
  return intervals.every((interval) => interval.motionState === "moving") ? { intervals } : undefined;
}

// Unit horizontal direction (cell frame of the anchor) in which the geodesic leaves the anchor of the given endpoint role.
function endpointDirectionAwayFromAnchor(
  registry: RuntimeObjectRegistry,
  attachment: GeodesicEndpointAttachment,
): Vec3 | undefined {
  const tangent = resolveEndpointTangentAtAnchor({
    registry,
    geodesicId: attachment.geodesicId,
    endRole: attachment.role,
  });
  return tangent ? directionFromYaw(tangent.yawRadians) : undefined;
}

// Sum of the derived-segment lengths of the distinct geodesic ids (meters).
function totalLengthForGeodesicIds(
  registry: RuntimeObjectRegistry,
  geodesicIds: readonly string[],
): number {
  return [...new Set(geodesicIds)].reduce(
    (total, geodesicId) => total + totalGeodesicLengthFromSegments(getGeodesicSegments(registry, geodesicId)),
    0,
  );
}

// Destructive failure cleanup: deletes the given intervals with their derived objects, the shared free end and optionally the pair,
// then refreshes intersection markers. No survivor is kept.
function cleanupCurveShorteningFailure(
  registry: RuntimeObjectRegistry,
  geodesicIds: readonly string[],
  freeEndAnchorId: string,
  pairId: string | undefined,
): void {
  for (const geodesicId of [...new Set(geodesicIds)]) {
    removeGeodesicIntervalAndDerivedObjects(registry, geodesicId);
  }
  registry.remove(freeEndAnchorId);
  if (pairId) {
    registry.remove(pairId);
  }
  updateGeodesicIntersectionObjects(registry);
}

// Rollback helper: puts back saved interval objects (re-adding any that were deleted) together with their saved segment chains.
function restoreGeodesicIntervalsAndSegments(
  registry: RuntimeObjectRegistry,
  intervals: readonly GeodesicIntervalObject[],
  segmentsByGeodesicId: ReadonlyMap<string, readonly GeodesicSegmentObject[]>,
): void {
  for (const interval of intervals) {
    if (registry.get(interval.id)?.kind === "geodesic-interval") {
      registry.update(interval);
    } else {
      registry.add(interval);
    }
    removeGeodesicSegments(registry, interval.id);
    for (const segment of segmentsByGeodesicId.get(interval.id) ?? []) {
      registry.add(segment);
    }
    syncLegacyEmitterGeodesicFields(registry, interval.id);
  }
}

// Handles a failed preview tick. Only forbidden-zone failures are acted upon; with none, nothing changes and `false` is returned.
// Returns `true` when objects were deleted or rewritten.
// If every arc failed, or the situation is not "exactly one of two arcs failed", the failing arcs, free end and pair are deleted.
// Otherwise (one arc failed, one succeeded): the failed arc and the pair are deleted and the surviving arc is detached from the
// shared free end onto a NEW free end at the pair's last-good position, set `"stable"`, and rebuilt: it becomes an ordinary free geodesic.
function cleanupCurveShorteningPreviewFailure(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pair: CurveShorteningPairObject;
  readonly intervals: readonly GeodesicIntervalObject[];
  readonly previews: readonly (GeodesicTraceBuildResult | undefined)[];
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): boolean {
  const successes = input.intervals.filter((_interval, index) => input.previews[index] !== undefined);
  const failures = input.intervals.filter((_interval, index) => input.previews[index] === undefined);
  const forbiddenFailures = failures.filter((interval) =>
    previewGeodesicIntervalHitsForbiddenZone({
      world: input.world,
      registry: input.registry,
      interval,
      candidateAnchorsById: input.candidateAnchorsById,
    })
  );
  if (forbiddenFailures.length === 0) {
    return false;
  }
  if (
    forbiddenFailures.length === input.intervals.length ||
    successes.length !== 1 ||
    input.intervals.length !== 2
  ) {
    cleanupCurveShorteningFailure(
      input.registry,
      forbiddenFailures.map(({ id }) => id),
      input.pair.freeEndAnchorId,
      input.pair.id,
    );
    return true;
  }

  const survivor = successes[0];
  const failed = forbiddenFailures[0];
  const freeRole = survivor.start.anchorObjectId === input.pair.freeEndAnchorId ? "start" : "end";
  const survivorFreeEnd = createFreeGeodesicEndObject({
    id: `${survivor.id}:surviving-free-end`,
    cellId: input.pair.lastGoodFreeEndCellId,
    point: input.pair.lastGoodFreeEndPoint,
  });
  removeGeodesicIntervalAndDerivedObjects(input.registry, failed.id);
  input.registry.remove(input.pair.id);
  input.registry.remove(input.pair.freeEndAnchorId);
  input.registry.add(survivorFreeEnd);
  const currentSurvivor = input.registry.get(survivor.id);
  if (currentSurvivor?.kind !== "geodesic-interval") {
    removeUnusedFreeGeodesicEnds(input.registry);
    updateGeodesicIntersectionObjects(input.registry);
    return true;
  }
  const nextSurvivor: GeodesicIntervalObject = freeRole === "start"
    ? {
        ...currentSurvivor,
        motionState: "stable",
        start: {
          geodesicId: currentSurvivor.id,
          role: "start",
          anchorObjectId: survivorFreeEnd.id,
        },
      }
    : {
        ...currentSurvivor,
        motionState: "stable",
        end: {
          geodesicId: currentSurvivor.id,
          role: "end",
          anchorObjectId: survivorFreeEnd.id,
        },
      };
  input.registry.update(nextSurvivor);
  rebuildDerivedGeodesicSegments({ world: input.world, registry: input.registry, geodesicId: survivor.id });
  syncLegacyEmitterGeodesicFields(input.registry, survivor.id);
  updateGeodesicIntersectionObjects(input.registry);
  return true;
}

// Deletes a pair's single interval (a free loop: both roles on the shared free end) with its derived objects, the free end and the pair,
// when the loop is shorter than `GEODESIC_MIN_LENGTH_METERS` or the caller already knows it is degenerate (`assumeDegenerate`).
// A two-interval pair is never touched. Returns whether anything was deleted.
function removeDegenerateFreeLoop(
  registry: RuntimeObjectRegistry,
  pair: CurveShorteningPairObject,
  intervals: readonly GeodesicIntervalObject[],
  assumeDegenerate = false,
): boolean {
  if (intervals.length !== 1) {
    return false;
  }
  const loop = intervals[0];
  if (loop.start.anchorObjectId !== pair.freeEndAnchorId || loop.end.anchorObjectId !== pair.freeEndAnchorId) {
    return false;
  }
  if (!assumeDegenerate && totalGeodesicLengthFromSegments(getGeodesicSegments(registry, loop.id)) >= GEODESIC_MIN_LENGTH_METERS) {
    return false;
  }
  cleanupCurveShorteningFailure(registry, [loop.id], pair.freeEndAnchorId, pair.id);
  return true;
}

// Read-only: would tracing this interval (with optional candidate anchors) enter a forbidden zone? False if the lift fails or the chord
// is shorter than the minimum length.
function previewGeodesicIntervalHitsForbiddenZone(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): boolean {
  const lifted = liftGeodesicEndpointWithAnchors({
    world: input.world,
    registry: input.registry,
    interval: input.interval,
    sourceRole: "start",
    candidateAnchorsById: input.candidateAnchorsById,
  });
  if (!lifted) {
    return false;
  }
  const dx = lifted.targetPointInSourceCell.x - lifted.sourcePoint.x;
  const dy = lifted.targetPointInSourceCell.y - lifted.sourcePoint.y;
  const lengthMeters = Math.hypot(dx, dy);
  if (lengthMeters < GEODESIC_MIN_LENGTH_METERS - intersectionTolerance) {
    return false;
  }
  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: false,
    world: input.world,
    registry: input.registry,
    geodesicId: input.interval.id,
    sourceEmitterId: input.interval.start.anchorObjectId,
    cellId: lifted.sourceCellId,
    start: lifted.sourcePoint,
    direction: directionFromYaw(Math.atan2(dy, dx)),
    maxLengthMeters: lengthMeters,
  });
  return traces.some((trace) => trace.terminal.kind === "forbidden-zone-hit");
}

// Read-only: is the lifted start-to-end chord shorter than `GEODESIC_MIN_LENGTH_METERS`? False if the lift itself fails.
function previewGeodesicIntervalIsDegenerate(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): boolean {
  const lifted = liftGeodesicEndpointWithAnchors({
    world: input.world,
    registry: input.registry,
    interval: input.interval,
    sourceRole: "start",
    candidateAnchorsById: input.candidateAnchorsById,
  });
  if (!lifted) {
    return false;
  }
  return Math.hypot(
    lifted.targetPointInSourceCell.x - lifted.sourcePoint.x,
    lifted.targetPointInSourceCell.y - lifted.sourcePoint.y,
  ) < GEODESIC_MIN_LENGTH_METERS - intersectionTolerance;
}

// Legacy: computes where the far emitter lies in the source emitter's cell after one of them was carried, for the non-interval model.
//
// With T = composition of the portal transforms along the geodesic's portal word (source-cell frame -> incoming-cell frame),
// the incoming point in the source frame is T^{-1}(incomingPoint). If the carried emitter crossed a portal, its crossing
// transform is composed into T (carried = incoming) or applied after pulling back (carried = source). Returns undefined if the word
// cannot be resolved, the carried id is neither emitter, or the resulting chord is too short to draw.
function resolveCarriedConnectedGeodesicPlan(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly source: GeodesicCannonObject;
  readonly incoming: GeodesicCannonObject;
  readonly carriedEmitterId: string;
  readonly carriedEmitterBeforeMove?: GeodesicCannonObject;
  readonly carriedEmitterPortalTransition?: GeodesicCarryPortalTransition;
  readonly carriedPortalWord?: readonly GeodesicPortalTraversal[];
}): { readonly incomingPointInSourceCell: Vec3 } | undefined {
  if (input.carriedEmitterId !== input.source.id && input.carriedEmitterId !== input.incoming.id) {
    return undefined;
  }

  const sourcePoint = getGeodesicCannonEmitterPoint(input.source);
  const incomingPoint = getGeodesicCannonEmitterPoint(input.incoming);
  const existingIncomingFromSource = getExistingGeodesicPortalTransform(
    input.world,
    input.registry,
    input.geodesicId,
    input.carriedPortalWord,
  );
  if (!existingIncomingFromSource) {
    return undefined;
  }

  const movedAcrossPortal = input.carriedPortalWord
    ? undefined
    : resolveExplicitCarriedEmitterPortalTransition(input);
  const incomingFromSource = movedAcrossPortal && input.carriedEmitterId === input.incoming.id
    ? composeRigidTransform3(movedAcrossPortal.transformToTarget, existingIncomingFromSource)
    : existingIncomingFromSource;

  if (input.carriedEmitterId === input.incoming.id) {
    const incomingPointInSourceCell = transformPoint3(invertRigidTransform3(incomingFromSource), incomingPoint);
    return isDrawableEndpointPair(sourcePoint, incomingPointInSourceCell)
      ? { incomingPointInSourceCell }
      : undefined;
  }

  const currentSourceFromPreviousSource = movedAcrossPortal && input.carriedEmitterId === input.source.id
    ? movedAcrossPortal.transformToTarget
    : identityRigidTransform3;
  const previousIncomingPointInPreviousSourceCell = transformPoint3(
    invertRigidTransform3(existingIncomingFromSource),
    incomingPoint,
  );
  const incomingPointInSourceCell = transformPoint3(currentSourceFromPreviousSource, previousIncomingPointInPreviousSourceCell);
  return isDrawableEndpointPair(sourcePoint, incomingPointInSourceCell)
    ? { incomingPointInSourceCell }
    : undefined;
}

// Legacy helper: the emitter (source or incoming) whose id equals `carriedEmitterId`.
function getCarriedEmitter(input: {
  readonly source: GeodesicCannonObject;
  readonly incoming: GeodesicCannonObject;
  readonly carriedEmitterId: string;
}): GeodesicCannonObject {
  return input.carriedEmitterId === input.source.id ? input.source : input.incoming;
}

// Legacy: accepts the mover-reported portal transition only if it starts in the carried emitter's previous cell and ends in its current cell.
function resolveExplicitCarriedEmitterPortalTransition(input: {
  readonly carriedEmitterBeforeMove?: GeodesicCannonObject;
  readonly carriedEmitterPortalTransition?: GeodesicCarryPortalTransition;
  readonly source: GeodesicCannonObject;
  readonly incoming: GeodesicCannonObject;
  readonly carriedEmitterId: string;
}): GeodesicCarryPortalTransition | undefined {
  const previous = input.carriedEmitterBeforeMove;
  const current = getCarriedEmitter(input);
  const transition = input.carriedEmitterPortalTransition;
  if (!previous || !transition) {
    return undefined;
  }

  if (
    previous.cellId !== transition.sourceCellId ||
    current.cellId !== transition.targetCellId
  ) {
    return undefined;
  }

  return transition;
}

// Legacy: composes the portal transforms of a word, applying the first traversal first (result maps source-cell to last-target-cell
// coordinates). Traversals naming unknown portals are skipped silently.
function getExistingGeodesicPortalTransform(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  portalWord: readonly GeodesicPortalTraversal[] = collectGeodesicPortalWord(world, registry, geodesicId),
): RigidTransform3 | undefined {
  let transform = identityRigidTransform3;
  for (const traversal of portalWord) {
    const portal = world.cellsById.get(traversal.sourceCellId)?.portalsById.get(traversal.sourcePortalId);
    if (!portal) {
      continue;
    }

    transform = composeRigidTransform3(portal.transformToTarget, transform);
  }

  return transform;
}

// Legacy: true when the (horizontal) chord is long enough to draw a geodesic.
function isDrawableEndpointPair(sourcePoint: Vec3, incomingPointInSourceCell: Vec3): boolean {
  const centerDistanceMeters = Math.hypot(
    incomingPointInSourceCell.x - sourcePoint.x,
    incomingPointInSourceCell.y - sourcePoint.y,
  );
  return centerDistanceMeters - geodesicRayBeamStartOffsetMeters >= minGeodesicSegmentLengthMeters - intersectionTolerance;
}

// Legacy: replaces a connected geodesic's segments by traces whose tail is stretched to the exact chord length and forced to an `emitter-hit`
// terminal, then marks the connection. Returns undefined if the tail is too short or the traced tail did not end `open`.
function replaceConnectedGeodesicSegments(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly source: GeodesicCannonObject;
  readonly incomingEmitterId: string;
  readonly geodesicId: string;
  readonly totalLengthMeters: number;
  readonly traces: readonly TraceGeodesicSegmentResult[];
}): readonly GeodesicSegmentObject[] | undefined {
  if (input.traces.length === 0) {
    return undefined;
  }

  const previousLengthMeters = input.traces
    .slice(0, -1)
    .reduce((total, trace) => total + trace.lengthMeters, 0);
  const adjustedTailLengthMeters = input.totalLengthMeters - previousLengthMeters;
  if (adjustedTailLengthMeters < minGeodesicSegmentLengthMeters - intersectionTolerance) {
    return undefined;
  }

  const tail = input.traces.at(-1);
  if (!tail || tail.terminal.kind !== "open") {
    return undefined;
  }

  input.registry.update(input.source);
  removeGeodesicSegments(input.registry, input.geodesicId);
  const geodesicNumber = resolveGeodesicNumber(input.registry, input.geodesicId);
  for (const [index, trace] of input.traces.entries()) {
    const isTail = index === input.traces.length - 1;
    const segment = createSegmentFromTrace({
      id: `${input.geodesicId}:segment:${index}`,
      geodesicId: input.geodesicId,
      geodesicNumber,
      segmentIndex: index,
      trace: isTail
        ? {
            ...trace,
            lengthMeters: adjustedTailLengthMeters,
            terminal: { kind: "emitter-hit", emitterId: input.incomingEmitterId },
          }
        : trace,
    });
    input.registry.add(segment);
  }

  markGeodesicConnected(input.registry, input.geodesicId, input.source.id, input.incomingEmitterId);
  updateGeodesicIntersectionObjects(input.registry);
  return getGeodesicSegments(input.registry, input.geodesicId);
}

// Ids of all geodesics incident on an emitter, from interval attachments, the emitter's own caches, and legacy connection records of any cannon.
function collectIncidentGeodesicIdsForEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
): readonly string[] {
  const ids = new Set<string>();
  for (const attachment of getGeodesicEndpointAttachmentsForAnchor(registry, emitterId)) {
    ids.add(attachment.geodesicId);
  }
  const emitter = registry.get(emitterId);
  if (emitter?.kind === "geodesic-cannon") {
    for (const geodesicId of emitter.geodesicIds) {
      ids.add(geodesicId);
    }
    if (emitter.activeGeodesicId) {
      ids.add(emitter.activeGeodesicId);
    }
  }

  for (const object of registry.getAll()) {
    if (object.kind !== "geodesic-cannon") {
      continue;
    }
    for (const [geodesicId, connection] of Object.entries(object.geodesicConnectionsById ?? {})) {
      if (connection.outgoingEmitterId === emitterId || connection.incomingEmitterId === emitterId) {
        ids.add(geodesicId);
      }
    }
  }

  return [...ids];
}

// Legacy: the emitter at the other end of the given geodesic, relative to the detached emitter, using the connection record.
function resolveDetachedEndpoint(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  detachedEmitterId: string,
): { readonly emitter: GeodesicCannonObject } | undefined {
  const connection = getGeodesicConnection(registry, geodesicId);
  const otherEmitterId = connection?.outgoingEmitterId === detachedEmitterId
    ? connection.incomingEmitterId
    : connection?.incomingEmitterId === detachedEmitterId
      ? connection.outgoingEmitterId
      : undefined;
  const other = otherEmitterId ? registry.get(otherEmitterId) : undefined;
  return other?.kind === "geodesic-cannon" ? { emitter: other } : undefined;
}

// Legacy: builds a straight "straightening"-state segment between two points of one cell; terminal as given. Direction is horizontal-normalized.
function createStraighteningSegment(options: {
  readonly id: string;
  readonly geodesicId: string;
  readonly geodesicNumber?: number;
  readonly segmentIndex: number;
  readonly cellId: string;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly terminal: GeodesicSegmentTerminal;
}): GeodesicSegmentObject {
  const delta = subVec3(options.end, options.start);
  const lengthMeters = distanceVec3(options.start, options.end);
  const direction = normalizeHorizontalDirection(delta);
  return {
    id: options.id,
    kind: "geodesic-segment",
    cellId: options.cellId,
    localPose: yawRigidTransform3(Math.atan2(direction.y, direction.x), options.start),
    portalRenderable: true,
    displayHelpMessage: "A locally straight geodesic ray segment. Use the active tool to extend, measure, or select it.",
    tooltip: createGeodesicSegmentTooltip(options.geodesicNumber, "straightening"),
    geodesicId: options.geodesicId,
    geodesicNumber: options.geodesicNumber,
    segmentIndex: options.segmentIndex,
    start: options.start,
    direction,
    lengthMeters,
    terminal: options.terminal,
    connectionState: "straightening",
  };
}

// Legacy: records a straightening connection on both emitters and re-aims them along the polyline's end tangents.
function markStraighteningGeodesic(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  sourceEmitterId: string,
  incomingEmitterId: string,
): void {
  const source = registry.get(sourceEmitterId);
  const incoming = registry.get(incomingEmitterId);
  const segments = getGeodesicSegments(registry, geodesicId);
  const sourceYawRadians = segments[0]
    ? sanitizeYaw(Math.atan2(segments[0].direction.y, segments[0].direction.x))
    : undefined;
  const incomingTail = segments.at(-1);
  const incomingYawRadians = incomingTail
    ? sanitizeYaw(Math.atan2(incomingTail.direction.y, incomingTail.direction.x) + Math.PI)
    : undefined;
  if (source?.kind === "geodesic-cannon") {
    const sourcePose = sourceYawRadians === undefined
      ? source.localPose
      : yawRigidTransform3(sourceYawRadians, source.localPose.translation);
    registry.update({
      ...source,
      activeGeodesicId: geodesicId,
      aimYawRadians: sourceYawRadians ?? source.aimYawRadians,
      localPose: sourcePose,
      geodesicIds: source.geodesicIds.includes(geodesicId) ? source.geodesicIds : [...source.geodesicIds, geodesicId],
      geodesicEmitterYawRadiansById: sourceYawRadians === undefined
        ? source.geodesicEmitterYawRadiansById
        : {
            ...source.geodesicEmitterYawRadiansById,
            [geodesicId]: sourceYawRadians,
          },
      geodesicConnectionsById: {
        ...source.geodesicConnectionsById,
        [geodesicId]: {
          outgoingEmitterId: sourceEmitterId,
          incomingEmitterId,
          state: "straightening",
        },
      },
    });
  }
  if (incoming?.kind === "geodesic-cannon") {
    const incomingPose = incomingYawRadians === undefined
      ? incoming.localPose
      : yawRigidTransform3(incomingYawRadians, incoming.localPose.translation);
    registry.update({
      ...incoming,
      activeGeodesicId: geodesicId,
      aimYawRadians: incomingYawRadians ?? incoming.aimYawRadians,
      localPose: incomingPose,
      geodesicIds: incoming.geodesicIds.includes(geodesicId) ? incoming.geodesicIds : [...incoming.geodesicIds, geodesicId],
      geodesicEmitterYawRadiansById: incomingYawRadians === undefined
        ? incoming.geodesicEmitterYawRadiansById
        : {
            ...incoming.geodesicEmitterYawRadiansById,
            [geodesicId]: incomingYawRadians,
          },
    });
  }
}

function moveStraighteningVertex(options: {
  readonly start: Vec3;
  readonly vertex: Vec3;
  readonly end: Vec3;
  readonly maxStepMeters: number;
}): Vec3 | undefined {
  const lineDirection = normalizeHorizontalDirection(subVec3(options.end, options.start));
  const startToVertex = subVec3(options.vertex, options.start);
  const projectionMeters = startToVertex.x * lineDirection.x + startToVertex.y * lineDirection.y;
  const closest = addVec3(options.start, scaleVec3(lineDirection, projectionMeters));
  const distanceToLine = distanceVec3(closest, options.vertex);
  if (distanceToLine <= geodesicStraighteningToleranceMeters) {
    return undefined;
  }

  const towardStart = normalizeHorizontalDirection(subVec3(options.start, options.vertex));
  const towardEnd = normalizeHorizontalDirection(subVec3(options.end, options.vertex));
  const motion = normalizeHorizontalDirection(addVec3(towardStart, towardEnd));
  const stepMeters = Math.min(options.maxStepMeters, distanceToLine);
  const next = addVec3(options.vertex, scaleVec3(motion, stepMeters));
  const nextDistance = distanceVec3(closest, next);
  return nextDistance <= geodesicStraighteningToleranceMeters || nextDistance > distanceToLine
    ? undefined
    : next;
}

function straighteningHalfHitsForbiddenZone(world: CompiledCellComplex, segment: GeodesicSegmentObject): boolean {
  return straightSegmentHitsForbiddenZone(
    world,
    segment.cellId,
    segment.start,
    getGeodesicSegmentEnd(segment),
  );
}

function straightSegmentHitsForbiddenZone(
  world: CompiledCellComplex,
  cellId: string,
  start: Vec3,
  end: Vec3,
): boolean {
  const lengthMeters = distanceVec3(start, end);
  if (lengthMeters <= intersectionTolerance) {
    return false;
  }
  const trace = traceGeodesicSegment({
    world,
    cellId,
    start,
    direction: normalizeHorizontalDirection(subVec3(end, start)),
    maxLengthMeters: lengthMeters,
  });
  return trace.terminal.kind === "forbidden-zone-hit" &&
    trace.lengthMeters < lengthMeters - intersectionTolerance;
}

function lockStraightenedGeodesic(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly sourceEmitterId: string;
  readonly incomingEmitterId: string;
  readonly cellId: string;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly geodesicNumber?: number;
}): void {
  const duplicateGeodesicId = findCoincidentConnectedGeodesic(input.registry, {
    geodesicId: input.geodesicId,
    sourceEmitterId: input.sourceEmitterId,
    incomingEmitterId: input.incomingEmitterId,
    cellId: input.cellId,
    start: input.start,
    end: input.end,
  });
  if (duplicateGeodesicId) {
    removeGeodesic(input.registry, input.geodesicId);
    return;
  }

  removeGeodesicSegments(input.registry, input.geodesicId);
  const direction = normalizeHorizontalDirection(subVec3(input.end, input.start));
  input.registry.add({
    id: `${input.geodesicId}:segment:0`,
    kind: "geodesic-segment",
    cellId: input.cellId,
    localPose: yawRigidTransform3(Math.atan2(direction.y, direction.x), input.start),
    portalRenderable: true,
    tooltip: createGeodesicSegmentTooltip(input.geodesicNumber, "connected"),
    geodesicId: input.geodesicId,
    geodesicNumber: input.geodesicNumber,
    segmentIndex: 0,
    start: input.start,
    direction,
    lengthMeters: distanceVec3(input.start, input.end),
    terminal: { kind: "emitter-hit", emitterId: input.incomingEmitterId },
    connectionState: "connected",
  });
  markGeodesicConnected(input.registry, input.geodesicId, input.sourceEmitterId, input.incomingEmitterId);
}

function findCoincidentConnectedGeodesic(
  registry: RuntimeObjectRegistry,
  input: {
    readonly geodesicId: string;
    readonly sourceEmitterId: string;
    readonly incomingEmitterId: string;
    readonly cellId: string;
    readonly start: Vec3;
    readonly end: Vec3;
  },
): string | undefined {
  const candidateIds = new Set<string>();
  for (const object of registry.getAll()) {
    if (object.kind !== "geodesic-cannon") {
      continue;
    }

    for (const [geodesicId, connection] of Object.entries(object.geodesicConnectionsById ?? {})) {
      if (
        geodesicId !== input.geodesicId &&
        connection.state === "connected" &&
        sameEmitterPair(connection, input.sourceEmitterId, input.incomingEmitterId)
      ) {
        candidateIds.add(geodesicId);
      }
    }
  }

  for (const candidateId of candidateIds) {
    const segments = getGeodesicSegments(registry, candidateId);
    if (segments.length === 1 && segmentConnectsEndpoints(segments[0], input.cellId, input.start, input.end)) {
      return candidateId;
    }
  }

  return undefined;
}

function sameEmitterPair(
  connection: GeodesicEmitterConnection,
  firstEmitterId: string,
  secondEmitterId: string,
): boolean {
  return (
    connection.outgoingEmitterId === firstEmitterId &&
    connection.incomingEmitterId === secondEmitterId
  ) || (
    connection.outgoingEmitterId === secondEmitterId &&
    connection.incomingEmitterId === firstEmitterId
  );
}

function segmentConnectsEndpoints(
  segment: GeodesicSegmentObject,
  cellId: string,
  first: Vec3,
  second: Vec3,
): boolean {
  if (segment.cellId !== cellId) {
    return false;
  }

  const segmentEnd = getGeodesicSegmentEnd(segment);
  const toleranceSquared = geodesicStraighteningToleranceMeters * geodesicStraighteningToleranceMeters;
  return (
    distanceSquaredVec3(segment.start, first) <= toleranceSquared &&
    distanceSquaredVec3(segmentEnd, second) <= toleranceSquared
  ) || (
    distanceSquaredVec3(segment.start, second) <= toleranceSquared &&
    distanceSquaredVec3(segmentEnd, first) <= toleranceSquared
  );
}

function unfoldIncomingEmitterPointToSourceCell(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly sourceCellId: string;
  readonly incoming: GeodesicCannonObject;
}): Vec3 | undefined {
  if (input.incoming.cellId === input.sourceCellId) {
    return getGeodesicCannonEmitterPoint(input.incoming);
  }

  const transforms = getExistingPortalTransformsTowardCell({
    world: input.world,
    registry: input.registry,
    geodesicId: input.geodesicId,
    targetCellId: input.incoming.cellId,
  });
  if (!transforms) {
    return undefined;
  }

  let point = getGeodesicCannonEmitterPoint(input.incoming);
  for (const transform of transforms.slice().reverse()) {
    point = transformPoint3(invertRigidTransform3(transform), point);
  }
  return point;
}

function getExistingPortalTransformsTowardCell(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly targetCellId: string;
}): readonly RigidTransform3[] | undefined {
  const transforms: RigidTransform3[] = [];

  for (const segment of getGeodesicSegments(input.registry, input.geodesicId)) {
    if (segment.terminal.kind !== "portal-hit") {
      continue;
    }

    const cell = input.world.cellsById.get(segment.cellId);
    const portal = cell?.portalsById.get(segment.terminal.portalId);
    if (!portal) {
      return undefined;
    }

    transforms.push(portal.transformToTarget);
    if (segment.terminal.targetCellId === input.targetCellId) {
      return transforms;
    }
  }

  return undefined;
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

// ---- Intersections ----

/**
 * Recomputes all intersection markers (where segments of two different geodesics cross in a cell) and returns them.
 *
 * Existing markers are removed and re-added with ids preserved when a new marker pairs the same two geodesics in the same cell within
 * `vertexContinuityToleranceMeters` of an earlier one (identity continuity, so UI selections survive a moving crossing). Every call
 * is a full O(n^2) scan of all segments (TODO(issue 70): use a spatial index or per-cell buckets). Crossings within `emitterConnectionToleranceMeters` of an emitter are suppressed. Previously seen
 * markers stay in the per-registry memory (see `getRememberedGeodesicIntersectionObject`).
 */
export function updateGeodesicIntersectionObjects(registry: RuntimeObjectRegistry): readonly GeodesicIntersectionObject[] {
  const memory = getGeodesicIntersectionMemory(registry);
  const previous = new Map(memory);
  for (const object of registry.getAll()) {
    if (object.kind === "geodesic-intersection") {
      previous.set(object.id, object);
      registry.remove(object.id);
    }
  }

  const intersections = assignGeodesicIntersectionIdentities(findGeodesicIntersections(registry), previous);
  memory.clear();
  for (const intersection of intersections) {
    registry.add(intersection);
    memory.set(intersection.id, intersection);
  }
  for (const [id, intersection] of previous) {
    if (!memory.has(id)) {
      memory.set(id, intersection);
    }
  }

  return intersections;
}

/** Returns the last known intersection marker with this id even if it has since disappeared from the registry, or `undefined`. */
export function getRememberedGeodesicIntersectionObject(
  registry: RuntimeObjectRegistry,
  intersectionId: string,
): GeodesicIntersectionObject | undefined {
  return getGeodesicIntersectionMemory(registry).get(intersectionId);
}

/** Forgets remembered intersection markers that are no longer in the registry; returns the forgotten ids. */
export function pruneMissingGeodesicIntersectionObjects(registry: RuntimeObjectRegistry): readonly string[] {
  const memory = getGeodesicIntersectionMemory(registry);
  const prunedIds: string[] = [];
  for (const [id] of [...memory]) {
    if (registry.get(id)?.kind === "geodesic-intersection") {
      continue;
    }

    memory.delete(id);
    prunedIds.push(id);
  }

  return prunedIds;
}

// Builds one segment object from a trace; its `halfRole` is provisionally `"start"` and is overwritten by `splitDerivedSegmentsIntoEndpointHalves`.
// `connectionState` is `"connected"` only for an `emitter-hit` tail, otherwise `"open"`.
function createSegmentFromTrace(options: {
  readonly id: string;
  readonly geodesicId: string;
  readonly geodesicNumber?: number;
  readonly segmentIndex: number;
  readonly trace: TraceGeodesicSegmentResult;
}): GeodesicSegmentObject {
  const yaw = Math.atan2(options.trace.direction.y, options.trace.direction.x);
  const connectionState = options.trace.terminal.kind === "emitter-hit" ? "connected" : "open";

  return {
    id: options.id,
    kind: "geodesic-segment",
    cellId: options.trace.cellId,
    localPose: yawRigidTransform3(yaw, options.trace.start),
    portalRenderable: true,
    displayHelpMessage: "A locally straight geodesic ray segment. Use the active tool to extend, measure, or select it.",
    tooltip: createGeodesicSegmentTooltip(options.geodesicNumber, connectionState),
    geodesicId: options.geodesicId,
    geodesicNumber: options.geodesicNumber,
    segmentIndex: options.segmentIndex,
    halfRole: "start",
    start: options.trace.start,
    direction: options.trace.direction,
    lengthMeters: options.trace.lengthMeters,
    terminal: options.trace.terminal,
    connectionState,
  };
}

function createGeodesicSegmentTooltip(
  geodesicNumber: number | undefined,
  connectionState: "open" | "connected" | "straightening",
): GeodesicSegmentObject["tooltip"] {
  const label = geodesicNumber === undefined ? "Geodesic" : `Geodesic G${geodesicNumber}`;
  if (connectionState === "connected" || connectionState === "straightening") {
    return {
      label,
      rangeMeters: 6,
    };
  }

  return {
    label,
    rangeMeters: 6,
  };
}

// A cut point must leave at least the minimum length on BOTH sides within the segment.
function canSplitGeodesicSegmentAtDistance(
  segment: GeodesicSegmentObject,
  distanceAlongSegmentMeters: number,
): boolean {
  return canConnectGeodesicSegmentAtDistance(distanceAlongSegmentMeters) &&
    segment.lengthMeters - distanceAlongSegmentMeters >= minGeodesicSegmentLengthMeters - intersectionTolerance;
}

// A cut point must be at least the minimum length from the segment's start.
function canConnectGeodesicSegmentAtDistance(distanceAlongSegmentMeters: number): boolean {
  return distanceAlongSegmentMeters >= minGeodesicSegmentLengthMeters - intersectionTolerance;
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

// Signed distance of the orthogonal projection of `point` onto the segment's line, measured from the segment start (meters).
function distanceAlongSegment(segment: GeodesicSegmentObject, point: Vec3): number {
  const dx = point.x - segment.start.x;
  const dy = point.y - segment.start.y;
  const dz = point.z - segment.start.z;
  return dx * segment.direction.x + dy * segment.direction.y + dz * segment.direction.z;
}

// Arc length from the start of the geodesic to the point `distanceAlongSegmentMeters` inside `targetSegment`.
function totalLengthThroughSegment(
  segments: readonly GeodesicSegmentObject[],
  targetSegment: GeodesicSegmentObject,
  distanceAlongSegmentMeters: number,
): number {
  return segments
    .filter((segment) => segment.segmentIndex < targetSegment.segmentIndex)
    .reduce((total, segment) => total + segment.lengthMeters, 0) + distanceAlongSegmentMeters;
}

function totalGeodesicLengthFromSegments(segments: readonly GeodesicSegmentObject[]): number {
  return segments.reduce((total, segment) => total + segment.lengthMeters, 0);
}

// Removes all derived segments of a geodesic and refreshes intersection markers (so it is also a minor O(n^2) cost).
function removeGeodesicSegments(registry: RuntimeObjectRegistry, geodesicId: string): void {
  for (const segment of getGeodesicSegments(registry, geodesicId)) {
    registry.remove(segment.id);
  }
  updateGeodesicIntersectionObjects(registry);
}

function removeGeodesicAssociations(registry: RuntimeObjectRegistry, geodesicId: string): void {
  for (const object of registry.getAll()) {
    if (object.kind !== "geodesic-cannon") {
      continue;
    }
    removeGeodesicAssociationFromEmitter(registry, object.id, geodesicId);
  }
}

// Removes the geodesic id from the emitter's caches (id list, active id, yaw and connection records). No-op when it holds nothing.
function removeGeodesicAssociationFromEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
  geodesicId: string,
): void {
  const object = registry.get(emitterId);
  if (object?.kind !== "geodesic-cannon") {
    return;
  }
  const hasYaw = geodesicId in (object.geodesicEmitterYawRadiansById ?? {});
  const hasConnection = geodesicId in (object.geodesicConnectionsById ?? {});
  if (
    !object.geodesicIds.includes(geodesicId) &&
    object.activeGeodesicId !== geodesicId &&
    !hasYaw &&
    !hasConnection
  ) {
    return;
  }

  const { [geodesicId]: _removedYaw, ...remainingYaws } = object.geodesicEmitterYawRadiansById ?? {};
  const { [geodesicId]: _removedConnection, ...remainingConnections } = object.geodesicConnectionsById ?? {};
  const geodesicIds = object.geodesicIds.filter((id) => id !== geodesicId);
  registry.update({
    ...object,
    activeGeodesicId: object.activeGeodesicId === geodesicId ? geodesicIds[0] : object.activeGeodesicId,
    geodesicIds,
    geodesicEmitterYawRadiansById: remainingYaws,
    geodesicConnectionsById: remainingConnections,
  });
}

// Legacy: marks a non-interval geodesic as connected between two emitters: aligns each emitter's yaw with the geodesic's end tangents,
// records `"connected"` connection state on the source (and the shared one if source and incoming coincide), and relabels all segments.
function markGeodesicConnected(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  sourceEmitterId: string,
  incomingEmitterId: string,
): void {
  const source = registry.get(sourceEmitterId);
  const incoming = registry.get(incomingEmitterId);
  const head = getGeodesicSegments(registry, geodesicId)[0];
  const tail = getGeodesicTail(registry, geodesicId);
  const sourceYawRadians = head
    ? sanitizeYaw(Math.atan2(head.direction.y, head.direction.x))
    : undefined;
  const incomingYawRadians = tail
    ? sanitizeYaw(Math.atan2(tail.direction.y, tail.direction.x) + Math.PI)
    : undefined;

  if (source?.kind === "geodesic-cannon" && incoming?.kind === "geodesic-cannon" && source.id === incoming.id) {
    registry.update({
      ...source,
      geodesicIds: source.geodesicIds.includes(geodesicId)
        ? source.geodesicIds
        : [...source.geodesicIds, geodesicId],
      geodesicEmitterYawRadiansById: {
        ...source.geodesicEmitterYawRadiansById,
        [geodesicId]: source.geodesicEmitterYawRadiansById?.[geodesicId] ?? incomingYawRadians ?? source.aimYawRadians,
      },
      geodesicConnectionsById: {
        ...source.geodesicConnectionsById,
        [geodesicId]: {
          outgoingEmitterId: sourceEmitterId,
          incomingEmitterId,
          state: "connected",
        },
      },
    });
    for (const segment of getGeodesicSegments(registry, geodesicId)) {
      registry.update({
        ...segment,
        tooltip: createGeodesicSegmentTooltip(segment.geodesicNumber, "connected"),
        connectionState: "connected",
      });
    }
    return;
  }

  if (source?.kind === "geodesic-cannon") {
    const sourcePose = sourceYawRadians === undefined
      ? source.localPose
      : yawRigidTransform3(sourceYawRadians, source.localPose.translation);
    registry.update({
      ...source,
      activeGeodesicId: geodesicId,
      aimYawRadians: sourceYawRadians ?? source.aimYawRadians,
      localPose: sourcePose,
      geodesicIds: source.geodesicIds.includes(geodesicId)
        ? source.geodesicIds
        : [...source.geodesicIds, geodesicId],
      geodesicEmitterYawRadiansById: sourceYawRadians === undefined
        ? source.geodesicEmitterYawRadiansById
        : {
            ...source.geodesicEmitterYawRadiansById,
            [geodesicId]: sourceYawRadians,
          },
      geodesicConnectionsById: {
        ...source.geodesicConnectionsById,
        [geodesicId]: {
          outgoingEmitterId: sourceEmitterId,
          incomingEmitterId,
          state: "connected",
        },
      },
    });
  }

  if (incoming?.kind === "geodesic-cannon") {
    const incomingPose = incomingYawRadians === undefined
      ? incoming.localPose
      : yawRigidTransform3(incomingYawRadians, incoming.localPose.translation);
    registry.update({
      ...incoming,
      activeGeodesicId: geodesicId,
      aimYawRadians: incomingYawRadians ?? incoming.aimYawRadians,
      localPose: incomingPose,
      geodesicIds: incoming.geodesicIds.includes(geodesicId)
        ? incoming.geodesicIds
        : [...incoming.geodesicIds, geodesicId],
      geodesicEmitterYawRadiansById: incomingYawRadians === undefined
        ? incoming.geodesicEmitterYawRadiansById
        : {
            ...incoming.geodesicEmitterYawRadiansById,
            [geodesicId]: incomingYawRadians,
          },
    });
  }

  for (const segment of getGeodesicSegments(registry, geodesicId)) {
    registry.update({
      ...segment,
      tooltip: createGeodesicSegmentTooltip(segment.geodesicNumber, "connected"),
      connectionState: "connected",
    });
  }
}

// Legacy: finds the emitter that owns a non-interval geodesic, preferring the recorded outgoing connection, then yaw record,
// then active id, then any listing.
function findSourceEmitterForGeodesic(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): GeodesicCannonObject | undefined {
  for (const object of registry.getAll()) {
    if (object.kind !== "geodesic-cannon") {
      continue;
    }
    const connection = object.geodesicConnectionsById?.[geodesicId];
    if (connection?.outgoingEmitterId === object.id) {
      return object;
    }
  }

  return registry.getAll().find((object): object is GeodesicCannonObject =>
    object.kind === "geodesic-cannon" &&
    object.geodesicIds.includes(geodesicId) &&
    object.geodesicEmitterYawRadiansById?.[geodesicId] !== undefined
  ) ?? registry.getAll().find((object): object is GeodesicCannonObject =>
    object.kind === "geodesic-cannon" && object.activeGeodesicId === geodesicId
  ) ?? registry.getAll().find((object): object is GeodesicCannonObject =>
    object.kind === "geodesic-cannon" && object.geodesicIds.includes(geodesicId)
  );
}

// Pairwise crossing search over all segments in the registry (O(n^2)). Only segments of different geodesics in the same cell count;
// a crossing at an emitter is dropped, and duplicates (same rounded point and geodesic pair) are removed. Segments in different cells
// never intersect here, even if they are adjacent through a portal.
function findGeodesicIntersections(registry: RuntimeObjectRegistry): readonly GeodesicIntersectionObject[] {
  const segments = registry.getAll().filter(isGeodesicSegmentObject);
  const intersections: GeodesicIntersectionObject[] = [];
  const seenKeys = new Set<string>();
  const lastSegmentIndexByGeodesic = new Map<string, number>();
  for (const segment of segments) {
    lastSegmentIndexByGeodesic.set(
      segment.geodesicId,
      Math.max(lastSegmentIndexByGeodesic.get(segment.geodesicId) ?? 0, segment.segmentIndex),
    );
  }

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex];
      const right = segments[rightIndex];
      if (left.cellId !== right.cellId) {
        continue;
      }
      // Adjacent segments of one geodesic share an endpoint; only pairs two or more apart can cross.
      if (left.geodesicId === right.geodesicId && Math.abs(left.segmentIndex - right.segmentIndex) < 2) {
        continue;
      }

      const intersection = intersectHorizontalSegments(left, right);
      if (!intersection) {
        continue;
      }
      if (
        crossingIsAtGeodesicAnchor(left, intersection.leftT, intersection.leftLengthMeters, lastSegmentIndexByGeodesic) ||
        crossingIsAtGeodesicAnchor(right, intersection.rightT, intersection.rightLengthMeters, lastSegmentIndexByGeodesic)
      ) {
        continue;
      }

      const pointKey = `${left.cellId}:${intersection.point.x.toFixed(5)}:${intersection.point.y.toFixed(5)}`;
      const sortedGeodesicIds = [left.geodesicId, right.geodesicId].sort();
      const geodesicIds: [string, string] = [sortedGeodesicIds[0], sortedGeodesicIds[1]];
      const key = `${pointKey}:${geodesicIds.join(":")}`;
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      intersections.push(createGeodesicIntersectionObject({
        id: createGeodesicIntersectionId(left.cellId, geodesicIds, intersection.point),
        cellId: left.cellId,
        balloonPoint: {
          x: intersection.point.x,
          y: intersection.point.y,
          z: geodesicRayBeamHeightMeters + geodesicIntersectionBalloonHeightOffsetMeters,
        },
        targetPoint: intersection.point,
        geodesicIds: [geodesicIds[0], geodesicIds[1]],
        segmentIds: [left.id, right.id],
      }));
    }
  }

  return intersections;
}

// True when a crossing lies within 1e-6 m of the geodesic's anchor: the start of its first segment or the end of its last one.
// Geodesics that share an emitter meet there and that meeting is not a vertex.
function crossingIsAtGeodesicAnchor(
  segment: GeodesicSegmentObject,
  t: number,
  lengthMeters: number,
  lastSegmentIndexByGeodesic: ReadonlyMap<string, number>,
): boolean {
  const toleranceT = lengthMeters > 0 ? geodesicAnchorCrossingToleranceMeters / lengthMeters : 1;
  if (segment.segmentIndex === 0 && t <= toleranceT) {
    return true;
  }

  return segment.segmentIndex === (lastSegmentIndexByGeodesic.get(segment.geodesicId) ?? 0) && t >= 1 - toleranceT;
}

function assignGeodesicIntersectionIdentities(
  intersections: readonly GeodesicIntersectionObject[],
  previousById: ReadonlyMap<string, GeodesicIntersectionObject>,
): readonly GeodesicIntersectionObject[] {
  const usedPreviousIds = new Set<string>();
  return intersections.map((intersection) => {
    const match = findContinuityMatchedIntersection(intersection, previousById, usedPreviousIds);
    if (!match) {
      return intersection;
    }

    usedPreviousIds.add(match.id);
    return {
      ...intersection,
      id: match.id,
    };
  });
}

// Matches a fresh marker to the nearest unused previous marker of the same cell and geodesic pair within `vertexContinuityToleranceMeters`.
function findContinuityMatchedIntersection(
  intersection: GeodesicIntersectionObject,
  previousById: ReadonlyMap<string, GeodesicIntersectionObject>,
  usedPreviousIds: ReadonlySet<string>,
): GeodesicIntersectionObject | undefined {
  let best: { readonly object: GeodesicIntersectionObject; readonly distance: number } | undefined;
  for (const previous of previousById.values()) {
    if (
      usedPreviousIds.has(previous.id) ||
      previous.cellId !== intersection.cellId ||
      !sameGeodesicPair(previous.geodesicIds, intersection.geodesicIds)
    ) {
      continue;
    }

    const distance = distanceBetweenIntersectionTargets(previous, intersection);
    if (distance > vertexContinuityToleranceMeters || (best && distance >= best.distance)) {
      continue;
    }

    best = { object: previous, distance };
  }

  return best?.object;
}

function sameGeodesicPair(left: readonly [string, string], right: readonly [string, string]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function distanceBetweenIntersectionTargets(left: GeodesicIntersectionObject, right: GeodesicIntersectionObject): number {
  const leftPoint = left.aimStickyTarget?.localPoint ?? left.localPose.translation;
  const rightPoint = right.aimStickyTarget?.localPoint ?? right.localPose.translation;
  return Math.sqrt(distanceSquaredVec3(leftPoint, rightPoint));
}

function createGeodesicIntersectionId(
  cellId: string,
  geodesicIds: readonly [string, string],
  point: Vec3,
): string {
  return `geodesic-intersection:${sanitizeIdPart(
    `${cellId}:${geodesicIds.join(":")}:${point.x.toFixed(5)}:${point.y.toFixed(5)}`,
  )}`;
}

function getGeodesicIntersectionMemory(registry: RuntimeObjectRegistry): Map<string, GeodesicIntersectionObject> {
  let memory = geodesicIntersectionMemoryByRegistry.get(registry);
  if (!memory) {
    memory = new Map();
    geodesicIntersectionMemoryByRegistry.set(registry, memory);
  }

  return memory;
}

function createGeodesicIntersectionObject(options: {
  readonly id: string;
  readonly cellId: string;
  readonly balloonPoint: Vec3;
  readonly targetPoint: Vec3;
  readonly geodesicIds: readonly [string, string];
  readonly segmentIds: readonly [string, string];
}): GeodesicIntersectionObject {
  return {
    id: options.id,
    kind: "geodesic-intersection",
    cellId: options.cellId,
    localPose: yawRigidTransform3(0, options.balloonPoint),
    aimStickyTarget: {
      localPoint: options.targetPoint,
    },
    portalRenderable: true,
    displayHelpMessage: "A geodesic vertex. Use the protractor tool to select sides incident to this point.",
    tooltip: {
      label: "vertex",
      rangeMeters: 3,
    },
    geodesicIds: options.geodesicIds,
    segmentIds: options.segmentIds,
  };
}

// Intersection of two finite horizontal segments P = L + s r, Q = R + u q (s, u in [0, 1]): with w = R - L,
// s = (w x q) / (r x q) and u = (w x r) / (r x q). Parallel (including collinear) segments are reported as non-intersecting.
// z of the result is the left segment's start height.
function intersectHorizontalSegments(
  left: GeodesicSegmentObject,
  right: GeodesicSegmentObject,
): {
  readonly point: Vec3;
  /** Position along the left / right segment in [0, 1] and the segments' lengths in meters. */
  readonly leftT: number;
  readonly rightT: number;
  readonly leftLengthMeters: number;
  readonly rightLengthMeters: number;
} | undefined {
  const leftEnd = getGeodesicSegmentEnd(left);
  const rightEnd = getGeodesicSegmentEnd(right);
  const rx = leftEnd.x - left.start.x;
  const ry = leftEnd.y - left.start.y;
  const sx = rightEnd.x - right.start.x;
  const sy = rightEnd.y - right.start.y;
  const denominator = crossXY(rx, ry, sx, sy);

  if (Math.abs(denominator) <= intersectionTolerance) {
    return undefined;
  }

  const dx = right.start.x - left.start.x;
  const dy = right.start.y - left.start.y;
  const leftT = crossXY(dx, dy, sx, sy) / denominator;
  const rightT = crossXY(dx, dy, rx, ry) / denominator;

  if (
    leftT < -intersectionTolerance ||
    leftT > 1 + intersectionTolerance ||
    rightT < -intersectionTolerance ||
    rightT > 1 + intersectionTolerance
  ) {
    return undefined;
  }

  return {
    point: {
      x: left.start.x + rx * Math.min(1, Math.max(0, leftT)),
      y: left.start.y + ry * Math.min(1, Math.max(0, leftT)),
      z: left.start.z,
    },
    leftT: Math.min(1, Math.max(0, leftT)),
    rightT: Math.min(1, Math.max(0, rightT)),
    leftLengthMeters: Math.hypot(rx, ry),
    rightLengthMeters: Math.hypot(sx, sy),
  };
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, "_");
}

// Assigns display numbers: already numbered segments keep theirs; the remaining ids (cannon lists, segments, intervals, then the requested id)
// get the smallest unused positive integers in encounter order. Pure function of the registry, recomputed on every call.
function getGlobalGeodesicNumbers(
  registry: RuntimeObjectRegistry,
  requestedGeodesicId: string,
): ReadonlyMap<string, number> {
  const numbersById = new Map<string, number>();
  const usedNumbers = new Set<number>();
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const numberedSegments = registry.getAll()
    .filter(isGeodesicSegmentObject)
    .filter((segment) => segment.geodesicNumber !== undefined)
    .sort((left, right) => left.geodesicNumber! - right.geodesicNumber!);

  for (const segment of numberedSegments) {
    if (!numbersById.has(segment.geodesicId) && segment.geodesicNumber !== undefined) {
      numbersById.set(segment.geodesicId, segment.geodesicNumber);
      usedNumbers.add(segment.geodesicNumber);
    }
    pushUniqueId(ids, seenIds, segment.geodesicId);
  }

  for (const object of registry.getAll()) {
    if (object.kind === "geodesic-cannon") {
      for (const geodesicId of object.geodesicIds) {
        pushUniqueId(ids, seenIds, geodesicId);
      }
      if (object.activeGeodesicId) {
        pushUniqueId(ids, seenIds, object.activeGeodesicId);
      }
    } else if (object.kind === "geodesic-segment") {
      pushUniqueId(ids, seenIds, object.geodesicId);
    } else if (object.kind === "geodesic-interval") {
      pushUniqueId(ids, seenIds, object.id);
    }
  }

  pushUniqueId(ids, seenIds, requestedGeodesicId);
  let nextNumber = 1;
  for (const geodesicId of ids) {
    if (numbersById.has(geodesicId)) {
      continue;
    }

    while (usedNumbers.has(nextNumber)) {
      nextNumber += 1;
    }
    numbersById.set(geodesicId, nextNumber);
    usedNumbers.add(nextNumber);
  }

  return numbersById;
}

function pushUniqueId(ids: string[], seenIds: Set<string>, geodesicId: string): void {
  if (seenIds.has(geodesicId)) {
    return;
  }

  seenIds.add(geodesicId);
  ids.push(geodesicId);
}

function radiansToDegrees(radians: number): number {
  return Number(((radians * 180) / Math.PI).toFixed(3));
}

export {
  canExtendGeodesicSegment,
  createCurveShorteningPairObject,
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  type CreateGeodesicCannonOptions,
  createGeodesicIntervalObject,
  type CurveShorteningPairObject,
  type FreeGeodesicEndObject,
  GEODESIC_MIN_LENGTH_METERS,
  type GeodesicCannonObject,
  type GeodesicCarryPortalTransition,
  type GeodesicEmitterConnection,
  type GeodesicEndpointAttachment,
  type GeodesicEndpointSelection,
  type GeodesicEndRole,
  type GeodesicHalfRole,
  type GeodesicIntersectionObject,
  type GeodesicIntervalObject,
  type GeodesicPortalTraversal,
  geodesicRayBeamHeightMeters,
  geodesicRayBeamStartOffsetMeters,
  type GeodesicSegmentObject,
  type GeodesicSegmentTerminal,
  type GeodesicTraceBuildResult,
  getGeodesicSegmentEnd,
  isCurveShorteningPairObject,
  isFreeGeodesicEndObject,
  isGeodesicCannonObject,
  isGeodesicIntersectionObject,
  isGeodesicIntervalObject,
  isGeodesicSegmentObject,
  type LiftedGeodesicEndpoint,
  minGeodesicSegmentLengthMeters,
  type PlaceGeodesicCannonResult,
  resolveGeodesicCannonAimYawRadians,
  type TraceGeodesicSegmentResult,
} from "./geodesic/objects";

export {
  applyAnchorCrossingTraversals,
  getPortalWordBetweenEndpointRoles,
  reverseGeodesicPortalWord,
} from "./geodesic/portalWord";

export {
  findNearestEmitterHitOnTrace,
  geodesicTerminalFromWalkPiece,
  traceGeodesicSegment,
  type TraceGeodesicSegmentInput,
  traceGeodesicSegmentWithEmitters,
  type TraceGeodesicSegmentWithEmittersInput,
} from "./geodesic/trace";
