/**
 * Curve shortening: tie-and-detach of two endpoint roles into a curve-shortening pair, and the per-tick advance, fusion and failure handling of pairs.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE, moveDynamicObject } from "../../movement/moveDynamicObject";
import { addVec3, scaleVec3, type Vec3 } from "../../math/vec3";
import { type RuntimeObjectRegistry, type RuntimeWorldObject, runtimeObjectToDynamicObjectState } from "../runtimeObjectRegistry";
import {
  createCurveShorteningPairObject,
  createFreeGeodesicEndObject,
  type CurveShorteningPairObject,
  directionFromYaw,
  type FreeGeodesicEndObject,
  GEODESIC_MIN_LENGTH_METERS,
  type GeodesicEndpointAttachment,
  type GeodesicEndpointSelection,
  type GeodesicEndRole,
  type GeodesicIntervalObject,
  type GeodesicPortalTraversal,
  type GeodesicSegmentObject,
  type GeodesicTraceBuildResult,
  getAnchorBeamPoint,
  getGeodesicCannonEmitterPoint,
  getOppositeEndRole,
  intersectionTolerance,
  isCurveShorteningPairObject,
  normalizeHorizontalDirection,
} from "./objects";
import {
  applyAnchorCrossingTraversals,
  getPortalTraversalFromSource,
  getPortalWordBetweenEndpointRoles,
  reduceAdjacentInversePortalTraversals,
  reverseGeodesicPortalWord,
  samePortalWord,
} from "./portalWord";
import { updateGeodesicIntersectionObjects } from "./intersections";
import { portalWordMatchesEndpointCellsWithAnchors, removeUnusedFreeGeodesicEnds } from "./endpoints";
import {
  getGeodesicSegments,
  removeGeodesicIntervalAndDerivedObjects,
  removeGeodesicSegments,
  resolveEndpointTangentAtAnchor,
  syncLegacyEmitterGeodesicFields,
  totalGeodesicLengthFromSegments,
} from "./segments";
import { isGeodesicLocked } from "./lifecycle";
import {
  previewGeodesicIntervalHitsForbiddenZone,
  previewGeodesicIntervalIsDegenerate,
  previewRebuildGeodesicInterval,
  rebuildDerivedGeodesicSegments,
} from "./intervals";

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

/** Request for `advanceCurveShorteningPairs`: advance every moving pair by `deltaSeconds`. */
export interface AdvanceCurveShorteningPairsRequest {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  readonly speedMetersPerSecond?: number;
  readonly onDebugMessage?: (message: string, detail?: unknown) => void;
}

/** Default speed (m/s) at which a curve-shortening pair's shared free end moves downhill. */
export const curveShorteningDefaultSpeedMetersPerSecond = 0.4;

/** Turn-angle tolerance (radians) below which the free end counts as locally straight, so the pair is ready to fuse. */
export const curveShorteningFuseAngleToleranceRadians = 0.03;

/** Length tolerance (meters): a two-arc pair whose shorter arc is below this is absorbed into one geodesic (`absorbShortCurveShorteningHalf`); slightly above the minimum geodesic length. */
export const curveShorteningFuseStepToleranceMeters = 1.1 * GEODESIC_MIN_LENGTH_METERS;

/** Floor (meters) applied to the arc lengths in the curve-shortening step's distance-to-straight estimate, so that a vanishing arc cannot divide by zero. It no longer gates the step. */
export const curveShorteningMinStepMeters = 0.002;

/**
 * Length tolerance (meters) for the monotone-descent check of curve shortening: a previewed step is committed only if the new total
 * length of the pair's arcs is at most `previousTotalLengthMeters + curveShorteningLengthIncreaseToleranceMeters`.
 */
export const curveShorteningLengthIncreaseToleranceMeters = 1e-4;

/**
 * Detaches two endpoint roles from one emitter and ties them to a new shared free end, starting a curve-shortening pair.
 *
 * Preconditions: `first` and `second` are different `(geodesicId, role)` pairs (the two roles of ONE interval are allowed: a loop
 * based at the emitter); both attachments currently point at `detachedEmitterId`; every affected interval exists and is locked
 * (emitter at both ends). Effects on success: a `FreeGeodesicEndObject` is created at the emitter's beam point (so the geometry does
 * not change at detach time), the selected roles are re-attached to it, the affected intervals become `"moving"`, their segments are
 * rebuilt from the stored portal word (the homotopy class is preserved), and a `CurveShorteningPairObject` is added with
 * `previousTotalLengthMeters` equal to the sum of the affected lengths. Returns that pair.
 *
 * Returns `undefined` on failed preconditions (nothing changed) or when a rebuild fails. Rebuild failure rolls back all intervals and
 * segments and removes the free end, EXCEPT when the failure is a forbidden-zone hit, in which case the affected geodesics are deleted
 * (they cannot exist at all). Ids come from `createFreeEndId`/`createPairId`, each called at most once.
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
    // Rebuild failed (note: rebuildDerivedGeodesicSegments itself deletes a degenerate interval). Forbidden zone: the geodesic cannot
    // legally exist, so delete everything. Anything else (wrong word, wall hit): restore the original intervals, segments and
    // emitter attachments and discard the free end, leaving the world as before the request.
    if (!rebuildDerivedGeodesicSegments({ world: request.world, registry: request.registry, geodesicId: interval.id })) {
      if (previewGeodesicIntervalHitsForbiddenZone({ world: request.world, registry: request.registry, interval: next })) {
        cleanupCurveShorteningFailure(request.registry, affected.map(({ id }) => id), freeEnd.id, undefined);
      } else {
        restoreGeodesicIntervalsAndSegments(request.registry, affected, originalSegmentsByGeodesicId);
        request.registry.remove(freeEnd.id);
        removeUnusedFreeGeodesicEnds(request.registry);
        updateGeodesicIntersectionObjects(request.registry);
      }
      return undefined;
    }
    syncLegacyEmitterGeodesicFields(request.registry, interval.id);
  }

  // The pair records the shared vertex's state as "last good" and the starting total length (used for bookkeeping by the tick).
  const pair = createCurveShorteningPairObject({
    id: request.createPairId(),
    first: { geodesicId: request.first.geodesicId, role: request.first.role, anchorObjectId: freeEnd.id },
    second: { geodesicId: request.second.geodesicId, role: request.second.role, anchorObjectId: freeEnd.id },
    freeEndAnchorId: freeEnd.id,
    previousTotalLengthMeters: totalLengthForGeodesicIds(request.registry, affected.map(({ id }) => id)),
    lastGoodFreeEndCellId: freeEnd.cellId,
    lastGoodFreeEndPoint: getAnchorBeamPoint(freeEnd),
  });
  request.registry.add(pair);
  updateGeodesicIntersectionObjects(request.registry);
  return pair;
}

// ---- Curve shortening ----

/**
 * Advances every curve-shortening pair by one tick of `deltaSeconds`, sliding its shared free end downhill, and returns the changed ids.
 *
 * Model: a pair glues two endpoint roles at one free end F; the unit tangents `u`, `v` of the two geodesic arcs at F (pointing away
 * from F) give the first variation of the total length L under a displacement `d` of F: `dL = -(u + v) . d`. So the steepest
 * descent direction is `normalize(u + v)`; when `u + v` vanishes (or the angle between `u` and `v` is within
 * `curveShorteningFuseAngleToleranceRadians` of pi) the corner is locally straight. The portal words keep each arc in its homotopy
 * class, while F crossing a portal is the only allowed change of the words.
 *
 * Per pair, in this order: (1) a `"ready-to-fuse"` pair is fused with `fuseCurveShorteningPair` (fusion happens one call after the
 * pair was flagged); (2) structurally invalid pairs (missing free end, intervals gone, no longer `"moving"`, missing tangents) are
 * silently removed; (3) a straight corner flags the pair `"ready-to-fuse"`; (4) a free loop shorter than `GEODESIC_MIN_LENGTH_METERS` is deleted, and a two-arc pair whose shorter arc is below
 * `curveShorteningFuseStepToleranceMeters` is absorbed (`absorbShortCurveShorteningHalf`; if that is refused the tick goes on). Step
 * length = min(speed times `deltaSeconds`, a quarter of the shorter arc, `delta / (1/a + 1/b)` with `delta` the angle deficit), with no lower bound;
 * (5) F is moved with `moveDynamicObject` (autonomous portal crossing, forbidden zones ignored); a blocked move skips the tick;
 * (6) if F crossed a portal each interval's word is updated by that traversal; (7) every interval is re-traced against the candidate
 * F position WITHOUT touching the registry (`previewRebuildGeodesicInterval`); (8) on success, and if the total length did not grow
 * beyond the tolerance, the free end, the changed intervals,
 * their segments and the pair's `previousTotalLengthMeters`/last-good fields are committed together.
 *
 * Failures of the preview: a degenerate (too short) half is absorbed into the other; a forbidden-zone hit deletes the failing half
 * (the other half survives as a stable free geodesic, see `cleanupCurveShorteningPreviewFailure`); a wall hit or wrong portal word
 * leaves the pair and free end exactly as they were and is NOT reported as a change (the same step is retried next tick). A step is also
 * not committed (and not reported) when the previewed total length exceeds `previousTotalLengthMeters` by more than
 * `curveShorteningLengthIncreaseToleranceMeters`; `previousTotalLengthMeters` is recorded only by committed ticks. A single-interval
 * free loop shorter than `GEODESIC_MIN_LENGTH_METERS` (or whose preview is degenerate and cannot be absorbed) is deleted with its free
 * end and pair. If fusing a `"ready-to-fuse"` pair fails for a reason other than a forbidden zone, the pair reverts to `"moving"`.
 *
 * Returns the unique ids (intervals or pairs) that changed; returns `[]` when `deltaSeconds` is not positive. Units: seconds, meters/second.
 */
export function advanceCurveShorteningPairs(
  request: AdvanceCurveShorteningPairsRequest,
): readonly string[] {
  if (!(request.deltaSeconds > 0)) {
    return [];
  }
  const changed: string[] = [];
  for (const pair of request.registry.getAll().filter(isCurveShorteningPairObject)) {
    // Two-phase finish: a pair flagged on an earlier call is fused now. The returned id is the fused interval (or the pair if fusion failed).
    if (pair.state === "ready-to-fuse") {
      request.onDebugMessage?.("curve-shortening pair fused after ready state", {
        pairId: pair.id,
        first: pair.first,
        second: pair.second,
        freeEndAnchorId: pair.freeEndAnchorId,
        previousTotalLengthMeters: pair.previousTotalLengthMeters,
      });
      const fused = fuseCurveShorteningPair({ world: request.world, registry: request.registry, pairId: pair.id });
      const survivingPair = request.registry.get(pair.id);
      if (!fused && survivingPair?.kind === "curve-shortening-pair" && survivingPair.state === "ready-to-fuse") {
        // Fusion failed for a reason other than a forbidden zone (wall hit, wrong word, degenerate chord): hand the pair back to the
        // descent instead of retrying the same failing fusion forever.
        request.registry.update({ ...survivingPair, state: "moving" });
        request.onDebugMessage?.("curve-shortening pair fusion failed; pair reverted to moving", { pairId: pair.id });
      }
      changed.push(fused?.id ?? pair.id);
      continue;
    }
    // Structural validation. Broken pairs are dropped (the pair object only; intervals are left as they are).
    const freeEnd = request.registry.get(pair.freeEndAnchorId);
    if (freeEnd?.kind !== "free-geodesic-end") {
      request.registry.remove(pair.id);
      continue;
    }
    const owned = resolvePairIntervals(request.registry, pair);
    if (!owned) {
      request.registry.remove(pair.id);
      changed.push(pair.id);
      continue;
    }
    // Unit tangents u, v of the two arcs at the shared free end, pointing away from it. Both are in the free end's cell frame
    // because each arc's end segment lives in the cell of its anchor, and both anchors are the free end.
    const firstTangent = endpointDirectionAwayFromAnchor(request.registry, pair.first);
    const secondTangent = endpointDirectionAwayFromAnchor(request.registry, pair.second);
    if (!firstTangent || !secondTangent) {
      request.registry.remove(pair.id);
      changed.push(pair.id);
      continue;
    }
    // -(u + v) is the gradient of the total length with respect to the free end's position (first variation of arc length).
    const sum = addVec3(firstTangent, secondTangent);
    const sumLength = Math.hypot(sum.x, sum.y);
    // Angle between u and v in [0, pi]; pi means the two arcs continue each other, i.e. the corner at F is straight.
    const turnAngle = Math.acos(Math.max(-1, Math.min(1, firstTangent.x * secondTangent.x + firstTangent.y * secondTangent.y)));
    const angleDeltaFromPiRadians = Math.abs(Math.PI - turnAngle);
    if (sumLength <= intersectionTolerance || Math.abs(Math.PI - turnAngle) <= curveShorteningFuseAngleToleranceRadians) {
      request.onDebugMessage?.("curve-shortening pair marked ready-to-fuse by mobile angle", {
        pairId: pair.id,
        first: pair.first,
        second: pair.second,
        freeEndAnchorId: pair.freeEndAnchorId,
        firstTangent,
        secondTangent,
        tangentSumLength: sumLength,
        zeroSumTolerance: intersectionTolerance,
        turnAngleRadians: turnAngle,
        turnAngleDegrees: radiansToDegrees(turnAngle),
        angleDeltaFromPiRadians,
        angleDeltaFromPiDegrees: radiansToDegrees(angleDeltaFromPiRadians),
        fuseAngleToleranceRadians: curveShorteningFuseAngleToleranceRadians,
        fuseAngleToleranceDegrees: radiansToDegrees(curveShorteningFuseAngleToleranceRadians),
        previousTotalLengthMeters: pair.previousTotalLengthMeters,
      });
      request.registry.update({ ...pair, state: "ready-to-fuse" });
      changed.push(pair.id);
      continue;
    }
    // Arc lengths as seen from the pair's two attachments (for a free loop both name the same interval, so a = b = L).
    const firstArcLengthMeters = totalGeodesicLengthFromSegments(getGeodesicSegments(request.registry, pair.first.geodesicId));
    const secondArcLengthMeters = totalGeodesicLengthFromSegments(getGeodesicSegments(request.registry, pair.second.geodesicId));
    const shortestIncidentLength = Math.min(firstArcLengthMeters, secondArcLengthMeters);
    // Geometry, not the step size, decides when an arc is gone: a free loop below the minimum length is deleted; a two-arc pair
    // whose shorter arc is below the absorb tolerance is absorbed. A refused absorption does not stall the tick.
    if (owned.intervals.length === 1) {
      if (removeDegenerateFreeLoop(request.registry, pair, owned.intervals)) {
        changed.push(pair.id);
        continue;
      }
    } else if (shortestIncidentLength < curveShorteningFuseStepToleranceMeters) {
      const absorbed = absorbShortCurveShorteningHalf({
        world: request.world,
        registry: request.registry,
        pair,
        intervals: owned.intervals,
        onDebugMessage: request.onDebugMessage,
      });
      if (absorbed) {
        changed.push(absorbed.id);
        continue;
      }
    }
    // Step = min(speed * dt, a quarter of the shorter arc, estimated distance to the straight position). The last term is
    // delta / (1/a + 1/b), from delta ~ h (1/a + 1/b) for a vertex at distance h from the chord: it stops the fixed step from
    // jumping back and forth across the chord. No lower bound, so the tick behaves the same at any frame rate.
    const distanceToStraightEstimateMeters = angleDeltaFromPiRadians / (
      1 / Math.max(firstArcLengthMeters, curveShorteningMinStepMeters) +
      1 / Math.max(secondArcLengthMeters, curveShorteningMinStepMeters)
    );
    const stepMeters = Math.min(
      (request.speedMetersPerSecond ?? curveShorteningDefaultSpeedMetersPerSecond) * request.deltaSeconds,
      0.25 * shortestIncidentLength,
      distanceToStraightEstimateMeters,
    );
    if (!(stepMeters > 0)) {
      continue;
    }

    // Steepest-descent direction of total length. The displacement is horizontal (z unchanged).
    const descent = normalizeHorizontalDirection(sum);
    const moveResult = moveDynamicObject({
      world: request.world,
      object: runtimeObjectToDynamicObjectState(freeEnd),
      displacement: scaleVec3(descent, stepMeters),
      portalCrossingMode: AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
      ignoreForbiddenZones: true,
    });
    if (moveResult.blocked) {
      continue;
    }
    // Candidate state of F after the move (not yet committed). `candidateAnchors` makes the previews see it instead of the registry copy.
    const candidateFreeEnd: FreeGeodesicEndObject = {
      ...freeEnd,
      cellId: moveResult.object.cellId,
      localPose: moveResult.object.localPose,
    };
    const candidateAnchors = new Map<string, RuntimeWorldObject>([[candidateFreeEnd.id, candidateFreeEnd]]);
    // If F crossed a portal during the move, F now lives in the neighbouring cell. Each arc's word changes by that traversal
    // (`portalWordAfterAnchorCrossing`: append at an `end` role on F, prepend the inverse at a `start` role on F; a free loop has
    // both roles on F and is conjugated). This is the only change of homotopy class a tick may make. Words that fail the
    // cell-chain check are left unchanged (the preview then fails and nothing is committed).
    // A tick may cross several portals; the traversals are applied once each, in order.
    const traversals: GeodesicPortalTraversal[] = [];
    for (const crossing of moveResult.crossings) {
      const traversal = getPortalTraversalFromSource(request.world, crossing.sourceCellId, crossing.portalId);
      if (!traversal) {
        traversals.length = 0;
        break;
      }
      traversals.push(traversal);
    }
    const candidateIntervals = owned.intervals.map((interval) => {
      if (traversals.length === 0) {
        return interval;
      }
      const portalWord = applyAnchorCrossingTraversals({ interval, anchorObjectId: pair.freeEndAnchorId, traversals });
      if (
        !portalWord ||
        !portalWordMatchesEndpointCellsWithAnchors({
          registry: request.registry,
          interval,
          word: portalWord,
          candidateAnchorsById: candidateAnchors,
        })
      ) {
        return interval;
      }
      const startMoved = interval.start.anchorObjectId === pair.freeEndAnchorId;
      return {
        ...interval,
        cellId: startMoved ? candidateFreeEnd.cellId : interval.cellId,
        startCellId: startMoved ? candidateFreeEnd.cellId : interval.startCellId,
        portalWord,
      };
    });
    // Dry-run re-trace of every arc from its candidate anchors/word: each must realize its word exactly without hitting a wall or zone.
    const previews = candidateIntervals.map((interval) =>
      previewRebuildGeodesicInterval({
        world: request.world,
        registry: request.registry,
        interval,
        candidateAnchorsById: candidateAnchors,
      })
    );
    // At least one arc cannot follow F to the candidate position. If one arc has become shorter than the minimum length it is merged
    // into the other (absorb); otherwise a forbidden-zone hit removes the offending half; any other failure changes nothing.
    if (previews.some((preview) => !preview)) {
      const degenerateInterval = candidateIntervals.find((interval, index) =>
        previews[index] === undefined &&
        previewGeodesicIntervalIsDegenerate({
          world: request.world,
          registry: request.registry,
          interval,
          candidateAnchorsById: candidateAnchors,
        })
      );
      if (degenerateInterval) {
        const absorbed = absorbShortCurveShorteningHalf({
          world: request.world,
          registry: request.registry,
          pair,
          intervals: owned.intervals,
          preferredShortGeodesicId: degenerateInterval.id,
          onDebugMessage: request.onDebugMessage,
        });
        if (absorbed) {
          changed.push(absorbed.id);
        } else if (owned.intervals.length === 1 && removeDegenerateFreeLoop(request.registry, pair, owned.intervals, true)) {
          changed.push(pair.id);
        }
        continue;
      }
      // Only a forbidden-zone failure changes the registry; any other failure leaves the tick uncommitted and unreported.
      const cleanedUp = cleanupCurveShorteningPreviewFailure({
        world: request.world,
        registry: request.registry,
        pair,
        intervals: owned.intervals,
        previews,
        candidateAnchorsById: candidateAnchors,
      });
      if (cleanedUp) {
        changed.push(pair.id);
      }
      continue;
    }
    // All arcs realized: sum their new lengths. Monotone descent: a step that makes the total longer than the last recorded total
    // (beyond the tolerance) is not committed. The corner is already known to be outside the fuse angle tolerance here (a straight
    // corner was flagged `ready-to-fuse` above), so the tick is simply skipped: free end, arcs and recorded total stay as they were.
    const nextTotal = previews.reduce((total, preview) =>
      total + (preview?.segments.reduce((sumMeters, segment) => sumMeters + segment.lengthMeters, 0) ?? 0), 0);
    if (
      pair.previousTotalLengthMeters !== undefined &&
      nextTotal > pair.previousTotalLengthMeters + curveShorteningLengthIncreaseToleranceMeters
    ) {
      request.onDebugMessage?.("curve-shortening step skipped: total length would increase", {
        pairId: pair.id,
        previousTotalLengthMeters: pair.previousTotalLengthMeters,
        candidateTotalLengthMeters: nextTotal,
        toleranceMeters: curveShorteningLengthIncreaseToleranceMeters,
      });
      continue;
    }

    // Commit. Order matters only in that the free end and (possibly new) words are written before the new segments replace the old.
    request.registry.update(candidateFreeEnd);
    for (const preview of previews) {
      if (!preview) {
        continue;
      }
      const candidateInterval = candidateIntervals.find((interval) => interval.id === preview.interval.id);
      const currentInterval = request.registry.get(preview.interval.id);
      if (
        candidateInterval &&
        currentInterval?.kind === "geodesic-interval" &&
        (
          candidateInterval.cellId !== currentInterval.cellId ||
          candidateInterval.startCellId !== currentInterval.startCellId ||
          !samePortalWord(candidateInterval.portalWord, currentInterval.portalWord)
        )
      ) {
        request.registry.update(candidateInterval);
      }
      removeGeodesicSegments(request.registry, preview.interval.id);
      for (const segment of preview.segments) {
        request.registry.add(segment);
      }
      syncLegacyEmitterGeodesicFields(request.registry, preview.interval.id);
    }
    request.registry.update({
      ...pair,
      previousTotalLengthMeters: nextTotal,
      lastGoodFreeEndCellId: candidateFreeEnd.cellId,
      lastGoodFreeEndPoint: getAnchorBeamPoint(candidateFreeEnd),
    });
    changed.push(...owned.intervals.map(({ id }) => id));
  }
  if (changed.length > 0) {
    updateGeodesicIntersectionObjects(request.registry);
  }
  return [...new Set(changed)];
}

/**
 * Finishes a curve-shortening pair: merges its moving arcs into one stable geodesic and deletes the pair and its free end.
 *
 * Free loop (one interval): the interval becomes `"stable"` with both roles still on the shared free end, only the pair object is
 * deleted. Ordinary pair (two intervals): both non-free anchors must be emitters; the surviving interval takes the
 * lexicographically smallest of the two ids (plain string sort), runs from the first arc's non-free emitter to the second arc's
 * non-free emitter, and its portal word is `word(first: nonFree -> free) + word(second: free -> nonFree)` with adjacent inverse
 * traversals cancelled (so a vertex that wrapped back through a portal collapses). The new geometry is previewed first.
 *
 * Returns the stable interval, or `undefined`. Failure semantics: structural problems remove the pair object only; a preview failure
 * caused by a forbidden zone deletes the geodesics, free end and pair; ANY OTHER preview failure (wall hit, wrong word, degenerate
 * chord) returns `undefined` and leaves the pair in `"ready-to-fuse"` state; `advanceCurveShorteningPairs` then reverts it to `"moving"`.
 * A failure of the final destructive rebuild (after the preview succeeded) also returns `undefined` with the pair already gone.
 */
export function fuseCurveShorteningPair(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pairId: string;
}): GeodesicIntervalObject | undefined {
  const pair = input.registry.get(input.pairId);
  if (pair?.kind !== "curve-shortening-pair") {
    return undefined;
  }
  const owned = resolvePairIntervals(input.registry, pair);
  if (!owned) {
    input.registry.remove(pair.id);
    return undefined;
  }

  // One interval owning both roles = a free loop. Its geometry already ends at the shared free end, so fusion only has to make it
  // stable (verifying that it is still realizable) and drop the pair.
  if (owned.intervals.length === 1) {
    const loop = owned.intervals[0];
    const stableLoop: GeodesicIntervalObject = { ...loop, motionState: "stable" };
    const preview = previewRebuildGeodesicInterval({
      world: input.world,
      registry: input.registry,
      interval: stableLoop,
    });
    if (!preview) {
      if (previewGeodesicIntervalHitsForbiddenZone({ world: input.world, registry: input.registry, interval: stableLoop })) {
        cleanupCurveShorteningFailure(input.registry, [loop.id], pair.freeEndAnchorId, pair.id);
      }
      return undefined;
    }
    input.registry.update(stableLoop);
    const rebuilt = rebuildDerivedGeodesicSegments({ world: input.world, registry: input.registry, geodesicId: loop.id });
    if (!rebuilt) {
      return undefined;
    }
    input.registry.remove(pair.id);
    syncLegacyEmitterGeodesicFields(input.registry, loop.id);
    updateGeodesicIntersectionObjects(input.registry);
    return input.registry.get(loop.id) as GeodesicIntervalObject | undefined;
  }

  const firstInterval = input.registry.get(pair.first.geodesicId);
  const secondInterval = input.registry.get(pair.second.geodesicId);
  if (firstInterval?.kind !== "geodesic-interval" || secondInterval?.kind !== "geodesic-interval") {
    input.registry.remove(pair.id);
    return undefined;
  }
  // Each arc's "other end" (not at the shared vertex) must be an emitter; it becomes an endpoint of the fused geodesic.
  // TODO(issue 67): the emitter-at-the-non-free-end assumption (here and in absorbShortCurveShorteningHalf) rejects other anchors.
  const firstNonFreeRole = getOppositeEndRole(pair.first.role);
  const secondNonFreeRole = getOppositeEndRole(pair.second.role);
  const firstAnchor = input.registry.get(firstInterval[firstNonFreeRole].anchorObjectId);
  const secondAnchor = input.registry.get(secondInterval[secondNonFreeRole].anchorObjectId);
  if (firstAnchor?.kind !== "geodesic-cannon" || secondAnchor?.kind !== "geodesic-cannon") {
    input.registry.remove(pair.id);
    return undefined;
  }

  // Reuse the smaller id (string order) for the fused geodesic; the other interval is deleted after the fused one is validated.
  const fusedId = [firstInterval.id, secondInterval.id].sort()[0];
  const removedId = fusedId === firstInterval.id ? secondInterval.id : firstInterval.id;
  // Role-aware word composition: read the first arc from its non-free end to the vertex, then the second arc from the vertex to its
  // non-free end. Both pieces meet in the free end's cell, so the concatenation chains; free reduction cancels back-tracking at the vertex.
  const fusedWord = reduceAdjacentInversePortalTraversals([
    ...getPortalWordBetweenEndpointRoles({
      interval: firstInterval,
      sourceRole: firstNonFreeRole,
      targetRole: pair.first.role,
    }),
    ...getPortalWordBetweenEndpointRoles({
      interval: secondInterval,
      sourceRole: pair.second.role,
      targetRole: secondNonFreeRole,
    }),
  ]);
  const fusedInterval: GeodesicIntervalObject = {
    ...(fusedId === firstInterval.id ? firstInterval : secondInterval),
    id: fusedId,
    cellId: firstAnchor.cellId,
    startCellId: firstAnchor.cellId,
    motionState: "stable",
    portalWord: fusedWord,
    start: { geodesicId: fusedId, role: "start", anchorObjectId: firstAnchor.id },
    end: { geodesicId: fusedId, role: "end", anchorObjectId: secondAnchor.id },
  };
  // Validate the fused geodesic as a pure preview first so a failure leaves the moving arcs intact.
  const preview = previewRebuildGeodesicInterval({
    world: input.world,
    registry: input.registry,
    interval: fusedInterval,
  });
  if (!preview) {
    if (previewGeodesicIntervalHitsForbiddenZone({ world: input.world, registry: input.registry, interval: fusedInterval })) {
      cleanupCurveShorteningFailure(input.registry, owned.intervals.map(({ id }) => id), pair.freeEndAnchorId, pair.id);
    }
    return undefined;
  }
  const existingFused = findEquivalentStableInterval(input.registry, fusedInterval, owned.intervals.map(({ id }) => id));
  if (existingFused) {
    return discardCurveShorteningPairInFavorOf(input.registry, pair, owned.intervals, existingFused);
  }
  // Commit: overwrite the surviving interval, delete the other arc, the free end and the pair, then regenerate the segments.
  input.registry.update(fusedInterval);
  removeGeodesicIntervalAndDerivedObjects(input.registry, removedId);
  input.registry.remove(pair.freeEndAnchorId);
  input.registry.remove(pair.id);
  const rebuilt = rebuildDerivedGeodesicSegments({ world: input.world, registry: input.registry, geodesicId: fusedId });
  const finalInterval = input.registry.get(fusedId);
  if (!rebuilt || finalInterval?.kind !== "geodesic-interval") {
    return undefined;
  }
  syncLegacyEmitterGeodesicFields(input.registry, fusedId);
  updateGeodesicIntersectionObjects(input.registry);
  return finalInterval;
}

// Absorbs a nearly vanished arc of a two-arc pair into the other arc, fusing them into one stable geodesic on the survivor's id.
//
// The short arc (shortest of the two, or `preferredShortGeodesicId`, e.g. one found degenerate in a preview) is below
// `curveShorteningFuseStepToleranceMeters`, so the free end is practically at that arc's emitter: the geodesic then runs from the survivor's
// far emitter to the short arc's far emitter with word = survivor(nonFree -> free) + short(free -> nonFree). Same preview-then-commit
// structure as `fuseCurveShorteningPair` (forbidden-zone failure deletes everything, other failures return undefined and change nothing).
// Unlike fusion, the LONGER arc's id survives. Returns the stable interval or undefined.
function absorbShortCurveShorteningHalf(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pair: CurveShorteningPairObject;
  readonly intervals: readonly GeodesicIntervalObject[];
  readonly preferredShortGeodesicId?: string;
  readonly onDebugMessage?: (message: string, detail?: unknown) => void;
}): GeodesicIntervalObject | undefined {
  if (input.intervals.length !== 2) {
    return undefined;
  }
  const intervalLengths = input.intervals.map((interval) => ({
    interval,
    lengthMeters: totalGeodesicLengthFromSegments(getGeodesicSegments(input.registry, interval.id)),
  })).sort((left, right) => left.lengthMeters - right.lengthMeters);
  const short = intervalLengths[0];
  const survivor = intervalLengths[1];
  const preferredShort = input.preferredShortGeodesicId
    ? intervalLengths.find(({ interval }) => interval.id === input.preferredShortGeodesicId)
    : undefined;
  const preferredSurvivor = preferredShort
    ? intervalLengths.find(({ interval }) => interval.id !== preferredShort.interval.id)
    : undefined;
  const absorbedShort = preferredShort ?? short;
  const absorbedSurvivor = preferredSurvivor ?? survivor;
  if (
    !absorbedShort ||
    !absorbedSurvivor ||
    (
      !input.preferredShortGeodesicId &&
      absorbedShort.lengthMeters > curveShorteningFuseStepToleranceMeters
    )
  ) {
    return undefined;
  }

  const shortFreeRole = getPairFreeRoleForInterval(input.pair, absorbedShort.interval);
  const survivorFreeRole = getPairFreeRoleForInterval(input.pair, absorbedSurvivor.interval);
  if (!shortFreeRole || !survivorFreeRole) {
    return undefined;
  }
  const shortNonFreeRole = getOppositeEndRole(shortFreeRole);
  const survivorNonFreeRole = getOppositeEndRole(survivorFreeRole);
  const shortNonFreeAnchor = input.registry.get(absorbedShort.interval[shortNonFreeRole].anchorObjectId);
  const survivorNonFreeAnchor = input.registry.get(absorbedSurvivor.interval[survivorNonFreeRole].anchorObjectId);
  if (shortNonFreeAnchor?.kind !== "geodesic-cannon" || survivorNonFreeAnchor?.kind !== "geodesic-cannon") {
    return undefined;
  }

  const fusedWord = reduceAdjacentInversePortalTraversals([
    ...getPortalWordBetweenEndpointRoles({
      interval: absorbedSurvivor.interval,
      sourceRole: survivorNonFreeRole,
      targetRole: survivorFreeRole,
    }),
    ...getPortalWordBetweenEndpointRoles({
      interval: absorbedShort.interval,
      sourceRole: shortFreeRole,
      targetRole: shortNonFreeRole,
    }),
  ]);
  const fusedInterval: GeodesicIntervalObject = {
    ...absorbedSurvivor.interval,
    id: absorbedSurvivor.interval.id,
    cellId: survivorNonFreeAnchor.cellId,
    startCellId: survivorNonFreeAnchor.cellId,
    motionState: "stable",
    portalWord: fusedWord,
    start: { geodesicId: absorbedSurvivor.interval.id, role: "start", anchorObjectId: survivorNonFreeAnchor.id },
    end: { geodesicId: absorbedSurvivor.interval.id, role: "end", anchorObjectId: shortNonFreeAnchor.id },
  };
  const preview = previewRebuildGeodesicInterval({
    world: input.world,
    registry: input.registry,
    interval: fusedInterval,
  });
  if (!preview) {
    if (previewGeodesicIntervalHitsForbiddenZone({ world: input.world, registry: input.registry, interval: fusedInterval })) {
      cleanupCurveShorteningFailure(
        input.registry,
        input.intervals.map(({ id }) => id),
        input.pair.freeEndAnchorId,
        input.pair.id,
      );
    }
    return undefined;
  }

  const existingAbsorbed = findEquivalentStableInterval(input.registry, fusedInterval, input.intervals.map(({ id }) => id));
  if (existingAbsorbed) {
    return discardCurveShorteningPairInFavorOf(input.registry, input.pair, input.intervals, existingAbsorbed);
  }

  input.onDebugMessage?.("curve-shortening pair absorbed short incident half", {
    pairId: input.pair.id,
    removedGeodesicId: absorbedShort.interval.id,
    survivorGeodesicId: absorbedSurvivor.interval.id,
    shortLengthMeters: absorbedShort.lengthMeters,
    survivorLengthMeters: absorbedSurvivor.lengthMeters,
    absorbLengthToleranceMeters: curveShorteningFuseStepToleranceMeters,
    fusedPortalWord: fusedWord,
  });
  input.registry.update(fusedInterval);
  removeGeodesicIntervalAndDerivedObjects(input.registry, absorbedShort.interval.id);
  input.registry.remove(input.pair.freeEndAnchorId);
  input.registry.remove(input.pair.id);
  const rebuilt = rebuildDerivedGeodesicSegments({
    world: input.world,
    registry: input.registry,
    geodesicId: absorbedSurvivor.interval.id,
  });
  const finalInterval = input.registry.get(absorbedSurvivor.interval.id);
  if (!rebuilt || finalInterval?.kind !== "geodesic-interval") {
    return undefined;
  }
  syncLegacyEmitterGeodesicFields(input.registry, absorbedSurvivor.interval.id);
  updateGeodesicIntersectionObjects(input.registry);
  return finalInterval;
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

function getPairFreeRoleForInterval(
  pair: CurveShorteningPairObject,
  interval: GeodesicIntervalObject,
): GeodesicEndRole | undefined {
  if (pair.first.geodesicId === interval.id) {
    return pair.first.role;
  }
  if (pair.second.geodesicId === interval.id) {
    return pair.second.role;
  }
  return undefined;
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

// Unit horizontal direction (cell frame of the anchor) in which the geodesic leaves the anchor of the given endpoint role.
function endpointDirectionAwayFromAnchor(
  registry: RuntimeObjectRegistry,
  attachment: GeodesicEndpointAttachment,
): Vec3 | undefined {
  const tangent = resolveEndpointTangentAtAnchor({
    registry,
    geodesicId: attachment.geodesicId,
    endRole: attachment.role,
  });
  return tangent ? directionFromYaw(tangent.yawRadians) : undefined;
}

// Sum of the derived-segment lengths of the distinct geodesic ids (meters).
function totalLengthForGeodesicIds(
  registry: RuntimeObjectRegistry,
  geodesicIds: readonly string[],
): number {
  return [...new Set(geodesicIds)].reduce(
    (total, geodesicId) => total + totalGeodesicLengthFromSegments(getGeodesicSegments(registry, geodesicId)),
    0,
  );
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

// Handles a failed preview tick. Only forbidden-zone failures are acted upon; with none, nothing changes and `false` is returned.
// Returns `true` when objects were deleted or rewritten.
// If every arc failed, or the situation is not "exactly one of two arcs failed", the failing arcs, free end and pair are deleted.
// Otherwise (one arc failed, one succeeded): the failed arc and the pair are deleted and the surviving arc is detached from the
// shared free end onto a NEW free end at the pair's last-good position, set `"stable"`, and rebuilt: it becomes an ordinary free geodesic.
function cleanupCurveShorteningPreviewFailure(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly pair: CurveShorteningPairObject;
  readonly intervals: readonly GeodesicIntervalObject[];
  readonly previews: readonly (GeodesicTraceBuildResult | undefined)[];
  readonly candidateAnchorsById?: ReadonlyMap<string, RuntimeWorldObject>;
}): boolean {
  const successes = input.intervals.filter((_interval, index) => input.previews[index] !== undefined);
  const failures = input.intervals.filter((_interval, index) => input.previews[index] === undefined);
  const forbiddenFailures = failures.filter((interval) =>
    previewGeodesicIntervalHitsForbiddenZone({
      world: input.world,
      registry: input.registry,
      interval,
      candidateAnchorsById: input.candidateAnchorsById,
    })
  );
  if (forbiddenFailures.length === 0) {
    return false;
  }
  if (
    forbiddenFailures.length === input.intervals.length ||
    successes.length !== 1 ||
    input.intervals.length !== 2
  ) {
    cleanupCurveShorteningFailure(
      input.registry,
      forbiddenFailures.map(({ id }) => id),
      input.pair.freeEndAnchorId,
      input.pair.id,
    );
    return true;
  }

  const survivor = successes[0];
  const failed = forbiddenFailures[0];
  const freeRole = survivor.start.anchorObjectId === input.pair.freeEndAnchorId ? "start" : "end";
  const survivorFreeEnd = createFreeGeodesicEndObject({
    id: `${survivor.id}:surviving-free-end`,
    cellId: input.pair.lastGoodFreeEndCellId,
    point: input.pair.lastGoodFreeEndPoint,
  });
  removeGeodesicIntervalAndDerivedObjects(input.registry, failed.id);
  input.registry.remove(input.pair.id);
  input.registry.remove(input.pair.freeEndAnchorId);
  input.registry.add(survivorFreeEnd);
  const currentSurvivor = input.registry.get(survivor.id);
  if (currentSurvivor?.kind !== "geodesic-interval") {
    removeUnusedFreeGeodesicEnds(input.registry);
    updateGeodesicIntersectionObjects(input.registry);
    return true;
  }
  const nextSurvivor: GeodesicIntervalObject = freeRole === "start"
    ? {
        ...currentSurvivor,
        motionState: "stable",
        start: {
          geodesicId: currentSurvivor.id,
          role: "start",
          anchorObjectId: survivorFreeEnd.id,
        },
      }
    : {
        ...currentSurvivor,
        motionState: "stable",
        end: {
          geodesicId: currentSurvivor.id,
          role: "end",
          anchorObjectId: survivorFreeEnd.id,
        },
      };
  input.registry.update(nextSurvivor);
  rebuildDerivedGeodesicSegments({ world: input.world, registry: input.registry, geodesicId: survivor.id });
  syncLegacyEmitterGeodesicFields(input.registry, survivor.id);
  updateGeodesicIntersectionObjects(input.registry);
  return true;
}

// Deletes a pair's single interval (a free loop: both roles on the shared free end) with its derived objects, the free end and the pair,
// when the loop is shorter than `GEODESIC_MIN_LENGTH_METERS` or the caller already knows it is degenerate (`assumeDegenerate`).
// A two-interval pair is never touched. Returns whether anything was deleted.
function removeDegenerateFreeLoop(
  registry: RuntimeObjectRegistry,
  pair: CurveShorteningPairObject,
  intervals: readonly GeodesicIntervalObject[],
  assumeDegenerate = false,
): boolean {
  if (intervals.length !== 1) {
    return false;
  }
  const loop = intervals[0];
  if (loop.start.anchorObjectId !== pair.freeEndAnchorId || loop.end.anchorObjectId !== pair.freeEndAnchorId) {
    return false;
  }
  if (!assumeDegenerate && totalGeodesicLengthFromSegments(getGeodesicSegments(registry, loop.id)) >= GEODESIC_MIN_LENGTH_METERS) {
    return false;
  }
  cleanupCurveShorteningFailure(registry, [loop.id], pair.freeEndAnchorId, pair.id);
  return true;
}

function radiansToDegrees(radians: number): number {
  return Number(((radians * 180) / Math.PI).toFixed(3));
}
