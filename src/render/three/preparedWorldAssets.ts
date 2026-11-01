/**
 * The synchronous lookup of preloaded textures and glTF scenes that the scene builders and object views read, and its owner's view.
 * Declarations only; `preloadWorldAssets` fills them. They live apart from it so that the modules it preloads for (rover, portal wall, geodesic ray models) can name the lookup without importing the loader.
 */
import type * as THREE from "three";

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
