/**
 * Builds the Three.js node for a static decoration (asset object) declared in a cell spec.
 *
 * The returned group is positioned in the cell-local frame converted to Three.js (spec position plus optional model offset,
 * meters; world z up becomes Three.js y up), tilted, yawed and scaled per the spec, and holds either the cloned preloaded
 * glTF scene or, for the legacy marmot asset, a procedural box-built proxy. The group is named `decoration:<id>` and
 * is meant to be added to the owning cell's root node. Throws if the asset was not preloaded.
 */
import * as THREE from "three";
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
 *
 * Dimensions are in meters in the model's local Three.js frame, with the animal roughly 1 m long, facing +z, feet on y = 0.
 * Named `asset:<objectId>`; the caller owns the geometries and materials.
 */
export function buildStaticMarmotProxy(objectId: string): THREE.Object3D {
  const root = new THREE.Group();
  root.name = `asset:${objectId}`;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x8c6a43,
    roughness: 0.95,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0xe4d6bb,
    roughness: 1,
  });
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.6,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.62), bodyMaterial);
  body.position.set(0, 0.18, 0);
  body.name = `marmot-body:${objectId}`;
  root.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.2), bodyMaterial.clone());
  head.position.set(0, 0.24, 0.34);
  head.name = `marmot-head:${objectId}`;
  root.add(head);

  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.08), accentMaterial);
  muzzle.position.set(0, 0.2, 0.46);
  muzzle.name = `marmot-muzzle:${objectId}`;
  root.add(muzzle);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.2), bodyMaterial.clone());
  tail.position.set(0, 0.16, -0.36);
  tail.name = `marmot-tail:${objectId}`;
  root.add(tail);

  for (const [index, x] of [-0.09, 0.09].entries()) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), bodyMaterial.clone());
    ear.position.set(x, 0.37, 0.31);
    ear.name = `marmot-ear:${objectId}:${index}`;
    root.add(ear);

    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), eyeMaterial.clone());
    eye.position.set(x * 0.7, 0.24, 0.45);
    eye.name = `marmot-eye:${objectId}:${index}`;
    root.add(eye);
  }

  for (const [index, x] of [-0.1, 0.1].entries()) {
    for (const [innerIndex, z] of [-0.16, 0.16].entries()) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.08), bodyMaterial.clone());
      leg.position.set(x, 0.08, z);
      leg.name = `marmot-leg:${objectId}:${index}:${innerIndex}`;
      root.add(leg);
    }
  }

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
