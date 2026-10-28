import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import {
  deriveCellRenderArchetypeCapacities,
  planCellRenderArchetypes,
} from "../../src/render/three/cellRenderArchetypes";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";

describe("planCellRenderArchetypes", () => {
  it("builds floor, portal-frame, solid-wall, and static-object archetypes while excluding sky caps and marmots", () => {
    const world = compileCellComplex(createStaticObjectWorld());
    const planned = planCellRenderArchetypes(world, {
      debugLevel: "basic",
      portalPanelMode: "panel",
      eyeHeightMeters: 1.6,
      assets: createPreparedAssets(),
      capacitiesByCellId: new Map(world.cells.map((cell) => [cell.id, 2])),
    });

    for (const cell of world.cells) {
      expect(planned.some((entry) => entry.cellId === cell.id && entry.kind === "floor")).toBe(true);
      expect(planned.some((entry) => entry.cellId === cell.id && entry.sourceObjectName === `ceiling:${cell.id}`)).toBe(
        false,
      );
    }

    expect(planned.some((entry) => entry.kind === "solid-wall")).toBe(true);
    expect(planned.some((entry) => entry.kind === "portal-frame")).toBe(true);
    expect(planned.some((entry) => entry.kind === "static-object")).toBe(true);
    expect(planned.some((entry) => entry.kind === "debug-wireframe")).toBe(false);
    expect(planned.some((entry) => entry.sourceObjectName?.includes("marmot"))).toBe(false);
  });

  it("keeps forbidden-zone line wireframes out of instanced archetypes", () => {
    const world = compileCellComplex(createStaticObjectWorld());
    const planned = planCellRenderArchetypes(world, {
      debugLevel: "basic",
      portalPanelMode: "none",
      eyeHeightMeters: 1.6,
      assets: createPreparedAssets(),
      capacitiesByCellId: new Map(world.cells.map((cell) => [cell.id, 2])),
      showForbiddenZoneWireframes: true,
    });

    expect(planned.some((entry) => entry.kind === "debug-wireframe")).toBe(false);
    expect(planned.some((entry) => entry.sourceObjectName?.startsWith("forbidden-zone-wireframe:room-a"))).toBe(
      false,
    );
  });
});

describe("deriveCellRenderArchetypeCapacities", () => {
  it("counts kept destination paths per cell, includes depth-0 roots, and respects a visible-path cap", () => {
    const world = compileCellComplex(cube);
    const staticCull = buildStaticallyCulledPortalPathTables(world, {
      maxDepth: 3,
      skipImmediateReverse: false,
      toleranceMeters: 1e-6,
      maxKeptPathsPerRoot: 50_000,
    });

    const uncapped = deriveCellRenderArchetypeCapacities(world, staticCull);
    const capped = deriveCellRenderArchetypeCapacities(world, staticCull, 1);

    for (const cell of world.cells) {
      expect(uncapped.get(cell.id)).toBeGreaterThanOrEqual(1);
      expect(capped.get(cell.id)).toBe(1);
    }

    expect(Math.max(...world.cells.map((cell) => uncapped.get(cell.id) ?? 0))).toBeGreaterThan(1);
  });
});

function createPreparedAssets(): PreparedWorldAssets {
  return {
    getTexture: () => new THREE.Texture(),
    getConfiguredTexture: () => new THREE.Texture(),
    instantiateGltf: () => ({
      scene: new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      ),
      animations: [],
    }),
  };
}

function createStaticObjectWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 3,
        baseVertices: [
          { x: -2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
        portals: [
          {
            id: "side-1",
            sideIndex: 1,
            targetCellId: "room-b",
            targetPortalId: "side-3",
          },
        ],
        visuals: {
          floorColor: "#446688",
          objects: [
            {
              id: "crate",
              kind: "asset",
              assetPath: "crate.gltf",
              position: { x: 0, y: 0, z: 0 },
            },
            {
              id: "marmot",
              kind: "geodesci-marmot",
              assetPath: "marmot.gltf",
              position: { x: 0.5, y: 0.5, z: 0 },
              velocity: { x: 0, y: 0 },
              collision: { radius: 0.1, height: 0.2 },
            },
          ],
        },
      },
      {
        id: "room-b",
        heightMeters: 3,
        baseVertices: [
          { x: 2, y: -2 },
          { x: 6, y: -2 },
          { x: 6, y: 2 },
          { x: 2, y: 2 },
        ],
        portals: [
          {
            id: "side-3",
            sideIndex: 3,
            targetCellId: "room-a",
            targetPortalId: "side-1",
          },
        ],
      },
    ],
  };
}
