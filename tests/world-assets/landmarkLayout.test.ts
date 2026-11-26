/**
 * `tests/world-assets/landmarkLayout.test.ts` — unit tier.
 *
 * The landmark layout of a themed cell is deterministic, gives every cube face one major landmark and some minors and props from its own theme,
 * keeps every clearance rule, stays within the triangle budget, never crosses a side of a triangular face, and has colliders, shadow casters and
 * keep-out discs that fit it. A cell without a look gets nothing.
 */
import { describe, expect, it } from "vitest";
import { basicCube, basicTetrahedron } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../src/cell-complex/prismCells";
import { buildFacePalette } from "../../src/world-assets/facePalettes";
import { assignFaceLooks } from "../../src/world-assets/faceThemeAssignment";
import { faceThemes } from "../../src/world-assets/faceThemes";
import {
  computeLandmarkLayout,
  landmarkClearances,
  landmarkKeepOutDiscs,
  landmarkShadowCasters,
  maxLandmarkTrianglesPerCell,
  type LandmarkPlacement,
} from "../../src/world-assets/landmarkLayout";
import { partsTriangleCount } from "../../src/world-assets/landmarkParts";
import { computeSceneryLayout } from "../../src/world-assets/sceneryLayout";

const cube = compileCellComplex(basicCube);
const tetrahedron = compileCellComplex(basicTetrahedron);
const cubeLooks = assignFaceLooks(cube);
const tetrahedronLooks = assignFaceLooks(tetrahedron);
const start = cube.startingPosition;

function contextFor(world: typeof cube, looks: typeof cubeLooks, cell: CompiledPrismCell) {
  const at = world.startingPosition;
  return { startPosition: at && at.cellId === cell.id ? { x: at.position.x, y: at.position.y } : undefined, look: looks.get(cell.id) };
}

function distanceToSide(cell: CompiledPrismCell, x: number, y: number, side: number): number {
  const s = cell.sides[side];
  return (x - s.start.x) * s.inwardNormal.x + (y - s.start.y) * s.inwardNormal.y;
}

const layouts = new Map(cube.cells.map((cell) => [cell.id, computeLandmarkLayout(cell, contextFor(cube, cubeLooks, cell))]));

describe("computeLandmarkLayout on the basic cube", () => {
  it("is deterministic, and every landmark comes from the face's theme", () => {
    for (const cell of cube.cells) {
      expect(computeLandmarkLayout(cell, contextFor(cube, cubeLooks, cell))).toEqual(layouts.get(cell.id));
      for (const placement of layouts.get(cell.id)!) {
        expect(placement.themeId).toBe(cubeLooks.get(cell.id)!.theme.id);
        expect(placement.triangles).toBe(partsTriangleCount(placement.parts));
      }
    }
  });

  it("gives every face exactly one major and at least two minors or props", () => {
    for (const cell of cube.cells) {
      const placements = layouts.get(cell.id)!;
      expect(placements.filter((placement) => placement.role === "major")).toHaveLength(1);
      expect(placements.filter((placement) => placement.role !== "major").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps every clearance rule and stays inside the triangle budget", () => {
    for (const cell of cube.cells) {
      const placements = layouts.get(cell.id)!;
      let triangles = 0;

      placements.forEach((placement, index) => {
        const rules = landmarkClearances[placement.role];
        const radius = placement.footprintRadiusMeters;
        triangles += placement.triangles;

        cell.sides.forEach((_, side) => expect(distanceToSide(cell, placement.x, placement.y, side)).toBeGreaterThanOrEqual(radius + rules.side - 1e-9));
        for (const vertex of cell.baseVertices) {
          expect(Math.hypot(placement.x - vertex.x, placement.y - vertex.y)).toBeGreaterThanOrEqual(rules.vertex);
        }
        for (const object of cell.objects) {
          const objectRadius = (object.kind === "asset" ? object.collision?.radius : object.collision.radius) ?? 0.5;
          expect(Math.hypot(placement.x - object.position.x, placement.y - object.position.y)).toBeGreaterThanOrEqual(objectRadius + radius + rules.object - 1e-9);
        }
        if (start && start.cellId === cell.id) {
          expect(Math.hypot(placement.x - start.position.x, placement.y - start.position.y)).toBeGreaterThanOrEqual(radius + rules.start - 1e-9);
        }
        for (const other of placements.slice(index + 1)) {
          expect(Math.hypot(placement.x - other.x, placement.y - other.y)).toBeGreaterThanOrEqual(radius + other.footprintRadiusMeters + landmarkClearances.between - 1e-9);
        }
      });

      expect(triangles).toBeLessThanOrEqual(maxLandmarkTrianglesPerCell);
    }
  });

  it("puts every collider inside its footprint, at least 0.12 m wide", () => {
    for (const placements of layouts.values()) {
      for (const placement of placements) {
        for (const collider of placement.colliders) {
          expect(Math.hypot(collider.x - placement.x, collider.y - placement.y) + collider.radiusMeters).toBeLessThanOrEqual(placement.footprintRadiusMeters + 1e-9);
          expect(collider.radiusMeters).toBeGreaterThanOrEqual(0.12);
          expect(collider.heightMeters).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("landmark shadow casters and keep-out discs", () => {
  it("casts one shadow per collider and hovering part; keep-outs are 0.4 m wider", () => {
    for (const placements of layouts.values()) {
      const colliders = placements.flatMap((placement) => placement.colliders);
      const floating = placements.flatMap((placement) => placement.floating);
      const discs = landmarkKeepOutDiscs(placements);
      const casters = landmarkShadowCasters(placements);

      expect(discs).toHaveLength(colliders.length);
      discs.forEach((disc, index) => expect(disc.radius).toBeCloseTo(colliders[index].radiusMeters + 0.4));
      expect(casters).toHaveLength(colliders.length + floating.length);
    }
  });

  it("gives a hovering part a caster at the point below it with its top height", () => {
    const placement: LandmarkPlacement = {
      themeId: "orbits",
      kind: "test",
      role: "minor",
      x: 1,
      y: 2,
      yawRadians: 0,
      scale: 1,
      seed: 1,
      parts: [],
      triangles: 0,
      footprintRadiusMeters: 1,
      heightMeters: 3,
      colliders: [],
      floating: [{ x: 1.5, y: 2, radiusMeters: 0.5, topMeters: 3 }],
    };
    expect(landmarkShadowCasters([placement])).toEqual([{ x: 1.5, y: 2, radiusMeters: 0.5, heightMeters: 3 }]);
  });

  it("keeps scenery out of the keep-out discs", () => {
    const [cell] = cube.cells;
    const discs = landmarkKeepOutDiscs(layouts.get(cell.id)!);

    expect(discs.length).toBeGreaterThan(0);
    for (const prop of computeSceneryLayout(cell, { keepOutDiscs: discs })) {
      for (const disc of discs) {
        expect(Math.hypot(prop.x - disc.x, prop.y - disc.y)).toBeGreaterThanOrEqual(disc.radius);
      }
    }
  });
});

describe("computeLandmarkLayout on other cells", () => {
  it("never lets a landmark cross a side of a triangular face", () => {
    for (const cell of tetrahedron.cells) {
      for (const placement of computeLandmarkLayout(cell, contextFor(tetrahedron, tetrahedronLooks, cell))) {
        cell.sides.forEach((_, side) => expect(distanceToSide(cell, placement.x, placement.y, side)).toBeGreaterThanOrEqual(placement.footprintRadiusMeters));
      }
    }
  });

  it("gives no landmarks to a cell without a look", () => {
    expect(computeLandmarkLayout(cube.cells[0])).toEqual([]);
  });

  it.each(faceThemes.map((theme) => theme.id))("places a major landmark of %s on an empty cube face", (id) => {
    const [cell] = cube.cells;
    const theme = faceThemes.find((entry) => entry.id === id)!;
    const placements = computeLandmarkLayout({ ...cell, objects: [] }, { look: { theme, palette: buildFacePalette(200, "tonal") } });
    expect(placements.filter((placement) => placement.role === "major")).toHaveLength(1);
  });
});
