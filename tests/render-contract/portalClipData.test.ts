import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPortalClipData } from "../../src/render/three/portalClipData";
import { createRootVisiblePortalPath } from "../../src/render/three/renderPortalInstances";
import type { VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";

describe("portal clip data", () => {
  it("preserves clip polygons by path id and assigns compact clip indexes", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 4, maxClipVerticesPerPath: 8 });
    const path = createVisiblePath(7, [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ]);

    clipData.update([createRootVisiblePortalPath("room-a"), path]);

    expect(clipData.clipIndexByPathId.get(0)).toBe(0);
    expect(clipData.clipIndexByPathId.get(7)).toBe(1);
    expect(clipData.pathIdByClipIndex).toEqual([0, 7]);
    expect(clipData.polygonVertexCountsByPathId.get(7)).toBe(4);
    expect(readTexturePixel(clipData.texture, 1, 0)).toEqual([-0.5, -0.5, 4, 7]);
    expect(readTexturePixel(clipData.texture, 1, 2)).toEqual([0.5, 0.5, 4, 7]);

    clipData.dispose();
  });

  it("reports oversized polygons without assigning a draw-outside clip row", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 4, maxClipVerticesPerPath: 3 });
    const path = createVisiblePath(3, [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ]);

    clipData.update([path]);

    expect(clipData.polygonVertexCountsByPathId.get(3)).toBe(4);
    expect(clipData.polygonVertexOverflowPathIds).toEqual([3]);
    expect(clipData.clipIndexByPathId.has(3)).toBe(false);

    clipData.dispose();
  });

  it("reports visible path overflow against the configured clip budget", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 1, maxClipVerticesPerPath: 8 });

    clipData.update([createRootVisiblePortalPath("room-a"), createVisiblePath(1)]);

    expect(clipData.visiblePathOverflowCount).toBe(1);
    expect(clipData.clipIndexByPathId.has(1)).toBe(false);

    clipData.dispose();
  });

  it("stores stereo clip polygons in stable per-eye rows for the same path id", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 4, maxClipVerticesPerPath: 8 });
    const leftPath = createVisiblePath(7, [
      { x: -0.75, y: -0.5 },
      { x: -0.25, y: -0.5 },
      { x: -0.25, y: 0.5 },
      { x: -0.75, y: 0.5 },
    ]);
    const rightPath = createVisiblePath(7, [
      { x: 0.25, y: -0.5 },
      { x: 0.75, y: -0.5 },
      { x: 0.75, y: 0.5 },
      { x: 0.25, y: 0.5 },
    ]);

    clipData.updateStereo([[leftPath], [rightPath]]);

    expect(clipData.clipIndexByPathId.get(7)).toBe(0);
    expect(readTexturePixel(clipData.texture, 0, 0)).toEqual([-0.75, -0.5, 4, 7]);
    expect(readTexturePixel(clipData.texture, 4, 0)).toEqual([0.25, -0.5, 4, 7]);

    clipData.dispose();
  });
});

function createVisiblePath(
  pathId: number,
  clipPolygonNdc: VisiblePortalPath["clipPolygonNdc"] = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ],
): VisiblePortalPath {
  return {
    pathId,
    destinationCellId: "room-b",
    depth: 1,
    rootFromDestinationMatrix: new THREE.Matrix4(),
    clipPolygonNdc,
    clipRectNdc: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    screenAreaPixels: 1,
  };
}

function readTexturePixel(texture: THREE.DataTexture, row: number, column: number): readonly number[] {
  const data = texture.image.data as unknown as Float32Array;
  const offset = (row * texture.image.width + column) * 4;
  return Array.from(data.slice(offset, offset + 4));
}
