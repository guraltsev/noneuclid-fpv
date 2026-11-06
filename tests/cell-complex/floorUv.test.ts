/**
 * `tests/cell-complex/floorUv.test.ts` — unit tier.
 *
 * Floor textures are mapped either to a fixed world lattice (shared across cells, so a texture does not slide as
 * the floor deforms, §9) or to a per-cell metric scale (one tile every `tileSizeMeters`). These tests check the
 * lattice UV computation against its inverse frame, the metric UV scale, and that the tile count a cell spans is
 * always rounded to a whole number of at least one.
 */
import { describe, expect, it } from "vitest";
import { floorLatticeUv, floorMetricUv, floorPatchField, floorPatchSamples, floorTilesAlong } from "../../src/cell-complex/floorUv";
import { createTorusSkewDeformationFamily } from "../../src/cell-complex/deformations/torusSkewDeformation";
import { torusModuli } from "../../src/authoring/exampleWorlds";

const family = createTorusSkewDeformationFamily();
const states: readonly (readonly [number, number])[] = [[0, 15], [4, 15], [9, 20], [15, 15], [20, 12], [30, 7.5], [0, 30], [0, 7.5]];
const frameAt = (a: number, b: number) =>
  family.floorUvFrames!(torusModuli, { kind: "torus-skew", cellId: "torus-room", widthMeters: 15, depthMeters: b, skewXMeters: a }).get("torus-room")!;
const mod1 = (x: number) => x - Math.floor(x);
const circ = (x: number, y: number) => {
  const d = Math.abs(mod1(x) - mod1(y));
  return Math.min(d, 1 - d);
};
const points: { x: number; y: number }[] = [];
for (let i = 0; -11 + i * 1.37 <= 11; i += 1) {
  for (let j = 0; -11 + j * 1.37 <= 11; j += 1) points.push({ x: -11 + i * 1.37, y: -11 + j * 1.37 });
}
type Samples = ReturnType<typeof floorPatchSamples>;
const sorted = (samples: Samples) => [...samples].sort((p, q) => q.weight - p.weight || p.uv[0] - q.uv[0]);
const near = (p: Samples, q: Samples, tol = 1e-9) => {
  const sp = sorted(p);
  const sq = sorted(q);
  expect(sp.length).toBe(sq.length);
  sp.forEach((sample, i) => {
    expect(Math.abs(sample.weight - sq[i].weight)).toBeLessThan(tol);
    expect(circ(sample.uv[0], sq[i].uv[0])).toBeLessThan(tol);
    expect(circ(sample.uv[1], sq[i].uv[1])).toBeLessThan(tol);
  });
};

describe("floor UVs", () => {
  it("computes lattice UVs from the inverse lattice frame", () => {
    const rest = { origin: { x: -7.5, y: -7.5 }, u: { x: 15, y: 0 }, v: { x: 0, y: 15 }, tilesAlongU: 6, tilesAlongV: 6, restU: { x: 15, y: 0 }, restV: { x: 0, y: 15 } };
    const [s, t] = floorLatticeUv(rest, { x: 6, y: 3 });
    expect(s).toBeCloseTo(5.4, 9);
    expect(t).toBeCloseTo(4.2, 9);
    const skewed = { origin: { x: -22.5, y: -3.75 }, u: { x: 15, y: 0 }, v: { x: 30, y: 7.5 }, tilesAlongU: 6, tilesAlongV: 6, restU: { x: 15, y: 0 }, restV: { x: 30, y: 7.5 } };
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

  it("paints the rest floor at rest", () => {
    const frame = frameAt(0, 15);
    const field = floorPatchField(frame);
    for (const p of points) {
      const expected = floorLatticeUv(frame, p);
      for (const sample of floorPatchSamples(field, p)) {
        expect(circ(sample.uv[0], expected[0])).toBeLessThan(1e-9);
        expect(circ(sample.uv[1], expected[1])).toBeLessThan(1e-9);
      }
    }
  });

  it("paints the rest floor again after a Dehn twist", () => {
    const restField = floorPatchField(frameAt(0, 15));
    for (const a of [15, 30]) {
      const field = floorPatchField(frameAt(a, 15));
      for (const p of points) near(floorPatchSamples(field, p), floorPatchSamples(restField, p));
    }
  });

  it("keeps patches rigid at every state", () => {
    const fields = states.map(([a, b]) => floorPatchField(frameAt(a, b)));
    for (const f of fields) {
      expect(f.metersToUvRow1).toEqual(fields[0].metersToUvRow1);
      expect(f.metersToUvRow2).toEqual(fields[0].metersToUvRow2);
    }
    for (const f of fields) {
      for (const p of points) {
        const s1 = sorted(floorPatchSamples(f, p))[0];
        const s2 = sorted(floorPatchSamples(f, { x: p.x + 0.01, y: p.y }))[0];
        if (s1.weight > 0.9 && s2.weight > 0.9) {
          expect(s2.uv[0] - s1.uv[0]).toBeCloseTo(0.01 * f.metersToUvRow1.x, 9);
          expect(s2.uv[1] - s1.uv[1]).toBeCloseTo(0.01 * f.metersToUvRow2.x, 9);
        }
      }
    }
  });

  it("is seamless across u and v", () => {
    for (const [a, b] of states) {
      const frame = frameAt(a, b);
      const field = floorPatchField(frame);
      for (const p of points) {
        const base = floorPatchSamples(field, p);
        near(base, floorPatchSamples(field, { x: p.x + frame.u.x, y: p.y + frame.u.y }));
        near(base, floorPatchSamples(field, { x: p.x + frame.v.x, y: p.y + frame.v.y }));
      }
    }
  });

  it("always paints every point", () => {
    for (const [a, b] of states) {
      const field = floorPatchField(frameAt(a, b));
      for (const p of points) {
        const samples = floorPatchSamples(field, p);
        expect(samples.length).toBeGreaterThan(0);
        expect(Math.abs(samples.reduce((sum, s) => sum + s.weight, 0) - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it("finds every patch that the blend needs", () => {
    for (const [a, b] of states) {
      const field = floorPatchField(frameAt(a, b));
      for (const p of points) {
        const kernels: number[] = [];
        for (let m = -40; m <= 40; m += 1) {
          for (let n = -40; n <= 40; n += 1) {
            const dx = p.x - field.origin.x - m * field.step1.x - n * field.step2.x;
            const dy = p.y - field.origin.y - m * field.step1.y - n * field.step2.y;
            kernels.push(Math.max(1 - (dx * dx + dy * dy) * field.inverseRadiusSquared, 0) ** 16);
          }
        }
        const maxKernel = Math.max(...kernels);
        const floor = 0.02 * maxKernel;
        const kept = kernels.filter((k) => k > floor);
        const sum = kept.reduce((acc, k) => acc + k - floor, 0);
        const samples = floorPatchSamples(field, p);
        // The 3 x 3 search must find exactly the patches of the brute-force blend.
        expect(samples.length).toBe(kept.length);
        expect(Math.abs(Math.max(...samples.map((s) => s.weight)) - (maxKernel - floor) / sum)).toBeLessThan(1e-12);
      }
    }
  });

  it("does not change at a reduced-basis switch", () => {
    for (const a of [7.5, 22.5]) {
      const lo = floorPatchField(frameAt(a - 1e-7, 15));
      const hi = floorPatchField(frameAt(a + 1e-7, 15));
      for (const p of points) {
        const sl = sorted(floorPatchSamples(lo, p));
        const sh = sorted(floorPatchSamples(hi, p));
        expect(sl.length).toBe(sh.length);
        sl.forEach((s, i) => expect(Math.abs(s.weight - sh[i].weight)).toBeLessThan(1e-3));
      }
    }
  });
});
