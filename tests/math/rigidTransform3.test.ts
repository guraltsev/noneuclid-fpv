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
import { almostEqualVec3, vec3 } from "../../src/math/vec3";

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
});

describe("orthonormalizeYawRigidTransform3 at yaw 0", () => {
  it("restores Rt R = I when only m00 is perturbed by 1e-9", () => {
    const base = yawRigidTransform3(0);
    const r = orthonormalizeYawRigidTransform3({ ...base, rotation: { ...base.rotation, m00: 1 + 1e-9 } }).rotation;

    expect(Math.abs(r.m00 * r.m00 + r.m10 * r.m10 - 1)).toBeLessThan(1e-15);
    expect(Math.atan2(r.m10, r.m00)).toBe(0);
  });
});
