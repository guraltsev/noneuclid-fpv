import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { movePlayer } from "../../src/movement/movePlayer";
import { resolveGeodesicCarryPortalTransitionFromMove } from "../../src/render/three/geodesicCarryPortalTransition";

describe("geodesic carry portal transition", () => {
  it("records same-cell portal face crossings for carried geodesic words", () => {
    const world = compileCellComplex({
      cells: [
        {
          id: "torus-room",
          heightMeters: 3,
          baseVertices: [
            { x: -7.5, y: -7.5 },
            { x: 7.5, y: -7.5 },
            { x: 7.5, y: 7.5 },
            { x: -7.5, y: 7.5 },
          ],
          portals: [
            { id: "right-left", sideIndex: 1, targetCellId: "torus-room", targetPortalId: "left-right" },
            { id: "left-right", sideIndex: 3, targetCellId: "torus-room", targetPortalId: "right-left" },
          ],
        },
      ],
    });
    const previousCellId = "torus-room";
    const moveResult = movePlayer({
      world,
      pose: {
        cellId: previousCellId,
        position: { x: 7.4, y: 0, z: 0 },
        yawRadians: 0,
        pitchRadians: 0,
      },
      body: { radiusMeters: 0.25, heightMeters: 1.7 },
      localDisplacement: { x: 0.4, y: 0, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(moveResult.crossedPortal).toBe(true);
    expect(moveResult.pose.cellId).toBe(previousCellId);
    expect(resolveGeodesicCarryPortalTransitionFromMove(world, previousCellId, moveResult)).toMatchObject({
      sourceCellId: "torus-room",
      sourcePortalId: "right-left",
      targetCellId: "torus-room",
      targetPortalId: "left-right",
    });
  });
});
