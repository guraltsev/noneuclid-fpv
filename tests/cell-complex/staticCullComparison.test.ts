import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { PortalPathTable, PortalRenderPath } from "../../src/cell-complex/portalPaths";
import { clipLineConeByPortal, lineConeForTwoPortals } from "../../src/cell-complex/staticLineCone";
import {
  buildStaticallyCulledPortalPathTables,
  buildStaticallyCulledPortalPathTablesLegacy,
} from "../../src/cell-complex/staticPortalPathCull";
import { exampleWorldSpecs } from "../support/arbitraries";
import { lineStartThroughPortal, mulberry32, sampleLineInCone, walkedWordPrefixes, wordSignature } from "../support/portalWordWitness";

// Temporary (job 20 Part B): compares the legacy tau/sigma cull with the cone cull. Deleted in Part C.
const widening = 1e-6;

function portalsAlong(table: PortalPathTable, path: PortalRenderPath) {
  const portals = [];
  let current: PortalRenderPath | undefined = path;

  while (current && current.depth > 0) {
    portals.unshift(current.newestPortalInRoot!);
    current = current.parentPathId === undefined ? undefined : table.pathsById.get(current.parentPathId);
  }

  return portals;
}

describe("legacy versus cone static cull", () => {
  it("compares kept word sets per world", { timeout: 600_000 }, () => {
    const rows: string[] = [];

    for (const [name, spec] of exampleWorldSpecs) {
      const world = compileCellComplex(spec);
      const legacy = buildStaticallyCulledPortalPathTablesLegacy(world, { maxDepth: 6, toleranceMeters: widening });
      const next = buildStaticallyCulledPortalPathTables(world, { maxDepth: 6, toleranceMeters: widening });
      const rng = mulberry32(99);
      let legacyKept = 0;
      let newKept = 0;
      let newOnlyCount = 0;
      let oldOnlyCount = 0;
      let newOnlyWithoutWitness = 0;
      let oldOnlyWithWitness = 0;

      for (const [rootCellId, newTable] of next.tables.tablesByRootCellId) {
        const legacySet = new Set(legacy.tables.tablesByRootCellId.get(rootCellId)!.paths.map((path) => wordSignature(path.steps)));
        const newByWord = new Map(newTable.paths.map((path) => [wordSignature(path.steps), path]));

        legacyKept += legacySet.size;
        newKept += newByWord.size;

        const newOnly = [...newByWord.keys()].filter((word) => !legacySet.has(word));
        const oldOnly = [...legacySet].filter((word) => !newByWord.has(word));

        newOnlyCount += newOnly.length;
        oldOnlyCount += oldOnly.length;

        // Fixed false rejections: each needs a witness line (or is a near-degenerate word recorded in the report).
        for (const word of newOnly.slice(0, 200)) {
          const path = newByWord.get(word)!;
          const portals = portalsAlong(newTable, path);
          let cone = portals.length >= 2 ? lineConeForTwoPortals(portals[0], portals[1], widening) : [];

          for (const portal of portals.slice(2)) {
            cone = clipLineConeByPortal(cone, portal, widening);
          }

          let reproduced = portals.length < 2;

          for (let attempt = 0; attempt < 200 && !reproduced && cone.length > 0; attempt += 1) {
            const { start, direction } = lineStartThroughPortal(sampleLineInCone(cone, rng), portals[0]);

            reproduced = walkedWordPrefixes(world, rootCellId, start, direction, path.depth).includes(word);
          }

          if (!reproduced) {
            newOnlyWithoutWitness += 1;
          }
        }

        // Words only the legacy cull keeps: random lines through the first portal must not reproduce them.
        for (const word of oldOnly.slice(0, 50)) {
          const legacyPath = legacy.tables.tablesByRootCellId.get(rootCellId)!.paths.find((path) => wordSignature(path.steps) === word)!;
          const firstStep = legacyPath.steps[0];
          const firstPortal = world.cellsById.get(firstStep.sourceCellId)!.sides[firstStep.sourcePortalSideIndex];
          // The root-frame first portal: left = side.end, right = side.start (root path transform is the identity).
          const first = { left: firstPortal.end, right: firstPortal.start, apertureTopMeters: 3 };
          let reproduced = false;

          for (let attempt = 0; attempt < 2000 && !reproduced; attempt += 1) {
            const s = rng();
            const angle = (rng() - 0.5) * Math.PI * 0.999;
            const mid = { x: first.right.x + s * (first.left.x - first.right.x), y: first.right.y + s * (first.left.y - first.right.y) };
            const outward = { x: -firstPortal.inwardNormal.x, y: -firstPortal.inwardNormal.y };
            const direction = {
              x: outward.x * Math.cos(angle) - outward.y * Math.sin(angle),
              y: outward.x * Math.sin(angle) + outward.y * Math.cos(angle),
            };
            const start = { x: mid.x - 1e-4 * direction.x, y: mid.y - 1e-4 * direction.y };

            reproduced = walkedWordPrefixes(world, rootCellId, start, direction, legacyPath.depth).includes(word);
          }

          if (reproduced) {
            oldOnlyWithWitness += 1;
          }
        }
      }

      rows.push(
        `${name.padEnd(17)} legacy ${String(legacyKept).padStart(7)}  new ${String(newKept).padStart(7)}  newOnly ${String(newOnlyCount).padStart(6)}  oldOnly ${String(oldOnlyCount).padStart(6)}  newOnly-no-witness ${newOnlyWithoutWitness}  oldOnly-with-witness ${oldOnlyWithWitness}`,
      );
      expect(newOnlyWithoutWitness, `${name} newOnly words without a witness`).toBe(0);
      expect(oldOnlyWithWitness, `${name} oldOnly words with a witness`).toBe(0);
    }

    console.info(`\nlegacy vs cone cull (maxDepth 6, summed over roots)\n${rows.join("\n")}`);
  });
});
