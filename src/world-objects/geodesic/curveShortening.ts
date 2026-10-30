/**
 * Curve shortening: tie-and-detach of two endpoint roles into a curve-shortening pair, and its exact resolution in one tick.
 * Tying detaches two roles of an emitter onto a shared free end F without changing the geometry. The next `advanceCurveShorteningPairs` call replaces the pair (two arcs tied at F, or one free loop on F) by the shortest path of its homotopy class: the fused portal word is developed into a sleeve (`sleeve.ts`) and the taut string through it is the straight chord, or a polygon whose corners wrap the forbidden-zone disks at portal junctions. Corners become pinned `GeodesicCornerObject` anchors, the result a chain of stable locked intervals. A free loop whose holonomy rotates (it encircles a cone point) is deleted with a notice. Failures change nothing except marking the pair `"unresolved"`.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { forbiddenPortalJunctionRadiusMeters } from "../../cell-complex/forbiddenZones";
import { walkDevelopedSegment } from "../../cell-complex/segmentWalk";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  orthonormalizeYawRigidTransform3,
  transformDirection3,
  transformPoint3,
  type RigidTransform3,
} from "../../math/rigidTransform3";
import { lengthVec2, subVec2 } from "../../math/vec2";
import { vec3 } from "../../math/vec3";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../runtimeObjectRegistry";
import { developSleeve, geodesicCornerClearanceMeters, solveTautPath } from "./sleeve";
import {
  canObjectAttachGeodesics,
  createCurveShorteningPairObject,
  createFreeGeodesicEndObject,
  createGeodesicCornerObject,
  createGeodesicIntervalObject,
  type CurveShorteningPairObject,
  GEODESIC_MIN_LENGTH_METERS,
  type GeodesicCornerObject,
  type GeodesicEndpointSelection,
  type GeodesicIntervalObject,
  type GeodesicPortalTraversal,
  type GeodesicSegmentObject,
  getAnchorBeamPoint,
  getGeodesicCannonEmitterPoint,
  getOppositeEndRole,
  isCurveShorteningPairObject,
} from "./objects";
import {
  getPortalWordBetweenEndpointRoles,
  reduceAdjacentInversePortalTraversals,
  reverseGeodesicPortalWord,
  samePortalWord,
} from "./portalWord";
import { updateGeodesicIntersectionObjects } from "./intersections";
import { removeUnusedFreeGeodesicEnds } from "./endpoints";
import {
  getGeodesicSegments,
  removeGeodesicIntervalAndDerivedObjects,
  removeGeodesicSegments,
  syncLegacyEmitterGeodesicFields,
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

/** Request for `advanceCurveShorteningPairs`: resolve every moving pair (the time step only gates the call; a pair is resolved in one tick). */
export interface AdvanceCurveShorteningPairsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  /** Receives the notices of the resolution (collapsed loops and geodesics, unresolved pairs). */
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
 * the next `advanceCurveShorteningPairs` call resolves it.
 *
 * Returns `undefined` on failed preconditions (nothing changed) or when a rebuild fails. Any rebuild failure rolls back all intervals
 * and segments and removes the free end: the geometry does not change at tie time, so a failure is numerical and never a reason to
 * delete a geodesic. Ids come from `createFreeEndId`/`createPairId`, each called at most once.
 */
export function tieAndDetachGeodesicEndpoints(
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
      updateGeodesicIntersectionObjects(request.registry);
      return undefined;
    }
    syncLegacyEmitterGeodesicFields(request.registry, interval.id);
  }

  // The pair remembers where the free end was born (the emitter's beam point).
  const pair = createCurveShorteningPairObject({
    id: request.createPairId(),
    first: { geodesicId: request.first.geodesicId, role: request.first.role, anchorObjectId: freeEnd.id },
    second: { geodesicId: request.second.geodesicId, role: request.second.role, anchorObjectId: freeEnd.id },
    freeEndAnchorId: freeEnd.id,
    lastGoodFreeEndCellId: freeEnd.cellId,
    lastGoodFreeEndPoint: getAnchorBeamPoint(freeEnd),
  });
  request.registry.add(pair);
  updateGeodesicIntersectionObjects(request.registry);
  return pair;
}

// ---- Curve shortening ----

/**
 * Resolves every `"moving"` curve-shortening pair completely, in this one call, and returns the ids that changed.
 *
 * Each pair is handed to `resolveCurveShorteningPair`: it is replaced by the length-minimizing path of its homotopy class (the straight
 * chord, or a taut string around the forbidden-zone disks made of stable intervals joined at pinned corner anchors), or deleted when
 * the result is a point, or set `"unresolved"` (and skipped by later calls) when it cannot be resolved. There is no animation and no
 * gradient descent. `"unresolved"` pairs are skipped.
 *
 * Returns the unique ids that changed: the new intervals, then the deleted arcs, then the pair id when the pair was deleted or set
 * unresolved, so that the caller can refresh or drop measurements and angles that refer to them. Returns `[]` when `deltaSeconds` is
 * not positive. Notices go to `onNotice`.
 */
export function advanceCurveShorteningPairs(
  request: AdvanceCurveShorteningPairsRequest,
): readonly string[] {
  if (!(request.deltaSeconds > 0)) {
    return [];
  }
  const changed: string[] = [];
  for (const pair of request.registry.getAll().filter(isCurveShorteningPairObject)) {
    if (pair.state !== "moving" || request.registry.get(pair.id)?.kind !== "curve-shortening-pair") {
      continue;
    }
    const result = resolveCurveShorteningPair({
      world: request.world,
      registry: request.registry,
      pairId: pair.id,
      onNotice: request.onNotice,
    });
    if (result.status === "resolved") {
      changed.push(...result.geodesicIds, ...result.removedIds);
    } else if (result.status === "deleted") {
      changed.push(...result.removedIds, pair.id);
    } else {
      changed.push(pair.id);
    }
  }
  if (changed.length > 0) {
    updateGeodesicIntersectionObjects(request.registry);
  }
  return [...new Set(changed)];
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
  return registry.getAll().find((object): object is GeodesicIntervalObject =>
    object.kind === "geodesic-interval" &&
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

// Ends a curve-shortening pair whose fused result would duplicate `existing`: deletes the moving arcs, the free end and the pair, and
// keeps the geodesic that is already there.
function discardCurveShorteningPairInFavorOf(
  registry: RuntimeObjectRegistry,
  pair: CurveShorteningPairObject,
  intervals: readonly GeodesicIntervalObject[],
  existing: GeodesicIntervalObject,
): GeodesicIntervalObject {
  for (const interval of intervals) {
    removeGeodesicIntervalAndDerivedObjects(registry, interval.id);
  }
  if (registry.get(pair.freeEndAnchorId)) {
    registry.remove(pair.freeEndAnchorId);
  }
  if (registry.get(pair.id)) {
    registry.remove(pair.id);
  }
  updateGeodesicIntersectionObjects(registry);
  return existing;
}

// De-duplicates intervals by id (a loop pair names the same interval twice), keeping the last occurrence.
function uniqueIntervals(intervals: readonly GeodesicIntervalObject[]): readonly GeodesicIntervalObject[] {
  const byId = new Map<string, GeodesicIntervalObject>();
  for (const interval of intervals) {
    byId.set(interval.id, interval);
  }
  return [...byId.values()];
}

// Resolves and validates the intervals owned by a pair: both exist, the named role of each is attached to the pair's free end, and
// every interval is `"moving"`. Returns `undefined` otherwise. One interval is returned for a free loop.
function resolvePairIntervals(
  registry: RuntimeObjectRegistry,
  pair: CurveShorteningPairObject,
): { readonly intervals: readonly GeodesicIntervalObject[] } | undefined {
  const first = registry.get(pair.first.geodesicId);
  const second = registry.get(pair.second.geodesicId);
  if (first?.kind !== "geodesic-interval" || second?.kind !== "geodesic-interval") {
    return undefined;
  }
  if (
    first[pair.first.role].anchorObjectId !== pair.freeEndAnchorId ||
    second[pair.second.role].anchorObjectId !== pair.freeEndAnchorId
  ) {
    return undefined;
  }
  const intervals = uniqueIntervals([first, second]);
  return intervals.every((interval) => interval.motionState === "moving") ? { intervals } : undefined;
}

// Destructive failure cleanup: deletes the given intervals with their derived objects, the shared free end and optionally the pair,
// then refreshes intersection markers. No survivor is kept.
function cleanupCurveShorteningFailure(
  registry: RuntimeObjectRegistry,
  geodesicIds: readonly string[],
  freeEndAnchorId: string,
  pairId: string | undefined,
): void {
  for (const geodesicId of [...new Set(geodesicIds)]) {
    removeGeodesicIntervalAndDerivedObjects(registry, geodesicId);
  }
  registry.remove(freeEndAnchorId);
  if (pairId) {
    registry.remove(pairId);
  }
  updateGeodesicIntersectionObjects(registry);
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
    syncLegacyEmitterGeodesicFields(registry, interval.id);
  }
}

// ---- Exact resolution (sleeve and funnel) ----

/** A user-visible event of the curve-shortening resolution; the shell logs it (there is no on-screen message system yet). */
export type CurveShorteningNotice =
  | { readonly kind: "free-loop-collapsed"; readonly geodesicId: string; readonly message: string }
  | { readonly kind: "collapsed"; readonly geodesicIds: readonly string[]; readonly message: string }
  | { readonly kind: "unresolved"; readonly pairId: string; readonly reason: string; readonly message: string };

/**
 * Outcome of {@link resolveCurveShorteningPair}.
 *
 * `resolved`: `geodesicIds` are the intervals of the result (first the surviving id, then the pieces) and `removedIds` the arcs that no longer exist.
 * `deleted`: the pair ended without a result (invalid pair, collapsed loop or chord); `removedIds` are the deleted arcs.
 * `unresolved`: nothing changed except the pair's `state`, which is now `"unresolved"`.
 */
export type CurveShorteningResolution =
  | { readonly status: "resolved"; readonly geodesicIds: readonly string[]; readonly removedIds: readonly string[] }
  | { readonly status: "deleted"; readonly removedIds: readonly string[] }
  | { readonly status: "unresolved"; readonly reason: string };

/** Holonomy rotation (radians) above which a free loop encircles a cone point and collapses. */
const freeLoopRotationToleranceRadians = 1e-9;

/** Distance (meters) within which a developed junction position counts as the wrapped disk centre. */
const cornerJunctionToleranceMeters = 1e-6;

/**
 * Resolves one curve-shortening pair completely: replaces its two arcs (or its free loop) by the length-minimizing path of their homotopy class.
 *
 * The fused portal word (first arc read from its non-free anchor to the free end F, then the second arc from F to its non-free anchor, freely reduced; for a loop the loop's word with A = B = F) is developed into a sleeve (`developSleeve`). A free loop whose holonomy rotates is deleted with notice `free-loop-collapsed`. Otherwise `solveTautPath` gives the straight chord or the taut string around the forbidden disks (radius `forbiddenPortalJunctionRadiusMeters` plus `geodesicCornerClearanceMeters`). Each wrap is replaced by pinned `GeodesicCornerObject` anchors named `<pairId>:corner:<j>`, and the result is a chain of stable intervals: the first keeps the smaller arc id (the loop's id), the others are `<id>:piece:<j>`; each is previewed with `previewRebuildGeodesicInterval` before anything is written. A single-interval result that duplicates an existing stable geodesic is discarded in its favour.
 *
 * Nothing is deleted because a path touches a disk. Failures (`word-mismatch`, `infeasible`, `no-convergence`, a piece shorter than `GEODESIC_MIN_LENGTH_METERS`, sub-words that do not reduce to the fused word, a failed sub-interval preview) change nothing except `pair.state = "unresolved"`, and send notice `unresolved`. A result without corner whose chord is shorter than `GEODESIC_MIN_LENGTH_METERS` is deleted with notice `collapsed`. Non-free anchors may be of any kind that attaches geodesics (emitter, corner, free end).
 */
export function resolveCurveShorteningPair(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pairId: string;
  readonly onNotice?: (notice: CurveShorteningNotice) => void;
}): CurveShorteningResolution {
  const { world, registry } = input;
  const pair = registry.get(input.pairId);
  if (pair?.kind !== "curve-shortening-pair") {
    return { status: "unresolved", reason: "missing-pair" };
  }
  const freeEnd = registry.get(pair.freeEndAnchorId);
  const owned = freeEnd?.kind === "free-geodesic-end" ? resolvePairIntervals(registry, pair) : undefined;
  if (!owned || freeEnd?.kind !== "free-geodesic-end") {
    registry.remove(pair.id);
    return { status: "deleted", removedIds: [] };
  }
  const ownedIds = owned.intervals.map(({ id }) => id);
  const fail = (reason: string): CurveShorteningResolution => {
    registry.update({ ...pair, state: "unresolved" });
    input.onNotice?.({
      kind: "unresolved",
      pairId: pair.id,
      reason,
      message: `The tied geodesic could not be straightened (${reason}).`,
    });
    return { status: "unresolved", reason };
  };

  // Anchors A and B (ends of the result chain), the fused word w and the id of the first interval.
  const isLoop = owned.intervals.length === 1;
  let anchorA: RuntimeWorldObject | undefined = freeEnd;
  let anchorB: RuntimeWorldObject | undefined = freeEnd;
  let word: readonly GeodesicPortalTraversal[];
  let firstId: string;
  if (isLoop) {
    word = owned.intervals[0].portalWord;
    firstId = owned.intervals[0].id;
  } else {
    const [first, second] = [registry.get(pair.first.geodesicId), registry.get(pair.second.geodesicId)];
    if (first?.kind !== "geodesic-interval" || second?.kind !== "geodesic-interval") {
      return fail("missing-interval");
    }
    const firstNonFreeRole = getOppositeEndRole(pair.first.role);
    const secondNonFreeRole = getOppositeEndRole(pair.second.role);
    anchorA = registry.get(first[firstNonFreeRole].anchorObjectId);
    anchorB = registry.get(second[secondNonFreeRole].anchorObjectId);
    word = reduceAdjacentInversePortalTraversals([
      ...getPortalWordBetweenEndpointRoles({ interval: first, sourceRole: firstNonFreeRole, targetRole: pair.first.role }),
      ...getPortalWordBetweenEndpointRoles({ interval: second, sourceRole: pair.second.role, targetRole: secondNonFreeRole }),
    ]);
    firstId = [first.id, second.id].sort()[0];
  }
  if (!canObjectAttachGeodesics(anchorA) || !canObjectAttachGeodesics(anchorB)) {
    return fail("anchor");
  }
  const pointA = getAnchorBeamPoint(anchorA);
  const pointB = getAnchorBeamPoint(anchorB);

  const developed = developSleeve({
    world,
    startCellId: anchorA.cellId,
    start: { x: pointA.x, y: pointA.y },
    word,
    end: { x: pointB.x, y: pointB.y },
  });
  if (developed.status !== "ok" || developed.sleeve.endCellId !== anchorB.cellId) {
    return fail("word-mismatch");
  }
  const sleeve = developed.sleeve;

  // A free loop whose holonomy rotates encircles a cone point: its length shrinks to zero, so it is deleted.
  if (isLoop) {
    const rotation = Math.atan2(sleeve.startFromEnd.rotation.m10, sleeve.startFromEnd.rotation.m00);
    if (Math.abs(rotation) > freeLoopRotationToleranceRadians) {
      cleanupCurveShorteningFailure(registry, ownedIds, pair.freeEndAnchorId, pair.id);
      input.onNotice?.({
        kind: "free-loop-collapsed",
        geodesicId: ownedIds[0],
        message: "The loop around a cone point shrank to a point and was removed.",
      });
      return { status: "deleted", removedIds: ownedIds };
    }
  }

  const taut = solveTautPath(sleeve, forbiddenPortalJunctionRadiusMeters + geodesicCornerClearanceMeters);
  if (taut.status !== "ok") {
    return fail(taut.status);
  }
  if (taut.apexes.length === 0 && lengthVec2(subVec2(sleeve.end, sleeve.start)) < GEODESIC_MIN_LENGTH_METERS) {
    cleanupCurveShorteningFailure(registry, ownedIds, pair.freeEndAnchorId, pair.id);
    input.onNotice?.({
      kind: "collapsed",
      geodesicIds: ownedIds,
      message: "The tied geodesic shrank to a point and was removed.",
    });
    return { status: "deleted", removedIds: ownedIds };
  }

  // Walk the polyline through the world: this yields the cell of each corner, its local position and the portal word of each piece.
  const points = taut.points;
  for (let index = 0; index + 1 < points.length; index += 1) {
    if (lengthVec2(subVec2(points[index + 1], points[index])) < GEODESIC_MIN_LENGTH_METERS - 1e-9) {
      return fail("short-piece");
    }
  }
  const corners: GeodesicCornerObject[] = [];
  const subWords: GeodesicPortalTraversal[][] = [];
  if (taut.apexes.length === 0) {
    subWords.push([...word]);
  } else {
    let previousCellId = anchorA.cellId;
    let previousFromDeveloped: RigidTransform3 = identityRigidTransform3;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const localFrom = transformPoint3(previousFromDeveloped, vec3(from.x, from.y, 0));
      const localDirection = transformDirection3(previousFromDeveloped, vec3(to.x - from.x, to.y - from.y, 0));
      const walk = walkDevelopedSegment({
        world,
        cellId: previousCellId,
        start: { x: localFrom.x, y: localFrom.y },
        direction: { x: localDirection.x, y: localDirection.y },
        lengthMeters: lengthVec2(subVec2(to, from)),
      });
      const lastPiece = walk.pieces.at(-1);
      if (walk.status !== "end" || !lastPiece) {
        return fail(`walk-${walk.status}`);
      }
      const fromDeveloped = orthonormalizeYawRigidTransform3(composeRigidTransform3(lastPiece.cellFromStart, previousFromDeveloped));
      subWords.push(walk.crossings.map((crossing) => ({
        sourceCellId: crossing.sourceCellId,
        sourcePortalId: crossing.portalId,
        targetCellId: crossing.targetCellId,
        targetPortalId: crossing.targetPortalId,
      })));
      if (index < points.length - 1) {
        const apex = taut.apexes[taut.cornerApexIndex[index - 1]];
        const cell = world.cellsById.get(lastPiece.cellId);
        const developedFromCell = invertRigidTransform3(fromDeveloped);
        const junction = cell?.portalJunctions.find((candidate) => {
          const position = transformPoint3(developedFromCell, vec3(candidate.position.x, candidate.position.y, 0));
          return Math.hypot(position.x - apex.center.x, position.y - apex.center.y) <= cornerJunctionToleranceMeters;
        });
        if (!junction) {
          return fail("corner-junction");
        }
        const local = transformPoint3(fromDeveloped, vec3(to.x, to.y, 0));
        corners.push(createGeodesicCornerObject({
          id: `${pair.id}:corner:${corners.length}`,
          cellId: lastPiece.cellId,
          point: vec3(local.x, local.y, pointA.z),
          junctionId: junction.id,
          side: apex.side,
        }));
      } else if (lastPiece.cellId !== anchorB.cellId) {
        return fail("end-cell");
      }
      previousCellId = lastPiece.cellId;
      previousFromDeveloped = fromDeveloped;
    }
    if (!samePortalWord(
      reduceAdjacentInversePortalTraversals(subWords.flat()),
      reduceAdjacentInversePortalTraversals(word),
    )) {
      return fail("word-reduction");
    }
  }

  // The chain A -> corner_0 -> ... -> B; each interval is previewed before anything is written.
  const chainAnchors: RuntimeWorldObject[] = [anchorA, ...corners, anchorB];
  const intervals = subWords.map((subWord, index) => createGeodesicIntervalObject({
    id: index === 0 ? firstId : `${firstId}:piece:${index}`,
    startAnchorObjectId: chainAnchors[index].id,
    endAnchorObjectId: chainAnchors[index + 1].id,
    startCellId: chainAnchors[index].cellId,
    portalWord: subWord,
    motionState: "stable",
  }));
  const candidateAnchorsById = new Map<string, RuntimeWorldObject>(corners.map((corner) => [corner.id, corner]));
  for (const interval of intervals) {
    if (!previewRebuildGeodesicInterval({ world, registry, interval, candidateAnchorsById })) {
      return fail("preview");
    }
  }

  if (intervals.length === 1 && !isLoop) {
    const existing = findEquivalentStableInterval(registry, intervals[0], ownedIds);
    if (existing) {
      discardCurveShorteningPairInFavorOf(registry, pair, owned.intervals, existing);
      return { status: "resolved", geodesicIds: [], removedIds: ownedIds };
    }
  }

  // Commit. The interval with `firstId` already exists (a surviving arc or the loop) and is overwritten; the other arc goes last, so
  // that the free-end sweep of its removal finds every kept anchor still attached.
  for (const corner of corners) {
    registry.add(corner);
  }
  registry.update(intervals[0]);
  for (const interval of intervals.slice(1)) {
    registry.add(interval);
  }
  const removedIds = ownedIds.filter((id) => id !== firstId);
  for (const removedId of removedIds) {
    removeGeodesicIntervalAndDerivedObjects(registry, removedId);
  }
  registry.remove(pair.id);
  if (!isLoop) {
    registry.remove(freeEnd.id);
  }
  for (const interval of intervals) {
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: interval.id });
    syncLegacyEmitterGeodesicFields(registry, interval.id);
  }
  updateGeodesicIntersectionObjects(registry);

  return { status: "resolved", geodesicIds: intervals.map(({ id }) => id), removedIds };
}
