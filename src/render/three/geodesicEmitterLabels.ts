/**
 * Floating text labels shown next to geodesic emitters.
 *
 * Provides the label tuning constants (meters), the label-key convention, the Three.js-space
 * label anchor computed from a cannon's pose, and the label mesh factory. Label positions are
 * in the Three.js frame (converted from cell-local x right, y forward, z up through `worldAxes`
 * matrices); orchestration and disposal live in `geodesicEmitterLabelController`.
 */
import * as THREE from "three";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { roundRect } from "./canvasDrawing";
import { geodesicRayEmitterPosition } from "./geodesicCannonRenderer";
import { rigidTransformToThreeMatrix } from "./worldAxes";

/** Horizontal distance in meters within which the player sees emitter labels. */
export const geodesicEmitterLabelRangeMeters = 3;
/** Three.js render order for label meshes, drawn after most scene content. */
export const geodesicEmitterLabelRenderOrder = 940;
/** Label offset in meters along the emitter's local x axis, applied before the yaw transform. */
export const geodesicEmitterLabelLocalForwardOffsetMeters = 0.12;
/** Label offset in meters along the emitter's local y axis, applied before the yaw transform. */
export const geodesicEmitterLabelLocalYOffsetMeters = 0.03;

/** Builds the map key `cannonId:geodesicId` identifying one emitter label. */
export function getGeodesicEmitterLabelKey(cannonId: string, geodesicId: string): string {
  return `${cannonId}:${geodesicId}`;
}

/**
 * Computes the Three.js-space position of the label for one geodesic emitter of a cannon.
 *
 * The emitter yaw is the per-geodesic entry in `geodesicEmitterYawRadiansById` when present, otherwise the
 * cannon's `aimYawRadians`. The local emitter position plus the label offsets is carried by the cannon's
 * yawed pose into the world, so the label tracks emitter rotation. Returns a fresh vector.
 */
export function resolveGeodesicEmitterLabelPosition(
  cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  geodesicId: string,
): THREE.Vector3 {
  const yawRadians = cannon.geodesicEmitterYawRadiansById?.[geodesicId] ?? cannon.aimYawRadians;
  const emitterMatrix = rigidTransformToThreeMatrix(yawRigidTransform3(yawRadians, cannon.localPose.translation));
  return new THREE.Vector3(
    geodesicRayEmitterPosition.x + geodesicEmitterLabelLocalForwardOffsetMeters,
    geodesicRayEmitterPosition.y + geodesicEmitterLabelLocalYOffsetMeters,
    geodesicRayEmitterPosition.z,
  ).applyMatrix4(emitterMatrix);
}

/**
 * Creates a hidden 0.24 m by 0.12 m textured plane showing `text` on a rounded dark plate.
 *
 * The text is drawn once into a 512x128 canvas texture (squeezed to fit the plate width); changing text requires a new label.
 * The caller positions it, makes it visible, adds it to the scene, and must dispose the geometry, material, and
 * texture (e.g. `disposeObject3D`). Throws if a 2D canvas context is unavailable.
 */
export function createGeodesicEmitterLabel(text: string): THREE.Object3D {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create geodesic emitter label canvas context.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(10, 17, 20, 0.72)";
  roundRect(context, 138, 34, canvas.width - 276, 60, 15);
  context.fill();
  context.strokeStyle = "rgba(226, 232, 240, 0.58)";
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = "#f8fafc";
  context.font = "bold 38px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2, canvas.width - 300);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), material);
  mesh.renderOrder = geodesicEmitterLabelRenderOrder;
  mesh.visible = false;
  return mesh;
}
