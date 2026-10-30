/**
 * The exact per-frame visibility funnel: plan-direction sectors from the eye, clipped portal by portal, and the
 * four half-spaces through the eye that bound a path's visible region.
 *
 * Frames: the funnel is computed in the root cell's world axes (x right, y forward, z up, meters). The eye lies in
 * the root cell. Visible plan directions form a sector `W` of directions from the eye; a portal with developed
 * endpoints `left` L and `right` R is crossed forward by a line through the eye with direction `d` iff
 * `d . rotCW(L - e) >= 0` and `d . rotCCW(R - e) >= 0`. Only the newest portal's top and bottom edges bind
 * vertically. The visible region of a path is the cone of at most 4 half-spaces through the eye (`clipPlanes`:
 * right sector boundary, left sector boundary, top, bottom), and its image on screen is the NDC square clipped by
 * the 4 corresponding lines (at most 8 vertices, no near plane).
 *
 * Pure numeric code. The only THREE-specific input is the column-major element arrays of a camera's projection
 * and view matrices. The traversal-facing functions work on caller-owned `Float64Array`s and allocate nothing.
 */

import type { Vec2xy } from "../../math/polygons";
import type { Vec3 } from "../../math/vec3";
import type { OrientedPortalSegment } from "../../cell-complex/orientedPortal";

/** Plan directions from the eye: all directions, or the ccw sector from `right` to `left` (angle in [0, pi]). Unit vectors. */
export type DirectionSector =
  | { readonly full: true }
  | { readonly full: false; readonly right: Vec2xy; readonly left: Vec2xy };

const sectorTolerance = 1e-12;
const eyeOnPortalLineToleranceMeters = 1e-6;
const degenerateCrossTolerance = 1e-12;

/** Number of `Float64Array` slots of one packed sector: right.x, right.y, left.x, left.y (NaN in slot 0 = full). */
export const sectorSlotSize = 4;
/** Number of planes of a path and the `Float64Array` length that holds them. */
export const clipPlaneCount = 4;
export const clipPlaneArrayLength = 16;

/** Writes the packed "all directions" sector at `offset`. */
export function writeFullSector(out: Float64Array, offset: number): void {
  out[offset] = Number.NaN;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = 0;
}

/**
 * Keeps `{d : d . g >= 0}` of the packed sector at `input[inOffset]`, writing the packed result to `out[outOffset]`
 * (`out` may be the same array as `input`, at a different or the same offset). `(gx, gy)` need not be normalized.
 * Returns false when the result is empty (angle 0 or no directions); `out` is then unspecified.
 */
export function clipPackedSector(
  input: Float64Array,
  inOffset: number,
  gxRaw: number,
  gyRaw: number,
  out: Float64Array,
  outOffset: number,
): boolean {
  const gLength = Math.hypot(gxRaw, gyRaw);

  if (!(gLength > sectorTolerance)) {
    // A zero constraint (eye on a portal endpoint) excludes nothing.
    if (input !== out || inOffset !== outOffset) {
      out[outOffset] = input[inOffset];
      out[outOffset + 1] = input[inOffset + 1];
      out[outOffset + 2] = input[inOffset + 2];
      out[outOffset + 3] = input[inOffset + 3];
    }
    return true;
  }

  const gx = gxRaw / gLength;
  const gy = gyRaw / gLength;

  if (Number.isNaN(input[inOffset])) {
    // Half-plane {d . g >= 0}: right = rotCW(g), left = rotCCW(g).
    out[outOffset] = gy;
    out[outOffset + 1] = -gx;
    out[outOffset + 2] = -gy;
    out[outOffset + 3] = gx;
    return true;
  }

  const rx = input[inOffset];
  const ry = input[inOffset + 1];
  const lx = input[inOffset + 2];
  const ly = input[inOffset + 3];
  const a = gx * rx + gy * ry;
  const b = gx * lx + gy * ly;
  const crossRL = rx * ly - ry * lx;
  const dotRL = rx * lx + ry * ly;
  const isPi = crossRL <= sectorTolerance && dotRL < 0;

  if (a >= -sectorTolerance && b >= -sectorTolerance) {
    // g . rotCCW(right) = -gx * ry + gy * rx
    if (isPi && -gx * ry + gy * rx < -sectorTolerance) {
      return false;
    }
    out[outOffset] = rx;
    out[outOffset + 1] = ry;
    out[outOffset + 2] = lx;
    out[outOffset + 3] = ly;
    return true;
  }

  if (a < -sectorTolerance && b < -sectorTolerance) {
    return false;
  }

  let nrx = rx;
  let nry = ry;
  let nlx = lx;
  let nly = ly;

  if (a >= -sectorTolerance) {
    // The left boundary moves.
    if (isPi) {
      // t in {rotCW(g), rotCCW(g)} with cross(right, t) >= 0.
      const cw = rx * -gx - ry * gy;

      if (cw >= 0) {
        nlx = gy;
        nly = -gx;
      } else {
        nlx = -gy;
        nly = gx;
      }
    } else {
      const px = a * lx - b * rx;
      const py = a * ly - b * ry;
      const pl = Math.hypot(px, py);

      nlx = px / pl;
      nly = py / pl;
    }
  } else if (isPi) {
    // The right boundary moves: t with cross(t, left) >= 0.
    const cw = gy * ly - -gx * lx;

    if (cw >= 0) {
      nrx = gy;
      nry = -gx;
    } else {
      nrx = -gy;
      nry = gx;
    }
  } else {
    const px = b * rx - a * lx;
    const py = b * ry - a * ly;
    const pl = Math.hypot(px, py);

    nrx = px / pl;
    nry = py / pl;
  }

  if (nrx * nly - nry * nlx <= sectorTolerance && nrx * nlx + nry * nly > 0) {
    return false;
  }

  out[outOffset] = nrx;
  out[outOffset + 1] = nry;
  out[outOffset + 2] = nlx;
  out[outOffset + 3] = nly;
  return true;
}

const portalClipScratch = new Float64Array(sectorSlotSize);

/**
 * Clips the packed sector at `input[inOffset]` by a portal seen from eye `(ex, ey)`: first by
 * `rotCW(L - e)` then by `rotCCW(R - e)`. Writes the packed result to `out[outOffset]`; returns false when empty.
 * Not re-entrant (shares one module scratch).
 */
export function clipPackedSectorByPortal(
  input: Float64Array,
  inOffset: number,
  portal: OrientedPortalSegment,
  ex: number,
  ey: number,
  out: Float64Array,
  outOffset: number,
): boolean {
  const lx = portal.left.x - ex;
  const ly = portal.left.y - ey;
  const rx = portal.right.x - ex;
  const ry = portal.right.y - ey;

  if (!clipPackedSector(input, inOffset, ly, -lx, portalClipScratch, 0)) {
    return false;
  }

  return clipPackedSector(portalClipScratch, 0, -ry, rx, out, outOffset);
}

/** Converts a packed sector to the object form. */
export function unpackDirectionSector(packed: Float64Array, offset: number): DirectionSector {
  if (Number.isNaN(packed[offset])) {
    return { full: true };
  }

  return {
    full: false,
    right: { x: packed[offset], y: packed[offset + 1] },
    left: { x: packed[offset + 2], y: packed[offset + 3] },
  };
}

function packDirectionSector(sector: DirectionSector, out: Float64Array, offset: number): void {
  if (sector.full) {
    writeFullSector(out, offset);
    return;
  }

  out[offset] = sector.right.x;
  out[offset + 1] = sector.right.y;
  out[offset + 2] = sector.left.x;
  out[offset + 3] = sector.left.y;
}

/**
 * Keeps the plan directions `d` of `sector` with `d . g >= 0` (tolerance 1e-12 on unit vectors). From the full
 * sector the result is the closed half-plane (angle pi). Returns `undefined` when nothing with positive angle is
 * left. `g` need not be normalized; a zero `g` excludes nothing. Allocates (tested helper; the traversal uses
 * {@link clipPackedSector}).
 */
export function clipDirectionSector(sector: DirectionSector, g: Vec2xy): DirectionSector | undefined {
  const input = new Float64Array(sectorSlotSize);
  const out = new Float64Array(sectorSlotSize);

  packDirectionSector(sector, input, 0);

  return clipPackedSector(input, 0, g.x, g.y, out, 0) ? unpackDirectionSector(out, 0) : undefined;
}

/** Clips `sector` by a portal seen from `eye`: `rotCW(L - e)` first, then `rotCCW(R - e)`. `undefined` = empty. */
export function clipSectorByPortal(
  sector: DirectionSector,
  portal: OrientedPortalSegment,
  eye: Vec2xy,
): DirectionSector | undefined {
  const input = new Float64Array(sectorSlotSize);
  const out = new Float64Array(sectorSlotSize);

  packDirectionSector(sector, input, 0);

  return clipPackedSectorByPortal(input, 0, portal, eye.x, eye.y, out, 0) ? unpackDirectionSector(out, 0) : undefined;
}

/** Writes the "always inside" plane `(0, 0, 0, 1)` at `out[offset .. offset + 3]`. */
function writeAlwaysInsidePlane(out: Float64Array, offset: number): void {
  out[offset] = 0;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = 1;
}

/** Writes four "always inside" planes (the root path) at `out[offset .. offset + 15]`. */
export function writeAlwaysInsideClipPlanes(out: Float64Array, offset: number): void {
  for (let plane = 0; plane < clipPlaneCount; plane += 1) {
    writeAlwaysInsidePlane(out, offset + plane * 4);
  }
}

// Writes a plane given in world axes as a Three-axes plane: n (x, y, z) -> (x, z, -y), d unchanged.
function writeWorldPlaneAsThree(out: Float64Array, offset: number, nx: number, ny: number, nz: number, d: number): void {
  out[offset] = nx;
  out[offset + 1] = nz;
  out[offset + 2] = -ny;
  out[offset + 3] = d;
}

// Plane through the eye E and the horizontal edge from A to B (cross product normal), oriented so that `inside` is
// on the positive side. `fallback*` applies for a degenerate (eye on the edge's line) cross product.
function writeEdgePlane(
  out: Float64Array,
  offset: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  ex: number, ey: number, ez: number,
  insideX: number, insideY: number, insideZ: number,
  fallbackNz: number, fallbackD: number,
): void {
  const ux = ax - ex;
  const uy = ay - ey;
  const uz = az - ez;
  const vx = bx - ex;
  const vy = by - ey;
  const vz = bz - ez;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);

  if (length < degenerateCrossTolerance) {
    writeWorldPlaneAsThree(out, offset, 0, 0, fallbackNz, fallbackD);
    return;
  }

  nx /= length;
  ny /= length;
  nz /= length;

  let d = -(nx * ex + ny * ey + nz * ez);

  if (nx * insideX + ny * insideY + nz * insideZ + d < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
    d = -d;
  }

  writeWorldPlaneAsThree(out, offset, nx, ny, nz, d);
}

/**
 * Writes the four clip planes of a path at `out[offset .. offset + 15]`, in the Three.js frame of the root cell.
 * Order: 0 = right sector boundary, 1 = left sector boundary, 2 = top edge of the newest portal, 3 = bottom edge.
 * Inside is `n . X + d >= 0`, `|n| = 1`, or `(0, 0, 0, 1)` for "always inside". Inputs are in world axes:
 * the unit sector boundaries `(rightX, rightY)` and `(leftX, leftY)`, the newest `portal`, and the eye `(ex, ey, ez)`.
 * The top and bottom planes are "always inside" when the eye lies within 1e-6 m of the portal's vertical plane.
 */
export function writeFunnelClipPlanes(
  out: Float64Array,
  offset: number,
  rightX: number,
  rightY: number,
  leftX: number,
  leftY: number,
  portal: OrientedPortalSegment,
  ex: number,
  ey: number,
  ez: number,
): void {
  // plane 0: n = (-right.y, right.x, 0); plane 1: n = (left.y, -left.x, 0).
  const n0x = -rightY;
  const n0y = rightX;
  writeWorldPlaneAsThree(out, offset, n0x, n0y, 0, -(n0x * ex + n0y * ey));

  const n1x = leftY;
  const n1y = -leftX;
  writeWorldPlaneAsThree(out, offset + 4, n1x, n1y, 0, -(n1x * ex + n1y * ey));

  const lx = portal.left.x;
  const ly = portal.left.y;
  const rx = portal.right.x;
  const ry = portal.right.y;
  const wx = rx - lx;
  const wy = ry - ly;
  const wLength = Math.hypot(wx, wy);
  const distanceToLine = wLength > 0 ? Math.abs(wx * (ey - ly) - wy * (ex - lx)) / wLength : 0;

  if (distanceToLine < eyeOnPortalLineToleranceMeters) {
    writeAlwaysInsidePlane(out, offset + 8);
    writeAlwaysInsidePlane(out, offset + 12);
    return;
  }

  const top = portal.apertureTopMeters;
  const mx = (lx + rx) / 2;
  const my = (ly + ry) / 2;

  writeEdgePlane(out, offset + 8, rx, ry, top, lx, ly, top, ex, ey, ez, mx, my, 0, -1, top);
  writeEdgePlane(out, offset + 12, rx, ry, 0, lx, ly, 0, ex, ey, ez, mx, my, top, 1, 0);
}

/** Convenience wrapper over {@link writeFunnelClipPlanes} taking a `Vec3` eye and object sector boundaries. */
export function funnelClipPlanes(sectorRight: Vec2xy, sectorLeft: Vec2xy, portal: OrientedPortalSegment, eye: Vec3): Float64Array {
  const planes = new Float64Array(clipPlaneArrayLength);

  writeFunnelClipPlanes(planes, 0, sectorRight.x, sectorRight.y, sectorLeft.x, sectorLeft.y, portal, eye.x, eye.y, eye.z);

  return planes;
}

const polygonBufferA = new Float64Array(2 * 16);
const polygonBufferB = new Float64Array(2 * 16);

/**
 * Clips the NDC square `[-1,1]^2` by the half-planes of the image of `planes` (4 planes, Three frame, through the
 * eye) and writes the polygon vertices (x, y pairs) to `out`; returns the vertex count (0 when empty, at most 8).
 *
 * A plane with camera-space normal `n_c` keeps NDC points with
 * `g(p) = (n_c.x / P00) p.x + (n_c.y / P11) p.y + (n_c.x P02 / P00 + n_c.y P12 / P11 - n_c.z) >= 0`, where `P` is the
 * perspective projection (`projectionElements`, column-major, `P02 = e[8]`, `P12 = e[9]`) and `n_c = R_view n`
 * (`viewElements` = column-major `matrixWorldInverse`; only its upper 3x3 is read). A non-perspective projection
 * returns the full square (conservative). Not re-entrant.
 */
export function clipPlanesToNdcPolygon(
  planes: Float64Array,
  projectionElements: ArrayLike<number>,
  viewElements: ArrayLike<number>,
  out: Float64Array,
): number {
  let current = polygonBufferA;
  let next = polygonBufferB;

  current[0] = -1; current[1] = -1;
  current[2] = 1; current[3] = -1;
  current[4] = 1; current[5] = 1;
  current[6] = -1; current[7] = 1;
  let count = 4;

  const p00 = projectionElements[0];
  const p11 = projectionElements[5];
  const p02 = projectionElements[8];
  const p12 = projectionElements[9];
  const isPerspective =
    Math.abs(projectionElements[11] + 1) <= 1e-9 && Math.abs(projectionElements[15]) <= 1e-9 && p00 !== 0 && p11 !== 0;

  if (isPerspective) {
    for (let plane = 0; plane < clipPlaneCount && count > 0; plane += 1) {
      const nx = planes[plane * 4];
      const ny = planes[plane * 4 + 1];
      const nz = planes[plane * 4 + 2];

      if (nx === 0 && ny === 0 && nz === 0) {
        continue;
      }

      const ncx = viewElements[0] * nx + viewElements[4] * ny + viewElements[8] * nz;
      const ncy = viewElements[1] * nx + viewElements[5] * ny + viewElements[9] * nz;
      const ncz = viewElements[2] * nx + viewElements[6] * ny + viewElements[10] * nz;
      const gx = ncx / p00;
      const gy = ncy / p11;
      const g0 = gx * p02 + gy * p12 - ncz;
      let nextCount = 0;

      for (let index = 0; index < count; index += 1) {
        const following = index + 1 === count ? 0 : index + 1;
        const cx = current[index * 2];
        const cy = current[index * 2 + 1];
        const fx = current[following * 2];
        const fy = current[following * 2 + 1];
        const cValue = gx * cx + gy * cy + g0;
        const fValue = gx * fx + gy * fy + g0;
        const cInside = cValue >= 0;
        const fInside = fValue >= 0;

        if (cInside !== fInside) {
          const alpha = cValue / (cValue - fValue);

          next[nextCount * 2] = cx + (fx - cx) * alpha;
          next[nextCount * 2 + 1] = cy + (fy - cy) * alpha;
          nextCount += 1;
        }

        if (fInside) {
          next[nextCount * 2] = fx;
          next[nextCount * 2 + 1] = fy;
          nextCount += 1;
        }
      }

      count = nextCount;
      const swap = current;

      current = next;
      next = swap;
    }
  }

  if (count < 3) {
    return 0;
  }

  for (let index = 0; index < count * 2; index += 1) {
    out[index] = current[index];
  }

  return count;
}
