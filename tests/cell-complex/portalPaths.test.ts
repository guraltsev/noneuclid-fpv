import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildPortalPathTables } from "../../src/cell-complex/portalPaths";
import { cube } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/twoPrismLoop";
import { composeRigidTransform3, transformPoint3, type RigidTransform3 } from "../../src/math/rigidTransform3";
import { almostEqualVec3, vec3 } from "../../src/math/vec3";

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

  it("builds cube paths to depth 10 without NaN transforms", () => {
    const world = compileCellComplex(cube);
    const tables = buildPortalPathTables(world, { maxDepth: 10 });

    for (const table of tables.tablesByRootCellId.values()) {
      for (const path of table.paths) {
        expect(allFinite(path.destinationFromRoot)).toBe(true);
        expect(allFinite(path.rootFromDestination)).toBe(true);
      }
    }
  });

});

function allFinite(transform: RigidTransform3): boolean {
  return [...Object.values(transform.rotation), ...Object.values(transform.translation)].every(Number.isFinite);
}
