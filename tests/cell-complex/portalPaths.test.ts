/**
 * `tests/cell-complex/portalPaths.test.ts` — unit tier.
 *
 * `buildPortalPathTables` enumerates, for each cell as root, every portal path up to a maximum depth: one path per
 * distinct sequence of portal crossings, each carrying the rigid transform between the root's frame and the
 * destination's frame in both directions (`_docs/MATHEMATICAL_MODEL.md` §4). These tests check the depth-0 identity
 * path, that depth-1 paths match the root's outgoing portals, duplicate-destination handling, inverse-consistency
 * of the stored transforms, stable path ids, and that a chain of many portal crossings stays a well-formed rigid
 * transform. Table-building cases stay at depth 4 or less: `tests/cell-complex/staticPortalPathCull.test.ts`
 * documents why the one remaining depth-10 case there is needed and `scripts/bench/staticCull.bench.ts` measures
 * depth-10 performance as a benchmark, not a test.
 */
import { describe, expect, it } from "vitest";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildPortalPathTables } from "../../src/cell-complex/portalPaths";
import { cube } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/twoPrismLoop";
import fc from "fast-check";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  type Mat3,
  type RigidTransform3,
} from "../../src/math/rigidTransform3";
import { almostEqualVec3, lengthVec3, subVec3, vec3 } from "../../src/math/vec3";
import { geometryTolerance } from "../../src/math/tolerances";
import { exampleWorldSpecs } from "../support/arbitraries";

describe("buildPortalPathTables", () => {
  it("builds one table per root cell with one depth-0 identity path", () => {
    const world = compileCellComplex(twoPrismLoop);
    const tables = buildPortalPathTables(world, { maxDepth: 2 });

    expect([...tables.tablesByRootCellId.keys()]).toEqual(["room-a", "room-b"]);

    for (const cell of world.cells) {
      const table = tables.tablesByRootCellId.get(cell.id);
      const rootPaths = table?.paths.filter((path) => path.depth === 0);

      expect(table?.rootCellId).toBe(cell.id);
      expect(rootPaths).toHaveLength(1);
      expect(rootPaths?.[0]).toMatchObject({
        id: 0,
        rootCellId: cell.id,
        destinationCellId: cell.id,
        steps: [],
      });
      expect(rootPaths?.[0]?.destinationFromRoot.translation).toEqual({ x: 0, y: 0, z: 0 });
      expect(rootPaths?.[0]?.rootFromDestination.translation).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it("creates one depth-1 path for each outgoing root portal", () => {
    const world = compileCellComplex(cube);
    const tables = buildPortalPathTables(world, { maxDepth: 1 });

    for (const cell of world.cells) {
      const table = tables.tablesByRootCellId.get(cell.id)!;

      expect(table.paths.filter((path) => path.depth === 1)).toHaveLength(cell.portals.length);
    }
  });

  it("skips immediate reverse paths by default and can include them when requested", () => {
    const world = compileCellComplex(twoPrismLoop);
    const skipped = buildPortalPathTables(world, { maxDepth: 2 });
    const included = buildPortalPathTables(world, { maxDepth: 2, skipImmediateReverse: false });

    expect(skipped.tablesByRootCellId.get("room-a")?.paths.map((path) => path.destinationCellId)).toEqual([
      "room-a",
      "room-b",
    ]);
    expect(included.tablesByRootCellId.get("room-a")?.paths.map((path) => path.destinationCellId)).toEqual([
      "room-a",
      "room-b",
      "room-a",
    ]);
  });

  it("preserves distinct paths to the same destination cell", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 2 }).tablesByRootCellId.get("front")!;
    const duplicatedDestination = [...table.pathsByDestinationCellId.values()].find((paths) => paths.length > 1);

    expect(duplicatedDestination).toBeDefined();
    expect(new Set(duplicatedDestination?.map((path) => path.id)).size).toBe(duplicatedDestination?.length);
  });

  it("stores inverse root and destination transforms", () => {
    const world = compileCellComplex(cube);
    const table = buildPortalPathTables(world, { maxDepth: 3 }).tablesByRootCellId.get("front")!;

    for (const path of table.paths) {
      const roundTrip = composeRigidTransform3(path.rootFromDestination, path.destinationFromRoot);

      expect(almostEqualVec3(transformPoint3(roundTrip, vec3(1, 2, 3)), vec3(1, 2, 3))).toBe(true);
    }
  });

  it("assigns stable unique ids and parent ids that refer to earlier paths", () => {
    const world = compileCellComplex(cube);
    const first = buildPortalPathTables(world, { maxDepth: 3 }).tablesByRootCellId.get("front")!;
    const second = buildPortalPathTables(world, { maxDepth: 3 }).tablesByRootCellId.get("front")!;

    expect(first.paths.map((path) => path.id)).toEqual(second.paths.map((path) => path.id));
    expect(new Set(first.paths.map((path) => path.id)).size).toBe(first.paths.length);

    for (const path of first.paths) {
      if (path.parentPathId !== undefined) {
        expect(path.parentPathId).toBeLessThan(path.id);
        expect(first.pathsById.get(path.parentPathId)).toBeDefined();
      }
    }
  });

  describe("properties", () => {
    const speedWorlds = ["cube", "tetrahedron", "torus"].map((name) => {
      const spec = exampleWorldSpecs.find(([candidate]) => candidate === name)![1];
      const world = compileCellComplex(spec);

      return [name, world, buildPortalPathTables(world, { maxDepth: 3 })] as const;
    });
    const testPoints = [vec3(0, 0, 0), vec3(1.5, -2, 0.5), vec3(-3, 4, 1)];

    function expectSamePoints(a: RigidTransform3, b: RigidTransform3): void {
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

    it("composing 10 portal crossings along a generated word stays a valid rigid transform", () => {
      // The cube's cells are fully portaled (4 portals each, no walls), so any sequence of portal choices is walkable
      // for 10 steps. Table-building at depth 10 is exponential (one path per word) and is what this property
      // replaces: it walks a single word instead of enumerating every one.
      const world = compileCellComplex(cube);

      fc.assert(
        fc.property(fc.constantFrom(...world.cells.map((cell) => cell.id)), fc.array(fc.nat(3), { minLength: 10, maxLength: 10 }), (startCellId, choices) => {
          let cellId = startCellId;
          let destinationFromRoot = identityRigidTransform3;

          for (const choice of choices) {
            const cell = world.cellsById.get(cellId)!;
            const portal = cell.portals[choice % cell.portals.length];

            destinationFromRoot = composeRigidTransform3(portal.transformToTarget, destinationFromRoot);
            cellId = portal.targetCellId;
          }

          expect(isRigidTransformWithinTolerance(destinationFromRoot, geometryTolerance)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});

/** True if `g.rotation` is finite and orthogonal with determinant +1, and `g.translation` is finite, each within `tolerance`. */
function isRigidTransformWithinTolerance(g: RigidTransform3, tolerance: number): boolean {
  const r = g.rotation;
  const entries: readonly number[] = [r.m00, r.m01, r.m02, r.m10, r.m11, r.m12, r.m20, r.m21, r.m22, g.translation.x, g.translation.y, g.translation.z];

  if (!entries.every(Number.isFinite)) {
    return false;
  }

  const rtR = multiplyTransposeSelf(r);
  const orthogonal = [rtR.m00 - 1, rtR.m01, rtR.m02, rtR.m10, rtR.m11 - 1, rtR.m12, rtR.m20, rtR.m21, rtR.m22 - 1].every(
    (entry) => Math.abs(entry) <= tolerance,
  );
  const determinant =
    r.m00 * (r.m11 * r.m22 - r.m12 * r.m21) -
    r.m01 * (r.m10 * r.m22 - r.m12 * r.m20) +
    r.m02 * (r.m10 * r.m21 - r.m11 * r.m20);

  return orthogonal && Math.abs(determinant - 1) <= tolerance;
}

function multiplyTransposeSelf(r: Mat3): Mat3 {
  return {
    m00: r.m00 * r.m00 + r.m10 * r.m10 + r.m20 * r.m20,
    m01: r.m00 * r.m01 + r.m10 * r.m11 + r.m20 * r.m21,
    m02: r.m00 * r.m02 + r.m10 * r.m12 + r.m20 * r.m22,
    m10: r.m01 * r.m00 + r.m11 * r.m10 + r.m21 * r.m20,
    m11: r.m01 * r.m01 + r.m11 * r.m11 + r.m21 * r.m21,
    m12: r.m01 * r.m02 + r.m11 * r.m12 + r.m21 * r.m22,
    m20: r.m02 * r.m00 + r.m12 * r.m10 + r.m22 * r.m20,
    m21: r.m02 * r.m01 + r.m12 * r.m11 + r.m22 * r.m21,
    m22: r.m02 * r.m02 + r.m12 * r.m12 + r.m22 * r.m22,
  };
}
