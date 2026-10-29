import { describe, expect, it } from "vitest";
import { compilePrismCellGeometry } from "../../src/cell-complex/prismCells";
import type { PrismCellSpec } from "../../src/cell-complex/specs";

const square = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

describe("compilePrismCellGeometry", () => {
  it("compiles four sides of length 2 with inward normals pointing into the cell", () => {
    const cell: PrismCellSpec = { id: "room", heightMeters: 2, baseVertices: square, portals: [] };
    const geometry = compilePrismCellGeometry(cell);

    expect(geometry.sides).toHaveLength(4);
    expect(geometry.sides.map((side) => side.lengthMeters)).toEqual([2, 2, 2, 2]);
    expect(geometry.sides.map((side) => [side.inwardNormal.x + 0, side.inwardNormal.y + 0])).toEqual([
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ]);
    expect(geometry.forbiddenZones).toHaveLength(0);
  });

  it("adds one forbidden zone per portal-side endpoint", () => {
    const cell: PrismCellSpec = {
      id: "room",
      heightMeters: 2,
      baseVertices: square,
      portals: [{ id: "east", sideIndex: 1, targetCellId: "room", targetPortalId: "east" }],
    };
    const geometry = compilePrismCellGeometry(cell);

    expect(geometry.forbiddenZones).toHaveLength(2);
    expect(geometry.portalJunctions).toHaveLength(2);
  });
});
