/**
 * Queries whether a geodesic is locked or connected, and removal of geodesics and cannons together with their derived objects.
 */
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import type { GeodesicEmitterConnection } from "./objects";
import { updateGeodesicIntersectionObjects } from "./intersections";
import {
  collectIncidentGeodesicIdsForEmitter,
  findSourceEmitterForGeodesic,
  getGeodesicEndpointAttachmentsForAnchor,
  removeGeodesicAssociations,
} from "./endpoints";
import { getGeodesicTail, removeGeodesicIntervalAndDerivedObjects, removeGeodesicSegments } from "./segments";

/**
 * Describes the emitter connection of a geodesic.
 *
 * For an interval it is derived from the attachments: start on an emitter gives `outgoing = start`, and `connected`
 * when the end is also an emitter (else `open`); an interval with only its end on an emitter reports that emitter as
 * outgoing and `open`. Legacy: otherwise falls back to the cannon-stored `geodesicConnectionsById` records and finally to
 * the source emitter, reporting `open`. Returns `undefined` when nothing owns the geodesic.
 */
export function getGeodesicConnection(
  registry: RuntimeObjectRegistry,
  geodesicId: string,
): GeodesicEmitterConnection | undefined {
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

  for (const object of registry.getAll()) {
    if (object.kind !== "geodesic-cannon") {
      continue;
    }

    const connection = object.geodesicConnectionsById?.[geodesicId];
    if (connection) {
      return connection;
    }
  }

  const source = findSourceEmitterForGeodesic(registry, geodesicId);
  return source ? { outgoingEmitterId: source.id, state: "open" } : undefined;
}

/**
 * True when both endpoints of the geodesic are emitters (a "locked" geodesic that cannot be extended or aimed freely).
 *
 * Legacy: for non-interval geodesics, falls back to `connected`/`straightening` connection state or an `emitter-hit` tail.
 */
export function isGeodesicLocked(registry: RuntimeObjectRegistry, geodesicId: string): boolean {
  const interval = registry.get(geodesicId);
  if (interval?.kind === "geodesic-interval") {
    return registry.get(interval.start.anchorObjectId)?.kind === "geodesic-cannon" &&
      registry.get(interval.end.anchorObjectId)?.kind === "geodesic-cannon";
  }

  const state = getGeodesicConnection(registry, geodesicId)?.state;
  if (state === "connected" || state === "straightening") {
    return true;
  }

  return getGeodesicTail(registry, geodesicId)?.terminal.kind === "emitter-hit";
}

/** Lists the ids of locked geodesics (see `isGeodesicLocked`) that have an endpoint on the emitter. */
export function collectLockedIncidentGeodesicIdsForEmitter(
  registry: RuntimeObjectRegistry,
  emitterId: string,
): readonly string[] {
  return collectIncidentGeodesicIdsForEmitter(registry, emitterId)
    .filter((geodesicId) => isGeodesicLocked(registry, geodesicId));
}

// ---- Removal ----

/** Removes a geodesic and its derived objects (interval path via `removeGeodesicIntervalAndDerivedObjects`; legacy path removes segments and emitter associations), then refreshes intersections. */
export function removeGeodesic(registry: RuntimeObjectRegistry, geodesicId: string): void {
  if (registry.get(geodesicId)?.kind === "geodesic-interval") {
    removeGeodesicIntervalAndDerivedObjects(registry, geodesicId);
    return;
  }
  removeGeodesicSegments(registry, geodesicId);
  removeGeodesicAssociations(registry, geodesicId);
  updateGeodesicIntersectionObjects(registry);
}

/** Removes every non-locked geodesic listed on the cannon and returns the removed ids (empty if the id is not a cannon). */
export function removeUnlockedGeodesicsFromCannon(
  registry: RuntimeObjectRegistry,
  cannonId: string,
): readonly string[] {
  const cannon = registry.get(cannonId);
  if (cannon?.kind !== "geodesic-cannon") {
    return [];
  }

  const removed: string[] = [];
  for (const geodesicId of cannon.geodesicIds) {
    if (isGeodesicLocked(registry, geodesicId)) {
      continue;
    }

    removeGeodesic(registry, geodesicId);
    removed.push(geodesicId);
  }

  return removed;
}

/**
 * Deletes a cannon and every geodesic that starts, ends, or connects (as incoming emitter) on it.
 *
 * Geodesics owned by other emitters but arriving here are removed as well. Safe for non-cannon ids (only the final
 * remove and intersection refresh run).
 */
export function removeGeodesicCannonAndSegments(registry: RuntimeObjectRegistry, cannonId: string): void {
  const cannon = registry.get(cannonId);
  if (cannon?.kind === "geodesic-cannon") {
    const geodesicIds = new Set(getGeodesicEndpointAttachmentsForAnchor(registry, cannonId).map((attachment) => attachment.geodesicId));
    for (const geodesicId of cannon.geodesicIds) {
      geodesicIds.add(geodesicId);
    }
    if (cannon.activeGeodesicId) {
      geodesicIds.add(cannon.activeGeodesicId);
    }
    for (const geodesicId of geodesicIds) {
      removeGeodesic(registry, geodesicId);
    }
  }
  for (const object of registry.getAll()) {
    if (
      object.kind === "geodesic-cannon" &&
      object.id !== cannonId &&
      object.geodesicIds.some((geodesicId) =>
        getGeodesicConnection(registry, geodesicId)?.incomingEmitterId === cannonId
      )
    ) {
      for (const geodesicId of object.geodesicIds) {
        if (getGeodesicConnection(registry, geodesicId)?.incomingEmitterId === cannonId) {
          removeGeodesic(registry, geodesicId);
        }
      }
    }
  }
  registry.remove(cannonId);
  updateGeodesicIntersectionObjects(registry);
}
