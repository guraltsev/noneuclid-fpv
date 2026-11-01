/**
 * Commit of a deformed world geometry: polls the geometry session at frame start and, when a snapshot is ready, replaces the active
 * world and carries the live state across (player, creatures, signs, emitters), then rebuilds what depends on the geometry.
 *
 * The module owns the active world bundle (the current snapshot plus the render data derived from it); every other reader goes through
 * `active()`. A commit runs the steps in this order: map the player and the objects using the previous world, re-solve the derived
 * objects (locked geodesics, measured lengths, protractor angles), swap the bundle, then `afterSwap` (the shell's rebuild of meshes,
 * portal instances, tool feedback and diagnostics for the new world).
 * Positions are cell-local meters and yaws are radians. Runs on the frame loop only, before input is read.
 */
import type { AppSession } from "../../runtime/appSession";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";
import {
  getWorldDeformationFamilyOrThrow,
  type WorldDeformationFamilyRegistry,
} from "../../runtime/worldGeometryDeformationFamilies";
import {
  applyGeometryCommitComputedObjectPolicy,
  type GeometryCommitComputedObjectPolicyCallbacks,
} from "../../runtime/worldGeometryComputedObjects";
import type { WorldGeometrySnapshot } from "../../runtime/worldGeometrySession";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import type { PlayerPose } from "../../movement/playerPose";
import type { RuntimeObjectRegistry } from "../../world-objects/runtimeObjectRegistry";
import type { ObjectHost } from "../../world-objects/worldObjectOwner";
import type { PlacedFlagObject } from "../../world-objects/toolObjects";
import { deriveCellRenderArchetypeCapacities } from "./cellRenderArchetypes";
import {
  transformGeodesicCannonForGeometryCommit,
  transformPlacedFlagForGeometryCommit,
  transformPlayerPoseForGeometryCommit,
} from "./geometryCommitTransforms";
import { createCellWarmupViews } from "./runtimeSceneUtils";

/** Per-snapshot data derived once when a snapshot becomes active and replaced as a whole on each commit. */
export interface ActiveWorldBundle {
  readonly snapshot: WorldGeometrySnapshot;
  readonly archetypeCapacitiesByCellId: ReadonlyMap<string, number>;
  readonly warmupViewsByCellId: ReadonlyMap<string, ReturnType<typeof createCellWarmupViews>>;
}

/** Dependencies of {@link createGeometryCommit}. */
export interface GeometryCommitDeps {
  /** The snapshot that is active until the first commit. */
  readonly initialSnapshot: WorldGeometrySnapshot;
  /** Visible-path budget used to size the per-cell render archetypes. */
  readonly maxVisiblePaths: number;
  readonly familyRegistry: WorldDeformationFamilyRegistry;
  readonly geometrySession: { pollReadySnapshot(): WorldGeometrySnapshot | undefined };
  readonly session: AppSession;
  readonly dispatch: (command: RuntimeCommand) => void;
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  readonly objectHost: Pick<ObjectHost, "transformGeometry">;
  /** The player's collision body at a pose. */
  readonly createPlayerCollisionState: (pose: PlayerPose) => DynamicObjectState;
  /** Called when the player's pose has no image in the new world. */
  readonly resetPlayerToHome: () => void;
  /** Drops the renderer runtime of a removed sign. */
  readonly removePlacedFlagRuntime: (flagId: string) => void;
  /** Redraws the renderer runtime of a moved sign. */
  readonly syncPlacedFlagRuntime: (flag: PlacedFlagObject) => void;
  /** Renderer hooks for the measured lengths and protractor angles that the computed-object policy removes or refreshes. */
  readonly computedObjectCallbacks: GeometryCommitComputedObjectPolicyCallbacks;
  /** Runs after the active bundle was swapped: rebuild everything that is drawn from the world. */
  readonly afterSwap: (snapshot: WorldGeometrySnapshot) => void;
}

/** Handle returned by {@link createGeometryCommit}. */
export interface GeometryCommit {
  /** Polls the geometry session once and commits the snapshot if one is ready. Called at frame start. */
  commitReady(): void;
  /** Commits `snapshot`. Throws if its deformation family is not registered. */
  commit(snapshot: WorldGeometrySnapshot): void;
  /** The active snapshot and its derived render data. */
  active(): ActiveWorldBundle;
}

/** Creates the geometry commit; see the module comment. */
export function createGeometryCommit(deps: GeometryCommitDeps): GeometryCommit {
  const { session, runtimeObjectRegistry } = deps;
  let activeBundle = createActiveWorldBundle(deps.initialSnapshot, deps.maxVisiblePaths);

  function commit(snapshot: WorldGeometrySnapshot): void {
    const previousSnapshot = activeBundle.snapshot;
    const family = getWorldDeformationFamilyOrThrow(deps.familyRegistry, snapshot.deformation.kind);
    const mapByCellId = family.createDynamicObjectMaps(
      previousSnapshot.deformation as never,
      snapshot.deformation as never,
      previousSnapshot.world,
      snapshot.world,
    );

    // Order matters: the player and objects are mapped using the previous world's cell ids, then the bundle
    // is swapped so later readers (active()) see the new world.
    const player = transformPlayerPoseForGeometryCommit(
      session.get().playerPose,
      mapByCellId,
      snapshot.world,
      deps.createPlayerCollisionState,
    );
    if (player.kind === "reset") {
      deps.resetPlayerToHome();
    } else {
      if (!player.foundLegalPose) {
        console.warn("Deformation commit: no legal player pose found; keeping the mapped pose.");
      }
      deps.dispatch({ kind: "set-player-pose", pose: player.pose });
    }

    deps.objectHost.transformGeometry(mapByCellId, snapshot.world);
    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "placed-flag") {
        const nextFlag = transformPlacedFlagForGeometryCommit(object, mapByCellId, snapshot.world);
        if (!nextFlag) {
          runtimeObjectRegistry.remove(object.id);
          deps.removePlacedFlagRuntime(object.id);
          continue;
        }
        runtimeObjectRegistry.update(nextFlag);
        deps.syncPlacedFlagRuntime(nextFlag);
      } else if (object.kind === "geodesic-cannon") {
        const transformed = transformGeodesicCannonForGeometryCommit(object, mapByCellId);
        if (!transformed) {
          runtimeObjectRegistry.remove(object.id);
          continue;
        }
        runtimeObjectRegistry.update(transformed);
      }
    }
    applyGeometryCommitComputedObjectPolicy({
      world: snapshot.world,
      registry: runtimeObjectRegistry,
      playerCellId: session.get().playerPose.cellId,
      playerPoint: session.get().playerPose.position,
      callbacks: deps.computedObjectCallbacks,
    });

    activeBundle = createActiveWorldBundle(snapshot, deps.maxVisiblePaths);
    deps.afterSwap(snapshot);
  }

  return {
    commitReady() {
      const snapshot = deps.geometrySession.pollReadySnapshot();
      if (snapshot) {
        commit(snapshot);
      }
    },
    commit,
    active: () => activeBundle,
  };
}

function createActiveWorldBundle(snapshot: WorldGeometrySnapshot, maxVisiblePaths: number): ActiveWorldBundle {
  return {
    snapshot,
    archetypeCapacitiesByCellId: deriveCellRenderArchetypeCapacities(snapshot.world, snapshot.staticCull, maxVisiblePaths, 2),
    warmupViewsByCellId: new Map(snapshot.world.cells.map((cell) => [cell.id, createCellWarmupViews(cell)] as const)),
  };
}
