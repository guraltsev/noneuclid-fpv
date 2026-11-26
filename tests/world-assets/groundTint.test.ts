/**
 * `tests/world-assets/groundTint.test.ts` — unit tier.
 *
 * `computeGroundTint` returns an RGBA image over the cell's bounding box: the requested size, texels near the neutral
 * value 128, a darker patch under a static asset, no patch under a creature, and the same bytes on every call.
 */
import { describe, expect, it } from "vitest";
import type { CellObjectSpec } from "../../src/cell-complex/specs";
import { computeGroundTint, groundTintNeutralTexel, type GroundTintCell } from "../../src/world-assets/groundTint";

function cell(objects: readonly CellObjectSpec[]): GroundTintCell {
  return {
    id: "tint-cell",
    baseVertices: [
      { x: -5, y: -4 },
      { x: 5, y: -4 },
      { x: 5, y: 4 },
      { x: -5, y: 4 },
    ],
    floorMaterial: { kind: "floor-color", floorColor: "#888888" },
    objects,
  };
}

const rock: CellObjectSpec = {
  id: "rock",
  kind: "asset",
  assetPath: "rock.gltf",
  position: { x: 0, y: 0, z: 0 },
  collision: { radius: 1, height: 1 },
};
const mouse: CellObjectSpec = {
  id: "mouse",
  kind: "geo-mouse",
  assetPath: "mouse.gltf",
  position: { x: 0, y: 0, z: 0 },
  speedMetersPerSecond: 1,
  oscillationRateHz: 1,
  oscillationMagnitudeMeters: 0.1,
  collision: { radius: 1, height: 1 },
};

function texelAt(tint: ReturnType<typeof computeGroundTint>, x: number, y: number): number {
  const column = Math.min(tint.width - 1, Math.floor(((x - tint.originX) / tint.sizeX) * tint.width));
  const row = Math.min(tint.height - 1, Math.floor(((y - tint.originY) / tint.sizeY) * tint.height));
  return tint.data[(row * tint.width + column) * 4 + 1];
}

describe("computeGroundTint", () => {
  it("covers the bounding box at the requested size, near neutral", () => {
    const tint = computeGroundTint(cell([]));
    expect([tint.width, tint.height, tint.data.length]).toEqual([128, 128, 128 * 128 * 4]);
    expect([tint.originX, tint.originY, tint.sizeX, tint.sizeY]).toEqual([-5, -4, 10, 8]);
    expect(computeGroundTint(cell([]), { width: 16, height: 8 }).data.length).toBe(16 * 8 * 4);
    let sum = 0;
    for (let index = 1; index < tint.data.length; index += 4) {
      sum += tint.data[index];
    }
    const mean = sum / (128 * 128);
    expect(mean).toBeGreaterThan(groundTintNeutralTexel * 0.85);
    expect(mean).toBeLessThan(groundTintNeutralTexel * 1.15);
    expect(tint.data[3]).toBe(255);
  });

  it("is deterministic", () => {
    expect(computeGroundTint(cell([rock])).data).toEqual(computeGroundTint(cell([rock])).data);
  });

  it("darkens the ground under a static asset but not under a creature", () => {
    const empty = computeGroundTint(cell([]));
    const withRock = computeGroundTint(cell([rock]));
    const withMouse = computeGroundTint(cell([mouse]));
    expect(texelAt(withRock, 0, 0)).toBeLessThan(texelAt(empty, 0, 0) * 0.75);
    expect(texelAt(withRock, 4.5, 3.5)).toBe(texelAt(empty, 4.5, 3.5));
    expect(withMouse.data).toEqual(empty.data);
  });
});
