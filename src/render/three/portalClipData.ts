/**
 * CPU side of the per-path clip-plane texture that lets the GPU clip each portal instance to its visible aperture.
 *
 * Every visible path carries 4 world-space clip planes `(nx, ny, nz, d)` (see `VisiblePortalPath.clipPlanes`), inside
 * where `n . X + d >= 0`. The planes live in a float RGBA data texture of width `portalClipPlaneTextureWidth` (1024):
 * texel `t` sits at `(t % 1024, floor(t / 1024))` and holds one plane in its RGBA channels. The texel of plane `p`
 * (0..3) of clip slot `s` for eye `e` is `portalClipPlaneTexelIndex(s, e, p, eyeCount)`. A path's slot is its rank
 * among the paths of the union over all eyes (one eye: ascending path id; several eyes: round-robin over the eyes'
 * lists, see `rankStereoUnionPaths`), so one slot addresses the same path in every eye;
 * a union path that one eye does not see is fully clipped in that eye ("always outside" planes).
 *
 * Capacity: `maxClipSlots = maxVisiblePaths * maxClipTextureEyes` slots, and each eye holds at most `maxVisiblePaths`
 * paths, so the union always fits. If it ever does not, the surplus paths get no slot, are counted in
 * `visiblePathOverflowCount`, and the caller must not instance them (a path is never drawn with an unknown clip).
 * Consumed by `portalClipMaterial` (vertex shader fetch) and `renderPortalInstances`; rewritten every frame by
 * `update` / `updateStereo`. Sampling uses NEAREST filtering, no mipmaps.
 */

import * as THREE from "three";
import { rankStereoUnionPaths } from "./portalEyeFrameTransforms";
import type { VisiblePortalPath } from "./visiblePortalPaths";

/** Texels per row of the clip-plane texture. */
export const portalClipPlaneTextureWidth = 1024;

/** Inside tolerance in meters added to every plane distance in the shader. */
export const portalClipEpsilonMeters = 1e-5;

/** Number of planes per path. */
const planesPerPath = 4;

/** Texel holding plane `plane` (0..3) of clip slot `slot` for eye `eye`. */
export function portalClipPlaneTexelIndex(slot: number, eye: number, plane: number, eyeCount: number): number {
  return (slot * eyeCount + eye) * planesPerPath + plane;
}

/** Writes the 4 "always inside" planes `(0, 0, 0, 1)` into `out` starting at `offset`. */
export function writeAlwaysInsidePlanes(out: Float32Array | Float64Array, offset: number): void {
  for (let plane = 0; plane < planesPerPath; plane += 1) {
    out[offset + plane * 4] = 0;
    out[offset + plane * 4 + 1] = 0;
    out[offset + plane * 4 + 2] = 0;
    out[offset + plane * 4 + 3] = 1;
  }
}

/** Writes the 4 "always outside" planes `(0, 0, 0, -1)` into `out` starting at `offset`. */
export function writeAlwaysOutsidePlanes(out: Float32Array | Float64Array, offset: number): void {
  for (let plane = 0; plane < planesPerPath; plane += 1) {
    out[offset + plane * 4] = 0;
    out[offset + plane * 4 + 1] = 0;
    out[offset + plane * 4 + 2] = 0;
    out[offset + plane * 4 + 3] = -1;
  }
}

/** The clip-plane texture together with its layout parameters and the per-frame path-to-slot bookkeeping. */
export interface PortalClipData {
  /** Float RGBA texture (see module header for layout); owned by this object and freed by `dispose`. */
  readonly texture: THREE.DataTexture;
  /** Number of clip slots: `maxVisiblePaths * maxClipTextureEyes`. */
  readonly maxClipSlots: number;
  /** Maximum number of distinct paths per eye. */
  readonly maxVisiblePaths: number;
  /** Number of eyes whose planes are stored (eyes beyond this are ignored on update). */
  readonly maxClipTextureEyes: number;
  /** Texture height in rows: `ceil(maxClipSlots * eyes * 4 / 1024)`, at least 1. */
  readonly textureRows: number;
  /** Path id to clip slot for the latest update; paths without a slot are absent. */
  readonly clipIndexByPathId: ReadonlyMap<number, number>;
  /** Inverse of `clipIndexByPathId`: path id at each clip slot, in rank order (ascending id for one eye). */
  readonly pathIdByClipIndex: readonly number[];
  /** Path ids that received a slot in the latest update (the keys of `clipIndexByPathId`). */
  readonly acceptedPathIds: ReadonlySet<number>;
  /** The accepted paths in rank order (slot order); the first eye's entry is kept for a path several eyes see. */
  readonly rankedAcceptedPaths: readonly VisiblePortalPath[];
  /** How many union paths found no slot in the latest update; 0 by construction. */
  readonly visiblePathOverflowCount: number;
  /** Single-eye update; equivalent to `updateStereo([paths])`. */
  update(paths: readonly VisiblePortalPath[]): void;
  /** Rebuilds the whole texture and index maps from per-eye visible paths (index 0 = eye 0); uploads on next render. */
  updateStereo(pathsByEye: readonly (readonly VisiblePortalPath[])[]): void;
  /** Releases the GPU texture. */
  dispose(): void;
}

/**
 * Allocates the clip-plane texture and returns an updatable `PortalClipData`.
 *
 * `maxVisiblePaths` is clamped to >= 0 and `maxClipTextureEyes` to >= 1 (default 2, for stereo). Memory is allocated
 * once; each update rewrites only the texels of the slots in use.
 */
export function createPortalClipData(options: {
  readonly maxVisiblePaths: number;
  readonly maxClipTextureEyes?: number;
}): PortalClipData {
  const maxVisiblePaths = Math.max(0, options.maxVisiblePaths);
  const maxClipTextureEyes = Math.max(1, options.maxClipTextureEyes ?? 2);
  const maxClipSlots = maxVisiblePaths * maxClipTextureEyes;
  const texelCount = maxClipSlots * maxClipTextureEyes * planesPerPath;
  const textureRows = Math.max(1, Math.ceil(texelCount / portalClipPlaneTextureWidth));
  const data = new Float32Array(textureRows * portalClipPlaneTextureWidth * 4);
  const texture = new THREE.DataTexture(
    data,
    portalClipPlaneTextureWidth,
    textureRows,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.name = "portal-clip-planes";

  let clipIndexByPathId = new Map<number, number>();
  let pathIdByClipIndex: number[] = [];
  let acceptedPathIds = new Set<number>();
  let rankedAcceptedPaths: VisiblePortalPath[] = [];
  let visiblePathOverflowCount = 0;

  return {
    texture,
    maxClipSlots,
    maxVisiblePaths,
    maxClipTextureEyes,
    textureRows,
    get clipIndexByPathId() {
      return clipIndexByPathId;
    },
    get pathIdByClipIndex() {
      return pathIdByClipIndex;
    },
    get acceptedPathIds() {
      return acceptedPathIds;
    },
    get rankedAcceptedPaths() {
      return rankedAcceptedPaths;
    },
    get visiblePathOverflowCount() {
      return visiblePathOverflowCount;
    },
    update(paths) {
      this.updateStereo([paths]);
    },
    updateStereo(pathsByEye) {
      clipIndexByPathId = new Map();
      pathIdByClipIndex = [];
      acceptedPathIds = new Set();
      rankedAcceptedPaths = [];

      // One eye keeps ascending path-id order; several eyes are ranked round-robin so that a full budget drops
      // paths fairly (each eye's own list starts with its root, so both roots keep a slot).
      const ranked =
        pathsByEye.length > 1
          ? rankStereoUnionPaths(pathsByEye)
          : [...new Map((pathsByEye[0] ?? []).map((path) => [path.pathId, path] as const)).values()].sort(
              (left, right) => left.pathId - right.pathId,
            );

      visiblePathOverflowCount = Math.max(0, ranked.length - maxClipSlots);

      for (const path of ranked.slice(0, maxClipSlots)) {
        clipIndexByPathId.set(path.pathId, pathIdByClipIndex.length);
        pathIdByClipIndex.push(path.pathId);
        acceptedPathIds.add(path.pathId);
        rankedAcceptedPaths.push(path);
      }

      // Every (slot, eye) in use starts fully clipped; each eye then overwrites the paths it sees.
      for (let slot = 0; slot < pathIdByClipIndex.length; slot += 1) {
        for (let eye = 0; eye < maxClipTextureEyes; eye += 1) {
          writeEyeSlot(slot, eye, undefined);
        }
      }

      for (let eye = 0; eye < Math.min(pathsByEye.length, maxClipTextureEyes); eye += 1) {
        for (const path of pathsByEye[eye]) {
          const slot = clipIndexByPathId.get(path.pathId);

          if (slot !== undefined) {
            writeEyeSlot(slot, eye, path.clipPlanes);
          }
        }
      }

      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };

  // Writes the 4 plane texels of (slot, eye): the path's planes, or "always outside" when `planes` is undefined.
  function writeEyeSlot(slot: number, eye: number, planes: Float64Array | undefined): void {
    const base = portalClipPlaneTexelIndex(slot, eye, 0, maxClipTextureEyes) * 4;

    if (!planes) {
      writeAlwaysOutsidePlanes(data, base);
      return;
    }

    for (let index = 0; index < planesPerPath * 4; index += 1) {
      data[base + index] = planes[index];
    }
  }
}
