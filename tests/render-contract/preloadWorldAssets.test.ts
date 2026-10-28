import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import {
  classifyAssetPreloadKind,
  collectWorldAssetPaths,
  preloadWorldAssets,
  type PreparedKtx2Loader,
} from "../../src/render/three/preloadWorldAssets";
import { standardUserRobotObject } from "../../src/world-objects/library";

const loadTextureAsync = vi.fn(async (_url: string) => new THREE.Texture());
const loadExrAsync = vi.fn(async (_url: string) => new THREE.Texture());
const loadGltfAsync = vi.fn(async (_url: string) => ({
  scene: new THREE.Group(),
  animations: [] as readonly THREE.AnimationClip[],
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    loadAsync(url: string) {
      return loadGltfAsync(url);
    }
  },
}));

vi.mock("three/examples/jsm/loaders/EXRLoader.js", () => ({
  EXRLoader: class {
    loadAsync(url: string) {
      return loadExrAsync(url);
    }
  },
}));

describe("preloadWorldAssets", () => {
  beforeEach(() => {
    loadTextureAsync.mockReset();
    loadExrAsync.mockReset();
    loadGltfAsync.mockReset();
    loadTextureAsync.mockResolvedValue(new THREE.Texture());
    loadExrAsync.mockResolvedValue(new THREE.Texture());
    loadGltfAsync.mockResolvedValue({
      scene: new THREE.Group(),
      animations: [],
    });
    vi.spyOn(THREE.TextureLoader.prototype, "loadAsync").mockImplementation(
      loadTextureAsync as THREE.TextureLoader["loadAsync"],
    );
  });

  it("collects only runtime floor color maps by default", () => {
    const world = compileCellComplex(cube);
    const assetPaths = collectWorldAssetPaths(world);

    expect(assetPaths.some((assetPath) => assetPath.endsWith(".ktx2"))).toBe(true);
    expect(assetPaths.some((assetPath) => assetPath.endsWith(".exr"))).toBe(false);
    expect(assetPaths.some((assetPath) => /disp|rough/i.test(assetPath))).toBe(false);
  });

  it("includes runtime tool assets even when no authored object references them", () => {
    const world = compileCellComplex(cube);
    const assetPaths = collectWorldAssetPaths(world);

    expect(assetPaths).toContain("WoodenSign1/WoodenSign1.glb");
    expect(assetPaths).toContain("WoodenSign2/WoodenSign2.glb");
    expect(assetPaths).toContain("flashlight/Post.glb");
    expect(assetPaths).toContain("flashlight/Lightsaber.glb");
    expect(assetPaths).toContain("baloon/Balloon.glb");
    expect(assetPaths).toContain(standardUserRobotObject.assetPath);
  });

  it("classifies .ktx2 files as textures", () => {
    expect(classifyAssetPreloadKind("textures/floor/runtime/floor_color.ktx2")).toBe("texture-ktx2");
    expect(classifyAssetPreloadKind("textures/floor/source/floor_color.jpg")).toBe("texture");
    expect(classifyAssetPreloadKind("textures/floor/source/floor_normal.exr")).toBe("texture-exr");
    expect(classifyAssetPreloadKind("Tree1/Tree.glb")).toBe("gltf");
  });

  it("routes .ktx2 floor paths through the texture preload path instead of the GLTF loader", async () => {
    const ktx2LoadAsync = vi.fn(async (_url: string) => new THREE.Texture());
    const dispose = vi.fn();
    const world = compileCellComplex(cube);

    await preloadWorldAssets(world, {
      async createKtx2Loader(): Promise<PreparedKtx2Loader> {
        return {
          loadAsync: ktx2LoadAsync,
          dispose,
        };
      },
    });

    expect(ktx2LoadAsync).toHaveBeenCalled();
    expect(loadGltfAsync.mock.calls.some(([url]) => url.endsWith(".ktx2"))).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps startup alive when an optional floor runtime texture fails to load", async () => {
    const world = compileCellComplex(createSingleFloorWorld());

    const assets = await preloadWorldAssets(world, {
      async createKtx2Loader(): Promise<PreparedKtx2Loader> {
        return {
          loadAsync: async () => {
            throw new Error("simulated ktx2 failure");
          },
          dispose() {},
        };
      },
    });

    expect(assets.getTexture("textures/forest_leaves_02_4k/runtime/forest_leaves_02_color.ktx2")).toBeUndefined();
  });
});

function createSingleFloorWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "floor-room",
        heightMeters: 4,
        baseVertices: [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: 1, y: 1 },
          { x: -1, y: 1 },
        ],
        portals: [],
        visuals: {
          floorMaterial: {
            kind: "floor-texture",
            name: "grass1",
            floorColor: "#5b8f48",
            tileSizeMeters: 60,
            colorTexturePath: "textures/forest_leaves_02_4k/runtime/forest_leaves_02_color.ktx2",
          },
        },
      },
    ],
  };
}
