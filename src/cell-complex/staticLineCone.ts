/**
 * Convex cones of oriented plan-view lines that cross a sequence of developed portals in order, in the forward sense.
 * An oriented line is a homogeneous triple l = (a, b, c) stored as Vec3 (x = a, y = b, z = c); its left side is {a x + b y + c > 0}. The line crosses portal (left, right) forward iff l . (left, 1) >= 0 and l . (right, 1) <= 0, i.e. h . l >= 0 for the two constraint vectors hL = (left, 1) and hR = (-right, -1). The set K of lines crossing a whole word is therefore a polyhedral cone, represented by its extreme rays in cyclic order. A child word adds two constraints: the parent's rays are clipped by each (Sutherland-Hodgman on the cyclic list), so one step costs O(|K|). The Crofton measure of K (the area of its image in (normal angle, signed offset) space) is computed exactly by Green's theorem and orders words by how many sight lines they carry. All tolerances only enlarge K. This module has no path-table bookkeeping so that a lazy trie can call {@link clipLineConeByPortal} per node.
 */
import type { OrientedPortalSegment } from "./orientedPortal";
import { crossVec3, dotVec3, lengthVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3";

/**
 * Extreme rays (unit Vec3, x = a, y = b, z = c) of a pointed cone of oriented lines, in cyclic order. Empty means no line.
 */
export type LineCone = readonly Vec3[];

/**
 * A ray r satisfies constraint h when h . r >= -staticLineConeInsideTolerance |h| (rays are unit).
 */
export const staticLineConeInsideTolerance = 1e-12;

/**
 * A word whose cone has measure below this (meters, = meter-radians) is rejected as invisible from every eye position except a cell corner.
 */
export const staticLineConeMinMeasureMeters = 1e-9;

const parallelPlaneTolerance = 1e-15;
const duplicateRayTolerance = 1e-9;
const duplicateConsecutiveRayTolerance = 1e-12;
const sineSweepTolerance = 1e-12;

/**
 * The two constraint vectors [hL, hR] of a portal whose segment is lengthened by `wideningMeters` at both ends.
 * A line crosses the portal forward iff h . l >= 0 for both. Widening only enlarges the cone.
 */
export function portalConstraintVectors(portal: OrientedPortalSegment, wideningMeters: number): readonly [Vec3, Vec3] {
  const dx = portal.left.x - portal.right.x;
  const dy = portal.left.y - portal.right.y;
  const length = Math.hypot(dx, dy);
  const ux = length > 0 ? dx / length : 0;
  const uy = length > 0 ? dy / length : 0;
  const leftX = portal.left.x + wideningMeters * ux;
  const leftY = portal.left.y + wideningMeters * uy;
  const rightX = portal.right.x - wideningMeters * ux;
  const rightY = portal.right.y - wideningMeters * uy;

  return [vec3(leftX, leftY, 1), vec3(-rightX, -rightY, -1)];
}

/**
 * Cone of the lines that cross `first` and then `second` forward, by enumerating the extreme rays of the four half-spaces.
 * Empty if no line does. Handles shared endpoints (adjacent sides of one cell), where constraint planes coincide or are opposite.
 */
export function lineConeForTwoPortals(
  first: OrientedPortalSegment,
  second: OrientedPortalSegment,
  wideningMeters: number,
): LineCone {
  const hs = [...portalConstraintVectors(first, wideningMeters), ...portalConstraintVectors(second, wideningMeters)];
  const candidates: Vec3[] = [];

  for (let i = 0; i < hs.length; i += 1) {
    for (let j = i + 1; j < hs.length; j += 1) {
      const c = crossVec3(hs[i], hs[j]);
      const cLength = lengthVec3(c);

      if (cLength < parallelPlaneTolerance * lengthVec3(hs[i]) * lengthVec3(hs[j])) {
        continue;
      }

      for (const sign of [1, -1]) {
        const r = scaleVec3(c, sign / cLength);

        if (hs.every((h) => isInside(h, r))) {
          candidates.push(r);
        }
      }
    }
  }

  return sortCyclic(dedupeRays(candidates, duplicateRayTolerance));
}

/**
 * Clips `cone` by the two constraints of `portal` (widened by `wideningMeters`): the lines of the cone that also cross `portal` forward.
 * Cost O(|cone|); returns an empty cone if nothing is left.
 */
export function clipLineConeByPortal(cone: LineCone, portal: OrientedPortalSegment, wideningMeters: number): LineCone {
  const [hL, hR] = portalConstraintVectors(portal, wideningMeters);

  return clipByVector(clipByVector(cone, hL), hR);
}

/**
 * Crofton measure of the cone in meters (meter-radians): the area of its image in (normal angle, signed offset) space, by Green's theorem over the faces.
 * Cones with fewer than 3 rays have measure 0. A child cone is a subset of its parent's, so the measure never increases down a word.
 */
export function lineConeMeasure(cone: LineCone): number {
  const n = cone.length;

  if (n < 3) {
    return 0;
  }

  let sum = 0;

  for (let i = 0; i < n; i += 1) {
    const a = cone[i];
    const b = cone[(i + 1) % n];
    const ta = Math.atan2(a.y, a.x);
    const tb = Math.atan2(b.y, b.x);

    if (Math.abs(Math.sin(tb - ta)) < sineSweepTolerance) {
      continue;
    }

    const q = crossVec3(a, b);

    if (Math.abs(q.z) < parallelPlaneTolerance * lengthVec3(q)) {
      continue;
    }

    const px = q.x / q.z;
    const py = q.y / q.z;

    sum += px * (Math.sin(tb) - Math.sin(ta)) - py * (Math.cos(tb) - Math.cos(ta));
  }

  return Math.abs(sum);
}

function isInside(h: Vec3, r: Vec3): boolean {
  return dotVec3(h, r) >= -staticLineConeInsideTolerance * lengthVec3(h);
}

function normalized(v: Vec3): Vec3 {
  return scaleVec3(v, 1 / lengthVec3(v));
}

/**
 * Clips the cyclic ray list by one half-space h . l >= 0.
 */
function clipByVector(rays: LineCone, h: Vec3): LineCone {
  const n = rays.length;

  if (n === 0) {
    return rays;
  }

  const hLength = lengthVec3(h);
  const values = rays.map((ray) => dotVec3(h, ray));
  const inside = values.map((value) => value >= -staticLineConeInsideTolerance * hLength);

  if (n === 1) {
    return inside[0] ? rays : [];
  }

  if (n === 2) {
    if (inside[0] && inside[1]) {
      return rays;
    }

    if (!inside[0] && !inside[1]) {
      return [];
    }

    const keep = inside[0] ? 0 : 1;
    const other = 1 - keep;

    return [rays[keep], normalized(crossingRay(rays[keep], values[keep], rays[other], values[other]))];
  }

  if (inside.every(Boolean)) {
    return rays;
  }

  const out: Vec3[] = [];

  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;

    if (inside[i]) {
      out.push(rays[i]);
    }

    if (inside[i] !== inside[j]) {
      out.push(normalized(crossingRay(rays[i], values[i], rays[j], values[j])));
    }
  }

  return dedupeConsecutive(out, duplicateConsecutiveRayTolerance);
}

/**
 * Positive combination |vb| a + |va| b of two rays on opposite sides of a constraint plane; it lies on the plane.
 */
function crossingRay(a: Vec3, va: number, b: Vec3, vb: number): Vec3 {
  const wa = Math.abs(vb);
  const wb = Math.abs(va);

  return vec3(wa * a.x + wb * b.x, wa * a.y + wb * b.y, wa * a.z + wb * b.z);
}

function dedupeRays(rays: readonly Vec3[], tolerance: number): Vec3[] {
  const out: Vec3[] = [];

  for (const ray of rays) {
    if (!out.some((other) => lengthVec3(vec3(ray.x - other.x, ray.y - other.y, ray.z - other.z)) < tolerance)) {
      out.push(ray);
    }
  }

  return out;
}

function dedupeConsecutive(rays: readonly Vec3[], tolerance: number): Vec3[] {
  const out: Vec3[] = [];

  for (const ray of rays) {
    const last = out[out.length - 1];

    if (!last || lengthVec3(vec3(ray.x - last.x, ray.y - last.y, ray.z - last.z)) >= tolerance) {
      out.push(ray);
    }
  }

  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];

    if (lengthVec3(vec3(first.x - last.x, first.y - last.y, first.z - last.z)) < tolerance) {
      out.pop();
    } else {
      break;
    }
  }

  return out;
}

/**
 * Orders the rays of a pointed cone cyclically around its mean direction.
 */
function sortCyclic(rays: readonly Vec3[]): LineCone {
  if (rays.length <= 2) {
    return rays;
  }

  const sum = rays.reduce((acc, ray) => vec3(acc.x + ray.x, acc.y + ray.y, acc.z + ray.z), vec3(0, 0, 0));

  if (lengthVec3(sum) < 1e-12) {
    return rays;
  }

  const m = normalized(sum);
  // Any vector not parallel to m, projected onto the plane orthogonal to m.
  const axis = Math.abs(m.x) <= Math.abs(m.y) && Math.abs(m.x) <= Math.abs(m.z) ? vec3(1, 0, 0) : Math.abs(m.y) <= Math.abs(m.z) ? vec3(0, 1, 0) : vec3(0, 0, 1);
  const u = normalized(crossVec3(m, axis));
  const v = crossVec3(m, u);

  return [...rays].sort((p, q) => Math.atan2(dotVec3(p, v), dotVec3(p, u)) - Math.atan2(dotVec3(q, v), dotVec3(q, u)));
}
