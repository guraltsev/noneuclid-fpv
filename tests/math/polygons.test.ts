/**
 * `tests/math/polygons.test.ts` — unit tier.
 *
 * `Polygon2xy` is a cell's base polygon: vertices in counter-clockwise order, strictly convex, 3-8 of them
 * (`_docs/MATHEMATICAL_MODEL.md` §2). These tests check the signed area (positive exactly for a counter-clockwise
 * winding), the point classification used by collision and authoring code (inside, outside, boundary), and the
 * validation that rejects a clockwise winding or too few vertices. The properties state the two invariants that
 * `validateCellComplexSpec` relies on: reversing the winding negates the area, and a rigid motion leaves it
 * unchanged.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classifyPointInPolygon2xy,
  polygonSignedArea2xy,
  validatePolygon2xy,
  type Polygon2xy,
} from "../../src/math/polygons";
import { transformPoint3, yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { arbConvexPolygon2xy, arbYawRadians } from "../support/arbitraries";

describe("polygons", () => {
  const square: Polygon2xy = {
    vertices: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
  };

  it("computes signed area in the x/y plane", () => {
    expect(polygonSignedArea2xy(square)).toBe(4);
  });

  it("classifies inside, outside, edge, and vertex points", () => {
    expect(classifyPointInPolygon2xy(square, { x: 0, y: 0 })).toBe("inside");
    expect(classifyPointInPolygon2xy(square, { x: 2, y: 0 })).toBe("outside");
    expect(classifyPointInPolygon2xy(square, { x: 1, y: 0 })).toBe("boundary");
    expect(classifyPointInPolygon2xy(square, { x: -1, y: -1 })).toBe("boundary");
  });

  it("accepts counterclockwise polygons and rejects invalid bases", () => {
    expect(() => validatePolygon2xy(square)).not.toThrow();
    expect(() => validatePolygon2xy({ vertices: square.vertices.slice().reverse() })).toThrow(/counterclockwise/);
    expect(() => validatePolygon2xy({ vertices: square.vertices.slice(0, 2) })).toThrow(/at least three/);
  });

  describe("properties", () => {
    const runs = { numRuns: 100 };

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
});
