import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AssetObjectSpec } from "../../src/cell-complex/specs";
import { buildDecorationMesh } from "../../src/render/three/buildDecorationMesh";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";

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
