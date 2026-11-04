/**
 * What an emitter does to its geodesics when it has been carried: rebuild after a move and the final rebuild when the carry ends.
 * These are rules of the emitter, not of whoever carries it: a hand, a bot and a script all end a carry the same way, by calling these functions with the registry, and the carrier only refreshes what it draws.
 *
 * Pure with respect to rendering. Each function changes the registry and returns the ids it touched, so the caller can refresh the
 * overlays (protractor angles, measured lengths) and the instances that depend on them.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import { rebuildConnectedGeodesicBetweenEmitters, rebuildGeodesicToLength } from "./cannon";
import { pruneMissingGeodesicIntersectionObjects, withDeferredGeodesicIntersections } from "./intersections";
import { getEmitterGeodesicIds } from "./endpoints";
import { collectLockedIncidentGeodesicIdsForEmitter, isGeodesicLocked } from "./lifecycle";
import { collectGeodesicPortalWord, getGeodesicSegments, resolveEmitterLaunchYaw } from "./segments";

/** What a rebuild of an emitter's geodesics touched. */
export interface EmitterGeodesicRebuild {
  /** Geodesics that were rebuilt; their overlays need a refresh. */
  readonly rebuiltGeodesicIds: readonly string[];
  /** Set when the emitter's plain (unlocked) active geodesic was regrown from it: that geodesic is the emitter's active one. */
  readonly regrownActiveGeodesicId?: string;
}

/**
 * Rebuilds the geodesics that depend on an emitter after it moved. Three cases: the locked geodesics incident to the emitter (rebuilt as
 * connected geodesics between emitters), else the emitter's locked active geodesic, else its plain active geodesic regrown from it.
 * `preserveGeodesicOnRebuildFailure` keeps a geodesic whose rebuild failed (the safety net of the carry in progress); the final rebuild at
 * the end of a carry leaves it off. `activeGeodesicId` names the active geodesic when the emitter does not record one; the
 * `rotationTargetLengthMeters` replaces the geodesic's current length when a regrown geodesic should have another.
 */
export function rebuildEmitterGeodesics(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly emitterId: string;
  readonly activeGeodesicId?: string;
  readonly rotationTargetLengthMeters?: number;
  readonly preserveGeodesicOnRebuildFailure?: boolean;
}): EmitterGeodesicRebuild {
  const { world, registry } = input;
  const cannon = registry.get(input.emitterId);
  if (cannon?.kind !== "geodesic-cannon") {
    return { rebuiltGeodesicIds: [] };
  }

  const geodesicId = input.activeGeodesicId ?? getEmitterGeodesicIds(registry, cannon.id)[0];
  const lockedIncidentGeodesicIds = collectLockedIncidentGeodesicIdsForEmitter(registry, cannon.id);
  if (lockedIncidentGeodesicIds.length === 0 && !geodesicId) {
    return { rebuiltGeodesicIds: [] };
  }

  const rebuildLocked = (lockedGeodesicId: string): void => {
    rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: lockedGeodesicId,
      carriedEmitterId: cannon.id,
      carriedPortalWord: collectGeodesicPortalWord(registry, lockedGeodesicId),
      preserveGeodesicOnRebuildFailure: input.preserveGeodesicOnRebuildFailure,
    });
  };

  if (lockedIncidentGeodesicIds.length > 0) {
    // One scope per call: the intersection markers are recomputed once, after all incident geodesics are rebuilt.
    withDeferredGeodesicIntersections(registry, () => {
      for (const incidentGeodesicId of lockedIncidentGeodesicIds) {
        rebuildLocked(incidentGeodesicId);
      }
    });
    return { rebuiltGeodesicIds: lockedIncidentGeodesicIds };
  }
  if (geodesicId && isGeodesicLocked(registry, geodesicId)) {
    rebuildLocked(geodesicId);
    return { rebuiltGeodesicIds: [geodesicId] };
  }
  if (geodesicId) {
    rebuildGeodesicToLength({
      world,
      registry,
      cannon,
      geodesicId,
      launchYawRadians: resolveEmitterLaunchYaw(registry, cannon, geodesicId),
      totalLengthMeters: input.rotationTargetLengthMeters ?? geodesicTotalLengthMeters(registry, geodesicId),
      connectEmitters: false,
      breakOnForbiddenZone: true,
      rebuildLocked: true,
    });
    return { rebuiltGeodesicIds: [geodesicId], regrownActiveGeodesicId: geodesicId };
  }

  return { rebuiltGeodesicIds: [] };
}

/** What releasing a carried emitter touched. */
export interface CarriedEmitterRelease extends EmitterGeodesicRebuild {
  /** Intersection objects that vanished with the rebuilt geodesics (the vertices of angles that depended on them). */
  readonly prunedIntersectionIds: readonly string[];
}

/**
 * The emitter has stopped being carried, whether the hand put it down or let it go: its geodesics are rebuilt one last time
 * without the safety net of the carry, and the intersection objects whose geodesics no longer exist are pruned. Nothing else is recomputed.
 */
export function releaseCarriedEmitter(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly emitterId: string;
  readonly activeGeodesicId?: string;
  readonly rotationTargetLengthMeters?: number;
}): CarriedEmitterRelease {
  if (input.registry.get(input.emitterId)?.kind !== "geodesic-cannon") {
    return { rebuiltGeodesicIds: [], prunedIntersectionIds: [] };
  }

  const rebuild = rebuildEmitterGeodesics(input);

  return { ...rebuild, prunedIntersectionIds: pruneMissingGeodesicIntersectionObjects(input.registry) };
}

function geodesicTotalLengthMeters(registry: RuntimeObjectRegistry, geodesicId: string): number {
  return getGeodesicSegments(registry, geodesicId).reduce((total, segment) => total + segment.lengthMeters, 0);
}
