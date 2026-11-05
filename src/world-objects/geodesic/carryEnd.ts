/**
 * What an emitter does to its geodesics when it has been carried: the rebuild after a move and the final rebuild when the carry ends.
 * These are rules of the emitter, not of whoever carries it: a hand, a bot and a script all end a carry the same way, and the carrier only refreshes what it draws.
 *
 * Pure with respect to rendering. It writes arcs only, so the geodesic model can run it; it returns what the emitter and its carrier need to go on: the geodesic it regrew and the yaw that geodesic left along.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import { rebuildConnectedGeodesicBetweenEmitters, rebuildGeodesicToLength } from "./cannon";
import { getEmitterGeodesicIds, isTied } from "./endpoints";
import { arcFollowsEmitter, collectFollowingArcIdsForEmitter } from "./lifecycle";
import { collectGeodesicPortalWord, resolveEmitterLaunchYaw } from "./segments";

/** What a rebuild of an emitter's geodesics means for the emitter and its carrier. */
export interface EmitterGeodesicRebuild {
  /** Set when the emitter's plain (free) active geodesic was regrown from it: that geodesic is the emitter's active one. */
  readonly regrownActiveGeodesicId?: string;
  /** The yaw the regrown geodesic left along, which the emitter then faces. */
  readonly launchYawRadians?: number;
}

/**
 * Rebuilds the geodesics that depend on an emitter after it moved. Three cases: the connected geodesics incident to the emitter (rebuilt as
 * connected geodesics between emitters), else the emitter's connected active geodesic, else its plain active geodesic regrown from it, to its intended length.
 * `preserveGeodesicOnRebuildFailure` keeps a geodesic whose rebuild failed (the safety net of the carry in progress); the final rebuild at
 * the end of a carry leaves it off. `activeGeodesicId` names the active geodesic when the emitter does not record one.
 */
export function rebuildEmitterGeodesics(input: {
  readonly world: CompiledCellComplex;
  readonly registry: RuntimeObjectRegistry;
  readonly emitterId: string;
  readonly activeGeodesicId?: string;
  readonly preserveGeodesicOnRebuildFailure?: boolean;
}): EmitterGeodesicRebuild {
  const { world, registry } = input;
  const cannon = registry.get(input.emitterId);
  if (cannon?.kind !== "geodesicEmitters/emitter") {
    return {};
  }

  const geodesicId = input.activeGeodesicId ?? getEmitterGeodesicIds(registry, cannon.id)[0];
  const connectedIncidentGeodesicIds = collectFollowingArcIdsForEmitter(registry, cannon.id);
  if (connectedIncidentGeodesicIds.length === 0 && !geodesicId) {
    return {};
  }

  const rebuildConnected = (connectedGeodesicId: string): void => {
    rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: connectedGeodesicId,
      carriedEmitterId: cannon.id,
      carriedPortalWord: collectGeodesicPortalWord(registry, connectedGeodesicId),
      preserveGeodesicOnRebuildFailure: input.preserveGeodesicOnRebuildFailure,
    });
  };

  if (connectedIncidentGeodesicIds.length > 0) {
    for (const incidentGeodesicId of connectedIncidentGeodesicIds) {
      rebuildConnected(incidentGeodesicId);
    }
    return {};
  }
  if (geodesicId && arcFollowsEmitter(registry, geodesicId, cannon.id)) {
    rebuildConnected(geodesicId);
    return {};
  }
  // A tied arc is never regrown: its curve is not a ray from the emitter. An arc that is gone, lifted away, has nothing to regrow.
  const arc = geodesicId === undefined ? undefined : registry.get(geodesicId);
  if (geodesicId && arc?.kind === "geodesicModel/arc" && arc.intendedLengthMeters !== undefined && !isTied(registry, geodesicId)) {
    const launchYawRadians = resolveEmitterLaunchYaw(registry, cannon, geodesicId);
    rebuildGeodesicToLength({
      world,
      registry,
      cannon,
      geodesicId,
      launchYawRadians,
      totalLengthMeters: arc.intendedLengthMeters,
      connectEmitters: false,
    });
    return { regrownActiveGeodesicId: geodesicId, launchYawRadians };
  }

  return {};
}
