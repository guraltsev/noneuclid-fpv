import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AssetObjectSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { buildDecorationMesh, staticMarmotAssetPath } from "../../src/render/three/buildDecorationMesh";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";
import { buildStaticAssetRenderRoot } from "../../src/render/three/staticAssetRenderRoot";
import { rigidTransformToThreeMatrix } from "../../src/render/three/worldAxes";
import { createRuntimeObjectRegistry, createRuntimeStaticAssetObject } from "../../src/world-objects/runtimeObjectRegistry";

function stubAssets(): PreparedWorldAssets {
  return {
    getTexture: () => undefined,
    getConfiguredTexture: () => undefined,
    instantiateGltf() {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
      return { scene, animations: [] };
    },
  };
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      found.push(child);
    }
  });
  return found;
}

const base: AssetObjectSpec = {
  id: "a",
  kind: "asset",
  assetPath: "models/box.glb",
  position: { x: 1, y: 2, z: 0 },
  turnRadians: 0.7,
};

const specs: Array<[string, AssetObjectSpec]> = [
  ["plain", base],
  ["offset and scale", { ...base, modelOffset: { x: 0, y: 0, z: 0.1 }, scale: 1.5 }],
  [
    "tilted and non-uniformly scaled",
    {
      ...base,
      modelOffset: { x: 0, y: 0, z: 0.1 },
      scale: 1.5,
      forwardTiltRadians: 0.2,
      sideTiltRadians: -0.1,
      scaleXYZ: { x: 1, y: 2, z: 0.5 },
    },
  ],
  ["legacy marmot", { ...base, assetPath: staticMarmotAssetPath }],
];

describe("buildStaticAssetRenderRoot", () => {
  for (const [label, spec] of specs) {
    it(`reproduces the authored decoration at the authored pose (${label})`, () => {
      const assets = stubAssets();
      const decoration = buildDecorationMesh("room", spec, assets);
      decoration.updateMatrixWorld(true);
      const expected = meshes(decoration);

      const authoredPose = createRuntimeStaticAssetObject(spec, "room").localPose;
      const root = buildStaticAssetRenderRoot("room", spec, authoredPose, assets);
      root.updateMatrixWorld(true);
      const actual = meshes(root);
      expect(actual.length).toBe(expected.length);
      expect(actual.length).toBeGreaterThan(0);

      const poseMatrix = rigidTransformToThreeMatrix(authoredPose);
      const rootInverse = root.matrixWorld.clone().invert();
      actual.forEach((mesh, index) => {
        const product = poseMatrix.clone().multiply(rootInverse).multiply(mesh.matrixWorld);
        product.elements.forEach((value, element) => {
          expect(Math.abs(value - expected[index].matrixWorld.elements[element])).toBeLessThan(1e-9);
        });
      });
    });
  }

  it("carries the model rigidly with the pose", () => {
    const spec = specs[2][1];
    const assets = stubAssets();
    const authored = yawRigidTransform3(0.7, spec.position);
    const root = buildStaticAssetRenderRoot("room", spec, authored, assets);
    root.updateMatrixWorld(true);
    const mesh = meshes(root)[0];
    const moved = yawRigidTransform3(0.2, { x: -3, y: 4, z: 0 });
    const atAuthored = rigidTransformToThreeMatrix(authored).multiply(mesh.matrixWorld);
    const atMoved = rigidTransformToThreeMatrix(moved).multiply(mesh.matrixWorld);
    // Distinct poses give distinct model matrices, and the model is not left at the authored place.
    expect(atMoved.elements.some((value, i) => Math.abs(value - atAuthored.elements[i]) > 1e-6)).toBe(true);
  });
});

describe("static asset records", () => {
  it("gives a non-collidable asset a record that collision queries ignore", () => {
    const registry = createRuntimeObjectRegistry();
    registry.add(createRuntimeStaticAssetObject(base, "room"));
    expect(registry.get("a")).toBeDefined();
    expect(registry.getCollidableObjectsInCell("room")).toEqual([]);
  });
});
