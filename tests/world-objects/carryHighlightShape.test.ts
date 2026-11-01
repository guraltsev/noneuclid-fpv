/**
 * `tests/world-objects/carryHighlightShape.test.ts` — unit tier.
 *
 * Each carryable object declares its own highlight shape (src/world-objects/carryHighlightShape.ts). The emitter's is a thin ellipsoid hugging the
 * model it draws (pinned to the assets by tests/render/cannonModelBounds.test.ts); an object that declares none gets a sphere from its collision
 * shape, and an object with neither has no highlight.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { carryHighlightMarginMeters, carryHighlightShapeOf, type CarryHighlightShape } from "../../src/world-objects/carryHighlightShape";
import { cannonCarryHighlight, cannonModelHalfExtentsMeters, createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";

// Whether a point of the object's frame lies inside the ellipsoid.
function inside(shape: CarryHighlightShape, point: { x: number; y: number; z: number }): boolean {
  const dx = (point.x - shape.centre.x) / shape.radii.x;
  const dy = (point.y - shape.centre.y) / shape.radii.y;
  const dz = (point.z - shape.centre.z) / shape.radii.z;
  return dx * dx + dy * dy + dz * dz <= 1;
}

describe("the emitter's carry highlight", () => {
  const emitter = createGeodesicCannonObject({ id: "cannon", cellId: "room", localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }) });
  const shape = carryHighlightShapeOf(emitter);

  it("is an ellipsoid, taller than it is wide, declared by the emitter itself", () => {
    expect(emitter.carryHighlight).toBe(cannonCarryHighlight);
    expect(shape?.kind).toBe("ellipsoid");
    expect(shape!.radii.z).toBeGreaterThan(shape!.radii.x);
    expect(shape!.radii.x).toBe(shape!.radii.y);
  });

  it("encloses the model's axis from the floor to its top and its sideways reach at mid height", () => {
    const { x: reach, z: halfHeight } = cannonModelHalfExtentsMeters;

    for (const z of [0, halfHeight, 2 * halfHeight]) {
      expect(inside(shape!, { x: 0, y: 0, z })).toBe(true);
    }
    for (const [x, y] of [[reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
      expect(inside(shape!, { x, y, z: halfHeight })).toBe(true);
    }
  });

  it("follows the drawn model, not the collision cylinder that is much wider", () => {
    const collision = emitter.collision!;

    expect(shape!.radii.x).toBeLessThan(collision.radius);
    expect(shape!.radii.z).toBeLessThan(2 * cannonModelHalfExtentsMeters.z);
    expect(inside(shape!, { x: collision.radius, y: 0, z: collision.height / 2 })).toBe(false);
  });
});

describe("the fallback highlight", () => {
  it("is a sphere of collision radius plus margin for an object that declares none", () => {
    const shape = carryHighlightShapeOf({ collision: { radius: 0.3, offset: { x: 0.1, y: 0, z: 0.8 } } });

    expect(shape).toEqual({
      kind: "ellipsoid",
      centre: { x: 0.1, y: 0, z: 0.8 },
      radii: { x: 0.3 + carryHighlightMarginMeters, y: 0.3 + carryHighlightMarginMeters, z: 0.3 + carryHighlightMarginMeters },
    });
  });

  it("has none for an object with neither a declared shape nor a collision shape", () => {
    expect(carryHighlightShapeOf({})).toBeUndefined();
  });
});