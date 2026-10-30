/**
 * Two-dimensional vector helpers on `Vec2xy` ({ x, y }, meters): sum, difference, scaling, dot and cross products, length. Pure; imports nothing but the `Vec2xy` type.
 */
import type { Vec2xy } from "./polygons";

/**
 * Two-dimensional cross product `ax * by - ay * bx` of the vectors (ax, ay) and (bx, by).
 */
export function crossXY(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Returns the sum `a + b`.
 */
export function addVec2(a: Vec2xy, b: Vec2xy): Vec2xy {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Returns the difference `a - b`.
 */
export function subVec2(a: Vec2xy, b: Vec2xy): Vec2xy {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Returns `v` scaled by `s`.
 */
export function scaleVec2(v: Vec2xy, s: number): Vec2xy {
  return { x: v.x * s, y: v.y * s };
}

/**
 * Returns the dot product of `a` and `b`.
 */
export function dotVec2(a: Vec2xy, b: Vec2xy): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Returns the two-dimensional cross product `a.x * b.y - a.y * b.x`.
 */
export function crossVec2(a: Vec2xy, b: Vec2xy): number {
  return crossXY(a.x, a.y, b.x, b.y);
}

/**
 * Returns the Euclidean length of `v`.
 */
export function lengthVec2(v: Vec2xy): number {
  return Math.hypot(v.x, v.y);
}
