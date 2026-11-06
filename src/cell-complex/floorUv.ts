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
 *
 * Rigid patches: the torus floor is painted from anchors A(i, j) = o + i*u/nU + j*v/nV, which are the tile lattice, so every
 * anchor's UV is an integer and no per-anchor UV offset exists. A patch paints uv = G (p - A) with G a constant matrix taken
 * from the base state, so pebbles keep their shape in every state; patches are blended by a compact kernel and the result is
 * seamless across u and v. floorPatchSamples is the specification of the shader in src/render/three/floorPatchMaterial.ts.
 */
import { latticeCoveringRadius, reduceLatticeBasis } from "../math/latticeReduction";

const floorPatchRadiusFactor = 1.25;
const floorPatchRelativeWeightFloor = 0.02;

/** A lattice frame for floor UVs: p = origin + alpha*u + beta*v (cell-local meters) and the tile counts per lattice vector. */
export interface FloorLatticeUvFrame {
  readonly origin: { readonly x: number; readonly y: number };
  readonly u: { readonly x: number; readonly y: number };
  readonly v: { readonly x: number; readonly y: number };
  /** Positive integer number of texture tiles along u. */
  readonly tilesAlongU: number;
  /** Positive integer number of texture tiles along v. */
  readonly tilesAlongV: number;
  /** Lattice vector u of the base (undeformed) state, which fixes the shape of a rigid floor patch. */
  readonly restU: { readonly x: number; readonly y: number };
  /** Lattice vector v of the base (undeformed) state. */
  readonly restV: { readonly x: number; readonly y: number };
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

/** Plain numbers that describe the rigid floor patches of one state; JSON-safe, because it travels in `material.userData`. */
export interface FloorPatchField {
  /** Anchor (0, 0), cell-local meters. */
  readonly origin: { readonly x: number; readonly y: number };
  /** Reduced basis of the anchor lattice, meters. */
  readonly step1: { readonly x: number; readonly y: number };
  readonly step2: { readonly x: number; readonly y: number };
  /** Rows of the inverse of the matrix with columns step1, step2. */
  readonly inverseRow1: { readonly x: number; readonly y: number };
  readonly inverseRow2: { readonly x: number; readonly y: number };
  /** Rows of the constant map from meters to UV, taken from the base state. */
  readonly metersToUvRow1: { readonly x: number; readonly y: number };
  readonly metersToUvRow2: { readonly x: number; readonly y: number };
  /** 1 / R^2, with R the patch radius in meters. */
  readonly inverseRadiusSquared: number;
}

/** One patch that contributes to a floor point: its UV there and its normalized weight. */
export interface FloorPatchSample {
  readonly uv: readonly [number, number];
  readonly weight: number;
}

/** Builds the patch field of a frame; see the module header. */
export function floorPatchField(frame: FloorLatticeUvFrame): FloorPatchField {
  const anchorU = { x: frame.u.x / frame.tilesAlongU, y: frame.u.y / frame.tilesAlongU };
  const anchorV = { x: frame.v.x / frame.tilesAlongV, y: frame.v.y / frame.tilesAlongV };
  const basis = reduceLatticeBasis(anchorU, anchorV);
  const radius = floorPatchRadiusFactor * latticeCoveringRadius(basis);
  const inverse = inverseRows(basis.first, basis.second);
  const metersToUv = inverseRows(
    { x: frame.restU.x / frame.tilesAlongU, y: frame.restU.y / frame.tilesAlongU },
    { x: frame.restV.x / frame.tilesAlongV, y: frame.restV.y / frame.tilesAlongV },
  );
  return {
    origin: frame.origin,
    step1: basis.first,
    step2: basis.second,
    inverseRow1: inverse.row1,
    inverseRow2: inverse.row2,
    metersToUvRow1: metersToUv.row1,
    metersToUvRow2: metersToUv.row2,
    inverseRadiusSquared: 1 / (radius * radius),
  };
}

/**
 * The patches that paint a floor point, with weights summing to 1. This is the specification of the floor shader: change them together.
 */
export function floorPatchSamples(field: FloorPatchField, point: { readonly x: number; readonly y: number }): readonly FloorPatchSample[] {
  const offsetX = point.x - field.origin.x;
  const offsetY = point.y - field.origin.y;
  const centerM = Math.floor(field.inverseRow1.x * offsetX + field.inverseRow1.y * offsetY + 0.5);
  const centerN = Math.floor(field.inverseRow2.x * offsetX + field.inverseRow2.y * offsetY + 0.5);
  const candidates: { readonly toPointX: number; readonly toPointY: number; readonly kernel: number }[] = [];
  let maxKernel = 0;
  for (let index = 0; index < 9; index += 1) {
    const m = centerM + (index % 3) - 1;
    const n = centerN + Math.floor(index / 3) - 1;
    const toPointX = offsetX - m * field.step1.x - n * field.step2.x;
    const toPointY = offsetY - m * field.step1.y - n * field.step2.y;
    const falloff = Math.max(1 - (toPointX * toPointX + toPointY * toPointY) * field.inverseRadiusSquared, 0);
    const kernel = falloff ** 16;
    candidates.push({ toPointX, toPointY, kernel });
    maxKernel = Math.max(maxKernel, kernel);
  }
  const weightFloor = floorPatchRelativeWeightFloor * maxKernel;
  const kept = candidates.filter((candidate) => candidate.kernel > weightFloor);
  const weightSum = kept.reduce((sum, candidate) => sum + candidate.kernel - weightFloor, 0);
  return kept.map((candidate) => ({
    uv: [
      field.metersToUvRow1.x * candidate.toPointX + field.metersToUvRow1.y * candidate.toPointY,
      field.metersToUvRow2.x * candidate.toPointX + field.metersToUvRow2.y * candidate.toPointY,
    ],
    weight: (candidate.kernel - weightFloor) / weightSum,
  }));
}

// Rows of the inverse of the 2x2 matrix with the given columns.
function inverseRows(
  column1: { readonly x: number; readonly y: number },
  column2: { readonly x: number; readonly y: number },
): { readonly row1: { readonly x: number; readonly y: number }; readonly row2: { readonly x: number; readonly y: number } } {
  const determinant = column1.x * column2.y - column2.x * column1.y;
  return {
    row1: { x: column2.y / determinant, y: -column2.x / determinant },
    row2: { x: -column1.y / determinant, y: column1.x / determinant },
  };
}

/** Whole number of tiles, at least 1, that best fits a length: max(1, round(length / T)); T <= 0 gives 1. */
export function floorTilesAlong(lengthMeters: number, tileSizeMeters: number): number {
  if (!(tileSizeMeters > 0) || !Number.isFinite(tileSizeMeters)) {
    return 1;
  }
  return Math.max(1, Math.round(lengthMeters / tileSizeMeters));
}
