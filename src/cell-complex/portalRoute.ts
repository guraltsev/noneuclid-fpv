/**
 * Routes through portals that best explain a movement: which chain of portals an object crossed to get from one place to another.
 * Where an object is on the surface (a cell and a point in its frame) does not say which way round it got there, so the chain is chosen geometrically:
 * among the chains of at most a given number of portals from the old cell to the new one, the one whose image of the old point lies nearest the new point
 * *and* that the straight segment from the old point to that image really crosses. (Without the second condition a chain that winds around a vertex
 * can have a nearer image, but no straight path on the surface leads to it.) For a step of one frame that is the chain actually crossed; for a jump it is
 * the shortest straight development from the old place to the new one.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import { composeRigidTransform3, identityRigidTransform3, invertRigidTransform3, transformPoint3, type RigidTransform3 } from "../math/rigidTransform3";
import { locateDevelopedPoint } from "./segmentWalk";
import { distanceVec3, type Vec3 } from "../math/vec3";

/** One portal crossed on a route: the portal left, the reciprocal portal entered, and the map from the source cell's frame to the target cell's. */
export interface PortalRouteHop {
  readonly sourceCellId: string;
  readonly sourcePortalId: string;
  readonly targetCellId: string;
  readonly targetPortalId: string;
  readonly transformToTarget: RigidTransform3;
}

/** A place on the surface: a cell and a point in that cell's frame (meters). */
export interface CellPoint {
  readonly cellId: string;
  readonly point: Vec3;
}

/** The chosen route and how far the old point's image lies from the new point (meters). */
export interface NearestImageRoute {
  readonly hops: readonly PortalRouteHop[];
  readonly distanceMeters: number;
}

// Two routes whose distances differ by less than this are the same geometry; the shorter route wins.
const tieToleranceMeters = 1e-9;

/**
 * Finds the route of at most `maxHops` portals from `from.cellId` to `to.cellId` that maps `from.point` nearest to `to.point` and that the
 * straight segment between the two places crosses (checked by walking it, in the plane of the floor).
 * Returns an empty route when the two places are in the same cell and no valid longer route maps the point nearer; undefined when no valid route of
 * that length reaches `to.cellId`. A route never leaves a cell through the portal it just entered, since that cancels. The search visits at most
 * (portals per cell)^maxHops routes, so keep `maxHops` small.
 */
export function findNearestImageRoute(
  world: CompiledCellComplex,
  from: CellPoint,
  to: CellPoint,
  maxHops: number,
): NearestImageRoute | undefined {
  const candidates: (NearestImageRoute & { readonly map: RigidTransform3 })[] = [];
  let frontier: { readonly cellId: string; readonly map: RigidTransform3; readonly hops: readonly PortalRouteHop[] }[] = [
    { cellId: from.cellId, map: identityRigidTransform3, hops: [] },
  ];

  for (let depth = 0; depth <= maxHops && frontier.length > 0; depth += 1) {
    const next: typeof frontier = [];

    for (const node of frontier) {
      if (node.cellId === to.cellId) {
        candidates.push({ hops: node.hops, map: node.map, distanceMeters: distanceVec3(transformPoint3(node.map, from.point), to.point) });
      }
      if (depth === maxHops) {
        continue;
      }
      const cameThrough = node.hops.at(-1)?.targetPortalId;
      for (const portal of world.cellsById.get(node.cellId)?.portals ?? []) {
        if (portal.id === cameThrough) {
          continue;
        }
        next.push({
          cellId: portal.targetCellId,
          map: composeRigidTransform3(portal.transformToTarget, node.map),
          hops: [
            ...node.hops,
            {
              sourceCellId: node.cellId,
              sourcePortalId: portal.id,
              targetCellId: portal.targetCellId,
              targetPortalId: portal.targetPortalId,
              transformToTarget: portal.transformToTarget,
            },
          ],
        });
      }
    }

    frontier = next;
  }

  // Nearest first; among equally near routes the shorter one (the candidates are in order of length, and the sort is stable).
  candidates.sort((a, b) => (Math.abs(a.distanceMeters - b.distanceMeters) <= tieToleranceMeters ? 0 : a.distanceMeters - b.distanceMeters));
  for (const candidate of candidates) {
    if (candidate.hops.length === 0 || segmentCrossesRoute(world, from, to, candidate)) {
      return { hops: candidate.hops, distanceMeters: candidate.distanceMeters };
    }
  }

  return undefined;
}

// Whether the straight segment from `from` to the image of `to` in the frame of `from.cellId` crosses exactly the portals of the route.
function segmentCrossesRoute(
  world: CompiledCellComplex,
  from: CellPoint,
  to: CellPoint,
  candidate: { readonly hops: readonly PortalRouteHop[]; readonly map: RigidTransform3 },
): boolean {
  const target = transformPoint3(invertRigidTransform3(candidate.map), to.point);
  const walk = locateDevelopedPoint(world, from.cellId, from.point, target);

  return (
    walk.status === "end" &&
    walk.cellId === to.cellId &&
    walk.crossings.length === candidate.hops.length &&
    walk.crossings.every((crossing, index) =>
      crossing.sourceCellId === candidate.hops[index].sourceCellId && crossing.portalId === candidate.hops[index].sourcePortalId
    )
  );
}
