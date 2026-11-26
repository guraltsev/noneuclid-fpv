/**
 * Geometry of a metric floor split into an inner polygon and one blend strip per side (design 018 section 8.3).
 *
 * The cell polygon is inset by `w` (each inner vertex lies on the corner bisector, at distance `w` from both adjacent sides). The inner
 * polygon keeps the cell's own texture. Strip `i` is the trapezoid `v_i, v_{i+1}, inner_{i+1}, inner_i`; neighbouring strips meet along the
 * corner bisector, so the floor is watertight and every inner vertex is shared. The outer and inner edge of a side are cut into the same
 * number of equal segments (at most 1.5 m each) and the inner polygon is a fan over those boundary points, so no T-junction opens a crack.
 *
 * Every strip vertex carries, besides `position` (three.js axes: cell-local (x, y) becomes (x, 0, -y)), `normal` and `uv`:
 * - `neighbourUv`: the metric UV of the same physical point in the neighbour cell (the point carried through the portal, the neighbour's tile
 *   size), so the neighbour's texture pattern continues exactly across the border;
 * - `neighbourPoint`: that point's (x, y) in the neighbour's cell-local frame, for sampling the neighbour's tint image;
 * - `blendCoord`: (t, s) in a frame both cells of a portal agree on. The glued side with the smaller key `"<cellId>:<sideIndex>"` measures
 *   `t` from its side's start and takes `s` positive into itself; the other measures `t` from its side's end and takes `s` negative into itself,
 *   so the same physical point gets the same (t, s) from both cells;
 * - `blendLength`: the side's length, for the noise taper;
 * - `blendSign`: +1 or -1, the factor that turns canonical `s` into the distance into the cell's own interior.
 * A side without a blend partner (a solid wall, or a neighbour with no floor texture) has itself as neighbour; its material forces the share to 0.
 */
import * as THREE from "three";
import { floorMetricUv } from "../../cell-complex/floorUv";
import type { CompiledPrismCell, CompiledPrismSide } from "../../cell-complex/prismCells";
import { transformPoint3 } from "../../math/rigidTransform3";
import { hashStringToSeed } from "../../world-assets/seededNoise";
import { blendHalfWidthMeters, blendNoiseAmplitudeMeters } from "./groundBlendMaterial";

/** Longest segment along a side of a strip, meters. */
export const blendStripSegmentMeters = 1.5;
/** The strip width is at most this fraction of the cell's inradius, so the inner polygon never collapses. */
export const blendStripInradiusFraction = 0.42;
/** The noise amplitude is at most this fraction of the strip width, so the transition ends inside the strip. */
export const blendNoiseWidthFraction = 0.4;

/** One blend strip of a cell and what its material needs to know about the glued side. */
export interface FloorStrip {
  readonly sideIndex: number;
  readonly geometry: THREE.BufferGeometry;
  /** Cell that is on the other side of the portal and takes part in the blend, or undefined for a side that does not blend. */
  readonly neighbourCellId: string | undefined;
  /** Noise seed, equal for both cells of a portal. */
  readonly seed: number;
  /** Half-width `h` of the transition, meters, equal for both cells of a portal. */
  readonly halfWidthMeters: number;
  /** Amplitude of the noise, meters, equal for both cells of a portal. */
  readonly noiseAmplitudeMeters: number;
}

/** The inner polygon and strips of a cell's floor. */
export interface FloorBlendGeometry {
  /** The cell polygon inset by the strip width; own texture. */
  readonly inner: THREE.BufferGeometry;
  /** One strip per side, in side order. */
  readonly strips: readonly FloorStrip[];
  /** Strip width `w`, meters. */
  readonly stripWidthMeters: number;
}

/** Radius of the largest circle around the vertex centroid that fits in the cell (the inradius for a regular polygon, a lower bound otherwise), meters. */
export function cellInradiusMeters(cell: Pick<CompiledPrismCell, "baseVertices" | "sides">): number {
  const count = cell.baseVertices.length;
  const centreX = cell.baseVertices.reduce((sum, vertex) => sum + vertex.x, 0) / count;
  const centreY = cell.baseVertices.reduce((sum, vertex) => sum + vertex.y, 0) / count;
  return Math.min(...cell.sides.map((side) => (centreX - side.start.x) * side.inwardNormal.x + (centreY - side.start.y) * side.inwardNormal.y));
}

/** Strip width `w = min(blendHalfWidthMeters, 0.42 * inradius)` of a cell, meters. */
export function blendStripWidthMeters(cell: Pick<CompiledPrismCell, "baseVertices" | "sides">): number {
  return Math.min(blendHalfWidthMeters, blendStripInradiusFraction * cellInradiusMeters(cell));
}

/**
 * The transition between two cells whose strips are `widthA` and `widthB` wide: the narrower strip decides, the noise amplitude is limited to
 * a fraction of it, and the half-width `h` is what is left, so the neighbour's share is exactly 0 on the inner edge of both strips
 * (the noise cannot push the transition past it) and the strip meets the inner polygon without a seam.
 */
export function groundBlendTransition(widthA: number, widthB: number): { readonly halfWidthMeters: number; readonly noiseAmplitudeMeters: number } {
  const width = Math.min(widthA, widthB);
  const noiseAmplitudeMeters = Math.min(blendNoiseAmplitudeMeters, blendNoiseWidthFraction * width);
  return { halfWidthMeters: width - noiseAmplitudeMeters, noiseAmplitudeMeters };
}

function tileSizeOf(cell: CompiledPrismCell): number {
  return cell.floorMaterial.kind === "floor-texture" ? cell.floorMaterial.tileSizeMeters : 1;
}

function sideKey(cellId: string, sideIndex: number): string {
  return `${cellId}:${sideIndex}`;
}

/**
 * Builds the inner polygon and the strips of `cell`. `neighbourBySideIndex` names, per side, the cell the strip blends into; a side that is
 * missing from the map (or a neighbour whose glued side cannot be found) gets a strip that does not blend.
 */
export function buildFloorBlendGeometry(
  cell: CompiledPrismCell,
  neighbourBySideIndex: ReadonlyMap<number, CompiledPrismCell>,
): FloorBlendGeometry {
  const count = cell.baseVertices.length;
  const width = blendStripWidthMeters(cell);
  const ownTile = tileSizeOf(cell);
  const inner = cell.baseVertices.map((vertex, index) => {
    const before = cell.sides[(index + count - 1) % count].inwardNormal;
    const after = cell.sides[index].inwardNormal;
    const scale = width / (1 + before.x * after.x + before.y * after.y);
    return { x: vertex.x + (before.x + after.x) * scale, y: vertex.y + (before.y + after.y) * scale };
  });
  const segmentCounts = cell.sides.map((side) => Math.max(1, Math.ceil(side.lengthMeters / blendStripSegmentMeters)));
  const strips = cell.sides.map((side) =>
    buildStrip(cell, side, inner[side.sideIndex], inner[(side.sideIndex + 1) % count], segmentCounts[side.sideIndex], width, ownTile, neighbourBySideIndex.get(side.sideIndex)),
  );

  return { inner: buildInnerFan(inner, segmentCounts, ownTile), strips, stripWidthMeters: width };
}

type Point = { readonly x: number; readonly y: number };

function lerpPoint(from: Point, to: Point, fraction: number): Point {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

// The inner polygon as a fan from its centroid over every boundary point, the same points the strips' inner edges use.
function buildInnerFan(inner: readonly Point[], segmentCounts: readonly number[], tileSizeMeters: number): THREE.BufferGeometry {
  const boundary: Point[] = [];

  inner.forEach((from, index) => {
    for (let step = 0; step < segmentCounts[index]; step += 1) {
      boundary.push(lerpPoint(from, inner[(index + 1) % inner.length], step / segmentCounts[index]));
    }
  });

  const centre = { x: inner.reduce((sum, p) => sum + p.x, 0) / inner.length, y: inner.reduce((sum, p) => sum + p.y, 0) / inner.length };
  const points = [centre, ...boundary];
  const positions = new Float32Array(points.length * 3);
  const normals = new Float32Array(points.length * 3);
  const uvs = new Float32Array(points.length * 2);
  points.forEach((point, index) => {
    positions.set([point.x, 0, -point.y], index * 3);
    normals.set([0, 1, 0], index * 3);
    uvs.set(floorMetricUv(point, tileSizeMeters), index * 2);
  });
  const indices: number[] = [];

  for (let index = 0; index < boundary.length; index += 1) {
    indices.push(0, 1 + index, 1 + ((index + 1) % boundary.length));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function buildStrip(
  cell: CompiledPrismCell,
  side: CompiledPrismSide,
  innerStart: Point,
  innerEnd: Point,
  segments: number,
  width: number,
  ownTile: number,
  neighbour: CompiledPrismCell | undefined,
): FloorStrip {
  const portal = side.portal;
  const neighbourSide = portal && neighbour ? neighbour.portalsById.get(portal.targetPortalId)?.sideIndex : undefined;
  const blends = portal !== undefined && neighbour !== undefined && neighbourSide !== undefined;
  const ownKey = sideKey(cell.id, side.sideIndex);
  const otherKey = blends ? sideKey(neighbour.id, neighbourSide) : ownKey;
  // The glued side with the smaller key is canonical: t from its start and s into itself.
  const isCanonical = !blends || ownKey <= otherKey;
  const blendSign = isCanonical ? 1 : -1;
  const neighbourTile = blends ? tileSizeOf(neighbour) : ownTile;
  const dirX = (side.end.x - side.start.x) / side.lengthMeters;
  const dirY = (side.end.y - side.start.y) / side.lengthMeters;
  const rows = 2;
  const vertexCount = (segments + 1) * rows;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const neighbourUvs = new Float32Array(vertexCount * 2);
  const neighbourPoints = new Float32Array(vertexCount * 2);
  const blendCoords = new Float32Array(vertexCount * 2);
  const blendLengths = new Float32Array(vertexCount).fill(side.lengthMeters);
  const blendSigns = new Float32Array(vertexCount).fill(blendSign);

  for (let row = 0; row < rows; row += 1) {
    for (let step = 0; step <= segments; step += 1) {
      const index = row * (segments + 1) + step;
      const point = row === 0 ? lerpPoint(side.start, side.end, step / segments) : lerpPoint(innerStart, innerEnd, step / segments);
      const mapped = blends ? mapThroughPortal(portal.transformToTarget, point) : point;
      const along = (point.x - side.start.x) * dirX + (point.y - side.start.y) * dirY;
      const into = (point.x - side.start.x) * side.inwardNormal.x + (point.y - side.start.y) * side.inwardNormal.y;
      positions.set([point.x, 0, -point.y], index * 3);
      normals.set([0, 1, 0], index * 3);
      uvs.set(floorMetricUv(point, ownTile), index * 2);
      neighbourUvs.set(floorMetricUv(mapped, neighbourTile), index * 2);
      neighbourPoints.set([mapped.x, mapped.y], index * 2);
      blendCoords.set([isCanonical ? along : side.lengthMeters - along, isCanonical ? into : -into], index * 2);
    }
  }

  const indices: number[] = [];

  for (let step = 0; step < segments; step += 1) {
    const outerNow = step;
    const outerNext = step + 1;
    const innerNow = segments + 1 + step;
    const innerNext = segments + 2 + step;
    indices.push(outerNow, outerNext, innerNext, outerNow, innerNext, innerNow);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("neighbourUv", new THREE.BufferAttribute(neighbourUvs, 2));
  geometry.setAttribute("neighbourPoint", new THREE.BufferAttribute(neighbourPoints, 2));
  geometry.setAttribute("blendCoord", new THREE.BufferAttribute(blendCoords, 2));
  geometry.setAttribute("blendLength", new THREE.BufferAttribute(blendLengths, 1));
  geometry.setAttribute("blendSign", new THREE.BufferAttribute(blendSigns, 1));
  geometry.setIndex(indices);

  const transition = blends ? groundBlendTransition(width, blendStripWidthMeters(neighbour)) : groundBlendTransition(width, width);
  return {
    sideIndex: side.sideIndex,
    geometry,
    neighbourCellId: blends ? neighbour.id : undefined,
    seed: (hashStringToSeed(ownKey <= otherKey ? `${ownKey}|${otherKey}` : `${otherKey}|${ownKey}`) % 4096) / 64,
    halfWidthMeters: transition.halfWidthMeters,
    noiseAmplitudeMeters: transition.noiseAmplitudeMeters,
  };
}

function mapThroughPortal(transform: Parameters<typeof transformPoint3>[0], point: Point): Point {
  const mapped = transformPoint3(transform, { x: point.x, y: point.y, z: 0 });
  return { x: mapped.x, y: mapped.y };
}
