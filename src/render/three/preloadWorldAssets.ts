/**
 * Asset preloading and instancing for the Three.js renderer.
 *
 * Gathers every texture and glTF path referenced by the compiled world (floor textures, cell objects, placed flags,
 * geodesic ray models, the player rover), downloads them in parallel before the scene is built, and returns a read-only
 * {@link PreparedWorldAssets} lookup used synchronously during scene construction. Texture loader choice depends on the file
 * extension (KTX2, EXR, common image formats); anything else is treated as glTF. Floor colour textures are optional (a failed
 * load is tolerated) whereas every other loaded asset is required and rejects the whole preload. The portal wall
 * texture is generated in code, not loaded.
 * glTF scenes are cloned per instance with skeleton-aware cloning; geometries and materials stay shared with the preloaded
 * original. Nothing is freed until the owner calls `dispose()` on the returned {@link OwnedPreparedWorldAssets}.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { publicAssetUrl } from "../../glue/assetUrls";
import { createPortalWallDataTexture, PORTAL_WALL_TEXTURE_KEY } from "./portalWallTexture";
import { placedFlagAssetPaths } from "../../world-objects/placedFlags";
import { geodesicRayAssetPaths } from "./geodesicCannonRenderer";
import { playerRoverAssetPath } from "./playerRoverModel";
import { runtimeDiagnostics } from "./runtimeDiagnostics";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/** Describes a derived texture variant: a preloaded source texture plus colour space, tiling and wrapping. */
export interface PreparedTextureRequest {
  /** Asset path of the already-preloaded source image. */
  readonly assetPath: string;
  /** Colour space assigned to the cloned texture (e.g. sRGB for colour maps, none for data maps). */
  readonly colorSpace: THREE.ColorSpace;
  /** Texture repeat count along u. */
  readonly repeatX: number;
  /** Texture repeat count along v. */
  readonly repeatY: number;
  /** Horizontal wrapping; defaults to clamp-to-edge. */
  readonly wrapS?: THREE.Wrapping;
  /** Vertical wrapping; defaults to clamp-to-edge. */
  readonly wrapT?: THREE.Wrapping;
  /** Optional texture name; part of the cache key. */
  readonly name?: string;
  /** Optional metadata copied onto the texture; JSON-serialised into the cache key. */
  readonly userData?: Record<string, unknown>;
}

/** A fresh instance of a preloaded glTF: its scene graph and animation clips. */
export interface PreparedGltfAsset {
  /** Cloned scene root, owned by the caller; geometries and materials are shared with the preloaded original. */
  readonly scene: THREE.Object3D;
  /** Animation clips of the source glTF (shared, not cloned). */
  readonly animations: readonly THREE.AnimationClip[];
}

/** Synchronous lookup of everything {@link preloadWorldAssets} loaded. */
export interface PreparedWorldAssets {
  /** Returns the raw preloaded texture for `assetPath`, or `undefined` if it was not loaded (e.g. an optional texture that failed). Shared, do not mutate or dispose. */
  getTexture(assetPath: string): THREE.Texture | undefined;
  /** Returns a cached clone of the preloaded texture with the requested colour space, wrapping, repeat, name and userData; `undefined` if the source is missing. Equal requests share one instance. */
  getConfiguredTexture(request: PreparedTextureRequest): THREE.Texture | undefined;
  /** Returns a new clone of the preloaded glTF scene for `assetPath`, or `undefined` if it was not preloaded. */
  instantiateGltf(assetPath: string): PreparedGltfAsset | undefined;
}

/** The owner's view of {@link PreparedWorldAssets}: whoever called {@link preloadWorldAssets} must call `dispose()` once. */
export interface OwnedPreparedWorldAssets extends PreparedWorldAssets {
  /**
   * Frees the GPU resources of every loaded texture, every configured texture clone, and the geometries, materials and
   * textures of every preloaded glTF. Call only after the app that used the assets has been disposed; a second call is
   * a no-op. Lookups after disposal still return objects, but three would have to upload them again.
   */
  dispose(): void;
}

/** Loader category chosen for an asset path from its extension. */
export type AssetPreloadKind = "texture" | "texture-exr" | "texture-ktx2" | "gltf";

/** Minimal KTX2 loader surface (injectable for tests) that must be disposed when done. */
export interface PreparedKtx2Loader {
  readonly loadAsync: (url: string) => Promise<THREE.Texture>;
  readonly dispose: () => void;
}

/** Options for {@link preloadWorldAssets}. */
export interface PreloadWorldAssetsOptions {
  /** Factory for the KTX2 loader; called only if some asset is a .ktx2 file. Defaults to one backed by a throwaway low-power WebGL renderer for format detection. */
  readonly createKtx2Loader?: () => Promise<PreparedKtx2Loader>;
}

/**
 * Lists the unique asset paths needed by `world`.
 *
 * Includes floor material textures (colour, normal, bump, roughness) and every cell object's asset, plus the fixed
 * placed-flag, geodesic-ray and player-rover assets. Does not include the portal wall texture, which is generated in code.
 */
export function collectWorldAssetPaths(world: CompiledCellComplex): readonly string[] {
  const assetPaths = new Set<string>();

  for (const cell of world.cells) {
    if (cell.floorMaterial.kind === "floor-texture") {
      for (const assetPath of [
        cell.floorMaterial.colorTexturePath,
        cell.floorMaterial.normalTexturePath,
        cell.floorMaterial.bumpTexturePath,
        cell.floorMaterial.roughnessTexturePath,
      ]) {
        if (assetPath) {
          assetPaths.add(assetPath);
        }
      }
    }

    for (const object of cell.objects) {
      assetPaths.add(object.assetPath);
    }
  }

  for (const assetPath of [
    ...Object.values(placedFlagAssetPaths),
    ...Object.values(geodesicRayAssetPaths),
    playerRoverAssetPath,
  ]) {
    assetPaths.add(assetPath);
  }

  return [...assetPaths];
}

/**
 * Maps an asset path to the loader category by file extension (case-insensitive).
 *
 * `.ktx2` and `.exr` have dedicated loaders, avif/jpg/jpeg/png/webp are plain textures, and everything else is assumed to be glTF.
 */
export function classifyAssetPreloadKind(assetPath: string): AssetPreloadKind {
  if (/\.ktx2$/i.test(assetPath)) {
    return "texture-ktx2";
  }

  if (/\.exr$/i.test(assetPath)) {
    return "texture-exr";
  }

  if (/\.(avif|jpe?g|png|webp)$/i.test(assetPath)) {
    return "texture";
  }

  return "gltf";
}

/**
 * Downloads all textures and glTF models required by `world` and returns a synchronous lookup for them.
 *
 * All loads run concurrently and are reported to the runtime diagnostics. Rejects on the first failure of a required asset;
 * failures of optional floor colour textures are reported to diagnostics and skipped. The KTX2 loader, if created, is disposed
 * even on failure. Textures are cached by asset path (loaded once even if referenced repeatedly).
 */
export async function preloadWorldAssets(
  world: CompiledCellComplex,
  options: PreloadWorldAssetsOptions = {},
): Promise<OwnedPreparedWorldAssets> {
  const diagnostics = runtimeDiagnostics();
  const textures = new Map<string, THREE.Texture>();
  const configuredTextures = new Map<string, THREE.Texture>();
  const gltfs = new Map<string, GLTF>();
  let disposed = false;
  const assetPaths = collectWorldAssetPaths(world);
  const optionalTexturePaths = collectOptionalFloorTexturePaths(world);
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const exrLoader = new EXRLoader();
  const createKtx2Loader = options.createKtx2Loader ?? createRuntimeKtx2Loader;
  const hasKtx2Assets = assetPaths.some((assetPath) => classifyAssetPreloadKind(assetPath) === "texture-ktx2");
  const ktx2Loader = hasKtx2Assets ? await createKtx2Loader() : undefined;

  try {
    await Promise.all([
      ...assetPaths.map((assetPath) => {
        const optional = optionalTexturePaths.has(assetPath);
        const kind = classifyAssetPreloadKind(assetPath);

        switch (kind) {
          case "texture":
            return loadTextureAsset(assetPath, textureLoader, textures, diagnostics, optional);
          case "texture-exr":
            return loadTextureAsset(assetPath, exrLoader, textures, diagnostics, optional);
          case "texture-ktx2":
            if (!ktx2Loader) {
              throw new Error(`KTX2 texture loader was not initialized for ${assetPath}.`);
            }

            return loadTextureAsset(assetPath, ktx2Loader, textures, diagnostics, optional);
          case "gltf":
            diagnostics.recordPreloadStart(assetPath, "gltf");
            return gltfLoader.loadAsync(publicAssetUrl(assetPath)).then(
              (gltf) => {
                gltfs.set(assetPath, gltf);
                diagnostics.recordPreloadComplete(assetPath, "gltf");
                return gltf;
              },
              (error: unknown) => {
                diagnostics.recordPreloadError(assetPath, "gltf", error);
                throw error;
              },
            );
        }
      }),
    ]);
  } finally {
    ktx2Loader?.dispose();
  }

  // The portal wall map is generated, not downloaded; registering it here lets dispose() free it with the rest.
  textures.set(PORTAL_WALL_TEXTURE_KEY, createPortalWallDataTexture());

  return {
    getTexture(assetPath) {
      return textures.get(assetPath);
    },
    getConfiguredTexture(request) {
      const preparedTexture = textures.get(request.assetPath);

      if (!preparedTexture) {
        return undefined;
      }

      // Variants are cached per full configuration so identical requests share one cloned texture.
      const cacheKey = [
        request.assetPath,
        request.colorSpace,
        request.repeatX,
        request.repeatY,
        request.wrapS ?? THREE.ClampToEdgeWrapping,
        request.wrapT ?? THREE.ClampToEdgeWrapping,
        request.name ?? "",
        JSON.stringify(request.userData ?? {}),
      ].join("|");
      const cachedTexture = configuredTextures.get(cacheKey);

      if (cachedTexture) {
        return cachedTexture;
      }

      const texture = preparedTexture.clone();
      texture.colorSpace = request.colorSpace;
      texture.wrapS = request.wrapS ?? THREE.ClampToEdgeWrapping;
      texture.wrapT = request.wrapT ?? THREE.ClampToEdgeWrapping;
      texture.repeat.set(request.repeatX, request.repeatY);

      if (request.name) {
        texture.name = request.name;
      }

      if (request.userData) {
        texture.userData = { ...request.userData };
      }

      texture.needsUpdate = true;
      configuredTextures.set(cacheKey, texture);
      return texture;
    },
    instantiateGltf(assetPath) {
      const gltf = gltfs.get(assetPath);

      if (!gltf) {
        return undefined;
      }

      return {
        scene: cloneSkeleton(gltf.scene),
        animations: gltf.animations,
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const texture of [...textures.values(), ...configuredTextures.values()]) {
        texture.dispose();
      }
      for (const gltf of gltfs.values()) {
        disposeGltfScene(gltf.scene);
      }
    },
  };
}

// Frees every geometry, material and material texture (any texture-valued property, not only `map`) under a glTF scene.
function disposeGltfScene(scene: THREE.Object3D): void {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    child.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}

// Only floor colour textures are optional; normal/bump/roughness maps are still treated as required.
function collectOptionalFloorTexturePaths(world: CompiledCellComplex): ReadonlySet<string> {
  const optionalTexturePaths = new Set<string>();

  for (const cell of world.cells) {
    if (cell.floorMaterial.kind === "floor-texture" && cell.floorMaterial.colorTexturePath) {
      optionalTexturePaths.add(cell.floorMaterial.colorTexturePath);
    }
  }

  return optionalTexturePaths;
}

// Loads a texture; records diagnostics and rethrows on error, but resolves to undefined on failure when `optional`.
async function loadTextureAsset(
  assetPath: string,
  loader: { loadAsync(url: string): Promise<THREE.Texture> },
  textures: Map<string, THREE.Texture>,
  diagnostics: ReturnType<typeof runtimeDiagnostics>,
  optional: boolean,
): Promise<THREE.Texture | undefined> {
  diagnostics.recordPreloadStart(assetPath, "texture");
  return loader.loadAsync(publicAssetUrl(assetPath)).then(
    (texture) => {
      textures.set(assetPath, texture);
      diagnostics.recordPreloadComplete(assetPath, "texture");
      return texture;
    },
    (error: unknown) => {
      diagnostics.recordPreloadError(assetPath, "texture", error);

      if (optional) {
        return undefined;
      }

      throw error;
    },
  );
}

// A WebGLRenderer is needed only so KTX2Loader can detect supported GPU compressed formats.
async function createRuntimeKtx2Loader(): Promise<PreparedKtx2Loader> {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "low-power",
  });
  const loader = new KTX2Loader();
  loader.setTranscoderPath(publicAssetUrl("ktx2/"));
  loader.detectSupport(renderer);

  return {
    loadAsync(url) {
      return loader.loadAsync(url);
    },
    dispose() {
      loader.dispose();
      renderer.dispose();
    },
  };
}
