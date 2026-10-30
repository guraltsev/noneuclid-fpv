import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createPortalClipData,
  portalClipPlaneTextureWidth,
  portalClipPlaneTexelIndex,
  writeAlwaysInsidePlanes,
  writeAlwaysOutsidePlanes,
} from "../../src/render/three/portalClipData";
import { createRootVisiblePortalPath, omitPathsWithoutClipSlot } from "../../src/render/three/renderPortalInstances";
import type { VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";

describe("portal clip data", () => {
  it("lays planes out by slot, eye and plane index", () => {
    expect(portalClipPlaneTexelIndex(3, 1, 2, 2)).toBe(30);
    expect(portalClipPlaneTexelIndex(0, 0, 0, 2)).toBe(0);
    expect(portalClipPlaneTexelIndex(0, 1, 3, 2)).toBe(7);

    const clipData = createPortalClipData({ maxVisiblePaths: 2000 });

    expect(clipData.maxClipSlots).toBe(4000);
    expect(clipData.textureRows).toBe(32);
    expect(clipData.texture.image.width).toBe(portalClipPlaneTextureWidth);
    expect(clipData.texture.image.width).toBe(1024);
    expect(clipData.texture.image.height).toBe(32);

    clipData.dispose();
  });

  it("assigns compact clip slots by path id and stores the path's planes", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 4 });
    const planes = distinctPlanes(7);

    clipData.update([createRootVisiblePortalPath("room-a"), createVisiblePath(7, planes)]);

    expect(clipData.clipIndexByPathId.get(0)).toBe(0);
    expect(clipData.clipIndexByPathId.get(7)).toBe(1);
    expect(clipData.pathIdByClipIndex).toEqual([0, 7]);
    expect(readPlanes(clipData, 1, 0, 2)).toEqual(Array.from(planes));
    // Root path: always inside.
    expect(readPlanes(clipData, 0, 0, 2)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

    clipData.dispose();
  });

  it("clips a union path fully in the eyes that do not see it", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 4 });
    const eye0 = [createVisiblePath(1, distinctPlanes(1)), createVisiblePath(2, distinctPlanes(2))];
    const eye1 = [createVisiblePath(2, distinctPlanes(12)), createVisiblePath(3, distinctPlanes(13))];

    clipData.updateStereo([eye0, eye1]);

    expect(clipData.clipIndexByPathId.get(1)).toBe(0);
    expect(clipData.clipIndexByPathId.get(2)).toBe(1);
    expect(clipData.clipIndexByPathId.get(3)).toBe(2);
    expect(clipData.visiblePathOverflowCount).toBe(0);
    // Path 3 is not seen by eye 0.
    expect(readPlanes(clipData, 2, 0, 2)).toEqual([0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1]);
    expect(readPlanes(clipData, 2, 1, 2)).toEqual(Array.from(distinctPlanes(13)));
    // Path 1 is not seen by eye 1; path 2 has per-eye planes.
    expect(readPlanes(clipData, 0, 1, 2)).toEqual([0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1]);
    expect(readPlanes(clipData, 1, 0, 2)).toEqual(Array.from(distinctPlanes(2)));
    expect(readPlanes(clipData, 1, 1, 2)).toEqual(Array.from(distinctPlanes(12)));

    clipData.dispose();
  });

  it("clears stale planes when the visible set shrinks", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 4 });

    clipData.updateStereo([[createVisiblePath(1, distinctPlanes(1)), createVisiblePath(2, distinctPlanes(2))], []]);
    clipData.updateStereo([[createVisiblePath(2, distinctPlanes(5))], []]);

    expect(clipData.pathIdByClipIndex).toEqual([2]);
    expect(readPlanes(clipData, 0, 0, 2)).toEqual(Array.from(distinctPlanes(5)));
    expect(readPlanes(clipData, 0, 1, 2)).toEqual([0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1]);

    clipData.dispose();
  });

  it("gives every path of the union of two full eyes a slot", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 2000 });
    const eye0 = Array.from({ length: 2000 }, (_, index) => createVisiblePath(index));
    const eye1 = Array.from({ length: 2000 }, (_, index) => createVisiblePath(2000 + index));

    clipData.updateStereo([eye0, eye1]);

    expect(clipData.clipIndexByPathId.size).toBe(4000);
    expect(clipData.visiblePathOverflowCount).toBe(0);
    expect(clipData.clipIndexByPathId.get(3999)).toBe(3999);

    clipData.dispose();
  });

  it("never maps a visible path of the union to clip index -1", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 3 });
    const eye0 = [createVisiblePath(1), createVisiblePath(2), createVisiblePath(3)];
    const eye1 = [createVisiblePath(4), createVisiblePath(5), createVisiblePath(6)];

    clipData.updateStereo([eye0, eye1]);

    const union = [...eye0, ...eye1];
    const grouped = new Map([["room-b", union]]);

    expect(omitPathsWithoutClipSlot(grouped, clipData.clipIndexByPathId)).toBe(grouped);
    for (const path of union) {
      expect(clipData.clipIndexByPathId.get(path.pathId)).toBeGreaterThanOrEqual(0);
    }

    clipData.dispose();
  });

  it("counts surplus paths and removes them from the instance list instead of drawing them clipped", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 1, maxClipTextureEyes: 1 });
    const paths = [createVisiblePath(1), createVisiblePath(2), createVisiblePath(3)];

    clipData.update(paths);

    expect(clipData.visiblePathOverflowCount).toBe(2);
    expect(clipData.clipIndexByPathId.size).toBe(1);

    const filtered = omitPathsWithoutClipSlot(new Map([["room-b", paths]]), clipData.clipIndexByPathId);

    expect(filtered.get("room-b")?.map((path) => path.pathId)).toEqual([1]);

    clipData.dispose();
  });

  it("provides always-inside and always-outside plane rows", () => {
    const out = new Float32Array(16);

    writeAlwaysInsidePlanes(out, 0);
    expect(Array.from(out)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    writeAlwaysOutsidePlanes(out, 0);
    expect(Array.from(out)).toEqual([0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1]);
  });
});

function distinctPlanes(seed: number): Float64Array {
  const planes = new Float64Array(16);

  for (let plane = 0; plane < 4; plane += 1) {
    planes[plane * 4] = seed + plane;
    planes[plane * 4 + 1] = 0.5 * plane;
    planes[plane * 4 + 2] = -0.25 * seed;
    planes[plane * 4 + 3] = plane + 0.125;
  }

  return planes;
}

function createVisiblePath(
  pathId: number,
  clipPlanes: Float64Array = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
): VisiblePortalPath {
  return {
    pathId,
    destinationCellId: "room-b",
    depth: 1,
    rootFromDestinationMatrix: new THREE.Matrix4(),
    clipPlanes,
    terminal: false,
    clipPolygonNdc: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    clipRectNdc: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    screenAreaPixels: 1,
  };
}

// The 16 numbers (4 planes) of (slot, eye), read through the texel index function.
function readPlanes(
  clipData: ReturnType<typeof createPortalClipData>,
  slot: number,
  eye: number,
  eyeCount: number,
): number[] {
  const data = clipData.texture.image.data as unknown as Float32Array;
  const result: number[] = [];

  for (let plane = 0; plane < 4; plane += 1) {
    const texel = portalClipPlaneTexelIndex(slot, eye, plane, eyeCount);
    const x = texel % portalClipPlaneTextureWidth;
    const y = Math.floor(texel / portalClipPlaneTextureWidth);
    const offset = (y * portalClipPlaneTextureWidth + x) * 4;

    result.push(...Array.from(data.slice(offset, offset + 4)));
  }

  return result;
}
