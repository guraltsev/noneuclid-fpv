import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { checkPortalPathString } from "../../src/cell-complex/portalPathDebug";
import { buildPortalPathTables } from "../../src/cell-complex/portalPaths";
import {
  buildStaticallyCulledPortalPathTables,
  staticallyCullPortalPathTables,
  type StaticPortalPathRootStatus,
} from "../../src/cell-complex/staticPortalPathCull";
import { cube, dodecahedron } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/twoPrismLoop";

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

  it("rejects cube paths whose only transversal runs along a cell edge", () => {
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
      rejectionReason: "no-static-line-transversal",
    });
  });

  it("drops descendants of rejected paths so no kept path has a rejected parent", () => {
    const world = compileCellComplex(cube);
    const candidates = buildPortalPathTables(world, { maxDepth: 4 });
    const result = staticallyCullPortalPathTables(world, candidates, { toleranceMeters: 1e-6, keepRejectedPathDetails: true });
    const keptTable = result.tables.tablesByRootCellId.get("front")!;
    const candidateTable = candidates.tablesByRootCellId.get("front")!;
    const summary = result.summariesByRootCellId.get("front")!;
    const rejectionByPathId = new Map(summary.rejectedPaths.map((rejection) => [rejection.pathId, rejection]));
    let inheritedRejections = 0;

    for (const path of keptTable.paths) {
      if (path.parentPathId !== undefined) {
        expect(keptTable.pathsById.has(path.parentPathId)).toBe(true);
      }
    }

    for (const path of candidateTable.paths) {
      if (path.parentPathId === undefined || keptTable.pathsById.has(path.parentPathId)) {
        continue;
      }

      const parentRejection = rejectionByPathId.get(path.parentPathId)!;
      const rejection = rejectionByPathId.get(path.id)!;

      expect(keptTable.pathsById.has(path.id)).toBe(false);
      expect(rejection.reason).toBe(parentRejection.reason);
      expect(rejection.details).toContain("parent path");
      inheritedRejections += 1;
    }

    expect(inheritedRejections).toBeGreaterThan(0);
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

  it("spends the path budget best-first by line measure", () => {
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
    // Each of the 4 kept depth-1 paths pushed 3 feasible depth-2 children, all cut by the budget.
    expect(frontSummary.rejectedByReason.get("static-path-budget")).toBe(12);
  });

  it("reports per-root progress", () => {
    const world = compileCellComplex(cube);
    const statuses: StaticPortalPathRootStatus[] = [];

    buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 2,
      toleranceMeters: 1e-6,
      onRootComplete(status) {
        if (status.rootCellId === "front") {
          statuses.push(status);
        }
      },
    });

    expect(statuses).toHaveLength(1);
    expect(statuses[0].keptPathCountByDepth).toEqual([1, 4, 12]);
    expect(statuses[0].budgetExhausted).toBe(false);
    expect(statuses[0].keptPathCount).toBe(17);
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

    expect(contextualFront.paths.map(pathSignature).sort()).toEqual(postCullFront.paths.map(pathSignature).sort());
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

function pathSignature(path: { readonly steps: readonly { readonly sourceCellId: string; readonly sourcePortalId: string }[] }): string {
  return path.steps.map((step) => `${step.sourceCellId}:${step.sourcePortalId}`).join("/");
}
