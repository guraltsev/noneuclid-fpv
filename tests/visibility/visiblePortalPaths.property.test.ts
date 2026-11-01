/**
 * Visible portal paths (src/visibility/visiblePortalPaths.ts), property: `computeVisiblePortalPaths` never gives
 * a false negative. For random cameras and random screen points in several example worlds, the ray a screen point
 * casts is walked through the glued cells directly (bypassing the renderer); every prefix of the word it crosses
 * must be a path `computeVisiblePortalPaths` returned, and the ray must lie inside that path's four clip planes
 * (within the tolerance of a cell-corner tie).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cube, genus2Torus, icosahedron, torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex, type CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { PortalPathTable } from "../../src/cell-complex/portalPaths";
import { walkDevelopedSegment } from "../../src/cell-complex/segmentWalk";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { computeVisiblePortalPaths } from "../support/visibilityHarness";
import { threePointToWorld } from "../../src/render/three/worldAxes";
import { mulberry32, wordSignature } from "../support/portalWordWitness";
import { createRandomCamera } from "../support/cameras";

const maxDepth = 6;
const eyeHeightMeters = 1.45;
const camerasPerWorld = 20;
const pointsPerCamera = 150;

describe("computeVisiblePortalPaths brute-force ray walk", () => {
  const worlds: readonly (readonly [string, CompiledCellComplex])[] = [
    ["cube", compileCellComplex(cube)],
    ["icosahedron", compileCellComplex(icosahedron)],
    ["torusModuli", compileCellComplex(torusModuli)],
    ["genus2Torus", compileCellComplex(genus2Torus)],
  ];

  for (const [name, world] of worlds) {
    it(`finds every walked word and keeps its rays inside the clip planes in ${name}`, () => {
      const random = mulberry32(0x5eed + name.length);
      const tables = buildStaticallyCulledPortalPathTables(world, { maxDepth, toleranceMeters: 1e-6 }).tables;
      const cells = [...world.cellsById.values()];
      let checkedPoints = 0;
      let checkedWords = 0;

      for (let cameraIndex = 0; cameraIndex < camerasPerWorld; cameraIndex += 1) {
        const rootCell = cells[Math.floor(random() * cells.length)];
        const table = tables.tablesByRootCellId.get(rootCell.id)!;
        const eye = cameraIndex % 4 === 3 ? pointNearRandomPortal(rootCell, random) : pointInCell(rootCell, random);
        const viewport = { width: 640, height: 480 };
        const camera = createRandomCamera(eye, random);
        const result = computeVisiblePortalPaths({
          world,
          rootCellId: rootCell.id,
          pathTable: table,
          camera,
          viewportPixels: viewport,
          options: { maxDepth, maxVisiblePaths: 100_000, minPortalScreenAreaPixels: 0, includeRootCell: true, sortMode: "depth-then-area" },
        });
        const idBySignature = signatureIndex(table);

        for (let pointIndex = 0; pointIndex < pointsPerCamera; pointIndex += 1) {
          const ndc = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, 0.5);
          const direction = ndc.unproject(camera).sub(camera.position).normalize();
          const u = threePointToWorld(direction);
          const s = Math.hypot(u.x, u.y);

          if (s < 1e-6) {
            continue;
          }

          const toSurface = u.z < 0 ? -eye.z / u.z : u.z > 0 ? (rootCell.heightMeters - eye.z) / u.z : 200;
          const walk = walkDevelopedSegment({
            world,
            cellId: rootCell.id,
            start: { x: eye.x, y: eye.y },
            direction: { x: u.x / s, y: u.y / s },
            lengthMeters: s * Math.min(toSurface, 200),
            maxCrossings: maxDepth,
          });
          const crossings = walk.crossings.slice(0, maxDepth);
          const sample = new THREE.Vector3().copy(camera.position).add(direction);

          for (let count = 1; count <= crossings.length; count += 1) {
            const signature = wordSignature(
              crossings.slice(0, count).map((crossing) => ({ sourceCellId: crossing.sourceCellId, sourcePortalId: crossing.portalId })),
            );
            const pathId = idBySignature.get(signature);
            const visible = pathId === undefined ? undefined : result.visiblePathById.get(pathId);

            checkedWords += 1;
            expect(visible, `${name} camera ${cameraIndex} point ${pointIndex} word ${signature}`).toBeDefined();

            for (let plane = 0; plane < 4; plane += 1) {
              const value =
                visible!.clipPlanes[plane * 4] * sample.x +
                visible!.clipPlanes[plane * 4 + 1] * sample.y +
                visible!.clipPlanes[plane * 4 + 2] * sample.z +
                visible!.clipPlanes[plane * 4 + 3];

              // Rays within 1e-6 of a sector boundary are ties at cell corners and are skipped.
              if (value < -1e-9 && Math.abs(value) < 1e-6) {
                continue;
              }

              expect(value, `${name} camera ${cameraIndex} point ${pointIndex} plane ${plane} word ${signature}`).toBeGreaterThanOrEqual(-1e-9);
            }
          }

          checkedPoints += 1;
        }
      }

      expect(checkedPoints).toBeGreaterThan(camerasPerWorld * pointsPerCamera * 0.5);
      expect(checkedWords).toBeGreaterThan(200);
    });
  }
});

function signatureIndex(table: PortalPathTable): Map<string, number> {
  const index = new Map<string, number>();

  for (const path of table.paths) {
    index.set(wordSignature(path.steps), path.id);
  }

  return index;
}

type Cell = CompiledCellComplex["cellsById"] extends ReadonlyMap<string, infer C> ? C : never;

function pointInCell(cell: Cell, random: () => number): { x: number; y: number; z: number } {
  const xs = cell.baseVertices.map((vertex) => vertex.x);
  const ys = cell.baseVertices.map((vertex) => vertex.y);

  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const x = Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs));
    const y = Math.min(...ys) + random() * (Math.max(...ys) - Math.min(...ys));

    if (cell.sides.every((side) => (x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y > 1e-3)) {
      return { x, y, z: eyeHeightMeters };
    }
  }

  throw new Error(`Could not sample a point inside cell ${cell.id}.`);
}

// A point inside the cell within 1 cm of a random portal side (but at least 1 mm inside).
function pointNearRandomPortal(cell: Cell, random: () => number): { x: number; y: number; z: number } {
  const sides = cell.sides.filter((side) => cell.portalBySideIndex.has(side.sideIndex));
  const side = sides[Math.floor(random() * sides.length)];
  const along = 0.1 + 0.8 * random();
  const inset = 0.001 + 0.009 * random();
  const x = side.start.x + along * (side.end.x - side.start.x) + inset * side.inwardNormal.x;
  const y = side.start.y + along * (side.end.y - side.start.y) + inset * side.inwardNormal.y;

  return { x, y, z: eyeHeightMeters };
}
