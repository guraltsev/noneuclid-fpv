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
 * ghosts included. While the session names a carried object, a translucent highlight shape (declared by the object, an ellipsoid for an emitter) around it is drawn
 * (`carryHighlight.ts`) at the object's place and at its own portal ghosts, decided by the shape's reach, so it is whole on whichever side of a portal the viewer is.
 * It never touches the selectable-hitbox debug meshes.
 */
import { localParticipantId, readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import { participantAttachment } from "../../engine/moduleTypes";
import { carryAttachmentKind } from "../../modules/carry/api";
import type { ClientSession } from "../../runtime/clientSession";
import type * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { RuntimeObjectReader, RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState } from "../../world-objects/runtimeObjectBase";
import { collectCarryHighlightRecords, createCarryHighlightSource, type CarryHighlightObject } from "./carryHighlight";
import type { FrameRenderSnapshot } from "./frameRenderSnapshot";
import { collectGeodesicBodyPlacements, collectGeodesicRuntimeRenderRecords, emitterHeadsKey } from "./geodesicCannonRenderer";
import type { PlayerRoverRenderModel } from "./playerRoverModel";
import { updateRuntimeObjectRenderArchetypeInstances } from "./renderPortalInstances";
import {
  collectRuntimeObjectRenderRecordsWithPortalGhosts,
  concatPortalGhostedRecords,
  exemptFromPortalGhosts,
  portalGhostExemptions,
  type PortalGhostExemption,
  type PortalGhostRuntimeObjectRenderRecordRequest,
  type PortalGhostedRecords,
} from "./runtimeObjectGhostRecords";
import type { InspectedGhostPart, InspectedRecordGroup, RenderInspectionContext } from "./renderInspection";
import {
  type RuntimeObjectRenderArchetype,
  type RuntimeObjectRenderArchetypeDiagnostics,
  deriveRuntimeObjectRenderArchetypeCapacity,
  disposeRuntimeObjectRenderArchetypes,
  groupRuntimeObjectRenderRecordsByArchetype,
} from "./runtimeObjectRenderArchetypes";
import {
  type RenderFootprint,
  type RuntimeObjectRenderRecord,
  type RuntimeObjectRenderSourceMesh,
  collectPlacedFlagRenderSourceMeshes,
  collectRuntimeObjectRenderSourceMeshes,
  computeRenderSourceFootprint,
  placedFlagModelArchetypeKeyPrefix,
} from "./runtimeObjectRenderRecords";
import { isGeodesicRuntimeRenderObject, runtimeObjectArchetypeKeyPrefix } from "./runtimeSceneUtils";

/**
 * Every source of render records of the sync. Each hands over `PortalGhostedRecords` (a measured render footprint for the ghost function, or an
 * exemption with a reason), which is the only thing the sync accepts. Adding a source means adding its id here; the contract test
 * (`tests/render/runtimeObjectPortalGhostContract.test.ts`) is keyed by this list and fails to typecheck until the new source has a case.
 */
export const runtimeObjectRecordSources = [
  "runtime-objects",
  "geodesic-body-parts",
  "geodesic-segments",
  "carry-highlight",
  "player-rover",
] as const;

/** One source of the sync's render records; an element of {@link runtimeObjectRecordSources}. */
export type RuntimeObjectRecordSource = (typeof runtimeObjectRecordSources)[number];

/** Inputs of {@link createRuntimeObjectInstanceSync}; the maps are shared with the tool object runtimes and mutated here. */
export interface RuntimeObjectInstanceSyncDeps {
  readonly registry: RuntimeObjectReader;
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
  /** The shell session: player pose, debug settings and the cannon tool state are read from it. */
  readonly session: ClientSession;
  /** The world engine; the player's pose is read from it. */
  readonly engine: WorldEngine;
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
  /**
   * Read access to what the last sync did, for `render.*` in the public API (see renderInspection.ts). Every member reads state the sync keeps anyway (the last
   * record groups, the last snapshot, the archetypes); calling none of them costs nothing per frame.
   */
  readonly inspection: RenderInspectionContext;
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
  /** emitterHeadsKey of the object when cached: the heads of a cannon follow its attached geodesics, which live in the registry. */
  readonly headsKey: string;
  readonly archetypeKeys: readonly string[];
  readonly records: PortalGhostedRecords;
}

/** One drawn part as the sync builds it: a ghost request, or records that are exempt from ghosts for a stated reason. */
type GhostPart =
  | { readonly partId: string; readonly source: RuntimeObjectRecordSource; readonly archetypeKeys: readonly string[]; readonly request: PortalGhostRuntimeObjectRenderRecordRequest }
  | { readonly partId: string; readonly source: RuntimeObjectRecordSource; readonly archetypeKeys: readonly string[]; readonly exemption: PortalGhostExemption; readonly records: () => readonly RuntimeObjectRenderRecord[] };

const meshKeySeparator = ":mesh:";
const noKeys: readonly string[] = [];

// The carried object as the highlight sees it: its pose and collision shape, and the highlight shape it declares (if any).
function carryHighlightObject(object: RuntimeWorldObject): CarryHighlightObject {
  return {
    ...runtimeObjectToDynamicObjectState(object),
    id: object.id,
    carryHighlight: "carryHighlight" in object ? object.carryHighlight : undefined,
  };
}
// The archetype-key prefix (the key without its trailing `:mesh:<n>`), which names the source group a footprint is measured over.
function archetypeKeyPrefix(archetypeKey: string): string {
  const separator = archetypeKey.lastIndexOf(meshKeySeparator);
  return separator < 0 ? archetypeKey : archetypeKey.slice(0, separator);
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// The parts of an object for inspection: a part that cannot be built (an unmeasurable footprint, say) is reported as an error part, not thrown.
function describeParts(build: () => readonly GhostPart[], objectId: string): readonly (GhostPart | { readonly error: string; readonly partId: string })[] {
  try {
    return build();
  } catch (error) {
    return [{ partId: objectId, error: error instanceof Error ? error.message : String(error) }];
  }
}

function inspectedPart(part: GhostPart | { readonly error: string; readonly partId: string }): InspectedGhostPart {
  if ("error" in part) {
    return { partId: part.partId, source: "unknown", archetypeKeys: [], error: part.error };
  }

  return "request" in part
    ? { partId: part.partId, source: part.source, archetypeKeys: part.archetypeKeys, request: part.request }
    : { partId: part.partId, source: part.source, archetypeKeys: part.archetypeKeys, exemption: part.exemption + ": " + portalGhostExemptions[part.exemption] };
}

/** Creates the instance sync. The footprint-radius cache and the per-object record cache live inside the returned closure. */
export function createRuntimeObjectInstanceSync(deps: RuntimeObjectInstanceSyncDeps): RuntimeObjectInstanceSync {
  const { registry, runtimeObjectRootsById, renderSourcesByKey, renderArchetypesByKey, renderRoot } = deps;
  const footprintCache = new Map<string, {
    readonly first: RuntimeObjectRenderSourceMesh | undefined;
    readonly count: number;
    readonly footprint: RenderFootprint;
  }>();
  const recordCacheByObjectId = new Map<string, CachedObjectRecords>();
  // Source keys last collected per object (key `object:<id>`) and for the rover (`rover`), with the root they came from.
  const sourceKeysByObjectId = new Map<string, { readonly root: THREE.Object3D; readonly keys: readonly string[] }>();
  const seenSourceKeys = new Set<string>();
  const carryHighlightSource = createCarryHighlightSource();
  let archetypeKeysByPrefix = new Map<string, string[]>();
  const stats = { syncs: 0, recordCollections: 0, ghostComputations: 0 };
  // What the last sync used, kept for inspection (pointers; nothing is copied).
  let lastGroups: readonly InspectedRecordGroup[] = [];
  let lastRecordsByArchetypeKey: ReadonlyMap<string, readonly RuntimeObjectRenderRecord[]> = new Map();
  let lastSnapshot: FrameRenderSnapshot | undefined;

  // The render footprint of the parts drawn by `archetypeKeys`, measured from their source meshes (what is drawn, not what collides). An
  // object part with archetypes but no measurable mesh is an error: a part without a footprint would silently get no portal ghosts.
  function renderFootprintOf(prefix: string, archetypeKeys: readonly string[]): RenderFootprint {
    const sources = archetypeKeys
      .map((key) => renderSourcesByKey.get(key))
      .filter((source): source is RuntimeObjectRenderSourceMesh => source !== undefined);
    const cached = footprintCache.get(prefix);

    if (cached && cached.first === sources[0] && cached.count === sources.length) {
      return cached.footprint;
    }

    const footprint = computeRenderSourceFootprint(sources);

    if (!footprint) {
      throw new Error(
        `Render footprint missing for "${prefix}": none of its ${archetypeKeys.length} drawn archetypes has a measurable mesh, so its portal ghosts cannot be decided.`,
      );
    }

    footprintCache.set(prefix, { first: sources[0], count: sources.length, footprint });
    return footprint;
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

  // A placed flag draws its own text planes plus the model archetypes shared by all flags of its type.
  function archetypeKeysForObject(object: RuntimeWorldObject, prefix: string): readonly string[] {
    const own = archetypeKeysByPrefix.get(prefix) ?? noKeys;
    if (object.kind !== "placed-flag") {
      return own;
    }

    const model = archetypeKeysByPrefix.get(placedFlagModelArchetypeKeyPrefix(object.flagType)) ?? noKeys;
    return model.length === 0 ? own : [...own, ...model];
  }

  function syncSources(objects: readonly RuntimeWorldObject[]): ReadonlySet<string> {
    const activeKeys = new Set<string>();
    const addSource = (source: RuntimeObjectRenderSourceMesh): void => {
      activeKeys.add(source.archetypeKey);
      if (!renderSourcesByKey.has(source.archetypeKey)) {
        renderSourcesByKey.set(source.archetypeKey, source);
      }
    };

    // The highlight shape exists as an archetype only while something is carried.
    const carriedId = participantAttachment(deps.engine.read.participant(localParticipantId), carryAttachmentKind)?.objectId;
    if (carriedId !== undefined && objects.some((object) => object.id === carriedId)) {
      addSource(carryHighlightSource);
    }

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
        object.kind === "placed-flag"
          ? collectPlacedFlagRenderSourceMeshes(object.id, object.flagType, root, runtimeObjectArchetypeKeyPrefix(object))
          : collectRuntimeObjectRenderSourceMeshes(object.id, root, runtimeObjectArchetypeKeyPrefix(object))
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

  // The drawn parts of an object, each with the ghost request the sync makes for it (or the reason it is exempt). The frame and the inspection read the same list.
  function ghostPartsOfObject(object: RuntimeWorldObject, world: CompiledCellComplex): readonly GhostPart[] {
    const geodesic = object.portalRenderable && isGeodesicRuntimeRenderObject(object);
    const prefix = geodesic ? "" : runtimeObjectArchetypeKeyPrefix(object);
    const archetypeKeys = geodesic ? deps.geodesicArchetypeKeys : archetypeKeysForObject(object, prefix);

    if (geodesic && object.kind === "geodesicModel/segment") {
      // A segment is computed per cell and continues as the next segment: it has no body parts to ghost.
      return [{
        partId: object.id,
        source: "geodesic-segments",
        archetypeKeys,
        exemption: "geodesicModel/segment",
        records: () => collectGeodesicRuntimeRenderRecords(registry, object, deps.geodesicArchetypeKeys),
      }];
    }

    if (geodesic) {
      // Cannon post and heads, intersection balloon: each body part is placed and ghosted like any other object.
      return collectGeodesicBodyPlacements(registry, object, deps.geodesicArchetypeKeys).map((placement) => ({
        partId: placement.objectId,
        source: "geodesic-body-parts" as const,
        archetypeKeys: placement.archetypeKeys,
        request: {
          world,
          object: { ...runtimeObjectToDynamicObjectState(object), id: placement.objectId, localPose: placement.localPose },
          archetypeKeys: placement.archetypeKeys,
          renderFootprint: renderFootprintOf(archetypeKeyPrefix(placement.archetypeKeys[0]), placement.archetypeKeys),
        },
      }));
    }

    // An object whose archetypes are not collected yet draws nothing, so there is nothing to ghost.
    if (archetypeKeys.length === 0) {
      return [{ partId: object.id, source: "runtime-objects", archetypeKeys, exemption: "nothing-drawn", records: () => [] }];
    }

    return [{
      partId: object.id,
      source: "runtime-objects",
      archetypeKeys,
      request: { world, object, archetypeKeys, renderFootprint: renderFootprintOf(prefix, archetypeKeys) },
    }];
  }

  // The player's own avatar as a drawn part: ghosted like every other drawn part (the far side of a portal it stands at).
  function ghostPartOfRover(world: CompiledCellComplex): GhostPart | undefined {
    const rover = deps.playerRoverRenderModel;

    if (!rover) {
      return undefined;
    }

    const roverKeys = archetypeKeysByPrefix.get(rover.archetypeKeyPrefix) ?? noKeys;
    const placement = rover.placement(readLocalPlayerPose(deps.engine));

    if (roverKeys.length === 0) {
      return { partId: placement.id, source: "player-rover", archetypeKeys: roverKeys, exemption: "nothing-drawn", records: () => [] };
    }

    return {
      partId: placement.id,
      source: "player-rover",
      archetypeKeys: roverKeys,
      request: {
        world,
        object: placement,
        archetypeKeys: roverKeys,
        renderFootprint: renderFootprintOf(rover.archetypeKeyPrefix, roverKeys),
        recordFlags: rover.recordFlags,
      },
    };
  }

  function recordsOfParts(parts: readonly GhostPart[]): PortalGhostedRecords {
    return concatPortalGhostedRecords(
      parts.map((part) =>
        "request" in part
          ? collectRuntimeObjectRenderRecordsWithPortalGhosts(part.request)
          : exemptFromPortalGhosts(part.exemption, part.records())
      ),
    );
  }

  // The records of every source of the frame. Each source hands over `PortalGhostedRecords`, which exist only as the result of the one ghost
  // function (with a measured render footprint) or of an explicit exemption with a reason, so no source can add raw records.
  function collectRecords(objects: readonly RuntimeWorldObject[]): readonly RuntimeObjectRenderRecord[] {
    const world = deps.getWorld();
    const seenIds = new Set<string>();
    const groups: PortalGhostedRecords[] = [];
    const groupSources: RuntimeObjectRecordSource[] = [];
    const carriedId = participantAttachment(deps.engine.read.participant(localParticipantId), carryAttachmentKind)?.objectId;
    let carriedObject: RuntimeWorldObject | undefined;

    for (const object of objects) {
      const geodesic = object.portalRenderable && isGeodesicRuntimeRenderObject(object);
      if (!geodesic && (!object.portalRenderable || !runtimeObjectRootsById.has(object.id))) {
        continue;
      }

      seenIds.add(object.id);
      if (object.id === carriedId) {
        carriedObject = object;
      }
      const prefix = geodesic ? "" : runtimeObjectArchetypeKeyPrefix(object);
      const archetypeKeys = geodesic ? deps.geodesicArchetypeKeys : archetypeKeysForObject(object, prefix);
      const source: RuntimeObjectRecordSource = !geodesic ? "runtime-objects" : object.kind === "geodesicModel/segment" ? "geodesic-segments" : "geodesic-body-parts";
      const cached = recordCacheByObjectId.get(object.id);
      const headsKey = emitterHeadsKey(registry, object);

      if (cached && cached.object === object && cached.world === world && cached.headsKey === headsKey && sameStrings(cached.archetypeKeys, archetypeKeys)) {
        groups.push(cached.records);
        groupSources.push(source);
        continue;
      }

      if (!(geodesic && object.kind === "geodesicModel/segment")) {
        stats.ghostComputations += 1;
      }
      const objectRecords = recordsOfParts(ghostPartsOfObject(object, world));

      recordCacheByObjectId.set(object.id, { object, world, headsKey, archetypeKeys: [...archetypeKeys], records: objectRecords });
      groups.push(objectRecords);
      groupSources.push(source);
    }

    // The highlight has its own portal ghosts, decided by its own reach (see carryHighlight.ts), not by the object's records.
    if (carriedObject) {
      groups.push(collectCarryHighlightRecords(carryHighlightObject(carriedObject), world));
      groupSources.push("carry-highlight");
    }

    for (const id of [...recordCacheByObjectId.keys()]) {
      if (!seenIds.has(id)) {
        recordCacheByObjectId.delete(id);
      }
    }

    // The player's own avatar moves every frame, so it is never cached.
    const roverPart = ghostPartOfRover(world);
    if (roverPart) {
      stats.ghostComputations += 1;
      groups.push(recordsOfParts([roverPart]));
      groupSources.push("player-rover");
    }

    lastGroups = groups.map((records, index) => ({ source: groupSources[index], records }));
    return concatPortalGhostedRecords(groups);
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
      lastRecordsByArchetypeKey = recordsByArchetypeKey;
      lastSnapshot = snapshot;
      syncArchetypes(activeKeys, recordsByArchetypeKey);
      deps.diagnostics.reset();
      updateRuntimeObjectRenderArchetypeInstances(
        [...renderArchetypesByKey.values()],
        recordsByArchetypeKey,
        snapshot.objectPathsByDestinationCell,
        deps.diagnostics,
        snapshot.clipIndexByPathId,
        {
          cameraPositions: snapshot.cameraPositions,
          unclippedRoot: snapshot.unclippedRoot,
          rootGroupByPathId: snapshot.rootGroupByPathId,
        },
      );
      stats.syncs += 1;
    },
    inspection: {
      groups: () => lastGroups,
      archetypes: () => [...renderArchetypesByKey.values()],
      recordsByArchetypeKey: () => lastRecordsByArchetypeKey,
      snapshot: () => lastSnapshot,
      ghostParts(objectId) {
        const world = deps.getWorld();
        const rover = deps.playerRoverRenderModel;
        const parts: (GhostPart | { readonly error: string; readonly partId: string })[] = [];
        const object = registry.getAll().find((candidate) => candidate.id === objectId);

        if (object && object.portalRenderable && (isGeodesicRuntimeRenderObject(object) || runtimeObjectRootsById.has(object.id))) {
          parts.push(...describeParts(() => ghostPartsOfObject(object, world), object.id));
        }

        if (rover && rover.objectId === objectId) {
          parts.push(...describeParts(() => {
            const part = ghostPartOfRover(world);
            return part ? [part] : [];
          }, objectId));
        }

        return parts.map(inspectedPart);
      },
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
