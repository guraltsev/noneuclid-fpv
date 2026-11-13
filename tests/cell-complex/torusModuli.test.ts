/**
 * `tests/cell-complex/torusModuli.test.ts` — unit tier.
 *
 * The reduced modulus of a flat torus (ignoring orientation), the name of its shape, and the one-line relation between a torus and the torus the world started with.
 */
import { describe, expect, it } from "vitest";
import { describeTorusRelation, isSameFlatTorus, reducedTorusModulus, torusShape } from "../../src/cell-complex/deformations/torusModuli";

const params = (skewXMeters: number, depthMeters: number, widthMeters = 15) => ({ widthMeters, skewXMeters, depthMeters });

describe("torus moduli", () => {
  it("reduces moduli", () => {
    const cases: readonly [number, number, number, number][] = [
      [0, 15, 0, 1],
      [15, 15, 0, 1],
      [30, 7.5, 0, 2],
      [7.5, 15, 0.5, 1],
    ];
    for (const [a, b, re, im] of cases) {
      const modulus = reducedTorusModulus(params(a, b));
      expect(modulus.re).toBeCloseTo(re, 9);
      expect(modulus.im).toBeCloseTo(im, 9);
    }
  });

  it("names shapes", () => {
    const name = (a: number, b: number) => torusShape(reducedTorusModulus(params(a, b)));
    expect(name(0, 15)).toBe("square");
    expect(name(0, 30)).toBe("rectangular");
    expect(name(7.5, (15 * Math.sqrt(3)) / 2)).toBe("hexagonal");
    expect(name(30, 7.5)).toBe("rectangular");
    expect(name(4, 15)).toBe("oblique");
    expect(name(7.5, 20)).toBe("rhombic");
  });

  it("relates a torus to the start", () => {
    const start = params(0, 15);
    expect(describeTorusRelation(params(0, 15), start)).toBe("This is the starting torus.");
    expect(describeTorusRelation(params(15, 15), start)).toBe("Same flat torus as the start: 1 Dehn twist.");
    expect(describeTorusRelation(params(30, 15), start)).toBe("Same flat torus as the start: 2 Dehn twists.");
    expect(describeTorusRelation(params(4, 15), start)).toBe("A different flat torus from the start.");
    expect(describeTorusRelation(params(30, 30), params(0, 7.5))).toBe("Same flat torus as the start, marked differently.");
  });

  it("says whether a torus is the same flat torus as the start", () => {
    const start = params(0, 15);
    expect(isSameFlatTorus(params(0, 15), start)).toBe(true);
    expect(isSameFlatTorus(params(15, 15), start)).toBe(true);
    expect(isSameFlatTorus(params(30, 30), params(0, 7.5))).toBe(true);
    expect(isSameFlatTorus(params(4, 15), start)).toBe(false);
    expect(isSameFlatTorus(params(0, 20), start)).toBe(false);
  });
});
