/**
 * `tests/world-assets/sceneryLayout.test.ts` — unit tier.
 *
 * The scenery layout of a cell is deterministic, differs between cell ids, keeps clear of sides, vertices and authored objects,
 * stays within the triangle budget, and exists only for biome floor textures (design 018 section 4.2).
 */
import { describe, expect, it } from "vitest";
import { basicCube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../src/cell-complex/prismCells";
import {
  computeSceneryLayout,
  maxSceneryTrianglesPerCell,
  sceneryBiomeForFloor,
  sceneryPropRadiusMeters,
  sceneryTrianglesByKind,
} from "../../src/world-assets/sceneryLayout";

const world = compileCellComplex(basicCube);

function withFloor(cell: CompiledPrismCell, name: string): CompiledPrismCell {
  return { ...cell, floorMaterial: { kind: "floor-texture", name, floorColor: "#888888", tileSizeMeters: 4 } };
}

describe("sceneryBiomeForFloor", () => {
  it("maps the six biome textures and nothing else", () => {
    expect(["grass1", "forest_leaves", "river_pebbles", "gravelly_sand", "red_mud_stones", "snow"].map(sceneryBiomeForFloor)).toEqual([
      "grass",
      "forest",
      "river",
      "sand",
      "mud",
      "snow",
    ]);
    expect(sceneryBiomeForFloor("wood_floor")).toBeUndefined();
    expect(sceneryBiomeForFloor(undefined)).toBeUndefined();
  });
});

describe("computeSceneryLayout on the basic cube", () => {
  it("is deterministic and differs between cell ids", () => {
    for (const cell of world.cells) {
      expect(computeSceneryLayout(cell)).toEqual(computeSceneryLayout(cell));
    }

    const [first] = world.cells;
    const renamed = { ...first, id: `${first.id}-other` };
    expect(computeSceneryLayout(renamed)).not.toEqual(computeSceneryLayout(first));
  });

  it("gives every face a plausible number of props within the triangle budget", () => {
    for (const cell of world.cells) {
      const props = computeSceneryLayout(cell);
      const triangles = props.reduce((sum, prop) => sum + sceneryTrianglesByKind[prop.kind], 0);

      expect(props.length).toBeGreaterThan(60);
      expect(props.length).toBeLessThan(400);
      expect(triangles).toBeLessThanOrEqual(maxSceneryTrianglesPerCell);
    }
  });

  it("keeps every prop clear of the sides, the vertices and the authored objects", () => {
    for (const cell of world.cells) {
      for (const prop of computeSceneryLayout(cell)) {
        const radius = sceneryPropRadiusMeters * prop.scale;

        for (const side of cell.sides) {
          const distance = (prop.x - side.start.x) * side.inwardNormal.x + (prop.y - side.start.y) * side.inwardNormal.y;
          expect(distance).toBeGreaterThanOrEqual(0.35 + radius - 1e-9);
        }
        for (const vertex of cell.baseVertices) {
          expect(Math.hypot(prop.x - vertex.x, prop.y - vertex.y)).toBeGreaterThanOrEqual(1 + radius - 1e-9);
        }
        for (const object of cell.objects) {
          const objectRadius = (object.kind === "asset" ? object.collision?.radius : object.collision.radius) ?? 0.35;
          expect(Math.hypot(prop.x - object.position.x, prop.y - object.position.y)).toBeGreaterThanOrEqual(objectRadius + 0.5 + radius - 1e-9);
        }
      }
    }
  });

  it("gives each cell one or two features: tight groups of one kind of prop", () => {
    for (const cell of world.cells) {
      const featuresOnly = computeSceneryLayout(cell, { densityScale: 0 });
      const kinds = new Set(featuresOnly.map((prop) => prop.kind));

      expect(featuresOnly.length).toBeGreaterThanOrEqual(6);
      expect(featuresOnly.length).toBeLessThanOrEqual(32);
      expect(kinds.size).toBeLessThanOrEqual(2);
    }
  });

  it("trims to the budget, ordinary props first", () => {
    const props = computeSceneryLayout(withFloor(world.cells[0], "grass1"), { densityScale: 4, spacingMeters: 0.4 });
    const triangles = props.reduce((sum, prop) => sum + sceneryTrianglesByKind[prop.kind], 0);

    expect(triangles).toBeLessThanOrEqual(maxSceneryTrianglesPerCell);
    expect(triangles).toBeGreaterThan(maxSceneryTrianglesPerCell - 12);
  });

  it("returns nothing for a floor without a biome or without a texture", () => {
    expect(computeSceneryLayout(withFloor(world.cells[0], "paving_stones"))).toEqual([]);
    expect(computeSceneryLayout({ ...world.cells[0], floorMaterial: { kind: "floor-color", floorColor: "#446688" } })).toEqual([]);
  });
});

describe("computeSceneryLayout next to a neighbouring biome", () => {
  const grass = withFloor(world.cells[0], "grass1");
  const dense = { densityScale: 4, spacingMeters: 0.5, neighbourBiomeBySideIndex: new Map([[0, "snow" as const]]), neighbourBlendHalfWidthMeters: 2 };
  const snowKinds = new Set(["snow-mound", "ice-crystal", "twig"]);
  const distanceToSide0 = (prop: { readonly x: number; readonly y: number }) => {
    const side = grass.sides[0];
    return (prop.x - side.start.x) * side.inwardNormal.x + (prop.y - side.start.y) * side.inwardNormal.y;
  };

  it("draws near the side from the neighbour's list and far from it only from its own", () => {
    const props = computeSceneryLayout(grass, dense);
    const near = props.filter((prop) => distanceToSide0(prop) < 1);
    const far = props.filter((prop) => distanceToSide0(prop) >= 2);

    expect(near.length).toBeGreaterThan(5);
    expect(near.some((prop) => snowKinds.has(prop.kind))).toBe(true);
    expect(near.some((prop) => !snowKinds.has(prop.kind))).toBe(true);
    expect(far.length).toBeGreaterThan(5);
    expect(far.every((prop) => !snowKinds.has(prop.kind))).toBe(true);
  });

  it("is deterministic and leaves the layout alone without neighbours", () => {
    expect(computeSceneryLayout(grass, dense)).toEqual(computeSceneryLayout(grass, dense));
    expect(computeSceneryLayout(grass, { ...dense, neighbourBiomeBySideIndex: new Map() })).toEqual(computeSceneryLayout(grass, { ...dense, neighbourBiomeBySideIndex: undefined }));
    // The same positions either way (below the triangle budget): only the kinds change.
    const sparse = { neighbourBiomeBySideIndex: dense.neighbourBiomeBySideIndex };
    expect(computeSceneryLayout(grass, sparse).map((prop) => [prop.x, prop.y])).toEqual(computeSceneryLayout(grass).map((prop) => [prop.x, prop.y]));
  });
});
