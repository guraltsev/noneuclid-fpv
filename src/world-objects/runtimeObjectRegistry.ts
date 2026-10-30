/**
 * Runtime object registry: the per-cell, id-indexed store of every live (non-terrain) object in the world.
 * Authored specs (CellObjectSpec) are turned into RuntimeWorldObject values, which carry a cell id plus a pose in that cell's local frame (meters; cell-local x right, y forward, z up; yaw in radians about +z). Creatures, static assets, placed signs, geodesic cannons and the geodesic/measurement tool results all live here as one discriminated union keyed by `kind`.
 * Renderers, movement/collision, aiming and UI query the registry by cell (collidable, player-blocking, interactable, tooltip subsets) instead of walking specs.
 * Invariants: ids are unique registry-wide; the by-cell index always matches each object's current `cellId`; objects are treated as immutable values and changed by `update` with a replacement.
 * For objects with an owner (creatures, the marmot, collidable static assets) the registry is a read model: only the owner's publisher (from `claimOwnership`) may replace the record; `update`, `moveToCell` and `remove` throw for owned ids.
 * Bulk fragments (bullets, stars and other particles) must not go through the registry per particle; per-tick immutable replacement allocates too much.
 */
import type { RigidTransform3 } from "../math/rigidTransform3";
import type { DynamicObjectState, SimpleCollisionCylinder } from "../movement/dynamicObject";
import type { AssetObjectSpec, TutorialPageSpec } from "../cell-complex/specs";
import { yawRigidTransform3 } from "../math/rigidTransform3";
import type {
  FreeGeodesicEndObject,
  CurveShorteningPairObject,
  GeodesicCannonObject,
  GeodesicIntersectionObject,
  GeodesicIntervalObject,
  GeodesicSegmentObject,
} from "./geodesic/objects";
import type { MeasuredGeodesicLengthObject } from "./measureLengthTool";
import type { PlacedFlagObject } from "./placedFlags";
import type { ProtractorAngleObject } from "./protractorTool";
import { userObjectClass } from "./objectMetadata";

/**
 * Describes the primary interaction a player can trigger on an object when aiming at it.
 * Used by aim/interaction code to show a prompt and dispatch the action named by `action`.
 */
export interface RuntimeObjectInteraction {
  /** Prompt text shown to the player (for example "Edit sign"). */
  readonly label: string;
  readonly action: "edit-flag" | "select-geodesic-cannon" | "open-geometry-computer" | "open-tutorial";
  /** Maximum aimer-to-object distance, in meters, within which the interaction is offered; callers fall back to a default (2.5 m in rootAimRay) when absent. */
  readonly rangeMeters?: number;
}

/**
 * Hover/aim tooltip metadata for a runtime object.
 * Shown when the object is aimed at within `rangeMeters`; the desktop and XR prompts are optional per-platform overrides of the interaction hint.
 */
export interface RuntimeObjectTooltip {
  /** Tooltip headline text. */
  readonly label: string;
  /** Maximum distance in meters at which the tooltip is shown. */
  readonly rangeMeters?: number;
  /** Optional interaction hint specific to desktop (keyboard/mouse) input. */
  readonly desktopPrompt?: string;
  /** Optional interaction hint specific to XR controllers. */
  readonly xrPrompt?: string;
}

/**
 * Fields shared by every object stored in the runtime registry.
 * The pose is expressed in the local frame of `cellId` (meters, radians; x right, y forward, z up), so moving an object across a portal means changing both `cellId` and `localPose` (see `moveToCell`). Concrete object types add a unique `kind` discriminant.
 */
export interface RuntimeWorldObjectBase {
  /** Registry-unique identifier. */
  readonly id: string;
  /** Id of the cell whose local frame `localPose` is expressed in. */
  readonly cellId: string;
  /** Pose of the object in its cell's local frame; translation in meters, rotation is normally a yaw about +z. */
  readonly localPose: RigidTransform3;
  /** Collision cylinder (radius/height in meters, offset relative to `localPose`); objects without it are not collidable. */
  readonly collision?: SimpleCollisionCylinder;
  /** Free-form collision class (for example "tree" or "user") matched against other objects' `do_not_collide_with`. */
  readonly class?: string;
  /** Collision classes that ignore this object; listing the user class makes the object non-blocking for the player. */
  readonly do_not_collide_with?: readonly string[];
  /** If set, aiming at this object snaps the reported target point to this cell-local point (meters) instead of the raw ray hit. */
  readonly aimStickyTarget?: {
    readonly localPoint: RigidTransform3["translation"];
  };
  /** Whether the object is also drawn when its cell is seen through a portal (portal-view rendering). */
  readonly portalRenderable: boolean;
  /** Tooltip shown when the object is aimed at. */
  readonly tooltip?: RuntimeObjectTooltip;
  /** Primary interaction offered on the object, if any. */
  readonly interactable?: RuntimeObjectInteraction;
  /** Concise help text shown by the help lens when the object is focused. */
  readonly displayHelpMessage?: string;
  /** If set, the help message is shown automatically while the player is within this many meters. */
  readonly autoDisplayHelpRangeMeters?: number;
  /** Pages for an object-specific tutorial menu. */
  readonly tutorialPages?: readonly TutorialPageSpec[];
  /** Pages for a scenario goal menu. */
  readonly goalPages?: readonly TutorialPageSpec[];
}

/**
 * Registry record for an autonomous creature (geodesic marmot, mouse or butterfly).
 * The `kind` literal "geodesci-marmot" is spelled that way throughout the codebase (including the spec type); it is a persistent identifier, not a typo local to this file.
 */
export interface RuntimeCreatureObject extends RuntimeWorldObjectBase {
  readonly kind: "geodesci-marmot" | "geo-mouse" | "geo-butterfly";
}

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
  | GeodesicIntervalObject
  | FreeGeodesicEndObject
  | CurveShorteningPairObject
  | GeodesicSegmentObject
  | GeodesicIntersectionObject
  | MeasuredGeodesicLengthObject
  | ProtractorAngleObject;

/**
 * Mutable id- and cell-indexed collection of runtime objects.
 * Objects are replaced, never mutated in place. Per-cell query results are fresh arrays in insertion order of the cell's id set; they are snapshots that do not track later changes.
 */
export interface RuntimeObjectRegistry {
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
}

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

  const ownedIds = new Set<string>();

  function ownedError(id: string): Error {
    return new Error(`Runtime object "${id}" is owned; use its owner.`);
  }

  // The one write path for replacing a stored object.
  function replaceObject(previous: RuntimeWorldObject, next: RuntimeWorldObject): void {
    if (previous.cellId !== next.cellId) {
      unindexObject(previous);
      indexObject(next);
    }

    objectsById.set(next.id, next);
  }

  const registry: RuntimeObjectRegistry = {
    add(object) {
      if (objectsById.has(object.id)) {
        throw new Error(`Runtime object "${object.id}" already exists.`);
      }

      objectsById.set(object.id, object);
      indexObject(object);
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
      objectsById.delete(id);
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
      return [...(objectIdsByCellId.get(cellId) ?? [])]
        .map((id) => objectsById.get(id))
        .filter((object): object is RuntimeWorldObject => object !== undefined);
    },
    getCollidableObjectsInCell(cellId) {
      return registry.getObjectsInCell(cellId).filter((object) => object.collision !== undefined);
    },
    getPlayerBlockingObjectsInCell(cellId) {
      return registry.getCollidableObjectsInCell(cellId).filter(
        (object) => object.kind !== "geodesic-cannon" && !object.do_not_collide_with?.includes(userObjectClass),
      );
    },
    getInteractableObjectsInCell(cellId) {
      return registry.getObjectsInCell(cellId).filter((object) => object.interactable !== undefined);
    },
    getTooltipObjectsInCell(cellId) {
      return registry.getObjectsInCell(cellId).filter(
        (object) => object.tooltip !== undefined || object.interactable !== undefined,
      );
    },
    getAll() {
      return [...objectsById.values()];
    },
  };

  for (const object of initialObjects) {
    registry.add(object);
  }

  return registry;
}

/**
 * Projects a runtime object onto the minimal movement/collision state (cell id, cell-local pose, collision cylinder).
 * The result shares the pose and collision references with the object; it is a view, not a copy.
 */
export function runtimeObjectToDynamicObjectState(object: RuntimeWorldObjectBase): DynamicObjectState {
  return {
    cellId: object.cellId,
    localPose: object.localPose,
    collision: object.collision,
  };
}

/**
 * Builds the registry record for an authored static asset placed in `cellId`.
 * The pose is a yaw (`turnRadians`, falling back to `yawRadians`, else 0) at the spec's cell-local position. Assets of class "geometry-computer" get a fixed 3 m tooltip and the "open-geometry-computer" interaction; "question-cube" assets with tutorial or goal pages get a "Help hub" tooltip and the "open-tutorial" interaction (range from `autoDisplayHelpRangeMeters`, default 2.5 m). Static assets are never portal-renderable via this registry record.
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
    portalRenderable: false,
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
