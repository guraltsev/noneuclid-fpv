/**
 * `tests/world-assets/landmarkLayout.test.ts` — unit tier.
 *
 * The landmark layout of a cell is deterministic, differs between cells, gives every cube face one major and some minor landmarks that keep every clearance
 * rule, stays within the triangle budget, never crosses a side of a triangular face, and has colliders, shadow casters and keep-out discs that fit it.
 */
import { describe, expect, it } from "vitest";
import { basicCube, basicTetrahedron } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../src/cell-complex/prismCells";
import {
  computeLandmarkLayout,
  landmarkClearances,
  landmarkFloatingParts,
  landmarkKeepOutDiscs,
  landmarkShadowCasters,
  landmarkTriangleCount,
  maxLandmarkTrianglesPerCell,
  type LandmarkPlacement,
} from "../../src/world-assets/landmarkLayout";
import { computeSceneryLayout } from "../../src/world-assets/sceneryLayout";

const cube = compileCellComplex(basicCube);
const tetrahedron = compileCellComplex(basicTetrahedron);
const start = cube.startingPosition;

function contextFor(world: typeof cube, cell: CompiledPrismCell) {
  const at = world.startingPosition;
  return { startPosition: at && at.cellId === cell.id ? { x: at.position.x, y: at.position.y } : undefined };
}

const majorKinds = new Set(["arcade", "tower", "stilt-form", "floating-boulders", "great-sphere", "pebble-stack", "needle", "wire-mobile", "colonnade", "ruin-arch"]);

function distanceToSide(cell: CompiledPrismCell, x: number, y: number, side: number): number {
  const s = cell.sides[side];
  return (x - s.start.x) * s.inwardNormal.x + (y - s.start.y) * s.inwardNormal.y;
}

describe("computeLandmarkLayout on the basic cube", () => {
  it("is deterministic and differs between cell ids", () => {
    for (const cell of cube.cells) {
      expect(computeLandmarkLayout(cell, contextFor(cube, cell))).toEqual(computeLandmarkLayout(cell, contextFor(cube, cell)));
    }

    const [first] = cube.cells;
    expect(computeLandmarkLayout({ ...first, id: `${first.id}-other` })).not.toEqual(computeLandmarkLayout(first));
  });

  it("gives every face exactly one major and at least one minor landmark", () => {
    for (const cell of cube.cells) {
      const placements = computeLandmarkLayout(cell, contextFor(cube, cell));
      const majors = placements.filter((placement) => majorKinds.has(placement.kind));

      expect(majors).toHaveLength(1);
      expect(placements.length - 1).toBeGreaterThanOrEqual(1);
      expect(placements.length - 1).toBeLessThanOrEqual(4);
    }
  });

  it("keeps every clearance rule and stays inside the triangle budget", () => {
    for (const cell of cube.cells) {
      const placements = computeLandmarkLayout(cell, contextFor(cube, cell));
      let triangles = 0;

      placements.forEach((placement, index) => {
        const rules = majorKinds.has(placement.kind) ? landmarkClearances.major : landmarkClearances.minor;
        const radius = placement.footprintRadiusMeters;
        triangles += landmarkTriangleCount(placement.kind, placement.variant);

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

  it("gives majors 6 to 11 m except the great sphere, and minors 1.4 to 4.2 m", () => {
    for (const cell of cube.cells) {
      for (const placement of computeLandmarkLayout(cell, contextFor(cube, cell))) {
        if (majorKinds.has(placement.kind)) {
          expect(placement.heightMeters).toBeLessThanOrEqual(11.5);
          expect(placement.heightMeters).toBeGreaterThanOrEqual(placement.kind === "great-sphere" ? 3.5 : 5);
        } else {
          expect(placement.heightMeters).toBeGreaterThanOrEqual(1.4);
          expect(placement.heightMeters).toBeLessThanOrEqual(4.2);
        }
      }
    }
  });

  it("puts every collider inside its footprint, with thin ones at 0.12 m", () => {
    for (const cell of cube.cells) {
      for (const placement of computeLandmarkLayout(cell, contextFor(cube, cell))) {
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
  const variants: [LandmarkPlacement["kind"], number][] = [["floating-boulders", 4], ["small-floater", 0], ["arcade", 4]];

  it("gives hovering boulders a caster at the point below them with their top height", () => {
    const placement = (kind: LandmarkPlacement["kind"], variant: number): LandmarkPlacement => ({
      kind,
      variant,
      x: 1,
      y: 2,
      yawRadians: 0.5,
      scale: 1,
      seed: 77,
      footprintRadiusMeters: 5,
      heightMeters: 8,
      colliders: [],
    });

    for (const [kind, variant] of variants.slice(0, 2)) {
      const placements = [placement(kind, variant)];
      const parts = landmarkFloatingParts(placements[0]);
      const casters = landmarkShadowCasters(placements);

      expect(parts.length).toBe(kind === "floating-boulders" ? variant : 1);
      expect(casters).toHaveLength(parts.length);
      casters.forEach((caster, index) => {
        expect(caster).toEqual({ x: parts[index].x, y: parts[index].y, radiusMeters: parts[index].radiusMeters, heightMeters: parts[index].topMeters });
        expect(caster.heightMeters).toBeGreaterThan(2);
      });
    }
  });

  it("gives one caster per collider and a keep-out disc 0.4 m wider than it", () => {
    for (const cell of cube.cells) {
      const placements = computeLandmarkLayout(cell, contextFor(cube, cell));
      const colliders = placements.flatMap((placement) => placement.colliders);
      const discs = landmarkKeepOutDiscs(placements);
      const casters = landmarkShadowCasters(placements);

      expect(discs).toHaveLength(colliders.length);
      discs.forEach((disc, index) => expect(disc.radius).toBeCloseTo(colliders[index].radiusMeters + 0.4));
      expect(casters.length).toBeGreaterThanOrEqual(colliders.length);
    }
  });

  it("keeps scenery out of the keep-out discs", () => {
    const [cell] = cube.cells;
    const discs = landmarkKeepOutDiscs(computeLandmarkLayout(cell, contextFor(cube, cell)));

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
      for (const placement of computeLandmarkLayout(cell, contextFor(tetrahedron, cell))) {
        cell.sides.forEach((_, side) => expect(distanceToSide(cell, placement.x, placement.y, side)).toBeGreaterThanOrEqual(placement.footprintRadiusMeters));
      }
    }
  });

  it("gives no landmarks to a cell without a biome floor", () => {
    const [cell] = cube.cells;
    const plain = { ...cell, floorMaterial: { kind: "color" as const, floorColor: "#888888" } } as unknown as CompiledPrismCell;
    expect(computeLandmarkLayout(plain)).toEqual([]);
    expect(computeLandmarkLayout({ ...cell, floorMaterial: { kind: "floor-texture", name: "wood_floor", floorColor: "#888", tileSizeMeters: 4 } })).toEqual([]);
  });

  it.each(["gravelly_sand", "red_mud_stones", "grass1", "river_pebbles", "forest_leaves", "snow"])("places a major landmark on %s in a large cell", (name) => {
    const [cell] = cube.cells;
    const placements = computeLandmarkLayout({ ...cell, objects: [], floorMaterial: { kind: "floor-texture", name, floorColor: "#888", tileSizeMeters: 4 } });
    expect(placements.filter((placement) => majorKinds.has(placement.kind))).toHaveLength(1);
  });
});
