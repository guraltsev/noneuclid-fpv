/**
 * Shared segment-walk kernel: walks a straight segment, given in the frame of its start cell, through the glued convex cells.
 * The segment is one straight line in the developed frame of the start cell, P(t) = A + t d (meters). Its piece in the k-th cell is M_k(P(t)) for t in [tEnter, tExit], where M_k composes the portal transforms crossed so far. The exit side of a convex cell is the outgoing side (dot(direction, inwardNormal) < 0) with the smallest crossing parameter; the side the walk entered through is excluded by index. Nothing is nudged past a portal, so piece windows add up exactly to the requested length.
 * Vertex rule: when two adjacent sides tie (within segmentWalkVertexTieMeters) the line passes through their shared vertex and the walk exits through the side that starts at that vertex (the counterclockwise successor). This equals displacing the line infinitesimally to its left, one global rule for every cell and gluing. The next cell may then be left again at once, giving a zero-length piece.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import type { CompiledPrismCell, CompiledPrismSide } from "./prismCells";
import type { CompiledPortal } from "./specs";
import type { Vec2xy } from "../math/polygons";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  transformDirection3,
  transformPoint3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import {
  cellContainmentToleranceMeters,
  segmentWalkOutgoingDotTolerance,
  segmentWalkVertexTieMeters,
} from "../math/tolerances";
import { vec3 } from "../math/vec3";

/**
 * One portal crossing during a walk, in walk order.
 */
export interface SegmentWalkCrossing {
  readonly sourceCellId: string;
  /** Portal id in the source cell. */
  readonly portalId: string;
  readonly sourceSideIndex: number;
  readonly targetCellId: string;
  readonly targetPortalId: string;
  readonly targetSideIndex: number;
  readonly transformToTarget: RigidTransform3;
  /** Walk parameter of the crossing, meters. */
  readonly tMeters: number;
}

/**
 * How a piece ends: at the end of the segment, through a portal, or at a wall (a side without a portal).
 * `throughVertexIndex` is the vertex of the exited cell shared by the tied sides when a tie decided the exit.
 */
export type SegmentWalkExit =
  | { readonly kind: "end" }
  | {
      readonly kind: "portal";
      readonly sideIndex: number;
      readonly portal: CompiledPortal;
      readonly throughVertexIndex?: number;
    }
  | { readonly kind: "wall"; readonly sideIndex: number; readonly throughVertexIndex?: number };

/**
 * The part of the segment inside one cell.
 */
export interface SegmentWalkPiece {
  readonly cellId: string;
  /** Start-cell frame to this cell's frame. */
  readonly cellFromStart: RigidTransform3;
  /** Meters; 0 for the first piece. */
  readonly tEnter: number;
  /** Meters; at least `tEnter`. */
  readonly tExit: number;
  /** Undefined for the first piece unless the request gave one. */
  readonly entrySideIndex?: number;
  readonly exit: SegmentWalkExit;
}

/**
 * Why a walk stopped: whole length walked, wall hit, crossing limit reached, start outside its cell, or a cell id that cannot be resolved.
 */
export type SegmentWalkStatus = "end" | "wall" | "crossing-limit" | "start-outside" | "missing-cell";

/**
 * Result of a walk: status, the cell pieces in walk order and the portal crossings between them.
 */
export interface SegmentWalkResult {
  readonly status: SegmentWalkStatus;
  readonly pieces: readonly SegmentWalkPiece[];
  readonly crossings: readonly SegmentWalkCrossing[];
}

/**
 * Input of {@link walkDevelopedSegment}; start and direction are in the frame of the start cell.
 */
export interface SegmentWalkRequest {
  readonly world: CompiledCellComplex;
  readonly cellId: string;
  /** In the frame of `cellId`. */
  readonly start: Vec2xy;
  /** Normalized by the function; must not be zero. */
  readonly direction: Vec2xy;
  /** Meters, at least 0. */
  readonly lengthMeters: number;
  /** Side of the start cell to ignore (the walk just came through it). */
  readonly entrySideIndex?: number;
  /** Default 64. */
  readonly maxCrossings?: number;
}

const defaultMaxCrossings = 64;

function signedDistance(side: CompiledPrismSide, p: Vec2xy): number {
  return (p.x - side.start.x) * side.inwardNormal.x + (p.y - side.start.y) * side.inwardNormal.y;
}

/**
 * Walks the straight segment from `start` along `direction` for `lengthMeters` through the cells of `world`.
 * Returns every cell piece with its parameter window, the portals crossed and the composed transform of each cell.
 * Status "end" means the whole length was walked; "wall" that a side without a portal stopped it (the last piece's exit
 * says which); "crossing-limit" that `maxCrossings` was reached; "start-outside" that the start lies more than
 * cellContainmentToleranceMeters outside its cell (no pieces); "missing-cell" that a cell id could not be resolved.
 */
export function walkDevelopedSegment(request: SegmentWalkRequest): SegmentWalkResult {
  const { world, start, lengthMeters } = request;
  const maxCrossings = request.maxCrossings ?? defaultMaxCrossings;
  const directionLength = Math.hypot(request.direction.x, request.direction.y);

  if (!(directionLength > 1e-12)) {
    throw new Error("walkDevelopedSegment: direction must not be zero.");
  }

  const dir = { x: request.direction.x / directionLength, y: request.direction.y / directionLength };
  let cell: CompiledPrismCell | undefined = world.cellsById.get(request.cellId);

  if (!cell) {
    return { status: "missing-cell", pieces: [], crossings: [] };
  }

  if (cell.sides.some((side) => signedDistance(side, start) < -cellContainmentToleranceMeters)) {
    return { status: "start-outside", pieces: [], crossings: [] };
  }

  const pieces: SegmentWalkPiece[] = [];
  const crossings: SegmentWalkCrossing[] = [];
  let cellFromStart = identityRigidTransform3;
  let entry = request.entrySideIndex;
  let entryForPiece = request.entrySideIndex;
  let tEnter = 0;

  for (let k = 0; k <= maxCrossings; k += 1) {
    const a = transformPoint3(cellFromStart, vec3(start.x, start.y, 0));
    const d = transformDirection3(cellFromStart, vec3(dir.x, dir.y, 0));
    const sideCount = cell.sides.length;
    let best: { readonly side: CompiledPrismSide; readonly t: number } | undefined;
    let tiedVertex: number | undefined;

    for (const side of cell.sides) {
      if (side.sideIndex === entry) {
        continue;
      }

      const dn = d.x * side.inwardNormal.x + d.y * side.inwardNormal.y;

      if (dn >= -segmentWalkOutgoingDotTolerance) {
        continue;
      }

      const t = signedDistance(side, a) / -dn;

      if (!best || t < best.t - segmentWalkVertexTieMeters) {
        best = { side, t };
        tiedVertex = undefined;
      } else if (Math.abs(t - best.t) <= segmentWalkVertexTieMeters) {
        if ((best.side.sideIndex + 1) % sideCount === side.sideIndex) {
          tiedVertex = side.sideIndex;
          best = { side, t };
        } else if ((side.sideIndex + 1) % sideCount === best.side.sideIndex) {
          tiedVertex = best.side.sideIndex;
        }
      }
    }

    const tExit = best ? Math.max(best.t, tEnter) : Infinity;

    if (!best || tExit >= lengthMeters) {
      pieces.push({
        cellId: cell.id,
        cellFromStart,
        tEnter,
        tExit: Math.max(lengthMeters, tEnter),
        ...(entryForPiece !== undefined ? { entrySideIndex: entryForPiece } : {}),
        exit: { kind: "end" },
      });
      return { status: "end", pieces, crossings };
    }

    const portal = best.side.portal;

    if (!portal) {
      pieces.push({
        cellId: cell.id,
        cellFromStart,
        tEnter,
        tExit,
        ...(entryForPiece !== undefined ? { entrySideIndex: entryForPiece } : {}),
        exit: {
          kind: "wall",
          sideIndex: best.side.sideIndex,
          ...(tiedVertex !== undefined ? { throughVertexIndex: tiedVertex } : {}),
        },
      });
      return { status: "wall", pieces, crossings };
    }

    pieces.push({
      cellId: cell.id,
      cellFromStart,
      tEnter,
      tExit,
      ...(entryForPiece !== undefined ? { entrySideIndex: entryForPiece } : {}),
      exit: {
        kind: "portal",
        sideIndex: best.side.sideIndex,
        portal,
        ...(tiedVertex !== undefined ? { throughVertexIndex: tiedVertex } : {}),
      },
    });

    const target: CompiledPrismCell | undefined = world.cellsById.get(portal.targetCellId);
    const reciprocal = target?.portalsById.get(portal.reciprocalPortalId);

    if (!target || !reciprocal) {
      return { status: "missing-cell", pieces, crossings };
    }

    crossings.push({
      sourceCellId: cell.id,
      portalId: portal.id,
      sourceSideIndex: best.side.sideIndex,
      targetCellId: target.id,
      targetPortalId: reciprocal.id,
      targetSideIndex: reciprocal.sideIndex,
      transformToTarget: portal.transformToTarget,
      tMeters: tExit,
    });
    cellFromStart = composeRigidTransform3(portal.transformToTarget, cellFromStart);
    cell = target;
    entry = reciprocal.sideIndex;
    entryForPiece = reciprocal.sideIndex;
    tEnter = tExit;
  }

  return { status: "crossing-limit", pieces, crossings };
}

/**
 * Finds the cell and frame of `to`, reached by the straight segment from `from` (both in the frame of `cellId`).
 * For status "wall" the cell is the one where the wall was hit. A zero-length request returns the start cell without walking.
 */
export function locateDevelopedPoint(
  world: CompiledCellComplex,
  cellId: string,
  from: Vec2xy,
  to: Vec2xy,
  maxCrossings?: number,
): {
  readonly status: SegmentWalkStatus;
  readonly cellId: string;
  readonly cellFromStart: RigidTransform3;
  readonly crossings: readonly SegmentWalkCrossing[];
} {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 1e-12) {
    return { status: "end", cellId, cellFromStart: identityRigidTransform3, crossings: [] };
  }

  const result = walkDevelopedSegment({
    world,
    cellId,
    start: from,
    direction: { x: dx, y: dy },
    lengthMeters: length,
    ...(maxCrossings !== undefined ? { maxCrossings } : {}),
  });
  const last = result.pieces[result.pieces.length - 1];

  return {
    status: result.status,
    cellId: last ? last.cellId : cellId,
    cellFromStart: last ? last.cellFromStart : identityRigidTransform3,
    crossings: result.crossings,
  };
}
