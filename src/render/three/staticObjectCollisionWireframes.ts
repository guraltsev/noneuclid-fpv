/**
 * Debug overlay builder for the collision shapes of static asset objects in one cell.
 *
 * Each collidable asset object is converted to its dynamic-object state and drawn as a wireframe
 * positioned in the cell's axes (cell-local frame, meters, mapped into the Three.js frame by the
 * shared wireframe helpers). Used only by collision-debug visualisation.
 */
import * as THREE from "three";
import {
  runtimeObjectToDynamicObjectState,
  type RuntimeWorldObject,
} from "../../world-objects/runtimeObjectRegistry";
import { buildObjectCollisionWireframeInCellAxes } from "./debugCollisionWireframes";

/**
 * Builds a group of collision wireframes for the collidable asset objects of cell `cellId`.
 *
 * Objects that are not of kind `"asset"` or have no `collision` are skipped. Returns `undefined`
 * (rather than an empty group) when nothing qualifies. The group is named
 * `static-object-collision-wireframes:<cellId>`; the caller owns its geometry/material disposal.
 */
export function buildStaticObjectCollisionWireframeGroup(
  cellId: string,
  objects: readonly RuntimeWorldObject[],
): THREE.Group | undefined {
  const group = new THREE.Group();
  group.name = `static-object-collision-wireframes:${cellId}`;

  for (const object of objects) {
    if (object.kind !== "asset" || !object.collision) {
      continue;
    }

    group.add(buildObjectCollisionWireframeInCellAxes(object.id, runtimeObjectToDynamicObjectState(object)));
  }

  return group.children.length > 0 ? group : undefined;
}
