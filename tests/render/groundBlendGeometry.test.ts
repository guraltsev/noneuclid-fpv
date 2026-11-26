/**
 * `tests/render/groundBlendGeometry.test.ts` — unit tier.
 *
 * A metric floor is an inner polygon plus one strip per side (design 018 section 8.3). The pieces tile the cell polygon exactly
 * (watertight, shared inner vertices, no overlap) on a square and on a triangle; the strip width is clamped by the inradius; and on the real
 * basic cube both cells of a portal give the same canonical (t, s) at the same physical point, opposite blend signs, the same seed, and a
 * `neighbourUv` that equals the other cell's own `uv` there.
 */
import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { basicCube, basicTetrahedron } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../src/cell-complex/prismCells";
import { transformPoint3 } from "../../src/math/rigidTransform3";
import {
  blendCornerSlopeFraction,
  blendStripSegmentMeters,
  blendStripWidthMeters,
  buildFloorBlendGeometry,
  cellInradiusMeters,
  groundBlendTransition,
} from "../../src/render/three/groundBlendGeometry";
import { blendHalfWidthMeters, blendNoiseAmplitudeMeters } from "../../src/render/three/groundBlendMaterial";

const cube = compileCellComplex(basicCube);
const tetrahedron = compileCellComplex(basicTetrahedron);

// Neighbour map of a cell in its world: every portal side blends into the glued cell.
function neighboursOf(world: { readonly cellsById: ReadonlyMap<string, CompiledPrismCell> }, cell: CompiledPrismCell): Map<number, CompiledPrismCell> {
  return new Map(cell.portals.map((portal) => [portal.sideIndex, world.cellsById.get(portal.targetCellId)!]));
}

// Area of the triangles of an indexed geometry in the floor plane (|y| ignored), and the sum of |area| as a watertightness check.
function totalArea(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  let sum = 0;
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const ux = position.getX(b) - position.getX(a);
    const uz = position.getZ(b) - position.getZ(a);
    const vx = position.getX(c) - position.getX(a);
    const vz = position.getZ(c) - position.getZ(a);
    sum += Math.abs(ux * vz - uz * vx) / 2;
  }
  return sum;
}

function polygonArea(cell: CompiledPrismCell): number {
  const v = cell.baseVertices;
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) {
    const next = v[(i + 1) % v.length];
    sum += v[i].x * next.y - next.x * v[i].y;
  }
  return Math.abs(sum) / 2;
}

describe("floor blend geometry", () => {
  it.each([
    ["square", cube.cells[0]],
    ["triangle", tetrahedron.cells[0]],
  ] as const)("tiles a %s cell exactly with the inner polygon and the strips", (_name, cell) => {
    const geometry = buildFloorBlendGeometry(cell, new Map());
    const pieces = [geometry.inner, ...geometry.strips.map((strip) => strip.geometry)];
    expect(pieces.reduce((sum, piece) => sum + totalArea(piece), 0)).toBeCloseTo(polygonArea(cell), 3);
    expect(geometry.strips).toHaveLength(cell.baseVertices.length);
  });

  it("tiles a small triangle whose strip width is limited by the inradius", () => {
    const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: (10 * Math.sqrt(3)) / 2 }];
    const cell = { id: "small", baseVertices: corners, sides: polygonSides(corners), floorMaterial: { kind: "floor-color", floorColor: "#fff" } } as unknown as CompiledPrismCell;
    const geometry = buildFloorBlendGeometry(cell, new Map());
    expect(geometry.stripWidthMeters).toBeLessThan(blendHalfWidthMeters);
    expect([geometry.inner, ...geometry.strips.map((strip) => strip.geometry)].reduce((sum, piece) => sum + totalArea(piece), 0)).toBeCloseTo(polygonArea(cell), 3);
  });

  it.each([
    ["square", cube.cells[0]],
    ["triangle", tetrahedron.cells[0]],
  ] as const)("puts the outer edge of every strip on its side and shares the inner vertices (%s)", (_name, cell) => {
    const geometry = buildFloorBlendGeometry(cell, new Map());
    const innerPositions = geometry.inner.getAttribute("position");
    const innerPoints = Array.from({ length: innerPositions.count }, (_, i) => [innerPositions.getX(i), innerPositions.getZ(i)]);

    for (const strip of geometry.strips) {
      const side = cell.sides[strip.sideIndex];
      const position = strip.geometry.getAttribute("position");
      const perRow = position.count / 2;
      expect(side.lengthMeters / (perRow - 1)).toBeLessThanOrEqual(blendStripSegmentMeters + 1e-9);

      for (let k = 0; k < perRow; k += 1) {
        // Outer row: on the side. Cell-local y is -z.
        const outer = { x: position.getX(k), y: -position.getZ(k) };
        const into = (outer.x - side.start.x) * side.inwardNormal.x + (outer.y - side.start.y) * side.inwardNormal.y;
        const along = ((outer.x - side.start.x) * (side.end.x - side.start.x) + (outer.y - side.start.y) * (side.end.y - side.start.y)) / side.lengthMeters;
        expect(into).toBeCloseTo(0, 4);
        expect(along).toBeCloseTo((k / (perRow - 1)) * side.lengthMeters, 4);
        // Inner row: at distance w from the side and a vertex of the inner polygon's boundary.
        const x = position.getX(perRow + k);
        const z = position.getZ(perRow + k);
        const inner = { x, y: -z };
        expect((inner.x - side.start.x) * side.inwardNormal.x + (inner.y - side.start.y) * side.inwardNormal.y).toBeCloseTo(geometry.stripWidthMeters, 4);
        expect(innerPoints.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1e-5)).toBe(true);
      }
    }
  });

  it("clamps the strip width by the inradius", () => {
    expect(cellInradiusMeters(cube.cells[0])).toBeCloseTo(7.5, 6);
    expect(blendStripWidthMeters(cube.cells[0])).toBe(blendHalfWidthMeters);
    // An equilateral triangle of side 10 has inradius 10 / (2 sqrt 3).
    const height = (10 * Math.sqrt(3)) / 2;
    const triangle = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: height }];
    const inradius = 10 / (2 * Math.sqrt(3));
    expect(cellInradiusMeters({ baseVertices: triangle, sides: polygonSides(triangle) })).toBeCloseTo(inradius, 6);
    expect(blendStripWidthMeters({ baseVertices: triangle, sides: polygonSides(triangle) })).toBeCloseTo(0.42 * inradius, 6);
    const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(blendStripWidthMeters({ baseVertices: square, sides: polygonSides(square) })).toBeCloseTo(0.42, 6);
  });

  it("keeps the transition inside the strip", () => {
    for (const width of [2.6, 1.82, 0.4]) {
      const { halfWidthMeters, noiseAmplitudeMeters } = groundBlendTransition(width, 5);
      expect(noiseAmplitudeMeters).toBeLessThanOrEqual(blendNoiseAmplitudeMeters);
      expect(halfWidthMeters + noiseAmplitudeMeters).toBeCloseTo(width, 9);
    }
  });
});

function polygonSides(corners: readonly { readonly x: number; readonly y: number }[]): CompiledPrismCell["sides"] {
  return corners.map((start, sideIndex) => {
    const end = corners[(sideIndex + 1) % corners.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    return { sideIndex, start, end, inwardNormal: { x: -(end.y - start.y) / length, y: (end.x - start.x) / length }, lengthMeters: length };
  });
}

describe("floor blend narrowing at the corners", () => {
  it.each([
    ["cube", cube, Math.PI / 2],
    ["tetrahedron", tetrahedron, Math.PI / 3],
  ] as const)("on the %s, ends the transition inside the corner bisector of both cells", (_name, world, cornerAngle) => {
    for (const cell of world.cells) {
      const strips = buildFloorBlendGeometry(cell, neighboursOf(world, cell)).strips;
      for (const strip of strips) {
        for (const slope of strip.cornerSlopes) {
          expect(slope).toBeCloseTo(blendCornerSlopeFraction * Math.tan(cornerAngle / 2), 9);
        }
        // A point on the bisector at distance t along the side is t tan(angle / 2) into the cell; the reach (half-width plus noise) there
        // is at most slope * t, so even with the noise at its worst the neighbour's share is 0 where the strips of two sides meet.
        for (const t of [0.05, 0.5, 1, 2, 4]) {
          const reach = Math.min(strip.halfWidthMeters + strip.noiseAmplitudeMeters, strip.cornerSlopes[0] * t);
          expect(t * Math.tan(cornerAngle / 2)).toBeGreaterThan(reach);
        }
      }
    }
  });
});

describe("floor blend geometry across the portals of the basic cube", () => {
  const stripOf = (cell: CompiledPrismCell, sideIndex: number) => buildFloorBlendGeometry(cell, neighboursOf(cube, cell)).strips[sideIndex];

  it("gives both cells of a portal the same canonical coordinates at the same point", () => {
    let checked = 0;
    for (const cell of cube.cells) {
      for (const portal of cell.portals) {
        const other = cube.cellsById.get(portal.targetCellId)!;
        const otherSide = other.portalsById.get(portal.targetPortalId)!.sideIndex;
        const mine = stripOf(cell, portal.sideIndex);
        const theirs = stripOf(other, otherSide);
        expect(mine.seed).toBe(theirs.seed);
        expect(mine.halfWidthMeters).toBe(theirs.halfWidthMeters);
        expect(mine.cornerSlopes).toEqual(theirs.cornerSlopes);
        expect(mine.neighbourCellId).toBe(other.id);

        const position = mine.geometry.getAttribute("position");
        const coord = mine.geometry.getAttribute("blendCoord");
        const sign = mine.geometry.getAttribute("blendSign");
        const otherPosition = theirs.geometry.getAttribute("position");
        const otherCoord = theirs.geometry.getAttribute("blendCoord");
        const otherSign = theirs.geometry.getAttribute("blendSign");
        const perRow = position.count / 2;

        for (const k of [0, 1, Math.floor(perRow / 2), perRow - 1]) {
          const mapped = transformPoint3(portal.transformToTarget, { x: position.getX(k), y: -position.getZ(k), z: 0 });
          let match = -1;
          for (let j = 0; j < perRow; j += 1) {
            if (Math.hypot(otherPosition.getX(j) - mapped.x, -otherPosition.getZ(j) - mapped.y) < 1e-3) {
              match = j;
            }
          }
          expect(match).toBeGreaterThanOrEqual(0);
          expect(coord.getX(k)).toBeCloseTo(otherCoord.getX(match), 3);
          expect(coord.getY(k)).toBeCloseTo(otherCoord.getY(match), 3);
          expect(coord.getY(k)).toBeCloseTo(0, 4);
          expect(sign.getX(k)).toBe(-otherSign.getX(match));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("makes neighbourUv equal the other cell's own uv at the same physical point", () => {
    const cell = cube.cells[0];
    for (const portal of cell.portals) {
      const other = cube.cellsById.get(portal.targetCellId)!;
      const otherSide = other.portalsById.get(portal.targetPortalId)!.sideIndex;
      const mine = stripOf(cell, portal.sideIndex).geometry;
      const theirs = stripOf(other, otherSide).geometry;
      const position = mine.getAttribute("position");
      const neighbourUv = mine.getAttribute("neighbourUv");
      const otherPosition = theirs.getAttribute("position");
      const otherUv = theirs.getAttribute("uv");
      const otherNeighbourUv = theirs.getAttribute("neighbourUv");
      const uv = mine.getAttribute("uv");
      const perRow = position.count / 2;

      for (let k = 0; k < perRow; k += 1) {
        const mapped = transformPoint3(portal.transformToTarget, { x: position.getX(k), y: -position.getZ(k), z: 0 });
        const match = Array.from({ length: perRow }, (_, j) => j).find(
          (j) => Math.hypot(otherPosition.getX(j) - mapped.x, -otherPosition.getZ(j) - mapped.y) < 1e-3,
        )!;
        // My neighbour's texture continues my side: my neighbourUv is where the other cell's own texture is at that point, and the reverse.
        expect(neighbourUv.getX(k)).toBeCloseTo(otherUv.getX(match), 3);
        expect(neighbourUv.getY(k)).toBeCloseTo(otherUv.getY(match), 3);
        expect(otherNeighbourUv.getX(match)).toBeCloseTo(uv.getX(k), 3);
        expect(otherNeighbourUv.getY(match)).toBeCloseTo(uv.getY(k), 3);
      }
    }
  });

  it("gives a side without a blend partner its own texture and no neighbour", () => {
    const cell = cube.cells[0];
    const strip = buildFloorBlendGeometry(cell, new Map()).strips[0];
    expect(strip.neighbourCellId).toBeUndefined();
    const uv = strip.geometry.getAttribute("uv");
    const neighbourUv = strip.geometry.getAttribute("neighbourUv");
    for (let i = 0; i < uv.count; i += 1) {
      expect([neighbourUv.getX(i), neighbourUv.getY(i)]).toEqual([uv.getX(i), uv.getY(i)]);
    }
  });
});
