/**
 * Floor texture coordinates.
 *
 * Metric UVs: a cell-local floor point (x, y) gets UV (x/T, y/T), so one texture tile is T meters in every world.
 *
 * Lattice UVs: given a lattice frame (origin o, vectors u and v) and whole tile counts nU, nV, a floor point p gets
 *   d = p - o, det = u.x*v.y - u.y*v.x,
 *   alpha = (d.x*v.y - d.y*v.x) / det, beta = (u.x*d.y - u.y*d.x) / det,
 *   uv = (nU*alpha, nV*beta).
 * Crossing a portal adds u or v to the point, so it adds the integer nU or nV to the UV and the repeating texture has
 * no seam. Because the UV depends only on (alpha, beta), a floor carried by a lattice deformation moves with objects
 * that keep their lattice coordinates.
 */

/** A lattice frame for floor UVs: p = origin + alpha*u + beta*v (cell-local meters) and the tile counts per lattice vector. */
export interface FloorLatticeUvFrame {
  readonly origin: { readonly x: number; readonly y: number };
  readonly u: { readonly x: number; readonly y: number };
  readonly v: { readonly x: number; readonly y: number };
  /** Positive integer number of texture tiles along u. */
  readonly tilesAlongU: number;
  /** Positive integer number of texture tiles along v. */
  readonly tilesAlongV: number;
}

/** UV (tilesAlongU*alpha, tilesAlongV*beta) of a cell-local floor point. */
export function floorLatticeUv(frame: FloorLatticeUvFrame, point: { readonly x: number; readonly y: number }): readonly [number, number] {
  const dx = point.x - frame.origin.x;
  const dy = point.y - frame.origin.y;
  const det = frame.u.x * frame.v.y - frame.u.y * frame.v.x;
  const alpha = (dx * frame.v.y - dy * frame.v.x) / det;
  const beta = (frame.u.x * dy - frame.u.y * dx) / det;
  return [frame.tilesAlongU * alpha, frame.tilesAlongV * beta];
}

/** UV (x/T, y/T) of a cell-local floor point, so one texture tile is T meters; T <= 0 or non-finite is treated as 1. */
export function floorMetricUv(point: { readonly x: number; readonly y: number }, tileSizeMeters: number): readonly [number, number] {
  const tile = tileSizeMeters > 0 && Number.isFinite(tileSizeMeters) ? tileSizeMeters : 1;
  return [point.x / tile, point.y / tile];
}

/** Whole number of tiles, at least 1, that best fits a length: max(1, round(length / T)); T <= 0 gives 1. */
export function floorTilesAlong(lengthMeters: number, tileSizeMeters: number): number {
  if (!(tileSizeMeters > 0) || !Number.isFinite(tileSizeMeters)) {
    return 1;
  }
  return Math.max(1, Math.round(lengthMeters / tileSizeMeters));
}
