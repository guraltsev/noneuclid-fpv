/**
 * Timing benchmark of the app's static-cull settings at depth 10 across several example worlds. A benchmark, not a
 * test (_docs/tests.md §4.7): it prints a table for a person to read and is never run by `npm test`.
 *
 *   npm run bench -- staticCull
 */
import { cube, dodecahedron, genus2Torus, icosahedron, torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";

const worlds = [
  ["cube", cube],
  ["icosahedron", icosahedron],
  ["torusModuli", torusModuli],
  ["genus2Torus", genus2Torus],
  ["dodecahedron", dodecahedron],
] as const;
const rows: string[] = [];

for (const [name, spec] of worlds) {
  const world = compileCellComplex(spec);
  const times: number[] = [];
  let keptPerRoot: number[] = [];

  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    const result = buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 10,
      skipImmediateReverse: true,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 50_000,
    });

    times.push(performance.now() - start);
    keptPerRoot = [...result.summariesByRootCellId.values()].map((summary) => summary.keptPathCount);
  }

  times.sort((a, b) => a - b);
  rows.push(`${name.padEnd(14)} median ${times[1].toFixed(0).padStart(7)} ms   kept per root: ${keptPerRoot.join(",")}`);
}

console.info(`\nstatic cull benchmark (depth 10)\n${rows.join("\n")}`);
