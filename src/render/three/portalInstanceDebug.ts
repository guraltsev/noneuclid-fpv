/**
 * Debug renderer that draws a single instance of a cell's archetypes at a chosen `rootFromDestination` matrix.
 *
 * Used to inspect what one portal path would show without the clipping pipeline: it clones each archetype's
 * geometry and material into a one-instance `InstancedMesh` placed by the supplied Three.js-frame matrix
 * (destination cell frame -> root frame). The clones are unclipped and are rebuilt on every call.
 */

import * as THREE from "three";
import type { CellRenderArchetype } from "./cellRenderArchetypes";
import { disposeMaterial } from "./runtimeSceneUtils";

/** Controller for the debug instance group in the scene. */
export interface PortalInstanceDebugRenderer {
  /** Replaces the debug group's content with one unclipped instance of every archetype of `cellId` placed by the matrix; returns how many archetypes were drawn. */
  renderCellInstances(cellId: string, rootFromDestinationMatrix: THREE.Matrix4): { readonly objectCount: number };
  /** Removes and disposes all debug meshes. */
  clear(): void;
  /** Clears the debug meshes and removes the group from the scene. */
  dispose(): void;
}

/** Creates the debug renderer, adding an empty `portal-instance-debug` group to `scene`. */
export function createPortalInstanceDebugRenderer(
  scene: THREE.Scene,
  archetypes: readonly CellRenderArchetype[],
): PortalInstanceDebugRenderer {
  const group = new THREE.Group();
  group.name = "portal-instance-debug";
  scene.add(group);

  return {
    renderCellInstances(cellId, rootFromDestinationMatrix) {
      clearGroup(group);
      const matchingArchetypes = archetypes.filter((archetype) => archetype.cellId === cellId);

      for (const archetype of matchingArchetypes) {
        const mesh = new THREE.InstancedMesh(
          archetype.mesh.geometry.clone(),
          cloneMaterial(archetype.mesh.material),
          1,
        );
        mesh.name = `debug:${archetype.archetypeId}`;
        mesh.count = 1;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setMatrixAt(0, rootFromDestinationMatrix);
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }

      return {
        objectCount: matchingArchetypes.length,
      };
    },
    clear() {
      clearGroup(group);
    },
    dispose() {
      clearGroup(group);
      group.removeFromParent();
    },
  };
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) {
        return;
      }

      node.geometry.dispose();
      disposeMaterial(node.material);
    });
  }
}

function cloneMaterial(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => entry.clone());
  }

  return material.clone();
}
