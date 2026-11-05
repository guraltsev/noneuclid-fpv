/**
 * Derived geodesic segments: lookup by geodesic, building segments from traces with the start/end half split, lengths, tangents at anchors and display numbers.
 */
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { addVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../runtimeObjectRegistry";
import {
  type GeodesicCannonObject,
  type GeodesicEndRole,
  type GeodesicHalfRole,
  type GeodesicArcObject,
  type GeodesicPortalTraversal,
  type GeodesicSegmentObject,
  intersectionTolerance,
  minGeodesicSegmentLengthMeters,
  sanitizeYaw,
  type TraceGeodesicSegmentResult,
} from "./objects";
import { requestGeodesicIntersectionUpdate, withDeferredGeodesicIntersections } from "./intersections";
import {
  getGeodesicPortalWord,
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
  withDeferredGeodesicIntersections(registry, () => removeGeodesicIntervalAndDerivedObjectsNow(registry, geodesicId));
}

function removeGeodesicIntervalAndDerivedObjectsNow(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): void {
  removeGeodesicSegments(registry, geodesicId);
  const doomed: RuntimeWorldObject[] = [];
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesicModel/arc") {
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
  for (const object of registry.getObjectsOfKind("geodesicModel/crossing")) {
    if (object.geodesicIds.includes(geodesicId)) {
      doomed.push(object);
    }
  }
  for (const object of doomed) {
    registry.remove(object.id);
  }
  removeUnusedFreeGeodesicEnds(registry);
  requestGeodesicIntersectionUpdate(registry);
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

/** Returns the 1-based display number of a geodesic: its arc's `geodesicNumber`, or 1 (an arc without one exists only in test fixtures). Only reads. */
export function resolveGeodesicNumber(registry: RuntimeObjectRegistry, geodesicId: string): number {
  const arc = registry.get(geodesicId);
  return arc?.kind === "geodesicModel/arc" ? arc.geodesicNumber ?? 1 : 1;
}

/** The smallest positive integer not used as a `geodesicNumber` by any arc. Scans the arcs; call it once per shot or split. */
export function nextGeodesicNumber(registry: RuntimeObjectRegistry): number {
  const used = new Set<number>();
  for (const arc of registry.getObjectsOfKind("geodesicModel/arc")) {
    if (arc.geodesicNumber !== undefined) {
      used.add(arc.geodesicNumber);
    }
  }
  let next = 1;
  while (used.has(next)) {
    next += 1;
  }
  return next;
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
  if (interval?.kind !== "geodesicModel/arc") {
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
 * Launch yaw (radians, in the emitter's cell frame) of a geodesic at an emitter: the tangent of the geodesic where it attaches to the
 * emitter, or the emitter's default `aimYawRadians` when the geodesic has no segments yet (or does not attach to it).
 */
export function resolveEmitterLaunchYaw(
  registry: RuntimeObjectRegistry,
  emitter: GeodesicCannonObject,
  geodesicId: string,
): number {
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesicModel/arc") {
    for (const endRole of ["start", "end"] as const) {
      if (interval[endRole].anchorObjectId === emitter.id) {
        const tangent = resolveEndpointTangentAtAnchor({ registry, geodesicId, endRole });
        if (tangent) {
          return tangent.yawRadians;
        }
      }
    }
  }
  return sanitizeYaw(emitter.aimYawRadians);
}

/** Re-labels the tail of a trace as an emitter hit when the interval ends on an emitter. */
export function withAnchoredTargetTerminal(
  registry: RuntimeObjectRegistry,
  interval: GeodesicArcObject,
  traces: readonly TraceGeodesicSegmentResult[],
): readonly TraceGeodesicSegmentResult[] {
  return withAnchoredTargetTerminalForAnchors(registry, interval, traces);
}

// When the end anchor is an emitter and the trace simply ran out (`open`), relabels the last piece as `emitter-hit`, since
// by construction the chord ends exactly at that emitter.
/** Like `withAnchoredTargetTerminal`, with candidate anchors that may differ from the registry. */
export function withAnchoredTargetTerminalForAnchors(
  registry: RuntimeObjectRegistry,
  interval: GeodesicArcObject,
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
      tooltip: createGeodesicSegmentTooltip(segment.geodesicNumber),
    }));
  return splitSegments;
}

// Display state of a geodesic's segments: `"connected"` for an arc whose two ends are on emitters, else `"open"` (a tied arc
// is drawn open). An id that is not an interval is `"open"`.
function resolveDerivedSegmentConnectionState(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): "open" | "connected" {
  const interval = registry.get(geodesicId);
  if (interval?.kind !== "geodesicModel/arc") {
    return "open";
  }
  const start = registry.get(interval.start.anchorObjectId);
  const end = registry.get(interval.end.anchorObjectId);
  return start?.kind === "geodesic-cannon" && end?.kind === "geodesic-cannon" ? "connected" : "open";
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

/** Returns the stored portal word of an interval geodesic; `[]` for unknown ids or geodesics that never cross a portal. */
export function collectGeodesicPortalWord(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): readonly GeodesicPortalTraversal[] {
  return getGeodesicPortalWord(registry, geodesicId) ?? [];
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
    kind: "geodesicModel/segment",
    cellId: options.trace.cellId,
    localPose: yawRigidTransform3(yaw, options.trace.start),
    portalRenderable: true,
    displayHelpMessage: "A locally straight geodesic ray segment. Use the active tool to extend, measure, or select it.",
    tooltip: createGeodesicSegmentTooltip(options.geodesicNumber),
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
export function createGeodesicSegmentTooltip(geodesicNumber: number | undefined): GeodesicSegmentObject["tooltip"] {
  const label = geodesicNumber === undefined ? "Geodesic" : `Geodesic G${geodesicNumber}`;
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
  requestGeodesicIntersectionUpdate(registry);
}
