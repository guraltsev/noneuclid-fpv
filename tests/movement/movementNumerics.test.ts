import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { identityMat3, yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder, type DynamicObjectState } from "../../src/movement/dynamicObject";
import { moveDynamicObject } from "../../src/movement/moveDynamicObject";
import { crossDynamicObjectPortal } from "../../src/movement/portalCrossing";
import { exampleWorldSpecs } from "../support/arbitraries";

describe("movement numerics (issue 65)", () => {
  it("a body at rest within 1e-14 m of a portal side changes cell at most once in 100 zero moves", () => {
    const offsets = [-1e-14, -3e-15, -1e-15, 0, 1e-15];

    for (const [name, spec] of exampleWorldSpecs) {
      const world = compileCellComplex(spec);

      for (const cell of world.cellsById.values()) {
        for (const portal of cell.portals) {
          const side = cell.sides[portal.sideIndex];

          for (const d of offsets) {
            const mx = (side.start.x + side.end.x) / 2 + d * side.inwardNormal.x;
            const my = (side.start.y + side.end.y) / 2 + d * side.inwardNormal.y;
            let object: DynamicObjectState = {
              cellId: cell.id,
              localPose: { rotation: identityMat3, translation: { x: mx, y: my, z: Math.min(0.5, cell.heightMeters / 2) } },
              collision: simpleCollisionCylinder(0.1, 0.2),
            };
            let changes = 0;

            for (let i = 0; i < 100; i += 1) {
              const result = moveDynamicObject({
                world,
                object,
                displacement: { x: 0, y: 0, z: 0 },
                ignoreForbiddenZones: true,
              });

              if (result.object.cellId !== object.cellId) {
                changes += 1;
              }

              object = result.object;
            }

            expect(changes, `${name} ${cell.id}:${portal.id} d=${d}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("10^5 crossings of a reciprocal portal pair keep the rotation orthonormal", () => {
    const world = compileCellComplex(exampleWorldSpecs.find(([name]) => name === "icosahedron")![1]);
    const firstCell = [...world.cellsById.values()][0];
    const portal = firstCell.portals[0];
    const reciprocal = world.cellsById.get(portal.targetCellId)!.portalsById.get(portal.reciprocalPortalId)!;
    const side = firstCell.sides[portal.sideIndex];
    let object: DynamicObjectState = {
      cellId: firstCell.id,
      localPose: {
        ...yawRigidTransform3(0.3),
        translation: { x: (side.start.x + side.end.x) / 2, y: (side.start.y + side.end.y) / 2, z: 0.5 },
      },
    };

    for (let i = 0; i < 100000; i += 1) {
      object = crossDynamicObjectPortal(object, i % 2 === 0 ? portal : reciprocal);
    }

    const r = object.localPose.rotation;
    const rtr = [
      r.m00 * r.m00 + r.m10 * r.m10 + r.m20 * r.m20 - 1,
      r.m00 * r.m01 + r.m10 * r.m11 + r.m20 * r.m21,
      r.m00 * r.m02 + r.m10 * r.m12 + r.m20 * r.m22,
      r.m01 * r.m01 + r.m11 * r.m11 + r.m21 * r.m21 - 1,
      r.m01 * r.m02 + r.m11 * r.m12 + r.m21 * r.m22,
      r.m02 * r.m02 + r.m12 * r.m12 + r.m22 * r.m22 - 1,
    ];
    const det =
      r.m00 * (r.m11 * r.m22 - r.m12 * r.m21) -
      r.m01 * (r.m10 * r.m22 - r.m12 * r.m20) +
      r.m02 * (r.m10 * r.m21 - r.m11 * r.m20);
    const error = Math.max(...rtr.map(Math.abs));

    console.log(`pose drift: max|RtR-I| = ${error}, |det-1| = ${Math.abs(det - 1)}`);
    expect(error).toBeLessThan(1e-12);
    expect(Math.abs(det - 1)).toBeLessThan(1e-12);
  });
});
