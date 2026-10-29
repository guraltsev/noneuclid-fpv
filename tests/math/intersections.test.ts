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

  it("hits for a 1e-10 m segment that straddles the plane", () => {
    const result = intersectSegmentWithPlane(vec3(0, -5e-11, 0), vec3(0, 5e-11, 0), floor);

    expect(result.kind).toBe("point");
    expect(result.kind === "point" ? Math.abs(result.t - 0.5) : 1).toBeLessThan(1e-6);
  });

  it("does not report a hit for a segment entirely 1e-9 m above the plane", () => {
    // Both ends are within the tolerance of the plane and on the same side, so the result is coplanar.
    expect(intersectSegmentWithPlane(vec3(0, 1e-9, 0), vec3(0, 1.5e-9, 0), floor).kind).toBe("coplanar");
  });

  it("hits at t = 0 or 1 for a long segment touching the plane at one end", () => {
    const atStart = intersectSegmentWithPlane(vec3(0, 0, 0), vec3(0, 100, 0), floor);
    const atEnd = intersectSegmentWithPlane(vec3(0, 100, 0), vec3(0, 0, 0), floor);

    expect(atStart.kind === "point" ? atStart.t : -1).toBe(0);
    expect(atEnd.kind === "point" ? atEnd.t : -1).toBe(1);
  });
});
