/**
 * The translucent shape drawn around an object that is being carried.
 *
 * The shape marks the carried object itself, wherever it actually is, so an object that is stuck (stopped short of a wall or an exclusion zone)
 * is visibly stuck and the gap to the hand is visible. What the shape is, is the object's own business: it declares a rough approximation of its
 * own shape (`carryHighlight`, src/world-objects/carryHighlightShape.ts; an ellipsoid for an emitter), and an object that declares none gets a
 * sphere from its collision shape. It is drawn by the runtime-object instance sync at the object's place (so it turns with the object's yaw) and at
 * its own portal ghosts, which the shape's horizontal reach decides: a shape that crosses a portal is drawn whole on both sides, on every portal
 * path, and on another face of the world exactly as the object is. Nothing in it is specific to one kind of object.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { carryHighlightShapeOf, type CarryHighlightShape } from "../../world-objects/carryHighlightShape";
import { collectRuntimeObjectRenderRecordsWithPortalGhosts, exemptFromPortalGhosts, type PortalGhostedRecords } from "./runtimeObjectGhostRecords";
import { collectRuntimeObjectRenderSourceMeshes, type RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";
import { worldPointToThree } from "./worldAxes";

/** Archetype-key prefix of the highlight shape (the key is `<prefix>:mesh:0`). */
export const carryHighlightArchetypePrefix = "carry-highlight";
/** Archetype key of the highlight shape. */
export const carryHighlightArchetypeKey = `${carryHighlightArchetypePrefix}:mesh:0`;
/** What the highlight needs of a carried object: an id, a pose, and a declared highlight shape or a collision shape to derive one from. */
export type CarryHighlightObject = DynamicObjectState & {
  readonly id: string;
  readonly carryHighlight?: CarryHighlightShape;
};

/** Builds the render source of the highlight: a unit sphere, scaled per record (non-uniformly for an ellipsoid) to the object it surrounds. Allocates a geometry and a material. */
export function createCarryHighlightSource(): RuntimeObjectRenderSourceMesh {
  const shape = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.MeshBasicMaterial({
      color: 0xff7ac8,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shape.name = "carry-highlight-shape";
  shape.renderOrder = 925;
  const root = new THREE.Group();
  root.name = "carry-highlight-render-source";
  root.add(shape);
  const [source] = collectRuntimeObjectRenderSourceMeshes("carry-highlight:source", root, carryHighlightArchetypePrefix);
  return source;
}

/**
 * The records of the highlight shape for `object`: one in the object's own cell, and one in every other cell copy that the shape's own
 * horizontal reach touches across portals (the portal ghosts of the shape), through the general ghost mechanism
 * (`collectRuntimeObjectRenderRecordsWithPortalGhosts`).
 *
 * The ghosts are decided by the shape's reach, not by the object's collision footprint: the shape can be wider than a thin object (an
 * emitter's post). So the shape is always whole on the side of a portal the viewer is on, never cut at the portal. Returns nothing when the
 * object declares no shape and has no collision shape to derive a sphere from.
 */
export function collectCarryHighlightRecords(
  object: CarryHighlightObject,
  world: CompiledCellComplex,
): PortalGhostedRecords {
  const shape = carryHighlightShapeOf(object);
  if (!shape) {
    return exemptFromPortalGhosts("nothing-drawn", []);
  }

  // The shape in the object's own frame (the record matrix already carries the pose, so the shape turns with the object): translate to its
  // centre, then scale the unit sphere by the semi-axes. The object's frame is world axes (z up); Three.js has y up and -z forward.
  const centre = worldPointToThree(shape.centre);
  const fromCentre = new THREE.Matrix4()
    .makeTranslation(centre.x, centre.y, centre.z)
    .multiply(new THREE.Matrix4().makeScale(Math.abs(shape.radii.x), Math.abs(shape.radii.z), Math.abs(shape.radii.y)));
  const highlightId = `${object.id}:carry-highlight`;
  // The shape's horizontal reach from its centre (the longest horizontal semi-axis), around the centre in the object's own frame.
  const reach = Math.max(Math.abs(shape.radii.x), Math.abs(shape.radii.y));
  // The same general mechanism as every other part of every object: the record in the object's own cell and its portal ghosts. The shape
  // declares its own render footprint, the disk around its centre with its own reach.
  return collectRuntimeObjectRenderRecordsWithPortalGhosts({
    world,
    object: { ...object, id: highlightId },
    archetypeKeys: [carryHighlightArchetypeKey],
    renderFootprint: { center: { x: shape.centre.x, y: shape.centre.y }, radiusMeters: reach },
    partMatrix: fromCentre,
  });
}
