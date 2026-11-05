/**
 * The curve shortening flow (design 013 section 13.2): the rule applied to every tied vertex each step, in `forEachTiedVertex` order (Gauss-Seidel, so a vertex sees the position its neighbour just took).
 * With `u1`, `u2` the unit tangents of the vertex's two arc ends, pointing away from it: a vertex with a stale arc is skipped for this step; a vertex at rest (`|u1 + u2|` below the taut tolerance) always merges
 * away; any other vertex moves along `u1 + u2` by the step the speed law allows, capped by an exact line search, and a rejected step is halved up to eight times; a vertex that cannot move tries the merge, and if that is
 * refused it is blocked. A blocked vertex destroys its whole curve, with one notice; if the removal is refused, the vertex goes quiet with no notice instead of retrying every step. A taut closed loop keeps its vertex, as a base point, and goes quiet.
 * The vertex count never grows: this algorithm inserts no vertex, so a curve that would need a wrap at a forbidden-zone disk is blocked and destroyed. The flow reads the geodesic model through `GeodesicModelApi` and changes the world only through
 * its operations and the dispatched `geodesicModel/removeVertex` and `geodesicModel/removeCurve`; it holds no world state, only the `quiet` memo it is given: the vertices with nothing to do.
 */
import type { CommandResult, EngineCommandBase } from "../../engine/moduleTypes";
import { vertexTautTurnRadians, type ArcEnd, type GeodesicModelApi, type GeodesicRemoveCurveCommand, type GeodesicRemoveVertexCommand } from "../geodesicModel/api";
import type { CurveShorteningEvent } from "./api";
import type { SpeedLaw } from "./policies";

/** Smallest step (meters) worth taking; a vertex that cannot move this far, and is not taut, is merged away or blocked. */
const minStepMeters = 1e-5;

/** How many times a rejected step is halved before the vertex counts as blocked. */
const maxStepHalvings = 8;

/** Bisection iterations of the line search along the descent ray. */
const lineSearchIterations = 40;

/** Length tolerance (meters): a step must not lengthen the arcs it moves by more than this. */
const lengthIncreaseToleranceMeters = 1e-9;

const blockedReasons = { missingArc: "missing-interval", loopBlocked: "loop-blocked", anchor: "anchor", mergeBlocked: "merge-blocked" } as const;

/** What one step of the flow works with. */
export interface FlowDeps {
  readonly model: GeodesicModelApi;
  readonly speedLaw: SpeedLaw;
  /** Vertices with nothing to do (a memo, design 014 section 2.1); the flow adds to it, the module's wake tick removes from it. */
  readonly quiet: Set<string>;
  /** The position of a vertex in its own cell, or `undefined` when there is no such vertex. */
  vertexPoint(vertexId: string): { readonly x: number; readonly y: number } | undefined;
  dispatch(command: EngineCommandBase): CommandResult;
  emit(event: CurveShorteningEvent): void;
}

/** One step of the flow over every tied vertex that is not quiet. The caller passes a positive `deltaSeconds`. */
export function flowStep(deps: FlowDeps, deltaSeconds: number): void {
  // The visit runs after the model's call returns, not inside its callback: the callback runs as the model, and the flow emits and dispatches as itself.
  const visited: string[] = [];
  deps.model.forEachTiedVertex((vertexId) => visited.push(vertexId));
  for (let index = 0; index < visited.length; index += 1) {
    const vertexId = visited[index]!;
    if (deps.quiet.has(vertexId)) continue;
    flowVertex(deps, vertexId, deltaSeconds);
  }
}

function flowVertex(deps: FlowDeps, vertexId: string, deltaSeconds: number): void {
  const { model } = deps;
  const ends = model.arcsAtVertex(vertexId);
  // The visit walks a snapshot: a merge earlier in this step may have removed the vertex.
  if (ends.length === 0) return;
  // An arc whose last rebuild failed during a carry still shows its old path; the vertex waits for a good one.
  for (let index = 0; index < ends.length; index += 1) {
    if (model.isStale(ends[index]!.arcId)) return;
  }
  if (ends.length !== 2) {
    blockVertex(deps, vertexId, `vertex-valence-${ends.length}`);
    return;
  }
  const tangents = model.arcTangentsAtVertex(vertexId, ends);
  if (!tangents) {
    blockVertex(deps, vertexId, "lift");
    return;
  }
  const descent = { x: tangents[0]!.x + tangents[1]!.x, y: tangents[0]!.y + tangents[1]!.y };
  const descentNorm = Math.hypot(descent.x, descent.y);
  if (descentNorm < vertexTautTurnRadians) {
    mergeOrBlock(deps, vertexId, ends);
    return;
  }
  const direction = { x: descent.x / descentNorm, y: descent.y / descentNorm };
  const budget = deps.speedLaw({ tangentSum: descent, deltaSeconds });
  const step = lineSearchStepMeters(deps, vertexId, ends, direction, budget);
  if (step < minStepMeters) {
    mergeOrBlock(deps, vertexId, ends);
    return;
  }
  const before = model.lengthOfArcs(ends);
  let attempt = step;
  for (let halving = 0; halving <= maxStepHalvings && attempt >= minStepMeters; halving += 1) {
    const preview = model.previewVertexMove({ vertexId, arcs: ends, direction, lengthMeters: attempt });
    // A step that lengthens the arcs is rejected like a blocked one.
    if (preview && preview.lengthAfterMeters <= before + lengthIncreaseToleranceMeters) {
      model.commitVertexMove(preview);
      return;
    }
    attempt /= 2;
  }
  // Blocked: a wall, a forbidden zone, or an arc about to become degenerate. Cutting the corner is the only move left that adds no vertex.
  mergeOrBlock(deps, vertexId, ends);
}

// Exact line search of the total length along the ray: the length is convex along it and its derivative is
// `-(direction . u1 + direction . u2)` with the tangents re-lifted at the candidate position, so a bisection on the sign finds the minimum.
// Returns `min(budget, distance to the minimum)`.
function lineSearchStepMeters(
  deps: FlowDeps,
  vertexId: string,
  ends: readonly ArcEnd[],
  direction: { readonly x: number; readonly y: number },
  budgetMeters: number,
): number {
  const origin = deps.vertexPoint(vertexId);
  if (origin === undefined) return budgetMeters;
  const slope = (t: number): number | undefined => {
    const tangents = deps.model.arcTangentsAtVertex(vertexId, ends, { x: origin.x + direction.x * t, y: origin.y + direction.y * t });
    if (!tangents) return undefined;
    let total = 0;
    for (let index = 0; index < tangents.length; index += 1) {
      total -= direction.x * tangents[index]!.x + direction.y * tangents[index]!.y;
    }
    return total;
  };
  const atBudget = slope(budgetMeters);
  if (atBudget === undefined) return budgetMeters;
  if (atBudget <= 0) return budgetMeters;
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

// Removes a vertex whose two arcs form one geodesic (taut), or that cannot move any more. A loop on the vertex has nothing to merge with: it stays as a taut loop when taut
// and is deleted when it has shrunk below the minimum length. A merge whose chord cannot be realized (a wall or a forbidden zone is in the way, which would need an inserted
// wrap vertex) blocks the vertex.
function mergeOrBlock(deps: FlowDeps, vertexId: string, ends: readonly ArcEnd[]): void {
  const preview = deps.model.previewVertexRemoval({ vertexId, arcs: ends });
  if (preview.kind === "blocked") {
    blockVertex(deps, vertexId, blockedReasons[preview.reason]);
    return;
  }
  if (preview.kind === "loopTaut") {
    deps.quiet.add(vertexId);
    return;
  }
  const remove: GeodesicRemoveVertexCommand = { kind: "geodesicModel/removeVertex", vertexId, arcs: ends };
  if (!deps.dispatch(remove).ok) {
    // The command recomputes the preview; it disagrees with this one only if the world changed in between.
    blockVertex(deps, vertexId, blockedReasons.mergeBlocked);
    return;
  }
  if (preview.kind === "collapsed") {
    deps.emit(preview.loop
      ? { kind: "curveShortening/freeLoopCollapsed", arcId: preview.arcIds[0]!, message: "The loop around a cone point shrank to a point and was removed." }
      : { kind: "curveShortening/collapsed", arcIds: preview.arcIds, message: "The tied geodesic shrank to a point and was removed." });
  }
}

// A vertex that can neither move nor merge destroys its whole curve, with a notice. A refused removal would be refused again next step, so the vertex goes quiet, with no notice.
function blockVertex(deps: FlowDeps, vertexId: string, reason: string): void {
  const arcIds = deps.model.arcsOfCurve(vertexId);
  const removal: GeodesicRemoveCurveCommand = { kind: "geodesicModel/removeCurve", arcIds };
  if (!deps.dispatch(removal).ok) {
    deps.quiet.add(vertexId);
    return;
  }
  deps.emit({ kind: "curveShortening/destroyed", vertexId, reason, arcIds, message: `The tied geodesic could not shorten any further and was removed (${reason}).` });
}
