import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { checkPortalPathString } from "../../src/cell-complex/portalPathDebug";
import { buildPortalPathTables, createPortalPathTable, type PortalPathTablesByRootCell } from "../../src/cell-complex/portalPaths";
import { buildStaticallyCulledPortalPathTables, staticallyCullPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { cube, dodecahedron } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/twoPrismLoop";
import { identityMat3, invertRigidTransform3, type RigidTransform3 } from "../../src/math/rigidTransform3";

describe("staticallyCullPortalPathTables", () => {
  it("keeps depth-0 paths and preserves kept path ids", () => {
    const world = compileCellComplex(twoPrismLoop);
    const candidates = buildPortalPathTables(world, { maxDepth: 1, skipImmediateReverse: false });
    const result = staticallyCullPortalPathTables(world, candidates, { toleranceMeters: 1e-6 });
    const kept = result.tables.tablesByRootCellId.get("room-a")!;

    expect(kept.pathsById.get(0)?.depth).toBe(0);
    expect(kept.paths.map((path) => path.id)).toEqual(candidates.tablesByRootCellId.get("room-a")?.paths.map((path) => path.id));
  });

  it("keeps one-hop cube bounds that cross the portal plane", () => {
    const world = compileCellComplex(cube);
    const candidates = buildPortalPathTables(world, { maxDepth: 1 });
    const result = staticallyCullPortalPathTables(world, candidates, { toleranceMeters: 1e-6 });
    const summary = result.summariesByRootCellId.get("front")!;

    expect(summary.keptPathCount).toBe(summary.inputPathCount);
    expect(summary.rejectedPathCount).toBe(0);
  });

  it("rejects impossible bounds against ancestor portal apertures and counts the reason", () => {
    const world = compileCellComplex(twoPrismLoop);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room-a")!.paths[0];
    const rootFromDestination = translatedTransform(-20, 0, 0);
    const impossibleTable = createPortalPathTable("room-a", 1, [
      rootPath,
      {
        id: 4,
        rootCellId: "room-a",
        destinationCellId: "room-b",
        depth: 1,
        parentPathId: 0,
        steps: [
          {
            sourceCellId: "room-a",
            sourcePortalId: "side-1",
            sourcePortalSideIndex: 1,
            targetCellId: "room-b",
            targetPortalId: "side-3",
          },
        ],
        destinationFromRoot: invertRigidTransform3(rootFromDestination),
        rootFromDestination,
      },
    ]);
    const candidates: PortalPathTablesByRootCell = {
      maxDepth: 1,
      tablesByRootCellId: new Map([["room-a", impossibleTable]]),
    };
    const result = staticallyCullPortalPathTables(world, candidates, {
      toleranceMeters: 1e-6,
      keepRejectedPathDetails: true,
    });
    const summary = result.summariesByRootCellId.get("room-a")!;

    expect(result.tables.tablesByRootCellId.get("room-a")!.paths.map((path) => path.id)).toEqual([0]);
    expect(summary.rejectedPathCount).toBe(1);
    expect(summary.rejectedByReason.get("outside-ancestor-portal-plane")).toBe(1);
    expect(summary.rejectedPaths).toEqual([
      expect.objectContaining({
        pathId: 4,
        reason: "outside-ancestor-portal-plane",
        details: expect.stringContaining("room-a:side-1"),
      }),
    ]);
  });

  it("rejects cube paths that only touch an ancestor portal plane from behind", () => {
    const world = compileCellComplex(cube);
    const candidates = buildPortalPathTables(world, { maxDepth: 3 });
    const result = staticallyCullPortalPathTables(world, candidates, {
      toleranceMeters: 1e-6,
      keepRejectedPathDetails: true,
    });
    const pathCheck = checkPortalPathString("0 3 1", {
      world,
      rootCellId: "front",
      candidateTables: candidates,
      keptTables: result.tables,
      cullSummariesByRootCellId: result.summariesByRootCellId,
    });
    const validEdgePathCheck = checkPortalPathString("0 3", {
      world,
      rootCellId: "front",
      candidateTables: candidates,
      keptTables: result.tables,
      cullSummariesByRootCellId: result.summariesByRootCellId,
    });
    const validCornerPathCheck = checkPortalPathString("0 3 2", {
      world,
      rootCellId: "front",
      candidateTables: candidates,
      keptTables: result.tables,
      cullSummariesByRootCellId: result.summariesByRootCellId,
    });

    expect(validEdgePathCheck).toMatchObject({
      valid: true,
      existsInBuiltTable: true,
      survivedStaticCull: true,
    });
    expect(validCornerPathCheck).toMatchObject({
      valid: true,
      existsInBuiltTable: true,
      survivedStaticCull: true,
    });

    expect(pathCheck).toMatchObject({
      valid: true,
      existsInBuiltTable: true,
      survivedStaticCull: false,
      rejectionReason: "outside-ancestor-portal-plane",
    });
  });

  it("drops descendants of rejected paths so no kept path has a rejected parent", () => {
    const world = compileCellComplex(cube);
    const candidates = buildPortalPathTables(world, { maxDepth: 2 });
    const options = { toleranceMeters: 1e-6, keepRejectedPathDetails: true };
    const baseline = staticallyCullPortalPathTables(world, candidates, options);
    const baselineTable = baseline.tables.tablesByRootCellId.get("front")!;
    const child = baselineTable.paths.find((path) => path.depth === 2)!;
    const parent = baselineTable.pathsById.get(child.parentPathId!)!;

    // Move the parent far outside the first portal aperture so that it is rejected; the child's own geometry is unchanged.
    const movedRootFromDestination = translatedTransform(-100, 0, 0);
    const brokenParent = {
      ...parent,
      rootFromDestination: movedRootFromDestination,
      destinationFromRoot: invertRigidTransform3(movedRootFromDestination),
    };
    const original = candidates.tablesByRootCellId.get("front")!;
    const brokenTable = createPortalPathTable(
      "front",
      original.maxDepth,
      original.paths.map((path) => (path.id === parent.id ? brokenParent : path)),
    );
    const result = staticallyCullPortalPathTables(
      world,
      { maxDepth: candidates.maxDepth, tablesByRootCellId: new Map([["front", brokenTable]]) },
      options,
    );
    const keptTable = result.tables.tablesByRootCellId.get("front")!;
    const summary = result.summariesByRootCellId.get("front")!;

    expect(keptTable.pathsById.has(parent.id)).toBe(false);
    expect(keptTable.pathsById.has(child.id)).toBe(false);
    expect(summary.rejectedPaths.find((path) => path.pathId === child.id)?.details).toContain("parent path");

    for (const path of keptTable.paths) {
      if (path.parentPathId !== undefined) {
        expect(keptTable.pathsById.has(path.parentPathId)).toBe(true);
      }
    }
  });

  it("returns well-formed summaries and tables when no paths are rejected", () => {
    const world = compileCellComplex(twoPrismLoop);
    const candidates = buildPortalPathTables(world, { maxDepth: 0 });
    const result = staticallyCullPortalPathTables(world, candidates, {
      toleranceMeters: 1e-6,
      keepRejectedPathDetails: true,
    });
    const summary = result.summariesByRootCellId.get("room-a")!;
    const table = result.tables.tablesByRootCellId.get("room-a")!;

    expect(summary).toMatchObject({
      rootCellId: "room-a",
      inputPathCount: 1,
      keptPathCount: 1,
      rejectedPathCount: 0,
      rejectedPaths: [],
    });
    expect(summary.rejectedByReason.size).toBe(0);
    expect(table.paths).toHaveLength(1);
    expect(table.pathsById.get(0)).toBeDefined();
  });

  it("reports static path budget rejections instead of silently truncating", () => {
    const world = compileCellComplex(cube);
    const candidates = buildPortalPathTables(world, { maxDepth: 1 });
    const result = staticallyCullPortalPathTables(world, candidates, {
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 2,
      keepRejectedPathDetails: true,
    });
    const summary = result.summariesByRootCellId.get("front")!;

    expect(summary.keptPathCount).toBe(2);
    expect(summary.rejectedPathCount).toBe(summary.inputPathCount - 2);
    expect(summary.rejectedByReason.get("static-path-budget")).toBe(summary.rejectedPathCount);
    expect(summary.rejectedPaths.every((path) => path.reason === "static-path-budget")).toBe(true);
    expect(summary.rejectedPaths[0]?.details).toContain("static path budget");
  });

  it("spends contextual path budget breadth-first", () => {
    const world = compileCellComplex(cube);
    const result = buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 4,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 5,
    });
    const frontTable = result.tables.tablesByRootCellId.get("front")!;
    const frontSummary = result.summariesByRootCellId.get("front")!;

    expect(frontTable.paths.map((path) => path.depth)).toEqual([0, 1, 1, 1, 1]);
    expect(frontTable.paths.filter((path) => path.depth > 1)).toHaveLength(0);
    expect(frontSummary.rejectedByReason.get("static-path-budget")).toBe(1);
  });

  it("reports contextual path progress at the end of each depth", () => {
    const world = compileCellComplex(cube);
    const statuses: {
      readonly rootCellId: string;
      readonly depth: number;
      readonly processedPathCount: number;
      readonly acceptedPathCount: number;
      readonly rejectedPathCount: number;
    }[] = [];

    buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 2,
      toleranceMeters: 1e-6,
      onDepthComplete(status) {
        if (status.rootCellId === "front") {
          statuses.push(status);
        }
      },
    });

    expect(statuses.map((status) => status.depth)).toEqual([0, 1, 2]);
    expect(statuses[0]).toMatchObject({
      processedPathCount: 1,
      acceptedPathCount: 1,
      rejectedPathCount: 0,
    });
    expect(statuses[1]).toMatchObject({
      processedPathCount: 4,
      acceptedPathCount: 4,
      rejectedPathCount: 0,
    });
  });

  it("can apply static culling while expanding the path tree", () => {
    const world = compileCellComplex(cube);
    const candidates = buildPortalPathTables(world, { maxDepth: 3 });
    const postCull = staticallyCullPortalPathTables(world, candidates, { toleranceMeters: 1e-6 });
    const contextualCull = buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 3,
      toleranceMeters: 1e-6,
    });
    const postCullFront = postCull.tables.tablesByRootCellId.get("front")!;
    const contextualFront = contextualCull.tables.tablesByRootCellId.get("front")!;

    expect(contextualFront.paths.map(pathSignature)).toEqual(postCullFront.paths.map(pathSignature));
    expect(contextualCull.summariesByRootCellId.get("front")?.rejectedPathCount).toBeGreaterThan(0);
  });

  it("prunes the dodecahedron path tree contextually at depth 10", () => {
    const world = compileCellComplex(dodecahedron);
    const result = buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 10,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 50_000,
    });
    const topSummary = result.summariesByRootCellId.get("top")!;
    const topTable = result.tables.tablesByRootCellId.get("top")!;
    const keptPathCounts = [...result.summariesByRootCellId.values()].map((summary) => summary.keptPathCount);
    const rejectedPathCounts = [...result.summariesByRootCellId.values()].map((summary) => summary.rejectedPathCount);

    expect(topTable.maxDepth).toBe(10);
    expect(topSummary.keptPathCount).toBe(topTable.paths.length);
    expect(topSummary.keptPathCount).toBeLessThanOrEqual(12_000);
    expect(new Set(keptPathCounts)).toEqual(new Set([topSummary.keptPathCount]));
    expect(new Set(rejectedPathCounts)).toEqual(new Set([topSummary.rejectedPathCount]));
    expect(topSummary.rejectedPathCount).toBeGreaterThan(0);
    expect([...topSummary.rejectedByReason.values()].reduce((total, count) => total + count, 0)).toBe(
      topSummary.rejectedPathCount,
    );
  });
});

function translatedTransform(x: number, y: number, z: number): RigidTransform3 {
  return {
    rotation: identityMat3,
    translation: { x, y, z },
  };
}

function pathSignature(path: { readonly steps: readonly { readonly sourceCellId: string; readonly sourcePortalId: string }[] }): string {
  return path.steps.map((step) => `${step.sourceCellId}:${step.sourcePortalId}`).join("/");
}
