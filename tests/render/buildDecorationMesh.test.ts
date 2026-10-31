import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AssetObjectSpec } from "../../src/cell-complex/specs";
import { buildDecorationMesh, buildStaticMarmotProxy } from "../../src/render/three/buildDecorationMesh";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";

describe("buildStaticMarmotProxy", () => {
  it("is one vertex-coloured mesh with the bounds of the old twelve boxes", () => {
    const root = buildStaticMarmotProxy("m");
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes.push(child);
      }
    });

    expect(root.name).toBe("asset:m");
    expect(meshes).toHaveLength(1);
    const geometry = meshes[0].geometry;
    expect(geometry.getAttribute("color")).toBeDefined();
    expect(geometry.getAttribute("position").count).toBe(12 * 24);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(-0.17, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.min.z).toBeCloseTo(-0.46, 6);
    expect(box.max.x).toBeCloseTo(0.17, 6);
    expect(box.max.y).toBeCloseTo(0.41, 6);
    expect(box.max.z).toBeCloseTo(0.5, 6);
  });
});

describe("buildDecorationMesh", () => {
  it("uses prepared GLTF assets synchronously instead of leaving first-entry placeholders", () => {
    const objectSpec: AssetObjectSpec = {
      id: "tree",
      kind: "asset",
      assetPath: "Tree1/Tree.glb",
      position: { x: 1, y: 0, z: 2 },
    };
    const preparedScene = new THREE.Group();
    const assets: PreparedWorldAssets = {
      getTexture: () => undefined,
      getConfiguredTexture: () => undefined,
      instantiateGltf(assetPath) {
        expect(assetPath).toBe(objectSpec.assetPath);
        return {
          scene: preparedScene.clone(),
          animations: [],
        };
      },
    };

    const decoration = buildDecorationMesh("room-a", objectSpec, assets);

    expect(decoration.getObjectByName("placeholder:tree")).toBeUndefined();
    expect(decoration.getObjectByName("asset:tree")).toBeDefined();
  });
});
