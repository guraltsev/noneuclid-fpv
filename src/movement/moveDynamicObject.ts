/**
 * Advances a dynamic object by a displacement inside the glued cell complex, handling portal crossing, collision and wall sliding.
 * The displacement is added to the object's position in its current cell's frame. If the resulting anchor point (the pose translation, not the collision cylinder) has passed through a portal side it crosses: the pose is mapped into the target cell by the portal transform and the crossed state is tested against the target cell (ignoring the reciprocal portal side); if that test reports a floor, ceiling or forbidden-zone block, the crossing is refused and the object stays at its original pose (wall overlaps in the target cell do not block, so corner straddling still works). Otherwise the new state is tested against its own cell; a wall hit is resolved by pushing the object back along the wall's inward normal so it ends at the radius distance (so it slides along the wall), and if the pushed position still violates the cell (a convex corner) the object stays where it was. Any other block leaves the object where it was.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { CompiledPrismSide } from "../cell-complex/prismCells";
import { rigidTransform3 } from "../math/rigidTransform3";
import { addVec3, type Vec3 } from "../math/vec3";
import {
  getDynamicObjectCollisionBounds,
  projectPointAlongSide,
  getSideSupport,
  signedDistanceToSide,
  testCellCollision,
  type BlockingReason,
} from "./collision";
import type { DynamicObjectState } from "./dynamicObject";
import { crossDynamicObjectPortal } from "./portalCrossing";

/**
 * Input to {@link moveDynamicObject}.
 */
export interface MoveDynamicObjectRequest {
  readonly world: CompiledCellComplex;
  /**
   * Object to move; its pose is in the frame of its current cell.
   */
  readonly object: DynamicObjectState;
  /**
   * Translation to attempt, in meters, in the object's current cell frame.
   */
  readonly displacement: Vec3;
  /**
   * Crossing criterion. Only "anchor" is implemented (also the default when omitted); passing "bounds" makes {@link moveDynamicObject} throw so the gap cannot be silently ignored.
   */
  readonly portalCrossingMode?: PortalCrossingMode;
  /**
   * If true, forbidden-zone cylinders are not tested (used by autonomous objects and tools).
   */
  readonly ignoreForbiddenZones?: boolean;
}

/**
 * Outcome of a move: the new state, whether and why it was blocked, and any portal crossed.
 */
export interface MoveDynamicObjectResult {
  /**
   * Final state: moved, moved and re-expressed in the target cell, pushed back along a wall, or unchanged.
   */
  readonly object: DynamicObjectState;
  /**
   * The requested displacement, echoed unchanged (even if the object ended up elsewhere).
   */
  readonly attemptedDisplacement: Vec3;
  /**
   * True if collision stopped or reduced the move; false when a portal was crossed.
   */
  readonly blocked: boolean;
  readonly blockingReason?: BlockingReason;
  readonly crossedPortal: boolean;
  /**
   * Id of the portal (in the source cell) that was crossed, when crossedPortal is true.
   */
  readonly crossedPortalId?: string;
}

/**
 * Criterion for when an object crosses a portal: "anchor" (its reference point passes the side) or "bounds" (any part of its body does).
 * Only "anchor" is implemented by moveDynamicObject, which throws for "bounds".
 */
export type PortalCrossingMode = "bounds" | "anchor";
/**
 * Crossing mode requested by autonomous objects (creatures, emitters); "anchor".
 */
export const AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE: PortalCrossingMode = "anchor";

/**
 * Moves an object by `displacement`, crossing a portal, sliding along a wall, or stopping as collision dictates.
 * Order of decisions: (1) translate; (2) if the new anchor is outside a portal side (see the exit-side selection), cross it and run testCellCollision in the target cell (ignoring the reciprocal portal side, no swept test); if that reports a floor, ceiling or forbidden-zone block (walls are ignored so corner crossings still work), return a blocked result at the original pose with that reason, otherwise return the crossed state; (3) otherwise run testCellCollision with the old state as previousObject; (4) on a wall block, push the translated object inward just enough (plus 1e-6 m) to clear that wall and retest it against the cell; if the pushed position is still blocked (second wall, floor, ceiling or forbidden zone), return the original object. Non-wall blocks return the original object.
 * @throws Error if `portalCrossingMode` is "bounds" (not implemented), or if the object's cell or the portal's target cell is missing from the world.
 */
export function moveDynamicObject(request: MoveDynamicObjectRequest): MoveDynamicObjectResult {
  if (request.portalCrossingMode === "bounds") {
    throw new Error('portalCrossingMode "bounds" is not implemented by moveDynamicObject; use "anchor".');
  }

  const startCell = request.world.cellsById.get(request.object.cellId);

  if (!startCell) {
    throw new Error(`Cannot move object in missing cell "${request.object.cellId}".`);
  }

  const candidateObject = translateObject(request.object, request.displacement);
  const exitSide = findMostProbablePortalExit(startCell, candidateObject);

  if (exitSide?.portal) {
    const crossedObject = crossDynamicObjectPortal(candidateObject, exitSide.portal);
    const targetCell = request.world.cellsById.get(crossedObject.cellId);

    if (!targetCell) {
      throw new Error(`Portal "${exitSide.portal.id}" targets missing cell "${crossedObject.cellId}".`);
    }

    const reciprocalSideIndex = targetCell.portalsById.get(exitSide.portal.reciprocalPortalId)?.sideIndex;
    const targetCollision = testCellCollision({
      cell: targetCell,
      object: crossedObject,
      ignoredPortalSideIndex: reciprocalSideIndex,
      ignoreForbiddenZones: request.ignoreForbiddenZones,
    });

    // Wall overlaps are deliberately not checked here: an anchor that crosses near a corner can legitimately straddle the adjacent wall of the target cell, and the next move resolves it.
    if (targetCollision.blocked && targetCollision.reason !== "wall") {
      return blockedResult(request, targetCollision.reason);
    }

    return {
      object: crossedObject,
      attemptedDisplacement: request.displacement,
      blocked: false,
      crossedPortal: true,
      crossedPortalId: exitSide.portal.id,
    };
  }

  const collision = testCellCollision({
    cell: startCell,
    object: candidateObject,
    previousObject: request.object,
    ignoreForbiddenZones: request.ignoreForbiddenZones,
  });

  if (collision.blocked) {
    let resolvedObject = request.object;

    if (collision.reason === "wall") {
      const pushedObject = resolveBlockedWallPosition(
        candidateObject,
        startCell.sides.find((side) => side.sideIndex === collision.sideIndex),
      );
      // Convex corner: the push-out of one wall can leave the body inside another wall (or a zone); then do not move.
      const pushedCollision = testCellCollision({
        cell: startCell,
        object: pushedObject,
        previousObject: request.object,
        ignoreForbiddenZones: request.ignoreForbiddenZones,
      });

      if (!pushedCollision.blocked) {
        resolvedObject = pushedObject;
      }
    }

    return blockedResult(request, collision.reason, resolvedObject);
  }

  return {
    object: candidateObject,
    attemptedDisplacement: request.displacement,
    blocked: false,
    crossedPortal: false,
  };
}

/**
 * Builds the result for a blocked move that did not cross a portal.
 */
function blockedResult(
  request: MoveDynamicObjectRequest,
  blockingReason: BlockingReason | undefined,
  object = request.object,
): MoveDynamicObjectResult {
  return {
    object,
    attemptedDisplacement: request.displacement,
    blocked: true,
    blockingReason,
    crossedPortal: false,
  };
}

/**
 * Returns the object with its pose translation increased by `displacement` and rotation unchanged.
 */
function translateObject(object: DynamicObjectState, displacement: Vec3): DynamicObjectState {
  return {
    ...object,
    localPose: rigidTransform3(
      object.localPose.rotation,
      addVec3(object.localPose.translation, displacement),
    ),
  };
}

/**
 * Chooses the portal side, if any, through which the anchor of the candidate state has left the cell.
 * Takes the side with the most negative signed distance to the anchor. If that side has no portal, returns undefined (a wall will handle it). If the anchor's projection onto that side's line falls outside the side's extent (the anchor is past a corner), falls back to the portal side with the most negative clearance whose extent does contain the projection; otherwise returns the side itself. Returns undefined when the anchor is inside the cell.
 */
function findMostProbablePortalExit(
  cell: { readonly sides: readonly CompiledPrismSide[] },
  object: DynamicObjectState,
): CompiledPrismSide | undefined {
  let deepestOutsideSide: CompiledPrismSide | undefined;
  let deepestOutsideClearance = 0;

  for (const side of cell.sides) {
    const clearance = signedDistanceToSide(side, object.localPose.translation);

    if (clearance < deepestOutsideClearance) {
      deepestOutsideSide = side;
      deepestOutsideClearance = clearance;
    }
  }

  if (!deepestOutsideSide?.portal) {
    return undefined;
  }

  const projection = projectPointAlongSide(deepestOutsideSide, object.localPose.translation);

  if (projection < 0 || projection > deepestOutsideSide.lengthMeters) {
    let projectedPortalSide: CompiledPrismSide | undefined;
    let projectedPortalClearance = 0;

    for (const side of cell.sides) {
      if (!side.portal) {
        continue;
      }

      const clearance = signedDistanceToSide(side, object.localPose.translation);
      const sideProjection = projectPointAlongSide(side, object.localPose.translation);

      if (
        clearance < projectedPortalClearance &&
        sideProjection >= 0 &&
        sideProjection <= side.lengthMeters
      ) {
        projectedPortalSide = side;
        projectedPortalClearance = clearance;
      }
    }

    return projectedPortalSide;
  }

  return deepestOutsideSide;
}

/**
 * Pushes the object inward along the side's normal until the body's clearance to that side is zero, leaving tangential motion intact.
 */
function resolveBlockedWallPosition(
  object: DynamicObjectState,
  side: CompiledPrismSide | undefined,
): DynamicObjectState {
  if (!side) {
    return object;
  }

  const bounds = getDynamicObjectCollisionBounds(object);
  const point = bounds?.center ?? object.localPose.translation;
  const support = bounds ? getSideSupport(side, bounds) : 0;
  const clearance = getSignedClearanceToSide(side, point, support);
  // Penetration depth of the body into the wall, plus a 1e-6 m margin so the pushed position is strictly clear.
  const inwardOffset = clearance < 0 ? -clearance + 1e-6 : 0;

  if (inwardOffset === 0) {
    return object;
  }

  return translateObject(object, {
    x: side.inwardNormal.x * inwardOffset,
    y: side.inwardNormal.y * inwardOffset,
    z: 0,
  });
}

/**
 * Signed distance from a point to the side plane minus the body support; negative means the body overlaps or has passed the side.
 */
function getSignedClearanceToSide(side: CompiledPrismSide, point: Vec3, support: number): number {
  return (point.x - side.start.x) * side.inwardNormal.x + (point.y - side.start.y) * side.inwardNormal.y - support;
}
