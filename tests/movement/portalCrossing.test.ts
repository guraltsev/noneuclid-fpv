/**
 * `tests/movement/portalCrossing.test.ts` — unit tier.
 *
 * `crossDynamicObjectPortal` re-expresses a dynamic object's pose (position and orientation) in the target cell's
 * frame by applying the portal's gluing transform, preserving heading and handedness
 * (`_docs/MATHEMATICAL_MODEL.md` §5). These tests check a worked example and the property that crossing a portal
 * and then its reciprocal returns the original pose, across every portal of the bundled example worlds.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { identityMat3 } from "../../src/math/rigidTransform3";
import { lengthVec3 } from "../../src/math/vec3";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { crossDynamicObjectPortal } from "../../src/movement/portalCrossing";
import { arbYawRigidTransform3, exampleWorldSpecs } from "../support/arbitraries";

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

  describe("properties", () => {
    const worlds = exampleWorldSpecs.map(([name, spec]) => [name, compileCellComplex(spec)] as const);

    describe.each(worlds)("crossing portals in %s", (_name, world) => {
      it("crossing a portal and then its reciprocal returns the pose", () => {
        for (const cell of world.cells) {
          for (const portal of cell.portals) {
            const reciprocal = world.cellsById.get(portal.targetCellId)!.portalsById.get(portal.reciprocalPortalId)!;

            fc.assert(
              fc.property(arbYawRigidTransform3, (localPose) => {
                const object: DynamicObjectState = { cellId: cell.id, localPose, collision: simpleCollisionCylinder(0.1, 1) };
                const back = crossDynamicObjectPortal(crossDynamicObjectPortal(object, portal), reciprocal);
                const scale = 1 + lengthVec3(localPose.translation) + lengthVec3(portal.transformToTarget.translation);

                expect(back.cellId).toBe(cell.id);
                expect(lengthVec3({
                  x: back.localPose.translation.x - localPose.translation.x,
                  y: back.localPose.translation.y - localPose.translation.y,
                  z: back.localPose.translation.z - localPose.translation.z,
                })).toBeLessThanOrEqual(1e-9 * scale);
                for (const key of ["m00", "m01", "m02", "m10", "m11", "m12", "m20", "m21", "m22"] as const) {
                  expect(Math.abs(back.localPose.rotation[key] - localPose.rotation[key])).toBeLessThanOrEqual(1e-12);
                }
              }),
              { numRuns: 50 },
            );
          }
        }
      });
    });
  });
});
