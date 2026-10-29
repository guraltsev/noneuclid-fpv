import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intersectSegmentWithPlane } from "../../src/math/intersections";
import { planeFromPointAndNormal, signedDistanceToPlane } from "../../src/math/planes";
import { addVec3, scaleVec3, subVec3, type Vec3 } from "../../src/math/vec3";
import { arbUnitVec3, arbVec3 } from "../support/arbitraries";

function projectOntoPlane(plane: ReturnType<typeof planeFromPointAndNormal>, point: Vec3): Vec3 {
  return subVec3(point, scaleVec3(plane.normal, signedDistanceToPlane(plane, point)));
}

describe("segment-plane intersection properties", () => {
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
      { numRuns: 200 },
    );
  });
});
