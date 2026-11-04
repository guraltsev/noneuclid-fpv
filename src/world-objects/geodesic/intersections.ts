/**
 * Geodesic intersection markers: crossings of segments in the same cell, stable marker identities between updates, and the per-registry marker memory.
 */
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { crossXY } from "../../math/vec2";
import { distanceSquaredVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import {
  type GeodesicIntersectionObject,
  geodesicRayBeamHeightMeters,
  type GeodesicSegmentObject,
  getGeodesicSegmentEnd,
  intersectionTolerance,
} from "./objects";
import { geodesicPerfCounters } from "./perfCounters";

/** Maximum distance (meters) between two geodesic points for them to count as one vertex when placing at a vertex; deliberately generous. */
const vertexContinuityToleranceMeters = 10;

/** Distance (meters) from a geodesic's anchor within which a crossing counts as the anchor itself and is not reported. */
const geodesicAnchorCrossingToleranceMeters = 1e-6;

/** Extra height (meters) above the beam at which an intersection marker is placed. */
const geodesicIntersectionBalloonHeightOffsetMeters = 0.25;

/** Per-registry memory of intersection markers so ids remain stable while two segments keep crossing. */
const geodesicIntersectionMemoryByRegistry = new WeakMap<RuntimeObjectRegistry, Map<string, GeodesicIntersectionObject>>();

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
  for (const object of registry.getObjectsOfKind("geodesic-intersection")) {
    previous.set(object.id, object);
    registry.remove(object.id);
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

/** Per-registry deferral state: how many scopes are open and whether a request arrived inside them. */
const geodesicIntersectionDeferralByRegistry = new WeakMap<RuntimeObjectRegistry, { depth: number; dirty: boolean }>();

/**
 * Marks the intersection markers stale and recomputes them now, unless a deferral scope is open for this registry
 * (see `withDeferredGeodesicIntersections`), in which case the recomputation happens once when the outermost scope exits.
 */
export function requestGeodesicIntersectionUpdate(registry: RuntimeObjectRegistry): void {
  const state = geodesicIntersectionDeferralByRegistry.get(registry);
  if (state && state.depth > 0) {
    state.dirty = true;
    return;
  }
  updateGeodesicIntersectionObjects(registry);
}

/**
 * Runs `body`; every `requestGeodesicIntersectionUpdate` inside it (also from nested scopes) is coalesced into one
 * `updateGeodesicIntersectionObjects` when the outermost scope exits, also when `body` throws. Markers are therefore
 * current again whenever the outermost scope has returned, but may be stale inside it.
 */
export function withDeferredGeodesicIntersections<T>(registry: RuntimeObjectRegistry, body: () => T): T {
  let state = geodesicIntersectionDeferralByRegistry.get(registry);
  if (!state) {
    state = { depth: 0, dirty: false };
    geodesicIntersectionDeferralByRegistry.set(registry, state);
  }
  state.depth += 1;
  try {
    return body();
  } finally {
    state.depth -= 1;
    if (state.depth === 0 && state.dirty) {
      state.dirty = false;
      updateGeodesicIntersectionObjects(registry);
    }
  }
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

// Pairwise crossing search inside each cell (cost: the sum over cells of n_c^2). Only segments of different geodesics in the same cell
// count; a crossing at an emitter is dropped, and duplicates (same rounded point and geodesic pair) are removed. Segments in different
// cells never intersect here, even if they are adjacent through a portal: a crossing exactly on a portal side is reported once, in the
// cell the geodesics enter (see `crossingIsAtGeodesicAnchor`).
function findGeodesicIntersections(registry: RuntimeObjectRegistry): readonly GeodesicIntersectionObject[] {
  geodesicPerfCounters.intersectionPasses += 1;
  const segments = registry.getObjectsOfKind("geodesic-segment");
  const intersections: GeodesicIntersectionObject[] = [];
  const seenKeys = new Set<string>();
  const lastSegmentIndexByGeodesic = new Map<string, number>();
  const segmentsByCellId = new Map<string, GeodesicSegmentObject[]>();
  for (const segment of segments) {
    lastSegmentIndexByGeodesic.set(
      segment.geodesicId,
      Math.max(lastSegmentIndexByGeodesic.get(segment.geodesicId) ?? 0, segment.segmentIndex),
    );
    const bucket = segmentsByCellId.get(segment.cellId);
    if (bucket) {
      bucket.push(segment);
    } else {
      segmentsByCellId.set(segment.cellId, [segment]);
    }
  }

  for (const bucket of segmentsByCellId.values()) {
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = bucket[leftIndex];
        const right = bucket[rightIndex];
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
  }

  return intersections;
}

// True when a crossing is not reported for this segment: it lies within 1e-6 m of the geodesic's anchor (the start of its first segment or
// the end of its last one; geodesics that share an emitter meet there and that meeting is not a vertex), or at the end of a segment that
// continues through a portal (the continuation in the target cell starts at the same point and reports the crossing there).
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
  if (segment.terminal.kind === "portal-hit" && t >= 1 - toleranceT) {
    return true;
  }

  return segment.segmentIndex === (lastSegmentIndexByGeodesic.get(segment.geodesicId) ?? 0) && t >= 1 - toleranceT;
}

function assignGeodesicIntersectionIdentities(
  intersections: readonly GeodesicIntersectionObject[],
  previousById: ReadonlyMap<string, GeodesicIntersectionObject>,
): readonly GeodesicIntersectionObject[] {
  const previousByKey = new Map<string, GeodesicIntersectionObject[]>();
  for (const previous of previousById.values()) {
    const key = identityMatchKey(previous);
    const list = previousByKey.get(key);
    if (list) {
      list.push(previous);
    } else {
      previousByKey.set(key, [previous]);
    }
  }
  const usedPreviousIds = new Set<string>();
  return intersections.map((intersection) => {
    const match = findContinuityMatchedIntersection(
      intersection,
      previousByKey.get(identityMatchKey(intersection)) ?? [],
      usedPreviousIds,
    );
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

// Previous markers can only be matched by a fresh marker of the same cell and geodesic pair.
function identityMatchKey(intersection: GeodesicIntersectionObject): string {
  return `${intersection.cellId}|${intersection.geodesicIds[0]}|${intersection.geodesicIds[1]}`;
}

// Matches a fresh marker to the nearest unused previous marker (from the list of the same cell and geodesic pair) within `vertexContinuityToleranceMeters`.
function findContinuityMatchedIntersection(
  intersection: GeodesicIntersectionObject,
  candidates: readonly GeodesicIntersectionObject[],
  usedPreviousIds: ReadonlySet<string>,
): GeodesicIntersectionObject | undefined {
  let best: { readonly object: GeodesicIntersectionObject; readonly distance: number } | undefined;
  for (const previous of candidates) {
    if (usedPreviousIds.has(previous.id)) {
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
