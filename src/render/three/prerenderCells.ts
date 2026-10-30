/**
 * Warms up GPU resources by rendering every cell once before play so shader compilation and texture upload do not hitch later.
 *
 * All cell meshes are temporarily made visible, the scene is compiled and rendered, and optionally rendered again
 * from supplied camera views per cell (yaw 0 faces +y in the world frame, forward = (-sin yaw, cos yaw), positions in
 * world frame converted with `worldPointToThree`). Instanced archetypes hidden because they are empty, and the hidden
 * unclipped root meshes of the cell archetypes, are shown for the warm-up (so `compile` sees them) and hidden again. Afterwards only the active cell is visible and the camera's
 * position, rotation order and orientation are restored. Visibility is recorded in each mesh's `userData`.
 * One-time cost at startup; renders to whatever target the renderer currently has.
 */

import * as THREE from "three";
import { worldPointToThree } from "./worldAxes";

/** Inputs for the warm-up pass: renderer, scene, camera and the per-cell root meshes. */
export interface PrerenderCellsOptions {
  readonly renderer: Pick<THREE.WebGLRenderer, "compile" | "render">;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly cellMeshes: ReadonlyMap<string, THREE.Object3D>;
  /** Cell that stays visible after warm-up. */
  readonly activeCellId: string;
  /** Extra camera views to render with only that cell visible, to compile view-dependent variants. */
  readonly warmupViewsByCellId?: ReadonlyMap<string, readonly CellWarmupView[]>;
}

/** A warm-up camera pose in the cell's world frame. */
export interface CellWarmupView {
  /** Camera position in meters, world axes (x right, y forward, z up). */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** Heading in radians, counter-clockwise from +y. */
  readonly yawRadians: number;
  /** Look pitch in radians (positive up); defaults to 0. */
  readonly pitchRadians?: number;
}

/** Runs the warm-up render (see module notes); mutates and then restores visibility flags, `userData` markers and the camera pose. */
export function prerenderCells(options: PrerenderCellsOptions): void {
  const visibilityByCellId = new Map<string, boolean>();
  const cameraMatrixAutoUpdate = options.camera.matrixAutoUpdate;
  const cameraPosition = options.camera.position.clone();
  const cameraQuaternion = options.camera.quaternion.clone();
  const cameraRotationOrder = options.camera.rotation.order;

  for (const [cellId, cellMesh] of options.cellMeshes) {
    visibilityByCellId.set(cellId, cellMesh.visible);
    cellMesh.visible = true;
    cellMesh.userData = {
      ...cellMesh.userData,
      prerenderedByDefault: true,
    };
  }

  // Empty instanced archetypes are hidden by the instance writers, and `renderer.compile` only visits visible
  // objects, so they are made visible for the warm-up and hidden again afterwards.
  const hiddenInstancedMeshes: THREE.Object3D[] = [];
  options.scene.traverse((object) => {
    const isArchetypeMesh =
      (object as THREE.InstancedMesh).isInstancedMesh || object.userData?.kind === "cell-render-archetype-root";

    if (isArchetypeMesh && !object.visible) {
      object.visible = true;
      hiddenInstancedMeshes.push(object);
    }
  });

  options.renderer.compile(options.scene, options.camera);
  options.renderer.render(options.scene, options.camera);
  prerenderCellWarmupViews(options);

  for (const object of hiddenInstancedMeshes) {
    object.visible = false;
  }

  for (const [cellId, cellMesh] of options.cellMeshes) {
    cellMesh.visible = cellId === options.activeCellId;
    cellMesh.userData = {
      ...cellMesh.userData,
      prerenderedByDefault: true,
      prerendered: true,
      previousVisible: visibilityByCellId.get(cellId) ?? false,
    };
  }

  options.camera.matrixAutoUpdate = cameraMatrixAutoUpdate;
  options.camera.position.copy(cameraPosition);
  options.camera.quaternion.copy(cameraQuaternion);
  options.camera.rotation.order = cameraRotationOrder;
  options.camera.updateMatrixWorld(true);
}

function prerenderCellWarmupViews(options: PrerenderCellsOptions): void {
  if (!options.warmupViewsByCellId || options.warmupViewsByCellId.size === 0) {
    return;
  }

  for (const [cellId, cellMesh] of options.cellMeshes) {
    const warmupViews = options.warmupViewsByCellId.get(cellId);

    if (!warmupViews || warmupViews.length === 0) {
      continue;
    }

    for (const [, otherCellMesh] of options.cellMeshes) {
      otherCellMesh.visible = false;
    }

    cellMesh.visible = true;

    for (const view of warmupViews) {
      const forward = {
        x: -Math.sin(view.yawRadians) * Math.cos(view.pitchRadians ?? 0),
        y: Math.cos(view.yawRadians) * Math.cos(view.pitchRadians ?? 0),
        z: Math.sin(view.pitchRadians ?? 0),
      };
      options.camera.position.copy(worldPointToThree(view.position));
      options.camera.up.set(0, 1, 0);
      options.camera.lookAt(
        worldPointToThree({
          x: view.position.x + forward.x,
          y: view.position.y + forward.y,
          z: view.position.z + forward.z,
        }),
      );
      options.camera.updateMatrixWorld(true);
      options.renderer.render(options.scene, options.camera);
    }
  }
}
