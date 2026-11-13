/**
 * The outline of the focused object (design 017 section 8.4): a translucent shell in the tool's color around the object the aim is on.
 * Role: the shell is the object's own hit proxy (the capsule of a beam, the cylinder of a laser or a sign, a sphere for an object with no shape), built with the debug hit-box builders, recolored, and parented to the root of the object's cell, so it is drawn wherever that cell is drawn, through portals too.
 * State: one group at most, rebuilt only when the focused object or the color changes. `update(undefined)` removes it. Lifecycle: the creator calls dispose().
 */
import * as THREE from "three";
import type { RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { buildAimCollisionOutlineDebugMesh, buildSelectableHitboxDebugMesh } from "./debugHitboxMeshes";
import { disposeObject3D } from "./runtimeSceneUtils";

/** Opacity of the outline shell. */
export const focusOutlineOpacity = 0.34;
/** Render order of the outline: above the scene, below the debug overlays. */
export const focusOutlineRenderOrder = 920;
/** The outline color when no tool is in hand (the Hand): white. */
export const handOutlineColor = "#ffffff";

/** Handle to the outline created by {@link createFocusOutline}. */
export interface FocusOutline {
  /** Shows the outline around `object` in `color` (a CSS color), or removes it when `object` is undefined. */
  update(object: RuntimeWorldObject | undefined, color: string): void;
  /** Removes and frees the outline. */
  dispose(): void;
}

/** Creates the outline; `cellMeshes` maps a cell id to the root the outline is parented to. */
export function createFocusOutline(cellMeshes: ReadonlyMap<string, THREE.Object3D>): FocusOutline {
  let current: { readonly object: RuntimeWorldObject; readonly color: string; readonly group: THREE.Group; readonly parent: THREE.Object3D } | undefined;

  function clear(): void {
    if (!current) return;
    current.group.removeFromParent();
    disposeObject3D(current.group);
    current = undefined;
  }

  return {
    update(object, color) {
      if (object === undefined) {
        clear();
        return;
      }
      const parent = cellMeshes.get(object.cellId);
      if (current && current.object === object && current.color === color && current.parent === parent && parent !== undefined) return;
      clear();
      if (!parent) return;
      const shape = buildSelectableHitboxDebugMesh(object) ?? buildAimCollisionOutlineDebugMesh(object);
      if (!shape) return;
      const group = new THREE.Group();
      group.name = "focus-outline";
      group.add(shape);
      const tint = new THREE.Color(color);
      group.traverse((child) => {
        child.renderOrder = focusOutlineRenderOrder;
        child.frustumCulled = false;
        if (child instanceof THREE.Mesh) {
          const material = child.material as THREE.MeshBasicMaterial;
          material.color.copy(tint);
          material.opacity = focusOutlineOpacity;
          material.wireframe = false;
          material.depthTest = true;
          material.transparent = true;
          material.depthWrite = false;
        }
      });
      parent.add(group);
      current = { object, color, group, parent };
    },
    dispose: clear,
  };
}
