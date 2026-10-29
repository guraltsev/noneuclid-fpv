import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { movePlayer } from "../../src/movement/movePlayer";
import {
  resolveGeodesicCarryPortalTransitionFromMove,
  resolveGeodesicCarryPortalTransitionsFromCrossings,
} from "../../src/render/three/geodesicCarryPortalTransition";
import { applyCarriedPortalTransition } from "../../src/render/three/geodesicCannonTools";
import type { SegmentWalkCrossing } from "../../src/cell-complex/segmentWalk";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";

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

  it("maps the ordered crossings of one move to chained transitions", () => {
    const crossing = (
      sourceCellId: string,
      portalId: string,
      targetCellId: string,
      targetPortalId: string,
      tMeters: number,
    ): SegmentWalkCrossing => ({
      sourceCellId,
      portalId,
      sourceSideIndex: 0,
      targetCellId,
      targetPortalId,
      targetSideIndex: 2,
      transformToTarget: identityRigidTransform3,
      tMeters,
    });
    const transitions = resolveGeodesicCarryPortalTransitionsFromCrossings([
      crossing("a", "a-b", "b", "b-a", 1),
      crossing("b", "b-c", "c", "c-b", 3),
    ]);

    expect(transitions).toEqual([
      { sourceCellId: "a", sourcePortalId: "a-b", targetCellId: "b", targetPortalId: "b-a", transformToTarget: identityRigidTransform3 },
      { sourceCellId: "b", sourcePortalId: "b-c", targetCellId: "c", targetPortalId: "c-b", transformToTarget: identityRigidTransform3 },
    ]);
    expect(resolveGeodesicCarryPortalTransitionsFromCrossings([])).toEqual([]);
  });

  it("extends a carried connection word once per crossing, in order", () => {
    const [ab, bc] = resolveGeodesicCarryPortalTransitionsFromCrossings([
      { sourceCellId: "a", portalId: "a-b", sourceSideIndex: 0, targetCellId: "b", targetPortalId: "b-a", targetSideIndex: 2, transformToTarget: identityRigidTransform3, tMeters: 1 },
      { sourceCellId: "b", portalId: "b-c", sourceSideIndex: 0, targetCellId: "c", targetPortalId: "c-b", targetSideIndex: 2, transformToTarget: identityRigidTransform3, tMeters: 3 },
    ]);

    const incoming = applyCarriedPortalTransition(applyCarriedPortalTransition([], ab, "incoming"), bc, "incoming");
    expect(incoming.map((t) => t.sourcePortalId)).toEqual(["a-b", "b-c"]);

    const outgoing = applyCarriedPortalTransition(applyCarriedPortalTransition([], ab, "outgoing"), bc, "outgoing");
    expect(outgoing.map((t) => t.sourcePortalId)).toEqual(["c-b", "b-a"]);
  });
});
