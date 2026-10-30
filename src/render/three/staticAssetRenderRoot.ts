/**
 * Render root of a static asset: the template that the runtime-object render path turns into instanced meshes drawn at the asset's registry pose.
 * The root is an identity group (never added to the scene) whose single child is the authored decoration model, placed so that drawing the root at the record's authored pose reproduces the decoration exactly.
 * Under `placeAt` the whole model (offset, tilt, scale) is carried rigidly with the pose.
 */
import * as THREE from "three";
import type { AssetObjectSpec } from "../../cell-complex/specs";
import type { RigidTransform3 } from "../../math/rigidTransform3";
import { buildDecorationMesh } from "./buildDecorationMesh";
import type { PreparedWorldAssets } from "./preloadWorldAssets";
import { rigidTransformToThreeMatrix } from "./worldAxes";

/**
 * Builds the render root of a static asset: an identity group whose single child is the decoration model,
 * placed so that drawing the root at `record.localPose` reproduces the authored decoration exactly.
 *
 * `authoredPose` is the record's pose at creation. The decoration keeps its name `decoration:<id>`; the root is named `asset-root:<id>`.
 * Throws like `buildDecorationMesh` when the asset was not preloaded. The caller owns the result.
 */
export function buildStaticAssetRenderRoot(
  cellId: string,
  objectSpec: AssetObjectSpec,
  authoredPose: RigidTransform3,
  assets: PreparedWorldAssets,
): THREE.Group {
  const decoration = buildDecorationMesh(cellId, objectSpec, assets);
  decoration.updateMatrix();
  const visualFromPose = rigidTransformToThreeMatrix(authoredPose).invert().multiply(decoration.matrix);
  // The matrix is set directly: a tilt with a non-uniform scale does not round-trip through position/quaternion/scale.
  decoration.matrixAutoUpdate = false;
  decoration.matrix.copy(visualFromPose);

  const root = new THREE.Group();
  root.name = `asset-root:${objectSpec.id}`;
  root.add(decoration);
  return root;
}
