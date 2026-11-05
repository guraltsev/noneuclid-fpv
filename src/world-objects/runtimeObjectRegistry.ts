/**
 * Runtime object registry: the per-cell, id-indexed store of every live (non-terrain) object in the world.
 * Authored specs (CellObjectSpec) are turned into RuntimeWorldObject values, which carry a cell id plus a pose in that cell's local frame (meters; cell-local x right, y forward, z up; yaw in radians about +z). Creatures, static assets, placed signs, geodesic cannons and the geodesic/measurement tool results all live here as one discriminated union keyed by `kind`.
 * Renderers, movement/collision, aiming and UI query the registry by cell (collidable, player-blocking, interactable, tooltip subsets) instead of walking specs.
 * Invariants: ids are unique registry-wide; the by-cell index always matches each object's current `cellId`; objects are treated as immutable values and changed by `update` with a replacement; `getVersion` increases by one per content change (add, update, remove of an existing id, moveToCell, owner publish).
 * For objects with an owner (creatures, the marmot, collidable static assets) the registry is a read model: only the owner's publisher (from `claimOwnership`) may replace the record; `update`, `moveToCell` and `remove` throw for owned ids.
 * Query results (`getAll`, the per-cell queries) are cached and frozen: the same array is returned until a change touches it, a later change returns a new array, and callers must never mutate one.
 * Every write is also recorded in `changes`, the change journal (see runtimeObjectChangeJournal.ts); the frame owner clears it at the frame end, which only moves the frame start: earlier entries stay readable by sequence number through `changes.ring`.
 * Bulk fragments (bullets, stars and other particles) must not go through the registry per particle; per-tick immutable replacement allocates too much.
 */
import type { RigidTransform3 } from "../math/rigidTransform3";
import type { AssetObjectSpec } from "../cell-complex/specs";
import { yawRigidTransform3 } from "../math/rigidTransform3";
import type {
  GeodesicVertexObject,
  CurveShorteningPairObject,
  GeodesicCannonObject,
  GeodesicCrossingObject,
  GeodesicArcObject,
  GeodesicSegmentObject,
} from "./geodesic/objects";
import type { MeasuredGeodesicLengthObject } from "./toolObjects";
import type { PlacedFlagObject } from "./toolObjects";
import type { ProtractorAngleObject } from "./toolObjects";
import { userObjectClass } from "./objectMetadata";
import { ChangeOp, createRuntimeObjectChangeJournal, type RuntimeObjectChangeJournal } from "./runtimeObjectChangeJournal";
import type { RuntimeCreatureObject, RuntimeWorldObjectBase } from "./runtimeObjectBase";

/**
 * Registry record for a static glTF decoration or landmark placed in a cell.
 * `assetPath` is relative to the assets directory; the visual scale/offset/tilt live only on the authored spec, the registry keeps the pose, collision and interaction metadata.
 */
export interface RuntimeStaticAssetObject extends RuntimeWorldObjectBase {
  readonly kind: "asset";
  readonly assetPath: string;
}

/**
 * Discriminated union (on `kind`) of every object type the registry can hold.
 * Includes creatures, static assets, placed signs, geodesic cannons/segments/intervals/free ends/curve-shortening pairs/intersections, and the persistent measurement results (length and protractor angle).
 */
export type RuntimeWorldObject =
  | RuntimeCreatureObject
  | RuntimeStaticAssetObject
  | PlacedFlagObject
  | GeodesicCannonObject
  | GeodesicArcObject
  | GeodesicVertexObject
  | CurveShorteningPairObject
  | GeodesicSegmentObject
  | GeodesicCrossingObject
  | MeasuredGeodesicLengthObject
  | ProtractorAngleObject;

/**
 * Mutable id- and cell-indexed collection of runtime objects.
 * Objects are replaced, never mutated in place. Per-cell query results are frozen arrays in insertion order of the cell's id set, shared between calls until the next change that touches the cell (`getAll` until any change); a later change returns a new array and never alters one already returned, so an old array is a snapshot that does not track later changes. Callers must not mutate them.
 */
export interface RuntimeObjectRegistry {
  /** Number of successful content changes since creation; starts at 0. Equal versions mean equal contents. */
  getVersion(): number;
  /** Adds an object; throws if its id is already registered. */
  add(object: RuntimeWorldObject): void;
  /** Replaces the stored object with the same id (re-indexing if its cell changed); throws if the id is unknown or owned. */
  update(object: RuntimeWorldObject): void;
  /** Removes the object with this id; silently does nothing if absent. Throws if the object is owned. */
  remove(id: string): void;
  /** Marks `id` as owned and returns the only function allowed to replace it afterwards (same re-indexing as `update`; throws if the object's id differs). Throws if the id is unknown or already owned. */
  claimOwnership(id: string): (object: RuntimeWorldObject) => void;
  /** Makes `id` unowned again so ordinary writes work; no-op if it is not owned. */
  releaseOwnership(id: string): void;
  /** Re-homes an object into `cellId`, optionally with a new cell-local pose (otherwise the old pose is kept verbatim, which is only meaningful if the caller already transformed it); returns the updated object or undefined if the id is unknown. */
  moveToCell(id: string, cellId: string, localPose?: RigidTransform3): RuntimeWorldObject | undefined;
  /** Looks up an object by id. */
  get(id: string): RuntimeWorldObject | undefined;
  /** All objects currently homed in the cell. */
  getObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  /** Objects in the cell that have a collision cylinder. */
  getCollidableObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  /** Collidable objects that block the player: excludes geodesic cannons and objects whose `do_not_collide_with` lists the user class. */
  getPlayerBlockingObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  /** Objects in the cell that define an `interactable`. */
  getInteractableObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  /** Objects in the cell that have a tooltip or an interaction (interactables always get a tooltip). */
  getTooltipObjectsInCell(cellId: string): readonly RuntimeWorldObject[];
  /** Every registered object across all cells. */
  getAll(): readonly RuntimeWorldObject[];
  /** Objects of one kind, in insertion order: a frozen snapshot, the same array until a write of that kind (it never tracks later writes). */
  getObjectsOfKind<K extends RuntimeWorldObject["kind"]>(kind: K): readonly (RuntimeWorldObject & { readonly kind: K })[];
  /** Kind scans so far, keyed by kind (`"*"` for `getAll` rebuilds): how often a kind was walked to build a list (a cached list counts once). A fresh object; for the bench and `debug.kindScans()`. */
  getKindScanCounts(): Readonly<Record<string, number>>;
  /** Number of objects of one kind: the size of the per-kind id set. No allocation. */
  countOfKind(kind: RuntimeWorldObject["kind"]): number;
  /** Every write since the last `changes.clear()`, in order, and (through `changes.ring`) earlier ones by sequence number; the registry only appends to it. A replacement that changes the kind is recorded as a `Removed` then an `Added`. */
  readonly changes: RuntimeObjectChangeJournal<RuntimeWorldObject>;
  /** The derived segments whose `geodesicId` is `geodesicId`, unsorted (a fresh array). */
  getSegmentsOfGeodesic(geodesicId: string): readonly GeodesicSegmentObject[];
}

/**
 * The read-only face of the registry (design 013 section 6.1): everything except the writes `add`, `update`, `remove`, `claimOwnership`, `releaseOwnership` and `moveToCell`. A type only; the object is the same registry, so clients that receive the reader cannot write by type.
 */
export type RuntimeObjectReader = Omit<
  RuntimeObjectRegistry,
  "add" | "update" | "remove" | "claimOwnership" | "releaseOwnership" | "moveToCell"
>;

/**
 * Creates a registry, optionally pre-populated with `initialObjects`.
 * Throws (from `add`) if the initial list contains duplicate ids.
 */
export function createRuntimeObjectRegistry(
  initialObjects: readonly RuntimeWorldObject[] = [],
): RuntimeObjectRegistry {
  const objectsById = new Map<string, RuntimeWorldObject>();
  const objectIdsByCellId = new Map<string, Set<string>>();

  function indexObject(object: RuntimeWorldObject): void {
    let cellIds = objectIdsByCellId.get(object.cellId);
    if (!cellIds) {
      cellIds = new Set<string>();
      objectIdsByCellId.set(object.cellId, cellIds);
    }
    cellIds.add(object.id);
  }

  function unindexObject(object: RuntimeWorldObject): void {
    const cellIds = objectIdsByCellId.get(object.cellId);
    cellIds?.delete(object.id);
    if (cellIds?.size === 0) {
      objectIdsByCellId.delete(object.cellId);
    }
  }

  const objectIdsByKind = new Map<string, Set<string>>();
  const segmentIdsByGeodesicId = new Map<string, Set<string>>();

  function addToIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    let ids = index.get(key);
    if (!ids) {
      ids = new Set<string>();
      index.set(key, ids);
    }
    ids.add(id);
  }

  function removeFromIndex(index: Map<string, Set<string>>, key: string, id: string): void {
    const ids = index.get(key);
    ids?.delete(id);
    if (ids?.size === 0) {
      index.delete(key);
    }
  }

  function indexKinds(object: RuntimeWorldObject): void {
    addToIndex(objectIdsByKind, object.kind, object.id);
    if (object.kind === "geodesicModel/segment") {
      addToIndex(segmentIdsByGeodesicId, object.geodesicId, object.id);
    }
  }

  function unindexKinds(object: RuntimeWorldObject): void {
    removeFromIndex(objectIdsByKind, object.kind, object.id);
    if (object.kind === "geodesicModel/segment") {
      removeFromIndex(segmentIdsByGeodesicId, object.geodesicId, object.id);
    }
  }

  const changes = createRuntimeObjectChangeJournal<RuntimeWorldObject>();
  const ownedIds = new Set<string>();
  const kindScanCounts = new Map<string, number>();
  const kindLists = new Map<string, readonly RuntimeWorldObject[]>();
  let version = 0;

  // Query caches: each array is built on first request, frozen, and shared until a change touches it.
  let allObjects: readonly RuntimeWorldObject[] | undefined;
  const cellQueries = new Map<string, {
    all?: readonly RuntimeWorldObject[];
    collidable?: readonly RuntimeWorldObject[];
    playerBlocking?: readonly RuntimeWorldObject[];
    interactable?: readonly RuntimeWorldObject[];
    tooltip?: readonly RuntimeWorldObject[];
  }>();

  function cellQueriesFor(cellId: string) {
    let queries = cellQueries.get(cellId);
    if (!queries) {
      queries = {};
      cellQueries.set(cellId, queries);
    }
    return queries;
  }

  // Called by every content change (add, remove and the shared replace path, which also serves owner publishers).
  function invalidateQueries(...cellIds: string[]): void {
    allObjects = undefined;
    for (const cellId of cellIds) {
      cellQueries.delete(cellId);
    }
  }

  function ownedError(id: string): Error {
    return new Error(`Runtime object "${id}" is owned; use its owner.`);
  }

  // The one write path for replacing a stored object.
  function replaceObject(previous: RuntimeWorldObject, next: RuntimeWorldObject): void {
    if (previous.cellId !== next.cellId) {
      unindexObject(previous);
      indexObject(next);
    }

    const previousGeodesicId = previous.kind === "geodesicModel/segment" ? previous.geodesicId : undefined;
    const nextGeodesicId = next.kind === "geodesicModel/segment" ? next.geodesicId : undefined;
    if (previous.kind !== next.kind || previousGeodesicId !== nextGeodesicId) {
      unindexKinds(previous);
      indexKinds(next);
    }

    objectsById.set(next.id, next);
    kindLists.delete(previous.kind);
    kindLists.delete(next.kind);
    version += 1;
    if (previous.kind !== next.kind) {
      changes.record(ChangeOp.Removed, previous, previous);
      changes.record(ChangeOp.Added, next);
    } else {
      changes.record(ChangeOp.Updated, next, previous);
    }
    invalidateQueries(previous.cellId, next.cellId);
  }

  const registry: RuntimeObjectRegistry = {
    getVersion() {
      return version;
    },
    add(object) {
      if (objectsById.has(object.id)) {
        throw new Error(`Runtime object "${object.id}" already exists.`);
      }

      version += 1;
      objectsById.set(object.id, object);
      kindLists.delete(object.kind);
      indexObject(object);
      indexKinds(object);
      changes.record(ChangeOp.Added, object);
      invalidateQueries(object.cellId);
    },
    update(object) {
      if (ownedIds.has(object.id)) {
        throw ownedError(object.id);
      }

      const previous = objectsById.get(object.id);
      if (!previous) {
        throw new Error(`Cannot update missing runtime object "${object.id}".`);
      }

      replaceObject(previous, object);
    },
    remove(id) {
      if (ownedIds.has(id)) {
        throw ownedError(id);
      }

      const object = objectsById.get(id);
      if (!object) {
        return;
      }

      unindexObject(object);
      unindexKinds(object);
      objectsById.delete(id);
      kindLists.delete(object.kind);
      version += 1;
      changes.record(ChangeOp.Removed, object, object);
      invalidateQueries(object.cellId);
    },
    claimOwnership(id) {
      if (!objectsById.has(id)) {
        throw new Error(`Cannot claim missing runtime object "${id}".`);
      }

      if (ownedIds.has(id)) {
        throw new Error(`Runtime object "${id}" is already owned.`);
      }

      ownedIds.add(id);
      return (object) => {
        if (object.id !== id) {
          throw new Error(`Publisher for "${id}" cannot write "${object.id}".`);
        }

        replaceObject(objectsById.get(id)!, object);
      };
    },
    releaseOwnership(id) {
      ownedIds.delete(id);
    },
    moveToCell(id, cellId, localPose) {
      if (ownedIds.has(id)) {
        throw ownedError(id);
      }

      const object = objectsById.get(id);
      if (!object) {
        return undefined;
      }

      const next = {
        ...object,
        cellId,
        localPose: localPose ?? object.localPose,
      } as RuntimeWorldObject;
      registry.update(next);
      return next;
    },
    get(id) {
      return objectsById.get(id);
    },
    getObjectsInCell(cellId) {
      const queries = cellQueriesFor(cellId);
      return (queries.all ??= Object.freeze(
        [...(objectIdsByCellId.get(cellId) ?? [])]
          .map((id) => objectsById.get(id))
          .filter((object): object is RuntimeWorldObject => object !== undefined),
      ));
    },
    getCollidableObjectsInCell(cellId) {
      const queries = cellQueriesFor(cellId);
      return (queries.collidable ??= Object.freeze(
        registry.getObjectsInCell(cellId).filter((object) => object.collision !== undefined),
      ));
    },
    getPlayerBlockingObjectsInCell(cellId) {
      const queries = cellQueriesFor(cellId);
      return (queries.playerBlocking ??= Object.freeze(
        registry.getCollidableObjectsInCell(cellId).filter(
          (object) => object.kind !== "geodesic-cannon" && !object.do_not_collide_with?.includes(userObjectClass),
        ),
      ));
    },
    getInteractableObjectsInCell(cellId) {
      const queries = cellQueriesFor(cellId);
      return (queries.interactable ??= Object.freeze(
        registry.getObjectsInCell(cellId).filter((object) => object.interactable !== undefined),
      ));
    },
    getTooltipObjectsInCell(cellId) {
      const queries = cellQueriesFor(cellId);
      return (queries.tooltip ??= Object.freeze(
        registry.getObjectsInCell(cellId).filter(
          (object) => object.tooltip !== undefined || object.interactable !== undefined,
        ),
      ));
    },
    getAll() {
      if (!allObjects) {
        kindScanCounts.set("*", (kindScanCounts.get("*") ?? 0) + 1);
        allObjects = Object.freeze([...objectsById.values()]);
      }
      return allObjects;
    },
    getObjectsOfKind<K extends RuntimeWorldObject["kind"]>(kind: K) {
      let list = kindLists.get(kind);
      if (list === undefined) {
        kindScanCounts.set(kind, (kindScanCounts.get(kind) ?? 0) + 1);
        list = Object.freeze(
          [...(objectIdsByKind.get(kind) ?? [])]
            .map((id) => objectsById.get(id))
            .filter((object): object is RuntimeWorldObject => object !== undefined),
        );
        kindLists.set(kind, list);
      }
      return list as readonly (RuntimeWorldObject & { readonly kind: K })[];
    },
    getKindScanCounts() {
      return Object.fromEntries(kindScanCounts);
    },
    countOfKind(kind) {
      return objectIdsByKind.get(kind)?.size ?? 0;
    },
    changes,
    getSegmentsOfGeodesic(geodesicId) {
      return [...(segmentIdsByGeodesicId.get(geodesicId) ?? [])]
        .map((id) => objectsById.get(id))
        .filter((object): object is GeodesicSegmentObject => object?.kind === "geodesicModel/segment");
    },
  };

  for (const object of initialObjects) {
    registry.add(object);
  }

  return registry;
}

/**
 * Builds the registry record for an authored static asset placed in `cellId`.
 * The pose is a yaw (`turnRadians`, falling back to `yawRadians`, else 0) at the spec's cell-local position. Assets of class "geometry-computer" get a fixed 3 m tooltip and the "open-geometry-computer" interaction; "question-cube" assets with tutorial or goal pages get a "Help hub" tooltip and the "open-tutorial" interaction (range from `autoDisplayHelpRangeMeters`, default 2.5 m). The record is portal-renderable: the renderer draws the asset model from it once a render root is registered for the id.
 */
export function createRuntimeStaticAssetObject(
  objectSpec: AssetObjectSpec,
  cellId: string,
): RuntimeStaticAssetObject {
  const geometryComputer = objectSpec.class === "geometry-computer";
  const questionCube = objectSpec.class === "question-cube";
  const questionCubeHasHelpMenu = questionCube &&
    ((objectSpec.tutorialPages?.length ?? 0) > 0 || (objectSpec.goalPages?.length ?? 0) > 0);
  const questionCubeRangeMeters = objectSpec.autoDisplayHelpRangeMeters ?? 2.5;
  // Tooltip precedence: geometry computers use their own fixed tooltip below; question cubes with pages say "Help hub"; otherwise any help message yields a class-labelled tooltip.
  const helpTooltip = !geometryComputer
    ? questionCubeHasHelpMenu
      ? {
          label: "Help hub",
          rangeMeters: questionCubeRangeMeters,
        }
      : objectSpec.displayHelpMessage
      ? {
        label: questionCube ? "Help hub" : objectSpec.class ?? objectSpec.id,
        rangeMeters: questionCube ? questionCubeRangeMeters : objectSpec.autoDisplayHelpRangeMeters ?? 2.5,
      }
      : undefined
    : undefined;

  return {
    id: objectSpec.id,
    kind: "asset",
    assetPath: objectSpec.assetPath,
    cellId,
    localPose: yawRigidTransform3(
      objectSpec.turnRadians ?? objectSpec.yawRadians ?? 0,
      objectSpec.position,
    ),
    collision: objectSpec.collision,
    class: objectSpec.class,
    do_not_collide_with: objectSpec.do_not_collide_with,
    portalRenderable: true,
    displayHelpMessage: objectSpec.displayHelpMessage ?? (geometryComputer
      ? "Use this computer to change world deformation when the current world supports live geometry changes."
      : undefined),
    autoDisplayHelpRangeMeters: objectSpec.autoDisplayHelpRangeMeters,
    tutorialPages: objectSpec.tutorialPages,
    goalPages: objectSpec.goalPages,
    tooltip: geometryComputer
      ? {
          label: "Geometry computer",
          rangeMeters: 3,
        }
      : helpTooltip,
    interactable: questionCubeHasHelpMenu
      ? {
          label: "Read",
          action: "open-tutorial",
          rangeMeters: questionCubeRangeMeters,
        }
      : geometryComputer
      ? {
          label: "World deformation",
          action: "open-geometry-computer",
          rangeMeters: 3,
        }
      : undefined,
  };
}
