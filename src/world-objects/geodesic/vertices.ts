/**
 * Operations on the vertices of a piecewise-geodesic curve (design 013 section 13.1): the arcs at a vertex, their tangents and length, moving a vertex
 * (each incident arc keeps its homotopy class: its word changes exactly by the portals the vertex crosses), removing a vertex by merging its two arcs, and
 * tying two endpoint roles of an emitter at a new vertex. They are the operations of the `geodesicModel` module; the module is a facade over this file.
 *
 * A preview computes what an operation would give and writes nothing (the registry version is unchanged); a commit applies a preview. Only a
 * `geodesicModel/vertex` is a vertex: an end node (an arc end on an emitter) is moved by its emitter, never by these operations.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { walkDevelopedSegment } from "../../cell-complex/segmentWalk";
import { transformPoint3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../runtimeObjectRegistry";
import {
  createGeodesicArcObject,
  createGeodesicVertexObject,
  GEODESIC_MIN_LENGTH_METERS,
  getGeodesicCannonEmitterPoint,
  getOppositeEndRole,
  reduceAdjacentInversePortalTraversals,
  type GeodesicArcObject,
  type GeodesicEndpointSelection,
  type GeodesicEndRole,
  type GeodesicPortalTraversal,
  type GeodesicSegmentObject,
  type TraceGeodesicSegmentResult,
} from "./objects";
import { canObjectAttachGeodesics } from "./anchors";
import { getPortalWordBetweenEndpointRoles, reverseGeodesicPortalWord, samePortalWord } from "./portalWord";
import { requestGeodesicIntersectionUpdate, withDeferredGeodesicIntersections } from "./intersections";
import {
  liftGeodesicEndpointWithAnchors,
  removeUnusedFreeGeodesicEnds,
  type ArcEnd,
} from "./endpoints";
import {
  getGeodesicSegments,
  getGeodesicTotalLengthMeters,
  removeGeodesicIntervalAndDerivedObjects,
  removeGeodesicSegments,
  replaceDerivedSegmentsFromTraces,
} from "./segments";
import { arcConnectsEmitters } from "./lifecycle";
import { previewRebuildGeodesicInterval, rebuildDerivedGeodesicSegments } from "./intervals";

/** Turning angle (radians) below which a vertex counts as taut: its two arcs are one geodesic and the vertex is removed. */
export const vertexTautTurnRadians = 5e-3;

/** A blocked loop shorter than this has no room left to shrink: it is on its way to the cone point it encircles and is deleted. */
const loopCollapseLengthMeters = GEODESIC_MIN_LENGTH_METERS * 4;

/** Unit tangent of an arc at a vertex, pointing away from it, in the vertex's cell frame, with the arc's chord length. */
export interface ArcTangent {
  readonly x: number;
  readonly y: number;
  readonly lengthMeters: number;
}

/** The result of {@link previewVertexMove}: the new vertex record and the realized arcs, opaque to callers. */
export interface VertexMovePreview {
  readonly vertexId: string;
  readonly lengthAfterMeters: number;
  /** Opaque to callers: the new vertex record and the realized arcs. */
  readonly internal: unknown;
}

/** What removing a vertex would give: a merged arc, a taut loop, a collapsed curve, or blocked. */
export type VertexRemovalPreview =
  | { readonly kind: "merge"; readonly mergedArcId: string; readonly removedArcId: string; readonly internal: unknown }
  | { readonly kind: "loopTaut"; readonly arcId: string }
  | { readonly kind: "collapsed"; readonly arcIds: readonly string[]; readonly loop: boolean }
  | { readonly kind: "blocked"; readonly reason: "loopBlocked" | "mergeBlocked" | "anchor" | "missingArc" };

interface MovePreviewInternal {
  readonly vertex: Extract<RuntimeWorldObject, { readonly kind: "geodesicModel/vertex" }>;
  readonly arcs: readonly { readonly arc: GeodesicArcObject; readonly traces: readonly TraceGeodesicSegmentResult[] }[];
}

interface MergePreviewInternal {
  readonly vertexId: string;
  readonly firstArcId: string;
  readonly secondArcId: string;
  readonly merged: GeodesicArcObject;
  readonly traces: readonly TraceGeodesicSegmentResult[];
  /** The merged arc connects emitters and an equal arc exists already: both arcs are deleted. */
  readonly duplicate: boolean;
}

type VertexObject = Extract<RuntimeWorldObject, { readonly kind: "geodesicModel/vertex" }>;

function vertexOf(registry: RuntimeObjectRegistry, vertexId: string): VertexObject | undefined {
  const vertex = registry.get(vertexId);
  return vertex?.kind === "geodesicModel/vertex" ? vertex : undefined;
}

function movedVertex(vertex: VertexObject, cellId: string, x: number, y: number): VertexObject {
  return {
    ...vertex,
    cellId,
    localPose: { ...vertex.localPose, translation: { x, y, z: vertex.localPose.translation.z } },
  };
}

// Unit tangent of an arc at a vertex, pointing away from it, in the vertex's own cell frame; `candidates` shadow the registry's anchors.
function tangentAwayFromVertex(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  end: ArcEnd,
  candidates: ReadonlyMap<string, RuntimeWorldObject> | undefined,
): ArcTangent | undefined {
  const arc = registry.get(end.arcId);
  if (arc?.kind !== "geodesicModel/arc") {
    return undefined;
  }
  const lifted = liftGeodesicEndpointWithAnchors({
    world,
    registry,
    interval: arc,
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

/**
 * Tangents of the arcs at the vertex; with `displacedTo`, as if the vertex stood at that point of its own cell (no portal walk).
 * `undefined` if the id is not a vertex or an arc cannot be lifted.
 */
export function arcTangentsAtVertex(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  vertexId: string,
  arcs: readonly ArcEnd[],
  displacedTo?: { readonly x: number; readonly y: number },
): readonly ArcTangent[] | undefined {
  const vertex = vertexOf(registry, vertexId);
  if (!vertex) {
    return undefined;
  }
  const candidates = displacedTo
    ? new Map<string, RuntimeWorldObject>([[vertex.id, movedVertex(vertex, vertex.cellId, displacedTo.x, displacedTo.y)]])
    : undefined;
  const tangents: ArcTangent[] = [];
  for (const end of arcs) {
    const tangent = tangentAwayFromVertex(world, registry, end, candidates);
    if (!tangent) {
      return undefined;
    }
    tangents.push(tangent);
  }
  return tangents;
}

/**
 * The derivative of the total length of the arcs at the vertex along `direction`, with the vertex displaced to `displacedTo` of its own cell:
 * minus the sum of the dot products of `direction` with the tangents. Same lifts as {@link arcTangentsAtVertex}, without the array (the line
 * search of the flow calls it dozens of times per step). `undefined` if the id is not a vertex or an arc cannot be lifted.
 */
export function lengthSlopeAtVertex(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  vertexId: string,
  arcs: readonly ArcEnd[],
  direction: { readonly x: number; readonly y: number },
  displacedTo: { readonly x: number; readonly y: number },
): number | undefined {
  const vertex = vertexOf(registry, vertexId);
  if (!vertex) {
    return undefined;
  }
  const candidates = new Map<string, RuntimeWorldObject>([[vertex.id, movedVertex(vertex, vertex.cellId, displacedTo.x, displacedTo.y)]]);
  let total = 0;
  for (let index = 0; index < arcs.length; index += 1) {
    const tangent = tangentAwayFromVertex(world, registry, arcs[index]!, candidates);
    if (!tangent) {
      return undefined;
    }
    total -= direction.x * tangent.x + direction.y * tangent.y;
  }
  return total;
}

/** Total length (meters) of the distinct arcs among `arcs`. */
export function lengthOfArcs(registry: RuntimeObjectRegistry, arcs: readonly ArcEnd[]): number {
  return [...new Set(arcs.map(({ arcId }) => arcId))]
    .reduce((total, id) => total + getGeodesicTotalLengthMeters(registry, id), 0);
}

// The arc after its `role` end moved over the portals `crossings` into `newCellId`: the word is extended at the end or prefixed
// (inverted) at the start, then freely reduced; a moved start also moves the arc's start cell.
function withVertexCrossings(
  arc: GeodesicArcObject,
  role: GeodesicEndRole,
  crossings: readonly GeodesicPortalTraversal[],
  newCellId: string,
): GeodesicArcObject {
  if (crossings.length === 0) {
    return role === "start" ? { ...arc, cellId: newCellId, startCellId: newCellId } : arc;
  }
  if (role === "end") {
    return { ...arc, portalWord: reduceAdjacentInversePortalTraversals([...arc.portalWord, ...crossings]) };
  }
  return {
    ...arc,
    cellId: newCellId,
    startCellId: newCellId,
    portalWord: reduceAdjacentInversePortalTraversals([...reverseGeodesicPortalWord(crossings), ...arc.portalWord]),
  };
}

/**
 * Walks the vertex `lengthMeters` along `direction` (vertex cell frame) through portals, updates the words of the arcs by the portals crossed and
 * realizes each arc as the geodesic chord of its class. Writes nothing. `undefined` if the id is not a vertex, the walk or a chord fails (a wall, a
 * forbidden zone, a different realized class, a degenerate chord).
 */
export function previewVertexMove(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  input: {
    readonly vertexId: string;
    readonly arcs: readonly ArcEnd[];
    readonly direction: { readonly x: number; readonly y: number };
    readonly lengthMeters: number;
  },
): VertexMovePreview | undefined {
  const vertex = vertexOf(registry, input.vertexId);
  if (!vertex) {
    return undefined;
  }
  const { direction, lengthMeters } = input;
  const origin = vertex.localPose.translation;
  const walk = walkDevelopedSegment({
    world,
    cellId: vertex.cellId,
    start: { x: origin.x, y: origin.y },
    direction,
    lengthMeters,
  });
  const lastPiece = walk.pieces.at(-1);
  if (walk.status !== "end" || !lastPiece) {
    return undefined;
  }
  const local = transformPoint3(lastPiece.cellFromStart, vec3(origin.x + direction.x * lengthMeters, origin.y + direction.y * lengthMeters, 0));
  const crossings: GeodesicPortalTraversal[] = walk.crossings.map((crossing) => ({
    sourceCellId: crossing.sourceCellId,
    sourcePortalId: crossing.portalId,
    targetCellId: crossing.targetCellId,
    targetPortalId: crossing.targetPortalId,
  }));
  const next = movedVertex(vertex, lastPiece.cellId, local.x, local.y);

  const updated = new Map<string, GeodesicArcObject>();
  for (const end of input.arcs) {
    const arc = updated.get(end.arcId) ?? registry.get(end.arcId);
    if (arc?.kind !== "geodesicModel/arc" || arc[end.role].anchorObjectId !== vertex.id) {
      return undefined;
    }
    updated.set(end.arcId, withVertexCrossings(arc, end.role, crossings, lastPiece.cellId));
  }
  const candidates = new Map<string, RuntimeWorldObject>([[vertex.id, next]]);
  const arcs: { arc: GeodesicArcObject; traces: readonly TraceGeodesicSegmentResult[] }[] = [];
  let lengthAfter = 0;
  for (const arc of updated.values()) {
    const preview = previewRebuildGeodesicInterval({ world, registry, interval: arc, candidateAnchorsById: candidates });
    if (!preview) {
      return undefined;
    }
    arcs.push({ arc, traces: preview.traces });
    lengthAfter += preview.traces.reduce((total, trace) => total + trace.lengthMeters, 0);
  }
  const internal: MovePreviewInternal = { vertex: next, arcs };
  return { vertexId: vertex.id, lengthAfterMeters: lengthAfter, internal };
}

/** Applies a {@link previewVertexMove}: the vertex, the arcs with their new words and their realized segments. */
export function commitVertexMove(registry: RuntimeObjectRegistry, preview: VertexMovePreview): void {
  const moved = preview.internal as MovePreviewInternal;
  withDeferredGeodesicIntersections(registry, () => {
    registry.update(moved.vertex);
    for (const { arc, traces } of moved.arcs) {
      registry.update(arc);
      replaceDerivedSegmentsFromTraces({ registry, geodesicId: arc.id, traces });
    }
  });
}

// Finds an arc that is the same geodesic as `candidate` among the arcs that connect emitters: same two endpoint anchors and the same portal word, read in
// either direction (A -> B with word w equals B -> A with the inverse word). The word, not just the anchor pair, is the identity:
// two emitters can be joined by several distinct geodesics in different homotopy classes, and those must stay separate.
function findEquivalentConnectingArc(
  registry: RuntimeObjectRegistry,
  candidate: GeodesicArcObject,
  excludedIds: readonly string[],
): GeodesicArcObject | undefined {
  const reversedCandidateWord = reverseGeodesicPortalWord(candidate.portalWord);
  return registry.getObjectsOfKind("geodesicModel/arc").find((object) =>
    arcConnectsEmitters(registry, object.id) &&
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

/**
 * What removing the vertex would give (writes nothing). The vertex must have exactly the two arc ends `arcs`.
 *
 * - `merge`: the two arcs join into one from the far anchor of the first to the far anchor of the second, with the reduced concatenation of the words; or,
 *   when the merged arc connects emitters and an equal arc exists, both are deleted.
 * - `loopTaut`: a loop on the vertex whose turning angle is below {@link vertexTautTurnRadians}; the vertex stays.
 * - `collapsed`: the arcs shrank to a point (a loop below four times the minimum length, or a merged chord shorter than the minimum): the curve is deleted.
 * - `blocked`: a loop that cannot shrink further, a merge whose chord cannot be realized (a wall or forbidden zone would need an inserted wrap vertex), an
 *   anchor that cannot attach geodesics, an arc that is missing, or an id that is not a vertex.
 */
export function previewVertexRemoval(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  input: { readonly vertexId: string; readonly arcs: readonly ArcEnd[] },
): VertexRemovalPreview {
  if (!vertexOf(registry, input.vertexId)) {
    return { kind: "blocked", reason: "anchor" };
  }
  const { arcs: ends } = input;
  if (ends.length !== 2) {
    return { kind: "blocked", reason: "missingArc" };
  }
  const [firstEnd, secondEnd] = ends as [ArcEnd, ArcEnd];
  const firstArc = registry.get(firstEnd.arcId);
  const secondArc = registry.get(secondEnd.arcId);
  if (firstArc?.kind !== "geodesicModel/arc" || secondArc?.kind !== "geodesicModel/arc") {
    return { kind: "blocked", reason: "missingArc" };
  }

  if (firstArc.id === secondArc.id) {
    const length = getGeodesicTotalLengthMeters(registry, firstArc.id);
    const tangents = arcTangentsAtVertex(world, registry, input.vertexId, ends);
    const straight = tangents !== undefined &&
      Math.hypot(tangents[0]!.x + tangents[1]!.x, tangents[0]!.y + tangents[1]!.y) < vertexTautTurnRadians;
    if (straight) {
      return { kind: "loopTaut", arcId: firstArc.id };
    }
    if (length < loopCollapseLengthMeters) {
      return { kind: "collapsed", arcIds: [firstArc.id], loop: true };
    }
    return { kind: "blocked", reason: "loopBlocked" };
  }

  const anchorA = registry.get(firstArc[getOppositeEndRole(firstEnd.role)].anchorObjectId);
  const anchorB = registry.get(secondArc[getOppositeEndRole(secondEnd.role)].anchorObjectId);
  if (!canObjectAttachGeodesics(anchorA) || !canObjectAttachGeodesics(anchorB)) {
    return { kind: "blocked", reason: "anchor" };
  }
  const word = reduceAdjacentInversePortalTraversals([
    ...getPortalWordBetweenEndpointRoles({ interval: firstArc, sourceRole: getOppositeEndRole(firstEnd.role), targetRole: firstEnd.role }),
    ...getPortalWordBetweenEndpointRoles({ interval: secondArc, sourceRole: secondEnd.role, targetRole: getOppositeEndRole(secondEnd.role) }),
  ]);
  const mergedId = [firstArc.id, secondArc.id].sort()[0]!;
  const removedId = mergedId === firstArc.id ? secondArc.id : firstArc.id;
  const merged = createGeodesicArcObject({
    id: mergedId,
    startAnchorObjectId: anchorA.id,
    endAnchorObjectId: anchorB.id,
    startCellId: anchorA.cellId,
    portalWord: word,
  });
  const preview = previewRebuildGeodesicInterval({ world, registry, interval: merged });
  if (!preview) {
    const lifted = liftGeodesicEndpointWithAnchors({ world, registry, interval: merged, sourceRole: "start" });
    if (lifted && Math.hypot(
      lifted.targetPointInSourceCell.x - lifted.sourcePoint.x,
      lifted.targetPointInSourceCell.y - lifted.sourcePoint.y,
    ) < GEODESIC_MIN_LENGTH_METERS) {
      return { kind: "collapsed", arcIds: [firstArc.id, secondArc.id], loop: false };
    }
    return { kind: "blocked", reason: "mergeBlocked" };
  }

  // A merged arc between two emitters that repeats an existing arc is discarded in its favour.
  const connects = registry.get(anchorA.id)?.kind === "geodesic-cannon" && registry.get(anchorB.id)?.kind === "geodesic-cannon";
  const duplicate = connects && findEquivalentConnectingArc(registry, merged, [firstArc.id, secondArc.id]) !== undefined;
  const internal: MergePreviewInternal = {
    vertexId: input.vertexId,
    firstArcId: firstArc.id,
    secondArcId: secondArc.id,
    merged,
    traces: preview.traces,
    duplicate,
  };
  return { kind: "merge", mergedArcId: mergedId, removedArcId: removedId, internal };
}

/**
 * Applies a {@link previewVertexRemoval} and returns the arc ids that changed or were removed (empty for `blocked`; the loop for `loopTaut`, which
 * changes nothing). A `merge` overwrites the arc with the smaller id and removes the other, then the vertex; a duplicate merge removes both arcs.
 */
export function removeVertex(registry: RuntimeObjectRegistry, vertexId: string, preview: VertexRemovalPreview): readonly string[] {
  return withDeferredGeodesicIntersections(registry, () => removeVertexNow(registry, vertexId, preview));
}

function removeVertexNow(registry: RuntimeObjectRegistry, vertexId: string, preview: VertexRemovalPreview): readonly string[] {
  switch (preview.kind) {
    case "blocked":
      return [];
    case "loopTaut":
      return [preview.arcId];
    case "collapsed":
      for (const arcId of preview.arcIds) {
        removeGeodesicIntervalAndDerivedObjects(registry, arcId);
      }
      if (registry.get(vertexId)) {
        registry.remove(vertexId);
      }
      return preview.arcIds;
    case "merge": {
      const { firstArcId, secondArcId, merged, traces, duplicate } = preview.internal as MergePreviewInternal;
      if (duplicate) {
        removeGeodesicIntervalAndDerivedObjects(registry, firstArcId);
        removeGeodesicIntervalAndDerivedObjects(registry, secondArcId);
        if (registry.get(vertexId)) {
          registry.remove(vertexId);
        }
        return [firstArcId, secondArcId];
      }
      // The merged arc overwrites the one with the smaller id and the other goes last, so that the vertex sweep of its removal finds the
      // merged arc already detached from the vertex.
      registry.update(merged);
      removeGeodesicIntervalAndDerivedObjects(registry, preview.removedArcId);
      if (registry.get(vertexId)) {
        registry.remove(vertexId);
      }
      replaceDerivedSegmentsFromTraces({ registry, geodesicId: merged.id, traces });
      return [merged.id, preview.removedArcId];
    }
  }
}

/** Why {@link tieAtNewVertex} changed nothing. */
export type TieAtNewVertexRefusal = "sameEndpoint" | "notAnEmitter" | "notAttached" | "notConnected" | "rebuildFailed";

/** Result of {@link tieAtNewVertex}. */
export type TieAtNewVertexResult =
  | { readonly ok: true; readonly vertexId: string; readonly arcIds: readonly string[] }
  | { readonly ok: false; readonly reason: TieAtNewVertexRefusal };

/**
 * Detaches two endpoint roles from one emitter and ties them at a new vertex born at the emitter's beam point, so the geometry does not change at tie time.
 *
 * Preconditions: `first` and `second` are different `(geodesicId, role)` pairs (the two roles of ONE arc are allowed: a loop based at the emitter); both
 * attachments currently point at `detachedEmitterId`; every affected arc exists and connects emitters. On success the selected roles are re-attached to the new
 * vertex and the arcs are rebuilt from their stored words (their homotopy classes are preserved). A rebuild failure rolls back every arc and segment and removes
 * the vertex: the geometry does not change at tie time, so a failure is numerical and never a reason to delete a geodesic. `createVertexId` is called at most once.
 */
export function tieAtNewVertex(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  request: {
    readonly detachedEmitterId: string;
    readonly first: GeodesicEndpointSelection;
    readonly second: GeodesicEndpointSelection;
    readonly createVertexId: () => string;
  },
): TieAtNewVertexResult {
  return withDeferredGeodesicIntersections(registry, () => tieAtNewVertexNow(world, registry, request));
}

function tieAtNewVertexNow(
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  request: Parameters<typeof tieAtNewVertex>[2],
): TieAtNewVertexResult {
  if (request.first.geodesicId === request.second.geodesicId && request.first.role === request.second.role) {
    return { ok: false, reason: "sameEndpoint" };
  }
  const detached = registry.get(request.detachedEmitterId);
  if (detached?.kind !== "geodesic-cannon") {
    return { ok: false, reason: "notAnEmitter" };
  }
  const firstArc = registry.get(request.first.geodesicId);
  const secondArc = registry.get(request.second.geodesicId);
  if (firstArc?.kind !== "geodesicModel/arc" || secondArc?.kind !== "geodesicModel/arc") {
    return { ok: false, reason: "notAttached" };
  }
  // Distinct arcs only: when both selections name the same arc (start and end of a loop) it is rewired and rebuilt once.
  const affected = uniqueArcs([firstArc, secondArc]);
  if (
    firstArc[request.first.role].anchorObjectId !== detached.id ||
    secondArc[request.second.role].anchorObjectId !== detached.id
  ) {
    return { ok: false, reason: "notAttached" };
  }
  if (!affected.every((arc) => arcConnectsEmitters(registry, arc.id))) {
    return { ok: false, reason: "notConnected" };
  }

  // The vertex is born exactly at the emitter's beam point, so the two endpoint roles (which already coincide there) move from the emitter
  // to the vertex without any visible change.
  const vertex = createGeodesicVertexObject({
    id: request.createVertexId(),
    cellId: detached.cellId,
    point: getGeodesicCannonEmitterPoint(detached),
  });
  // Snapshot for rollback: the arcs themselves are in `affected`, their derived segment chains are saved here.
  const originalSegmentsByArcId = new Map(
    affected.map((arc) => [arc.id, getGeodesicSegments(registry, arc.id)]),
  );
  registry.add(vertex);
  for (const arc of affected) {
    // Re-wire only the selected roles; each arc keeps its portalWord and the other end's anchor. For a loop, both `start` and `end` of the same arc
    // end up on the vertex.
    const selects = (role: GeodesicEndRole): boolean =>
      arc.id === request.first.geodesicId && request.first.role === role ||
      arc.id === request.second.geodesicId && request.second.role === role;
    const next: GeodesicArcObject = {
      ...arc,
      start: selects("start") ? { geodesicId: arc.id, role: "start", anchorObjectId: vertex.id } : arc.start,
      end: selects("end") ? { geodesicId: arc.id, role: "end", anchorObjectId: vertex.id } : arc.end,
    };
    registry.update(next);
    // Rebuild failed (note: rebuildDerivedGeodesicSegments itself deletes a degenerate arc, so a restored arc is re-added). Restore the original arcs,
    // segments and emitter attachments and discard the vertex, leaving the world as before the request.
    if (!rebuildDerivedGeodesicSegments({ world, registry, geodesicId: arc.id })) {
      restoreArcsAndSegments(registry, affected, originalSegmentsByArcId);
      registry.remove(vertex.id);
      removeUnusedFreeGeodesicEnds(registry);
      requestGeodesicIntersectionUpdate(registry);
      return { ok: false, reason: "rebuildFailed" };
    }
  }
  requestGeodesicIntersectionUpdate(registry);
  return { ok: true, vertexId: vertex.id, arcIds: affected.map((arc) => arc.id) };
}

// De-duplicates arcs by id (a loop names the same arc twice), keeping the last occurrence.
function uniqueArcs(arcs: readonly GeodesicArcObject[]): readonly GeodesicArcObject[] {
  const byId = new Map<string, GeodesicArcObject>();
  for (const arc of arcs) {
    byId.set(arc.id, arc);
  }
  return [...byId.values()];
}

// Rollback helper: puts back saved arcs (re-adding any that were deleted) together with their saved segment chains.
function restoreArcsAndSegments(
  registry: RuntimeObjectRegistry,
  arcs: readonly GeodesicArcObject[],
  segmentsByArcId: ReadonlyMap<string, readonly GeodesicSegmentObject[]>,
): void {
  for (const arc of arcs) {
    if (registry.get(arc.id)?.kind === "geodesicModel/arc") {
      registry.update(arc);
    } else {
      registry.add(arc);
    }
    removeGeodesicSegments(registry, arc.id);
    for (const segment of segmentsByArcId.get(arc.id) ?? []) {
      registry.add(segment);
    }
  }
}
