/**
 * Near-miss check for generated models (design 018 section 9.11): a gap between two pieces must look intentional, never like a joint that
 * barely failed to meet.
 *
 * The parts of a model (at rest) are grouped into pieces: two parts are joined when they touch or interpenetrate (an edge of one crosses a
 * face of the other, one lies inside the other, or a vertex of one is within {@link jointTouchMeters} of a face of the other). The ground
 * joins every part that reaches down to {@link jointGroundMeters}. Two pieces (or a piece and the ground) that are not joined but closer than
 * {@link nearMissMeters} of the smaller one's size (at least {@link nearMissFloorMeters}) are a near miss: either join them or move them
 * clearly apart. Distances are measured from vertices to faces, which can overstate a gap between two edges a little; that errs on the side
 * of reporting.
 *
 * Pure; used by the tests over every generator and handy in a debugging session. Layer rule: imports only sibling modules.
 */
import { tessellatePart, type LandmarkPart, type Vec3 } from "./landmarkParts";

/** Two parts this close (vertex to face) touch, meters. */
export const jointTouchMeters = 0.02;
/** A part whose lowest point is at most this high stands on the ground, meters. */
export const jointGroundMeters = 0.05;
/** A gap smaller than this fraction of the smaller piece's size is a near miss. */
export const nearMissFraction = 0.15;
/** A gap smaller than this is always a near miss, meters. */
export const nearMissFloorMeters = 0.2;
/** A gap larger than this is never a near miss, however large the pieces, meters. */
export const nearMissCeilingMeters = 0.6;

/** A near miss between two pieces, or a piece and the ground (`other` undefined). */
export interface NearMiss {
  /** Indices of the parts of the piece. */
  readonly piece: readonly number[];
  readonly other: readonly number[] | undefined;
  /** The gap, meters. */
  readonly gapMeters: number;
  /** The gap below which it counts as a near miss for these two, meters. */
  readonly limitMeters: number;
}

type Triangle = readonly [Vec3, Vec3, Vec3];

interface Mesh {
  readonly triangles: readonly Triangle[];
  readonly min: Vec3;
  readonly max: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function meshOf(part: LandmarkPart): Mesh {
  const triangles = tessellatePart(part).map((triangle): Triangle => [triangle.a, triangle.b, triangle.c]);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const triangle of triangles) {
    for (const point of triangle) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }

  return { triangles, min, max };
}

// Distance between two axis-aligned boxes; 0 when they overlap.
function boxGap(a: Mesh, b: Mesh): number {
  let sum = 0;

  for (let axis = 0; axis < 3; axis += 1) {
    const gap = Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]);
    sum += gap * gap;
  }

  return Math.sqrt(sum);
}

// Distance from point p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5).
function pointTriangleDistance(p: Vec3, [a, b, c]: Triangle): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  const length = (v: Vec3) => Math.sqrt(dot(v, v));
  if (d1 <= 0 && d2 <= 0) return length(ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return length(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return length(sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return length(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return length(sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return length(sub(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return length(sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
}

// Whether segment pq crosses triangle abc (Möller-Trumbore on the segment).
function segmentCrossesTriangle(p: Vec3, q: Vec3, [a, b, c]: Triangle): boolean {
  const direction = sub(q, p);
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const h = cross(direction, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return false;
  const inverse = 1 / det;
  const s = sub(p, a);
  const u = dot(s, h) * inverse;
  if (u < 0 || u > 1) return false;
  const qv = cross(s, e1);
  const v = dot(direction, qv) * inverse;
  if (v < 0 || u + v > 1) return false;
  const t = dot(e2, qv) * inverse;
  return t >= 0 && t <= 1;
}

// Whether point p is inside the closed mesh (ray parity along a fixed skew direction).
function pointInside(p: Vec3, mesh: Mesh): boolean {
  if (p.some((value, axis) => value < mesh.min[axis] || value > mesh.max[axis])) return false;
  const far: Vec3 = [p[0] + 1e3, p[1] + 0.731e3, p[2] + 0.417e3];
  let crossings = 0;
  for (const triangle of mesh.triangles) {
    if (segmentCrossesTriangle(p, far, triangle)) crossings += 1;
  }
  return crossings % 2 === 1;
}

// The gap between two parts: 0 when they touch or interpenetrate, else the smallest vertex-to-face distance.
function partGap(a: Mesh, b: Mesh): number {
  if (boxGap(a, b) > nearMissCeilingMeters) return boxGap(a, b);

  for (const [p, q] of [[a, b], [b, a]] as const) {
    for (const triangle of p.triangles) {
      for (const [from, to] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as const) {
        for (const other of q.triangles) {
          if (segmentCrossesTriangle(from, to, other)) return 0;
        }
      }
    }
  }

  if (a.triangles.length > 0 && pointInside(a.triangles[0][0], b)) return 0;
  if (b.triangles.length > 0 && pointInside(b.triangles[0][0], a)) return 0;

  let gap = Infinity;
  for (const [p, q] of [[a, b], [b, a]] as const) {
    for (const triangle of p.triangles) {
      for (const point of triangle) {
        for (const other of q.triangles) {
          gap = Math.min(gap, pointTriangleDistance(point, other));
        }
      }
    }
  }

  return gap;
}

/** The near misses of a part list at rest (see the module header); empty when every gap looks intentional. */
export function findNearMisses(parts: readonly LandmarkPart[]): readonly NearMiss[] {
  const meshes = parts.map(meshOf);
  const count = meshes.length;
  const gaps = Array.from({ length: count }, () => new Array<number>(count).fill(Infinity));
  const parent = Array.from({ length: count }, (_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const gap = partGap(meshes[i], meshes[j]);
      gaps[i][j] = gaps[j][i] = gap;
      if (gap <= jointTouchMeters) parent[root(i)] = root(j);
    }
  }

  const pieces = new Map<number, number[]>();
  for (let index = 0; index < count; index += 1) {
    const key = root(index);
    pieces.set(key, [...(pieces.get(key) ?? []), index]);
  }

  const list = [...pieces.values()];
  const bottomOf = (piece: readonly number[]) => Math.min(...piece.map((index) => meshes[index].min[2]));
  const sizeOf = (piece: readonly number[]) => {
    const min = [0, 1, 2].map((axis) => Math.min(...piece.map((index) => meshes[index].min[axis])));
    const max = [0, 1, 2].map((axis) => Math.max(...piece.map((index) => meshes[index].max[axis])));
    return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  };
  const limit = (size: number) => Math.min(nearMissCeilingMeters, Math.max(nearMissFloorMeters, nearMissFraction * size));
  const misses: NearMiss[] = [];

  for (let i = 0; i < list.length; i += 1) {
    const bottom = bottomOf(list[i]);
    if (bottom > jointGroundMeters && bottom < limit(sizeOf(list[i]))) {
      misses.push({ piece: list[i], other: undefined, gapMeters: bottom, limitMeters: limit(sizeOf(list[i])) });
    }

    for (let j = i + 1; j < list.length; j += 1) {
      let gap = Infinity;
      for (const a of list[i]) for (const b of list[j]) gap = Math.min(gap, gaps[a][b]);
      const allowed = limit(Math.min(sizeOf(list[i]), sizeOf(list[j])));
      // Two pieces that both stand on the ground may stand close: only pieces off the ground must clear or join.
      const bothGrounded = bottom <= jointGroundMeters && bottomOf(list[j]) <= jointGroundMeters;
      if (!bothGrounded && gap > jointTouchMeters && gap < allowed) {
        misses.push({ piece: list[i], other: list[j], gapMeters: gap, limitMeters: allowed });
      }
    }
  }

  return misses;
}
