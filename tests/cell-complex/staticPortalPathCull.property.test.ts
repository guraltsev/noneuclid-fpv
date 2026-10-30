import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { PortalPathTable, PortalRenderPath } from "../../src/cell-complex/portalPaths";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { clipLineConeByPortal, lineConeForTwoPortals, type LineCone } from "../../src/cell-complex/staticLineCone";
import { arbConeFanWorldSpec, arbPointInCell, exampleWorldSpecs } from "../support/arbitraries";
import { lineStartThroughPortal, mulberry32, sampleLineInCone, walkedWordPrefixes, wordSignature } from "../support/portalWordWitness";

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

describe("static cull is sound against walked lines", () => {
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
        { numRuns: 200 },
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
