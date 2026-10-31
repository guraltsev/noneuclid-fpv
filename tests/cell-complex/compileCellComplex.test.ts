/**
 * `tests/cell-complex/compileCellComplex.test.ts` — unit tier.
 *
 * `compileCellComplex` is the top-level compiler from an authored `CellComplexSpec` to the runtime geometry used by
 * movement and rendering: it validates the spec, compiles each cell's side geometry and forbidden-zone junctions,
 * and links each portal to its gluing transform (`_docs/MATHEMATICAL_MODEL.md` §2, §3). These tests check that cell
 * ids and shape survive compilation, that portal lookups, side geometry and forbidden zones come out linked and
 * correct for a small two-room world, and that an invalid spec is refused (the detailed error messages are
 * `validateCellComplexSpec`'s own behaviour, tested in `validateCellComplexSpec.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { twoPrismLoop } from "../fixtures/cell-complex/twoPrismLoop";
import { identityMat3 } from "../../src/math/rigidTransform3";

describe("compileCellComplex", () => {
  it("preserves the visible prism cells from the starter world", () => {
    const compiled = compileCellComplex(twoPrismLoop);

    expect(compiled.cells.map((cell) => cell.id)).toEqual(["room-a", "room-b"]);
  });

  it("compiles portal lookups, side geometry, and forbidden zones for movement", () => {
    const compiled = compileCellComplex(twoPrismLoop);
    const roomA = compiled.cellsById.get("room-a");
    const eastPortal = roomA?.portalBySideIndex.get(1);

    expect(roomA?.isConvex).toBe(true);
    expect(eastPortal?.targetCellId).toBe("room-b");
    expect(roomA?.portalBySideIndex.get(1)?.id).toBe("side-1");
    expect(eastPortal?.reciprocalPortalId).toBe("side-3");
    expect(roomA?.sides).toHaveLength(4);
    expect(eastPortal?.transformToTarget.rotation).toEqual(identityMat3);
    expect(eastPortal?.transformToTarget.translation).toEqual({ x: -15, y: 0, z: 0 });
    expect(roomA?.forbiddenZones.map((zone) => zone.junctionId)).toEqual(["room-a:vertex-1", "room-a:vertex-2"]);
    expect(roomA?.singularityColumns.map((column) => column.junctionId)).toEqual([
      "room-a:vertex-1",
      "room-a:vertex-2",
    ]);
    expect(roomA?.singularityColumns[0]?.kind).toBe("invisible-cylinder");
    expect(roomA?.singularityColumns[0]?.radius).toBeCloseTo(0.15);
    expect(roomA?.singularityColumns[0]?.height).toBe(Infinity);
  });

  it("throws listing every error when the spec fails validation", () => {
    expect(() =>
      compileCellComplex({
        cells: [
          {
            id: "non-convex",
            heightMeters: 2,
            baseVertices: [
              { x: 0, y: 0 },
              { x: 2, y: 0 },
              { x: 1, y: 1 },
              { x: 2, y: 2 },
              { x: 0, y: 2 },
            ],
            portals: [],
          },
        ],
      }),
    ).toThrowError(/Invalid cell complex:[\s\S]*non-convex prism cells are not supported/);
  });
});
