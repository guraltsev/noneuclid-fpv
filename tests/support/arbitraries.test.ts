import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { polygonSignedArea2xy, validatePolygon2xy } from "../../src/math/polygons";
import { lengthVec3 } from "../../src/math/vec3";
import {
  arbConeFanWorldSpec,
  arbConvexPolygon2xy,
  arbCoordinate,
  arbPointInCell,
  arbRigidTransform3,
  arbUnitVec3,
  arbVec3,
  arbYawRadians,
  arbYawRigidTransform3,
  exampleWorldSpecs,
} from "./arbitraries";

describe("arbitraries", () => {
  it("coordinates and vectors are finite and within 100 m", () => {
    fc.assert(
      fc.property(arbCoordinate, arbVec3, (c, v) => {
        expect(Math.abs(c)).toBeLessThanOrEqual(100);
        expect([v.x, v.y, v.z].every((value) => Number.isFinite(value) && Math.abs(value) <= 100)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("unit vectors have length 1", () => {
    fc.assert(fc.property(arbUnitVec3, (v) => Math.abs(lengthVec3(v) - 1) < 1e-12), { numRuns: 200 });
  });

  it("yaw angles are within [-pi, pi]", () => {
    fc.assert(fc.property(arbYawRadians, (yaw) => Math.abs(yaw) <= Math.PI), { numRuns: 200 });
  });

  it("yaw transforms are horizontal pure yaws", () => {
    fc.assert(
      fc.property(arbYawRigidTransform3, (g) => {
        expect(g.translation.z).toBe(0);
        expect(g.rotation.m22).toBe(1);
        expect(g.rotation.m02).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it("general rigid transforms have orthonormal rotations", () => {
    fc.assert(
      fc.property(arbRigidTransform3, ({ rotation: r }) => {
        expect(Math.hypot(r.m00, r.m01, r.m02)).toBeCloseTo(1, 12);
        expect(r.m00 * r.m10 + r.m01 * r.m11 + r.m02 * r.m12).toBeCloseTo(0, 12);
        const det =
          r.m00 * (r.m11 * r.m22 - r.m12 * r.m21) -
          r.m01 * (r.m10 * r.m22 - r.m12 * r.m20) +
          r.m02 * (r.m10 * r.m21 - r.m11 * r.m20);
        expect(det).toBeCloseTo(1, 12);
      }),
      { numRuns: 200 },
    );
  });

  it("convex polygons are counterclockwise and valid", () => {
    fc.assert(
      fc.property(arbConvexPolygon2xy, (polygon) => {
        expect(polygonSignedArea2xy(polygon)).toBeGreaterThan(0);
        validatePolygon2xy(polygon);
      }),
      { numRuns: 200 },
    );
  });

  it("example world specs list ten worlds that compile, and cell points stay inside", () => {
    expect(exampleWorldSpecs).toHaveLength(10);
    const world = compileCellComplex(exampleWorldSpecs[2][1]);
    const cell = world.cells[0];

    fc.assert(
      fc.property(arbPointInCell(cell), (p) =>
        cell.sides.every((side) => (p.x - side.start.x) * side.inwardNormal.x + (p.y - side.start.y) * side.inwardNormal.y > 0),
      ),
      { numRuns: 50 },
    );
  });

  it("cone fan world specs compile", () => {
    fc.assert(
      fc.property(arbConeFanWorldSpec, (spec) => {
        const world = compileCellComplex(spec);

        return world.cells.length >= 3 && world.cells.every((cell) => cell.portals.length === 2);
      }),
      { numRuns: 50 },
    );
  });
});
