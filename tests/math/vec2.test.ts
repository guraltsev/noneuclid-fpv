import { describe, expect, it } from "vitest";
import { addVec2, crossVec2, crossXY, dotVec2, lengthVec2, scaleVec2, subVec2 } from "../../src/math/vec2";
import { distanceSquaredVec3 } from "../../src/math/vec3";

describe("vec2", () => {
  it("computes the planar cross product", () => {
    expect(crossXY(1, 0, 0, 1)).toBe(1);
    expect(crossVec2({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(-2);
  });

  it("computes dot product and length", () => {
    expect(dotVec2({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
    expect(lengthVec2({ x: 3, y: 4 })).toBe(5);
  });

  it("adds, subtracts and scales", () => {
    expect(subVec2({ x: 3, y: 4 }, { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
    expect(addVec2({ x: 3, y: 4 }, { x: 1, y: 1 })).toEqual({ x: 4, y: 5 });
    expect(scaleVec2({ x: 3, y: 4 }, 2)).toEqual({ x: 6, y: 8 });
  });

  it("computes squared 3-D distance", () => {
    expect(distanceSquaredVec3({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 })).toBe(25);
  });
});
