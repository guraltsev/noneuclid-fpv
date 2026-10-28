/**
 * CPU side of the per-path clip-polygon texture that lets the GPU clip each portal instance to its visible aperture.
 *
 * The texture is a float RGBA data texture of width `maxClipVerticesPerPath` and height
 * `max(1, maxVisiblePaths) * maxClipTextureEyes`. Row `eye * max(1, maxVisiblePaths) + clipIndex` stores one convex
 * NDC polygon: texel v holds (x, y) = NDC vertex v, z = vertex count, w = path id (padding texels are (0,0)). A
 * path's `clipIndex` is its rank among the accepted paths of the union over all eyes, so one index addresses the
 * same path in every eye's row block. Paths exceeding the row budget or the vertex budget get no index and are
 * rendered fully clipped. Sampling uses NEAREST filtering, no mipmaps. Consumed by `portalClipMaterial` and
 * `renderPortalInstances`; rewritten every frame by `update` / `updateStereo`.
 */

import * as THREE from "three";
import type { Vec2, VisiblePortalPath } from "./visiblePortalPaths";

/** Default width of the clip texture: polygons with more than 8 vertices are not representable and get hidden. */
export const defaultMaxClipVerticesPerPath = 8;

/** The clip-polygon texture together with its layout parameters and the per-frame path-to-row bookkeeping. */
export interface PortalClipData {
  /** Float RGBA texture (see module header for layout); owned by this object and freed by `dispose`. */
  readonly texture: THREE.DataTexture;
  /** Maximum number of distinct paths per eye that can receive a clip row. */
  readonly maxVisiblePaths: number;
  /** Texture width: maximum polygon vertices per path. */
  readonly maxClipVerticesPerPath: number;
  /** Number of eye row blocks allocated in the texture (eyes beyond this are ignored on update). */
  readonly maxClipTextureEyes: number;
  /** Total texture height in rows. */
  readonly clipTextureRows: number;
  /** Path id to clip row index (within one eye block) for the latest update; paths without a slot are absent. */
  readonly clipIndexByPathId: ReadonlyMap<number, number>;
  /** Inverse of `clipIndexByPathId`: path id at each clip index, in ascending path-id order. */
  readonly pathIdByClipIndex: readonly number[];
  /** Largest polygon vertex count seen per path id across eyes in the latest update (including paths that were rejected). */
  readonly polygonVertexCountsByPathId: ReadonlyMap<number, number>;
  /** Accepted-by-budget paths whose polygon exceeded `maxClipVerticesPerPath` and were therefore hidden. */
  readonly polygonVertexOverflowPathIds: readonly number[];
  /** How many union paths exceeded `maxVisiblePaths` and got no slot in the latest update. */
  readonly visiblePathOverflowCount: number;
  /** Single-eye update; equivalent to `updateStereo([paths])`. */
  update(paths: readonly VisiblePortalPath[]): void;
  /** Rebuilds the whole texture and index maps from per-eye visible paths (index 0 = eye 0); uploads on next render. */
  updateStereo(pathsByEye: readonly (readonly VisiblePortalPath[])[]): void;
  /** Releases the GPU texture. */
  dispose(): void;
}

/**
 * Allocates the clip texture and returns an updatable `PortalClipData`.
 *
 * `maxVisiblePaths` is clamped to >= 0 and `maxClipTextureEyes` to >= 1 (default 2, for stereo). Memory is
 * `rows * maxClipVerticesPerPath * 16` bytes, allocated once; each update zero-fills it and rewrites only the rows used.
 */
export function createPortalClipData(options: {
  readonly maxVisiblePaths: number;
  readonly maxClipVerticesPerPath?: number;
  readonly maxClipTextureEyes?: number;
}): PortalClipData {
  const maxVisiblePaths = Math.max(0, options.maxVisiblePaths);
  const maxClipVerticesPerPath = options.maxClipVerticesPerPath ?? defaultMaxClipVerticesPerPath;
  const maxClipTextureEyes = Math.max(1, options.maxClipTextureEyes ?? 2);
  const clipTextureRows = Math.max(1, maxVisiblePaths) * maxClipTextureEyes;
  const data = new Float32Array(clipTextureRows * maxClipVerticesPerPath * 4);
  const texture = new THREE.DataTexture(
    data,
    maxClipVerticesPerPath,
    clipTextureRows,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.name = "portal-clip-data";

  let clipIndexByPathId = new Map<number, number>();
  let pathIdByClipIndex: number[] = [];
  let polygonVertexCountsByPathId = new Map<number, number>();
  let polygonVertexOverflowPathIds: number[] = [];
  let visiblePathOverflowCount = 0;

  return {
    texture,
    maxVisiblePaths,
    maxClipVerticesPerPath,
    maxClipTextureEyes,
    clipTextureRows,
    get clipIndexByPathId() {
      return clipIndexByPathId;
    },
    get pathIdByClipIndex() {
      return pathIdByClipIndex;
    },
    get polygonVertexCountsByPathId() {
      return polygonVertexCountsByPathId;
    },
    get polygonVertexOverflowPathIds() {
      return polygonVertexOverflowPathIds;
    },
    get visiblePathOverflowCount() {
      return visiblePathOverflowCount;
    },
    update(paths) {
      this.updateStereo([paths]);
    },
    updateStereo(pathsByEye) {
      data.fill(0);
      clipIndexByPathId = new Map();
      pathIdByClipIndex = [];
      polygonVertexCountsByPathId = new Map();
      polygonVertexOverflowPathIds = [];
      const unionPathsById = new Map<number, VisiblePortalPath>();

      for (const paths of pathsByEye) {
        for (const path of paths) {
          if (!unionPathsById.has(path.pathId)) {
            unionPathsById.set(path.pathId, path);
          }

          polygonVertexCountsByPathId.set(
            path.pathId,
            Math.max(polygonVertexCountsByPathId.get(path.pathId) ?? 0, path.clipPolygonNdc.length),
          );
        }
      }

      const unionPaths = [...unionPathsById.values()].sort((left, right) => left.pathId - right.pathId);
      visiblePathOverflowCount = Math.max(0, unionPaths.length - maxVisiblePaths);
      const acceptedPaths = unionPaths.slice(0, maxVisiblePaths);

      for (const path of acceptedPaths) {
        if ((polygonVertexCountsByPathId.get(path.pathId) ?? 0) > maxClipVerticesPerPath) {
          polygonVertexOverflowPathIds.push(path.pathId);
          continue;
        }

        const clipIndex = pathIdByClipIndex.length;
        clipIndexByPathId.set(path.pathId, clipIndex);
        pathIdByClipIndex.push(path.pathId);
      }

      const acceptedPathIds = new Set(pathIdByClipIndex);

      for (let eyeIndex = 0; eyeIndex < Math.min(pathsByEye.length, maxClipTextureEyes); eyeIndex += 1) {
        const rowOffset = eyeIndex * Math.max(1, maxVisiblePaths);

        for (const path of pathsByEye[eyeIndex]) {
          if (!acceptedPathIds.has(path.pathId)) {
            continue;
          }

          const clipIndex = clipIndexByPathId.get(path.pathId);

          if (clipIndex === undefined || path.clipPolygonNdc.length > maxClipVerticesPerPath) {
            continue;
          }

          writePolygonRow(data, maxClipVerticesPerPath, rowOffset + clipIndex, path.pathId, path.clipPolygonNdc);
        }
      }

      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };
}

// Writes one polygon into texture row `clipIndex` (already includes the eye's row offset); every texel of the row
// carries the vertex count and path id, so shaders can read the count from texel 0.
function writePolygonRow(
  data: Float32Array,
  maxClipVerticesPerPath: number,
  clipIndex: number,
  pathId: number,
  polygon: readonly Vec2[],
): void {
  for (let vertexIndex = 0; vertexIndex < maxClipVerticesPerPath; vertexIndex += 1) {
    const vertex = polygon[vertexIndex] ?? { x: 0, y: 0 };
    const offset = (clipIndex * maxClipVerticesPerPath + vertexIndex) * 4;
    data[offset] = vertex.x;
    data[offset + 1] = vertex.y;
    data[offset + 2] = polygon.length;
    data[offset + 3] = pathId;
  }
}
