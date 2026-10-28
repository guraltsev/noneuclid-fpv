/**
 * Derives the portal-crossing record a carried geodesic cannon needs from a player move result.
 *
 * When the player holding a cannon walks through a portal, the carried object must be re-expressed in the
 * destination cell. This module extracts the crossed portal's identity and its rigid transform
 * (source cell frame to target cell frame, world axes convention, meters) from the compiled
 * cell complex. Invariant: a transition is reported only if the portal found in the previous cell
 * actually leads to the cell the move ended in; otherwise nothing is reported.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { GeodesicCarryPortalTransition } from "../../world-objects/geodesicCannon";
import type { movePlayer } from "../../movement/movePlayer";

/** Minimal structural subset of a movement result required to detect a portal crossing. */
interface PortalMoveResult {
  readonly crossedPortal: boolean;
  readonly crossedPortalId?: string;
  readonly pose: { readonly cellId: string };
}

/**
 * Resolves the carry-portal transition implied by a `movePlayer` result.
 *
 * Thin wrapper over {@link resolveGeodesicCarryPortalTransitionFromPortalMove}; see it for the
 * preconditions and the `undefined` cases.
 */
export function resolveGeodesicCarryPortalTransitionFromMove(
  world: CompiledCellComplex,
  previousCellId: string,
  moveResult: ReturnType<typeof movePlayer>,
): GeodesicCarryPortalTransition | undefined {
  return resolveGeodesicCarryPortalTransitionFromPortalMove(world, previousCellId, moveResult);
}

/**
 * Builds the transition describing which portal a move crossed, or `undefined` if no consistent crossing happened.
 *
 * `previousCellId` is the cell the move started in (the portal id is looked up in that cell, not in
 * `moveResult.pose.cellId`). Returns `undefined` when no portal was crossed, the cell or portal id is
 * unknown, or the portal's `targetCellId` disagrees with the final pose cell. The returned
 * `transformToTarget` is the portal's own rigid transform (shared reference, not copied). O(1) map lookups.
 */
export function resolveGeodesicCarryPortalTransitionFromPortalMove(
  world: CompiledCellComplex,
  previousCellId: string,
  moveResult: PortalMoveResult,
): GeodesicCarryPortalTransition | undefined {
  if (!moveResult.crossedPortal || !moveResult.crossedPortalId) {
    return undefined;
  }

  const portal = world.cellsById.get(previousCellId)?.portalsById.get(moveResult.crossedPortalId);
  if (!portal || portal.targetCellId !== moveResult.pose.cellId) {
    return undefined;
  }

  return {
    sourceCellId: previousCellId,
    sourcePortalId: portal.id,
    targetCellId: portal.targetCellId,
    targetPortalId: portal.targetPortalId,
    transformToTarget: portal.transformToTarget,
  };
}
