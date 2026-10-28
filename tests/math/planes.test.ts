import { describe, expect, it } from "vitest";
import { classifyPointToPlane, planeFromPointAndNormal, signedDistanceToPlane } from "../../src/math/planes";
import { vec3 } from "../../src/math/vec3";

describe("planes", () => {
  it("computes signed distance using a normalized normal and offset", () => {
    const floor = planeFromPointAndNormal(vec3(0, 0, 0), vec3(0, 2, 0));

    expect(signedDistanceToPlane(floor, vec3(0, 3, 0))).toBe(3);
    expect(signedDistanceToPlane(floor, vec3(0, -2, 0))).toBe(-2);
  });

  it("classifies points with tolerance", () => {
    const ceiling = { normal: vec3(0, -1, 0), offset: 3 };

    expect(classifyPointToPlane(ceiling, vec3(0, 2, 0))).toBe("front");
    expect(classifyPointToPlane(ceiling, vec3(0, 4, 0))).toBe("back");
    expect(classifyPointToPlane(ceiling, vec3(0, 3 + 1e-9, 0))).toBe("boundary");
  });
});
