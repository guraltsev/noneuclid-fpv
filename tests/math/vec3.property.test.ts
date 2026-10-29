import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addVec3, crossVec3, dotVec3, lengthVec3, normalizeVec3 } from "../../src/math/vec3";
import { arbVec3 } from "../support/arbitraries";

const runs = { numRuns: 200 };

describe("vec3 properties", () => {
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
