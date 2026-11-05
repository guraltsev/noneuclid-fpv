/**
 * Endpoint attachments of geodesic intervals: lookup by anchor, re-attachment, lifting the far endpoint into the source cell, word-against-cell-chain checks, and emitter cache cleanup.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { transformPoint3 } from "../../math/rigidTransform3";
import type { RuntimeObjectReader, RuntimeObjectRegistry, RuntimeWorldObject } from "../runtimeObjectRegistry";
import { type GeodesicEndpointAttachment, type GeodesicEndpointSelection, type GeodesicEndRole, type GeodesicArcObject, type GeodesicPortalTraversal, type LiftedGeodesicEndpoint } from "./objects";
import { canObjectAttachGeodesics, getAnchorBeamPoint } from "./anchors";
import { reverseGeodesicPortalWord } from "./portalWord";
import { inversePortalTransform } from "./development";
import { arcIndex, noArcIndexEntries, type ArcEnd } from "./arcIndex";

// ---- Registry queries and edits of endpoint attachments ----

/**
 * Lists every interval endpoint attachment (start or end of any interval) whose anchor is `anchorObjectId`.
 *
 * An interval whose both ends attach to the same anchor appears twice (once per role). Order follows registry order.
 */
export function getGeodesicEndpointAttachmentsForAnchor(
  registry: RuntimeObjectReader,
  anchorObjectId: string,
): readonly GeodesicEndpointAttachment[] {
  return arcIndex.read(registry).attachmentsByAnchor.get(anchorObjectId) ?? noArcIndexEntries;
}

/**
 * Re-attaches one endpoint role of an interval to another anchor object and returns the updated interval.
 *
 * Returns `undefined` (and changes nothing) if the interval does not exist or the new anchor cannot attach geodesics.
 * Does NOT update `startCellId`, the portal word or the derived segments: the caller must keep them consistent and
 * rebuild. Side effect: deletes free ends that became unreferenced.
 */
export function replaceGeodesicEndpointAttachment(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
  endRole: GeodesicEndRole,
  nextAnchorObjectId: string,
): GeodesicArcObject | undefined {
  const interval = registry.get(geodesicId);
  if (interval?.kind !== "geodesicModel/arc" || !canObjectAttachGeodesics(registry.get(nextAnchorObjectId))) {
    return undefined;
  }

  const next: GeodesicArcObject = {
    ...interval,
    [endRole]: {
      geodesicId,
      role: endRole,
      anchorObjectId: nextAnchorObjectId,
    },
  };
  registry.update(next);
  removeUnusedFreeGeodesicEnds(registry);
  return next;
}

/** Returns the stored portal word of an interval (ordered `start` -> `end`), or `undefined` if `geodesicId` is not an interval. */
export function getGeodesicPortalWord(
  registry: RuntimeObjectReader,
  geodesicId: string,
): readonly GeodesicPortalTraversal[] | undefined {
  const interval = registry.get(geodesicId);
  return interval?.kind === "geodesicModel/arc" ? interval.portalWord : undefined;
}

/**
 * Develops an interval into the source endpoint's cell: pulls the opposite endpoint back through the inverse portal transforms.
 *
 * Math: let the word read from the source be `t_1 ... t_n` with `T_i` = `transformToTarget` of the portal of `t_i`
 * (source-cell frame to target-cell frame). The target anchor lives in the frame of the last target cell; applying
 * `T_n^{-1}`, then `T_{n-1}^{-1}`, ... , `T_1^{-1}` expresses it in the source cell's frame. The geodesic is then the
 * straight segment from `sourcePoint` to that pulled-back point (so both its direction and its length are read off the
 * x/y difference), and it is the unique locally straight path realizing this word between the two anchors.
 *
 * Returns `undefined` if either anchor is missing or cannot attach geodesics, or a traversal names a portal not in
 * `world`. Also returns `undefined` when the stored word does not chain from the start anchor's cell to the end anchor's
 * cell (`portalWordMatchesEndpointCellsWithAnchors`). It does not check that the lifted chord is long enough.
 * Units: meters; z of both points is the anchors' beam height.
 */
export function liftGeodesicEndpoint(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicArcObject;
  readonly sourceRole: GeodesicEndRole;
}): LiftedGeodesicEndpoint | undefined {
  const sourceAttachment = input.interval[input.sourceRole];
  const targetRole: GeodesicEndRole = input.sourceRole === "start" ? "end" : "start";
  const targetAttachment = input.interval[targetRole];
  const sourceAnchor = input.registry.get(sourceAttachment.anchorObjectId);
  const targetAnchor = input.registry.get(targetAttachment.anchorObjectId);
  if (!canObjectAttachGeodesics(sourceAnchor) || !canObjectAttachGeodesics(targetAnchor)) {
    return undefined;
  }
  if (!portalWordMatchesEndpointCellsWithAnchors({
    registry: input.registry,
    interval: input.interval,
    word: input.interval.portalWord,
  })) {
    return undefined;
  }

  const portalWordFromSourceToTarget = input.sourceRole === "start"
    ? input.interval.portalWord
    : reverseGeodesicPortalWord(input.interval.portalWord);
  const sourcePoint = getAnchorBeamPoint(sourceAnchor);
  let targetPointInSourceCell = getAnchorBeamPoint(targetAnchor);
  // Pull-back (development): the target anchor is expressed in the frame of the LAST target cell, so undo the traversals from the last
  // to the first: p <- T_i^{-1}(p). After the loop `targetPointInSourceCell` is in the source cell's frame and the geodesic is the
  // straight segment from `sourcePoint` to it. A traversal that names an unknown portal makes the lift fail.
  for (const traversal of portalWordFromSourceToTarget.slice().reverse()) {
    const portal = input.world.cellsById.get(traversal.sourceCellId)?.portalsById.get(traversal.sourcePortalId);
    if (!portal) {
      return undefined;
    }
    targetPointInSourceCell = transformPoint3(inversePortalTransform(portal), targetPointInSourceCell);
  }

  return {
    sourceRole: input.sourceRole,
    targetRole,
    sourceAnchorObjectId: sourceAttachment.anchorObjectId,
    targetAnchorObjectId: targetAttachment.anchorObjectId,
    sourceCellId: sourceAnchor.cellId,
    sourcePoint,
    targetPointInSourceCell,
    portalWordFromSourceToTarget,
  };
}

// Same as `liftGeodesicEndpoint`, but anchors found in `candidateAnchorsById` shadow the registry, so a tick can be
// previewed with a hypothetical free-end position without mutating the registry.
/** Lifts the far endpoint of an interval into the source cell, with candidate anchors that may differ from the registry. */
export function liftGeodesicEndpointWithAnchors(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicArcObject;
  readonly sourceRole: GeodesicEndRole;
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): LiftedGeodesicEndpoint | undefined {
  const sourceAttachment = input.interval[input.sourceRole];
  const targetRole: GeodesicEndRole = input.sourceRole === "start" ? "end" : "start";
  const targetAttachment = input.interval[targetRole];
  const sourceAnchor = input.candidateAnchorsById?.get(sourceAttachment.anchorObjectId) ??
    input.registry.get(sourceAttachment.anchorObjectId);
  const targetAnchor = input.candidateAnchorsById?.get(targetAttachment.anchorObjectId) ??
    input.registry.get(targetAttachment.anchorObjectId);
  if (!canObjectAttachGeodesics(sourceAnchor) || !canObjectAttachGeodesics(targetAnchor)) {
    return undefined;
  }
  if (!portalWordMatchesEndpointCellsWithAnchors({
    registry: input.registry,
    interval: input.interval,
    word: input.interval.portalWord,
    candidateAnchorsById: input.candidateAnchorsById,
  })) {
    return undefined;
  }

  const portalWordFromSourceToTarget = input.sourceRole === "start"
    ? input.interval.portalWord
    : reverseGeodesicPortalWord(input.interval.portalWord);
  const sourcePoint = getAnchorBeamPoint(sourceAnchor);
  let targetPointInSourceCell = getAnchorBeamPoint(targetAnchor);
  for (const traversal of portalWordFromSourceToTarget.slice().reverse()) {
    const portal = input.world.cellsById.get(traversal.sourceCellId)?.portalsById.get(traversal.sourcePortalId);
    if (!portal) {
      return undefined;
    }
    targetPointInSourceCell = transformPoint3(inversePortalTransform(portal), targetPointInSourceCell);
  }

  return {
    sourceRole: input.sourceRole,
    targetRole,
    sourceAnchorObjectId: sourceAttachment.anchorObjectId,
    targetAnchorObjectId: targetAttachment.anchorObjectId,
    sourceCellId: sourceAnchor.cellId,
    sourcePoint,
    targetPointInSourceCell,
    portalWordFromSourceToTarget,
  };
}

/** Maps a clicked segment (by id) to the endpoint attachment of its half, or `undefined` if it is not a half-labelled segment of an existing interval. */
export function resolveGeodesicEndpointSelectionFromSegmentHit(
  registry: RuntimeObjectRegistry,
  segmentId: string,
): GeodesicEndpointSelection | undefined {
  const segment = registry.get(segmentId);
  if (segment?.kind !== "geodesicModel/segment" || !segment.halfRole) {
    return undefined;
  }
  const interval = registry.get(segment.geodesicId);
  return interval?.kind === "geodesicModel/arc" ? interval[segment.halfRole] : undefined;
}

/** True when the interval's portal word leads from the start anchor's cell to the end anchor's cell. */
export function portalWordMatchesCurrentEndpointCells(
  registry: RuntimeObjectRegistry,
  interval: GeodesicArcObject,
  word: readonly GeodesicPortalTraversal[],
): boolean {
  return portalWordMatchesEndpointCellsWithAnchors({ registry, interval, word });
}

// A word is consistent when it chains (each target cell equals the next source cell) and runs from the start anchor's cell
// to the end anchor's cell; the empty word requires both anchors to share one cell. `candidateAnchorsById` shadows registry anchors.
/** Like `portalWordMatchesCurrentEndpointCells`, with candidate anchors that may differ from the registry. */
export function portalWordMatchesEndpointCellsWithAnchors(input: {
  readonly registry: RuntimeObjectRegistry;
  readonly interval: GeodesicArcObject;
  readonly word: readonly GeodesicPortalTraversal[];
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): boolean {
  const startAnchor = input.candidateAnchorsById?.get(input.interval.start.anchorObjectId) ??
    input.registry.get(input.interval.start.anchorObjectId);
  const endAnchor = input.candidateAnchorsById?.get(input.interval.end.anchorObjectId) ??
    input.registry.get(input.interval.end.anchorObjectId);
  if (!canObjectAttachGeodesics(startAnchor) || !canObjectAttachGeodesics(endAnchor)) {
    return false;
  }
  if (input.word.length === 0) {
    return startAnchor.cellId === endAnchor.cellId;
  }
  if (input.word[0].sourceCellId !== startAnchor.cellId || input.word.at(-1)?.targetCellId !== endAnchor.cellId) {
    return false;
  }
  return input.word.every((traversal, index) =>
    index === 0 || input.word[index - 1].targetCellId === traversal.sourceCellId
  );
}

// "Aimable free": an arc with exactly one emitter endpoint and one free-end endpoint that no other attachment shares.
/** True for an arc with one emitter endpoint and one vertex that no other arc end uses (a plain shot geodesic). */
export function isAimableFreeGeodesic(registry: RuntimeObjectRegistry, interval: GeodesicArcObject): boolean {
  const start = registry.get(interval.start.anchorObjectId);
  const end = registry.get(interval.end.anchorObjectId);
  const hasOneEmitter = (start?.kind === "geodesic-cannon") !== (end?.kind === "geodesic-cannon");
  const freeEnd = start?.kind === "geodesicModel/vertex" ? start : end?.kind === "geodesicModel/vertex" ? end : undefined;
  return hasOneEmitter && freeEnd !== undefined &&
    getGeodesicEndpointAttachmentsForAnchor(registry, freeEnd.id).length === 1;
}

// ---- Curves: end nodes, shared vertices and tied arcs ----

/** Both endpoint roles attached to the vertex (a loop on it contributes two), in registry insertion order. Read from the arc index; a frozen list. */
export function arcsAtVertex(registry: RuntimeObjectRegistry, vertexId: string): readonly ArcEnd[] {
  return arcIndex.read(registry).endsByAnchor.get(vertexId) ?? noArcIndexEntries;
}

/**
 * Visits the vertices with two or more arc ends in registry insertion order.
 * It loops by index over a frozen snapshot of the ids, so a visit that merges vertices is safe; the id may be gone when reached, and the visitor checks.
 */
export function forEachTiedVertex(registry: RuntimeObjectRegistry, visit: (vertexId: string) => void): void {
  const ids = arcIndex.read(registry).tiedVertexIds;
  for (let index = 0; index < ids.length; index += 1) {
    visit(ids[index]!);
  }
}

/** Number of vertices with two or more arc ends (closed loops included). */
export function tiedVertexCount(registry: RuntimeObjectRegistry): number {
  return arcIndex.read(registry).tiedVertexIds.length;
}

/** True when some arc other than `arcId` has an end on `anchorObjectId`. */
function hasOtherArcAt(arcIds: ReadonlyMap<string, readonly string[]>, anchorObjectId: string, arcId: string): boolean {
  const ids = arcIds.get(anchorObjectId);
  if (ids === undefined) return false;
  for (let index = 0; index < ids.length; index += 1) {
    if (ids[index] !== arcId) return true;
  }
  return false;
}

/** True when the anchor is a vertex shared with an end of some arc other than `arcId`. Allocation-free: called by the carry paths. */
export function isVertexSharedWithOtherArc(registry: RuntimeObjectRegistry, anchorObjectId: string, arcId: string): boolean {
  if (registry.get(anchorObjectId)?.kind !== "geodesicModel/vertex") {
    return false;
  }
  return hasOtherArcAt(arcIndex.read(registry).arcIdsByAnchor, anchorObjectId, arcId);
}

/** The arc has an end on a vertex that another arc end shares. A closed loop on one vertex is not tied; an id that is not an arc is not tied. Allocation-free. */
export function isTied(registry: RuntimeObjectReader, arcId: string): boolean {
  const arc = registry.get(arcId);
  if (arc?.kind !== "geodesicModel/arc") {
    return false;
  }
  const startIsVertex = registry.get(arc.start.anchorObjectId)?.kind === "geodesicModel/vertex";
  const endIsVertex = registry.get(arc.end.anchorObjectId)?.kind === "geodesicModel/vertex";
  if (!startIsVertex && !endIsVertex) {
    return false;
  }
  const arcIds = arcIndex.read(registry).arcIdsByAnchor;
  return (startIsVertex && hasOtherArcAt(arcIds, arc.start.anchorObjectId, arcId)) ||
    (endIsVertex && hasOtherArcAt(arcIds, arc.end.anchorObjectId, arcId));
}

/** The arc's last rebuild failed during a carry, so it still shows its old path. */
export function isStale(registry: RuntimeObjectRegistry, arcId: string): boolean {
  const arc = registry.get(arcId);
  return arc?.kind === "geodesicModel/arc" && arc.stale === true;
}

/** Every arc of the curve through the vertex, walked over shared vertices, in discovery order. Empty for an id that is not a vertex. */
export function arcsOfCurve(registry: RuntimeObjectRegistry, vertexId: string): readonly string[] {
  if (registry.get(vertexId)?.kind !== "geodesicModel/vertex") {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>();
  const visitedVertices = new Set<string>();
  const queue = [vertexId];
  for (let next = 0; next < queue.length; next += 1) {
    const current = queue[next]!;
    if (visitedVertices.has(current)) {
      continue;
    }
    visitedVertices.add(current);
    for (const end of arcsAtVertex(registry, current)) {
      if (seen.has(end.arcId)) {
        continue;
      }
      seen.add(end.arcId);
      found.push(end.arcId);
      const arc = registry.get(end.arcId);
      if (arc?.kind !== "geodesicModel/arc") {
        continue;
      }
      for (const role of ["start", "end"] as const) {
        const anchorId = arc[role].anchorObjectId;
        if (registry.get(anchorId)?.kind === "geodesicModel/vertex") {
          queue.push(anchorId);
        }
      }
    }
  }
  return found;
}

/** The arcs of the curve an arc belongs to: the arc itself and, through each vertex end, `arcsOfCurve`. Empty for an id that is not an arc. */
export function arcsOfCurveContaining(registry: RuntimeObjectRegistry, arcId: string): readonly string[] {
  const arc = registry.get(arcId);
  if (arc?.kind !== "geodesicModel/arc") {
    return [];
  }
  const ids = new Set<string>([arcId]);
  for (const role of ["start", "end"] as const) {
    for (const id of arcsOfCurve(registry, arc[role].anchorObjectId)) {
      ids.add(id);
    }
  }
  return [...ids];
}

/** Removes free-end anchors that no interval attaches to any more. */
export function removeUnusedFreeGeodesicEnds(registry: RuntimeObjectRegistry): void {
  for (const object of registry.getObjectsOfKind("geodesicModel/vertex")) {
    if (getGeodesicEndpointAttachmentsForAnchor(registry, object.id).length === 0) {
      registry.remove(object.id);
    }
  }
}

/** Ids of the geodesics attached to an emitter (either end), each once, in registry order. This is the only record of which geodesics belong to an emitter. */
export function getEmitterGeodesicIds(registry: RuntimeObjectReader, emitterId: string): readonly string[] {
  return arcIndex.read(registry).arcIdsByAnchor.get(emitterId) ?? noArcIndexEntries;
}
