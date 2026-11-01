/**
 * Curve shortening: tie-and-detach of two endpoint roles into a curve-shortening pair, and the curve shortening flow that then runs over many frames.
 * Tying detaches two endpoint roles of an emitter onto a shared free end F without changing the geometry. The curve is then a piecewise-geodesic chain of
 * moving intervals; each `advanceCurveShorteningPairs` tick moves every free vertex along the descent direction of the total length (the sum of its two
 * arcs' unit tangents) with an exact line search, re-realizes the neighbouring arcs as geodesic chords of their portal words, and removes a vertex when
 * its turning angle is below a tolerance. The vertex count never grows (no vertex is inserted), the total length never grows, and the registry is the
 * current curve at every tick. When no free vertex is left the curve is stable. Failures change nothing except marking the pair `"unresolved"`.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { walkDevelopedSegment } from "../../cell-complex/segmentWalk";
import { transformPoint3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../runtimeObjectRegistry";
import { createCurveShorteningPairObject, createFreeGeodesicEndObject, createGeodesicIntervalObject, type CurveShorteningPairObject, GEODESIC_MIN_LENGTH_METERS, type GeodesicEndpointSelection, type GeodesicEndRole, type GeodesicIntervalObject, type GeodesicPortalTraversal, type GeodesicSegmentObject, getGeodesicCannonEmitterPoint, getOppositeEndRole, reduceAdjacentInversePortalTraversals, type TraceGeodesicSegmentResult } from "./objects";
import { canObjectAttachGeodesics } from "./anchors";
import { getPortalWordBetweenEndpointRoles, reverseGeodesicPortalWord, samePortalWord } from "./portalWord";
import { requestGeodesicIntersectionUpdate, withDeferredGeodesicIntersections } from "./intersections";
import { liftGeodesicEndpointWithAnchors, removeUnusedFreeGeodesicEnds } from "./endpoints";
import {
  getGeodesicSegments,
  getGeodesicTotalLengthMeters,
  removeGeodesicIntervalAndDerivedObjects,
  removeGeodesicSegments,
  replaceDerivedSegmentsFromTraces,
  syncEmitterGeodesicMenuCaches,
} from "./segments";
import { isGeodesicLocked } from "./lifecycle";
import { previewRebuildGeodesicInterval, rebuildDerivedGeodesicSegments } from "./intervals";

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

/** Request for `advanceCurveShorteningPairs`: one tick of the curve shortening flow of every moving pair. */
export interface AdvanceCurveShorteningPairsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  /** Frame time in seconds; the flow moves each free vertex by at most `curveShorteningSpeedMetersPerSecond` times this (clamped to 0.1 s). */
  readonly deltaSeconds: number;
  /** Receives the notices of the flow (collapsed loops and geodesics, unresolved pairs). */
  readonly onNotice?: (notice: CurveShorteningNotice) => void;
}

/**
 * Detaches two endpoint roles from one emitter and ties them to a new shared free end, starting a curve-shortening pair.
 *
 * Preconditions: `first` and `second` are different `(geodesicId, role)` pairs (the two roles of ONE interval are allowed: a loop
 * based at the emitter); both attachments currently point at `detachedEmitterId`; every affected interval exists and is locked
 * (pinned at both ends); the first anchor of the detached roles is the emitter. Effects on success: a `FreeGeodesicEndObject` is created at the emitter's beam point (so the geometry does
 * not change at detach time), the selected roles are re-attached to it, the affected intervals become `"moving"`, their segments are
 * rebuilt from the stored portal word (the homotopy class is preserved), and a `CurveShorteningPairObject` is added. Returns that pair;
 * the next `advanceCurveShorteningPairs` ticks shorten it.
 *
 * Returns `undefined` on failed preconditions (nothing changed) or when a rebuild fails. Any rebuild failure rolls back all intervals
 * and segments and removes the free end: the geometry does not change at tie time, so a failure is numerical and never a reason to
 * delete a geodesic. Ids come from `createFreeEndId`/`createPairId`, each called at most once.
 */
export function tieAndDetachGeodesicEndpoints(
  request: TieAndDetachGeodesicEndpointsRequest,
): CurveShorteningPairObject | undefined {
  return withDeferredGeodesicIntersections(request.registry, () => tieAndDetachGeodesicEndpointsNow(request));
}

function tieAndDetachGeodesicEndpointsNow(
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
    // Rebuild failed (note: rebuildDerivedGeodesicSegments itself deletes a degenerate interval, so a restored interval is re-added).
    // Restore the original intervals, segments and emitter attachments and discard the free end, leaving the world as before the request.
    if (!rebuildDerivedGeodesicSegments({ world: request.world, registry: request.registry, geodesicId: interval.id })) {
      restoreGeodesicIntervalsAndSegments(request.registry, affected, originalSegmentsByGeodesicId);
      request.registry.remove(freeEnd.id);
      removeUnusedFreeGeodesicEnds(request.registry);
      requestGeodesicIntersectionUpdate(request.registry);
      return undefined;
    }
    syncEmitterGeodesicMenuCaches(request.registry, interval.id);
  }

  const pair = createCurveShorteningPairObject({
    id: request.createPairId(),
    vertexIds: [freeEnd.id],
    cellId: freeEnd.cellId,
  });
  request.registry.add(pair);
  requestGeodesicIntersectionUpdate(request.registry);
  return pair;
}

// ---- Curve shortening flow ----

/** Speed (meters per second) at which a free vertex moves along its descent direction; the exact line search never overshoots the minimum. */
export const curveShorteningSpeedMetersPerSecond = 1.5;

/** Longest frame time (seconds) one tick of the flow integrates; a stalled tab does not teleport a vertex. */
const maxCurveShorteningDeltaSeconds = 0.1;

/** Turning angle (radians) below which a vertex counts as taut: its two arcs are one geodesic and the vertex is removed. */
export const curveShorteningTautTurnRadians = 5e-3;

/** Smallest step (meters) worth taking; a vertex that cannot move this far, and is not taut, is merged away or the curve is left unresolved. */
const minCurveShorteningStepMeters = 1e-5;

/** A blocked loop shorter than this has no room left to shrink: it is on its way to the cone point it encircles and is deleted. */
const loopCollapseLengthMeters = GEODESIC_MIN_LENGTH_METERS * 4;

/** How many times a rejected step is halved before the vertex counts as blocked. */
const maxStepHalvings = 8;

/** Bisection iterations of the line search along the descent ray. */
const lineSearchIterations = 40;

/** Length tolerance (meters): a step must not lengthen the arcs it moves by more than this. */
const lengthIncreaseToleranceMeters = 1e-9;

/** An arc end: one endpoint role of an interval attached to a vertex. */
interface ArcEnd {
  readonly intervalId: string;
  readonly role: GeodesicEndRole;
}

/**
 * Advances every moving curve-shortening curve by one tick of the curve shortening flow and returns the ids that changed.
 *
 * The curve is the piecewise-geodesic chain of the pair's `"moving"` intervals; its free vertices are the pair's `vertexIds`. Every
 * tick each free vertex moves along the descent direction of the total length, the sum of the unit tangents of its two arcs pointing away
 * from it, by `min(speed * dt, distance to the minimum along that ray)` (an exact one-dimensional line search, so it never overshoots and never
 * stalls). Both arcs are re-realized as geodesic chords of their word, and the word changes by the portals the vertex crossed. The curve in
 * the registry is the current curve at every tick, and its total length never grows. A vertex whose turning angle is below
 * `curveShorteningTautTurnRadians` is removed: its two arcs merge into one (a loop on one vertex becomes a stable loop). The vertex count
 * never grows: no vertex is inserted, so a curve that would need a wrap around a forbidden-zone disk is left `"unresolved"`. When no free
 * vertex remains the pair is gone and the curve is stable. `deltaSeconds` is clamped to 0.1 s; a non-positive value does nothing.
 *
 * Returns the unique ids of the intervals that moved or merged, then removed ones, and the pair id when the pair ended. Notices go to `onNotice`.
 */
export function advanceCurveShorteningPairs(
  request: AdvanceCurveShorteningPairsRequest,
): readonly string[] {
  return withDeferredGeodesicIntersections(request.registry, () => advanceCurveShorteningPairsNow(request));
}

function advanceCurveShorteningPairsNow(request: AdvanceCurveShorteningPairsRequest): readonly string[] {
  if (!(request.deltaSeconds > 0)) {
    return [];
  }
  const stepBudgetMeters = curveShorteningSpeedMetersPerSecond * Math.min(request.deltaSeconds, maxCurveShorteningDeltaSeconds);
  const changed: string[] = [];
  for (const pair of request.registry.getObjectsOfKind("curve-shortening-pair")) {
    if (pair.state !== "moving" || request.registry.get(pair.id)?.kind !== "curve-shortening-pair") {
      continue;
    }
    changed.push(...flowPair(request, pair.id, stepBudgetMeters));
  }
  if (changed.length > 0) {
    requestGeodesicIntersectionUpdate(request.registry);
  }
  return [...new Set(changed)];
}

// One tick of one pair: every free vertex in order (Gauss-Seidel, so a vertex sees the position its neighbour just took).
function flowPair(request: AdvanceCurveShorteningPairsRequest, pairId: string, stepBudgetMeters: number): readonly string[] {
  const { registry } = request;
  const changed: string[] = [];
  const pair = registry.get(pairId);
  if (pair?.kind !== "curve-shortening-pair") {
    return changed;
  }
  for (const vertexId of pair.vertexIds) {
    const current = registry.get(pairId);
    if (current?.kind !== "curve-shortening-pair" || current.state !== "moving") {
      break;
    }
    if (registry.get(vertexId)?.kind !== "free-geodesic-end") {
      // The vertex is gone (an arc was deleted by someone else): nothing sensible is left of this curve.
      changed.push(...finishPairWithoutVertex(registry, current, vertexId));
      continue;
    }
    const outcome = flowVertex(request, current, vertexId, stepBudgetMeters);
    changed.push(...outcome.changedIds);
  }
  const after = registry.get(pairId);
  if (after?.kind === "curve-shortening-pair" && after.vertexIds.length === 0) {
    registry.remove(after.id);
    changed.push(after.id);
  }
  return changed;
}

function finishPairWithoutVertex(
  registry: RuntimeObjectRegistry,
  pair: CurveShorteningPairObject,
  missingVertexId: string,
): readonly string[] {
  registry.update({ ...pair, vertexIds: pair.vertexIds.filter((id) => id !== missingVertexId) });
  return [pair.id];
}

interface VertexFlowOutcome {
  readonly changedIds: readonly string[];
}

// Moves, merges away or blocks one free vertex of a pair.
function flowVertex(
  request: AdvanceCurveShorteningPairsRequest,
  pair: CurveShorteningPairObject,
  vertexId: string,
  stepBudgetMeters: number,
): VertexFlowOutcome {
  const { world, registry } = request;
  const vertex = registry.get(vertexId);
  if (vertex?.kind !== "free-geodesic-end") {
    return { changedIds: [] };
  }
  const ends = incidentArcEnds(registry, vertexId);
  if (ends.length !== 2) {
    return { changedIds: markUnresolved(request, pair, `vertex-valence-${ends.length}`) };
  }
  const tangents = ends.map((end) => tangentAwayFromVertex(world, registry, end, undefined));
  if (tangents.some((tangent) => tangent === undefined)) {
    return { changedIds: markUnresolved(request, pair, "lift") };
  }
  const [first, second] = tangents as [ArcTangent, ArcTangent];
  const descent = { x: first.x + second.x, y: first.y + second.y };
  const descentNorm = Math.hypot(descent.x, descent.y);
  if (descentNorm < curveShorteningTautTurnRadians) {
    return mergeVertexOrFail(request, pair, vertexId, ends);
  }
  const direction = { x: descent.x / descentNorm, y: descent.y / descentNorm };
  const step = lineSearchStepMeters(world, registry, vertex, ends, direction, stepBudgetMeters);
  if (step < minCurveShorteningStepMeters) {
    return mergeVertexOrFail(request, pair, vertexId, ends);
  }
  const before = totalLengthOfArcs(registry, ends);
  let attempt = step;
  for (let halving = 0; halving <= maxStepHalvings && attempt >= minCurveShorteningStepMeters; halving += 1) {
    const moved = tryMoveVertex(world, registry, vertex, ends, direction, attempt, before);
    if (moved) {
      commitVertexMove(registry, pair, moved);
      return { changedIds: moved.intervals.map(({ interval }) => interval.id) };
    }
    attempt /= 2;
  }
  // Blocked: a wall, a forbidden zone, or an arc about to become degenerate. Cutting the corner is the only move left that adds no vertex.
  return mergeVertexOrFail(request, pair, vertexId, ends);
}

interface ArcTangent {
  readonly x: number;
  readonly y: number;
  readonly lengthMeters: number;
}

// Unit tangent of an arc at a vertex, pointing away from it, in the vertex's own cell frame; `candidates` shadow the registry's anchors.
function tangentAwayFromVertex(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  end: ArcEnd,
  candidates: ReadonlyMap<string, RuntimeWorldObject> | undefined,
  intervalOverrides?: ReadonlyMap<string, GeodesicIntervalObject>,
): ArcTangent | undefined {
  const interval = intervalOverrides?.get(end.intervalId) ?? registry.get(end.intervalId);
  if (interval?.kind !== "geodesic-interval") {
    return undefined;
  }
  const lifted = liftGeodesicEndpointWithAnchors({
    world,
    registry,
    interval,
    sourceRole: end.role,
    candidateAnchorsById: candidates,
  });
  if (!lifted) {
    return undefined;
  }
  const dx = lifted.targetPointInSourceCell.x - lifted.sourcePoint.x;
  const dy = lifted.targetPointInSourceCell.y - lifted.sourcePoint.y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? { x: dx / length, y: dy / length, lengthMeters: length } : undefined;
}

// Both endpoint roles of every moving interval attached to the vertex (a loop on the vertex has two).
function incidentArcEnds(registry: RuntimeObjectRegistry, vertexId: string): readonly ArcEnd[] {
  const ends: ArcEnd[] = [];
  for (const interval of registry.getObjectsOfKind("geodesic-interval")) {
    for (const role of ["start", "end"] as const) {
      if (interval[role].anchorObjectId === vertexId) {
        ends.push({ intervalId: interval.id, role });
      }
    }
  }
  return ends;
}

function totalLengthOfArcs(registry: RuntimeObjectRegistry, ends: readonly ArcEnd[]): number {
  return [...new Set(ends.map(({ intervalId }) => intervalId))]
    .reduce((total, id) => total + getGeodesicTotalLengthMeters(registry, id), 0);
}

function movedVertex(vertex: Extract<RuntimeWorldObject, { readonly kind: "free-geodesic-end" }>, cellId: string, x: number, y: number) {
  return {
    ...vertex,
    cellId,
    localPose: { ...vertex.localPose, translation: { x, y, z: vertex.localPose.translation.z } },
  };
}

// Exact line search of the total length along the ray: the length is convex along it and its derivative is
// `-(direction . u1 + direction . u2)` with the tangents re-lifted at the candidate position, so a bisection on the sign finds the minimum.
// Returns `min(budget, distance to the minimum)`.
function lineSearchStepMeters(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  vertex: Extract<RuntimeWorldObject, { readonly kind: "free-geodesic-end" }>,
  ends: readonly ArcEnd[],
  direction: { readonly x: number; readonly y: number },
  budgetMeters: number,
): number {
  const origin = vertex.localPose.translation;
  const slope = (t: number): number | undefined => {
    const candidate = movedVertex(vertex, vertex.cellId, origin.x + direction.x * t, origin.y + direction.y * t);
    const candidates = new Map<string, RuntimeWorldObject>([[vertex.id, candidate]]);
    let total = 0;
    for (const end of ends) {
      const tangent = tangentAwayFromVertex(world, registry, end, candidates);
      if (!tangent) {
        return undefined;
      }
      total -= direction.x * tangent.x + direction.y * tangent.y;
    }
    return total;
  };
  const atBudget = slope(budgetMeters);
  if (atBudget === undefined) {
    return budgetMeters;
  }
  if (atBudget <= 0) {
    return budgetMeters;
  }
  let low = 0;
  let high = budgetMeters;
  for (let iteration = 0; iteration < lineSearchIterations; iteration += 1) {
    const middle = (low + high) / 2;
    const value = slope(middle);
    if (value === undefined || value > 0) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return (low + high) / 2;
}

interface MovedVertex {
  readonly vertex: Extract<RuntimeWorldObject, { readonly kind: "free-geodesic-end" }>;
  readonly intervals: readonly { readonly interval: GeodesicIntervalObject; readonly traces: readonly TraceGeodesicSegmentResult[] }[];
}

// Tries one step: walks the vertex through the world, updates the words of the arcs by the portals it crossed, previews both arcs and
// accepts only a step that does not lengthen them. Nothing is written.
function tryMoveVertex(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  vertex: Extract<RuntimeWorldObject, { readonly kind: "free-geodesic-end" }>,
  ends: readonly ArcEnd[],
  direction: { readonly x: number; readonly y: number },
  stepMeters: number,
  lengthBefore: number,
): MovedVertex | undefined {
  const origin = vertex.localPose.translation;
  const walk = walkDevelopedSegment({
    world,
    cellId: vertex.cellId,
    start: { x: origin.x, y: origin.y },
    direction,
    lengthMeters: stepMeters,
  });
  const lastPiece = walk.pieces.at(-1);
  if (walk.status !== "end" || !lastPiece) {
    return undefined;
  }
  const local = transformPoint3(lastPiece.cellFromStart, vec3(origin.x + direction.x * stepMeters, origin.y + direction.y * stepMeters, 0));
  const crossings: GeodesicPortalTraversal[] = walk.crossings.map((crossing) => ({
    sourceCellId: crossing.sourceCellId,
    sourcePortalId: crossing.portalId,
    targetCellId: crossing.targetCellId,
    targetPortalId: crossing.targetPortalId,
  }));
  const next = movedVertex(vertex, lastPiece.cellId, local.x, local.y);

  const updated = new Map<string, GeodesicIntervalObject>();
  for (const end of ends) {
    const interval = updated.get(end.intervalId) ?? registry.get(end.intervalId);
    if (interval?.kind !== "geodesic-interval") {
      return undefined;
    }
    updated.set(end.intervalId, withVertexCrossings(interval, end.role, crossings, lastPiece.cellId));
  }
  const candidates = new Map<string, RuntimeWorldObject>([[vertex.id, next]]);
  const intervals: { interval: GeodesicIntervalObject; traces: readonly TraceGeodesicSegmentResult[] }[] = [];
  let lengthAfter = 0;
  for (const interval of updated.values()) {
    const preview = previewRebuildGeodesicInterval({ world, registry, interval, candidateAnchorsById: candidates });
    if (!preview) {
      return undefined;
    }
    intervals.push({ interval, traces: preview.traces });
    lengthAfter += preview.traces.reduce((total, trace) => total + trace.lengthMeters, 0);
  }
  if (lengthAfter > lengthBefore + lengthIncreaseToleranceMeters) {
    return undefined;
  }
  return { vertex: next, intervals };
}

// The interval after its `role` end moved over the portals `crossings` into `newCellId`: the word is extended at the end or prefixed
// (inverted) at the start, then freely reduced; a moved start also moves the interval's start cell.
function withVertexCrossings(
  interval: GeodesicIntervalObject,
  role: GeodesicEndRole,
  crossings: readonly GeodesicPortalTraversal[],
  newCellId: string,
): GeodesicIntervalObject {
  if (crossings.length === 0) {
    return role === "start" ? { ...interval, cellId: newCellId, startCellId: newCellId } : interval;
  }
  if (role === "end") {
    return { ...interval, portalWord: reduceAdjacentInversePortalTraversals([...interval.portalWord, ...crossings]) };
  }
  return {
    ...interval,
    cellId: newCellId,
    startCellId: newCellId,
    portalWord: reduceAdjacentInversePortalTraversals([...reverseGeodesicPortalWord(crossings), ...interval.portalWord]),
  };
}

function commitVertexMove(registry: RuntimeObjectRegistry, pair: CurveShorteningPairObject, moved: MovedVertex): void {
  registry.update(moved.vertex);
  for (const { interval, traces } of moved.intervals) {
    registry.update(interval);
    replaceDerivedSegmentsFromTraces({ registry, geodesicId: interval.id, traces });
  }
  // The pair object mirrors the cell of its first vertex (informational).
  if (pair.vertexIds[0] === moved.vertex.id && pair.cellId !== moved.vertex.cellId) {
    registry.update({ ...pair, cellId: moved.vertex.cellId });
  }
}

function markUnresolved(request: AdvanceCurveShorteningPairsRequest, pair: CurveShorteningPairObject, reason: string): readonly string[] {
  request.registry.update({ ...pair, state: "unresolved" });
  request.onNotice?.({
    kind: "unresolved",
    pairId: pair.id,
    reason,
    message: `The tied geodesic could not be straightened (${reason}).`,
  });
  return [pair.id];
}

function oppositeRole(role: GeodesicEndRole): GeodesicEndRole {
  return getOppositeEndRole(role);
}

// Removes a vertex whose two arcs form one geodesic (taut), or that cannot move any more: the two arcs merge into one interval from the
// far anchor of the first to the far anchor of the second. A loop on the vertex has nothing to merge with: it becomes a stable loop when taut
// and is deleted when it has shrunk below the minimum length. A merge whose chord cannot be realized (a wall or a forbidden zone is in
// the way, which would need an inserted wrap vertex) leaves the curve unresolved.
function mergeVertexOrFail(
  request: AdvanceCurveShorteningPairsRequest,
  pair: CurveShorteningPairObject,
  vertexId: string,
  ends: readonly ArcEnd[],
): VertexFlowOutcome {
  const { world, registry } = request;
  const [firstEnd, secondEnd] = ends;
  const firstInterval = registry.get(firstEnd.intervalId);
  const secondInterval = registry.get(secondEnd.intervalId);
  if (firstInterval?.kind !== "geodesic-interval" || secondInterval?.kind !== "geodesic-interval") {
    return { changedIds: markUnresolved(request, pair, "missing-interval") };
  }
  const remainingVertexIds = pair.vertexIds.filter((id) => id !== vertexId);

  if (firstInterval.id === secondInterval.id) {
    const length = getGeodesicTotalLengthMeters(registry, firstInterval.id);
    const tangents = ends.map((end) => tangentAwayFromVertex(world, registry, end, undefined));
    const straight = tangents.every((tangent) => tangent !== undefined) &&
      Math.hypot(tangents[0]!.x + tangents[1]!.x, tangents[0]!.y + tangents[1]!.y) < curveShorteningTautTurnRadians;
    if (straight) {
      registry.update({ ...firstInterval, motionState: "stable" });
      registry.update({ ...pair, vertexIds: remainingVertexIds });
      return { changedIds: [firstInterval.id, pair.id] };
    }
    if (length < loopCollapseLengthMeters) {
      registry.update({ ...pair, vertexIds: remainingVertexIds });
      removeGeodesicIntervalAndDerivedObjects(registry, firstInterval.id);
      if (registry.get(vertexId)) {
        registry.remove(vertexId);
      }
      request.onNotice?.({
        kind: "free-loop-collapsed",
        geodesicId: firstInterval.id,
        message: "The loop around a cone point shrank to a point and was removed.",
      });
      return { changedIds: [firstInterval.id, pair.id] };
    }
    return { changedIds: markUnresolved(request, pair, "loop-blocked") };
  }

  const anchorA = registry.get(firstInterval[oppositeRole(firstEnd.role)].anchorObjectId);
  const anchorB = registry.get(secondInterval[oppositeRole(secondEnd.role)].anchorObjectId);
  if (!canObjectAttachGeodesics(anchorA) || !canObjectAttachGeodesics(anchorB)) {
    return { changedIds: markUnresolved(request, pair, "anchor") };
  }
  const word = reduceAdjacentInversePortalTraversals([
    ...getPortalWordBetweenEndpointRoles({ interval: firstInterval, sourceRole: oppositeRole(firstEnd.role), targetRole: firstEnd.role }),
    ...getPortalWordBetweenEndpointRoles({ interval: secondInterval, sourceRole: secondEnd.role, targetRole: oppositeRole(secondEnd.role) }),
  ]);
  const mergedId = [firstInterval.id, secondInterval.id].sort()[0];
  const removedId = mergedId === firstInterval.id ? secondInterval.id : firstInterval.id;
  const stillMoving = remainingVertexIds.includes(anchorA.id) || remainingVertexIds.includes(anchorB.id);
  const merged = createGeodesicIntervalObject({
    id: mergedId,
    startAnchorObjectId: anchorA.id,
    endAnchorObjectId: anchorB.id,
    startCellId: anchorA.cellId,
    portalWord: word,
    motionState: stillMoving ? "moving" : "stable",
  });
  const preview = previewRebuildGeodesicInterval({ world, registry, interval: merged });
  if (!preview) {
    const lifted = liftGeodesicEndpointWithAnchors({ world, registry, interval: merged, sourceRole: "start" });
    if (lifted && Math.hypot(
      lifted.targetPointInSourceCell.x - lifted.sourcePoint.x,
      lifted.targetPointInSourceCell.y - lifted.sourcePoint.y,
    ) < GEODESIC_MIN_LENGTH_METERS) {
      registry.update({ ...pair, vertexIds: remainingVertexIds });
      removeGeodesicIntervalAndDerivedObjects(registry, firstInterval.id);
      removeGeodesicIntervalAndDerivedObjects(registry, secondInterval.id);
      if (registry.get(vertexId)) {
        registry.remove(vertexId);
      }
      request.onNotice?.({
        kind: "collapsed",
        geodesicIds: [firstInterval.id, secondInterval.id],
        message: "The tied geodesic shrank to a point and was removed.",
      });
      return { changedIds: [firstInterval.id, secondInterval.id, pair.id] };
    }
    return { changedIds: markUnresolved(request, pair, "merge-blocked") };
  }

  if (!stillMoving) {
    const existing = findEquivalentStableInterval(registry, merged, [firstInterval.id, secondInterval.id]);
    if (existing) {
      registry.update({ ...pair, vertexIds: remainingVertexIds });
      removeGeodesicIntervalAndDerivedObjects(registry, firstInterval.id);
      removeGeodesicIntervalAndDerivedObjects(registry, secondInterval.id);
      if (registry.get(vertexId)) {
        registry.remove(vertexId);
      }
      return { changedIds: [firstInterval.id, secondInterval.id, pair.id] };
    }
  }
  // Commit: the merged interval overwrites the one with the smaller id, the other goes last so that the free-end sweep of its removal
  // finds the merged interval already detached from the vertex.
  registry.update(merged);
  registry.update({ ...pair, vertexIds: remainingVertexIds });
  removeGeodesicIntervalAndDerivedObjects(registry, removedId);
  if (registry.get(vertexId)) {
    registry.remove(vertexId);
  }
  replaceDerivedSegmentsFromTraces({ registry, geodesicId: merged.id, traces: preview.traces });
  syncEmitterGeodesicMenuCaches(registry, merged.id);
  return { changedIds: [merged.id, removedId, pair.id] };
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
  return registry.getObjectsOfKind("geodesic-interval").find((object) =>
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


// De-duplicates intervals by id (a loop pair names the same interval twice), keeping the last occurrence.
function uniqueIntervals(intervals: readonly GeodesicIntervalObject[]): readonly GeodesicIntervalObject[] {
  const byId = new Map<string, GeodesicIntervalObject>();
  for (const interval of intervals) {
    byId.set(interval.id, interval);
  }
  return [...byId.values()];
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
    syncEmitterGeodesicMenuCaches(registry, interval.id);
  }
}


/** A user-visible event of the curve shortening flow; the shell logs it (there is no on-screen message system yet). */
export type CurveShorteningNotice =
  | { readonly kind: "free-loop-collapsed"; readonly geodesicId: string; readonly message: string }
  | { readonly kind: "collapsed"; readonly geodesicIds: readonly string[]; readonly message: string }
  | { readonly kind: "unresolved"; readonly pairId: string; readonly reason: string; readonly message: string };
