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
 *   - A portal junction's exclusion zone is a wall (maintainer, 2026-11-01): a step that would enter the zone widened by the body radius, or
 *     sweep through it, is cut short just before the zone (`carryZoneMarginMeters`) and the reaction says it was stopped by the zone. The
 *     object is still carried, nothing is destroyed or detached because of a zone, and the hand can move on: the next step away from the
 *     zone is free. This replaces the earlier rules "drop at the last valid position on a swept junction" and "destroy on touch". Every
 *     step is a valid shorter step, so a locked geodesic stays chained. The zone geometry is the shared swept-collision code of the
 *     movement layer (`collectDevelopedObstacles`, `sweepDiscAgainstObstacle`), so creatures and carried emitters see the same zones; the
 *     difference is that a carried object stops where a creature slides. Walls stay as above (the anchor stops, not the body).
 *   - A later kick is not part of this contract: if touching a zone should ever end a carry and fling the object, that is a new outcome of
 *     this reaction and a change in this one function.
 * - Release is a detach and nothing else on the carrier's side, and so is the decision to let go of a distant object, which is the
 *   carrier's policy (`src/interaction/handCarry.ts` for the hand), not the object's. What the emitter does to its geodesics when the carry
 *   ends (the final rebuild without the carry's safety net, pruning what vanished) is a rule of the emitter, in `geodesic/carryEnd.ts`
 *   (`releaseCarriedEmitter`); every carrier ends a carry through it.
 * - Carriers should not carry an object another carrier holds; if they do, the steps interleave, which is safe (every step is checked
 *   on its own) but erratic. The contract stays stateless and keeps no table of carriers.
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
import { collisionSkinMeters, degenerateLengthMeters } from "../math/tolerances";
import { vec3, type Vec3 } from "../math/vec3";
import { collectDevelopedObstacles } from "../movement/developedObstacles";
import { sweepDiscAgainstObstacle } from "../movement/sweptCollision";
import type { CarryHighlightShape } from "./carryHighlightShape";
import { sanitizeYaw } from "./geodesic/objects";

/** Longest displacement step the reaction is defined for, in meters. */
export const carryStepCapMeters = 1;
/** Fastest travel of a carried object toward its carrier's hand, in meters per second (about 20 m/s). */
export const carryMaxSpeedMetersPerSecond = 20;
/** Distance a carried object keeps from a wall it was stopped by, in meters. */
export const carryWallMarginMeters = 0.02;
/** Distance a carried object keeps from an exclusion zone it was stopped by, in meters: the skin the movement layer keeps from every obstacle. */
export const carryZoneMarginMeters = collisionSkinMeters;
/** Distance to the target under which the object counts as having arrived, in meters. */
export const carryArrivalToleranceMeters = 1e-4;
/** Most steps one call of `carryTowardTarget` applies; the rest of the way is left to the next frame. */
export const carryMaxStepsPerCall = 64;
// The search for the straight development to the target: a frame's walk crosses a portal or two; a pickup from another face is a longer
// search, used only when the short one finds nothing within `carryNearSearchMeters`.
const carryNearSearchHops = 2;
const carryNearSearchMeters = 1;
const carryFarSearchHops = 6;

/** Marker on an object type: it can be carried, and (optionally) the shape of its carry highlight. Checked by `canBeCarried`. */
export interface CarriableMarker {
  readonly canBeCarried?: true;
  /** The object's own highlight shape; objects without one get the sphere of `carryHighlightShapeOf`. */
  readonly carryHighlight?: CarryHighlightShape;
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
  /** Radius of the object's body, added to the radius of every exclusion zone it must keep out of; default 0. */
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

/** The step moved the object: its new place, the portals crossed (in order) and whether a wall or an exclusion zone cut the step short. */
export interface CarryMove {
  readonly placement: CarryPlacement;
  readonly route: readonly PortalRouteHop[];
  readonly stoppedByWall?: true;
  readonly stoppedByZone?: true;
}

/** Why a step did not move the object. */
export type CarryStayReason = "wall" | "zone" | "step-exceeds-cap" | "walk-failed";

/** What an object does with one displacement step: it moves (possibly cut short), or it stays. The object stays carried either way. */
export type CarryReaction = CarryMove | { readonly stay: CarryStayReason };

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
  let stoppedByZone = false;

  if (walk.status === "wall") {
    const wallPiece = walk.pieces[walk.pieces.length - 1];
    travelled = Math.max(0, (wallPiece?.tExit ?? 0) - carryWallMarginMeters);
    if (travelled <= degenerateLengthMeters) {
      return { stay: "wall" };
    }
    walk = walkTo(travelled);
    stoppedByWall = true;
  }

  // An exclusion zone is a wall too: the part of the step before the body would touch a zone, less the margin.
  const beforeZone = distanceBeforeExclusionZone(world, object, start, direction, travelled);
  if (beforeZone !== undefined) {
    if (beforeZone <= degenerateLengthMeters) {
      return { stay: "zone" };
    }
    travelled = beforeZone;
    walk = walkTo(travelled);
    stoppedByWall = false;
    stoppedByZone = true;
  }
  const last = walk.pieces[walk.pieces.length - 1];
  if (walk.status !== "end" || !last) {
    return { stay: "walk-failed" };
  }

  const endInStartFrame = { x: start.x + direction.x * travelled, y: start.y + direction.y * travelled };
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

  if (stoppedByZone) {
    return { ...move, stoppedByZone: true };
  }

  return stoppedByWall ? { ...move, stoppedByWall: true } : move;
}

// How far along the straight step (at most `length` meters) the body can go before it would touch an exclusion zone, less the margin; undefined
// when it touches none. The zones are those of the shared movement code: `collectDevelopedObstacles` develops the neighbouring cells around the
// body and returns each zone as a disc of the zone's radius plus the body's, and `sweepDiscAgainstObstacle` finds the first approaching hit
// (a body already inside a zone may move away from it or along it, never deeper in). A creature slides along what it hits; a carried object stops.
function distanceBeforeExclusionZone(
  world: CompiledCellComplex,
  object: CarriedPlace,
  start: { readonly x: number; readonly y: number },
  direction: { readonly x: number; readonly y: number },
  length: number,
): number | undefined {
  const radius = object.radiusMeters ?? 0;
  const obstacles = collectDevelopedObstacles({
    world,
    cellId: object.cellId,
    center: start,
    reachMeters: radius + length + 2 * collisionSkinMeters,
    bodyRadius: radius,
    bodyBottomZ: object.position.z,
    bodyTopZ: object.position.z,
  });
  const path = { x: direction.x * length, y: direction.y * length };
  let firstS: number | undefined;

  for (const obstacle of obstacles) {
    if (obstacle.reason !== "forbidden-zone") {
      continue;
    }
    const hit = sweepDiscAgainstObstacle(start, path, obstacle);
    if (hit && (firstS === undefined || hit.s < firstS)) {
      firstS = hit.s;
    }
  }

  return firstS === undefined ? undefined : Math.max(0, firstS * length - carryZoneMarginMeters);
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

/** How `carryTowardTarget` ended. The object is still carried after every one of these; letting go is the carrier's decision. */
export type CarryAdvanceEnd =
  | "arrived"
  | "travel-limited"
  | "step-limited"
  | "wall"
  | "zone"
  | "refused"
  | "no-route";

/**
 * How far the object is from the target: the length of the displacement along the valid straight development, in meters, or
 * "unreachable" when no development of at most six portals reaches the target. A carrier decides from this whether to hold on or let go.
 */
export type CarryRemaining = number | "unreachable";

/** What `carryTowardTarget` did: where the object is now, how many steps were applied and how far from the target it ended. */
export interface CarryAdvance {
  readonly place: CarriedPlace;
  readonly steps: number;
  readonly end: CarryAdvanceEnd;
  /** Distance from `place` to the target when the call ended, or "unreachable". */
  readonly remaining: CarryRemaining;
}

/** The distance from the object to the target along the valid straight development, or "unreachable". */
export function remainingToTarget(world: CompiledCellComplex, object: CarriedPlace, target: CellPoint): CarryRemaining {
  const displacement = displacementToTarget(world, object, target);

  return displacement ? Math.hypot(displacement.x, displacement.y) : "unreachable";
}

/**
 * Moves a carried object toward a target as a stream of steps: each is the displacement to the target from the object's current place (in
 * the nearest valid straight development), cut to at most the step cap and to what is left of `maxTravelMeters` (no limit when absent).
 * Every step goes to `reactToDisplacement` and its result to `commit`, which stores it and answers whether it was accepted (false stops the
 * stream with end "refused"). A step cut short by a wall or an exclusion zone ends the call with "wall" or "zone" and the object stays
 * carried. The result reports the remaining distance to the target, for the carrier's own policy. Pure apart from `commit`.
 * At most `carryMaxStepsPerCall` steps are applied.
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
  // The distance measured from the current place at the top of the loop; it is the answer whenever the loop ends before the object moves again.
  let remaining: CarryRemaining = "unreachable";
  const ended = (end: CarryAdvanceEnd, measuredFromPlace: boolean): CarryAdvance => ({
    place,
    steps,
    end,
    remaining: measuredFromPlace ? remaining : remainingToTarget(input.world, place, input.target),
  });

  while (steps < carryMaxStepsPerCall) {
    const displacement = displacementToTarget(input.world, place, input.target);
    if (!displacement) {
      remaining = "unreachable";
      return ended("no-route", true);
    }
    const distance = Math.hypot(displacement.x, displacement.y);
    remaining = distance;
    if (distance <= carryArrivalToleranceMeters) {
      return ended("arrived", true);
    }
    if (travelLeft <= degenerateLengthMeters) {
      return ended("travel-limited", true);
    }

    const stepLength = Math.min(distance, carryStepCapMeters, travelLeft);
    const reaction = reactToDisplacement({
      world: input.world,
      object: place,
      step: { x: (displacement.x / distance) * stepLength, y: (displacement.y / distance) * stepLength },
    });
    if ("stay" in reaction) {
      return ended(reaction.stay === "zone" ? "zone" : "wall", true);
    }
    if (!input.commit(reaction)) {
      return ended("refused", true);
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
      return ended("wall", false);
    }
    if (reaction.stoppedByZone) {
      return ended("zone", false);
    }
  }

  return ended("step-limited", false);
}
