/**
 * Swept collision of a moving disc against discs and capsules in one flat plane, and the slide loop built on it.
 * The moving body is its horizontal centre c with the path p(s) = p + s v, s in [0, 1] (meters). Obstacles carry a radius that already includes the moving body's radius, so the centre is tested against a point (disc) or a segment (capsule) thickened by that radius. Only approaching hits count: a body that already overlaps an obstacle may move away from it or along it, never deeper in. A hit at the very end of the step (within 1e-9 of s = 1) is a touch, not a block.
 */
import type { Vec2xy } from "../math/polygons";
import { approachDotToleranceMeters, collisionSkinMeters, degenerateLengthMeters } from "../math/tolerances";

/**
 * What an obstacle is, for reporting: a wall, a too-low portal ("ceiling"), a forbidden-zone column or another body.
 */
export type SweptObstacleReason = "wall" | "ceiling" | "forbidden-zone" | "body";

/**
 * A swept-test obstacle with the moving body's radius already added to `radius`.
 */
export type SweptObstacle =
  | {
      readonly kind: "capsule";
      readonly a: Vec2xy;
      readonly b: Vec2xy;
      readonly radius: number;
      readonly reason: SweptObstacleReason;
    }
  | {
      readonly kind: "disc";
      readonly center: Vec2xy;
      readonly radius: number;
      readonly reason: SweptObstacleReason;
      readonly objectId?: string;
    };

/**
 * First contact of a path with an obstacle: path parameter s in [0, 1] and the unit normal pointing away from the obstacle.
 */
export interface SweptHit {
  readonly s: number;
  readonly normal: Vec2xy;
  readonly obstacle: SweptObstacle;
}

/**
 * Result of {@link slideDisc}: the end centre, the centre polyline and the contacts in order.
 */
export interface SlideResult {
  readonly end: Vec2xy;
  /** Polyline of the centre; `legs[0]` is the start. */
  readonly legs: readonly Vec2xy[];
  readonly contacts: readonly SweptHit[];
}

/** A hit this close to the end of the step is a touch. */
const endTouchTolerance = 1e-9;

interface RawHit {
  readonly s: number;
  readonly normal: Vec2xy;
}

function dot(a: Vec2xy, b: Vec2xy): number {
  return a.x * b.x + a.y * b.y;
}

function sweepDiscRaw(p: Vec2xy, v: Vec2xy, q: Vec2xy, radius: number): RawHit | undefined {
  const w = { x: p.x - q.x, y: p.y - q.y };
  const a = dot(v, v);
  const b = 2 * dot(v, w);
  const c0 = dot(w, w) - radius * radius;

  if (!(a > 0)) {
    return undefined;
  }

  if (c0 < 0) {
    if (!(b < 0)) {
      return undefined;
    }

    const wl = Math.hypot(w.x, w.y);

    if (wl < degenerateLengthMeters) {
      const vl = Math.sqrt(a);

      return { s: 0, normal: { x: -v.x / vl, y: -v.y / vl } };
    }

    return { s: 0, normal: { x: w.x / wl, y: w.y / wl } };
  }

  if (b >= 0) {
    return undefined;
  }

  const disc = b * b - 4 * a * c0;

  if (disc < 0) {
    return undefined;
  }

  const s = Math.max(0, (-b - Math.sqrt(disc)) / (2 * a));

  if (s >= 1 - endTouchTolerance) {
    return undefined;
  }

  const hx = p.x + s * v.x - q.x;
  const hy = p.y + s * v.y - q.y;
  const hl = Math.hypot(hx, hy);

  return { s, normal: hl > 0 ? { x: hx / hl, y: hy / hl } : { x: -v.x / Math.sqrt(a), y: -v.y / Math.sqrt(a) } };
}

function sweepCapsuleRaw(p: Vec2xy, v: Vec2xy, a: Vec2xy, b: Vec2xy, radius: number): RawHit | undefined {
  let best: RawHit | undefined;
  const consider = (hit: RawHit | undefined): void => {
    if (hit && (!best || hit.s < best.s)) {
      best = hit;
    }
  };
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const length = Math.hypot(ex, ey);

  if (length > degenerateLengthMeters) {
    const u = { x: ex / length, y: ey / length };
    let n = { x: -u.y, y: u.x };
    let h0 = (p.x - a.x) * n.x + (p.y - a.y) * n.y;

    if (h0 < 0) {
      n = { x: -n.x, y: -n.y };
      h0 = -h0;
    }

    const vn = dot(v, n);
    const u0 = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
    const vu = dot(v, u);

    if (vn < 0) {
      if (h0 < radius) {
        if (u0 >= 0 && u0 <= length) {
          consider({ s: 0, normal: n });
        }
      } else {
        const s = (h0 - radius) / -vn;

        if (s >= 0 && s < 1 - endTouchTolerance) {
          const along = u0 + s * vu;

          if (along >= 0 && along <= length) {
            consider({ s, normal: n });
          }
        }
      }
    }
  }

  consider(sweepDiscRaw(p, v, a, radius));
  consider(sweepDiscRaw(p, v, b, radius));

  return best;
}

/**
 * Sweeps the centre path p + s v, s in [0, 1], against one obstacle and returns the first approaching hit, if any.
 * A disc is hit by the quadratic of the path against radius R; a capsule by its slab (the segment thickened sideways) or either end cap, whichever comes first. An obstacle the body already overlaps is hit at s = 0 only when the body moves closer to it.
 */
export function sweepDiscAgainstObstacle(p: Vec2xy, v: Vec2xy, obstacle: SweptObstacle): SweptHit | undefined {
  const raw =
    obstacle.kind === "disc"
      ? sweepDiscRaw(p, v, obstacle.center, obstacle.radius)
      : sweepCapsuleRaw(p, v, obstacle.a, obstacle.b, obstacle.radius);

  return raw ? { s: raw.s, normal: raw.normal, obstacle } : undefined;
}

/**
 * Slides a disc centre through obstacles for up to `maxIterations` (default 4) contacts.
 * Each iteration finds the earliest hit, advances to it less a skin of `collisionSkinMeters` along the path, keeps only the part of the remaining displacement tangent to the hit normal, and zeroes it if it still points into an earlier contact (a crease where two obstacles meet). Whatever displacement is left after the last iteration is dropped.
 */
export function slideDisc(
  start: Vec2xy,
  displacement: Vec2xy,
  obstacles: readonly SweptObstacle[],
  maxIterations = 4,
): SlideResult {
  let pos = start;
  let v = displacement;
  const legs: Vec2xy[] = [start];
  const contacts: SweptHit[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const speed = Math.hypot(v.x, v.y);

    if (speed <= degenerateLengthMeters) {
      break;
    }

    let hit: SweptHit | undefined;

    for (const obstacle of obstacles) {
      const candidate = sweepDiscAgainstObstacle(pos, v, obstacle);

      if (candidate && (!hit || candidate.s < hit.s)) {
        hit = candidate;
      }
    }

    if (!hit) {
      pos = { x: pos.x + v.x, y: pos.y + v.y };
      legs.push(pos);
      v = { x: 0, y: 0 };
      break;
    }

    const advance = Math.max(0, hit.s - collisionSkinMeters / speed);

    if (advance > 0) {
      pos = { x: pos.x + advance * v.x, y: pos.y + advance * v.y };
      legs.push(pos);
    }

    let rem = { x: (1 - advance) * v.x, y: (1 - advance) * v.y };
    const into = dot(rem, hit.normal);

    rem = { x: rem.x - into * hit.normal.x, y: rem.y - into * hit.normal.y };

    for (const earlier of contacts) {
      if (dot(rem, earlier.normal) < -approachDotToleranceMeters) {
        rem = { x: 0, y: 0 };
        break;
      }
    }

    contacts.push(hit);
    v = rem;
  }

  return { end: pos, legs, contacts };
}
