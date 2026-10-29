import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { crossDynamicObjectPortal } from "../../src/movement/portalCrossing";
import { lengthVec3 } from "../../src/math/vec3";
import { arbYawRigidTransform3, exampleWorldSpecs } from "../support/arbitraries";

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
