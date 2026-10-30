/**
 * Legacy: the retired emitter-connection and same-cell straightening model; only the importers listed in `scripts/docs/lib.mjs` (`moduleImportRules`) may import it, and job 26 deletes it.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  yawRigidTransform3,
  type RigidTransform3,
} from "../../math/rigidTransform3";
import { addVec3, distanceSquaredVec3, distanceVec3, scaleVec3, subVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import {
  directionFromYaw,
  type GeodesicCannonObject,
  type GeodesicCarryPortalTransition,
  type GeodesicEmitterConnection,
  type GeodesicPortalTraversal,
  geodesicRayBeamStartOffsetMeters,
  type GeodesicSegmentObject,
  type GeodesicSegmentTerminal,
  getGeodesicCannonEmitterPoint,
  getGeodesicSegmentEnd,
  intersectionTolerance,
  isGeodesicSegmentObject,
  minGeodesicSegmentLengthMeters,
  normalizeHorizontalDirection,
  sanitizeYaw,
  type TraceGeodesicSegmentResult,
} from "./objects";
import type { RebuildConnectedGeodesicBetweenEmittersRequest } from "./cannon";
import { traceGeodesicPathForConnectionMode, traceGeodesicSegment } from "./trace";
import { updateGeodesicIntersectionObjects } from "./intersections";
import { collectIncidentGeodesicIdsForEmitter, getGeodesicEndpointAttachmentsForAnchor } from "./endpoints";
import {
  collectGeodesicPortalWord,
  createGeodesicSegmentTooltip,
  createSegmentFromTrace,
  getGeodesicSegments,
  getGeodesicTail,
  removeGeodesicSegments,
  resolveGeodesicNumber,
} from "./segments";
import { collectLockedIncidentGeodesicIdsForEmitter, getGeodesicConnection, isGeodesicLocked, removeGeodesic } from "./lifecycle";
import { advanceCurveShorteningPairs, tieAndDetachGeodesicEndpoints } from "./curveShortening";

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

/** Legacy: request for `advanceStraighteningGeodesics`; same shape as `AdvanceCurveShorteningPairsRequest` without the debug sink. */
export interface AdvanceStraighteningGeodesicsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  readonly speedMetersPerSecond?: number;
}

/** Legacy: default speed (m/s) of the retired same-cell straightening model. */
export const geodesicStraighteningSpeedMetersPerSecond = 0.4;

/** Legacy: distance (meters) at which the retired straightening model considers a geodesic straight. */
const geodesicStraighteningToleranceMeters = 0.01;

/** Legacy: true when the geodesic (or any segment) is in the retired `"straightening"` connection state. */
export function isGeodesicStraightening(registry: RuntimeObjectRegistry, geodesicId: string): boolean {
  if (getGeodesicConnection(registry, geodesicId)?.state === "straightening") {
    return true;
  }

  return getGeodesicSegments(registry, geodesicId).some((segment) => segment.connectionState === "straightening");
}

/** Legacy: true when any geodesic incident on the emitter is in the retired straightening state. */
export function hasStraighteningIncidentGeodesic(registry: RuntimeObjectRegistry, emitterId: string): boolean {
  return collectIncidentGeodesicIdsForEmitter(registry, emitterId)
    .some((geodesicId) => isGeodesicStraightening(registry, geodesicId));
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

// Legacy: marks a non-interval geodesic as connected between two emitters: aligns each emitter's yaw with the geodesic's end tangents,
// records `"connected"` connection state on the source (and the shared one if source and incoming coincide), and relabels all segments.
/** Records `"connected"` connection state on the source emitter's geodesic (legacy connection model). */
export function markGeodesicConnected(
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

/**
 * Legacy: rebuilds a non-interval connected geodesic between two emitters. The incoming emitter is unfolded into the source cell,
 * the source is re-aimed at it and the chord is retraced; a chord shorter than `minGeodesicSegmentLengthMeters` deletes the geodesic
 * unless an emitter is being carried (then the old segments stay). Extracted verbatim from `rebuildConnectedGeodesicBetweenEmitters`.
 */
export function rebuildLegacyConnectedGeodesic(
  request: RebuildConnectedGeodesicBetweenEmittersRequest,
): readonly GeodesicSegmentObject[] {
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
