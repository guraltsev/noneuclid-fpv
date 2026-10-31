/**
 * `tests/math/planes.test.ts` — unit tier.
 *
 * A `Plane` is a normalized normal and offset, built from a point and a normal direction
 * (`_docs/MATHEMATICAL_MODEL.md` §1, §2: a cell side's clearance uses the same signed-distance idea). These tests
 * check the signed distance from a point to the plane and the three-way classification (front, back, or within
 * `geometryTolerance` of the plane) that collision and portal code use to decide which side of a boundary a point
 * is on.
 */
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
