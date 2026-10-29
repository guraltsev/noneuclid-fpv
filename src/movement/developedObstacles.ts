/**
 * Collects the obstacles around a body in one flat frame by developing the neighbouring cells with the developed-disk atlas.
 * Every wall, too-low portal and forbidden-zone column of every cell copy that the disk of radius `reachMeters` around the body centre overlaps is mapped into the frame of the start cell and returned as a swept-test obstacle (a capsule or a disc) whose radius already includes the body radius. A copy only contributes an obstacle if the obstacle is within the copy's angular wedge (or within the body radius of it), so each obstacle of the plane appears once, as seen along straight rays from the centre.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import {
  clipSegmentToWedge,
  collectDevelopedDisk,
  distancePointToSegment2,
  distanceToWedge,
  wedgeContainsDirection,
} from "../cell-complex/developedDisk";
import type { Vec2xy } from "../math/polygons";
import {
  identityRigidTransform3,
  transformPoint3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import { vec3 } from "../math/vec3";
import { getDynamicObjectCollisionBounds } from "./collision";
import type { DynamicObjectState } from "./dynamicObject";
import type { SweptObstacle } from "./sweptCollision";

/**
 * A runtime body that can block a mover; the optional id identifies it for `ignoredObjectIds` and for deduplication.
 */
export type ObstacleBodyState = DynamicObjectState & { readonly id?: string };

/**
 * Input of {@link collectDevelopedObstacles}.
 */
export interface DevelopedObstacleRequest {
  readonly world: CompiledCellComplex;
  readonly cellId: string;
  /** Body centre in the frame of `cellId`. */
  readonly center: Vec2xy;
  /** Meters: radius of the developed disk, the body radius plus the largest horizontal step plus a margin. */
  readonly reachMeters: number;
  readonly bodyRadius: number;
  /** Vertical extent of the body after its vertical step; portals into cells lower than `bodyTopZ` become walls. */
  readonly bodyBottomZ: number;
  readonly bodyTopZ: number;
  readonly ignoreForbiddenZones?: boolean;
  /**
   * Maps the frame of `cellId` to the frame the obstacles are returned in; identity when omitted.
   * Used when the body centre lies in a different cell than the one whose frame the caller slides in.
   */
  readonly frameFromCell?: RigidTransform3;
  /**
   * Runtime bodies in a cell (poses in that cell's frame); each one in the developed disk becomes a disc obstacle.
   */
  readonly bodiesInCell?: (cellId: string) => readonly ObstacleBodyState[];
  /**
   * Ids of bodies in `bodiesInCell` that are not obstacles (for example the moving body itself).
   */
  readonly ignoredObjectIds?: ReadonlySet<string>;
}

/**
 * Wall, ceiling and forbidden-zone obstacles around the body centre, in the frame given by `frameFromCell`.
 * Non-portal sides become capsules of the body radius (reason "wall"); a portal side whose target cell is lower than the body top becomes a capsule with reason "ceiling"; each forbidden-zone column becomes a disc of the body radius plus the zone radius (deduplicated by position to 1e-6 m); each runtime body from `bodiesInCell` whose vertical interval overlaps the moving body's becomes a disc of the summed radii (deduplicated by object id and position).
 */
export function collectDevelopedObstacles(request: DevelopedObstacleRequest): readonly SweptObstacle[] {
  const { world, bodyRadius } = request;
  const frame = request.frameFromCell ?? identityRigidTransform3;
  const disk = collectDevelopedDisk({
    world,
    cellId: request.cellId,
    center: request.center,
    radiusMeters: request.reachMeters,
    maxNodes: 256,
  });
  const center = disk.center;
  const reach = disk.radiusMeters;
  const obstacles: SweptObstacle[] = [];
  const seenZones = new Set<string>();
  const seenBodies = new Set<string>();

  const toFrame = (p: Vec2xy): Vec2xy => {
    const q = transformPoint3(frame, vec3(p.x, p.y, 0));

    return { x: q.x, y: q.y };
  };

  for (const node of disk.nodes) {
    const cell = world.cellsById.get(node.cellId);

    if (!cell) {
      continue;
    }

    const develop = (p: { readonly x: number; readonly y: number }): Vec2xy => {
      const q = transformPoint3(node.startFromCell, vec3(p.x, p.y, 0));

      return { x: q.x, y: q.y };
    };

    for (const side of cell.sides) {
      let reason: "wall" | "ceiling" = "wall";

      if (side.portal) {
        const targetHeight = world.cellsById.get(side.portal.targetCellId)?.heightMeters ?? Infinity;

        if (!(targetHeight < request.bodyTopZ - 1e-9)) {
          continue;
        }

        reason = "ceiling";
      }

      const a = develop(side.start);
      const b = develop(side.end);

      if (distancePointToSegment2(center, a, b) > reach) {
        continue;
      }

      const inWedge =
        clipSegmentToWedge(node.wedge, center, a, b) !== undefined ||
        distanceToWedge(node.wedge, center, a) < bodyRadius ||
        distanceToWedge(node.wedge, center, b) < bodyRadius;

      if (!inWedge) {
        continue;
      }

      obstacles.push({ kind: "capsule", a: toFrame(a), b: toFrame(b), radius: bodyRadius, reason });
    }

    if (request.bodiesInCell) {
      const bodyCenterZ = (request.bodyBottomZ + request.bodyTopZ) / 2;
      const bodyHalfHeight = (request.bodyTopZ - request.bodyBottomZ) / 2;

      for (const other of request.bodiesInCell(node.cellId)) {
        if (other.id !== undefined && request.ignoredObjectIds?.has(other.id)) {
          continue;
        }

        const bounds = getDynamicObjectCollisionBounds(other);

        if (!bounds || !(Math.abs(bodyCenterZ - bounds.center.z) < bodyHalfHeight + bounds.halfHeight)) {
          continue;
        }

        const position = develop(bounds.center);
        const discRadius = bodyRadius + bounds.radius;

        if (Math.hypot(position.x - center.x, position.y - center.y) >= reach + bounds.radius) {
          continue;
        }

        const relative = { x: position.x - center.x, y: position.y - center.y };

        if (!wedgeContainsDirection(node.wedge, relative) && !(distanceToWedge(node.wedge, center, position) < discRadius)) {
          continue;
        }

        const key = `${other.id ?? ""}:${Math.round(position.x * 1e6)},${Math.round(position.y * 1e6)}`;

        if (seenBodies.has(key)) {
          continue;
        }

        seenBodies.add(key);
        obstacles.push({ kind: "disc", center: toFrame(position), radius: discRadius, reason: "body", ...(other.id !== undefined ? { objectId: other.id } : {}) });
      }
    }

    if (request.ignoreForbiddenZones) {
      continue;
    }

    for (const column of cell.singularityColumns) {
      const position = develop(column.center);
      const discRadius = bodyRadius + column.radius;

      if (Math.hypot(position.x - center.x, position.y - center.y) >= reach + column.radius) {
        continue;
      }

      const relative = { x: position.x - center.x, y: position.y - center.y };

      if (!wedgeContainsDirection(node.wedge, relative) && !(distanceToWedge(node.wedge, center, position) < discRadius)) {
        continue;
      }

      const key = `${Math.round(position.x * 1e6)},${Math.round(position.y * 1e6)}`;

      if (seenZones.has(key)) {
        continue;
      }

      seenZones.add(key);
      obstacles.push({ kind: "disc", center: toFrame(position), radius: discRadius, reason: "forbidden-zone" });
    }
  }

  return obstacles;
}
