/**
 * Builds the Three.js node for a static decoration (asset object) declared in a cell spec.
 *
 * The returned group is positioned in the cell-local frame converted to Three.js (spec position plus optional model offset,
 * meters; world z up becomes Three.js y up), tilted, yawed and scaled per the spec, and holds either the cloned preloaded
 * glTF scene or, for the legacy marmot asset, a procedural box-built proxy. The group is named `decoration:<id>` and
 * is meant to be added to the owning cell's root node. Throws if the asset was not preloaded.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AssetObjectSpec, CellObjectSpec } from "../../cell-complex/specs";
import { runtimeDiagnostics } from "./runtimeDiagnostics";
import type { PreparedGltfAsset, PreparedWorldAssets } from "./preloadWorldAssets";
import { worldPointToThree, worldYawRadiansToThree } from "./worldAxes";

/** Legacy asset path that is replaced by the procedural marmot proxy instead of loading a glTF. */
export const staticMarmotAssetPath = "_legacy/racoon-animation/scene.gltf";

/**
 * Builds the render node for the static asset object `objectSpec` of cell `cellId`.
 *
 * Throws for non-asset object kinds, and for assets missing from `assets` (they must be preloaded by
 * `preloadWorldAssets`). Records instance-load diagnostics around the glTF instantiation. The caller owns the result.
 */
export function buildDecorationMesh(
  cellId: string,
  objectSpec: CellObjectSpec,
  assets: PreparedWorldAssets,
): THREE.Object3D {
  if (objectSpec.kind !== "asset") {
    throw new Error(`Cannot build static decoration mesh for object kind "${objectSpec.kind}".`);
  }

  return buildStaticAssetMesh(cellId, objectSpec, assets);
}

function buildStaticAssetMesh(
  cellId: string,
  objectSpec: AssetObjectSpec,
  assets: PreparedWorldAssets,
): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `decoration:${objectSpec.id}`;
  group.position.copy(worldPointToThree(objectSpec.position));
  if (objectSpec.modelOffset) {
    group.position.add(worldPointToThree(objectSpec.modelOffset));
  }
  // Orientation is composed intrinsically as Rx(forward tilt) * Rz(side tilt) * Ry(yaw) in the Three.js frame:
  // yaw about Three.js y (world up) is applied first to the model, tilts afterwards.
  group.rotation.set(0, 0, 0);
  group.rotateX(objectSpec.forwardTiltRadians ?? 0);
  group.rotateZ(objectSpec.sideTiltRadians ?? 0);
  group.rotateY(worldYawRadiansToThree(objectSpec.turnRadians ?? objectSpec.yawRadians ?? 0));
  const diagnostics = runtimeDiagnostics();

  if (objectSpec.scaleXYZ) {
    group.scale.set(objectSpec.scaleXYZ.x, objectSpec.scaleXYZ.y, objectSpec.scaleXYZ.z);
  } else {
    const scale = objectSpec.scale ?? 1;
    group.scale.setScalar(scale);
  }

  // A white cube stands in until the real model is attached (and is removed again immediately in both paths).
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
  );
  placeholder.position.y = 0.3;
  placeholder.name = `placeholder:${objectSpec.id}`;
  group.add(placeholder);

  if (objectSpec.assetPath === staticMarmotAssetPath) {
    placeholder.removeFromParent();
    disposeObject3D(placeholder);
    group.add(buildStaticMarmotProxy(objectSpec.id));
    return group;
  }

  diagnostics.recordAssetInstanceStart(cellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  const prepared = assets.instantiateGltf(objectSpec.assetPath);
  if (!prepared) {
    throw new Error(`Static asset was not preloaded: ${objectSpec.assetPath}`);
  }

  replacePlaceholderWithPreparedAsset(group, placeholder, objectSpec, prepared);
  diagnostics.recordAssetInstanceComplete(cellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  return group;
}

/**
 * Builds a small procedural marmot (boxes for body, head, muzzle, tail, ears, eyes and legs) used in place of the legacy marmot glTF.
 * The 12 boxes are merged into one vertex-coloured mesh `marmot:<objectId>`, so the marmot is a single draw call.
 *
 * Dimensions are in meters in the model's local Three.js frame, with the animal roughly 1 m long, facing +z, feet on y = 0.
 * Named `asset:<objectId>`; the caller owns the geometries and materials.
 */
export function buildStaticMarmotProxy(objectId: string): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `asset:${objectId}`;

  const bodyColor = new THREE.Color(0x8c6a43);
  const accentColor = new THREE.Color(0xe4d6bb);
  const eyeColor = new THREE.Color(0x111111);
  const boxes: THREE.BufferGeometry[] = [];
  // One box with its position baked in and a per-vertex colour, so all boxes merge into a single draw call.
  const addBox = (
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    color: THREE.Color,
  ): void => {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    geometry.translate(position[0], position[1], position[2]);
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let offset = 0; offset < colors.length; offset += 3) {
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    boxes.push(geometry);
  };

  addBox([0.34, 0.24, 0.62], [0, 0.18, 0], bodyColor); // body
  addBox([0.22, 0.2, 0.2], [0, 0.24, 0.34], bodyColor); // head
  addBox([0.12, 0.09, 0.08], [0, 0.2, 0.46], accentColor); // muzzle
  addBox([0.14, 0.14, 0.2], [0, 0.16, -0.36], bodyColor); // tail

  for (const x of [-0.09, 0.09]) {
    addBox([0.06, 0.08, 0.04], [x, 0.37, 0.31], bodyColor); // ear
    addBox([0.025, 0.025, 0.025], [x * 0.7, 0.24, 0.45], eyeColor); // eye
  }

  for (const x of [-0.1, 0.1]) {
    for (const z of [-0.16, 0.16]) {
      addBox([0.08, 0.16, 0.08], [x, 0.08, z], bodyColor); // leg
    }
  }

  const merged = mergeGeometries(boxes);
  for (const box of boxes) {
    box.dispose();
  }

  const marmot = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  marmot.name = `marmot:${objectId}`;
  root.add(marmot);

  return root;
}

function replacePlaceholderWithPreparedAsset(
  group: THREE.Group,
  placeholder: THREE.Object3D,
  objectSpec: AssetObjectSpec,
  prepared: PreparedGltfAsset,
): void {
  placeholder.removeFromParent();
  disposeObject3D(placeholder);
  prepared.scene.name = `asset:${objectSpec.id}`;
  group.add(prepared.scene);
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
    return;
  }

  material.dispose();
}
