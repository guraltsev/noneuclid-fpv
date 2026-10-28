/**
 * Scene-graph runtimes for placed flags, measured lengths, and protractor angles: sync, removal, and refresh.
 *
 * Bridges the runtime object registry (the source of truth for tool-created objects) and their Three.js
 * runtimes: `sync*` creates or updates a runtime from a registry object, `remove*` disposes a runtime and drops
 * its bookkeeping (and, for measurements and angles, cached instanced-render state), and `refresh*` recomputes
 * derived measurements after geodesics move, updating the registry and runtime only when something changed and
 * deleting objects that can no longer be recomputed. All maps are owned by createThreeApp and mutated in place;
 * poses are cell-local (meters, radians). Removing a registry object does not itself dispose its runtime,
 * so each removal path here pairs the two.
 */
import * as THREE from "three";
import { type PlayerPose } from "../../movement/playerPose";
import { refreshMeasuredGeodesicLengthObject } from "../../world-objects/measureLengthTool";
import { type ProtractorAngleObject, refreshProtractorAngleObject } from "../../world-objects/protractorTool";
import { type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import {
  MeasuredGeodesicLengthRuntime,
  createMeasuredGeodesicLengthRuntime,
} from "./measureLengthRenderer";
import { PlacedFlagRuntime, createPlacedFlagRuntime } from "./placedFlagRenderer";
import { PreparedWorldAssets } from "./preloadWorldAssets";
import { ProtractorAngleRuntime, createProtractorAngleRuntime } from "./protractorAngleRenderer";
import {
  RuntimeObjectRenderArchetype,
  disposeRuntimeObjectRenderArchetypes,
} from "./runtimeObjectRenderArchetypes";
import { RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";

/** Dependencies of the tool-object runtimes, supplied by createThreeApp's shell. */
export interface ToolObjectRuntimesDeps {
  /** Preloaded models/textures used to build placed-flag runtimes. */
  readonly assets: PreparedWorldAssets;
  /** Registry of runtime world objects, the source of truth these runtimes mirror. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Per-cell root objects (by cell id) that runtimes parent themselves under. */
  readonly cellMeshes: ReadonlyMap<string, THREE.Object3D>;
  /** Placed-flag runtimes by object id; shared with the shell and mutated here. */
  readonly placedFlagRuntimes: Map<string, PlacedFlagRuntime>;
  /** Measured-length runtimes by object id; shared with the shell and mutated here. */
  readonly measuredGeodesicLengthRuntimes: Map<string, MeasuredGeodesicLengthRuntime>;
  /** Protractor-angle runtimes by object id; shared with the shell and mutated here. */
  readonly protractorAngleRuntimes: Map<string, ProtractorAngleRuntime>;
  /** Scene root of every runtime object by object id, used for aiming and rendering lookups. */
  readonly runtimeObjectRootsById: Map<string, THREE.Object3D>;
  /** Source meshes feeding the instanced portal rendering, keyed by render key; entries here are dropped on removal. */
  readonly runtimeObjectRenderSourcesByKey: Map<string, RuntimeObjectRenderSourceMesh>;
  /** Instanced render archetypes by render key; invalidated entries are removed from the render root and disposed. */
  readonly runtimeObjectRenderArchetypesByKey: Map<string, RuntimeObjectRenderArchetype>;
  /** Parent object of the instanced archetype meshes. */
  readonly runtimeObjectRenderRoot: THREE.Object3D;
  /** Getter because the shell reassigns the player pose; used to re-measure lengths from the player's position. */
  getPlayerPose(): PlayerPose;
  /** Resets the shell's protractor tool state to empty. */
  resetProtractorToolState(): void;
  /** Removes the in-scene protractor preview feedback. */
  clearProtractorToolFeedback(): void;
  /** Rebuilds the instanced copies of runtime objects seen through portals. */
  syncRuntimeObjectPortalInstances(): void;
  /** Refreshes the selectable-hitbox debug wireframes. */
  syncSelectableHitboxDebug(): void;
}

/**
 * Creates the tool-object runtime manager and returns its sync, removal, and refresh operations.
 *
 * Callers pass registry objects of the matching kind to `sync*Runtime` (other kinds are ignored). Runtimes are disposed
 * only through the `remove*` functions, so whoever tears down the scene must call them (or the bulk
 * `removePlacedFlags`, `removeMeasuredGeodesicLengths`, `removeProtractorAngles`) to release GPU resources.
 */
export function createToolObjectRuntimes(deps: ToolObjectRuntimesDeps) {
  const {
    assets,
    runtimeObjectRegistry,
    cellMeshes,
    placedFlagRuntimes,
    measuredGeodesicLengthRuntimes,
    protractorAngleRuntimes,
    runtimeObjectRootsById,
    runtimeObjectRenderSourcesByKey,
    runtimeObjectRenderArchetypesByKey,
    runtimeObjectRenderRoot,
    clearProtractorToolFeedback,
    syncRuntimeObjectPortalInstances,
    syncSelectableHitboxDebug,
  } = deps;

  function syncPlacedFlagRuntime(flag: RuntimeWorldObject): void {
    if (flag.kind !== "placed-flag") {
      return;
    }

    let runtime = placedFlagRuntimes.get(flag.id);
    if (!runtime) {
      runtime = createPlacedFlagRuntime(flag, assets);
      placedFlagRuntimes.set(flag.id, runtime);
      runtimeObjectRootsById.set(flag.id, runtime.root);
    }

    runtime.syncFromObject(flag);
    runtime.syncParent(cellMeshes);
    syncRuntimeObjectPortalInstances();
  }

  function removePlacedFlagRuntime(flagId: string): void {
    const runtime = placedFlagRuntimes.get(flagId);

    if (!runtime) {
      return;
    }

    runtime.dispose();
    placedFlagRuntimes.delete(flagId);
    runtimeObjectRootsById.delete(flagId);
    invalidateRuntimeObjectRenderState(flagId);
  }

  function syncMeasuredGeodesicLengthRuntime(object: RuntimeWorldObject): void {
    if (object.kind !== "measured-geodesic-length") {
      return;
    }

    let runtime = measuredGeodesicLengthRuntimes.get(object.id);
    if (!runtime) {
      runtime = createMeasuredGeodesicLengthRuntime(object);
      measuredGeodesicLengthRuntimes.set(object.id, runtime);
    } else {
      invalidateRuntimeObjectRenderState(object.id);
    }

    runtime.syncFromObject(object);
    runtimeObjectRootsById.set(object.id, runtime.root);
    syncRuntimeObjectPortalInstances();
  }

  function removeMeasuredGeodesicLengthRuntime(objectId: string): void {
    const runtime = measuredGeodesicLengthRuntimes.get(objectId);
    if (runtime) {
      runtime.dispose();
      measuredGeodesicLengthRuntimes.delete(objectId);
    }

    runtimeObjectRootsById.delete(objectId);
    invalidateRuntimeObjectRenderState(objectId);
  }

  function syncProtractorAngleRuntime(object: RuntimeWorldObject): void {
    if (object.kind !== "protractor-angle") {
      return;
    }

    let runtime = protractorAngleRuntimes.get(object.id);
    if (!runtime) {
      runtime = createProtractorAngleRuntime(object);
      protractorAngleRuntimes.set(object.id, runtime);
    } else {
      invalidateRuntimeObjectRenderState(object.id);
    }

    runtime.syncFromObject(object);
    runtimeObjectRootsById.set(object.id, runtime.root);
    syncRuntimeObjectPortalInstances();
  }

  function removeProtractorAngleRuntime(objectId: string): void {
    const runtime = protractorAngleRuntimes.get(objectId);
    if (runtime) {
      runtime.dispose();
      protractorAngleRuntimes.delete(objectId);
    }

    runtimeObjectRootsById.delete(objectId);
    invalidateRuntimeObjectRenderState(objectId);
  }

  // Drops cached instanced-render sources/archetypes for an object so the next portal-instance sync rebuilds them.
  function invalidateRuntimeObjectRenderState(objectId: string): void {
    for (const [key, source] of [...runtimeObjectRenderSourcesByKey]) {
      if (source.objectId === objectId) {
        runtimeObjectRenderSourcesByKey.delete(key);
        const archetype = runtimeObjectRenderArchetypesByKey.get(key);
        if (archetype) {
          runtimeObjectRenderRoot.remove(archetype.mesh);
          disposeRuntimeObjectRenderArchetypes([archetype]);
          runtimeObjectRenderArchetypesByKey.delete(key);
        }
      }
    }
  }

  function removePlacedFlags(): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "placed-flag") {
        runtimeObjectRegistry.remove(object.id);
        removePlacedFlagRuntime(object.id);
      }
    }
    syncRuntimeObjectPortalInstances();
  }

  function removeMeasuredGeodesicLengths(): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "measured-geodesic-length") {
        runtimeObjectRegistry.remove(object.id);
        removeMeasuredGeodesicLengthRuntime(object.id);
      }
    }
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  function removeMeasuredGeodesicLengthsForGeodesic(geodesicId: string): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "measured-geodesic-length" && object.geodesicId === geodesicId) {
        runtimeObjectRegistry.remove(object.id);
        removeMeasuredGeodesicLengthRuntime(object.id);
      }
    }
  }

  function refreshMeasuredGeodesicLengths(): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind !== "measured-geodesic-length") {
        continue;
      }

      refreshMeasuredGeodesicLength(object);
    }
  }

  function refreshMeasuredGeodesicLengthsForGeodesic(geodesicId: string): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "measured-geodesic-length" && object.geodesicId === geodesicId) {
        refreshMeasuredGeodesicLength(object);
      }
    }
  }

  function refreshMeasuredGeodesicLength(
    object: Extract<RuntimeWorldObject, { readonly kind: "measured-geodesic-length" }>,
  ): void {
    // A falsy result means the measurement could not be recomputed: delete the object and its runtime.
    const refreshed = refreshMeasuredGeodesicLengthObject({
      registry: runtimeObjectRegistry,
      measurement: object,
      playerCellId: deps.getPlayerPose().cellId,
      playerPoint: deps.getPlayerPose().position,
    });
    if (!refreshed) {
      runtimeObjectRegistry.remove(object.id);
      removeMeasuredGeodesicLengthRuntime(object.id);
      return;
    }

    // Only the fields that affect rendering are compared; the rotation check covers just m00/m10 (the yaw),
    // plus the pose translation.
    const changed =
      refreshed.cellId !== object.cellId ||
      refreshed.lengthMeters !== object.lengthMeters ||
      refreshed.labelPoint.x !== object.labelPoint.x ||
      refreshed.labelPoint.y !== object.labelPoint.y ||
      refreshed.labelPoint.z !== object.labelPoint.z ||
      refreshed.localPose.rotation.m00 !== object.localPose.rotation.m00 ||
      refreshed.localPose.rotation.m10 !== object.localPose.rotation.m10 ||
      refreshed.localPose.translation.x !== object.localPose.translation.x ||
      refreshed.localPose.translation.y !== object.localPose.translation.y ||
      refreshed.localPose.translation.z !== object.localPose.translation.z ||
      refreshed.segmentId !== object.segmentId;
    if (!changed) {
      return;
    }

    runtimeObjectRegistry.update(refreshed);
    syncMeasuredGeodesicLengthRuntime(refreshed);
  }

  function removeProtractorAngles(): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "protractor-angle") {
        runtimeObjectRegistry.remove(object.id);
        removeProtractorAngleRuntime(object.id);
      }
    }
    deps.resetProtractorToolState();
    clearProtractorToolFeedback();
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  function removeProtractorAnglesForGeodesic(geodesicId: string): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (
        object.kind === "protractor-angle" &&
        (object.first.geodesicId === geodesicId || object.second.geodesicId === geodesicId)
      ) {
        runtimeObjectRegistry.remove(object.id);
        removeProtractorAngleRuntime(object.id);
      }
    }
  }

  function removeProtractorAnglesForMissingVertices(vertexIds: readonly string[]): void {
    if (vertexIds.length === 0) {
      return;
    }

    const missingVertexIds = new Set(vertexIds);
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "protractor-angle" && missingVertexIds.has(object.centerObjectId)) {
        runtimeObjectRegistry.remove(object.id);
        removeProtractorAngleRuntime(object.id);
      }
    }
  }

  function refreshProtractorAnglesForGeodesic(geodesicId: string): void {
    refreshProtractorAnglesForGeodesics([geodesicId]);
  }

  function refreshProtractorAnglesForGeodesics(geodesicIds: readonly string[]): void {
    const affectedGeodesicIds = new Set(geodesicIds);
    const angles = runtimeObjectRegistry.getAll().filter((object): object is ProtractorAngleObject =>
      object.kind === "protractor-angle" &&
      (affectedGeodesicIds.has(object.first.geodesicId) || affectedGeodesicIds.has(object.second.geodesicId))
    );
    for (const object of angles) {
      const refreshed = refreshProtractorAngleObject({
        registry: runtimeObjectRegistry,
        angle: object,
      });
      if (!refreshed) {
        runtimeObjectRegistry.remove(object.id);
        removeProtractorAngleRuntime(object.id);
        continue;
      }

      runtimeObjectRegistry.update(refreshed);
      syncProtractorAngleRuntime(refreshed);
    }
  }

  return {
    syncPlacedFlagRuntime,
    removePlacedFlagRuntime,
    syncMeasuredGeodesicLengthRuntime,
    removeMeasuredGeodesicLengthRuntime,
    syncProtractorAngleRuntime,
    removeProtractorAngleRuntime,
    removePlacedFlags,
    removeMeasuredGeodesicLengths,
    removeMeasuredGeodesicLengthsForGeodesic,
    refreshMeasuredGeodesicLengths,
    refreshMeasuredGeodesicLengthsForGeodesic,
    removeProtractorAngles,
    removeProtractorAnglesForGeodesic,
    removeProtractorAnglesForMissingVertices,
    refreshProtractorAnglesForGeodesic,
    refreshProtractorAnglesForGeodesics,
  };
}
