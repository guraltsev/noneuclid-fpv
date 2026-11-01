/**
 * The translucent ball drawn around an object that is being carried.
 *
 * The ball marks the carried object itself, wherever it actually is, so an object that is stuck (stopped short of a wall or an exclusion zone) is
 * visibly stuck and the gap to the hand is visible. It is drawn by the runtime-object instance sync from the object's own render records: one ball
 * per record of the object, in the record's cell with the record's pose, so it appears on every portal path and every ghost copy where the object
 * does, and on another face of the world exactly as the object does. It is centred on the object's collision shape and sized from its collision
 * radius plus a margin; nothing in it is specific to one kind of object, only to a `DynamicObjectState` with an id.
 */
import * as THREE from "three";
import { getDynamicObjectCollisionBounds } from "../../movement/collision";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { collectRuntimeObjectRenderSourceMeshes, type RuntimeObjectRenderRecord, type RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";
import { worldPointToThree } from "./worldAxes";

/** Archetype-key prefix of the highlight ball (the key is `<prefix>:mesh:0`). */
export const carryHighlightArchetypePrefix = "carry-highlight";
/** Archetype key of the highlight ball. */
export const carryHighlightArchetypeKey = `${carryHighlightArchetypePrefix}:mesh:0`;
/** Margin in meters added to the collision radius to get the radius of the ball. */
export const carryHighlightMarginMeters = 0.1;

/** What the highlight needs of a carried object: an id and a pose with a collision shape. */
export type CarryHighlightObject = DynamicObjectState & { readonly id: string };

/** Builds the render source of the ball: a unit sphere, scaled per record to the object it surrounds. Allocates a geometry and a material. */
export function createCarryHighlightSource(): RuntimeObjectRenderSourceMesh {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.MeshBasicMaterial({
      color: 0xff7ac8,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ball.name = "carry-highlight-ball";
  ball.renderOrder = 925;
  const root = new THREE.Group();
  root.name = "carry-highlight-render-source";
  root.add(ball);
  const [source] = collectRuntimeObjectRenderSourceMeshes("carry-highlight:source", root, carryHighlightArchetypePrefix);
  return source;
}

/**
 * The records of the highlight ball for `object`, one for each place in `objectRecords` where the object itself is drawn.
 *
 * `objectRecords` are the object's render records; only those under the object's own id count (its parts under other ids, such as emitter heads,
 * sit at the same place). Records at the same cell and pose are drawn once. Returns nothing when the object has no collision shape.
 */
export function collectCarryHighlightRecords(
  object: CarryHighlightObject,
  objectRecords: readonly RuntimeObjectRenderRecord[],
): readonly RuntimeObjectRenderRecord[] {
  const bounds = getDynamicObjectCollisionBounds(object);
  if (!bounds) {
    return [];
  }

  // Centre of the collision shape relative to the object's pose, in the pose's axes; the record matrix already carries the pose.
  const offset = object.collision?.offset ?? { x: 0, y: 0, z: 0 };
  const centre = worldPointToThree(offset);
  const radius = bounds.radius + carryHighlightMarginMeters;
  const fromCentre = new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z).multiply(new THREE.Matrix4().makeScale(radius, radius, radius));
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
