import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { transformPoint3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";

const square = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

const twoSquares: CellComplexSpec = {
  cells: [
    {
      id: "a",
      heightMeters: 2,
      baseVertices: square,
      portals: [{ id: "east", sideIndex: 1, targetCellId: "b", targetPortalId: "west" }],
    },
    {
      id: "b",
      heightMeters: 2,
      baseVertices: square,
      portals: [{ id: "west", sideIndex: 3, targetCellId: "a", targetPortalId: "east" }],
    },
  ],
};

describe("compilePortalTransforms", () => {
  it("glues two squares east-west by a pure translation of 2 m", () => {
    const world = compileCellComplex(twoSquares);
    const east = world.cellsById.get("a")!.portalsById.get("east")!.transformToTarget;
    const west = world.cellsById.get("b")!.portalsById.get("west")!.transformToTarget;

    // East side x = 1 of a must land on west side x = -1 of b, so a's frame shifts by -2 in x
    // (a point just past a's east wall at x = 1.1 appears at x = -0.9 in b).
    expect(east.translation).toEqual(vec3(-2, 0, 0));
    expect(Math.abs(east.rotation.m00 - 1)).toBeLessThan(1e-12);
    expect(Math.abs(east.rotation.m10)).toBeLessThan(1e-12);
    expect(transformPoint3(east, vec3(1.1, 0.25, 0.5)).x).toBeCloseTo(-0.9, 12);
    expect(west.translation).toEqual(vec3(2, 0, 0));
  });
});
