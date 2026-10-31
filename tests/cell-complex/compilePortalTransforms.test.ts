/**
 * `tests/cell-complex/compilePortalTransforms.test.ts` — unit tier.
 *
 * Every portal carries a `RigidTransform3` from its own cell's frame to its target cell's frame, derived from the
 * two glued sides (`_docs/MATHEMATICAL_MODEL.md` §3). These tests check the transform for a plain east-west gluing,
 * the four self-gluings of a one-cell torus (an edge case: a cell glued to itself on every side), and the
 * properties every gluing must satisfy across the bundled example worlds: a portal composed with its reciprocal is
 * the identity, it carries the source side onto the target side reversed (left becomes right) with normals mapped to
 * normals, and it is always a pure yaw about \(+z\) plus a horizontal translation.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { composeRigidTransform3, transformPoint3 } from "../../src/math/rigidTransform3";
import { lengthVec3, subVec3, vec3, type Vec3 } from "../../src/math/vec3";
import { arbVec3, exampleWorldSpecs } from "../support/arbitraries";

const square = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

const twoSquares: CellComplexSpec = {
  cells: [
    {
      id: "a",
      heightMeters: 2,
      baseVertices: square,
      portals: [{ id: "east", sideIndex: 1, targetCellId: "b", targetPortalId: "west" }],
    },
    {
      id: "b",
      heightMeters: 2,
      baseVertices: square,
      portals: [{ id: "west", sideIndex: 3, targetCellId: "a", targetPortalId: "east" }],
    },
  ],
};

describe("compilePortalTransforms", () => {
  it("glues two squares east-west by a pure translation of 2 m", () => {
    const world = compileCellComplex(twoSquares);
    const east = world.cellsById.get("a")!.portalsById.get("east")!.transformToTarget;
    const west = world.cellsById.get("b")!.portalsById.get("west")!.transformToTarget;

    // East side x = 1 of a must land on west side x = -1 of b, so a's frame shifts by -2 in x
    // (a point just past a's east wall at x = 1.1 appears at x = -0.9 in b).
    expect(east.translation).toEqual(vec3(-2, 0, 0));
    expect(Math.abs(east.rotation.m00 - 1)).toBeLessThan(1e-12);
    expect(Math.abs(east.rotation.m10)).toBeLessThan(1e-12);
    expect(transformPoint3(east, vec3(1.1, 0.25, 0.5)).x).toBeCloseTo(-0.9, 12);
    expect(west.translation).toEqual(vec3(2, 0, 0));
  });

  it("derives expected wraparound translations for the one-cell torus example", () => {
    const world = compileCellComplex(exampleWorldSpecs.find(([name]) => name === "torus")![1]);
    const room = world.cellsById.get("torus-room");

    expect(room?.portalBySideIndex.get(0)?.transformToTarget.translation).toEqual({ x: 0, y: 15, z: 0 });
    expect(room?.portalBySideIndex.get(1)?.transformToTarget.translation).toEqual({ x: -15, y: 0, z: 0 });
    expect(room?.portalBySideIndex.get(2)?.transformToTarget.translation).toEqual({ x: 0, y: -15, z: 0 });
    expect(room?.portalBySideIndex.get(3)?.transformToTarget.translation).toEqual({ x: 15, y: 0, z: 0 });
  });

  describe("properties", () => {
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

      it("maps side start/end across the portal, and normals to normals", () => {
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
  });
});
