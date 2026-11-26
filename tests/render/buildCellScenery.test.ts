/**
 * `tests/render/buildCellScenery.test.ts` — unit tier.
 *
 * The scenery mesh of a cell is one non-indexed geometry (position, normal, color) whose triangle count is the sum of the layout's
 * per-kind counts, whose vertices lie inside the cell polygon and below 0.8 m, and which only cells with a biome floor and a metric
 * floor UV get inside `buildCellMesh`.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { basicCube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildCellMesh } from "../../src/render/three/buildCellMesh";
import { buildCellSceneryMesh } from "../../src/render/three/buildCellScenery";
import { computeSceneryLayout, sceneryTrianglesByKind } from "../../src/world-assets/sceneryLayout";
import { createFakePreparedAssets } from "../support/preparedAssets";

const world = compileCellComplex(basicCube);

describe("buildCellSceneryMesh", () => {
  it("builds one tagged mesh per cube face with exactly the layout's triangles", () => {
    for (const cell of world.cells) {
      const mesh = buildCellSceneryMesh(cell)!;
      const expected = computeSceneryLayout(cell).reduce((sum, prop) => sum + sceneryTrianglesByKind[prop.kind], 0);

      expect(mesh.name).toBe(`scenery:${cell.id}`);
      expect(mesh.userData).toEqual({ kind: "scenery", cellId: cell.id });
      expect(mesh.geometry.index).toBeNull();
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(["color", "normal", "position"]);
      expect(mesh.geometry.getAttribute("position").count).toBe(expected * 3);
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect((mesh.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    }
  });

  it("keeps vertices inside the cell and below 0.8 m, with unit normals", () => {
    for (const cell of world.cells) {
      const geometry = buildCellSceneryMesh(cell)!.geometry;
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");

      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const height = position.getY(index);
        const y = -position.getZ(index);

        expect(height).toBeGreaterThanOrEqual(0);
        expect(height).toBeLessThanOrEqual(0.8);
        for (const side of cell.sides) {
          expect((x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y).toBeGreaterThan(0);
        }
        expect(Math.hypot(normal.getX(index), normal.getY(index), normal.getZ(index))).toBeCloseTo(1, 4);
      }
    }
  });

  it("builds the same geometry twice", () => {
    const first = buildCellSceneryMesh(world.cells[0])!.geometry.getAttribute("position").array;
    const second = buildCellSceneryMesh(world.cells[0])!.geometry.getAttribute("position").array;

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("returns undefined for a cell without a biome floor", () => {
    expect(buildCellSceneryMesh({ ...world.cells[0], floorMaterial: { kind: "floor-color", floorColor: "#446688" } })).toBeUndefined();
  });
});

describe("buildCellMesh scenery", () => {
  const options = { debugLevel: "off" as const, portalPanelMode: "none" as const, eyeHeightMeters: 1.6, assets: createFakePreparedAssets() };

  it("adds the scenery mesh to the cell, unless the floor has a lattice frame", () => {
    const cell = world.cells[0];
    const plain = buildCellMesh(cell, options);
    const lattice = buildCellMesh(cell, {
      ...options,
      floorUvFrame: { origin: { x: 0, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, tilesAlongU: 1, tilesAlongV: 1, restU: { x: 1, y: 0 }, restV: { x: 0, y: 1 } },
    });

    expect(plain.getObjectByName(`scenery:${cell.id}`)).toBeDefined();
    expect(lattice.getObjectByName(`scenery:${cell.id}`)).toBeUndefined();
  });
});
