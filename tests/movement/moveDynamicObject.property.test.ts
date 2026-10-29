import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { identityMat3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { moveDynamicObject } from "../../src/movement/moveDynamicObject";
import { arbPointInCell } from "../support/arbitraries";

const singleRoom: CellComplexSpec = {
  cells: [
    {
      id: "room",
      heightMeters: 2,
      baseVertices: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
      portals: [],
    },
  ],
};
const world = compileCellComplex(singleRoom);
const room = world.cellsById.get("room")!;

describe("moveDynamicObject properties", () => {
  it("a zero displacement leaves the pose unchanged and not blocked", () => {
    fc.assert(
      fc.property(
        arbPointInCell(room).filter((p) => Math.abs(p.x) <= 0.89 && Math.abs(p.y) <= 0.89),
        (point) => {
          const object: DynamicObjectState = {
            cellId: "room",
            localPose: { rotation: identityMat3, translation: { x: point.x, y: point.y, z: 0.5 } },
            collision: simpleCollisionCylinder(0.1, 1),
          };
          const result = moveDynamicObject({ world, object, displacement: { x: 0, y: 0, z: 0 } });

          expect(result.blocked).toBe(false);
          expect(result.object.cellId).toBe("room");
          expect(result.object.localPose).toEqual(object.localPose);
        },
      ),
      { numRuns: 50 },
    );
  });
});
