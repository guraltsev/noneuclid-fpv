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
});
