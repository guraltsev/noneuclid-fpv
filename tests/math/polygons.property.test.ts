import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classifyPointInPolygon2xy, polygonSignedArea2xy } from "../../src/math/polygons";
import { transformPoint3, yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { arbConvexPolygon2xy, arbYawRadians } from "../support/arbitraries";

const runs = { numRuns: 200 };

describe("polygon properties", () => {
  it("reversing the vertex order negates the signed area", () => {
    fc.assert(
      fc.property(arbConvexPolygon2xy, (polygon) => {
        const reversed = { vertices: polygon.vertices.slice().reverse() };
        const area = polygonSignedArea2xy(polygon);

        expect(Math.abs(polygonSignedArea2xy(reversed) + area)).toBeLessThanOrEqual(1e-9 * Math.abs(area) + 1e-9);
      }),
      runs,
    );
  });

  it("signed area is invariant under a yaw rigid motion", () => {
    fc.assert(
      fc.property(arbConvexPolygon2xy, arbYawRadians, (polygon, yaw) => {
        const g = yawRigidTransform3(yaw, vec3(3, -2, 0));
        const moved = {
          vertices: polygon.vertices.map((v) => {
            const p = transformPoint3(g, vec3(v.x, v.y, 0));

            return { x: p.x, y: p.y };
          }),
        };
        const area = polygonSignedArea2xy(polygon);

        expect(Math.abs(polygonSignedArea2xy(moved) - area)).toBeLessThanOrEqual(1e-9 * area + 1e-9);
      }),
      runs,
    );
  });

  it("classifies the vertex average as inside and every vertex as boundary", () => {
    fc.assert(
      fc.property(arbConvexPolygon2xy, (polygon) => {
        const n = polygon.vertices.length;
        const average = {
          x: polygon.vertices.reduce((sum, v) => sum + v.x, 0) / n,
          y: polygon.vertices.reduce((sum, v) => sum + v.y, 0) / n,
        };

        expect(classifyPointInPolygon2xy(polygon, average)).toBe("inside");
        for (const vertex of polygon.vertices) {
          expect(classifyPointInPolygon2xy(polygon, vertex)).toBe("boundary");
        }
      }),
      runs,
    );
  });
});
