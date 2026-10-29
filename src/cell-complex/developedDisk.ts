/**
 * Developed-disk atlas: lists every cell copy that a disk of radius rho around a point overlaps.
 * Starting from the centre's cell with the full circle of directions, each portal side that faces away from the centre and whose developed segment, clipped to the current angular wedge, comes closer than rho spawns a child copy. The child's wedge is the current wedge intersected with the wedge spanned by that side seen from the centre. Every point of the plane is reached by exactly one ray from the centre, so the copies tile the disk: each point of the disk lies in exactly one copy (inside its developed polygon and inside its wedge).
 * A centre within 1e-7 m of a side is first moved 1e-7 m inward (and rho grown by the same amount) so that it is strictly inside its cell.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import type { CompiledPrismSide } from "./prismCells";
import type { Vec2xy } from "../math/polygons";
import {
  composeRigidTransform3,
  orthonormalizeYawRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import { wedgeCrossTolerance, parallelConstraintTolerance, degenerateLengthMeters, sideBoundaryToleranceMeters } from "../math/tolerances";
import { vec3 } from "../math/vec3";

/**
 * Directions seen from the disk centre. "full" is the whole circle; "cone" runs counterclockwise from `from` to `to`
 * (cross(from, to) > 0, opening below pi).
 */
export type DevelopedWedge =
  | { readonly kind: "full" }
  | { readonly kind: "cone"; readonly from: Vec2xy; readonly to: Vec2xy };

/**
 * One cell copy of the atlas.
 */
export interface DevelopedDiskNode {
  readonly cellId: string;
  /** Start-cell frame to this copy's frame. */
  readonly cellFromStart: RigidTransform3;
  /** This copy's frame to the start-cell frame. */
  readonly startFromCell: RigidTransform3;
  /** Directions from the centre (start-cell frame) that belong to this copy. */
  readonly wedge: DevelopedWedge;
  /** Portal hops from the start cell. */
  readonly depth: number;
  /** Side of this copy through which it was reached; undefined for the start cell. */
  readonly entrySideIndex?: number;
}

/**
 * Input of {@link collectDevelopedDisk}; the centre is in the frame of the start cell.
 */
export interface DevelopedDiskRequest {
  readonly world: CompiledCellComplex;
  readonly cellId: string;
  /** In the frame of `cellId`. */
  readonly center: Vec2xy;
  readonly radiusMeters: number;
  /** Default 64. */
  readonly maxNodes?: number;
}

/**
 * The atlas: cell copies tiling the disk, with the centre and radius actually used.
 */
export interface DevelopedDiskResult {
  /** The centre after the inward nudge; callers must use this value. */
  readonly center: Vec2xy;
  /** The radius after the nudge; callers must use this value. */
  readonly radiusMeters: number;
  readonly nodes: readonly DevelopedDiskNode[];
  /** True when `maxNodes` stopped the search. */
  readonly truncated: boolean;
}

const nudgeMeters = 1e-7;

function cross(a: Vec2xy, b: Vec2xy): number {
  return a.x * b.y - a.y * b.x;
}

function sub(a: Vec2xy, b: Vec2xy): Vec2xy {
  return { x: a.x - b.x, y: a.y - b.y };
}

function signedDistance(side: CompiledPrismSide, p: Vec2xy): number {
  return (p.x - side.start.x) * side.inwardNormal.x + (p.y - side.start.y) * side.inwardNormal.y;
}

/**
 * Whether `direction` lies in the wedge (boundary included, tolerance 1e-12 on the cross products).
 */
export function wedgeContainsDirection(wedge: DevelopedWedge, direction: Vec2xy): boolean {
  return wedge.kind === "full" || (cross(wedge.from, direction) >= -wedgeCrossTolerance && cross(direction, wedge.to) >= -wedgeCrossTolerance);
}

/**
 * Intersection of two wedges, or undefined when it is empty (or degenerate).
 */
export function intersectWedges(a: DevelopedWedge, b: DevelopedWedge): DevelopedWedge | undefined {
  if (a.kind === "full") {
    return b;
  }

  if (b.kind === "full") {
    return a;
  }

  const from = wedgeContainsDirection(b, a.from) ? a.from : wedgeContainsDirection(a, b.from) ? b.from : undefined;
  const to = wedgeContainsDirection(b, a.to) ? a.to : wedgeContainsDirection(a, b.to) ? b.to : undefined;

  if (!from || !to || cross(from, to) <= wedgeCrossTolerance) {
    return undefined;
  }

  return { kind: "cone", from, to };
}

/**
 * Keeps the part of the segment a-b that lies inside the wedge with apex `center`, or undefined when none does.
 */
export function clipSegmentToWedge(
  wedge: DevelopedWedge,
  center: Vec2xy,
  a: Vec2xy,
  b: Vec2xy,
): readonly [Vec2xy, Vec2xy] | undefined {
  if (wedge.kind === "full") {
    return [a, b];
  }

  const rel = sub(a, center);
  const d = sub(b, a);
  const constraints: readonly (readonly [number, number])[] = [
    [cross(wedge.from, rel), cross(wedge.from, d)],
    [cross(rel, wedge.to), cross(d, wedge.to)],
  ];
  let u0 = 0;
  let u1 = 1;

  for (const [f0, f1] of constraints) {
    if (Math.abs(f1) < parallelConstraintTolerance) {
      if (f0 < 0) {
        return undefined;
      }

      continue;
    }

    const u = -f0 / f1;

    if (f1 > 0) {
      u0 = Math.max(u0, u);
    } else {
      u1 = Math.min(u1, u);
    }
  }

  if (u0 > u1) {
    return undefined;
  }

  return [
    { x: a.x + u0 * d.x, y: a.y + u0 * d.y },
    { x: a.x + u1 * d.x, y: a.y + u1 * d.y },
  ];
}

/**
 * Distance from `point` to the segment a-b, meters.
 */
export function distancePointToSegment2(point: Vec2xy, a: Vec2xy, b: Vec2xy): number {
  const d = sub(b, a);
  const lengthSquared = d.x * d.x + d.y * d.y;
  const u = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * d.x + (point.y - a.y) * d.y) / lengthSquared));

  return Math.hypot(point.x - (a.x + u * d.x), point.y - (a.y + u * d.y));
}

/**
 * Distance from `point` to the wedge with apex `center`; 0 when the point is inside.
 */
export function distanceToWedge(wedge: DevelopedWedge, center: Vec2xy, point: Vec2xy): number {
  if (wedge.kind === "full" || wedgeContainsDirection(wedge, sub(point, center))) {
    return 0;
  }

  const rayDistance = (direction: Vec2xy): number => {
    const length = Math.hypot(direction.x, direction.y);
    const far = { x: center.x + (direction.x / length) * 1e12, y: center.y + (direction.y / length) * 1e12 };

    return distancePointToSegment2(point, center, far);
  };

  return Math.min(rayDistance(wedge.from), rayDistance(wedge.to));
}

/**
 * Collects every cell copy overlapped by the disk of `radiusMeters` around `center`, with its developing transform and wedge.
 */
export function collectDevelopedDisk(request: DevelopedDiskRequest): DevelopedDiskResult {
  const { world } = request;
  const maxNodes = request.maxNodes ?? 64;
  const startCell = world.cellsById.get(request.cellId);

  if (!startCell) {
    return { center: request.center, radiusMeters: request.radiusMeters, nodes: [], truncated: false };
  }

  let center = request.center;
  let radius = request.radiusMeters;
  const near = startCell.sides.filter((side) => signedDistance(side, center) < nudgeMeters);

  if (near.length > 0) {
    let nx = 0;
    let ny = 0;

    for (const side of near) {
      nx += side.inwardNormal.x;
      ny += side.inwardNormal.y;
    }

    const length = Math.hypot(nx, ny);

    if (length > degenerateLengthMeters) {
      center = { x: center.x + (nudgeMeters * nx) / length, y: center.y + (nudgeMeters * ny) / length };
    }

    radius += nudgeMeters;
  }

  const nodes: DevelopedDiskNode[] = [
    {
      cellId: startCell.id,
      cellFromStart: identityRigidTransform3,
      startFromCell: identityRigidTransform3,
      wedge: { kind: "full" },
      depth: 0,
    },
  ];
  let truncated = false;

  for (let q = 0; q < nodes.length; q += 1) {
    const node = nodes[q];
    const cell = world.cellsById.get(node.cellId);

    if (!cell) {
      continue;
    }

    const local = transformPoint3(node.cellFromStart, vec3(center.x, center.y, 0));

    for (const side of cell.sides) {
      const portal = side.portal;

      if (!portal || signedDistance(side, local) <= sideBoundaryToleranceMeters) {
        continue;
      }

      const s3 = transformPoint3(node.startFromCell, vec3(side.start.x, side.start.y, 0));
      const e3 = transformPoint3(node.startFromCell, vec3(side.end.x, side.end.y, 0));
      const s = { x: s3.x, y: s3.y };
      const e = { x: e3.x, y: e3.y };
      const clipped = clipSegmentToWedge(node.wedge, center, s, e);

      if (!clipped || distancePointToSegment2(center, clipped[0], clipped[1]) >= radius) {
        continue;
      }

      const wedge = intersectWedges(node.wedge, { kind: "cone", from: sub(s, center), to: sub(e, center) });

      if (!wedge) {
        continue;
      }

      if (nodes.length >= maxNodes) {
        truncated = true;
        continue;
      }

      const target = world.cellsById.get(portal.targetCellId);
      const reciprocal = target?.portalsById.get(portal.reciprocalPortalId);

      if (!target || !reciprocal) {
        continue;
      }

      const cellFromStart = orthonormalizeYawRigidTransform3(composeRigidTransform3(portal.transformToTarget, node.cellFromStart));

      nodes.push({
        cellId: target.id,
        cellFromStart,
        startFromCell: invertRigidTransform3(cellFromStart),
        wedge,
        depth: node.depth + 1,
        entrySideIndex: reciprocal.sideIndex,
      });
    }
  }

  return { center, radiusMeters: radius, nodes, truncated };
}
