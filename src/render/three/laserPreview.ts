/**
 * The Laser's placement preview (design 017 section 8.3): with the Laser in hand and the aim on the floor, a translucent ghost of a laser stands at the aim point, with an arrow along the direction a placed laser would fire.
 * Role: one group in the scene root (the frame of the aim target's root point), shown or hidden every frame. The ghost is a post and a head drawn as simple translucent solids in the Laser's tool color, not the real laser model, so it needs no render archetype.
 * The direction is the aim ray's horizontal heading, which is what placing uses. Lifecycle: the creator calls dispose().
 */
import * as THREE from "three";
import type { AimTarget } from "../../interaction/aimTarget";
import { worldPointToThree } from "./worldAxes";

/** Radius of the ghost's post, meters. */
export const laserPreviewPostRadiusMeters = 0.16;
/** Height of the ghost's post, meters. */
export const laserPreviewPostHeightMeters = 0.8;
/** Length of the direction arrow from the post, meters. */
export const laserPreviewArrowLengthMeters = 0.9;

/** Handle to the preview created by {@link createLaserPreview}. */
export interface LaserPreview {
  readonly root: THREE.Group;
  /** Shows the ghost at `target` (a floor target) pointing along `headingRadians`, in `color`, or hides it when `target` is undefined. */
  update(target: AimTarget | undefined, headingRadians: number | undefined, color: string): void;
  /** Detaches the group and frees its geometry and material. */
  dispose(): void;
}

/** Creates the preview, adds it (hidden) to `scene`, and returns its handle. */
export function createLaserPreview(scene: THREE.Scene): LaserPreview {
  const material = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.38, depthWrite: false });
  const geometries: THREE.BufferGeometry[] = [];
  const mesh = (geometry: THREE.BufferGeometry): THREE.Mesh => {
    geometries.push(geometry);
    const result = new THREE.Mesh(geometry, material);
    result.renderOrder = 918;
    result.frustumCulled = false;
    return result;
  };

  const root = new THREE.Group();
  root.name = "laser-preview";
  root.visible = false;
  const post = mesh(new THREE.CylinderGeometry(laserPreviewPostRadiusMeters, laserPreviewPostRadiusMeters * 1.25, laserPreviewPostHeightMeters, 20));
  post.position.y = laserPreviewPostHeightMeters / 2;
  const head = mesh(new THREE.SphereGeometry(laserPreviewPostRadiusMeters * 1.4, 20, 12));
  head.position.y = laserPreviewPostHeightMeters;
  // The arrow lies along +x of the group, which the group's yaw turns to the heading; its height matches the beam.
  const arrow = new THREE.Group();
  arrow.position.y = laserPreviewPostHeightMeters;
  const shaft = mesh(new THREE.CylinderGeometry(0.03, 0.03, laserPreviewArrowLengthMeters, 10));
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = laserPreviewPostRadiusMeters + laserPreviewArrowLengthMeters / 2;
  const tip = mesh(new THREE.ConeGeometry(0.09, 0.22, 14));
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = laserPreviewPostRadiusMeters + laserPreviewArrowLengthMeters + 0.11;
  arrow.add(shaft, tip);
  root.add(post, head, arrow);
  scene.add(root);

  return {
    root,
    update(target, headingRadians, color) {
      if (!target || target.kind !== "floor") {
        root.visible = false;
        return;
      }

      material.color.set(color);
      root.visible = true;
      root.position.copy(worldPointToThree(target.rootPoint));
      // A heading counter-clockwise about world +z is the same angle about Three's +y.
      root.rotation.y = headingRadians ?? 0;
      arrow.visible = headingRadians !== undefined;
      root.updateMatrixWorld();
    },
    dispose() {
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}
