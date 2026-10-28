import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { movePlayer } from "../../src/movement/movePlayer";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";

describe("movePlayer", () => {
  it("moves a player through the explicit movement contract", () => {
    const result = movePlayer({
      pose: createDefaultPlayerPose("room-a"),
      localDisplacement: { x: 1, y: 0, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(result.kind).toBe("moved");
    expect(result.blocked).toBe(false);
    expect(result.crossedPortal).toBe(false);
    expect(result.pose).toEqual({
      cellId: "room-a",
      position: { x: 1, y: 0, z: 0 },
      yawRadians: 0,
      pitchRadians: 0,
    });
  });

  it("keeps the coordinate frame choice explicit for later cell-local movement", () => {
    const result = movePlayer({
      pose: createDefaultPlayerPose("room-a"),
      localDisplacement: { x: 0, y: 1, z: 0 },
      yawDeltaRadians: Math.PI / 2,
      pitchDeltaRadians: 0,
      coordinateFrame: "current-cell",
    });

    expect(result.pose.cellId).toBe("room-a");
    expect(result.pose.yawRadians).toBeCloseTo(Math.PI / 2);
    expect(result.pose.position.x).toBeCloseTo(-1);
    expect(result.pose.position.y).toBeCloseTo(0);
  });

  it("moves forward in the same direction as the rendered camera faces", () => {
    const result = movePlayer({
      pose: createDefaultPlayerPose("room-a"),
      localDisplacement: { x: 0, y: 1, z: 0 },
      yawDeltaRadians: -Math.PI / 2,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(result.pose.position.x).toBeCloseTo(1);
    expect(result.pose.position.y).toBeCloseTo(0);
  });

  it("updates pitch without changing horizontal movement direction", () => {
    const result = movePlayer({
      pose: createDefaultPlayerPose("room-a"),
      localDisplacement: { x: 0, y: 1, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0.5,
      coordinateFrame: "global",
    });

    expect(result.pose.pitchRadians).toBeCloseTo(0.5);
    expect(result.pose.position).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("clamps pitch before the camera can flip over", () => {
    const result = movePlayer({
      pose: createDefaultPlayerPose("room-a"),
      localDisplacement: { x: 0, y: 0, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: Math.PI,
      coordinateFrame: "global",
    });

    expect(result.pose.pitchRadians).toBeCloseTo(Math.PI / 2 - 0.01);
  });

  it("uses the shared world-aware collision rules when a compiled world is provided", () => {
    const world = compileCellComplex({
      cells: [
        {
          id: "room-a",
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
    });

    const result = movePlayer({
      world,
      pose: createDefaultPlayerPose("room-a"),
      localDisplacement: { x: 2, y: 0, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("wall");
    expect(result.pose.position.x).toBeCloseTo(0.749999, 5);
    expect(result.pose.position.y).toBe(0);
    expect(result.pose.position.z).toBe(0);
  });

  it("lets the player straddle a portal before changing root cell when the camera anchor crosses", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const firstStep = movePlayer({
      world,
      pose: {
        ...createDefaultPlayerPose("room-a"),
        position: { x: 0.75, y: 0, z: 0 },
      },
      localDisplacement: { x: 0.2, y: 0, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(firstStep.blocked).toBe(false);
    expect(firstStep.crossedPortal).toBe(false);
    expect(firstStep.pose.cellId).toBe("room-a");
    expect(firstStep.pose.position.x).toBeCloseTo(0.95);

    const secondStep = movePlayer({
      world,
      pose: firstStep.pose,
      localDisplacement: { x: 0.1, y: 0, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(secondStep.blocked).toBe(false);
    expect(secondStep.crossedPortal).toBe(true);
    expect(secondStep.pose.cellId).toBe("room-b");
    expect(secondStep.pose.position.x).toBeCloseTo(-0.95);
  });
});

function twoRoomsWithPortal() {
  const squareRoomBase = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];

  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 3,
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
        heightMeters: 3,
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
