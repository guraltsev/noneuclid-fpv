/**
 * Queries whether an arc connects emitters or follows one, and removal of geodesics and cannons together with their derived objects.
 */
import type { RuntimeObjectReader, RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import type { GeodesicEmitterAttachment } from "./objects";
import {
  getEmitterGeodesicIds,
  isVertexSharedWithOtherArc,
} from "./endpoints";
import { removeGeodesicIntervalAndDerivedObjects, removeGeodesicSegments } from "./segments";

/**
 * Describes how an interval geodesic attaches to emitters.
 *
 * It is derived from the interval's attachments: start on an emitter gives `outgoing = start`, and `connected`
 * when the end is also an emitter (else `open`); an interval with only its end on an emitter reports that emitter as
 * outgoing and `open`. Returns `undefined` for an id that is not an interval or has no emitter at either end.
 */
export function getGeodesicConnection(
  registry: RuntimeObjectReader,
  geodesicId: string,
): GeodesicEmitterAttachment | undefined {
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesicModel/arc") {
    const start = registry.get(interval.start.anchorObjectId);
    const end = registry.get(interval.end.anchorObjectId);
    if (start?.kind === "geodesicEmitters/emitter") {
      return {
        outgoingEmitterId: start.id,
        incomingEmitterId: end?.kind === "geodesicEmitters/emitter" ? end.id : undefined,
        state: end?.kind === "geodesicEmitters/emitter" ? "connected" : "open",
      };
    }
    if (end?.kind === "geodesicEmitters/emitter") {
      return {
        outgoingEmitterId: end.id,
        state: "open",
      };
    }
  }
  return undefined;
}

/**
 * True when both ends of the arc are on emitters: a geodesic with no interior vertex. This is a fact about the ends, not a state.
 * An id that is not an arc never connects emitters.
 */
export function arcConnectsEmitters(registry: RuntimeObjectReader, arcId: string): boolean {
  const arc = registry.get(arcId);
  return arc?.kind === "geodesicModel/arc" &&
    registry.get(arc.start.anchorObjectId)?.kind === "geodesicEmitters/emitter" &&
    registry.get(arc.end.anchorObjectId)?.kind === "geodesicEmitters/emitter";
}

/**
 * The arc follows the emitter when it has an end on it and either connects emitters or its other end is a shared vertex (a tied arc).
 * Carrying the emitter keeps such an arc; a plain shot geodesic (an unshared free end) does not follow and is removed when the emitter is lifted.
 */
export function arcFollowsEmitter(registry: RuntimeObjectRegistry, arcId: string, emitterId: string): boolean {
  const arc = registry.get(arcId);
  if (arc?.kind !== "geodesicModel/arc") {
    return false;
  }
  const startOnEmitter = arc.start.anchorObjectId === emitterId;
  const endOnEmitter = arc.end.anchorObjectId === emitterId;
  if (!startOnEmitter && !endOnEmitter) {
    return false;
  }
  if (arcConnectsEmitters(registry, arcId)) {
    return true;
  }
  return isVertexSharedWithOtherArc(registry, startOnEmitter ? arc.end.anchorObjectId : arc.start.anchorObjectId, arcId);
}

/** Lists the ids of arcs that follow the emitter (see `arcFollowsEmitter`), in registry order. */
export function collectFollowingArcIdsForEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
): readonly string[] {
  return getEmitterGeodesicIds(registry, emitterId)
    .filter((arcId) => arcFollowsEmitter(registry, arcId, emitterId));
}

// ---- Removal ----

/** Removes a geodesic and its derived objects (an interval via `removeGeodesicIntervalAndDerivedObjects`; any other id only has stale segments and emitter cache entries removed), then refreshes intersections. */
export function removeGeodesic(registry: RuntimeObjectRegistry, geodesicId: string): void {
  if (registry.get(geodesicId)?.kind === "geodesicModel/arc") {
    removeGeodesicIntervalAndDerivedObjects(registry, geodesicId);
    return;
  }
  removeGeodesicSegments(registry, geodesicId);
}

/** Removes every geodesic of the cannon that does not follow it (a plain shot geodesic with an unshared free end) and returns the removed ids (empty if the id is not a cannon). Arcs that connect emitters and tied arcs stay. */
export function removePlainGeodesicsFromCannon(
  registry: RuntimeObjectRegistry,
  cannonId: string,
): readonly string[] {
  const cannon = registry.get(cannonId);
  if (cannon?.kind !== "geodesicEmitters/emitter") {
    return [];
  }

  const removed: string[] = [];
  for (const geodesicId of getEmitterGeodesicIds(registry, cannonId)) {
    if (arcFollowsEmitter(registry, geodesicId, cannonId)) {
      continue;
    }

    removeGeodesic(registry, geodesicId);
    removed.push(geodesicId);
  }

  return removed;
}

