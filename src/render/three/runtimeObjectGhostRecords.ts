/**
 * Creates "ghost" render records so a dynamic object that overlaps a portal is drawn on every side of it.
 *
 * Only the object's true cell contains its pose; an object near a portal side or a vertex would otherwise vanish when
 * the neighbouring cells are seen through the portals. The ghosts come from the developed disk (job 12) of radius
 * `footprint radius + activation clearance` around the object's horizontal centre: every cell copy the disk reaches,
 * however many portals away, gets one record with pose `node.cellFromStart * object.localPose`, converted to a Three.js
 * matrix. The footprint radius is the collision radius, or `footprintRadiusMeters` (the render footprint) when the
 * object has no collision bounds; with neither, nothing is emitted.
 *
 * Around a cone vertex the same cell can appear in two copies. Copies in the same cell whose centres are closer than
 * twice the footprint radius overlap, so only the first one (breadth-first order, the real object first) is kept.
 * This also merges the two wedges through which a flat copy is reached. See `_docs/MATHEMATICAL_MODEL.md` section 8.
 */

import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { collectDevelopedDisk } from "../../cell-complex/developedDisk";
import { composeRigidTransform3, transformPoint3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import { getDynamicObjectCollisionBounds } from "../../movement/collision";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { rigidTransformToThreeMatrix } from "./worldAxes";
import type { RuntimeObjectRenderRecord } from "./runtimeObjectRenderRecords";

/** Default distance in meters (0.02) beyond which an object is considered too far from a portal wall to need a ghost. */
export const defaultPortalGhostActivationClearanceMeters = 0.02;

/** A dynamic object with an id, i.e. anything that can have ghost records. */
export type PortalGhostRenderableObject = DynamicObjectState & {
  readonly id: string;
};

/** Input for ghost-record collection. */
export interface PortalGhostRuntimeObjectRenderRecordRequest {
  /** Compiled world used to find the object's cell and its portal sides. */
  readonly world: CompiledCellComplex;
  /** The object, with a cell id and a cell-local pose. */
  readonly object: PortalGhostRenderableObject;
  /** Archetype keys to emit one record each for, per ghost. */
  readonly archetypeKeys: Iterable<string>;
  /** Overrides `defaultPortalGhostActivationClearanceMeters`. */
  readonly activationClearanceMeters?: number;
  /** Horizontal render footprint radius used when the object has no collision bounds. */
  readonly footprintRadiusMeters?: number;
}

/** Returns ghost render records, in every cell copy the object's footprint reaches (empty if none, or if the cell, footprint or key list is missing). */
export function collectPortalGhostRuntimeObjectRenderRecords(
  request: PortalGhostRuntimeObjectRenderRecordRequest,
): readonly RuntimeObjectRenderRecord[] {
  const { object, world } = request;

  if (!world.cellsById.has(object.cellId)) {
    return [];
  }

  const bounds = getDynamicObjectCollisionBounds(object);
  const radius = bounds?.radius ?? request.footprintRadiusMeters;

  if (radius === undefined || !(radius > 0)) {
    return [];
  }

  const archetypeKeys = [...request.archetypeKeys];

  if (archetypeKeys.length === 0) {
    return [];
  }

  const center = bounds
    ? { x: bounds.center.x, y: bounds.center.y }
    : { x: object.localPose.translation.x, y: object.localPose.translation.y };
  const clearance = request.activationClearanceMeters ?? defaultPortalGhostActivationClearanceMeters;
  const disk = collectDevelopedDisk({ world, cellId: object.cellId, center, radiusMeters: radius + clearance });
  const kept: { readonly cellId: string; readonly x: number; readonly y: number }[] = [];
  const records: RuntimeObjectRenderRecord[] = [];

  for (const [index, node] of disk.nodes.entries()) {
    const ghostCenter = transformPoint3(node.cellFromStart, vec3(center.x, center.y, 0));
    const conflicts = kept.some(
      (other) => other.cellId === node.cellId && Math.hypot(other.x - ghostCenter.x, other.y - ghostCenter.y) < 2 * radius,
    );

    if (conflicts) {
      continue;
    }

    kept.push({ cellId: node.cellId, x: ghostCenter.x, y: ghostCenter.y });

    if (index === 0) {
      continue;
    }

    const ghostMatrix = rigidTransformToThreeMatrix(composeRigidTransform3(node.cellFromStart, object.localPose));

    for (const archetypeKey of archetypeKeys) {
      records.push({
        objectId: object.id,
        cellId: node.cellId,
        archetypeKey,
        localMatrix: ghostMatrix,
      });
    }
  }

  return records;
}
