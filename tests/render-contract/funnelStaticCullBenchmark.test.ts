import * as THREE from "three";
import { describe, it } from "vitest";
import { cube, dodecahedron, genus2Torus, icosahedron, torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildPortalPathTables, type PortalPathTable } from "../../src/cell-complex/portalPaths";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { computeVisiblePortalPaths, defaultMinPortalScreenAreaPixels } from "../../src/render/three/visiblePortalPaths";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import { mulberry32 } from "../support/portalWordWitness";

// Per-frame value of the static cull: runs the funnel with the app's options from the same random cameras against the
// statically culled and the unculled table at the same depth, and prints examined paths, visible paths and time per call.
// Depths are the deepest whose unculled table fits in memory. Skipped unless FUNNEL_CULL_BENCH is set.
// PowerShell: $env:FUNNEL_CULL_BENCH='1'; npx vitest run tests/render-contract/funnelStaticCullBenchmark.test.ts; Remove-Item Env:FUNNEL_CULL_BENCH
describe.skipIf(!process.env.FUNNEL_CULL_BENCH)("funnel cost with and without the static cull", () => {
  it("times computeVisiblePortalPaths on culled and unculled tables", { timeout: 600_000 }, () => {
    const worlds = [
      ["cube", cube, 8],
      ["icosahedron", icosahedron, 8],
      ["torusModuli", torusModuli, 8],
      ["dodecahedron", dodecahedron, 6],
      ["genus2Torus", genus2Torus, 5],
    ] as const;
    const camerasPerWorld = 300;
    const timingsPerCamera = 5;
    const viewportPixels = { width: 1920, height: 1080 };
    const rows: string[] = [
      "world         depth | paths/root culled unculled | examined culled unculled | visible culled unculled | us/call culled unculled",
    ];

    for (const [name, spec, maxDepth] of worlds) {
      const world = compileCellComplex(spec);
      const culled = buildStaticallyCulledPortalPathTables(world, { maxDepth, skipImmediateReverse: true, toleranceMeters: 1e-6 })
        .tables.tablesByRootCellId;
      const unculled = buildPortalPathTables(world, { maxDepth, skipImmediateReverse: true }).tablesByRootCellId;
      const options = {
        maxDepth,
        maxVisiblePaths: 2_000,
        minPortalScreenAreaPixels: defaultMinPortalScreenAreaPixels,
        includeRootCell: true,
        sortMode: "depth-then-area",
      } as const;
      const random = mulberry32(0xbe7c + name.length);
      const cells = [...world.cellsById.values()];
      const cameras = Array.from({ length: camerasPerWorld }, () => {
        const cell = cells[Math.floor(random() * cells.length)];
        return { rootCellId: cell.id, camera: desktopCamera(pointInCell(cell, random), random) };
      });
      const measure = (tables: ReadonlyMap<string, PortalPathTable>) => {
        const examined: number[] = [];
        const visible: number[] = [];
        const micros: number[] = [];
        let largestTable = 0;

        for (const { rootCellId, camera } of cameras) {
          const pathTable = tables.get(rootCellId)!;
          const input = { world, rootCellId, pathTable, camera, viewportPixels, options };
          largestTable = Math.max(largestTable, pathTable.paths.length);
          let result = computeVisiblePortalPaths(input); // warm-up
          const times: number[] = [];

          for (let run = 0; run < timingsPerCamera; run += 1) {
            const start = performance.now();
            result = computeVisiblePortalPaths(input);
            times.push(performance.now() - start);
          }

          micros.push(median(times) * 1000);
          examined.push(result.summary.examinedPathCount);
          visible.push(result.summary.visiblePathCount);
        }

        return { largestTable, examined: mean(examined), visible: mean(visible), micros: median(micros) };
      };
      const a = measure(culled);
      const u = measure(unculled);

      rows.push(
        `${name.padEnd(13)} ${String(maxDepth).padStart(5)} | ${String(a.largestTable).padStart(17)} ${String(u.largestTable).padStart(8)} | ` +
          `${a.examined.toFixed(0).padStart(15)} ${u.examined.toFixed(0).padStart(8)} | ` +
          `${a.visible.toFixed(0).padStart(14)} ${u.visible.toFixed(0).padStart(8)} | ` +
          `${a.micros.toFixed(0).padStart(14)} ${u.micros.toFixed(0).padStart(8)}`,
      );
    }

    console.info(`\nfunnel cost with and without the static cull\n${rows.join("\n")}`);
  });
});

type Cell = CompiledCellComplex["cellsById"] extends ReadonlyMap<string, infer C> ? C : never;

// A point at eye height at least 0.2 m inside the cell, so the camera is never at a portal.
function pointInCell(cell: Cell, random: () => number): { x: number; y: number; z: number } {
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);

  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const x = Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs));
    const y = Math.min(...ys) + random() * (Math.max(...ys) - Math.min(...ys));

    if (cell.sides.every((side) => (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y > 0.2)) {
      return { x, y, z: 1.45 };
    }
  }

  throw new Error(`Could not sample a point inside cell ${cell.id}.`);
}

// Desktop-like camera: 70 degree vertical field of view, 16:9, random yaw, pitch within 20 degrees of level.
function desktopCamera(eye: { x: number; y: number; z: number }, random: () => number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 250);

  camera.position.copy(worldPointToThree(eye));
  camera.quaternion
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * 2 * Math.PI)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ((-20 + 40 * random()) * Math.PI) / 180));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  return camera;
}

function median(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
