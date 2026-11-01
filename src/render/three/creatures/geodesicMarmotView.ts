/**
 * Three.js view of the geodesic marmot: its static proxy mesh, the debug collision cylinder and the attachment to the current cell's scene node.
 * The motion itself lives in `world-objects/creatures/geodesicMarmotBehavior`; this module drives it each frame, then applies its pose to the model root (world axes to Three.js axes by `worldAxes`) and refreshes the wireframe.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../../cell-complex/compileCellComplex";
import type { CellDeformationMap } from "../../../cell-complex/worldGeometryDeformations";
import type { GeodesicMarmotObjectSpec } from "../../../cell-complex/specs";
import { runtimeDiagnostics } from "../../../diagnostics/runtimeDiagnostics";
import { createGeodesicMarmotBehavior } from "../../../world-objects/creatures/geodesicMarmotBehavior";
import type { RuntimeObjectRegistry } from "../../../world-objects/runtimeObjectRegistry";
import type { WorldObjectOwner } from "../../../world-objects/worldObjectOwner";
import { buildStaticMarmotProxy } from "../buildDecorationMesh";
import { buildObjectCollisionWireframe, updateObjectCollisionWireframe } from "../debugCollisionWireframes";
import type { PreparedWorldAssets } from "../preparedWorldAssets";
import { applyWorldRigidTransform } from "../worldAxes";

/** Visual scale of the proxy mesh when the spec gives none. */
const defaultVisualScale = 0.42;

/**
 * Per-marmot runtime handle owned by the renderer.
 * `root` is the three.js group (reparented into the current cell's root by `syncParent`); `cellId` reports the marmot's current cell.
 */
export interface GeodesicMarmotRuntime extends WorldObjectOwner {
  readonly root: THREE.Object3D;
  readonly objectId: string;
  readonly cellId: string;
  /** Advances the marmot by `deltaSeconds` along its heading, crossing portals as needed; no-op for non-positive speed or time; when a forbidden zone blocks the step it turns away from the nearest zone (reflection) instead of moving. */
  update(world: CompiledCellComplex, deltaSeconds: number): void;
  /** Attaches `root` to the scene node of the marmot's current cell if it is not already there. */
  syncParent(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
  /** Shows or hides the debug collision cylinder. */
  setCollisionWireframeVisible(visible: boolean): void;
  /** Remaps the current and initial poses through per-cell deformation maps after a live geometry change; leaves state untouched if either pose cannot be mapped; when `nextWorld` is given, both poses are then pushed out of obstacles in it. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
  /** Restores the initial (possibly deformation-remapped) cell and pose and reattaches to that cell's root. */
  reset(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
}

/**
 * Creates the runtime (three.js group, behavior, registry entry) for a marmot starting in `startCellId`.
 * Registers the object in `registry` when given and claims ownership of its registry record (see `createGeodesicMarmotBehavior`). The visual is a static proxy mesh, not the glTF in `objectSpec.assetPath`, so the `_assets` argument is unused.
 */
export function createGeodesicMarmotRuntime(
  objectSpec: GeodesicMarmotObjectSpec,
  startCellId: string,
  _assets: PreparedWorldAssets,
  registry?: RuntimeObjectRegistry,
): GeodesicMarmotRuntime {
  const root = new THREE.Group();
  root.name = `geodesci-marmot:${objectSpec.id}`;

  const visual = buildStaticMarmotProxy(objectSpec.id);
  visual.rotation.y = Math.PI;
  visual.scale.setScalar(objectSpec.scale ?? defaultVisualScale);
  root.add(visual);
  const behavior = createGeodesicMarmotBehavior(objectSpec, startCellId, registry);
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
    update(world, deltaSeconds) {
      behavior.update(world, deltaSeconds);
      showBehaviorState();
    },
    place(cellId, localPose) {
      behavior.place(cellId, localPose);
      showBehaviorState();
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
