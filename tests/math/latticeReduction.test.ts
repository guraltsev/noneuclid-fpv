/**
 * `tests/math/latticeReduction.test.ts` — unit tier.
 *
 * Lagrange-Gauss reduction of plane lattice bases and the covering radius used to size rigid floor patches.
 */
import { describe, expect, it } from "vitest";
import { latticeCoveringRadius, reduceLatticeBasis } from "../../src/math/latticeReduction";

const states: readonly (readonly [number, number])[] = [[0, 15], [4, 15], [9, 20], [15, 15], [20, 12], [30, 7.5], [0, 30], [0, 7.5]];
const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
const dot = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x * q.x + p.y * q.y;
const upToSign = (v: { x: number; y: number }) => {
  const sign = v.x < 0 || (v.x === 0 && v.y < 0) ? -1 : 1;
  return { x: sign * v.x + 0, y: sign * v.y + 0 };
};

describe("lattice reduction", () => {
  it("reduces the skewed torus bases", () => {
    const a = reduceLatticeBasis({ x: 15, y: 0 }, { x: 30, y: 7.5 });
    expect(len(a.first)).toBeCloseTo(7.5, 9);
    expect(len(a.second)).toBeCloseTo(15, 9);
    const b = reduceLatticeBasis({ x: 15, y: 0 }, { x: 23, y: 9 });
    expect([upToSign(b.first), upToSign(b.second)]).toEqual(expect.arrayContaining([{ x: 7, y: -9 }, { x: 8, y: 9 }]));
    const c = reduceLatticeBasis({ x: 15, y: 0 }, { x: 15, y: 15 });
    expect(len(c.first)).toBeCloseTo(15, 9);
    expect(len(c.second)).toBeCloseTo(15, 9);
  });

  it("keeps the area and the reduction conditions", () => {
    for (const [a, b] of states) {
      const r = reduceLatticeBasis({ x: 15, y: 0 }, { x: a, y: b });
      expect(Math.abs(r.first.x * r.second.y - r.first.y * r.second.x)).toBeCloseTo(15 * b, 9);
      expect(len(r.first)).toBeLessThanOrEqual(len(r.second) + 1e-9);
      expect(2 * Math.abs(dot(r.first, r.second))).toBeLessThanOrEqual(dot(r.first, r.first) + 1e-9);
    }
  });

  it("computes the covering radius", () => {
    expect(latticeCoveringRadius({ first: { x: 2, y: 0 }, second: { x: 0, y: 2 } })).toBeCloseTo(Math.SQRT2, 9);
    expect(latticeCoveringRadius({ first: { x: 1.25, y: 0 }, second: { x: 0, y: 2.5 } })).toBeCloseTo(1.3975, 4);
    expect(latticeCoveringRadius({ first: { x: 1, y: 0 }, second: { x: 0.5, y: Math.sqrt(3) / 2 } })).toBeCloseTo(1 / Math.sqrt(3), 9);
  });
});
