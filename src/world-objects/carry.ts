/**
 * The carry contract: what it means for an object to be carried, stated once, as pure functions of the world and the object.
 *
 * An object that can be carried says so (`canBeCarried: true`, set by its constructor). A carrier (a hand, a bot, a script) knows nothing about
 * walls, portals or geodesics; it only sends the object a stream of **displacement steps**, and the object decides how it reacts.
 * - A step is a vector in the frame of the cell the object is in at that moment, at most `carryStepCapMeters` long. The reaction is correct for
 *   any step up to the cap and is not defined beyond it.
 * - Steps are applied in order and are never merged: the sum of the displacements is not the path, and one merged step can end in another cell,
 *   or another homotopy class, than the steps it replaces (a path that winds around a junction is not the straight line to its end).
 * - The reaction takes the world, the object and one step and returns a plain value; it changes nothing. The caller stores the result (for an
 *   emitter that anchors locked geodesics, only through `moveEmitterAlongRoute`, which refuses a move the portal word cannot follow).
 *   - The object is re-homed on every step: the new place is valid in the cell that contains it, and the route is the portals the straight walk
 *     of the step crossed, read off the walk, never inferred from positions.
 *   - Orientation: the object keeps its physical direction, so its yaw turns with the frames of the faces it crosses.
 *   - A wall in the way: the object stops just short of it (`carryWallMarginMeters`), and the reaction says it was stopped by the wall.
 *   - The step (not the object) sweeps across a portal junction's exclusion zone: the object stays at its last valid position and is
 *     detached (`{ detach }`), so it stays continuous and no portal word becomes illegal. The kick that will later send it flying is the
 *     `impulse` of the same outcome.
 *   - An object that ends a step inside an exclusion zone is reported as placed there; what happens to it is the caller's rule
 *     (the cannon tool destroys it, as before).
 * - Release is a detach and nothing else.
 * - One carrier per object (first come, first served) is part of the contract; the session enforces it.
 *
 * The sender's side, also pure and here so that every carrier does it the same way: `locateCarrierTarget` finds where the carrier's hand is,
 * and `carryTowardTarget` turns "the object should be at the hand" into steps: target minus the object's current place, in the nearest valid
 * straight development, split into steps of at most the cap, at most `carryMaxSpeedMetersPerSecond` of travel per second. Each step is computed
 * from the current place, so drift corrects itself and a lost frame loses nothing. Picking up is the first of these streams: the object glides
 * to the hand in ordinary steps and never jumps. If the hand outruns the cap the object lags behind it.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { findNearestImageRoute, type CellPoint, type PortalRouteHop } from "../cell-complex/portalRoute";
import { walkDevelopedSegment, type SegmentWalkResult } from "../cell-complex/segmentWalk";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import { degenerateLengthMeters } from "../math/tolerances";
import { vec3, type Vec3 } from "../math/vec3";
import { sanitizeYaw } from "./geodesic/objects";

/** Longest displacement step the reaction is defined for, in meters. */
export const carryStepCapMeters = 1;
/** Fastest travel of a carried object toward its carrier's hand, in meters per second (about 20 m/s). */
export const carryMaxSpeedMetersPerSecond = 20;
/** Distance a carried object keeps from a wall it was stopped by, in meters. */
export const carryWallMarginMeters = 0.02;
/** Distance to the target under which the object counts as having arrived, in meters. */
export const carryArrivalToleranceMeters = 1e-4;
/** Most steps one call of `carryTowardTarget` applies; the rest of the way is left to the next frame. */
export const carryMaxStepsPerCall = 64;
// The search for the straight development to the target: a frame's walk crosses a portal or two; a pickup from another face is a longer
// search, used only when the short one finds nothing within `carryNearSearchMeters`.
const carryNearSearchHops = 2;
const carryNearSearchMeters = 1;
const carryFarSearchHops = 6;

/** Marker on an object type: it can be carried. Checked by `canBeCarried`. */
export interface CarriableMarker {
  readonly canBeCarried?: true;
}

/** Whether an object declares that it can be carried. */
export function canBeCarried(object: CarriableMarker): boolean {
  return object.canBeCarried === true;
}

/** Where a carried object is: its cell, its point in that cell's frame (z is the object's own height and is never changed by a step) and its yaw. */
export interface CarriedPlace {
  readonly cellId: string;
  readonly position: Vec3;
  readonly yawRadians: number;
  /** Radius of the object's body, used to keep a swept step out of the exclusion zones; default 0. */
  readonly radiusMeters?: number;
}

/** A displacement step: a vector in the frame of the cell the object is in, at most `carryStepCapMeters` long. */
export interface CarryStep {
  readonly x: number;
  readonly y: number;
}

/** Where a step leaves the object: a place valid in its cell. */
export interface CarryPlacement {
  readonly cellId: string;
  readonly position: Vec3;
  readonly yawRadians: number;
}

/** The step moved the object: its new place, the portals crossed (in order) and whether a wall cut the step short. */
export interface CarryMove {
  readonly placement: CarryPlacement;
  readonly route: readonly PortalRouteHop[];
  readonly stoppedByWall?: true;
}

/** Why a step did not move the object. */
export type CarryStayReason = "wall" | "step-exceeds-cap" | "walk-failed";

/** What an object does with one displacement step. */
export type CarryReaction =
  | CarryMove
  | { readonly stay: CarryStayReason }
  | { readonly detach: { readonly impulse?: Vec3 } };

/** The reaction of a carried object to one displacement step; see the module header for the rules. Pure. */
export function reactToDisplacement(input: {
  readonly world: CompiledCellComplex;
  readonly object: CarriedPlace;
  readonly step: CarryStep;
}): CarryReaction {
  const { world, object, step } = input;
  const length = Math.hypot(step.x, step.y);

  if (length > carryStepCapMeters + 1e-9) {
    return { stay: "step-exceeds-cap" };
  }
  if (length <= degenerateLengthMeters) {
    return { placement: { cellId: object.cellId, position: object.position, yawRadians: object.yawRadians }, route: [] };
  }

  const start = { x: object.position.x, y: object.position.y };
  const direction = { x: step.x / length, y: step.y / length };
  const walkTo = (lengthMeters: number): SegmentWalkResult =>
    walkDevelopedSegment({ world, cellId: object.cellId, start, direction, lengthMeters });
  let walk = walkTo(length);
  let travelled = length;
  let stoppedByWall = false;

  if (walk.status === "wall") {
    const wallPiece = walk.pieces[walk.pieces.length - 1];
    travelled = Math.max(0, (wallPiece?.tExit ?? 0) - carryWallMarginMeters);
    if (travelled <= degenerateLengthMeters) {
      return { stay: "wall" };
    }
    walk = walkTo(travelled);
    stoppedByWall = true;
  }
  const last = walk.pieces[walk.pieces.length - 1];
  if (walk.status !== "end" || !last) {
    return { stay: "walk-failed" };
  }

  const endInStartFrame = { x: start.x + direction.x * travelled, y: start.y + direction.y * travelled };
  if (sweepsAcrossJunction(world, walk, start, direction, endInStartFrame, object.radiusMeters ?? 0)) {
    return { detach: {} };
  }

  const turn = walk.crossings.reduce(
    (frame, crossing) => composeRigidTransform3(crossing.transformToTarget, frame),
    identityRigidTransform3,
  );
  const position = transformPoint3(last.cellFromStart, vec3(endInStartFrame.x, endInStartFrame.y, object.position.z));
  const move: CarryMove = {
    placement: {
      cellId: last.cellId,
      position,
      yawRadians: sanitizeYaw(object.yawRadians + Math.atan2(turn.rotation.m10, turn.rotation.m00)),
    },
    route: walk.crossings.map((crossing) => ({
      sourceCellId: crossing.sourceCellId,
      sourcePortalId: crossing.portalId,
      targetCellId: crossing.targetCellId,
      targetPortalId: crossing.targetPortalId,
      transformToTarget: crossing.transformToTarget,
    })),
  };

  return stoppedByWall ? { ...move, stoppedByWall: true } : move;
}

// Whether the walked segment passes through the exclusion zone of a junction (widened by the body radius) without ending inside that zone.
// An end inside a zone is the object touching it, which is the caller's rule, not a sweep.
function sweepsAcrossJunction(
  world: CompiledCellComplex,
  walk: SegmentWalkResult,
  start: { readonly x: number; readonly y: number },
  direction: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  bodyRadiusMeters: number,
): boolean {
  const lastIndex = walk.pieces.length - 1;

  return walk.pieces.some((piece, index) => {
    const cell = world.cellsById.get(piece.cellId);
    if (!cell) {
      return false;
    }
    const from = transformPoint3(piece.cellFromStart, vec3(start.x + direction.x * piece.tEnter, start.y + direction.y * piece.tEnter, 0));
    const to = transformPoint3(piece.cellFromStart, vec3(start.x + direction.x * piece.tExit, start.y + direction.y * piece.tExit, 0));
    const endInCell = index === lastIndex ? transformPoint3(piece.cellFromStart, vec3(end.x, end.y, 0)) : undefined;

    return cell.singularityColumns.some((column) => {
      const reach = column.radius + bodyRadiusMeters;
      if (endInCell && Math.hypot(endInCell.x - column.center.x, endInCell.y - column.center.y) < reach) {
        return false;
      }

      return distanceFromPointToSegment(column.center, from, to) < reach;
    });
  });
}

function distanceFromPointToSegment(point: { readonly x: number; readonly y: number }, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  const t = lengthSquared <= degenerateLengthMeters
    ? 0
    : Math.min(1, Math.max(0, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared));

  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

/**
 * Where the carrier's hand is, as a place on the surface: the cell it is in and its point in that cell's frame, found by walking from the
 * carrier to the hand through the portals between them. A wall between them stops the hand just short of it. Undefined when the walk fails.
 * `hand` is in the frame of the carrier's cell.
 */
export function locateCarrierTarget(
  world: CompiledCellComplex,
  carrier: { readonly cellId: string; readonly position: { readonly x: number; readonly y: number } },
  hand: { readonly x: number; readonly y: number },
): CellPoint | undefined {
  const dx = hand.x - carrier.position.x;
  const dy = hand.y - carrier.position.y;
  const length = Math.hypot(dx, dy);

  if (length <= degenerateLengthMeters) {
    return { cellId: carrier.cellId, point: vec3(carrier.position.x, carrier.position.y, 0) };
  }

  const direction = { x: dx / length, y: dy / length };
  const walk = walkDevelopedSegment({ world, cellId: carrier.cellId, start: carrier.position, direction, lengthMeters: length });
  const last = walk.pieces[walk.pieces.length - 1];
  if (!last || (walk.status !== "end" && walk.status !== "wall")) {
    return undefined;
  }

  const reach = walk.status === "end" ? length : Math.max(0, last.tExit - carryWallMarginMeters);
  const point = vec3(carrier.position.x + direction.x * reach, carrier.position.y + direction.y * reach, 0);

  return { cellId: last.cellId, point: transformPoint3(last.cellFromStart, point) };
}

/**
 * The displacement from the object to the target in the nearest valid straight development, in the object's cell frame: the way round is the
 * chain of portals whose image of the object lies nearest the target and that the straight segment really crosses. Undefined when no chain
 * of at most six portals reaches the target's cell.
 */
export function displacementToTarget(world: CompiledCellComplex, object: CarriedPlace, target: CellPoint): CarryStep | undefined {
  const from: CellPoint = { cellId: object.cellId, point: object.position };
  const near = findNearestImageRoute(world, from, target, carryNearSearchHops);
  const route = near && near.distanceMeters <= carryNearSearchMeters
    ? near
    : findNearestImageRoute(world, from, target, carryFarSearchHops) ?? near;
  if (!route) {
    return undefined;
  }

  const developed: RigidTransform3 = route.hops.reduce(
    (map, hop) => composeRigidTransform3(hop.transformToTarget, map),
    identityRigidTransform3,
  );
  const targetInObjectFrame = transformPoint3(invertRigidTransform3(developed), target.point);

  return { x: targetInObjectFrame.x - object.position.x, y: targetInObjectFrame.y - object.position.y };
}

/** How `carryTowardTarget` ended. */
export type CarryAdvanceEnd =
  | "arrived"
  | "travel-limited"
  | "step-limited"
  | "wall"
  | "detached"
  | "refused"
  | "no-route";

/** What `carryTowardTarget` did: where the object is now and how many steps were applied. */
export interface CarryAdvance {
  readonly place: CarriedPlace;
  readonly steps: number;
  readonly end: CarryAdvanceEnd;
  /** The impulse of a detach, if the object's reaction asked for one. */
  readonly impulse?: Vec3;
}

/**
 * Moves a carried object toward a target as a stream of steps: each is the displacement to the target from the object's current place (in
 * the nearest valid straight development), cut to at most the step cap and to what is left of `maxTravelMeters` (no limit when absent).
 * Every step goes to `reactToDisplacement` and its result to `commit`, which stores it and answers whether it was accepted (false stops the
 * stream with end "refused"). Pure apart from `commit`. At most `carryMaxStepsPerCall` steps are applied.
 */
export function carryTowardTarget(input: {
  readonly world: CompiledCellComplex;
  readonly object: CarriedPlace;
  readonly target: CellPoint;
  readonly maxTravelMeters?: number;
  readonly commit: (move: CarryMove) => boolean;
}): CarryAdvance {
  let place = input.object;
  let travelLeft = input.maxTravelMeters ?? Infinity;
  let steps = 0;

  while (steps < carryMaxStepsPerCall) {
    const displacement = displacementToTarget(input.world, place, input.target);
    if (!displacement) {
      return { place, steps, end: "no-route" };
    }
    const distance = Math.hypot(displacement.x, displacement.y);
    if (distance <= carryArrivalToleranceMeters) {
      return { place, steps, end: "arrived" };
    }
    if (travelLeft <= degenerateLengthMeters) {
      return { place, steps, end: "travel-limited" };
    }

    const stepLength = Math.min(distance, carryStepCapMeters, travelLeft);
    const reaction = reactToDisplacement({
      world: input.world,
      object: place,
      step: { x: (displacement.x / distance) * stepLength, y: (displacement.y / distance) * stepLength },
    });
    if ("detach" in reaction) {
      return { place, steps, end: "detached", ...(reaction.detach.impulse ? { impulse: reaction.detach.impulse } : {}) };
    }
    if ("stay" in reaction) {
      return { place, steps, end: "wall" };
    }
    if (!input.commit(reaction)) {
      return { place, steps, end: "refused" };
    }

    place = {
      ...place,
      cellId: reaction.placement.cellId,
      position: reaction.placement.position,
      yawRadians: reaction.placement.yawRadians,
    };
    steps += 1;
    travelLeft -= stepLength;
    if (reaction.stoppedByWall) {
      return { place, steps, end: "wall" };
    }
  }

  return { place, steps, end: "step-limited" };
}
