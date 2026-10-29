import { describe, expect, it } from "vitest";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildPortalPathTables } from "../../src/cell-complex/portalPaths";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
} from "../../src/math/rigidTransform3";
import { lengthVec3, subVec3, vec3 } from "../../src/math/vec3";
import { exampleWorldSpecs } from "../support/arbitraries";

const testPoints = [vec3(0, 0, 0), vec3(1.5, -2, 0.5), vec3(-3, 4, 1)];
const speedWorlds = ["cube", "tetrahedron", "torus"].map((name) => {
  const spec = exampleWorldSpecs.find(([candidate]) => candidate === name)![1];
  const world = compileCellComplex(spec);

  return [name, world, buildPortalPathTables(world, { maxDepth: 3 })] as const;
});

function expectSamePoints(
  a: ReturnType<typeof composeRigidTransform3>,
  b: ReturnType<typeof composeRigidTransform3>,
): void {
  for (const point of testPoints) {
    const difference = lengthVec3(subVec3(transformPoint3(a, point), transformPoint3(b, point)));

    expect(difference).toBeLessThanOrEqual(1e-9 * (1 + lengthVec3(transformPoint3(b, point))));
  }
}

function portalTransform(world: CompiledCellComplex, cellId: string, portalId: string) {
  return world.cellsById.get(cellId)!.portalsById.get(portalId)!.transformToTarget;
}

describe.each(speedWorlds)("portal path tables of %s", (_name, world, tables) => {
  it("has consistent parents, depths and transforms", () => {
    for (const table of tables.tablesByRootCellId.values()) {
      for (const path of table.paths) {
        expect(path.depth).toBe(path.steps.length);

        if (path.depth > 0) {
          expect(table.pathsById.has(path.parentPathId!)).toBe(true);
        }

        // Order found in the code: destinationFromRoot = g_k after ... after g_1, so rootFromDestination = inv(g_1) after ... after inv(g_k).
        let rootFromDestination = identityRigidTransform3;
        let destinationFromRoot = identityRigidTransform3;

        for (const step of path.steps) {
          const g = portalTransform(world, step.sourceCellId, step.sourcePortalId);

          rootFromDestination = composeRigidTransform3(rootFromDestination, invertRigidTransform3(g));
          destinationFromRoot = composeRigidTransform3(g, destinationFromRoot);
        }

        expectSamePoints(path.rootFromDestination, rootFromDestination);
        expectSamePoints(path.destinationFromRoot, destinationFromRoot);
        expectSamePoints(composeRigidTransform3(path.destinationFromRoot, path.rootFromDestination), identityRigidTransform3);
      }
    }
  });

  it("has exactly one depth-0 path per root", () => {
    for (const table of tables.tablesByRootCellId.values()) {
      expect(table.paths.filter((path) => path.steps.length === 0)).toHaveLength(1);
    }
  });
});

