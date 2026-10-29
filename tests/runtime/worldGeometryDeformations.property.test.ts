import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createIdentityCellDeformationMaps, transformPoseWithCellMaps } from "../../src/runtime/worldGeometryDeformations";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { arbPointInCell, arbYawRadians, exampleWorldSpecs } from "../support/arbitraries";

const world = compileCellComplex(exampleWorldSpecs.find(([name]) => name === "torusModuli")![1]);
const maps = createIdentityCellDeformationMaps(world);

describe("identity deformation maps", () => {
  it("map every point of every cell to itself exactly", () => {
    for (const cell of world.cells) {
      const map = maps.get(cell.id)!;

      fc.assert(
        fc.property(arbPointInCell(cell), (p) => {
          const point = { x: p.x, y: p.y, z: 0.5 };

          expect(map.mapPoint(point)).toEqual(point);
        }),
        { numRuns: 50 },
      );
    }
  });

  it("leave poses unchanged", () => {
    for (const cell of world.cells) {
      fc.assert(
        fc.property(arbPointInCell(cell), arbYawRadians, (p, yaw) => {
          const pose = { cellId: cell.id, localPose: yawRigidTransform3(yaw, { x: p.x, y: p.y, z: 0.5 }) };
          const mapped = transformPoseWithCellMaps(pose, maps);

          expect(mapped?.cellId).toBe(cell.id);
          expect(mapped?.localPose.translation).toEqual(pose.localPose.translation);
          for (const key of ["m00", "m01", "m10", "m11", "m22"] as const) {
            expect(Math.abs(mapped!.localPose.rotation[key] - pose.localPose.rotation[key])).toBeLessThanOrEqual(1e-12);
          }
        }),
        { numRuns: 50 },
      );
    }
  });
});
