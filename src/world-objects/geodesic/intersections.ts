/**
 * Geodesic intersection markers: crossings of segments in the same cell, stable marker identities between updates, and the per-registry marker memory.
 */
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { crossXY } from "../../math/vec2";
import { distanceSquaredVec3, type Vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import {
  type GeodesicCrossingObject,
  geodesicRayBeamHeightMeters,
  type GeodesicSegmentObject,
  getGeodesicSegmentEnd,
  intersectionTolerance,
} from "./objects";

/** Maximum distance (meters) between two geodesic points for them to count as one vertex when placing at a vertex; deliberately generous. */
const vertexContinuityToleranceMeters = 10;

/** Distance (meters) from a geodesic's anchor within which a crossing counts as the anchor itself and is not reported. */
const geodesicAnchorCrossingToleranceMeters = 1e-6;

/** Extra height (meters) above the beam at which an intersection marker is placed. */
const geodesicIntersectionBalloonHeightOffsetMeters = 0.25;

/**
 * Per-registry memory of intersection markers so ids remain stable while two segments keep crossing.
 * It is keyed by the registry's change journal, not by the registry object: with the module write guard on, a tick holds a copy of the registry that shares the journal.
 */
const geodesicIntersectionMemoryByRegistry = new WeakMap<object, Map<string, GeodesicCrossingObject>>();

// ---- Intersections ----

/**
 * Recomputes all intersection markers (where segments of two different geodesics cross in a cell) and returns them.
 *
 * Existing markers are removed and re-added with ids preserved when a new marker pairs the same two geodesics in the same cell within
 * `vertexContinuityToleranceMeters` of an earlier one (identity continuity, so UI selections survive a moving crossing). Segments are compared
 * per cell. Previously seen markers stay in the per-registry memory, which gives a marker back its id.
 */
export function updateGeodesicIntersectionObjects(registry: RuntimeObjectRegistry): readonly GeodesicCrossingObject[] {
  const memory = getGeodesicIntersectionMemory(registry);
  const previous = new Map(memory);
  for (const object of registry.getObjectsOfKind("geodesicModel/crossing")) {
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

/** Returns the last known intersection marker with this id even if it has since disappeared from the registry, or `undefined`. The geodesic model forgets a vanished marker at its next pass: this tells what vanished in the pass that just ran. */
export function getRememberedGeodesicIntersectionObject(
  registry: RuntimeObjectRegistry,
  intersectionId: string,
): GeodesicCrossingObject | undefined {
  return getGeodesicIntersectionMemory(registry).get(intersectionId);
}

/**
 * The crossing of `geodesicIds` in the cell nearest `point`, within the tolerance a marker keeps its identity over, or `undefined`.
 * What gives a crossing back to something that points at it after the memory is gone: its id is not real state, and a marker that returns after more than one pass, or a marker rebuilt after a load, has a new one.
 */
export function findGeodesicIntersectionNear(
  registry: RuntimeObjectRegistry,
  options: { readonly cellId: string; readonly geodesicIds: readonly string[]; readonly point: Vec3 },
): GeodesicCrossingObject | undefined {
  let best: GeodesicCrossingObject | undefined;
  let bestDistance = vertexContinuityToleranceMeters;
  for (const crossing of registry.getObjectsOfKind("geodesicModel/crossing")) {
    if (crossing.cellId !== options.cellId || !options.geodesicIds.every((id) => crossing.geodesicIds.includes(id))) continue;
    const distance = Math.sqrt(distanceSquaredVec3(crossing.aimStickyTarget?.localPoint ?? crossing.localPose.translation, options.point));
    if (distance <= bestDistance) {
      best = crossing;
      bestDistance = distance;
    }
  }
  return best;
}

/** Forgets remembered intersection markers that are no longer in the registry; returns the forgotten ids. */
export function pruneMissingGeodesicIntersectionObjects(registry: RuntimeObjectRegistry): readonly string[] {
  const memory = getGeodesicIntersectionMemory(registry);
  const prunedIds: string[] = [];
  for (const [id] of [...memory]) {
    if (registry.get(id)?.kind === "geodesicModel/crossing") {
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
function findGeodesicIntersections(registry: RuntimeObjectRegistry): readonly GeodesicCrossingObject[] {
  const segments = registry.getObjectsOfKind("geodesicModel/segment");
  const intersections: GeodesicCrossingObject[] = [];
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
        intersections.push(createGeodesicCrossingObject({
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
  intersections: readonly GeodesicCrossingObject[],
  previousById: ReadonlyMap<string, GeodesicCrossingObject>,
): readonly GeodesicCrossingObject[] {
  const previousByKey = new Map<string, GeodesicCrossingObject[]>();
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
function identityMatchKey(intersection: GeodesicCrossingObject): string {
  return `${intersection.cellId}|${intersection.geodesicIds[0]}|${intersection.geodesicIds[1]}`;
}

// Matches a fresh marker to the nearest unused previous marker (from the list of the same cell and geodesic pair) within `vertexContinuityToleranceMeters`.
function findContinuityMatchedIntersection(
  intersection: GeodesicCrossingObject,
  candidates: readonly GeodesicCrossingObject[],
  usedPreviousIds: ReadonlySet<string>,
): GeodesicCrossingObject | undefined {
  let best: { readonly object: GeodesicCrossingObject; readonly distance: number } | undefined;
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
function distanceBetweenIntersectionTargets(left: GeodesicCrossingObject, right: GeodesicCrossingObject): number {
  const leftPoint = left.aimStickyTarget?.localPoint ?? left.localPose.translation;
  const rightPoint = right.aimStickyTarget?.localPoint ?? right.localPose.translation;
  return Math.sqrt(distanceSquaredVec3(leftPoint, rightPoint));
}

function createGeodesicIntersectionId(
  cellId: string,
  geodesicIds: readonly [string, string],
  point: Vec3,
): string {
  return `geodesicModel/crossing:${sanitizeIdPart(
    `${cellId}:${geodesicIds.join(":")}:${point.x.toFixed(5)}:${point.y.toFixed(5)}`,
  )}`;
}

function getGeodesicIntersectionMemory(registry: RuntimeObjectRegistry): Map<string, GeodesicCrossingObject> {
  let memory = geodesicIntersectionMemoryByRegistry.get(registry.changes);
  if (!memory) {
    memory = new Map();
    geodesicIntersectionMemoryByRegistry.set(registry.changes, memory);
  }

  return memory;
}

function createGeodesicCrossingObject(options: {
  readonly id: string;
  readonly cellId: string;
  readonly balloonPoint: Vec3;
  readonly targetPoint: Vec3;
  readonly geodesicIds: readonly [string, string];
  readonly segmentIds: readonly [string, string];
}): GeodesicCrossingObject {
  return {
    id: options.id,
    kind: "geodesicModel/crossing",
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
