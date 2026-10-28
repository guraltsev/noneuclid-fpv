/**
 * Creates "ghost" render records so a dynamic object that overlaps a portal is drawn on both sides of it.
 *
 * Only the object's true cell contains its pose; an object touching a portal side would otherwise vanish when the
 * neighbouring cell is seen through that portal. For each portal side of the object's cell, if the object's collision cylinder
 * (centre c, radius r) reaches within a small clearance of the side plane (inward signed distance minus r <= clearance)
 * and its centre projects onto the side within [-r, length + r], a second record is emitted in the portal's target
 * cell with pose `portal.transformToTarget * object.localPose` (rigid composition: the cell-to-target
 * transform applied after the object pose), converted to a Three.js matrix. The ghost shares the object's archetype keys.
 * Objects without collision bounds, or in unknown cells, yield nothing.
 */

import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { composeRigidTransform3 } from "../../math/rigidTransform3";
import {
  getDynamicObjectCollisionBounds,
  getSideSupport,
  projectPointAlongSide,
  signedDistanceToSide,
} from "../../movement/collision";
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
  /** Archetype keys to emit one record each for, per qualifying portal. */
  readonly archetypeKeys: Iterable<string>;
  /** Overrides `defaultPortalGhostActivationClearanceMeters`. */
  readonly activationClearanceMeters?: number;
}

/** Returns ghost render records, in neighbouring cells, for every portal the object currently overlaps (empty if none, or if the cell, bounds or key list is missing). */
export function collectPortalGhostRuntimeObjectRenderRecords(
  request: PortalGhostRuntimeObjectRenderRecordRequest,
): readonly RuntimeObjectRenderRecord[] {
  const cell = request.world.cellsById.get(request.object.cellId);

  if (!cell) {
    return [];
  }

  const bounds = getDynamicObjectCollisionBounds(request.object);

  if (!bounds) {
    return [];
  }

  const records: RuntimeObjectRenderRecord[] = [];
  const activationClearanceMeters =
    request.activationClearanceMeters ?? defaultPortalGhostActivationClearanceMeters;
  const archetypeKeys = [...request.archetypeKeys];

  if (archetypeKeys.length === 0) {
    return [];
  }

  for (const side of cell.sides) {
    if (!side.portal) {
      continue;
    }

    const clearance = signedDistanceToSide(side, bounds.center) - getSideSupport(side, bounds);
    if (clearance > activationClearanceMeters) {
      continue;
    }

    const projection = projectPointAlongSide(side, bounds.center);
    if (projection < -bounds.radius || projection > side.lengthMeters + bounds.radius) {
      continue;
    }

    const ghostPose = composeRigidTransform3(side.portal.transformToTarget, request.object.localPose);
    const ghostMatrix = rigidTransformToThreeMatrix(ghostPose);

    for (const archetypeKey of archetypeKeys) {
      records.push({
        objectId: request.object.id,
        cellId: side.portal.targetCellId,
        archetypeKey,
        localMatrix: ghostMatrix,
      });
    }
  }

  return records;
}
