import { describe, expect, it } from "vitest";
import { getCollisionBounds, getDynamicObjectCollisionBounds, simpleCylinderIntersectsSimpleCylinder } from "../../src/movement/collision";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { identityMat3, yawRigidTransform3, type Mat3 } from "../../src/math/rigidTransform3";

describe("collision bounds", () => {
  it("preserves identity-rotation bounds from the position-based helper", () => {
    const collision = simpleCollisionCylinder(0.4, 0.8, { x: 0.1, y: -0.2, z: 0.3 });
    const object = dynamicObject({ x: 1, y: 2, z: 3 }, identityMat3, collision);

    expect(getDynamicObjectCollisionBounds(object)).toEqual(getCollisionBounds(object.localPose.translation, collision));
  });

  it("returns undefined for objects without collision", () => {
    expect(getDynamicObjectCollisionBounds(dynamicObject({ x: 1, y: 2, z: 3 }, identityMat3, undefined))).toBeUndefined();
  });

  it("keeps zero-offset cylinders centered on object translation", () => {
    const bounds = getDynamicObjectCollisionBounds(
      dynamicObject({ x: 1, y: 2, z: 3 }, yawRigidTransform3(Math.PI / 3).rotation, simpleCollisionCylinder(0.4, 0.8)),
    );

    expect(bounds?.center).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("rotates explicit offsets into cell-local coordinates", () => {
    const bounds = getDynamicObjectCollisionBounds(
      dynamicObject(
        { x: 1, y: 2, z: 3 },
        yawRigidTransform3(Math.PI / 2).rotation,
        simpleCollisionCylinder(0.1, 0.2, { x: 0.4, y: 0, z: 0.1 }),
      ),
    );

    expect(bounds?.center.x).toBeCloseTo(1);
    expect(bounds?.center.y).toBeCloseTo(2.4);
    expect(bounds?.center.z).toBeCloseTo(3.1);
  });

  it("does not expand the cylinder footprint when the object rotates", () => {
    const bounds = getDynamicObjectCollisionBounds(
      dynamicObject({ x: 0, y: 0, z: 0 }, yawRigidTransform3(Math.PI / 4).rotation, simpleCollisionCylinder(0.8, 0.4)),
    );

    expect(bounds?.radius).toBeCloseTo(0.8);
    expect(bounds?.halfHeight).toBeCloseTo(0.2);
  });
});

describe("simpleCylinderIntersectsSimpleCylinder", () => {
  it("uses strict horizontal radius and vertical interval overlap", () => {
    expect(simpleCylinderIntersectsSimpleCylinder(cylinder(0, 0, 0, 0.5, 0.5), cylinder(1.1, 0, 0, 0.5, 0.5))).toBe(false);
    expect(simpleCylinderIntersectsSimpleCylinder(cylinder(0, 0, 0, 0.5, 0.5), cylinder(0.9, 0, 0, 0.5, 0.5))).toBe(true);
    expect(simpleCylinderIntersectsSimpleCylinder(cylinder(0, 0, 0, 0.5, 0.5), cylinder(1, 0, 0, 0.5, 0.5))).toBe(false);
    expect(simpleCylinderIntersectsSimpleCylinder(cylinder(0, 0, 0, 0.5, 0.5), cylinder(0, 0, 1, 0.5, 0.5))).toBe(false);
  });
});

function dynamicObject(
  translation: { readonly x: number; readonly y: number; readonly z: number },
  rotation: Mat3,
  collision: DynamicObjectState["collision"],
): DynamicObjectState {
  return {
    cellId: "cell",
    localPose: { rotation, translation },
    collision,
  };
}

function cylinder(x: number, y: number, z: number, radius: number, halfHeight: number) {
  return {
    center: { x, y, z },
    radius,
    halfHeight,
  };
}
