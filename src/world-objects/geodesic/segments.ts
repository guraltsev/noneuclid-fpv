/**
 * Derived geodesic segments: lookup by geodesic, building segments from traces with the start/end half split, lengths, tangents at anchors, display numbers and the emitter-side caches.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { addVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../runtimeObjectRegistry";
import {
  type GeodesicEndRole,
  type GeodesicHalfRole,
  type GeodesicIntervalObject,
  type GeodesicPortalTraversal,
  type GeodesicSegmentObject,
  intersectionTolerance,
  minGeodesicSegmentLengthMeters,
  sanitizeYaw,
  type TraceGeodesicSegmentResult,
} from "./objects";
import { updateGeodesicIntersectionObjects } from "./intersections";
import {
  getGeodesicEndpointAttachmentsForAnchor,
  getGeodesicPortalWord,
  removeGeodesicAssociations,
  removeUnusedFreeGeodesicEnds,
} from "./endpoints";

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
  const doomed: RuntimeWorldObject[] = [];
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesic-interval") {
    doomed.push(interval);
  }
  for (const object of registry.getObjectsOfKind("measured-geodesic-length")) {
    if (object.geodesicId === geodesicId) {
      doomed.push(object);
    }
  }
  for (const object of registry.getObjectsOfKind("protractor-angle")) {
    if (object.first.geodesicId === geodesicId || object.second.geodesicId === geodesicId) {
      doomed.push(object);
    }
  }
  for (const object of registry.getObjectsOfKind("geodesic-intersection")) {
    if (object.geodesicIds.includes(geodesicId)) {
      doomed.push(object);
    }
  }
  for (const object of doomed) {
    registry.remove(object.id);
  }
  removeGeodesicAssociations(registry, geodesicId);
  removeUnusedFreeGeodesicEnds(registry);
  updateGeodesicIntersectionObjects(registry);
}

// ---- Derived-segment and connection queries ----

/** Returns the derived segments of a geodesic sorted by `segmentIndex` (empty if none). */
export function getGeodesicSegments(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly GeodesicSegmentObject[] {
  return [...registry.getSegmentsOfGeodesic(geodesicId)].sort((a, b) => a.segmentIndex - b.segmentIndex);
}

/** Returns the last (highest `segmentIndex`) segment of a geodesic, or `undefined` if it has none. */
export function getGeodesicTail(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): GeodesicSegmentObject | undefined {
  return getGeodesicSegments(registry, geodesicId).at(-1);
}

/** Returns the 1-based display number of a geodesic, defaulting to 1 when it has none. */
export function resolveGeodesicNumber(registry: RuntimeObjectRegistry, geodesicId: string): number {
  for (const segment of registry.getSegmentsOfGeodesic(geodesicId)) {
    if (segment.geodesicNumber !== undefined) {
      return segment.geodesicNumber;
    }
  }
  return getGlobalGeodesicNumbers(registry, geodesicId).get(geodesicId) ?? 1;
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

/** Re-labels the tail of a trace as an emitter hit when the interval ends on an emitter. */
export function withAnchoredTargetTerminal(
  registry: RuntimeObjectRegistry,
  interval: GeodesicIntervalObject,
  traces: readonly TraceGeodesicSegmentResult[],
): readonly TraceGeodesicSegmentResult[] {
  return withAnchoredTargetTerminalForAnchors(registry, interval, traces);
}

// When the end anchor is an emitter and the trace simply ran out (`open`), relabels the last piece as `emitter-hit`, since
// by construction the chord ends exactly at that emitter.
/** Like `withAnchoredTargetTerminal`, with candidate anchors that may differ from the registry. */
export function withAnchoredTargetTerminalForAnchors(
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
/** Replaces the derived segments of an interval by segments built from traces. */
export function replaceDerivedSegmentsFromTraces(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly traces: readonly TraceGeodesicSegmentResult[];
}): readonly GeodesicSegmentObject[] {
  // Resolve the display number before the old segments go, so a rebuilt geodesic keeps its number.
  const geodesicNumber = resolveGeodesicNumber(input.registry, input.geodesicId);
  removeGeodesicSegments(input.registry, input.geodesicId);
  const splitSegments = buildDerivedSegmentsFromTraces({ ...input, geodesicNumber });
  for (const segment of splitSegments) {
    input.registry.add(segment);
  }
  return splitSegments;
}

// Pure counterpart of `replaceDerivedSegmentsFromTraces`: converts traces to segment objects (ids `<geodesicId>:segment:<i>`),
// splits them at the length midpoint into start/end halves, and stamps connection state and tooltip. Nothing is added to the registry.
/** Builds, without side effects, the derived segments of an interval from traces. */
export function buildDerivedSegmentsFromTraces(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly geodesicId: string;
  readonly traces: readonly TraceGeodesicSegmentResult[];
  /** Display number to use; resolved from the registry when absent. */
  readonly geodesicNumber?: number;
}): readonly GeodesicSegmentObject[] {
  const geodesicNumber = input.geodesicNumber ?? resolveGeodesicNumber(input.registry, input.geodesicId);
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
  const pinned = (kind: string | undefined): boolean => kind === "geodesic-cannon" || kind === "geodesic-corner";
  return pinned(start?.kind) && pinned(end?.kind) ? "connected" : "open";
}

/** Converts a derived segment back to the trace piece it was built from. */
export function segmentToTrace(segment: GeodesicSegmentObject): TraceGeodesicSegmentResult {
  return {
    cellId: segment.cellId,
    start: segment.start,
    direction: segment.direction,
    lengthMeters: segment.lengthMeters,
    terminal: segment.terminal,
  };
}

/** Total length of a geodesic, the sum over its derived segments, in meters. */
export function getGeodesicTotalLengthMeters(registry: RuntimeObjectRegistry, geodesicId: string): number {
  return getGeodesicSegments(registry, geodesicId)
    .reduce((total, segment) => total + segment.lengthMeters, 0);
}

// Refreshes the emitter-side caches (`geodesicIds`, `activeGeodesicId`, per-geodesic yaw) from the interval: each emitter endpoint
// lists the geodesic and records the tangent yaw at its anchor. The registry attachments remain the source of truth.
/** Updates the menu caches of an emitter from the geodesic intervals that attach to it. */
export function syncLegacyEmitterGeodesicFields(registry: RuntimeObjectRegistry, geodesicId: string): void {
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

// Builds one segment object from a trace; its `halfRole` is provisionally `"start"` and is overwritten by `splitDerivedSegmentsIntoEndpointHalves`.
// `connectionState` is `"connected"` only for an `emitter-hit` tail, otherwise `"open"`.
/** Creates a derived segment object from one trace piece. */
export function createSegmentFromTrace(options: {
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

/** Tooltip text of a derived segment. */
export function createGeodesicSegmentTooltip(
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

// A cut point must be at least the minimum length from the segment's start.
/** True when a point at the given distance along a segment can be connected to. */
export function canConnectGeodesicSegmentAtDistance(distanceAlongSegmentMeters: number): boolean {
  return distanceAlongSegmentMeters >= minGeodesicSegmentLengthMeters - intersectionTolerance;
}

// Signed distance of the orthogonal projection of `point` onto the segment's line, measured from the segment start (meters).
/** Signed distance of the projection of a point onto a segment's line, from the segment start. */
export function distanceAlongSegment(segment: GeodesicSegmentObject, point: Vec3): number {
  const dx = point.x - segment.start.x;
  const dy = point.y - segment.start.y;
  const dz = point.z - segment.start.z;
  return dx * segment.direction.x + dy * segment.direction.y + dz * segment.direction.z;
}

// Arc length from the start of the geodesic to the point `distanceAlongSegmentMeters` inside `targetSegment`.
/** Arc length from the start of the geodesic to a point inside the given segment. */
export function totalLengthThroughSegment(
  segments: readonly GeodesicSegmentObject[],
  targetSegment: GeodesicSegmentObject,
  distanceAlongSegmentMeters: number,
): number {
  return segments
    .filter((segment) => segment.segmentIndex < targetSegment.segmentIndex)
    .reduce((total, segment) => total + segment.lengthMeters, 0) + distanceAlongSegmentMeters;
}

/** Sum of the lengths of the given segments, in meters. */
export function totalGeodesicLengthFromSegments(segments: readonly GeodesicSegmentObject[]): number {
  return segments.reduce((total, segment) => total + segment.lengthMeters, 0);
}

// Removes all derived segments of a geodesic and refreshes intersection markers (so it is also a minor O(n^2) cost).
/** Removes all derived segments of a geodesic and refreshes the intersection markers. */
export function removeGeodesicSegments(registry: RuntimeObjectRegistry, geodesicId: string): void {
  for (const segment of getGeodesicSegments(registry, geodesicId)) {
    registry.remove(segment.id);
  }
  updateGeodesicIntersectionObjects(registry);
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
  const numberedSegments = [...registry.getObjectsOfKind("geodesic-segment")]
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
