/**
 * The Laser's placement preview (design 017 section 8.3): with the Laser in hand and the aim on the floor, a translucent copy of the real laser (its post and its head) stands at the aim point, the head turned the way a placed laser would fire.
 * Role: one group in the scene root (the frame of the aim target's root point), shown or hidden every frame. The models are the ones the placed laser is drawn with (`createCannonPostModel`, `createCannonHeadModel`), with every material replaced by a translucent clone and a faint yellow halo (an ellipsoid around the whole copy) as the mark of a preview, so no render archetype is needed.
 * The direction is the aim ray's horizontal heading, which is what placing uses. Lifecycle: the creator calls dispose().
 */
import * as THREE from "three";
import type { AimTarget } from "../../interaction/aimTarget";
import { createCannonHeadModel, createCannonPostModel } from "./geodesicCannonRenderer";
import type { PreparedWorldAssets } from "./preparedWorldAssets";
import { worldPointToThree } from "./worldAxes";

/** How opaque the copy is, 0 to 1. */
export const laserPreviewOpacity = 0.7;
/** How opaque the faint yellow halo around the copy is, 0 to 1. */
export const laserPreviewHaloOpacity = 0.14;

/** Handle to the preview created by {@link createLaserPreview}. */
export interface LaserPreview {
  readonly root: THREE.Group;
  /** Shows the copy at `target` (a floor target) turned to `headingRadians`, or hides it when `target` is not a floor target. */
  update(target: AimTarget | undefined, headingRadians: number | undefined): void;
  /** Detaches the group and frees the materials it made. */
  dispose(): void;
}

/** Creates the preview from the loaded models (procedural stand-ins when `assets` is omitted), adds it (hidden) to `scene`, and returns its handle. */
export function createLaserPreview(scene: THREE.Scene, assets?: PreparedWorldAssets): LaserPreview {
  const root = new THREE.Group();
  root.name = "laser-preview";
  root.visible = false;
  root.add(createCannonPostModel(assets), createCannonHeadModel(assets));

  const materials: THREE.Material[] = [];
  const translucent = (material: THREE.Material): THREE.Material => {
    const copy = material.clone();
    copy.transparent = true;
    copy.opacity = material.opacity * laserPreviewOpacity;
    copy.depthWrite = false;
    materials.push(copy);
    return copy;
  };
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material) ? object.material.map(translucent) : translucent(object.material);
    object.renderOrder = 918;
    object.frustumCulled = false;
  });

  // The halo: a soft yellow ellipsoid just larger than the copy, drawn without depth writes so the copy stays readable inside it.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const haloGeometry = new THREE.SphereGeometry(1, 24, 16);
  const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: laserPreviewHaloOpacity, depthWrite: false, side: THREE.BackSide });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.position.copy(box.getCenter(new THREE.Vector3()));
  halo.scale.set(size.x * 0.75 + 0.1, size.y * 0.62 + 0.1, size.z * 0.75 + 0.1);
  halo.renderOrder = 917;
  halo.frustumCulled = false;
  root.add(halo);
  scene.add(root);

  return {
    root,
    update(target, headingRadians) {
      if (!target || target.kind !== "floor") {
        root.visible = false;
        return;
      }

      root.visible = true;
      root.position.copy(worldPointToThree(target.rootPoint));
      // A heading counter-clockwise about world +z is the same angle about Three's +y.
      root.rotation.y = headingRadians ?? 0;
      root.updateMatrixWorld(true);
    },
    dispose() {
      root.removeFromParent();
      for (const material of materials) material.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
    },
  };
}
