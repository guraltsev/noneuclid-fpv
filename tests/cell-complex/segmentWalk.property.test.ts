import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../src/cell-complex/prismCells";
import { walkDevelopedSegment } from "../../src/cell-complex/segmentWalk";
import { invertRigidTransform3, transformPoint3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { arbPointInCell, exampleWorldSpecs } from "../support/arbitraries";

const worlds = exampleWorldSpecs.map(([name, spec]) => [name, compileCellComplex(spec)] as const);

function minSignedDistance(cell: CompiledPrismCell, x: number, y: number): number {
  return Math.min(
    ...cell.sides.map((side) => (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y),
  );
}

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
  it("keeps every piece inside its cell (300 segments, every fifth aimed at a vertex)", () => {
    fc.assert(fc.property(arbCase(world, 80, true), (c) => checkCase(world, c, undefined, 1e-8)), { numRuns: 300 });
  });
});

describe.each(worlds.filter(([name]) => ["cube", "icosahedron", "torusModuli"].includes(name)))(
  "segment walk sampling on %s",
  (_name, world) => {
    it("places 200 equally spaced samples inside the cell of their piece", () => {
      fc.assert(fc.property(arbCase(world, 3, false), (c) => checkCase(world, c, 200, 1e-8)), { numRuns: 150 });
    });
  },
);

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
