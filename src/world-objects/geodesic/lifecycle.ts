/**
 * Queries whether a geodesic is locked or connected, and removal of geodesics and cannons together with their derived objects.
 */
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import type { GeodesicEmitterAttachment } from "./objects";
import { requestGeodesicIntersectionUpdate, withDeferredGeodesicIntersections } from "./intersections";
import {
  getEmitterGeodesicIds,
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
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): GeodesicEmitterAttachment | undefined {
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesic-interval") {
    const start = registry.get(interval.start.anchorObjectId);
    const end = registry.get(interval.end.anchorObjectId);
    if (start?.kind === "geodesic-cannon") {
      return {
        outgoingEmitterId: start.id,
        incomingEmitterId: end?.kind === "geodesic-cannon" ? end.id : undefined,
        state: end?.kind === "geodesic-cannon" ? "connected" : "open",
      };
    }
    if (end?.kind === "geodesic-cannon") {
      return {
        outgoingEmitterId: end.id,
        state: "open",
      };
    }
  }
  return undefined;
}

// Emitters are pinned anchors; a free end is not.
function isPinnedAnchorKind(kind: string | undefined): boolean {
  return kind === "geodesic-cannon";
}

/**
 * True when both endpoints of the geodesic are pinned anchors, each an emitter (a "locked" geodesic that cannot be extended or aimed freely).
 * An id that is not an interval is never locked.
 */
export function isGeodesicLocked(registry: RuntimeObjectRegistry, geodesicId: string): boolean {
  const interval = registry.get(geodesicId);
  return interval?.kind === "geodesic-interval" &&
    isPinnedAnchorKind(registry.get(interval.start.anchorObjectId)?.kind) &&
    isPinnedAnchorKind(registry.get(interval.end.anchorObjectId)?.kind);
}

/** Lists the ids of locked geodesics (see `isGeodesicLocked`) that have an endpoint on the emitter. */
export function collectLockedIncidentGeodesicIdsForEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
): readonly string[] {
  return getEmitterGeodesicIds(registry, emitterId)
    .filter((geodesicId) => isGeodesicLocked(registry, geodesicId));
}

// ---- Removal ----

/** Removes a geodesic and its derived objects (an interval via `removeGeodesicIntervalAndDerivedObjects`; any other id only has stale segments and emitter cache entries removed), then refreshes intersections. */
export function removeGeodesic(registry: RuntimeObjectRegistry, geodesicId: string): void {
  withDeferredGeodesicIntersections(registry, () => removeGeodesicNow(registry, geodesicId));
}

function removeGeodesicNow(registry: RuntimeObjectRegistry, geodesicId: string): void {
  if (registry.get(geodesicId)?.kind === "geodesic-interval") {
    removeGeodesicIntervalAndDerivedObjects(registry, geodesicId);
    return;
  }
  removeGeodesicSegments(registry, geodesicId);
  requestGeodesicIntersectionUpdate(registry);
}

/** Removes every non-locked geodesic listed on the cannon and returns the removed ids (empty if the id is not a cannon). */
export function removeUnlockedGeodesicsFromCannon(
  registry: RuntimeObjectRegistry,
  cannonId: string,
): readonly string[] {
  return withDeferredGeodesicIntersections(registry, () => removeUnlockedGeodesicsFromCannonNow(registry, cannonId));
}

function removeUnlockedGeodesicsFromCannonNow(
  registry: RuntimeObjectRegistry,
  cannonId: string,
): readonly string[] {
  const cannon = registry.get(cannonId);
  if (cannon?.kind !== "geodesic-cannon") {
    return [];
  }

  const removed: string[] = [];
  for (const geodesicId of getEmitterGeodesicIds(registry, cannonId)) {
    if (isGeodesicLocked(registry, geodesicId)) {
      continue;
    }

    removeGeodesic(registry, geodesicId);
    removed.push(geodesicId);
  }

  return removed;
}

