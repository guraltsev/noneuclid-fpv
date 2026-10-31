/**
 * `tests/math/intersections.test.ts` — unit tier.
 *
 * `intersectSegmentWithPlane` finds where a segment crosses a plane, within `geometryTolerance`
 * (`_docs/MATHEMATICAL_MODEL.md` §1, §10); it underlies the developed-segment walk that decides which side a body
 * or geodesic crosses next (§4). These tests check the three outcomes (a crossing point, a parallel miss, and a
 * coplanar segment), that a crossing within `geometryTolerance` of either endpoint still reports `t = 0` or `t = 1`,
 * and the property that a segment with endpoints strictly on opposite sides always reports a crossing inside it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intersectSegmentWithPlane } from "../../src/math/intersections";
import { planeFromPointAndNormal, signedDistanceToPlane, type Plane } from "../../src/math/planes";
import { addVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../../src/math/vec3";
import { arbUnitVec3, arbVec3 } from "../support/arbitraries";

function projectOntoPlane(plane: Plane, point: Vec3): Vec3 {
  return subVec3(point, scaleVec3(plane.normal, signedDistanceToPlane(plane, point)));
}

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

  describe("properties", () => {
    it("a segment with endpoints on opposite sides hits the plane inside the segment", () => {
      const arbDistance = fc.double({ min: 1e-3, max: 100, noNaN: true });

      fc.assert(
        fc.property(arbVec3, arbUnitVec3, arbVec3, arbVec3, arbDistance, arbDistance, (origin, normal, a, b, da, db) => {
          const plane = planeFromPointAndNormal(origin, normal);
          // Endpoints are built from points on the plane, pushed to opposite sides along the normal.
          const start = addVec3(projectOntoPlane(plane, a), scaleVec3(plane.normal, da));
          const end = subVec3(projectOntoPlane(plane, b), scaleVec3(plane.normal, db));

          fc.pre(signedDistanceToPlane(plane, start) >= 1e-3 && signedDistanceToPlane(plane, end) <= -1e-3);

          const result = intersectSegmentWithPlane(start, end, plane);

          expect(result.kind).toBe("point");
          if (result.kind === "point") {
            expect(result.t).toBeGreaterThanOrEqual(0);
            expect(result.t).toBeLessThanOrEqual(1);
            expect(Math.abs(signedDistanceToPlane(plane, result.point))).toBeLessThanOrEqual(1e-9 * 300);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
