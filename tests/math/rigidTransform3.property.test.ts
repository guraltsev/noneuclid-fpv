import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  composeRigidTransform3,
  invertRigidTransform3,
  transformDirection3,
  transformPoint3,
  yawRigidTransform3,
} from "../../src/math/rigidTransform3";
import { distanceVec3, dotVec3, lengthVec3, vec3, type Vec3 } from "../../src/math/vec3";
import { arbRigidTransform3, arbVec3, arbYawRadians } from "../support/arbitraries";

const runs = { numRuns: 200 };

function scaleOf(...vectors: readonly Vec3[]): number {
  return 1 + vectors.reduce((sum, v) => sum + lengthVec3(v), 0);
}

function expectNear(a: Vec3, b: Vec3, tolerance: number): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(a.z - b.z)).toBeLessThanOrEqual(tolerance);
}

describe("rigid transform properties", () => {
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

  it("keeps a fixed example consistent", () => {
    const p = transformPoint3(yawRigidTransform3(Math.PI / 2, vec3(1, 0, 0)), vec3(1, 0, 0));

    expectNear(p, vec3(1, 1, 0), 1e-12);
  });
});
