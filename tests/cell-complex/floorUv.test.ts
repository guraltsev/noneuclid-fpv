import { describe, expect, it } from "vitest";
import { floorLatticeUv, floorMetricUv, floorTilesAlong } from "../../src/cell-complex/floorUv";

describe("floor UVs", () => {
  it("computes lattice UVs from the inverse lattice frame", () => {
    const rest = { origin: { x: -7.5, y: -7.5 }, u: { x: 15, y: 0 }, v: { x: 0, y: 15 }, tilesAlongU: 6, tilesAlongV: 6 };
    const [s, t] = floorLatticeUv(rest, { x: 6, y: 3 });
    expect(s).toBeCloseTo(5.4, 9);
    expect(t).toBeCloseTo(4.2, 9);
    const skewed = { origin: { x: -22.5, y: -3.75 }, u: { x: 15, y: 0 }, v: { x: 30, y: 7.5 }, tilesAlongU: 6, tilesAlongV: 6 };
    const [s2, t2] = floorLatticeUv(skewed, { x: 12, y: 1.5 });
    expect(s2).toBeCloseTo(5.4, 9);
    expect(t2).toBeCloseTo(4.2, 9);
  });

  it("computes metric UVs with one tile per tileSizeMeters", () => {
    expect(floorMetricUv({ x: 8, y: -2 }, 4)).toEqual([2, -0.5]);
    expect(floorMetricUv({ x: 8, y: -2 }, 0)).toEqual([8, -2]);
  });

  it("rounds the tile count to a whole number of at least one", () => {
    expect(floorTilesAlong(15, 2.667)).toBe(6);
    expect(floorTilesAlong(15, 40)).toBe(1);
    expect(floorTilesAlong(15, 0)).toBe(1);
  });
});
