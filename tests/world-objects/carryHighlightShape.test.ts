/**
 * `tests/world-objects/carryHighlightShape.test.ts` — unit tier.
 *
 * Each carryable object declares its own highlight shape (src/world-objects/carryHighlightShape.ts). The emitter's is an ellipsoid around its
 * whole post; an object that declares none gets a sphere from its collision shape, and an object with neither has no highlight.
 */
import { describe, expect, it } from "vitest";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { carryHighlightMarginMeters, carryHighlightShapeOf, type CarryHighlightShape } from "../../src/world-objects/carryHighlightShape";
import { cannonCarryHighlight, createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";

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

  it("encloses the post from floor to top, and the collision cylinder's axis and mid rim", () => {
    const collision = emitter.collision!;
    const postHeightMeters = 1.7;

    for (const z of [0, 0.5, 1, postHeightMeters]) {
      expect(inside(shape!, { x: 0, y: 0, z })).toBe(true);
    }
    // The collision cylinder stands on the floor (its offset is half its height), so its axis runs from 0 to its height.
    for (const z of [0, collision.height]) {
      expect(inside(shape!, { x: 0, y: 0, z })).toBe(true);
    }
    const midHeight = collision.height / 2;
    for (const [x, y] of [[collision.radius, 0], [-collision.radius, 0], [0, collision.radius], [0, -collision.radius]]) {
      expect(inside(shape!, { x, y, z: midHeight })).toBe(true);
    }
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