/**
 * Curve shortening: tie-and-detach of two endpoint roles into a curve-shortening pair, and the curve shortening flow that then runs over many frames.
 * Tying detaches two endpoint roles of an emitter onto a shared vertex F without changing the geometry. The curve is then a piecewise-geodesic chain of
 * tied arcs; each `advanceCurveShorteningPairs` tick moves every vertex along the descent direction of the total length (the sum of its two
 * arcs' unit tangents) with an exact line search, re-realizes the neighbouring arcs as geodesic chords of their portal words, and removes a vertex when
 * its turning angle is below a tolerance. The vertex count never grows (no vertex is inserted), the total length never grows, and the registry is the
 * current curve at every tick. When no vertex is left the curve is a geodesic. Failures change nothing except marking the pair `"unresolved"`.
 *
 * The geometry (moving and removing a vertex, tying) lives in `vertices.ts`; this file is the legacy flow that decides what to do with it.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import { createCurveShorteningPairObject, type CurveShorteningPairObject, type GeodesicEndpointSelection } from "./objects";
import { arcsAtVertex, isStale, type ArcEnd } from "./endpoints";
import { withDeferredGeodesicIntersections, requestGeodesicIntersectionUpdate } from "./intersections";
import {
  arcTangentsAtVertex,
  commitVertexMove,
  lengthOfArcs,
  previewVertexMove,
  previewVertexRemoval,
  removeVertex,
  tieAtNewVertex,
  vertexTautTurnRadians,
} from "./vertices";

/** Request for `tieAndDetachGeodesicEndpoints`: detach two endpoint roles from one emitter and tie them at a new shared vertex. */
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
  /** Frame time in seconds; the flow moves each vertex by at most `curveShorteningSpeedMetersPerSecond` times this (clamped to 0.1 s). */
  readonly deltaSeconds: number;
  /** Receives the notices of the flow (collapsed loops and geodesics, unresolved pairs). */
  readonly onNotice?: (notice: CurveShorteningNotice) => void;
}

/**
 * Detaches two endpoint roles from one emitter and ties them to a new shared vertex (`tieAtNewVertex`), starting a curve-shortening pair.
 *
 * Preconditions and effects are those of `tieAtNewVertex`; on success a `CurveShorteningPairObject` is added and returned, and the next
 * `advanceCurveShorteningPairs` ticks shorten it. Returns `undefined` on failed preconditions (nothing changed) or when a rebuild fails.
 * Ids come from `createFreeEndId`/`createPairId`, each called at most once.
 */
export function tieAndDetachGeodesicEndpoints(
  request: TieAndDetachGeodesicEndpointsRequest,
): CurveShorteningPairObject | undefined {
  return withDeferredGeodesicIntersections(request.registry, () => tieAndDetachGeodesicEndpointsNow(request));
}

function tieAndDetachGeodesicEndpointsNow(
  request: TieAndDetachGeodesicEndpointsRequest,
): CurveShorteningPairObject | undefined {
  const tied = tieAtNewVertex(request.world, request.registry, {
    detachedEmitterId: request.detachedEmitterId,
    first: request.first,
    second: request.second,
    createVertexId: request.createFreeEndId,
  });
  if (!tied.ok) {
    return undefined;
  }
  const vertex = request.registry.get(tied.vertexId);
  if (vertex?.kind !== "geodesicModel/vertex") {
    return undefined;
  }
  const pair = createCurveShorteningPairObject({
    id: request.createPairId(),
    vertexIds: [vertex.id],
    cellId: vertex.cellId,
  });
  request.registry.add(pair);
  requestGeodesicIntersectionUpdate(request.registry);
  return pair;
}

// ---- Curve shortening flow ----

/** Speed (meters per second) at which a vertex moves along its descent direction; the exact line search never overshoots the minimum. */
export const curveShorteningSpeedMetersPerSecond = 1.5;

/** Longest frame time (seconds) one tick of the flow integrates; a stalled tab does not teleport a vertex. */
const maxCurveShorteningDeltaSeconds = 0.1;

/** Turning angle (radians) below which a vertex counts as taut: its two arcs are one geodesic and the vertex is removed. */
export const curveShorteningTautTurnRadians = vertexTautTurnRadians;

/** Smallest step (meters) worth taking; a vertex that cannot move this far, and is not taut, is merged away or the curve is left unresolved. */
const minCurveShorteningStepMeters = 1e-5;

/** How many times a rejected step is halved before the vertex counts as blocked. */
const maxStepHalvings = 8;

/** Bisection iterations of the line search along the descent ray. */
const lineSearchIterations = 40;

/** Length tolerance (meters): a step must not lengthen the arcs it moves by more than this. */
const lengthIncreaseToleranceMeters = 1e-9;

/**
 * Advances every moving curve-shortening curve by one tick of the curve shortening flow and returns the ids that changed.
 *
 * The curve is the piecewise-geodesic chain of the pair's tied arcs; its vertices are the pair's `vertexIds`. Every
 * tick each vertex moves along the descent direction of the total length, the sum of the unit tangents of its two arcs pointing away
 * from it, by `min(speed * dt, distance to the minimum along that ray)` (an exact one-dimensional line search, so it never overshoots and never
 * stalls). Both arcs are re-realized as geodesic chords of their word, and the word changes by the portals the vertex crossed. The curve in
 * the registry is the current curve at every tick, and its total length never grows. A vertex whose turning angle is below
 * `curveShorteningTautTurnRadians` is removed: its two arcs merge into one (a loop on one vertex stays as a taut loop). The vertex count
 * never grows: no vertex is inserted, so a curve that would need a wrap around a forbidden-zone disk is left `"unresolved"`. When no
 * vertex remains the pair is gone and the curve is a geodesic. `deltaSeconds` is clamped to 0.1 s; a non-positive value does nothing.
 *
 * Returns the unique ids of the arcs that moved or merged, then removed ones, and the pair id when the pair ended. Notices go to `onNotice`.
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

// One tick of one pair: every vertex in order (Gauss-Seidel, so a vertex sees the position its neighbour just took).
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
    if (registry.get(vertexId)?.kind !== "geodesicModel/vertex") {
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

// Moves, merges away or blocks one vertex of a pair.
function flowVertex(
  request: AdvanceCurveShorteningPairsRequest,
  pair: CurveShorteningPairObject,
  vertexId: string,
  stepBudgetMeters: number,
): VertexFlowOutcome {
  const { world, registry } = request;
  const vertex = registry.get(vertexId);
  if (vertex?.kind !== "geodesicModel/vertex") {
    return { changedIds: [] };
  }
  const ends = arcsAtVertex(registry, vertexId);
  if (ends.length !== 2) {
    return { changedIds: markUnresolved(request, pair, `vertex-valence-${ends.length}`) };
  }
  // An arc whose last rebuild failed during a carry still shows its old path; the vertex waits for a good one.
  if (ends.some((end) => isStale(registry, end.arcId))) {
    return { changedIds: [] };
  }
  const tangents = arcTangentsAtVertex(world, registry, vertexId, ends);
  if (!tangents) {
    return { changedIds: markUnresolved(request, pair, "lift") };
  }
  const descent = { x: tangents[0]!.x + tangents[1]!.x, y: tangents[0]!.y + tangents[1]!.y };
  const descentNorm = Math.hypot(descent.x, descent.y);
  if (descentNorm < curveShorteningTautTurnRadians) {
    return removeVertexOrFail(request, pair, vertexId, ends);
  }
  const direction = { x: descent.x / descentNorm, y: descent.y / descentNorm };
  const step = lineSearchStepMeters(world, registry, vertexId, ends, direction, stepBudgetMeters);
  if (step < minCurveShorteningStepMeters) {
    return removeVertexOrFail(request, pair, vertexId, ends);
  }
  const before = lengthOfArcs(registry, ends);
  let attempt = step;
  for (let halving = 0; halving <= maxStepHalvings && attempt >= minCurveShorteningStepMeters; halving += 1) {
    const preview = previewVertexMove(world, registry, { vertexId, arcs: ends, direction, lengthMeters: attempt });
    // A step that lengthens the arcs is rejected like a blocked one.
    if (preview && preview.lengthAfterMeters <= before + lengthIncreaseToleranceMeters) {
      commitVertexMove(registry, preview);
      // The pair object mirrors the cell of its first vertex (informational).
      const moved = registry.get(vertexId);
      if (moved?.kind === "geodesicModel/vertex" && pair.vertexIds[0] === vertexId && pair.cellId !== moved.cellId) {
        registry.update({ ...pair, cellId: moved.cellId });
      }
      return { changedIds: [...new Set(ends.map(({ arcId }) => arcId))] };
    }
    attempt /= 2;
  }
  // Blocked: a wall, a forbidden zone, or an arc about to become degenerate. Cutting the corner is the only move left that adds no vertex.
  return removeVertexOrFail(request, pair, vertexId, ends);
}

// Exact line search of the total length along the ray: the length is convex along it and its derivative is
// `-(direction . u1 + direction . u2)` with the tangents re-lifted at the candidate position, so a bisection on the sign finds the minimum.
// Returns `min(budget, distance to the minimum)`.
function lineSearchStepMeters(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  vertexId: string,
  ends: readonly ArcEnd[],
  direction: { readonly x: number; readonly y: number },
  budgetMeters: number,
): number {
  const vertex = registry.get(vertexId);
  if (vertex?.kind !== "geodesicModel/vertex") {
    return budgetMeters;
  }
  const origin = vertex.localPose.translation;
  const slope = (t: number): number | undefined => {
    const tangents = arcTangentsAtVertex(world, registry, vertexId, ends, { x: origin.x + direction.x * t, y: origin.y + direction.y * t });
    if (!tangents) {
      return undefined;
    }
    let total = 0;
    for (const tangent of tangents) {
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

// Removes a vertex whose two arcs form one geodesic (taut), or that cannot move any more (`previewVertexRemoval`, `removeVertex`). A loop on the vertex has
// nothing to merge with: it stays as a taut loop when taut and is deleted when it has shrunk below the minimum length. A merge whose chord cannot be realized
// (a wall or a forbidden zone is in the way, which would need an inserted wrap vertex) leaves the curve unresolved.
function removeVertexOrFail(
  request: AdvanceCurveShorteningPairsRequest,
  pair: CurveShorteningPairObject,
  vertexId: string,
  ends: readonly ArcEnd[],
): VertexFlowOutcome {
  const { world, registry } = request;
  const preview = previewVertexRemoval(world, registry, { vertexId, arcs: ends });
  const remaining = { ...pair, vertexIds: pair.vertexIds.filter((id) => id !== vertexId) };
  switch (preview.kind) {
    case "blocked": {
      const reason = { missingArc: "missing-interval", loopBlocked: "loop-blocked", anchor: "anchor", mergeBlocked: "merge-blocked" }[preview.reason];
      return { changedIds: markUnresolved(request, pair, reason) };
    }
    case "loopTaut":
      registry.update(remaining);
      return { changedIds: [preview.arcId, pair.id] };
    case "collapsed": {
      registry.update(remaining);
      const arcIds = removeVertex(registry, vertexId, preview);
      request.onNotice?.(preview.loop
        ? { kind: "free-loop-collapsed", geodesicId: preview.arcIds[0]!, message: "The loop around a cone point shrank to a point and was removed." }
        : { kind: "collapsed", geodesicIds: preview.arcIds, message: "The tied geodesic shrank to a point and was removed." });
      return { changedIds: [...arcIds, pair.id] };
    }
    case "merge": {
      registry.update(remaining);
      const arcIds = removeVertex(registry, vertexId, preview);
      return { changedIds: [...arcIds, pair.id] };
    }
  }
}

/** A user-visible event of the curve shortening flow; the shell logs it (there is no on-screen message system yet). */
export type CurveShorteningNotice =
  | { readonly kind: "free-loop-collapsed"; readonly geodesicId: string; readonly message: string }
  | { readonly kind: "collapsed"; readonly geodesicIds: readonly string[]; readonly message: string }
  | { readonly kind: "unresolved"; readonly pairId: string; readonly reason: string; readonly message: string };
