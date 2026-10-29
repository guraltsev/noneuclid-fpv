import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { identityMat3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { crossDynamicObjectPortal } from "../../src/movement/portalCrossing";

const square = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

const twoRoomsWithPortal: CellComplexSpec = {
  cells: [
    {
      id: "room-a",
      heightMeters: 2,
      baseVertices: square,
      portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
    },
    {
      id: "room-b",
      heightMeters: 2,
      baseVertices: square,
      portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
    },
  ],
};

describe("crossDynamicObjectPortal", () => {
  it("re-expresses a pose just past the east wall in the west room's frame", () => {
    const world = compileCellComplex(twoRoomsWithPortal);
    const object: DynamicObjectState = {
      cellId: "room-a",
      localPose: { rotation: identityMat3, translation: { x: 1.05, y: 0, z: 0.5 } },
      collision: simpleCollisionCylinder(0.1, 1),
    };
    const crossed = crossDynamicObjectPortal(object, world.cellsById.get("room-a")!.portalsById.get("east")!);

    expect(crossed.cellId).toBe("room-b");
    expect(crossed.localPose.translation.x).toBeCloseTo(-0.95, 12);
    expect(crossed.localPose.translation.y).toBeCloseTo(0, 12);
    expect(crossed.localPose.translation.z).toBeCloseTo(0.5, 12);
  });
});
