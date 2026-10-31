/**
 * `tests/cell-complex/staticPortalPathCull.test.ts` — unit tier.
 *
 * `staticallyCullPortalPathTables`/`buildStaticallyCulledPortalPathTables` keep, of every candidate portal path, only
 * those a line could actually pass through (a non-empty "crossed strings" line cone, `staticLineCone.test.ts`) and
 * at most `maxKeptPathsPerRoot` per root, spent best-first by the cone's measure
 * (`_docs/MATHEMATICAL_MODEL.md` §4, §8.1). Rejections are reported by reason rather than silently dropped, and a
 * kept path never has a rejected parent. These tests check path-count bookkeeping, both rejection reasons
 * (geometric transversal and path budget), that the depth-10 cube path tree can be culled contextually while
 * expanding (matching a post-hoc cull of the same tree), and the property that the cull never drops a path a line
 * actually walks, checked by sampling lines inside the kept cones and by walking random lines through example
 * worlds and cone-point fans.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { checkPortalPathString } from "../../src/cell-complex/portalPathDebug";
import { buildPortalPathTables, type PortalPathTable, type PortalRenderPath } from "../../src/cell-complex/portalPaths";
import { clipLineConeByPortal, lineConeForTwoPortals, type LineCone } from "../../src/cell-complex/staticLineCone";
import {
  buildStaticallyCulledPortalPathTables,
  staticallyCullPortalPathTables,
  type StaticPortalPathRootStatus,
} from "../../src/cell-complex/staticPortalPathCull";
import { cube, dodecahedron } from "../../src/authoring/exampleWorlds";
import { twoPrismLoop } from "../fixtures/cell-complex/twoPrismLoop";
import { arbConeFanWorldSpec, arbPointInCell, exampleWorldSpecs } from "../support/arbitraries";
import { lineStartThroughPortal, mulberry32, sampleLineInCone, walkedWordPrefixes, wordSignature } from "../support/portalWordWitness";

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

  it("prunes the dodecahedron path tree contextually at depth 6", () => {
    // Depth 6 already keeps hundreds of paths per root and rejects hundreds more by the geometric transversal
    // check (not the path budget, which is set far above what is kept): deep enough to show contextual pruning
    // without the exponential depth-10 cost a benchmark measures instead (scripts/bench/staticCull.bench.ts).
    const world = compileCellComplex(dodecahedron);
    const result = buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 6,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 50_000,
    });
    const topSummary = result.summariesByRootCellId.get("top")!;
    const topTable = result.tables.tablesByRootCellId.get("top")!;
    const keptPathCounts = [...result.summariesByRootCellId.values()].map((summary) => summary.keptPathCount);
    const rejectedPathCounts = [...result.summariesByRootCellId.values()].map((summary) => summary.rejectedPathCount);

    expect(topTable.maxDepth).toBe(6);
    expect(topSummary.keptPathCount).toBe(topTable.paths.length);
    expect(topSummary.keptPathCount).toBeLessThanOrEqual(1_000);
    expect(new Set(keptPathCounts)).toEqual(new Set([topSummary.keptPathCount]));
    expect(new Set(rejectedPathCounts)).toEqual(new Set([topSummary.rejectedPathCount]));
    expect(topSummary.rejectedPathCount).toBeGreaterThan(0);
    expect([...topSummary.rejectedByReason.values()].reduce((total, count) => total + count, 0)).toBe(
      topSummary.rejectedPathCount,
    );
  });

  describe("properties", () => {
    const wideningMeters = 1e-6;

    function keptSignaturesByRoot(world: CompiledCellComplex, maxDepth: number): Map<string, Set<string>> {
      const result = buildStaticallyCulledPortalPathTables(world, { maxDepth, toleranceMeters: wideningMeters });
      const byRoot = new Map<string, Set<string>>();

      for (const [rootCellId, table] of result.tables.tablesByRootCellId) {
        byRoot.set(rootCellId, new Set(table.paths.map((path) => wordSignature(path.steps))));
      }

      return byRoot;
    }

    /** Portals of the word's prefixes (index = depth - 1), developed into the root frame. */
    function portalsAlongPath(table: PortalPathTable, path: PortalRenderPath) {
      const portals = [];
      let current: PortalRenderPath | undefined = path;

      while (current && current.depth > 0) {
        portals.unshift(current.newestPortalInRoot!);
        current = current.parentPathId === undefined ? undefined : table.pathsById.get(current.parentPathId);
      }

      return portals;
    }

    function coneOfPath(table: PortalPathTable, path: PortalRenderPath): LineCone {
      const portals = portalsAlongPath(table, path);
      let cone = lineConeForTwoPortals(portals[0], portals[1], wideningMeters);

      for (const portal of portals.slice(2)) {
        cone = clipLineConeByPortal(cone, portal, wideningMeters);
      }

      return cone;
    }

    it("keeps every prefix of a walked line in the example worlds", () => {
      for (const [name, spec] of exampleWorldSpecs) {
        const world = compileCellComplex(spec);
        const kept = keptSignaturesByRoot(world, 6);

        fc.assert(
          fc.property(
            fc.nat({ max: world.cells.length - 1 }).chain((index) =>
              fc.tuple(fc.constant(index), arbPointInCell(world.cells[index]), fc.double({ min: -Math.PI, max: Math.PI, noNaN: true })),
            ),
            ([index, start, angle]) => {
              const cell = world.cells[index];
              const prefixes = walkedWordPrefixes(world, cell.id, start, { x: Math.cos(angle), y: Math.sin(angle) }, 6);
              const missing = prefixes.filter((prefix) => !kept.get(cell.id)!.has(prefix));

              expect(missing, `${name} root ${cell.id} start ${JSON.stringify(start)} angle ${angle} missing ${missing.join(" | ")}`).toEqual([]);
            },
          ),
          { numRuns: 100 },
        );
      }
    });

    it("keeps every prefix of a walked line in random cone-point fans", () => {
      fc.assert(
        fc.property(
          arbConeFanWorldSpec,
          fc.nat({ max: 7 }),
          fc.double({ min: 0.01, max: 1, noNaN: true }),
          fc.double({ min: 0.01, max: 1, noNaN: true }),
          fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
          (spec, rootIndex, u, v, angle) => {
            const world = compileCellComplex(spec);
            const cell = world.cells[rootIndex % world.cells.length];
            // Interior point: a convex combination of the three base vertices with positive weights.
            const total = 1 + u + v;
            const [a, b, c] = cell.baseVertices;
            const start = { x: (a.x + u * b.x + v * c.x) / total, y: (a.y + u * b.y + v * c.y) / total };
            const kept = keptSignaturesByRoot(world, 6).get(cell.id)!;
            const prefixes = walkedWordPrefixes(world, cell.id, start, { x: Math.cos(angle), y: Math.sin(angle) }, 6);

            expect(prefixes.filter((prefix) => !kept.has(prefix))).toEqual([]);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("every kept path of depth 3-6 has a line in its cone that reproduces the word", () => {
      for (const [name, spec] of exampleWorldSpecs) {
        const world = compileCellComplex(spec);
        const rng = mulberry32(2024);
        const result = buildStaticallyCulledPortalPathTables(world, { maxDepth: 6, toleranceMeters: wideningMeters });
        const candidates = [...result.tables.tablesByRootCellId.values()].flatMap((table) =>
          table.paths.filter((path) => path.depth >= 3).map((path) => ({ table, path })),
        );

        for (let sample = 0; sample < 50 && candidates.length > 0; sample += 1) {
          const { table, path } = candidates[Math.floor(rng() * candidates.length)];
          const cone = coneOfPath(table, path);
          const signature = wordSignature(path.steps);
          const first = portalsAlongPath(table, path)[0];
          let reproduced = false;

          expect(cone.length, `${name} ${signature}`).toBeGreaterThanOrEqual(3);

          for (let attempt = 0; attempt < 20 && !reproduced; attempt += 1) {
            const line = sampleLineInCone(cone, rng);
            const { start, direction } = lineStartThroughPortal(line, first);

            reproduced = walkedWordPrefixes(world, path.rootCellId, start, direction, path.depth).includes(signature);
          }

          expect(reproduced, `${name} root ${path.rootCellId} word ${signature}`).toBe(true);
        }
      }
    });
  });
});

function pathSignature(path: { readonly steps: readonly { readonly sourceCellId: string; readonly sourcePortalId: string }[] }): string {
  return path.steps.map((step) => `${step.sourceCellId}:${step.sourcePortalId}`).join("/");
}
