import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { collectPortalGhostRuntimeObjectRenderRecords } from "../../src/render/three/runtimeObjectGhostRecords";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectRegistry";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

describe("runtime object ghost records", () => {
  it("emits target-cell render records when collision bounds touch a portal side", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.95, 0);

    const records = collectPortalGhostRuntimeObjectRenderRecords({
      world,
      object,
      archetypeKeys: ["geo-mouse:mouse-a:mesh:0", "geo-mouse:mouse-a:mesh:1"],
      activationClearanceMeters: 0,
    });

    expect(records.map((record) => record.cellId)).toEqual(["room-b", "room-b"]);
    expect(records.map((record) => record.archetypeKey)).toEqual([
      "geo-mouse:mouse-a:mesh:0",
      "geo-mouse:mouse-a:mesh:1",
    ]);
    expect(records[0]?.localMatrix.elements[12]).toBeCloseTo(-1.05);
  });

  it("does not emit ghosts while the collision bounds are clear of the portal", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.75, 0);

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({
        world,
        object,
        archetypeKeys: ["geo-mouse:mouse-a:mesh:0"],
        activationClearanceMeters: 0,
      }),
    ).toEqual([]);
  });

  it("does not ghost through a portal when the collision bounds only touch beyond the side span", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const object = creature("mouse-a", "room-a", 0.95, 1.2);

    expect(
      collectPortalGhostRuntimeObjectRenderRecords({
        world,
        object,
        archetypeKeys: ["geo-mouse:mouse-a:mesh:0"],
        activationClearanceMeters: 0,
      }),
    ).toEqual([]);
  });
});

function creature(id: string, cellId: string, x: number, y: number): RuntimeCreatureObject {
  return {
    id,
    kind: "geo-mouse",
    cellId,
    localPose: yawRigidTransform3(0, { x, y, z: 0.5 }),
    collision: simpleCollisionCylinder(0.1, 0.2),
    portalRenderable: true,
  };
}

function twoRoomsWithPortal(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "east",
            sideIndex: 1,
            targetCellId: "room-b",
            targetPortalId: "west",
          },
        ],
      },
      {
        id: "room-b",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "west",
            sideIndex: 3,
            targetCellId: "room-a",
            targetPortalId: "east",
          },
        ],
      },
    ],
  };
}
