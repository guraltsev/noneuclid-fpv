/**
 * Interval rebuilds: realizing an interval's lifted chord, aiming free geodesics, splitting at a segment hit, rebuilding locked intervals after a carried anchor moved, and side-effect-free previews.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { transformPoint3, yawRigidTransform3 } from "../../math/rigidTransform3";
import { addVec3, distanceSquaredVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../runtimeObjectRegistry";
import {
  canObjectAttachGeodesics,
  createGeodesicIntervalObject,
  directionFromYaw,
  emitterConnectionToleranceMeters,
  type FreeGeodesicEndObject,
  GEODESIC_MIN_LENGTH_METERS,
  type GeodesicCannonObject,
  type GeodesicCarryPortalTransition,
  type GeodesicEndRole,
  type GeodesicIntervalObject,
  type GeodesicPortalTraversal,
  type GeodesicTraceBuildResult,
  getGeodesicCannonEmitterPoint,
  getOppositeEndRole,
  intersectionTolerance,
  isFreeGeodesicEndObject,
  type LiftedGeodesicEndpoint,
  minGeodesicSegmentLengthMeters,
  type TraceGeodesicSegmentResult,
} from "./objects";
import {
  applyAnchorCrossingTraversals,
  collectPortalWordFromTraces,
  portalTraversalFromCarryTransition,
  portalWordAfterAnchorCrossing,
  reduceAdjacentInversePortalTraversals,
  samePortalWord,
} from "./portalWord";
import { traceGeodesicPathForConnectionMode, traceTerminalToBuildTerminal } from "./trace";
import { requestGeodesicIntersectionUpdate, withDeferredGeodesicIntersections } from "./intersections";
import {
  getGeodesicEndpointAttachmentsForAnchor,
  isAimableFreeGeodesic,
  liftGeodesicEndpointWithAnchors,
  portalWordMatchesCurrentEndpointCells,
  removeUnusedFreeGeodesicEnds,
  replaceGeodesicEndpointAttachment,
} from "./endpoints";
import {
  buildDerivedSegmentsFromTraces,
  canConnectGeodesicSegmentAtDistance,
  getGeodesicSegments,
  removeGeodesicIntervalAndDerivedObjects,
  replaceDerivedSegmentsFromTraces,
  segmentToTrace,
  syncLegacyEmitterGeodesicFields,
  totalGeodesicLengthFromSegments,
  totalLengthThroughSegment,
  withAnchoredTargetTerminal,
  withAnchoredTargetTerminalForAnchors,
} from "./segments";

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
  return withDeferredGeodesicIntersections(input.registry, () => traceGeodesicFromLiftedChordNow(input));
}

function traceGeodesicFromLiftedChordNow(input: Parameters<typeof traceGeodesicFromLiftedChord>[0]): GeodesicTraceBuildResult | undefined {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval" || input.lengthMeters < minGeodesicSegmentLengthMeters) {
    return undefined;
  }
  const classified = traceAndClassifyChord({
    world: input.world,
    registry: input.registry,
    interval,
    sourceCellId: input.sourceCellId,
    sourcePoint: input.sourcePoint,
    yawRadians: input.yawRadians,
    lengthMeters: input.lengthMeters,
    expectedPortalWord: input.expectedPortalWord,
    allowUnexpectedPortalWord: input.allowUnexpectedPortalWord,
  });
  if (classified.kind !== "ok") {
    return undefined;
  }
  return commitRealizedTraces(input.registry, interval, classified.traces);
}

/**
 * Outcome of tracing the chord of one interval exactly once (see {@link realizeIntervalChord}).
 *
 * `ok`: the chord crosses the stored portal word and meets no wall or forbidden zone; `lifted` is the lifted endpoint it follows.
 * `lift-failed`: the endpoints cannot be lifted (missing anchors, inconsistent word, unknown portal). `degenerate`: the lifted chord is
 * shorter than `GEODESIC_MIN_LENGTH_METERS`. `zone`: some piece ends in a forbidden zone (this wins over the other failures).
 * `wall`: some piece ends at a wall. `word-mismatch`: the chord realizes a different portal word. The failing kinds carry the traces.
 */
export type IntervalChordRealization =
  | { readonly kind: "ok"; readonly lifted: LiftedGeodesicEndpoint; readonly traces: readonly TraceGeodesicSegmentResult[] }
  | { readonly kind: "lift-failed" }
  | { readonly kind: "degenerate"; readonly lengthMeters: number }
  | { readonly kind: "zone"; readonly junctionId: string; readonly traces: readonly TraceGeodesicSegmentResult[] }
  | { readonly kind: "wall"; readonly sideIndex: number; readonly traces: readonly TraceGeodesicSegmentResult[] }
  | {
      readonly kind: "word-mismatch";
      readonly realizedWord: readonly GeodesicPortalTraversal[];
      readonly traces: readonly TraceGeodesicSegmentResult[];
    };

/**
 * Lifts the interval's far endpoint into its start cell and traces the straight chord exactly once, without touching the registry.
 *
 * The one place where a chord is lifted, traced and classified; previews, rebuilds and the locked-carry rebuild are built on it, so a
 * chord is never traced twice, also when it fails. Anchors in `candidateAnchorsById` shadow the registry. The realized word must equal the
 * stored word unless `allowUnexpectedPortalWord`.
 */
export function realizeIntervalChord(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
  readonly allowUnexpectedPortalWord?: boolean;
}): IntervalChordRealization {
  const lifted = liftGeodesicEndpointWithAnchors({
    world: input.world,
    registry: input.registry,
    interval: input.interval,
    sourceRole: "start",
    candidateAnchorsById: input.candidateAnchorsById,
  });
  if (!lifted) {
    return { kind: "lift-failed" };
  }
  // Chord of the development: direction yaw = atan2(dy, dx) and length = |(dx, dy)| (horizontal; heights are equal by construction).
  // A chord shorter than the minimum means the endpoints (essentially) coincide in the development.
  const dx = lifted.targetPointInSourceCell.x - lifted.sourcePoint.x;
  const dy = lifted.targetPointInSourceCell.y - lifted.sourcePoint.y;
  const lengthMeters = Math.hypot(dx, dy);
  if (lengthMeters < GEODESIC_MIN_LENGTH_METERS - intersectionTolerance) {
    return { kind: "degenerate", lengthMeters };
  }
  const classified = traceAndClassifyChord({
    world: input.world,
    registry: input.registry,
    interval: input.interval,
    sourceCellId: lifted.sourceCellId,
    sourcePoint: lifted.sourcePoint,
    yawRadians: Math.atan2(dy, dx),
    lengthMeters,
    expectedPortalWord: lifted.portalWordFromSourceToTarget,
    allowUnexpectedPortalWord: input.allowUnexpectedPortalWord,
  });
  return classified.kind === "ok" ? { kind: "ok", lifted, traces: classified.traces } : classified;
}

// Traces one chord (a single call of the tracer) and classifies it: a forbidden-zone hit anywhere, else a wall hit, else a realized word
// different from the expected one (unless allowed), else ok. Emitter connection is disabled (the chord already encodes the endpoint), so
// the interval's start anchor is only used for bookkeeping.
function traceAndClassifyChord(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicIntervalObject;
  readonly sourceCellId: string;
  readonly sourcePoint: Vec3;
  readonly yawRadians: number;
  readonly lengthMeters: number;
  readonly expectedPortalWord?: readonly GeodesicPortalTraversal[];
  readonly allowUnexpectedPortalWord?: boolean;
}):
  | { readonly kind: "ok"; readonly traces: readonly TraceGeodesicSegmentResult[] }
  | Exclude<IntervalChordRealization, { readonly kind: "ok" | "lift-failed" | "degenerate" }> {
  const traces = traceGeodesicPathForConnectionMode({
    connectEmitters: false,
    world: input.world,
    registry: input.registry,
    geodesicId: input.interval.id,
    sourceEmitterId: input.interval.start.anchorObjectId,
    cellId: input.sourceCellId,
    start: input.sourcePoint,
    direction: directionFromYaw(input.yawRadians),
    maxLengthMeters: input.lengthMeters,
  });
  for (const trace of traces) {
    if (trace.terminal.kind === "forbidden-zone-hit") {
      return { kind: "zone", junctionId: trace.terminal.junctionId, traces };
    }
  }
  for (const trace of traces) {
    if (trace.terminal.kind === "wall-hit") {
      return { kind: "wall", sideIndex: trace.terminal.sideIndex, traces };
    }
  }
  // Homotopy check: the straight chord must cross exactly the portals of the stored word, else it realizes a different class and is refused.
  const realizedWord = collectPortalWordFromTraces(input.world, traces);
  if (
    input.expectedPortalWord && !input.allowUnexpectedPortalWord &&
    !samePortalWord(realizedWord, input.expectedPortalWord)
  ) {
    return { kind: "word-mismatch", realizedWord, traces };
  }
  return { kind: "ok", traces };
}

// Commit: replaces the interval's segments by the traces (an `open` last piece becomes `emitter-hit` if the end anchor is an emitter).
function commitRealizedTraces(
  registry: RuntimeObjectRegistry,
  interval: GeodesicIntervalObject,
  traces: readonly TraceGeodesicSegmentResult[],
): GeodesicTraceBuildResult {
  const realizedTraces = withAnchoredTargetTerminal(registry, interval, traces);
  const segments = replaceDerivedSegmentsFromTraces({ registry, geodesicId: interval.id, traces: realizedTraces });
  return {
    interval,
    segments,
    terminal: traceTerminalToBuildTerminalForInterval(interval, realizedTraces.at(-1), registry),
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
  return withDeferredGeodesicIntersections(input.registry, () => aimFreeGeodesicFromEndpointNow(input));
}

function aimFreeGeodesicFromEndpointNow(input: Parameters<typeof aimFreeGeodesicFromEndpoint>[0]): GeodesicTraceBuildResult | undefined {
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
      requestGeodesicIntersectionUpdate(input.registry);
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
  requestGeodesicIntersectionUpdate(input.registry);
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
  return rebuildDerivedGeodesicSegmentsDetailed(input).result;
}

/**
 * Like `rebuildDerivedGeodesicSegments`, and also returns how the chord was realized, so a caller can tell why a rebuild failed
 * (for example a forbidden-zone hit) without tracing the chord again. `realization` is `undefined` when `geodesicId` is not an interval;
 * `result` is `undefined` unless the realization is `ok`. A `degenerate` realization deletes the interval, as in the plain function.
 */
export function rebuildDerivedGeodesicSegmentsDetailed(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly allowUnexpectedPortalWord?: boolean;
}): {
  readonly realization: IntervalChordRealization | undefined;
  readonly result: GeodesicTraceBuildResult | undefined;
} {
  return withDeferredGeodesicIntersections(input.registry, () => {
    const interval = input.registry.get(input.geodesicId);
    if (interval?.kind !== "geodesic-interval") {
      return { realization: undefined, result: undefined };
    }
    const realization = realizeIntervalChord({
      world: input.world,
      registry: input.registry,
      interval,
      allowUnexpectedPortalWord: input.allowUnexpectedPortalWord,
    });
    if (realization.kind === "degenerate") {
      // The endpoints coincide in the development: the geodesic is degenerate, so the interval and everything derived from it is DELETED.
      removeGeodesicIntervalAndDerivedObjects(input.registry, input.geodesicId);
    }
    return {
      realization,
      result: realization.kind === "ok" ? commitRealizedTraces(input.registry, interval, realization.traces) : undefined,
    };
  });
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
  return withDeferredGeodesicIntersections(input.registry, () => splitGeodesicIntervalAtSegmentHitNow(input));
}

function splitGeodesicIntervalAtSegmentHitNow(input: Parameters<typeof splitGeodesicIntervalAtSegmentHit>[0]): readonly GeodesicIntervalObject[] {
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
  requestGeodesicIntersectionUpdate(input.registry);
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
  return rebuildLockedGeodesicFromEndpointsAndPortalWordDetailed(input).result;
}

/**
 * Like `rebuildLockedGeodesicFromEndpointsAndPortalWord`, and also returns how the chord was realized (`undefined` when `geodesicId` is
 * not an interval), so that the caller can tell a forbidden-zone failure from the other failures without tracing the chord again.
 */
export function rebuildLockedGeodesicFromEndpointsAndPortalWordDetailed(
  input: Parameters<typeof rebuildLockedGeodesicFromEndpointsAndPortalWord>[0],
): ReturnType<typeof rebuildDerivedGeodesicSegmentsDetailed> {
  return withDeferredGeodesicIntersections(input.registry, () => rebuildLockedGeodesicDetailedNow(input));
}

function rebuildLockedGeodesicDetailedNow(
  input: Parameters<typeof rebuildLockedGeodesicFromEndpointsAndPortalWord>[0],
): ReturnType<typeof rebuildDerivedGeodesicSegmentsDetailed> {
  const interval = input.registry.get(input.geodesicId);
  if (interval?.kind !== "geodesic-interval") {
    return { realization: undefined, result: undefined };
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
  const rebuilt = rebuildDerivedGeodesicSegmentsDetailed({
    ...input,
    allowUnexpectedPortalWord: input.allowOutOfBoundsCarriedEndpoint,
  });
  if (rebuilt.result) {
    syncLegacyEmitterGeodesicFields(input.registry, input.geodesicId);
    requestGeodesicIntersectionUpdate(input.registry);
  }
  return rebuilt;
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
}): GeodesicIntervalPreview | undefined {
  // The realized path must cross exactly the stored word; a wall hit or zone hit anywhere along the way also rejects the preview.
  const realization = realizeIntervalChord({
    world: input.world,
    registry: input.registry,
    interval: input.interval,
    candidateAnchorsById: input.candidateAnchorsById,
  });
  if (realization.kind !== "ok") {
    return undefined;
  }
  const realizedTraces = withAnchoredTargetTerminalForAnchors(
    input.registry,
    input.interval,
    realization.traces,
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
    traces: realizedTraces,
  };
}

/** A previewed interval: the build result plus the traces it was built from, so that a caller can commit them without tracing again. */
export interface GeodesicIntervalPreview extends GeodesicTraceBuildResult {
  /** The realized traces (last piece relabelled as `emitter-hit` where the end anchor is an emitter). */
  readonly traces: readonly TraceGeodesicSegmentResult[];
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
