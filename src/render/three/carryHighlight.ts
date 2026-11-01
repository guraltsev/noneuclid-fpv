/**
 * The translucent shape drawn around an object that is being carried.
 *
 * The shape marks the carried object itself, wherever it actually is, so an object that is stuck (stopped short of a wall or an exclusion zone)
 * is visibly stuck and the gap to the hand is visible. What the shape is, is the object's own business: it declares a rough approximation of its
 * own shape (`carryHighlight`, src/world-objects/carryHighlightShape.ts; an ellipsoid for an emitter), and an object that declares none gets a
 * sphere from its collision shape. It is drawn by the runtime-object instance sync from the object's own render records: one shape per record of
 * the object, in the record's cell with the record's pose (so it turns with the object's yaw), on every portal path and every ghost copy where
 * the object is drawn, and on another face of the world exactly as the object is. Nothing in it is specific to one kind of object.
 */
import * as THREE from "three";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { carryHighlightShapeOf, type CarryHighlightShape } from "../../world-objects/carryHighlightShape";
import { collectRuntimeObjectRenderSourceMeshes, type RuntimeObjectRenderRecord, type RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";
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
 * The records of the highlight shape for `object`, one for each place in `objectRecords` where the object itself is drawn.
 *
 * `objectRecords` are the object's render records; only those under the object's own id count (its parts under other ids, such as emitter heads,
 * sit at the same place). Records at the same cell and pose are drawn once. Returns nothing when the object declares no shape and has no
 * collision shape to derive a sphere from.
 */
export function collectCarryHighlightRecords(
  object: CarryHighlightObject,
  objectRecords: readonly RuntimeObjectRenderRecord[],
): readonly RuntimeObjectRenderRecord[] {
  const shape = carryHighlightShapeOf(object);
  if (!shape) {
    return [];
  }

  // The shape in the object's own frame (the record matrix already carries the pose, so the shape turns with the object): translate to its
  // centre, then scale the unit sphere by the semi-axes. The object's frame is world axes (z up); Three.js has y up and -z forward.
  const centre = worldPointToThree(shape.centre);
  const fromCentre = new THREE.Matrix4()
    .makeTranslation(centre.x, centre.y, centre.z)
    .multiply(new THREE.Matrix4().makeScale(Math.abs(shape.radii.x), Math.abs(shape.radii.z), Math.abs(shape.radii.y)));
  const seen = new Set<string>();
  const highlights: RuntimeObjectRenderRecord[] = [];

  for (const record of objectRecords) {
    if (record.objectId !== object.id) {
      continue;
    }

    const place = `${record.cellId}|${record.localMatrix.elements.join(",")}`;
    if (seen.has(place)) {
      continue;
    }
    seen.add(place);
    highlights.push({
      objectId: `${object.id}:carry-highlight`,
      cellId: record.cellId,
      archetypeKey: carryHighlightArchetypeKey,
      localMatrix: record.localMatrix.clone().multiply(fromCentre),
    });
  }

  return highlights;
}
