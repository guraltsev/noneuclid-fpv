/**
 * Renderer for measured-geodesic-length labels placed in the world.
 *
 * Each measurement object becomes a floating two-sided "length" badge hovering above its anchor pose.
 * The anchor pose is a rigid transform in the owning cell's local frame (world axes, meters) that is
 * applied to a Three.js group via `applyWorldRigidTransform`. Runtimes rebuild their group on every sync
 * and dispose the old GPU resources (geometries, materials, textures); the caller attaches `root` to the cell's scene node.
 */
import * as THREE from "three";
import {
  formatMeasuredGeodesicLengthLabel,
  type MeasuredGeodesicLengthObject,
} from "../../world-objects/measureLengthTool";
import { applyWorldRigidTransform } from "./worldAxes";
import { createWorldResultBadge } from "./worldResultBadge";
import { disposeObject3DWithTextures } from "./runtimeSceneUtils";

/** Lifecycle handle for one measured-length label in the scene. */
export interface MeasuredGeodesicLengthRuntime {
  /** Current label group; its identity changes after each `syncFromObject`, so re-read it rather than caching. */
  readonly root: THREE.Object3D;
  readonly objectId: string;
  /** Id of the cell whose local frame contains the label (tracks the latest synced object). */
  readonly cellId: string;
  /** Rebuilds the label from `object` in place under the same parent; throws if the object id differs from this runtime's. */
  syncFromObject(object: MeasuredGeodesicLengthObject): void;
  /** Detaches the label from its parent and frees its geometries, materials and textures. */
  dispose(): void;
}

// Vertical offset of the badge above the anchor pose, in meters.
const labelHeightMeters = 0.22;
// Draw after most scene content so the badge is not hidden by transparent geometry.
const labelRenderOrder = 57;

/**
 * Creates the runtime that renders `object`'s measured length as a floating label.
 *
 * The group is created detached; the caller must add `root` to the scene. A sync swaps the new
 * group into the old group's parent, so the caller only re-adds `root` if it was detached.
 */
export function createMeasuredGeodesicLengthRuntime(
  object: MeasuredGeodesicLengthObject,
): MeasuredGeodesicLengthRuntime {
  let root = createMeasuredGeodesicLengthRoot(object);
  let cellId = object.cellId;

  return {
    get root() {
      return root;
    },
    objectId: object.id,
    get cellId() {
      return cellId;
    },
    syncFromObject(nextObject) {
      if (nextObject.id !== object.id) {
        throw new Error(`Cannot sync measured geodesic length runtime "${object.id}" from "${nextObject.id}".`);
      }

      const parent = root.parent;
      const nextRoot = createMeasuredGeodesicLengthRoot(nextObject);
      if (parent) {
        parent.remove(root);
        parent.add(nextRoot);
      }
      disposeObject3DWithTextures(root);
      root = nextRoot;
      cellId = nextObject.cellId;
    },
    dispose() {
      root.removeFromParent();
      disposeObject3DWithTextures(root);
    },
  };
}

function createMeasuredGeodesicLengthRoot(object: MeasuredGeodesicLengthObject): THREE.Group {
  const root = new THREE.Group();
  root.name = `measured-geodesic-length:${object.id}`;
  root.add(createLengthLabel(object));
  applyWorldRigidTransform(root, object.localPose);
  return root;
}

function createLengthLabel(object: MeasuredGeodesicLengthObject): THREE.Object3D {
  const text = formatMeasuredGeodesicLengthLabel(object, object.lengthMeters);
  const badge = createWorldResultBadge({
    text,
    variant: "length",
    widthMeters: 0.5,
    heightMeters: 0.15625,
    pointer: "down",
    doubleFaced: true,
    renderOrder: labelRenderOrder,
  });
  badge.name = "measured-geodesic-length-floating-tooltip";
  badge.children[0].name = "measured-geodesic-length-floating-tooltip:front";
  badge.children[1].name = "measured-geodesic-length-floating-tooltip:back";
  badge.position.set(0, labelHeightMeters, 0);
  // Quarter turn about Three.js y so the badge faces along the anchor pose's local axes.
  badge.rotation.y = Math.PI / 2;
  badge.renderOrder = labelRenderOrder;
  return badge;
}
