/**
 * `tests/math/rigidTransform3.test.ts` — unit tier.
 *
 * A `RigidTransform3` is a pair \((R, t)\) acting as \(g\cdot p = Rp + t\) on points and \(g\cdot d = Rd\) on
 * directions; composition applies the second argument first, `composeRigidTransform3(a, b)` meaning "a after b"
 * (`_docs/MATHEMATICAL_MODEL.md` §1). These tests check that convention with a worked numeric example, that
 * points and directions are distinguished (a direction ignores translation), and that `orthonormalizeYawRigidTransform3`
 * repairs a yaw rotation matrix drifted by floating-point error back to \(R^\top R = I\) while keeping its angle —
 * the repair applied after every portal crossing (§5) so that \(10^5\) crossings of a reciprocal pair stay near
 * machine precision. The properties state the group laws (associativity, inverse, distance and dot-product
 * preservation) that every caller of composition and inversion relies on.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  orthonormalizeYawRigidTransform3,
  rigidTransform3,
  transformDirection3,
  transformPoint3,
  yawRigidTransform3,
} from "../../src/math/rigidTransform3";
import { almostEqualVec3, distanceVec3, dotVec3, lengthVec3, vec3, type Vec3 } from "../../src/math/vec3";
import { arbRigidTransform3, arbVec3, arbYawRadians } from "../support/arbitraries";

function scaleOf(...vectors: readonly Vec3[]): number {
  return 1 + vectors.reduce((sum, v) => sum + lengthVec3(v), 0);
}

function expectNear(a: Vec3, b: Vec3, tolerance: number): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(a.z - b.z)).toBeLessThanOrEqual(tolerance);
}

describe("rigidTransform3", () => {
  it("preserves points and directions with the identity transform", () => {
    expect(transformPoint3(identityRigidTransform3, vec3(1, 2, 3))).toEqual(vec3(1, 2, 3));
    expect(transformDirection3(identityRigidTransform3, vec3(1, 2, 3))).toEqual(vec3(1, 2, 3));
  });

  it("distinguishes points from directions", () => {
    const transform = rigidTransform3(identityRigidTransform3.rotation, vec3(10, 0, 0));

    expect(transformPoint3(transform, vec3(1, 2, 3))).toEqual(vec3(11, 2, 3));
    expect(transformDirection3(transform, vec3(1, 2, 3))).toEqual(vec3(1, 2, 3));
  });

  it("round-trips points and directions through an inverse transform", () => {
    const transform = yawRigidTransform3(Math.PI / 2, vec3(3, 4, 5));
    const inverse = invertRigidTransform3(transform);
    const point = vec3(1, 2, 3);
    const direction = vec3(0, 1, 0);

    expect(almostEqualVec3(transformPoint3(inverse, transformPoint3(transform, point)), point)).toBe(true);
    expect(almostEqualVec3(transformDirection3(inverse, transformDirection3(transform, direction)), direction)).toBe(
      true,
    );
  });

  it("composes transforms by applying the second transform first", () => {
    const rotate = yawRigidTransform3(Math.PI / 2);
    const translate = rigidTransform3(identityRigidTransform3.rotation, vec3(10, 0, 0));
    const composed = composeRigidTransform3(translate, rotate);

    expect(almostEqualVec3(transformPoint3(composed, vec3(0, 2, 0)), vec3(8, 0, 0))).toBe(true);
    expect(
      almostEqualVec3(
        transformPoint3(composeRigidTransform3(rotate, translate), vec3(0, 2, 0)),
        vec3(-2, 10, 0),
      ),
    ).toBe(true);
  });

  describe("orthonormalizeYawRigidTransform3", () => {
    it("removes a 1e-9 perturbation and preserves the yaw angle", () => {
      const base = yawRigidTransform3(0.7, { x: 1, y: 2, z: 3 });
      const perturbed = {
        ...base,
        rotation: { ...base.rotation, m00: base.rotation.m00 * (1 + 1e-9), m10: base.rotation.m10 * (1 + 1e-9) },
      };
      const r = orthonormalizeYawRigidTransform3(perturbed).rotation;

      expect(Math.abs(r.m00 * r.m00 + r.m10 * r.m10 - 1)).toBeLessThan(1e-15);
      expect(Math.abs(r.m00 * r.m01 + r.m10 * r.m11)).toBeLessThan(1e-15);
      expect(Math.abs(Math.atan2(r.m10, r.m00) - 0.7)).toBeLessThan(1e-12);
      expect(orthonormalizeYawRigidTransform3(perturbed).translation).toEqual({ x: 1, y: 2, z: 3 });
    });

    it("restores Rt R = I when only m00 is perturbed by 1e-9, at yaw 0", () => {
      const base = yawRigidTransform3(0);
      const r = orthonormalizeYawRigidTransform3({ ...base, rotation: { ...base.rotation, m00: 1 + 1e-9 } }).rotation;

      expect(Math.abs(r.m00 * r.m00 + r.m10 * r.m10 - 1)).toBeLessThan(1e-15);
      expect(Math.atan2(r.m10, r.m00)).toBe(0);
    });
  });

  describe("properties", () => {
    const runs = { numRuns: 100 };

    it("g after g^-1 is the identity on points", () => {
      fc.assert(
        fc.property(arbRigidTransform3, arbVec3, (g, p) => {
          const identity = composeRigidTransform3(g, invertRigidTransform3(g));

          expectNear(transformPoint3(identity, p), p, 1e-9 * scaleOf(p, g.translation) * 3);
        }),
        runs,
      );
    });

    it("composition acts as a after b and is associative on points", () => {
      fc.assert(
        fc.property(arbRigidTransform3, arbRigidTransform3, arbRigidTransform3, arbVec3, (a, b, c, p) => {
          const tolerance = 1e-9 * scaleOf(p, a.translation, b.translation, c.translation) * 3;

          expectNear(transformPoint3(composeRigidTransform3(a, b), p), transformPoint3(a, transformPoint3(b, p)), tolerance);
          expectNear(
            transformPoint3(composeRigidTransform3(composeRigidTransform3(a, b), c), p),
            transformPoint3(composeRigidTransform3(a, composeRigidTransform3(b, c)), p),
            tolerance,
          );
        }),
        runs,
      );
    });

    it("preserves distances between points and dot products of directions", () => {
      fc.assert(
        fc.property(arbRigidTransform3, arbVec3, arbVec3, (g, p, q) => {
          const scale = scaleOf(p, q, g.translation);

          expect(
            Math.abs(distanceVec3(transformPoint3(g, p), transformPoint3(g, q)) - distanceVec3(p, q)),
          ).toBeLessThanOrEqual(1e-9 * scale);
          expect(
            Math.abs(dotVec3(transformDirection3(g, p), transformDirection3(g, q)) - dotVec3(p, q)),
          ).toBeLessThanOrEqual(1e-9 * scale * scale);
        }),
        runs,
      );
    });

    it("yaw(a) after yaw(b) equals yaw(a + b) on points", () => {
      fc.assert(
        fc.property(arbYawRadians, arbYawRadians, arbVec3, (a, b, p) => {
          const composed = composeRigidTransform3(yawRigidTransform3(a), yawRigidTransform3(b));

          expectNear(transformPoint3(composed, p), transformPoint3(yawRigidTransform3(a + b), p), 1e-9 * scaleOf(p));
        }),
        runs,
      );
    });
  });
});
