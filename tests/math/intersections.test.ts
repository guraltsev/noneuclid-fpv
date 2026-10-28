import { describe, expect, it } from "vitest";
import { intersectSegmentWithPlane } from "../../src/math/intersections";
import { type Plane } from "../../src/math/planes";
import { vec3 } from "../../src/math/vec3";

describe("intersections", () => {
  const floor: Plane = { normal: vec3(0, 1, 0), offset: 0 };

  it("finds a segment-plane crossing", () => {
    expect(intersectSegmentWithPlane(vec3(0, -1, 0), vec3(0, 1, 0), floor)).toEqual({
      kind: "point",
      t: 0.5,
      point: vec3(0, 0, 0),
    });
  });

  it("reports endpoint hits", () => {
    expect(intersectSegmentWithPlane(vec3(1, 0, 0), vec3(1, 2, 0), floor)).toEqual({
      kind: "point",
      t: 0,
      point: vec3(1, 0, 0),
    });
  });

  it("distinguishes parallel misses and coplanar segments", () => {
    expect(intersectSegmentWithPlane(vec3(0, 1, 0), vec3(2, 1, 0), floor)).toEqual({ kind: "none" });
    expect(intersectSegmentWithPlane(vec3(0, 0, 0), vec3(2, 0, 0), floor)).toEqual({ kind: "coplanar" });
  });
});
