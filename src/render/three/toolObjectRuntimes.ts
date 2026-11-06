/**
 * Scene-graph runtimes for placed flags, measured lengths, and protractor angles: sync and removal.
 *
 * Bridges the runtime object registry (the source of truth for tool-created objects) and their Three.js
 * runtimes: `sync*` creates or updates a runtime from a registry object, `remove*` disposes a runtime and drops
 * its bookkeeping (and, for measurements and angles, cached instanced-render state), and `syncToolObjectRuntimesFromJournal`
 * brings the runtimes up to date with the flag, length and angle records the commands and ticks of their modules wrote
 * (those ticks, not this file, recompute the values). This file writes no record. All maps are owned by createThreeApp and mutated in place;
 * poses are cell-local (meters, radians). Removing a registry object does not itself dispose its runtime,
 * so each removal path here pairs the two.
 * A hidden angle has no runtime: nothing of it is drawn or aimed at, and its countdown writes the record every tick, which must not rebuild a label.
 */
import * as THREE from "three";
import type { RuntimeObjectReader, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import {
  MeasuredGeodesicLengthRuntime,
  createMeasuredGeodesicLengthRuntime,
} from "./measureLengthRenderer";
import { PlacedFlagRuntime, createPlacedFlagRuntime } from "./placedFlagRenderer";
import { PreparedWorldAssets } from "./preparedWorldAssets";
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
  readonly runtimeObjectRegistry: RuntimeObjectReader;
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
  /** Requests a refresh of the selectable-hitbox debug wireframes; the frame performs it. */
  syncSelectableHitboxDebug(): void;
}

/**
 * Creates the tool-object runtime manager and returns its sync, removal, and refresh operations.
 *
 * Callers pass registry objects of the matching kind to `sync*Runtime` (other kinds are ignored). Runtimes are disposed
 * only through the `remove*` functions, so whoever tears down the scene must call them to release GPU resources.
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
    syncSelectableHitboxDebug,
  } = deps;

  function syncPlacedFlagRuntime(flag: RuntimeWorldObject): void {
    if (flag.kind !== "placedFlags/flag") {
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
    if (object.kind !== "geodesicMeasurements/length") {
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
    if (object.kind !== "geodesicMeasurements/angle") {
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

  // Where these runtimes read the world: every flag, length or angle record written since the frame began (design 013 section 6.3). A record that is gone from the registry, or hidden, has no runtime.
  function syncToolObjectRuntimesFromJournal(): void {
    const journal = runtimeObjectRegistry.changes;
    let touched: Set<string> | undefined;
    for (let index = 0; index < journal.length; index += 1) {
      const kind = journal.kindAt(index);
      if (kind === "placedFlags/flag" || kind === "geodesicMeasurements/length" || kind === "geodesicMeasurements/angle") (touched ??= new Set()).add(journal.idAt(index));
    }
    if (touched === undefined) return;
    const runtimeCount = () => placedFlagRuntimes.size + measuredGeodesicLengthRuntimes.size + protractorAngleRuntimes.size;
    const runtimesBefore = runtimeCount();
    for (const id of touched) {
      const object = runtimeObjectRegistry.get(id);
      if (object?.kind === "placedFlags/flag") {
        syncPlacedFlagRuntime(object);
      } else if (object?.kind === "geodesicMeasurements/length") {
        syncMeasuredGeodesicLengthRuntime(object);
      } else if (object?.kind === "geodesicMeasurements/angle" && object.vanishedSecondsLeft === undefined) {
        syncProtractorAngleRuntime(object);
      } else {
        removePlacedFlagRuntime(id);
        removeMeasuredGeodesicLengthRuntime(id);
        removeProtractorAngleRuntime(id);
      }
    }
    if (runtimeCount() !== runtimesBefore) syncSelectableHitboxDebug();
  }

  return {
    syncPlacedFlagRuntime,
    removePlacedFlagRuntime,
    removeMeasuredGeodesicLengthRuntime,
    removeProtractorAngleRuntime,
    syncToolObjectRuntimesFromJournal,
  };
}
