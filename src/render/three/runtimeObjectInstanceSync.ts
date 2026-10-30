/**
 * Runtime-object instance sync: brings the instanced render archetypes of runtime objects up to date and writes
 * their instances from one {@link FrameRenderSnapshot}.
 *
 * The sync is called once per frame (plus once at setup and once after debug settings change), after the portal pass
 * has built the snapshot. It uses only the snapshot's rendered root, visible paths, clip rows and viewer positions, so
 * objects follow the root that is actually rendered (also in single-view XR when the eye is re-rooted through a
 * portal) and the per-eye camera positions. Per sync it (a) updates the render sources and the archetype-key prefix
 * index, (b) collects the render records once, (c) creates or grows archetypes, and (d) writes every archetype's
 * instances. Records of unchanged objects (same registry value, same world, same archetype keys) are reused,
 * ghosts included. It never touches the selectable-hitbox debug meshes.
 */
import type * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { PlayerPose } from "../../movement/playerPose";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import type { FrameRenderSnapshot } from "./frameRenderSnapshot";
import { collectGeodesicRuntimeRenderRecords } from "./geodesicCannonRenderer";
import type { PlayerRoverRenderModel } from "./playerRoverModel";
import { updateRuntimeObjectRenderArchetypeInstances } from "./renderPortalInstances";
import { collectPortalGhostRuntimeObjectRenderRecords } from "./runtimeObjectGhostRecords";
import {
  type RuntimeObjectRenderArchetype,
  type RuntimeObjectRenderArchetypeDiagnostics,
  deriveRuntimeObjectRenderArchetypeCapacity,
  disposeRuntimeObjectRenderArchetypes,
  groupRuntimeObjectRenderRecordsByArchetype,
} from "./runtimeObjectRenderArchetypes";
import {
  type RuntimeObjectRenderRecord,
  type RuntimeObjectRenderSourceMesh,
  collectRuntimeObjectRenderSourceMeshes,
  computeRenderSourceFootprintRadius,
} from "./runtimeObjectRenderRecords";
import { isGeodesicRuntimeRenderObject, runtimeObjectArchetypeKeyPrefix } from "./runtimeSceneUtils";
import { rigidTransformToThreeMatrix } from "./worldAxes";

/** Inputs of {@link createRuntimeObjectInstanceSync}; the maps are shared with the tool object runtimes and mutated here. */
export interface RuntimeObjectInstanceSyncDeps {
  readonly registry: RuntimeObjectRegistry;
  readonly runtimeObjectRootsById: ReadonlyMap<string, THREE.Object3D>;
  /** Shared with toolObjectRuntimes (which deletes keys directly on invalidation). */
  readonly renderSourcesByKey: Map<string, RuntimeObjectRenderSourceMesh>;
  /** Shared with toolObjectRuntimes. */
  readonly renderArchetypesByKey: Map<string, RuntimeObjectRenderArchetype>;
  /** Scene group the archetype meshes are added to. */
  readonly renderRoot: THREE.Object3D;
  readonly geodesicRenderSources: readonly RuntimeObjectRenderSourceMesh[];
  readonly geodesicArchetypeKeys: readonly string[];
  readonly playerRoverRenderModel: PlayerRoverRenderModel | undefined;
  readonly maxVisiblePaths: number;
  readonly diagnostics: RuntimeObjectRenderArchetypeDiagnostics;
  getWorld(): CompiledCellComplex;
  getPlayerPose(): PlayerPose;
  /** Builds a new archetype and installs whatever hooks the shell needs on its mesh. */
  buildArchetype(source: RuntimeObjectRenderSourceMesh, capacity: number): RuntimeObjectRenderArchetype;
}

/** Handle returned by {@link createRuntimeObjectInstanceSync}. */
export interface RuntimeObjectInstanceSync {
  /**
   * Brings sources and archetypes up to date, collects records once and writes every archetype's instances from
   * `snapshot.objectPathsByDestinationCell`, `snapshot.clipIndexByPathId` and `snapshot.cameraPositions`.
   */
  sync(snapshot: FrameRenderSnapshot): void;
  /** Counters for tests and diagnostics; never reset. */
  readonly stats: {
    readonly syncs: number;
    readonly recordCollections: number;
    readonly ghostComputations: number;
  };
}

interface CachedObjectRecords {
  readonly object: RuntimeWorldObject;
  readonly world: CompiledCellComplex;
  readonly archetypeKeys: readonly string[];
  readonly records: readonly RuntimeObjectRenderRecord[];
}

const meshKeySeparator = ":mesh:";
const noKeys: readonly string[] = [];

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Creates the instance sync. The footprint-radius cache and the per-object record cache live inside the returned closure. */
export function createRuntimeObjectInstanceSync(deps: RuntimeObjectInstanceSyncDeps): RuntimeObjectInstanceSync {
  const { registry, runtimeObjectRootsById, renderSourcesByKey, renderArchetypesByKey, renderRoot } = deps;
  const footprintCache = new Map<string, {
    readonly first: RuntimeObjectRenderSourceMesh | undefined;
    readonly count: number;
    readonly radius: number;
  }>();
  const recordCacheByObjectId = new Map<string, CachedObjectRecords>();
  // Source keys last collected per object (key `object:<id>`) and for the rover (`rover`), with the root they came from.
  const sourceKeysByObjectId = new Map<string, { readonly root: THREE.Object3D; readonly keys: readonly string[] }>();
  const seenSourceKeys = new Set<string>();
  let archetypeKeysByPrefix = new Map<string, string[]>();
  const stats = { syncs: 0, recordCollections: 0, ghostComputations: 0 };

  function footprintRadius(prefix: string, archetypeKeys: readonly string[]): number {
    const sources = archetypeKeys
      .map((key) => renderSourcesByKey.get(key))
      .filter((source): source is RuntimeObjectRenderSourceMesh => source !== undefined);
    const cached = footprintCache.get(prefix);

    if (cached && cached.first === sources[0] && cached.count === sources.length) {
      return cached.radius;
    }

    const radius = computeRenderSourceFootprintRadius(sources);
    footprintCache.set(prefix, { first: sources[0], count: sources.length, radius });
    return radius;
  }

  function rebuildPrefixIndex(): void {
    const index = new Map<string, string[]>();

    for (const key of renderSourcesByKey.keys()) {
      const separator = key.lastIndexOf(meshKeySeparator);
      if (separator < 0) {
        continue;
      }

      const prefix = key.slice(0, separator);
      const keys = index.get(prefix);
      if (keys) {
        keys.push(key);
      } else {
        index.set(prefix, [key]);
      }
    }

    archetypeKeysByPrefix = index;
  }

  function syncSources(objects: readonly RuntimeWorldObject[]): ReadonlySet<string> {
    const activeKeys = new Set<string>();
    const addSource = (source: RuntimeObjectRenderSourceMesh): void => {
      activeKeys.add(source.archetypeKey);
      if (!renderSourcesByKey.has(source.archetypeKey)) {
        renderSourcesByKey.set(source.archetypeKey, source);
      }
    };

    if (objects.some((object) => object.portalRenderable && isGeodesicRuntimeRenderObject(object))) {
      for (const source of deps.geodesicRenderSources) {
        addSource(source);
      }
    }

    // Re-collects only when the root changed or one of the cached keys left the shared source map (the tool
    // runtimes delete keys on invalidation, which is exactly the signal to traverse again).
    const addCachedOrCollect = (
      cacheKey: string,
      root: THREE.Object3D,
      collect: () => readonly RuntimeObjectRenderSourceMesh[],
    ): void => {
      seenSourceKeys.add(cacheKey);
      const cached = sourceKeysByObjectId.get(cacheKey);

      if (cached && cached.root === root && cached.keys.every((key) => renderSourcesByKey.has(key))) {
        for (const key of cached.keys) {
          activeKeys.add(key);
        }
        return;
      }

      const sources = collect();
      for (const source of sources) {
        addSource(source);
      }
      sourceKeysByObjectId.set(cacheKey, { root, keys: sources.map((source) => source.archetypeKey) });
    };

    seenSourceKeys.clear();
    if (deps.playerRoverRenderModel) {
      const rover = deps.playerRoverRenderModel;
      addCachedOrCollect("rover", rover.root, () => rover.collectSources());
    }

    for (const object of objects) {
      if (!object.portalRenderable || isGeodesicRuntimeRenderObject(object)) {
        continue;
      }

      const root = runtimeObjectRootsById.get(object.id);
      if (!root) {
        continue;
      }

      addCachedOrCollect(`object:${object.id}`, root, () =>
        collectRuntimeObjectRenderSourceMeshes(object.id, root, runtimeObjectArchetypeKeyPrefix(object))
      );
    }

    for (const cacheKey of [...sourceKeysByObjectId.keys()]) {
      if (!seenSourceKeys.has(cacheKey)) {
        sourceKeysByObjectId.delete(cacheKey);
      }
    }

    for (const [key, archetype] of [...renderArchetypesByKey]) {
      if (activeKeys.has(key)) {
        continue;
      }

      renderRoot.remove(archetype.mesh);
      disposeRuntimeObjectRenderArchetypes([archetype]);
      renderArchetypesByKey.delete(key);
      renderSourcesByKey.delete(key);
    }

    return activeKeys;
  }

  function collectRecords(objects: readonly RuntimeWorldObject[]): readonly RuntimeObjectRenderRecord[] {
    const world = deps.getWorld();
    const seenIds = new Set<string>();
    const records: RuntimeObjectRenderRecord[] = [];

    for (const object of objects) {
      const geodesic = object.portalRenderable && isGeodesicRuntimeRenderObject(object);
      if (!geodesic && (!object.portalRenderable || !runtimeObjectRootsById.has(object.id))) {
        continue;
      }

      seenIds.add(object.id);
      const prefix = geodesic ? "" : runtimeObjectArchetypeKeyPrefix(object);
      const archetypeKeys = geodesic ? deps.geodesicArchetypeKeys : archetypeKeysByPrefix.get(prefix) ?? noKeys;
      const cached = recordCacheByObjectId.get(object.id);

      if (cached && cached.object === object && cached.world === world && sameStrings(cached.archetypeKeys, archetypeKeys)) {
        records.push(...cached.records);
        continue;
      }

      let objectRecords: readonly RuntimeObjectRenderRecord[];
      if (geodesic) {
        objectRecords = collectGeodesicRuntimeRenderRecords(object, deps.geodesicArchetypeKeys);
      } else {
        const localMatrix = rigidTransformToThreeMatrix(object.localPose);
        stats.ghostComputations += 1;
        objectRecords = [
          ...archetypeKeys.map((archetypeKey) => ({
            objectId: object.id,
            cellId: object.cellId,
            archetypeKey,
            localMatrix,
          })),
          ...collectPortalGhostRuntimeObjectRenderRecords({
            world,
            object,
            archetypeKeys,
            footprintRadiusMeters: footprintRadius(prefix, archetypeKeys),
          }),
        ];
      }

      recordCacheByObjectId.set(object.id, { object, world, archetypeKeys: [...archetypeKeys], records: objectRecords });
      records.push(...objectRecords);
    }

    for (const id of [...recordCacheByObjectId.keys()]) {
      if (!seenIds.has(id)) {
        recordCacheByObjectId.delete(id);
      }
    }

    if (deps.playerRoverRenderModel) {
      records.push(...deps.playerRoverRenderModel.collectRecords(deps.getPlayerPose(), renderSourcesByKey.keys()));
    }

    return records;
  }

  function syncArchetypes(
    activeKeys: ReadonlySet<string>,
    recordsByArchetypeKey: ReadonlyMap<string, readonly RuntimeObjectRenderRecord[]>,
  ): void {
    for (const key of activeKeys) {
      const capacity = deriveRuntimeObjectRenderArchetypeCapacity(
        recordsByArchetypeKey.get(key)?.length ?? 1,
        deps.maxVisiblePaths,
      );
      const existing = renderArchetypesByKey.get(key);
      if (existing && existing.capacity >= capacity) {
        continue;
      }

      const source = renderSourcesByKey.get(key);
      if (!source) {
        continue;
      }

      if (existing) {
        renderRoot.remove(existing.mesh);
        disposeRuntimeObjectRenderArchetypes([existing]);
        renderArchetypesByKey.delete(key);
      }

      const archetype = deps.buildArchetype(source, capacity);
      renderArchetypesByKey.set(key, archetype);
      renderRoot.add(archetype.mesh);
    }
  }

  return {
    sync(snapshot) {
      const objects = registry.getAll();
      const activeKeys = syncSources(objects);
      rebuildPrefixIndex();
      const records = collectRecords(objects);
      stats.recordCollections += 1;
      const recordsByArchetypeKey = groupRuntimeObjectRenderRecordsByArchetype(records);
      syncArchetypes(activeKeys, recordsByArchetypeKey);
      deps.diagnostics.reset();
      updateRuntimeObjectRenderArchetypeInstances(
        [...renderArchetypesByKey.values()],
        recordsByArchetypeKey,
        snapshot.objectPathsByDestinationCell,
        deps.diagnostics,
        snapshot.clipIndexByPathId,
        { cameraPositions: snapshot.cameraPositions },
      );
      stats.syncs += 1;
    },
    stats: {
      get syncs() {
        return stats.syncs;
      },
      get recordCollections() {
        return stats.recordCollections;
      },
      get ghostComputations() {
        return stats.ghostComputations;
      },
    },
  };
}
