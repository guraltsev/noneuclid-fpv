/**
 * Player-blocking bodies of the generated landmarks (design 018 section 8.4).
 *
 * Piers, columns and stones block the player like objects do, but they are not registry objects, so they are no aim targets, map pieces or tooltips.
 * The bodies of a cell are built once per world and reused, because the movement code asks for them on every step.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../movement/dynamicObject";
import { computeWorldDressing } from "../../world-assets/worldDressing";

/** A landmark collider in the form the movement code takes, with an id of the form `landmark:<cellId>:<n>`. */
export type LandmarkBody = DynamicObjectState & { readonly id: string };

/** Returns the lookup `(world, cellId) -> bodies`; it remembers the bodies of the last world it was asked about. */
export function createLandmarkBodyLookup(): (world: CompiledCellComplex, cellId: string) => readonly LandmarkBody[] {
  let knownWorld: CompiledCellComplex | undefined;
  const bodiesByCellId = new Map<string, readonly LandmarkBody[]>();

  return (world, cellId) => {
    if (knownWorld !== world) {
      knownWorld = world;
      bodiesByCellId.clear();
    }

    let bodies = bodiesByCellId.get(cellId);

    if (!bodies) {
      const colliders = computeWorldDressing(world).landmarksByCellId.get(cellId)?.flatMap((placement) => placement.colliders) ?? [];
      bodies = colliders.map((collider, index) => ({
        id: `landmark:${cellId}:${index}`,
        cellId,
        localPose: yawRigidTransform3(0, vec3(collider.x, collider.y, 0)),
        collision: simpleCollisionCylinder(collider.radiusMeters, collider.heightMeters, vec3(0, 0, collider.heightMeters / 2)),
      }));
      bodiesByCellId.set(cellId, bodies);
    }

    return bodies;
  };
}
