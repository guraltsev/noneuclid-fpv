/**
 * `tests/cell-complex/segmentWalk.test.ts` — unit tier.
 *
 * `walkDevelopedSegment` walks a straight developed segment through a chain of cells, crossing a portal whenever it
 * leaves through a portal side and reporting a wall, the crossing-limit, or a start found well outside its cell
 * (`_docs/MATHEMATICAL_MODEL.md` §4). It is the shared kernel every geometric walk (movement, geodesics, the static
 * cull's line cones) is built on. These tests check each wall/portal/vertex outcome on small hand-built worlds, a
 * long torus walk's round trip back to the developed point, and the property that every walked point stays inside
 * its reported cell (within tolerance) across the bundled example worlds, including points aimed exactly at a
 * vertex. `locateDevelopedPoint` is the same walk used to find where one developed point lands.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../src/cell-complex/prismCells";
import { locateDevelopedPoint, walkDevelopedSegment } from "../../src/cell-complex/segmentWalk";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { invertRigidTransform3, transformPoint3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { arbPointInCell, exampleWorldSpecs } from "../support/arbitraries";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

function twoRoomsWithPortal(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
      },
      {
        id: "room-b",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
      },
    ],
  };
}

function fourNeighbourSquares(): CellComplexSpec {
  const neighbour = (id: string, sideIndex: number, back: string) => ({
    id,
    heightMeters: 2,
    baseVertices: squareRoomBase,
    portals: [{ id: back, sideIndex, targetCellId: "center", targetPortalId: id }],
  });

  return {
    cells: [
      {
        id: "center",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          { id: "s", sideIndex: 0, targetCellId: "south", targetPortalId: "back-s" },
          { id: "e", sideIndex: 1, targetCellId: "east", targetPortalId: "back-e" },
          { id: "n", sideIndex: 2, targetCellId: "north", targetPortalId: "back-n" },
          { id: "w", sideIndex: 3, targetCellId: "west", targetPortalId: "back-w" },
        ],
      },
      // The back portal of a neighbour carries the id the center's portal names as its target.
      { ...neighbour("south", 2, "back-s"), portals: [{ id: "back-s", sideIndex: 2, targetCellId: "center", targetPortalId: "s" }] },
      { ...neighbour("east", 3, "back-e"), portals: [{ id: "back-e", sideIndex: 3, targetCellId: "center", targetPortalId: "e" }] },
      { ...neighbour("north", 0, "back-n"), portals: [{ id: "back-n", sideIndex: 0, targetCellId: "center", targetPortalId: "n" }] },
      { ...neighbour("west", 1, "back-w"), portals: [{ id: "back-w", sideIndex: 1, targetCellId: "center", targetPortalId: "w" }] },
    ],
  };
}

function insideCell(cell: CompiledPrismCell, x: number, y: number, tolerance: number): boolean {
  return cell.sides.every(
    (side) => (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y >= -tolerance,
  );
}

function minSignedDistance(cell: CompiledPrismCell, x: number, y: number): number {
  return Math.min(
    ...cell.sides.map((side) => (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y),
  );
}

function worldOf(name: string): CompiledCellComplex {
  return compileCellComplex(exampleWorldSpecs.find(([candidate]) => candidate === name)![1]);
}

describe("walkDevelopedSegment", () => {
  it("stops at a wall of a single square room", () => {
    const world = compileCellComplex({
      cells: [{ id: "room", heightMeters: 2, baseVertices: squareRoomBase, portals: [] }],
    });
    const result = walkDevelopedSegment({
      world,
      cellId: "room",
      start: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      lengthMeters: 5,
    });

    expect(result.status).toBe("wall");
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0].tEnter).toBe(0);
    expect(result.pieces[0].tExit).toBeCloseTo(1, 12);
    expect(result.pieces[0].exit).toMatchObject({ kind: "wall", sideIndex: 1 });
  });

  it("crosses one portal between two rooms", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const result = walkDevelopedSegment({
      world,
      cellId: "room-a",
      start: { x: 0.5, y: 0 },
      direction: { x: 1, y: 0 },
      lengthMeters: 1,
    });

    expect(result.status).toBe("end");
    expect(result.pieces.map((piece) => [piece.cellId, piece.tEnter, piece.tExit])).toEqual([
      ["room-a", 0, expect.closeTo(0.5, 12)],
      ["room-b", expect.closeTo(0.5, 12), 1],
    ]);
    expect(result.crossings).toHaveLength(1);

    const end = transformPoint3(result.pieces[1].cellFromStart, vec3(1.5, 0, 0));

    expect(end.x).toBeCloseTo(-0.5, 12);
    expect(end.y).toBeCloseTo(0, 12);
  });

  it("leaves through the counterclockwise successor side when the line hits a vertex", () => {
    const world = compileCellComplex(fourNeighbourSquares());
    const result = walkDevelopedSegment({
      world,
      cellId: "center",
      start: { x: 0, y: 0 },
      direction: { x: 1, y: 1 },
      lengthMeters: 2,
    });
    const first = result.pieces[0];

    expect(first.exit).toMatchObject({ kind: "portal", sideIndex: 2, throughVertexIndex: 2 });
    expect(result.crossings[0].targetCellId).toBe("north");
  });

  it("walks exactly through a cube vertex with a zero-length middle piece", () => {
    const world = worldOf("cube");
    const result = walkDevelopedSegment({
      world,
      cellId: "front",
      start: { x: 0, y: 0 },
      direction: { x: 7.5, y: -7.5 },
      lengthMeters: 20,
    });

    expect(result.status).toBe("end");
    expect(result.pieces.map((piece) => piece.cellId)).toEqual(["front", "right", "bottom"]);
    expect(result.pieces[0].tExit).toBeCloseTo(10.6066, 4);
    expect(result.pieces[1].tExit - result.pieces[1].tEnter).toBeLessThan(1e-9);

    const last = result.pieces[2];
    const end = transformPoint3(last.cellFromStart, vec3((20 * 7.5) / Math.hypot(7.5, 7.5), (-20 * 7.5) / Math.hypot(7.5, 7.5), 0));

    expect(insideCell(world.cellsById.get("bottom")!, end.x, end.y, 1e-9)).toBe(true);
  });

  it("never crosses on a zero-length walk, even slightly outside a portal side", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const result = walkDevelopedSegment({
      world,
      cellId: "room-a",
      start: { x: 1 + 1e-9, y: 0 },
      direction: { x: 1, y: 0 },
      lengthMeters: 0,
    });

    expect(result.status).toBe("end");
    expect(result.crossings).toHaveLength(0);
    expect(result.pieces).toHaveLength(1);
  });

  it("reports a start well outside the cell", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const result = walkDevelopedSegment({
      world,
      cellId: "room-a",
      start: { x: 1.01, y: 0 },
      direction: { x: 1, y: 0 },
      lengthMeters: 1,
    });

    expect(result.status).toBe("start-outside");
    expect(result.pieces).toHaveLength(0);
  });

  it("reports a missing cell and stops at the crossing limit", () => {
    const world = compileCellComplex(twoRoomsWithPortal());

    expect(
      walkDevelopedSegment({ world, cellId: "nope", start: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, lengthMeters: 1 }).status,
    ).toBe("missing-cell");
    expect(
      walkDevelopedSegment({
        world: compileCellComplex({
          cells: [
            {
              id: "room",
              heightMeters: 2,
              baseVertices: squareRoomBase,
              portals: [
                { id: "east", sideIndex: 1, targetCellId: "room", targetPortalId: "west" },
                { id: "west", sideIndex: 3, targetCellId: "room", targetPortalId: "east" },
              ],
            },
          ],
        }),
        cellId: "room",
        start: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        lengthMeters: 1000,
        maxCrossings: 5,
      }).status,
    ).toBe("crossing-limit");
  });
});

describe("locateDevelopedPoint", () => {
  it("returns the cell and frame of the end point", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const located = locateDevelopedPoint(world, "room-a", { x: 0.5, y: 0 }, { x: 1.5, y: 0 });

    expect(located.status).toBe("end");
    expect(located.cellId).toBe("room-b");

    const p = transformPoint3(located.cellFromStart, vec3(1.5, 0, 0));

    expect(p.x).toBeCloseTo(-0.5, 12);
  });

  it("does not walk for a zero-length request", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const located = locateDevelopedPoint(world, "room-a", { x: 0.5, y: 0 }, { x: 0.5, y: 0 });

    expect(located).toMatchObject({ status: "end", cellId: "room-a" });
    expect(located.crossings).toHaveLength(0);
  });
});

describe("segment walk on the torus", () => {
  it("lifts the end point of a 3040 m walk back to the developed point", () => {
    const world = compileCellComplex(exampleWorldSpecs.find(([name]) => name === "torusModuli")![1]);
    const length = 200 * 15.2;
    const angle = 0.07;
    const d = { x: Math.cos(angle), y: Math.sin(angle) };
    const start = { x: 0.3, y: -0.2 };
    const result = walkDevelopedSegment({
      world,
      cellId: "torus-room",
      start,
      direction: d,
      lengthMeters: length,
      maxCrossings: 1000,
    });

    expect(result.status).toBe("end");
    expect(result.crossings.length).toBeGreaterThan(150);

    const last = result.pieces[result.pieces.length - 1];
    let p = transformPoint3(last.cellFromStart, vec3(start.x + length * d.x, start.y + length * d.y, 0));

    expect(minSignedDistance(world.cellsById.get(last.cellId)!, p.x, p.y)).toBeGreaterThanOrEqual(-1e-8);

    for (let i = result.crossings.length - 1; i >= 0; i -= 1) {
      p = transformPoint3(invertRigidTransform3(result.crossings[i].transformToTarget), p);
    }

    expect(Math.hypot(p.x - (start.x + length * d.x), p.y - (start.y + length * d.y))).toBeLessThan(1e-8);
  });
});

describe("properties", () => {
  const worlds = exampleWorldSpecs.map(([name, spec]) => [name, compileCellComplex(spec)] as const);

  interface Case {
    readonly cell: CompiledPrismCell;
    readonly start: { x: number; y: number };
    readonly direction: { x: number; y: number };
    readonly length: number;
  }

  function arbCase(world: CompiledCellComplex, maxLength: number, aimAtVertices: boolean): fc.Arbitrary<Case> {
    return fc
      .tuple(fc.constantFrom(...world.cells), fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), fc.double({ min: 1, max: maxLength, noNaN: true }), fc.nat(4), fc.nat(7))
      .chain(([cell, angle, length, aim, vertexPick]) =>
        arbPointInCell(cell).map((start): Case => {
          let direction = { x: Math.cos(angle), y: Math.sin(angle) };

          if (aimAtVertices && aim === 0) {
            const vertex = cell.baseVertices[vertexPick % cell.baseVertices.length];
            const dx = vertex.x - start.x;
            const dy = vertex.y - start.y;

            if (Math.hypot(dx, dy) > 1e-3) {
              direction = { x: dx, y: dy };
            }
          }

          return { cell, start, direction, length };
        }),
      );
  }

  function checkCase(world: CompiledCellComplex, c: Case, samples: number | undefined, tolerance: number): void {
    const norm = Math.hypot(c.direction.x, c.direction.y);
    const d = { x: c.direction.x / norm, y: c.direction.y / norm };
    const result = walkDevelopedSegment({
      world,
      cellId: c.cell.id,
      start: c.start,
      direction: c.direction,
      lengthMeters: c.length,
      maxCrossings: 1000,
    });

    expect(result.status).toBe("end");

    const at = (piece: (typeof result.pieces)[number], t: number): number => {
      const p = transformPoint3(piece.cellFromStart, vec3(c.start.x + t * d.x, c.start.y + t * d.y, 0));

      return minSignedDistance(world.cellsById.get(piece.cellId)!, p.x, p.y);
    };

    for (const piece of result.pieces) {
      expect(piece.tExit).toBeGreaterThanOrEqual(piece.tEnter);
      for (const t of [piece.tEnter, (piece.tEnter + piece.tExit) / 2, piece.tExit]) {
        expect(at(piece, t)).toBeGreaterThanOrEqual(-tolerance);
      }
    }

    expect(result.pieces[0].tEnter).toBe(0);
    expect(result.pieces[result.pieces.length - 1].tExit).toBe(c.length);

    if (samples) {
      for (let i = 0; i <= samples; i += 1) {
        const t = Math.min(c.length, (c.length * i) / samples);
        const piece = result.pieces.find((candidate) => candidate.tEnter <= t && t <= candidate.tExit);

        expect(piece).toBeDefined();
        expect(at(piece!, t)).toBeGreaterThanOrEqual(-tolerance);
      }
    }
  }

  describe.each(worlds)("segment walk on %s", (_name, world) => {
    it("keeps every piece inside its cell (100 segments, every fifth aimed at a vertex)", () => {
      fc.assert(fc.property(arbCase(world, 80, true), (c) => checkCase(world, c, undefined, 1e-8)), { numRuns: 100 });
    });
  });

  describe.each(worlds.filter(([name]) => ["cube", "icosahedron", "torusModuli"].includes(name)))(
    "segment walk sampling on %s",
    (_name, world) => {
      it("places 200 equally spaced samples inside the cell of their piece", () => {
        fc.assert(fc.property(arbCase(world, 3, false), (c) => checkCase(world, c, 200, 1e-8)), { numRuns: 100 });
      });
    },
  );
});
