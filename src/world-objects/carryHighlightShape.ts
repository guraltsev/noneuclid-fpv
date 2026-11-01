/**
 * The shape of the highlight drawn around a carried object.
 *
 * Each object that can be carried says what its highlight looks like, as plain data in its own frame (the frame of its pose, z up): a rough
 * approximation of the object's own shape. The renderer draws that shape around the object without knowing what kind of object it is. Ellipsoid
 * is the only kind so far; the type is a union so other kinds can be added. An object that declares none gets a sphere derived from its
 * collision shape (`carryHighlightShapeOf`).
 */
import type { Vec3 } from "../math/vec3";

/** Margin in meters added to the collision radius to get the radius of the fallback highlight sphere. */
export const carryHighlightMarginMeters = 0.1;

/** A carry highlight shape. A sphere is the ellipsoid with equal radii. */
export type CarryHighlightShape = {
  readonly kind: "ellipsoid";
  /** Centre of the ellipsoid, in the object's frame. */
  readonly centre: Vec3;
  /** Semi-axes along the object's x, y and z axes, in meters. */
  readonly radii: Vec3;
};

/**
 * The highlight shape of a carried object: the one it declares, otherwise a sphere centred on its collision shape with the collision radius plus
 * `carryHighlightMarginMeters`; undefined when it declares none and has no collision shape.
 */
export function carryHighlightShapeOf(object: {
  readonly carryHighlight?: CarryHighlightShape;
  readonly collision?: { readonly radius: number; readonly offset?: Vec3 };
}): CarryHighlightShape | undefined {
  if (object.carryHighlight) {
    return object.carryHighlight;
  }

  if (!object.collision) {
    return undefined;
  }

  const radius = object.collision.radius + carryHighlightMarginMeters;
  return {
    kind: "ellipsoid",
    centre: object.collision.offset ?? { x: 0, y: 0, z: 0 },
    radii: { x: radius, y: radius, z: radius },
  };
}