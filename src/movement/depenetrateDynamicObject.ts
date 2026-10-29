/**
 * Pushes a body that overlaps forbidden-zone cylinders or walls of its cell back to a legal pose. Used after a deformation commit, which maps poses by a non-rigid map and can leave a body inside an obstacle.
 * Each round pushes the body radially out of every overlapping zone to zone radius + body radius + 1e-6, then along the inward normal out of every overlapping wall, then crosses a portal if the body's anchor left the cell; at most 4 rounds. If that does not give a legal pose, the free point of a grid over the cell nearest to the mapped position is used; if none exists the result is "failed".
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../cell-complex/prismCells";
import { rigidTransform3 } from "../math/rigidTransform3";
import { zeroDistanceToleranceMeters } from "../math/tolerances";
import { vec3 } from "../math/vec3";
import { getDynamicObjectCollisionBounds, signedDistanceToSide, testCellCollision } from "./collision";
import type { DynamicObjectState } from "./dynamicObject";
import { crossDynamicObjectPortal } from "./portalCrossing";

/** Extra clearance, meters, added beyond exact contact so the pushed pose is strictly legal. */
export const depenetrationMarginMeters = 1e-6;
/** Maximum push rounds before falling back to grid sampling. */
export const maxDepenetrationRounds = 4;

/** Options for {@link depenetrateDynamicObject}. */
export interface DepenetrationOptions {
  /** If true, forbidden zones are ignored and only walls (and floor/ceiling) count. */
  readonly ignoreForbiddenZones?: boolean;
}

/**
 * Outcome: "unchanged" (already legal; `object` is the input object itself), "pushed" (fixed by pushes),
 * "sampled" (fixed by the grid fallback), "failed" (no legal pose found; `object` is the input object).
 */
export interface DepenetrationResult {
  readonly kind: "unchanged" | "pushed" | "sampled" | "failed";
  readonly object: DynamicObjectState;
}

/**
 * Returns a legal pose near `object` in the compiled world: unchanged if it is already legal, otherwise pushed out of
 * zones (radially), then walls (along the inward normal), then through a portal if the anchor left the cell, for up
 * to 4 rounds, then the nearest free grid sample. Never throws; a missing cell or no free pose gives "failed".
 */
export function depenetrateDynamicObject(
  world: CompiledCellComplex,
  object: DynamicObjectState,
  options: DepenetrationOptions = {},
): DepenetrationResult {
  if (!object.collision || !isBlocked(world, object, options)) {
    return { kind: "unchanged", object };
  }
  let current = object;
  for (let round = 0; round < maxDepenetrationRounds; round += 1) {
    const cell = world.cellsById.get(current.cellId);
    if (!cell) {
      return { kind: "failed", object };
    }
    current = pushOutOfZonesAndWalls(cell, current, options);
    current = crossPortalIfAnchorLeft(cell, current);
    if (!isBlocked(world, current, options)) {
      return { kind: "pushed", object: current };
    }
  }
  const sampled = nearestFreeGridSample(world, object, options);
  return sampled ? { kind: "sampled", object: sampled } : { kind: "failed", object };
}

function isBlocked(world: CompiledCellComplex, object: DynamicObjectState, options: DepenetrationOptions): boolean {
  const cell = world.cellsById.get(object.cellId);
  if (!cell) {
    return true;
  }
  return testCellCollision({ cell, object, ignoreForbiddenZones: options.ignoreForbiddenZones }).blocked;
}

function translateBy(object: DynamicObjectState, dx: number, dy: number): DynamicObjectState {
  const t = object.localPose.translation;
  return { ...object, localPose: rigidTransform3(object.localPose.rotation, vec3(t.x + dx, t.y + dy, t.z)) };
}

function pushOutOfZonesAndWalls(
  cell: CompiledPrismCell,
  object: DynamicObjectState,
  options: DepenetrationOptions,
): DynamicObjectState {
  let current = object;
  if (!options.ignoreForbiddenZones) {
    for (const zone of cell.singularityColumns) {
      const bounds = getDynamicObjectCollisionBounds(current)!;
      const dx = bounds.center.x - zone.center.x;
      const dy = bounds.center.y - zone.center.y;
      const distance = Math.hypot(dx, dy);
      const required = zone.radius + bounds.radius + depenetrationMarginMeters;
      if (distance >= required) {
        continue;
      }
      let nx = dx / distance;
      let ny = dy / distance;
      if (!(distance > zeroDistanceToleranceMeters)) {
        const count = cell.baseVertices.length;
        const cx = cell.baseVertices.reduce((sum, vertex) => sum + vertex.x, 0) / count - zone.center.x;
        const cy = cell.baseVertices.reduce((sum, vertex) => sum + vertex.y, 0) / count - zone.center.y;
        const cLength = Math.hypot(cx, cy);
        nx = cLength > 0 ? cx / cLength : 1;
        ny = cLength > 0 ? cy / cLength : 0;
      }
      const push = required - (distance > zeroDistanceToleranceMeters ? distance : 0);
      current = translateBy(current, nx * push, ny * push);
    }
  }
  for (const side of cell.sides) {
    if (side.portal) {
      continue;
    }
    const bounds = getDynamicObjectCollisionBounds(current)!;
    const clearance = signedDistanceToSide(side, bounds.center) - bounds.radius;
    if (clearance >= 0) {
      continue;
    }
    const push = -clearance + depenetrationMarginMeters;
    current = translateBy(current, side.inwardNormal.x * push, side.inwardNormal.y * push);
  }
  return current;
}

function crossPortalIfAnchorLeft(cell: CompiledPrismCell, object: DynamicObjectState): DynamicObjectState {
  let worst = Infinity;
  let worstSide: (typeof cell.sides)[number] | undefined;
  for (const side of cell.sides) {
    const distance = signedDistanceToSide(side, object.localPose.translation);
    if (distance < worst) {
      worst = distance;
      worstSide = side;
    }
  }
  if (worst < 0 && worstSide?.portal) {
    return crossDynamicObjectPortal(object, worstSide.portal);
  }
  return object;
}

function nearestFreeGridSample(
  world: CompiledCellComplex,
  object: DynamicObjectState,
  options: DepenetrationOptions,
): DynamicObjectState | undefined {
  const cell = world.cellsById.get(object.cellId);
  if (!cell) {
    return undefined;
  }
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spacing = Math.max(0.1, Math.max(maxX - minX, maxY - minY) / 200);
  const t = object.localPose.translation;
  let best: DynamicObjectState | undefined;
  let bestDistance = Infinity;
  for (let x = minX; x <= maxX; x += spacing) {
    for (let y = minY; y <= maxY; y += spacing) {
      const point = vec3(x, y, t.z);
      if (cell.sides.some((side) => signedDistanceToSide(side, point) < 0)) {
        continue;
      }
      const distance = (x - t.x) ** 2 + (y - t.y) ** 2;
      if (distance >= bestDistance) {
        continue;
      }
      const candidate: DynamicObjectState = {
        ...object,
        localPose: rigidTransform3(object.localPose.rotation, point),
      };
      if (!isBlocked(world, candidate, options)) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}
