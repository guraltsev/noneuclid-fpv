/**
 * Advances a dynamic object by a displacement inside the glued cell complex with swept collision, wall sliding and any number of portal crossings.
 * The body is an upright cylinder; its horizontal centre is slid through the walls, too-low portals and forbidden-zone columns of the developed neighbourhood (see developedObstacles.ts) in the flat frame of the start cell, using swept disc/capsule tests and a slide with a crease rule (see sweptCollision.ts). The anchor (the pose translation, which differs from the centre by the collision offset) then follows the resulting polyline through the cells with the segment-walk kernel, which finds every portal crossed, in order, and the final cell and pose. Vertical motion is clamped to the start cell's floor and ceiling. A zero horizontal move never crosses a portal; an anchor that starts outside its cell is first re-homed by walking from the cell's interior to it.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { locateDevelopedPoint, walkDevelopedSegment, type SegmentWalkCrossing } from "../cell-complex/segmentWalk";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformDirection3,
  transformPoint3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import { cellContainmentToleranceMeters, collisionSkinMeters } from "../math/tolerances";
import { vec3, type Vec3 } from "../math/vec3";
import { getDynamicObjectCollisionBounds, signedDistanceToSide, type BlockingReason } from "./collision";
import { collectDevelopedObstacles } from "./developedObstacles";
import type { DynamicObjectState } from "./dynamicObject";
import { slideDisc } from "./sweptCollision";

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
   * Crossing criterion. Only "anchor" exists (also the default when omitted).
   */
  readonly portalCrossingMode?: PortalCrossingMode;
  /**
   * If true, forbidden-zone cylinders are not tested (used by autonomous objects and tools).
   */
  readonly ignoreForbiddenZones?: boolean;
}

/**
 * Outcome of a move: the new state, whether and why it was blocked, and every portal crossed.
 */
export interface MoveDynamicObjectResult {
  /**
   * Final state: moved (possibly slid along obstacles and re-expressed in another cell) or unchanged.
   */
  readonly object: DynamicObjectState;
  /**
   * The requested displacement, echoed unchanged (even if the object ended up elsewhere).
   */
  readonly attemptedDisplacement: Vec3;
  /**
   * The anchor displacement actually applied, in meters in the start cell's frame (before any portal transform), z included.
   */
  readonly appliedDisplacement: Vec3;
  /**
   * True if any contact happened, the vertical step was clamped, or the move could not be completed; it can be true together with `crossedPortal`.
   */
  readonly blocked: boolean;
  /**
   * Reason of the first contact (else the vertical clamp or an anchor wall stop); undefined for a body contact or an unfinishable move.
   */
  readonly blockingReason?: BlockingReason;
  readonly crossedPortal: boolean;
  /**
   * Id of the first portal crossed (in the start cell), when crossedPortal is true.
   */
  readonly crossedPortalId?: string;
  /**
   * Every portal crossed, in order (including the crossings of an initial re-homing).
   */
  readonly crossings: readonly SegmentWalkCrossing[];
  /**
   * Start-cell frame to final-cell frame.
   */
  readonly cellFromStart: RigidTransform3;
}

/**
 * Criterion for when an object crosses a portal: "anchor" (its reference point passes the side).
 */
export type PortalCrossingMode = "anchor";
/**
 * Crossing mode requested by autonomous objects (creatures, emitters); "anchor".
 */
export const AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE: PortalCrossingMode = "anchor";

/**
 * Moves an object by `displacement`: slides its centre through the developed obstacles, walks its anchor through the cells and clamps the vertical step.
 * Order: (1) re-home an anchor that lies outside its cell; (2) clamp the vertical step to the start cell; (3) a zero horizontal step returns after the vertical move without crossing; (4) collect obstacles, slide the centre, and walk the anchor polyline (a wall met by the anchor itself stops it a skin short); (5) compose the pose with the crossings.
 * If the walk cannot be completed (crossing limit, unresolved cell) the original object is returned, blocked, with a console warning.
 * @throws Error if the object's cell is missing from the world.
 */
export function moveDynamicObject(request: MoveDynamicObjectRequest): MoveDynamicObjectResult {
  const { world } = request;
  let object = request.object;
  const startCell = world.cellsById.get(object.cellId);

  if (!startCell) {
    throw new Error(`Cannot move object in missing cell "${object.cellId}".`);
  }

  let prefixCrossings: readonly SegmentWalkCrossing[] = [];
  let prefixTransform = identityRigidTransform3;
  const rawAnchor = object.localPose.translation;

  if (startCell.sides.some((side) => signedDistanceToSide(side, rawAnchor) < -cellContainmentToleranceMeters)) {
    const average = {
      x: startCell.baseVertices.reduce((sum, vertex) => sum + vertex.x, 0) / startCell.baseVertices.length,
      y: startCell.baseVertices.reduce((sum, vertex) => sum + vertex.y, 0) / startCell.baseVertices.length,
    };
    const located = locateDevelopedPoint(world, startCell.id, average, { x: rawAnchor.x, y: rawAnchor.y });

    if (located.status !== "end") {
      return unfinishedResult(request, `anchor of an object in cell "${startCell.id}" could not be re-homed (${located.status})`);
    }

    prefixCrossings = located.crossings;
    prefixTransform = located.cellFromStart;
    object = {
      ...object,
      cellId: located.cellId,
      localPose: composeRigidTransform3(located.cellFromStart, object.localPose),
    };
  }

  const cell = world.cellsById.get(object.cellId);

  if (!cell) {
    return unfinishedResult(request, `cell "${object.cellId}" is missing`);
  }

  const anchor = object.localPose.translation;
  const bounds = getDynamicObjectCollisionBounds(object);
  const radius = bounds?.radius ?? 0;
  const halfHeight = bounds?.halfHeight ?? 0;
  const centre = bounds?.center ?? anchor;
  const offset = { x: centre.x - anchor.x, y: centre.y - anchor.y };

  // Vertical step: clamp so the body stays between floor and ceiling of the start cell; a body already outside may only move back in.
  const bottom = centre.z - halfHeight;
  const top = centre.z + halfHeight;
  const lowest = Math.min(0, -bottom);
  const highest = Math.max(0, cell.heightMeters - top);
  let dz = request.displacement.z;
  let verticalReason: BlockingReason | undefined;

  if (dz < lowest - 1e-12) {
    dz = lowest;
    verticalReason = "floor";
  } else if (dz > highest + 1e-12) {
    dz = highest;
    verticalReason = "ceiling";
  }

  const delta = { x: request.displacement.x, y: request.displacement.y };
  const startAnchorXY = { x: anchor.x, y: anchor.y };

  const build = (
    anchorEnd: { readonly x: number; readonly y: number },
    walkTransform: RigidTransform3 | undefined,
    walkCrossings: readonly SegmentWalkCrossing[],
    reason: BlockingReason | undefined,
    blocked: boolean,
  ): MoveDynamicObjectResult => {
    const translated: DynamicObjectState = {
      ...object,
      localPose: { rotation: object.localPose.rotation, translation: vec3(anchorEnd.x, anchorEnd.y, anchor.z + dz) },
    };
    const moved: DynamicObjectState = walkTransform
      ? {
          ...translated,
          cellId: lastCellId(walkCrossings, object.cellId),
          localPose: composeRigidTransform3(walkTransform, translated.localPose),
        }
      : translated;
    const crossings = [...prefixCrossings, ...walkCrossings];

    return {
      object: moved,
      attemptedDisplacement: request.displacement,
      appliedDisplacement: vec3(anchorEnd.x - anchor.x, anchorEnd.y - anchor.y, dz),
      blocked,
      ...(reason !== undefined ? { blockingReason: reason } : {}),
      crossedPortal: crossings.length > 0,
      ...(crossings.length > 0 ? { crossedPortalId: crossings[0].portalId } : {}),
      crossings,
      cellFromStart: walkTransform ? composeRigidTransform3(walkTransform, prefixTransform) : prefixTransform,
    };
  };

  if (Math.hypot(delta.x, delta.y) <= 1e-12) {
    return build(startAnchorXY, undefined, [], verticalReason, verticalReason !== undefined);
  }

  // Frame in which obstacles are collected: the cell holding the body centre, reached by the straight segment from the anchor.
  let collectCellId = cell.id;
  let collectCentre = { x: centre.x, y: centre.y };
  let frameFromCell = identityRigidTransform3;

  if (Math.hypot(offset.x, offset.y) > 1e-9) {
    const located = locateDevelopedPoint(world, cell.id, startAnchorXY, collectCentre);

    if (located.status === "end") {
      const mapped = transformPoint3(located.cellFromStart, vec3(centre.x, centre.y, 0));

      collectCellId = located.cellId;
      collectCentre = { x: mapped.x, y: mapped.y };
      frameFromCell = invertRigidTransform3(located.cellFromStart);
    }
  }

  const obstacles = collectDevelopedObstacles({
    world,
    cellId: collectCellId,
    center: collectCentre,
    reachMeters: radius + Math.hypot(delta.x, delta.y) + 2 * collisionSkinMeters,
    bodyRadius: radius,
    bodyBottomZ: centre.z + dz - halfHeight,
    bodyTopZ: centre.z + dz + halfHeight,
    ignoreForbiddenZones: request.ignoreForbiddenZones,
    frameFromCell,
  });
  const slide = slideDisc({ x: centre.x, y: centre.y }, delta, obstacles);
  const points = slide.legs.map((p) => ({ x: p.x - offset.x, y: p.y - offset.y }));

  // Walk the anchor polyline through the cells; `walkTransform` maps the start frame to the current cell.
  let walkTransform = identityRigidTransform3;
  let currentCellId = cell.id;
  let anchorEnd = points[0];
  const walkCrossings: SegmentWalkCrossing[] = [];
  let anchorStopped = false;

  for (let k = 0; k + 1 < points.length; k += 1) {
    const from = points[k];
    const to = points[k + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);

    if (length <= 1e-12) {
      continue;
    }

    const legStart = transformPoint3(walkTransform, vec3(from.x, from.y, 0));
    const legDirection = transformDirection3(walkTransform, vec3(to.x - from.x, to.y - from.y, 0));
    const walk = walkDevelopedSegment({
      world,
      cellId: currentCellId,
      start: { x: legStart.x, y: legStart.y },
      direction: { x: legDirection.x, y: legDirection.y },
      lengthMeters: length,
    });
    const last = walk.pieces[walk.pieces.length - 1];

    if (!last || (walk.status !== "end" && walk.status !== "wall")) {
      return unfinishedResult(request, `anchor walk stopped with status "${walk.status}"`);
    }

    walkCrossings.push(...walk.crossings);
    walkTransform = composeRigidTransform3(last.cellFromStart, walkTransform);
    currentCellId = last.cellId;

    if (walk.status === "wall") {
      const stop = Math.max(0, last.tExit - collisionSkinMeters);

      anchorEnd = { x: from.x + ((to.x - from.x) / length) * stop, y: from.y + ((to.y - from.y) / length) * stop };
      anchorStopped = true;
      break;
    }

    anchorEnd = to;
  }

  const firstContact = slide.contacts[0];
  const contactReason = firstContact && firstContact.obstacle.reason !== "body" ? firstContact.obstacle.reason : undefined;
  const reason = firstContact ? contactReason : anchorStopped ? "wall" : verticalReason;

  return build(
    anchorEnd,
    walkCrossings.length > 0 ? walkTransform : undefined,
    walkCrossings,
    reason,
    firstContact !== undefined || verticalReason !== undefined || anchorStopped,
  );
}

/**
 * Cell reached after the given crossings; the start cell when there are none.
 */
function lastCellId(crossings: readonly SegmentWalkCrossing[], startCellId: string): string {
  return crossings.length > 0 ? crossings[crossings.length - 1].targetCellId : startCellId;
}

/**
 * Result for a move that cannot be completed: the original object, blocked, no reason.
 */
function unfinishedResult(request: MoveDynamicObjectRequest, message: string): MoveDynamicObjectResult {
  console.warn(`moveDynamicObject: ${message}; the object was not moved.`);

  return {
    object: request.object,
    attemptedDisplacement: request.displacement,
    appliedDisplacement: vec3(0, 0, 0),
    blocked: true,
    crossedPortal: false,
    crossings: [],
    cellFromStart: identityRigidTransform3,
  };
}
