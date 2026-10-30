/**
 * Sleeve of a portal word and the taut string through it: developed apertures, the point funnel, disk tangents and the shortest path that wraps the forbidden-zone disks; pure.
 *
 * Setting: a portal word from anchor A to anchor B develops the cells it crosses into the frame of A's cell (the "sleeve"). Portal p_i leaves cell C_{i-1} through side s; seen from inside the counter-clockwise cell and facing out through the side, `side.end` is on the left and `side.start` on the right. The developed aperture is (left, right) = (M_{i-1}(side.end), M_{i-1}(side.start)) with M_0 = I and M_i = M_{i-1} o T_{p_i}^{-1}. The shortest path of the homotopy class is the straight chord when it stays in the sleeve, otherwise a taut string made of straight pieces tangent to disks of radius rho at aperture endpoints (the forbidden zones of the portal junctions), each wrapped on its own side. All coordinates are meters in the developed frame; angles are radians.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { Vec2xy } from "../../math/polygons";
import { composeRigidTransform3, identityRigidTransform3, transformPoint3, type RigidTransform3 } from "../../math/rigidTransform3";
import { addVec2, crossVec2, dotVec2, lengthVec2, scaleVec2, subVec2 } from "../../math/vec2";
import { vec3 } from "../../math/vec3";
import { inversePortalTransform } from "./development";
import type { GeodesicPortalTraversal } from "./objects";

/** Extra radius (meters) added to the forbidden disk so that taut tangent pieces keep a clearance from the real circle and never count as zone hits. */
export const geodesicCornerClearanceMeters = 1e-6;

const equalPointToleranceMeters = 1e-12;
const penetrationToleranceMeters = 1e-9;

/** One developed portal aperture: the portal's two side endpoints in the developed frame and the ids of their forbidden junction disks. */
export interface SleeveAperture {
  /** Developed position of `side.end` of the portal's side, the endpoint on the left when facing through the portal. */
  readonly left: Vec2xy;
  /** Developed position of `side.start` of the portal's side, the endpoint on the right when facing through the portal. */
  readonly right: Vec2xy;
  /** Junction id (`"<cellId>:vertex-<i>"`) of the disk at `left`, in the cell that is left through this portal. */
  readonly leftJunctionId: string;
  /** Junction id of the disk at `right`, in the same cell. */
  readonly rightJunctionId: string;
  /** Cell that is left through this portal. */
  readonly cellId: string;
  /** Index of the traversal in the word. */
  readonly wordIndex: number;
}

/** A developed portal word: the endpoints, the apertures between them, and the map from the end cell's frame into the start frame. */
export interface DevelopedSleeve {
  readonly start: Vec2xy;
  /** The end point pulled back into the start frame. */
  readonly end: Vec2xy;
  readonly apertures: readonly SleeveAperture[];
  /** Maps the frame of the last cell into the start frame (M_k). Its rotation angle is the holonomy of the word. */
  readonly startFromEnd: RigidTransform3;
  readonly endCellId: string;
}

/** Result of {@link developSleeve}. `word-mismatch` names the first traversal that does not chain from the previous cell. */
export type DevelopSleeveResult =
  | { readonly status: "ok"; readonly sleeve: DevelopedSleeve }
  | { readonly status: "word-mismatch"; readonly index: number };

/**
 * Develops `word` starting in `startCellId` into the frame of that cell.
 *
 * `start` is in the frame of the start cell and `end` in the frame of the last cell of the word; the sleeve holds `end` pulled back into the start frame (same pull-back as `liftGeodesicEndpoint`).
 * Fails with `word-mismatch` when a traversal's source cell or portal does not match the cell reached so far.
 */
export function developSleeve(input: {
  readonly world: CompiledCellComplex;
  readonly startCellId: string;
  readonly start: Vec2xy;
  readonly word: readonly GeodesicPortalTraversal[];
  readonly end: Vec2xy;
}): DevelopSleeveResult {
  let transform: RigidTransform3 = identityRigidTransform3;
  let cell = input.world.cellsById.get(input.startCellId);
  const apertures: SleeveAperture[] = [];
  for (let index = 0; index < input.word.length; index += 1) {
    const traversal = input.word[index];
    const portal = cell && traversal.sourceCellId === cell.id ? cell.portalsById.get(traversal.sourcePortalId) : undefined;
    if (!cell || !portal || portal.targetCellId !== traversal.targetCellId) {
      return { status: "word-mismatch", index };
    }
    const side = cell.sides[portal.sideIndex];
    const sideCount = cell.sides.length;
    apertures.push({
      left: developPoint(transform, side.end),
      right: developPoint(transform, side.start),
      leftJunctionId: `${cell.id}:vertex-${(side.sideIndex + 1) % sideCount}`,
      rightJunctionId: `${cell.id}:vertex-${side.sideIndex}`,
      cellId: cell.id,
      wordIndex: index,
    });
    transform = composeRigidTransform3(transform, inversePortalTransform(portal));
    cell = input.world.cellsById.get(traversal.targetCellId);
  }
  if (!cell) {
    return { status: "word-mismatch", index: input.word.length };
  }

  return {
    status: "ok",
    sleeve: {
      start: input.start,
      end: developPoint(transform, input.end),
      apertures,
      startFromEnd: transform,
      endCellId: cell.id,
    },
  };
}

function developPoint(transform: RigidTransform3, point: Vec2xy): Vec2xy {
  const mapped = transformPoint3(transform, vec3(point.x, point.y, 0));
  return { x: mapped.x, y: mapped.y };
}

/** A corner of the point funnel: the aperture endpoint (left or right side of the travel direction) that the shortest path touches. */
export interface FunnelApex {
  /** Index into `sleeve.apertures`. */
  readonly apertureIndex: number;
  readonly side: "left" | "right";
}

function samePoint(a: Vec2xy, b: Vec2xy): boolean {
  return Math.abs(a.x - b.x) <= equalPointToleranceMeters && Math.abs(a.y - b.y) <= equalPointToleranceMeters;
}

/**
 * Simple-stupid-funnel on the aperture endpoints (radius 0): returns the corners of the shortest polyline from `sleeve.start` to `sleeve.end` through every aperture, in travel order.
 * Consecutive repeats of one point are reported once. The corners are aperture endpoints; they are the starting guess for {@link solveTautPath}.
 */
export function funnelPointApexes(sleeve: DevelopedSleeve): readonly FunnelApex[] {
  const count = sleeve.apertures.length;
  // Portal 0 is the start point, portal i (1..count) is aperture i - 1, portal count + 1 is the end point.
  const leftOf = (portal: number): Vec2xy =>
    portal === 0 ? sleeve.start : portal === count + 1 ? sleeve.end : sleeve.apertures[portal - 1].left;
  const rightOf = (portal: number): Vec2xy =>
    portal === 0 ? sleeve.start : portal === count + 1 ? sleeve.end : sleeve.apertures[portal - 1].right;
  const apexes: FunnelApex[] = [];
  let apex = sleeve.start;
  let apexPortal = 0;
  let left = apex;
  let right = apex;
  let leftPortal = 0;
  let rightPortal = 0;
  const pushApex = (portal: number, side: "left" | "right"): void => {
    if (portal < 1 || portal > count) {
      return;
    }
    const last = apexes.at(-1);
    const point = side === "left" ? leftOf(portal) : rightOf(portal);
    const lastPoint = last ? (last.side === "left" ? leftOf(last.apertureIndex + 1) : rightOf(last.apertureIndex + 1)) : undefined;
    if (!lastPoint || !samePoint(lastPoint, point)) {
      apexes.push({ apertureIndex: portal - 1, side });
    }
  };

  let guard = 0;
  const guardLimit = 16 * (count + 2) * (count + 2);
  for (let i = 1; i <= count + 1 && guard < guardLimit; guard += 1) {
    const newLeft = leftOf(i);
    const newRight = rightOf(i);
    // Right edge: a new right endpoint that is not further right than the current one narrows the funnel.
    if (crossVec2(subVec2(right, apex), subVec2(newRight, apex)) >= 0) {
      if (samePoint(apex, right) || crossVec2(subVec2(newRight, apex), subVec2(left, apex)) > 0) {
        right = newRight;
        rightPortal = i;
      } else {
        pushApex(leftPortal, "left");
        apex = left;
        apexPortal = leftPortal;
        right = apex;
        leftPortal = apexPortal;
        rightPortal = apexPortal;
        i = apexPortal + 1;
        continue;
      }
    }
    // Left edge, mirrored.
    if (crossVec2(subVec2(left, apex), subVec2(newLeft, apex)) <= 0) {
      if (samePoint(apex, left) || crossVec2(subVec2(right, apex), subVec2(newLeft, apex)) > 0) {
        left = newLeft;
        leftPortal = i;
      } else {
        if (rightPortal === count + 1) {
          // The end point itself tightened the right edge and also meets the left edge: the string ends here.
          break;
        }
        pushApex(rightPortal, "right");
        apex = right;
        apexPortal = rightPortal;
        left = apex;
        leftPortal = apexPortal;
        rightPortal = apexPortal;
        i = apexPortal + 1;
        continue;
      }
    }
    i += 1;
  }

  return apexes;
}

function leftNormal(u: Vec2xy): Vec2xy {
  return { x: -u.y, y: u.x };
}

function rotateVec2(u: Vec2xy, radians: number): Vec2xy {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: u.x * cos - u.y * sin, y: u.x * sin + u.y * cos };
}

/** A straight tangent piece: it runs from `from` to `to` in the unit `direction`. */
export interface TangentPiece {
  readonly from: Vec2xy;
  readonly to: Vec2xy;
  readonly direction: Vec2xy;
  readonly lengthMeters: number;
}

/**
 * Tangent from `point` to the disk (`center`, `rho`) that lies on `side` of the path (a "left" disk is passed with the disk on the left, so the path turns left around it).
 * Returns the piece from `point` to the tangent point, or `undefined` when `point` is not outside the disk.
 */
export function tangentFromPointToDisk(
  point: Vec2xy,
  center: Vec2xy,
  rho: number,
  side: "left" | "right",
): TangentPiece | undefined {
  const delta = subVec2(center, point);
  const distance = lengthVec2(delta);
  if (!(distance > rho)) {
    return undefined;
  }
  const u = scaleVec2(delta, 1 / distance);
  const beta = Math.asin(rho / distance);
  const direction = rotateVec2(u, side === "left" ? -beta : beta);
  const lengthMeters = distance * Math.cos(beta);

  return { from: point, to: addVec2(point, scaleVec2(direction, lengthMeters)), direction, lengthMeters };
}

/**
 * Tangent from the disk (`center`, `rho`) on `side` of the path to `point`: the piece runs from the tangent point to `point`.
 * Returns `undefined` when `point` is not outside the disk.
 */
export function tangentFromDiskToPoint(
  center: Vec2xy,
  side: "left" | "right",
  rho: number,
  point: Vec2xy,
): TangentPiece | undefined {
  const reversed = tangentFromPointToDisk(point, center, rho, side === "left" ? "right" : "left");
  if (!reversed) {
    return undefined;
  }

  return {
    from: reversed.to,
    to: point,
    direction: scaleVec2(reversed.direction, -1),
    lengthMeters: reversed.lengthMeters,
  };
}

/**
 * Common tangent of two disks of equal radius `rho` that the path wraps on `firstSide` and `secondSide`: the outer tangent when the sides agree, the inner tangent otherwise.
 * Returns the piece from the tangent point on the first disk to the tangent point on the second, or `undefined` when the centres coincide (outer) or are not more than `2 rho` apart (inner).
 */
export function tangentBetweenDisks(
  first: Vec2xy,
  firstSide: "left" | "right",
  second: Vec2xy,
  secondSide: "left" | "right",
  rho: number,
): TangentPiece | undefined {
  const delta = subVec2(second, first);
  const distance = lengthVec2(delta);
  if (!(distance > 1e-12)) {
    return undefined;
  }
  const u = scaleVec2(delta, 1 / distance);
  if (firstSide === secondSide) {
    const offset = scaleVec2(leftNormal(u), firstSide === "left" ? -rho : rho);
    return { from: addVec2(first, offset), to: addVec2(second, offset), direction: u, lengthMeters: distance };
  }
  if (!(distance > 2 * rho)) {
    return undefined;
  }
  const beta = Math.asin((2 * rho) / distance);
  const direction = rotateVec2(u, firstSide === "left" ? beta : -beta);
  const normal = leftNormal(direction);
  const sign = firstSide === "left" ? -1 : 1;

  return {
    from: addVec2(first, scaleVec2(normal, sign * rho)),
    to: addVec2(second, scaleVec2(normal, -sign * rho)),
    direction,
    lengthMeters: distance * Math.cos(beta),
  };
}

/** A wrapped disk of the taut string. */
export interface TautApex {
  /** Index into `sleeve.apertures`. */
  readonly apertureIndex: number;
  /** Side of the disk relative to the travel direction (a left disk is passed on its right, the path turns left). */
  readonly side: "left" | "right";
  /** Disk centre in the developed frame. */
  readonly center: Vec2xy;
  /** Signed turn of the path around the disk, radians (positive for a left disk, negative for a right disk). */
  readonly turnRadians: number;
}

/** Result of {@link solveTautPath}. */
export type TautPathResult =
  | {
      readonly status: "ok";
      readonly apexes: readonly TautApex[];
      /** Polyline `[start, corners..., end]` approximating the string; wraps are replaced by corners outside the disk. */
      readonly points: readonly Vec2xy[];
      /** For each corner (`points[1..]` without the end), the index into `apexes` it belongs to. */
      readonly cornerApexIndex: readonly number[];
      /** Exact length of the taut string (tangent pieces plus arcs). */
      readonly lengthMeters: number;
      /** Length of `points`. */
      readonly polylineLengthMeters: number;
    }
  | { readonly status: "infeasible"; readonly apertureIndex: number }
  | { readonly status: "no-convergence" };

interface TautNode {
  readonly kind: "start" | "end" | "apex";
  readonly point: Vec2xy;
  readonly side?: "left" | "right";
  readonly apertureIndex: number;
}

function pointToSegmentDistance(point: Vec2xy, from: Vec2xy, to: Vec2xy): number {
  const segment = subVec2(to, from);
  const lengthSquared = dotVec2(segment, segment);
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, dotVec2(subVec2(point, from), segment) / lengthSquared)) : 0;
  return lengthVec2(subVec2(point, addVec2(from, scaleVec2(segment, t))));
}

function chordPiece(from: Vec2xy, to: Vec2xy): TangentPiece {
  const delta = subVec2(to, from);
  const lengthMeters = lengthVec2(delta);
  return { from, to, direction: lengthMeters > 0 ? scaleVec2(delta, 1 / lengthMeters) : { x: 1, y: 0 }, lengthMeters };
}

function pieceBetweenNodes(first: TautNode, second: TautNode, rho: number): TangentPiece | undefined {
  if (first.kind !== "apex" && second.kind !== "apex") {
    return chordPiece(first.point, second.point);
  }
  if (first.kind !== "apex") {
    return tangentFromPointToDisk(first.point, second.point, rho, second.side as "left" | "right");
  }
  if (second.kind !== "apex") {
    return tangentFromDiskToPoint(first.point, first.side as "left" | "right", rho, second.point);
  }
  return tangentBetweenDisks(first.point, first.side as "left" | "right", second.point, second.side as "left" | "right", rho);
}

/**
 * Shortest path from `sleeve.start` to `sleeve.end` that crosses every aperture between its two disks of radius `rho`.
 *
 * Starts from the point funnel's corners, replaces point turns by disk tangents, then repeats: remove a wrap whose turn has the wrong sign (the string lifts off the disk), else insert the worst disk that a piece penetrates or passes on the wrong side. At most `4 (k + 2)` rounds for `k` apertures. Fails with `infeasible` when an aperture is narrower than `2 rho` (or a tangent does not exist) and with `no-convergence` when the rounds run out.
 * The polyline `points` replaces the wrap of turn `Phi` by `ceil(Phi / maxTurnPerCornerRadians)` corners (default `2 pi / 3`) at distance `rho / cos(Phi / (2 m))` from the disk centre, so every polyline piece stays outside the disk of radius `rho`. Apertures in the end cells and vertices that are not portal endpoints are not modelled.
 */
export function solveTautPath(
  sleeve: DevelopedSleeve,
  rho: number,
  options: { readonly maxTurnPerCornerRadians?: number } = {},
): TautPathResult {
  const maxTurn = options.maxTurnPerCornerRadians ?? (2 * Math.PI) / 3;
  const count = sleeve.apertures.length;
  for (let index = 0; index < count; index += 1) {
    const aperture = sleeve.apertures[index];
    if (lengthVec2(subVec2(aperture.left, aperture.right)) < 2 * rho) {
      return { status: "infeasible", apertureIndex: index };
    }
  }
  const startNode: TautNode = { kind: "start", point: sleeve.start, apertureIndex: -1 };
  const endNode: TautNode = { kind: "end", point: sleeve.end, apertureIndex: count };
  let nodes: TautNode[] = [
    startNode,
    ...funnelPointApexes(sleeve).map((apex): TautNode => ({
      kind: "apex",
      side: apex.side,
      point: apex.side === "left" ? sleeve.apertures[apex.apertureIndex].left : sleeve.apertures[apex.apertureIndex].right,
      apertureIndex: apex.apertureIndex,
    })),
    endNode,
  ];
  const chord = subVec2(sleeve.end, sleeve.start);
  const projection = (node: TautNode): number => dotVec2(subVec2(node.point, sleeve.start), chord);

  let pieces: TangentPiece[] = [];
  let converged = false;
  const maxRounds = 4 * (count + 2);
  for (let round = 0; round <= maxRounds && !converged; round += 1) {
    const computed: TangentPiece[] = [];
    for (let index = 0; index + 1 < nodes.length; index += 1) {
      const piece = pieceBetweenNodes(nodes[index], nodes[index + 1], rho);
      if (!piece) {
        const later = nodes[index + 1];
        return { status: "infeasible", apertureIndex: Math.max(0, Math.min(count - 1, later.apertureIndex)) };
      }
      computed.push(piece);
    }
    pieces = computed;

    // 1. Lift-off: a wrap whose turn has the wrong sign is removed.
    const liftOff = nodes.findIndex((node, index) => {
      if (node.kind !== "apex") {
        return false;
      }
      const turn = Math.atan2(
        crossVec2(pieces[index - 1].direction, pieces[index].direction),
        dotVec2(pieces[index - 1].direction, pieces[index].direction),
      );
      return node.side === "left" ? turn <= 1e-12 : turn >= -1e-12;
    });
    if (liftOff >= 0) {
      nodes = nodes.filter((_node, index) => index !== liftOff);
      continue;
    }

    // 2. Violations: the worst aperture endpoint that a piece penetrates or passes on the wrong side.
    let worst: { readonly apertureIndex: number; readonly side: "left" | "right"; readonly penetration: number } | undefined;
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      const first = nodes[index];
      const second = nodes[index + 1];
      for (let q = Math.max(0, first.apertureIndex); q <= Math.min(count - 1, second.apertureIndex); q += 1) {
        for (const side of ["left", "right"] as const) {
          const center = side === "left" ? sleeve.apertures[q].left : sleeve.apertures[q].right;
          if (nodes.some((node) => node.kind === "apex" && node.side === side && samePoint(node.point, center))) {
            continue;
          }
          const offset = subVec2(center, piece.from);
          const signedDistance = crossVec2(piece.direction, offset);
          const along = dotVec2(piece.direction, offset);
          const wrongSide = (side === "left" && signedDistance < 0) || (side === "right" && signedDistance > 0);
          const withinPiece = along >= -penetrationToleranceMeters && along <= piece.lengthMeters + penetrationToleranceMeters;
          const penetration = wrongSide && withinPiece
            ? rho + Math.abs(signedDistance)
            : rho - pointToSegmentDistance(center, piece.from, piece.to);
          if (penetration > penetrationToleranceMeters && (!worst || penetration > worst.penetration)) {
            worst = { apertureIndex: q, side, penetration };
          }
        }
      }
    }
    if (!worst) {
      converged = true;
      break;
    }
    const insertedCenter = worst.side === "left" ? sleeve.apertures[worst.apertureIndex].left : sleeve.apertures[worst.apertureIndex].right;
    const inserted: TautNode = { kind: "apex", point: insertedCenter, side: worst.side, apertureIndex: worst.apertureIndex };
    const next = [...nodes];
    let position = 1;
    while (
      position < next.length - 1 &&
      (
        next[position].apertureIndex < inserted.apertureIndex ||
        (next[position].apertureIndex === inserted.apertureIndex && projection(next[position]) <= projection(inserted))
      )
    ) {
      position += 1;
    }
    next.splice(position, 0, inserted);
    nodes = next;
  }
  if (!converged) {
    return { status: "no-convergence" };
  }

  const apexes: TautApex[] = [];
  const points: Vec2xy[] = [sleeve.start];
  const cornerApexIndex: number[] = [];
  let lengthMeters = pieces.reduce((total, piece) => total + piece.lengthMeters, 0);
  nodes.forEach((node, index) => {
    if (node.kind !== "apex") {
      return;
    }
    const incoming = pieces[index - 1];
    const outgoing = pieces[index];
    const turnRadians = Math.atan2(crossVec2(incoming.direction, outgoing.direction), dotVec2(incoming.direction, outgoing.direction));
    const sign = node.side === "left" ? 1 : -1;
    const turn = Math.abs(turnRadians);
    lengthMeters += rho * turn;
    const apexIndex = apexes.length;
    apexes.push({ apertureIndex: node.apertureIndex, side: node.side as "left" | "right", center: node.point, turnRadians });
    const cornerCount = Math.max(1, Math.ceil(turn / maxTurn));
    const delta = turn / cornerCount;
    const incomingNormal = rho > 0 ? scaleVec2(subVec2(incoming.to, node.point), 1 / rho) : { x: 1, y: 0 };
    for (let j = 0; j < cornerCount; j += 1) {
      const direction = rotateVec2(incomingNormal, sign * (j + 0.5) * delta);
      points.push(addVec2(node.point, scaleVec2(direction, rho / Math.cos(delta / 2))));
      cornerApexIndex.push(apexIndex);
    }
  });
  points.push(sleeve.end);
  let polylineLengthMeters = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    polylineLengthMeters += lengthVec2(subVec2(points[index + 1], points[index]));
  }

  return { status: "ok", apexes, points, cornerApexIndex, lengthMeters, polylineLengthMeters };
}
