/**
 * Fake of `PreparedWorldAssets` (src/render/three/preloadWorldAssets.ts): the read-only lookup the renderer uses
 * during scene construction instead of loading textures and glTF models from disk. Every method returns a fresh
 * placeholder object by default (an empty `THREE.Texture`, a glTF with an empty scene and no animations); pass
 * `overrides` for the methods a test reads or asserts on.
 */
import * as THREE from "three";
import type { PreparedGltfAsset, PreparedWorldAssets } from "../../src/render/three/preparedWorldAssets";

export function createFakePreparedAssets(overrides: Partial<PreparedWorldAssets> = {}): PreparedWorldAssets {
  return {
    getTexture: () => new THREE.Texture(),
    getConfiguredTexture: () => new THREE.Texture(),
    instantiateGltf: (): PreparedGltfAsset => ({ scene: new THREE.Group(), animations: [] }),
    ...overrides,
  };
}
