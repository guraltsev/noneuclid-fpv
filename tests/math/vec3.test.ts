/**
 * `tests/math/vec3.test.ts` — unit tier.
 *
 * `Vec3` is the right-handed, cell-local point/vector type of the whole simulation: x right, y forward, z up
 * (`_docs/MATHEMATICAL_MODEL.md` §1). These tests check the arithmetic primitives (add, subtract, scale, dot, cross,
 * length, distance), that normalizing rejects a vector too short to have a reliable direction, and the algebraic laws
 * (unit length after normalizing, cross orthogonal to both factors, the triangle inequality) that the rest of the
 * geometry code relies on without re-checking.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addVec3,
  almostEqualVec3,
  crossVec3,
  distanceVec3,
  dotVec3,
  lengthVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  vec3,
} from "../../src/math/vec3";
import { arbVec3 } from "../support/arbitraries";

describe("vec3", () => {
  it("adds, subtracts, and scales vectors", () => {
    expect(addVec3(vec3(1, 2, 3), vec3(4, -1, 2))).toEqual(vec3(5, 1, 5));
    expect(subVec3(vec3(1, 2, 3), vec3(4, -1, 2))).toEqual(vec3(-3, 3, 1));
    expect(scaleVec3(vec3(1, -2, 3), 3)).toEqual(vec3(3, -6, 9));
  });

  it("computes dot, cross, length, and distance", () => {
    expect(dotVec3(vec3(1, 2, 3), vec3(4, -1, 2))).toBe(8);
    expect(crossVec3(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
    expect(lengthVec3(vec3(3, 4, 12))).toBe(13);
    expect(distanceVec3(vec3(1, 2, 3), vec3(4, 6, 3))).toBe(5);
  });

  it("normalizes non-zero vectors and rejects near-zero vectors", () => {
    expect(almostEqualVec3(normalizeVec3(vec3(0, 3, 4)), vec3(0, 0.6, 0.8))).toBe(true);
    expect(() => normalizeVec3(vec3(1e-14, 0, 0))).toThrow(/near-zero/);
  });

  describe("properties", () => {
    const runs = { numRuns: 100 };

    it("normalizeVec3 gives unit length or throws for tiny vectors", () => {
      fc.assert(
        fc.property(arbVec3, (v) => {
          if (lengthVec3(v) <= 1e-8) {
            expect(() => normalizeVec3(v)).toThrow();
          } else {
            expect(Math.abs(lengthVec3(normalizeVec3(v)) - 1)).toBeLessThanOrEqual(1e-12);
          }
        }),
        runs,
      );
    });

    it("cross product is orthogonal to both factors", () => {
      fc.assert(
        fc.property(arbVec3, arbVec3, (a, b) => {
          const la = lengthVec3(a);
          const lb = lengthVec3(b);
          const tolerance = 1e-9 * la * lb * Math.max(la, lb, 1) + 1e-12;
          const c = crossVec3(a, b);

          expect(Math.abs(dotVec3(c, a))).toBeLessThanOrEqual(tolerance);
          expect(Math.abs(dotVec3(c, b))).toBeLessThanOrEqual(tolerance);
        }),
        runs,
      );
    });

    it("satisfies the triangle inequality", () => {
      fc.assert(
        fc.property(arbVec3, arbVec3, (a, b) => {
          expect(lengthVec3(addVec3(a, b))).toBeLessThanOrEqual(lengthVec3(a) + lengthVec3(b) + 1e-9);
        }),
        runs,
      );
    });
  });
});
