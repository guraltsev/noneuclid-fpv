/**
 * `tests/world-assets/groundTint.test.ts` — unit tier.
 *
 * `computeGroundTint` returns an RGBA image over the cell's bounding box: the requested size, texels near the neutral
 * value 128, a darker patch under a static asset, no patch under a creature, and the same bytes on every call.
 */
import { describe, expect, it } from "vitest";
import type { CellObjectSpec } from "../../src/cell-complex/specs";
import { computeGroundTint, groundTintNeutralTexel, groundShadowLengthPerHeight, type GroundTintCell } from "../../src/world-assets/groundTint";

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
    expect([tint.width, tint.height, tint.data.length]).toEqual([192, 192, 192 * 192 * 4]);
    expect([tint.originX, tint.originY, tint.sizeX, tint.sizeY]).toEqual([-5, -4, 10, 8]);
    expect(computeGroundTint(cell([]), { width: 16, height: 8 }).data.length).toBe(16 * 8 * 4);
    let sum = 0;
    for (let index = 1; index < tint.data.length; index += 4) {
      sum += tint.data[index];
    }
    const mean = sum / (192 * 192);
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

describe("long baked shadows", () => {
  const tall: CellObjectSpec = { ...rock, id: "tall", collision: { radius: 0.5, height: 2 } };
  const azimuth = 0; // shadows fall toward +x

  it("darkens the ground along the azimuth and not against it", () => {
    const plain = computeGroundTint(cell([tall]));
    const long = computeGroundTint(cell([tall]), { shadowAzimuthRadians: azimuth });
    const length = 2 * groundShadowLengthPerHeight;
    expect(texelAt(long, length * 0.5, 0)).toBeLessThan(texelAt(plain, length * 0.5, 0) * 0.8);
    expect(texelAt(long, -3, 0)).toBe(texelAt(plain, -3, 0));
    expect(texelAt(long, length * 0.5, 3)).toBe(texelAt(plain, length * 0.5, 3));
    expect(texelAt(long, length + 1.5, 0)).toBe(texelAt(plain, length + 1.5, 0));
  });

  it("is darker at the foot than at the tip and uses the casters passed in", () => {
    const empty = cell([]);
    const caster = { x: -4, y: 0, radiusMeters: 0.4, heightMeters: 3 };
    const plain = computeGroundTint(empty);
    const long = computeGroundTint(empty, { shadowAzimuthRadians: azimuth, casters: [caster] });
    const foot = texelAt(long, -3.7, 0) / texelAt(plain, -3.7, 0);
    const tip = texelAt(long, -4 + 3 * groundShadowLengthPerHeight - 0.3, 0) / texelAt(plain, -4 + 3 * groundShadowLengthPerHeight - 0.3, 0);
    expect(foot).toBeLessThan(tip);
    expect(tip).toBeLessThan(0.9);
    expect(computeGroundTint(empty, { casters: [caster] }).data).toEqual(plain.data);
  });

  it("gives an authored object without a collision height a height of 2.5 radii", () => {
    const bare: CellObjectSpec = { id: "bare", kind: "asset", assetPath: "x.gltf", position: { x: -4, y: 0, z: 0 } };
    const plain = computeGroundTint(cell([bare]));
    const long = computeGroundTint(cell([bare]), { shadowAzimuthRadians: azimuth });
    // radius 0.35, height 0.875, shadow 0.96 m long: dark just past the contact disc, nothing 3 m away.
    expect(texelAt(long, -3.3, 0)).toBeLessThan(texelAt(plain, -3.3, 0));
    expect(texelAt(long, -1, 0)).toBe(texelAt(plain, -1, 0));
  });
});
