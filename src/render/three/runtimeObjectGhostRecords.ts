/**
 * Creates "ghost" render records so a dynamic object that overlaps a portal is drawn on every side of it.
 *
 * Only the object's true cell contains its pose; an object near a portal side or a vertex would otherwise vanish when
 * the neighbouring cells are seen through the portals. The ghosts come from the developed disk (job 12) of radius
 * `render footprint radius + activation clearance` around the footprint's centre: every cell copy the disk reaches,
 * however many portals away, gets one record with pose `node.cellFromStart * object.localPose`, converted to a Three.js
 * matrix.
 *
 * The footprint is what is DRAWN (`RenderFootprint`: centre and radius in the object's own frame), never the collision shape: a ghost exists
 * to show the drawn part on the other side of a portal, and the drawn part need not be centred on, or as wide as, the body that collides.
 * It is a required input. An object has no fallback footprint; a drawn part without a measured one is an error, reported by the caller.
 *
 * Around a cone vertex the same cell can appear in two copies. Copies in the same cell whose centres are closer than
 * twice the footprint radius overlap, so only the first one (breadth-first order, the real object first) is kept.
 * This also merges the two wedges through which a flat copy is reached. See `_docs/MATHEMATICAL_MODEL.md` section 8.
 */

import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { collectDevelopedDisk } from "../../cell-complex/developedDisk";
import { composeRigidTransform3, transformPoint3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { rigidTransformToThreeMatrix } from "./worldAxes";
import type { RenderFootprint, RuntimeObjectRenderRecord } from "./runtimeObjectRenderRecords";

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
  /**
   * What is drawn of the object (or of this part of it): a disk in the object's own frame. Required: there is no collision or default fallback.
   * Not read when `archetypeKeys` is empty (nothing is drawn, so nothing is ghosted).
   */
  readonly renderFootprint: RenderFootprint;
}

/**
 * The one way a part of an object gets its render records: one record per archetype key in the object's own cell, then its portal ghosts
 * (see {@link collectPortalGhostRuntimeObjectRenderRecords}). The instance sync uses it for every ordinary object, for every body part of a geodesic
 * object (cannon post, cannon heads, intersection balloon) and for the carry highlight, so no kind of object has portal-ghost logic of its own.
 */
export function collectRuntimeObjectRenderRecordsWithPortalGhosts(
  request: PortalGhostRuntimeObjectRenderRecordRequest,
): readonly RuntimeObjectRenderRecord[] {
  const archetypeKeys = [...request.archetypeKeys];
  const localMatrix = rigidTransformToThreeMatrix(request.object.localPose);

  return [
    ...archetypeKeys.map((archetypeKey) => ({
      objectId: request.object.id,
      cellId: request.object.cellId,
      archetypeKey,
      localMatrix,
    })),
    ...collectPortalGhostRuntimeObjectRenderRecords({ ...request, archetypeKeys }),
  ];
}

/**
 * Returns ghost render records, in every cell copy the object's render footprint reaches (empty if none, or if the cell or key list is missing).
 * Throws if the footprint radius is not positive: an unmeasured drawn part must fail loudly, not be left without ghosts.
 */
export function collectPortalGhostRuntimeObjectRenderRecords(
  request: PortalGhostRuntimeObjectRenderRecordRequest,
): readonly RuntimeObjectRenderRecord[] {
  const { object, world } = request;
  const archetypeKeys = [...request.archetypeKeys];

  if (archetypeKeys.length === 0 || !world.cellsById.has(object.cellId)) {
    return [];
  }

  const radius = request.renderFootprint.radiusMeters;

  if (!(radius > 0)) {
    throw new Error(`Object "${object.id}" has no render footprint (radius ${radius}); its portal ghosts cannot be decided.`);
  }

  // The footprint centre is in the object's own frame; the disk is taken in the cell's frame.
  const center = transformPoint3(object.localPose, vec3(request.renderFootprint.center.x, request.renderFootprint.center.y, 0));
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
