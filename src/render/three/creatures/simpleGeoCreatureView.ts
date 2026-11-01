/**
 * Three.js view of a simple geodesic creature (the mouse or the butterfly): the glTF instance, the debug collision cylinder and the attachment to the current cell's scene node.
 * The motion itself lives in `world-objects/creatures/simpleGeoCreatureBehavior`; this module drives it each frame, then applies its pose to the model root (world axes to Three.js axes by `worldAxes`) and refreshes the wireframe.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../../cell-complex/compileCellComplex";
import type { CellDeformationMap } from "../../../cell-complex/worldGeometryDeformations";
import type { SimpleGeoCreatureObjectSpec } from "../../../cell-complex/specs";
import type { RigidTransform3 } from "../../../math/rigidTransform3";
import type { DynamicObjectState } from "../../../movement/dynamicObject";
import { runtimeDiagnostics } from "../../../diagnostics/runtimeDiagnostics";
import { createSimpleGeoCreatureBehavior } from "../../../world-objects/creatures/simpleGeoCreatureBehavior";
import type { RuntimeObjectRegistry } from "../../../world-objects/runtimeObjectRegistry";
import type { WorldObjectOwner } from "../../../world-objects/worldObjectOwner";
import { buildObjectCollisionWireframe, updateObjectCollisionWireframe } from "../debugCollisionWireframes";
import type { PreparedWorldAssets } from "../preparedWorldAssets";
import { applyWorldRigidTransform } from "../worldAxes";

/**
 * Per-creature runtime handle owned by the renderer.
 * `root` is the three.js group (reparented into the current cell's root by `syncParent`); `cellId` reports the creature's current cell.
 */
export interface SimpleGeoCreatureRuntime extends WorldObjectOwner {
  readonly root: THREE.Object3D;
  readonly objectId: string;
  readonly cellId: string;
  /** Advances the creature by `deltaSeconds`; `obstacles` are collision states (same-cell ones are tested) that the creature will not move into. No-op for non-positive `deltaSeconds`. */
  update(world: CompiledCellComplex, deltaSeconds: number, obstacles?: readonly DynamicObjectState[]): void;
  /** Attaches `root` to the scene node of the creature's current cell if it is not already there. */
  syncParent(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
  /** Shows or hides the debug collision cylinder. */
  setCollisionWireframeVisible(visible: boolean): void;
  /** Remaps the current and initial poses through per-cell deformation maps after a live geometry change; leaves state untouched if either pose cannot be mapped; when `nextWorld` is given, both poses are then pushed out of obstacles in it. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
  /** The invisible leader and the map from its cell frame to the creature's cell frame (for tests and debugging). */
  leaderForDebug(): { readonly cellId: string; readonly localPose: RigidTransform3; readonly creatureFromLeader: RigidTransform3 };
  /** Restores the initial (possibly deformation-remapped) pose and oscillation phases and reattaches to that cell's root. */
  reset(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
}

/**
 * Creates the runtime (three.js model instance, behavior, registry entry) for a creature starting in `startCellId`.
 * Throws if the model was not preloaded in `assets`. Registers the object in `registry` when given and claims ownership of its registry record (see `createSimpleGeoCreatureBehavior`).
 */
export function createSimpleGeoCreatureRuntime(
  objectSpec: SimpleGeoCreatureObjectSpec,
  startCellId: string,
  assets: PreparedWorldAssets,
  registry?: RuntimeObjectRegistry,
): SimpleGeoCreatureRuntime {
  const root = new THREE.Group();
  root.name = `${objectSpec.kind}:${objectSpec.id}`;

  const prepared = assets.instantiateGltf(objectSpec.assetPath);
  if (!prepared) {
    throw new Error(`Geo creature asset was not preloaded: ${objectSpec.assetPath}`);
  }

  prepared.scene.name = `asset:${objectSpec.id}`;
  prepared.scene.scale.setScalar(objectSpec.scale ?? 1);
  prepared.scene.rotation.x = objectSpec.forwardTiltRadians ?? 0;
  prepared.scene.rotation.y = Math.PI;
  prepared.scene.rotation.z = objectSpec.sideTiltRadians ?? 0;
  if (objectSpec.modelOffset) {
    prepared.scene.position.copy(new THREE.Vector3(objectSpec.modelOffset.x, objectSpec.modelOffset.z, -objectSpec.modelOffset.y));
  }
  root.add(prepared.scene);
  const behavior = createSimpleGeoCreatureBehavior(objectSpec, startCellId, registry);
  const collisionWireframe = buildObjectCollisionWireframe(objectSpec.id, behavior.state);
  collisionWireframe.visible = false;
  root.add(collisionWireframe);
  // The debug option decides visibility; updateObjectCollisionWireframe alone would show it whenever bounds exist.
  let collisionWireframeRequested = false;
  const refreshCollisionWireframe = (): void => {
    updateObjectCollisionWireframe(collisionWireframe, behavior.state);
    collisionWireframe.visible = collisionWireframeRequested && collisionWireframe.visible;
  };
  const showBehaviorState = (): void => {
    applyWorldRigidTransform(root, behavior.state.localPose);
    refreshCollisionWireframe();
  };
  const attachToCurrentCell = (cellRoots: ReadonlyMap<string, THREE.Object3D>): void => {
    const targetRoot = cellRoots.get(behavior.cellId);

    if (targetRoot && root.parent !== targetRoot) {
      targetRoot.add(root);
    }
  };
  const diagnostics = runtimeDiagnostics();

  diagnostics.recordAssetInstanceStart(startCellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  diagnostics.recordAssetInstanceComplete(startCellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  showBehaviorState();

  return {
    root,
    objectId: objectSpec.id,
    id: objectSpec.id,
    get cellId() {
      return behavior.cellId;
    },
    update(world, deltaSeconds, obstacles) {
      behavior.update(world, deltaSeconds, obstacles);
      showBehaviorState();
    },
    place(cellId, localPose) {
      behavior.place(cellId, localPose);
      showBehaviorState();
    },
    leaderForDebug() {
      return behavior.leaderForDebug();
    },
    syncParent: attachToCurrentCell,
    setCollisionWireframeVisible(visible) {
      collisionWireframeRequested = visible;
      refreshCollisionWireframe();
    },
    transformGeometry(mapByCellId, nextWorld) {
      behavior.transformGeometry(mapByCellId, nextWorld);
      showBehaviorState();
    },
    reset(cellRoots) {
      behavior.reset();
      showBehaviorState();
      attachToCurrentCell(cellRoots);
    },
  };
}
