/**
 * Debug visuals attached to cell roots: object collision wireframes, selectable-hitbox meshes, and aim-collision outlines.
 * Static groups are rebuilt from scratch on each sync (old groups are removed and disposed) and parented to the cell mesh root, so they share the cell-local frame (meters; x right, y forward, z up mapped to Three.js via worldAxes). Visibility depends on the active debug level and options from glue/debugOptions.
 * Callers must invoke the sync functions after the world, objects, or debug options change; the frame uses `syncSelectableHitboxDebugIfChanged`, which rebuilds the hitbox groups only when the registry version, cell roots, world or debug settings changed.
 */
import * as THREE from "three";
import { type CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { type DebugLevelId } from "../../glue/debugLevels";
import { type DebugOptionId, hasActiveDebugOption } from "../../glue/debugOptions";
import { type GeodesicMarmotRuntime } from "../../world-objects/geodesicMarmot";
import { type RuntimeObjectRegistry } from "../../world-objects/runtimeObjectRegistry";
import { type SimpleGeoCreatureRuntime } from "../../world-objects/simpleGeoCreature";
import {
  buildAimCollisionOutlineDebugMesh,
  buildSelectableHitboxDebugMesh,
} from "./debugHitboxMeshes";
import { disposeObject3D } from "./runtimeSceneUtils";
import { buildStaticObjectCollisionWireframeGroup } from "./staticObjectCollisionWireframes";

/** Dependencies for {@link createDebugVisualization}; createThreeApp#shell passes the shared maps by reference (this module mutates the group maps) and the changing state as getters. */
export interface DebugVisualizationDeps {
  /** Source of world objects per cell used to build static wireframes and hitboxes. */
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Moving creature runtimes whose own collision wireframes are toggled. */
  readonly dynamicObjectRuntimes: readonly (GeodesicMarmotRuntime | SimpleGeoCreatureRuntime)[];
  /** Cell id to cell root object under which debug groups are parented; cells without a root are skipped. */
  readonly cellMeshes: ReadonlyMap<string, THREE.Object3D>;
  /** Mutated: per-cell collision wireframe groups currently in the scene. */
  readonly staticObjectCollisionWireframeGroupsByCellId: Map<string, THREE.Group>;
  /** Mutated: per-cell selectable-hitbox groups currently in the scene. */
  readonly selectableHitboxDebugGroupsByCellId: Map<string, THREE.Group>;
  /** Mutated: per-cell aim-collision outline groups currently in the scene. */
  readonly aimCollisionOutlineDebugGroupsByCellId: Map<string, THREE.Group>;
  /** Getter: active compiled world whose cells are iterated. */
  getWorld(): CompiledCellComplex;
  /** Getter: current debug level. */
  getDebugLevel(): DebugLevelId;
  /** Getter: explicitly enabled debug options. */
  getDebugOptions(): readonly DebugOptionId[];
}

/**
 * Creates the debug-visual sync functions.
 * Returns syncDynamicObjectDebugWireframes (toggle creature wireframes in place), syncStaticObjectCollisionWireframes (rebuild static collision wireframes) and syncSelectableHitboxDebug (rebuild both the selectable-hitbox and aim-collision-outline groups).
 * Rebuilds dispose the previous groups; the groups left in the maps are owned by the scene and torn down by the next sync, so nothing else needs to dispose them.
 */
export function createDebugVisualization(deps: DebugVisualizationDeps) {
  const {
    runtimeObjectRegistry,
    dynamicObjectRuntimes,
    cellMeshes,
    staticObjectCollisionWireframeGroupsByCellId,
    selectableHitboxDebugGroupsByCellId,
    aimCollisionOutlineDebugGroupsByCellId,
  } = deps;

  // Shows or hides each dynamic runtime's collision wireframe according to the object-collision-wireframes option.
  function syncDynamicObjectDebugWireframes(): void {
    const visible = hasActiveDebugOption(deps.getDebugLevel(), deps.getDebugOptions(), "object-collision-wireframes");

    for (const runtime of dynamicObjectRuntimes) {
      runtime.setCollisionWireframeVisible(visible);
    }
  }

  // Drop and dispose all existing groups first, then rebuild only if the option is active.
  function syncStaticObjectCollisionWireframes(): void {
    for (const group of staticObjectCollisionWireframeGroupsByCellId.values()) {
      group.removeFromParent();
      disposeObject3D(group);
    }
    staticObjectCollisionWireframeGroupsByCellId.clear();

    if (!hasActiveDebugOption(deps.getDebugLevel(), deps.getDebugOptions(), "object-collision-wireframes")) {
      return;
    }

    for (const cell of deps.getWorld().cells) {
      const cellRoot = cellMeshes.get(cell.id);
      if (!cellRoot) {
        continue;
      }

      const group = buildStaticObjectCollisionWireframeGroup(cell.id, runtimeObjectRegistry.getObjectsInCell(cell.id));
      if (!group) {
        continue;
      }

      staticObjectCollisionWireframeGroupsByCellId.set(cell.id, group);
      cellRoot.add(group);
    }
  }

  let lastHitboxKey:
    | {
        readonly registryVersion: number;
        readonly cellRootsGeneration: number;
        readonly world: CompiledCellComplex;
        readonly level: DebugLevelId;
        readonly options: readonly DebugOptionId[];
      }
    | undefined;

  /**
   * Rebuilds the selectable-hitbox and aim-outline groups only when `forced` is true or the registry version, the
   * cell-roots generation, the world, the debug level or the debug options (by reference) differ from the last
   * rebuild. Returns whether it rebuilt.
   * Known limit: worlds with moving creatures bump the registry version every frame, so with the debug option on the
   * hitboxes still rebuild once per frame; with the option off a rebuild only clears empty maps.
   */
  function syncSelectableHitboxDebugIfChanged(input: {
    registryVersion: number;
    cellRootsGeneration: number;
    forced: boolean;
  }): boolean {
    const key = {
      registryVersion: input.registryVersion,
      cellRootsGeneration: input.cellRootsGeneration,
      world: deps.getWorld(),
      level: deps.getDebugLevel(),
      options: deps.getDebugOptions(),
    };
    const previous = lastHitboxKey;
    const unchanged = previous !== undefined &&
      previous.registryVersion === key.registryVersion &&
      previous.cellRootsGeneration === key.cellRootsGeneration &&
      previous.world === key.world &&
      previous.level === key.level &&
      previous.options === key.options;

    if (unchanged && !input.forced) {
      return false;
    }

    syncSelectableHitboxDebug();
    lastHitboxKey = key;
    return true;
  }

  // Both group families are torn down together; each is rebuilt only if its option is active.
  // The unconditional rebuild has no version to remember, so it clears the stored key: the next gated call rebuilds once.
  function syncSelectableHitboxDebug(): void {
    lastHitboxKey = undefined;
    for (const group of selectableHitboxDebugGroupsByCellId.values()) {
      group.removeFromParent();
      disposeObject3D(group);
    }
    selectableHitboxDebugGroupsByCellId.clear();

    for (const group of aimCollisionOutlineDebugGroupsByCellId.values()) {
      group.removeFromParent();
      disposeObject3D(group);
    }
    aimCollisionOutlineDebugGroupsByCellId.clear();

    const selectableHitboxesActive = hasActiveDebugOption(deps.getDebugLevel(), deps.getDebugOptions(), "selectable-hitboxes");
    const aimCollisionOutlinesActive = hasActiveDebugOption(deps.getDebugLevel(), deps.getDebugOptions(), "aim-collision-outlines");
    if (!selectableHitboxesActive && !aimCollisionOutlinesActive) {
      return;
    }

    for (const cell of deps.getWorld().cells) {
      const cellRoot = cellMeshes.get(cell.id);
      if (!cellRoot) {
        continue;
      }

      if (selectableHitboxesActive) {
        const group = new THREE.Group();
        group.name = `selectable-hitboxes:${cell.id}`;
        for (const object of runtimeObjectRegistry.getObjectsInCell(cell.id)) {
          const hitbox = buildSelectableHitboxDebugMesh(object);
          if (hitbox) {
            group.add(hitbox);
          }
        }

        if (group.children.length > 0) {
          cellRoot.add(group);
          selectableHitboxDebugGroupsByCellId.set(cell.id, group);
        } else {
          disposeObject3D(group);
        }
      }

      if (aimCollisionOutlinesActive) {
        const group = new THREE.Group();
        group.name = `aim-collision-outlines:${cell.id}`;
        for (const object of runtimeObjectRegistry.getObjectsInCell(cell.id)) {
          const outline = buildAimCollisionOutlineDebugMesh(object);
          if (outline) {
            group.add(outline);
          }
        }

        if (group.children.length > 0) {
          cellRoot.add(group);
          aimCollisionOutlineDebugGroupsByCellId.set(cell.id, group);
        } else {
          disposeObject3D(group);
        }
      }
    }
  }

  return {
    syncDynamicObjectDebugWireframes,
    syncStaticObjectCollisionWireframes,
    syncSelectableHitboxDebug,
    syncSelectableHitboxDebugIfChanged,
  };
}
