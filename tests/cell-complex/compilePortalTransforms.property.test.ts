import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { composeRigidTransform3, transformPoint3 } from "../../src/math/rigidTransform3";
import { lengthVec3, subVec3, vec3, type Vec3 } from "../../src/math/vec3";
import { arbVec3, exampleWorldSpecs } from "../support/arbitraries";

const worlds = exampleWorldSpecs.map(([name, spec]) => [name, compileCellComplex(spec)] as const);

function scaleOf(p: Vec3, t: Vec3): number {
  return 1 + lengthVec3(p) + lengthVec3(t);
}

describe.each(worlds)("portal transforms of %s", (_name, world) => {
  it("each portal's reciprocal composes with it to the identity", () => {
    for (const cell of world.cells) {
      for (const portal of cell.portals) {
        const reciprocal = world.cellsById.get(portal.targetCellId)!.portalsById.get(portal.reciprocalPortalId)!;

        fc.assert(
          fc.property(arbVec3, (p) => {
            const identity = composeRigidTransform3(reciprocal.transformToTarget, portal.transformToTarget);
            const q = transformPoint3(identity, p);

            expect(lengthVec3(subVec3(q, p))).toBeLessThanOrEqual(1e-9 * scaleOf(p, portal.transformToTarget.translation));
          }),
          { numRuns: 50 },
        );
      }
    }
  });

  it("maps the source side's start to the target side's end and vice versa, and normals to normals", () => {
    for (const cell of world.cells) {
      for (const portal of cell.portals) {
        const g = portal.transformToTarget;
        const source = cell.sides[portal.sideIndex];
        const target = world.cellsById.get(portal.targetCellId)!.sides[
          world.cellsById.get(portal.targetCellId)!.portalsById.get(portal.targetPortalId)!.sideIndex
        ];
        const start = transformPoint3(g, vec3(source.start.x, source.start.y, 0));
        const end = transformPoint3(g, vec3(source.end.x, source.end.y, 0));

        expect(Math.hypot(start.x - target.end.x, start.y - target.end.y)).toBeLessThanOrEqual(1e-6);
        expect(Math.hypot(end.x - target.start.x, end.y - target.start.y)).toBeLessThanOrEqual(1e-6);

        const outward = vec3(-source.inwardNormal.x, -source.inwardNormal.y, 0);
        const mapped = {
          x: g.rotation.m00 * outward.x + g.rotation.m01 * outward.y,
          y: g.rotation.m10 * outward.x + g.rotation.m11 * outward.y,
        };

        expect(Math.abs(mapped.x - target.inwardNormal.x)).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(mapped.y - target.inwardNormal.y)).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it("is a pure yaw about +z followed by a horizontal translation", () => {
    for (const cell of world.cells) {
      for (const { transformToTarget: g } of cell.portals) {
        for (const entry of [g.rotation.m02, g.rotation.m12, g.rotation.m20, g.rotation.m21]) {
          expect(Math.abs(entry)).toBeLessThanOrEqual(1e-12);
        }
        expect(Math.abs(g.rotation.m22 - 1)).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(g.translation.z)).toBeLessThanOrEqual(1e-12);
      }
    }
  });
});
