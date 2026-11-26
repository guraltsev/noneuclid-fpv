/**
 * `tests/render/buildCellLandmarks.test.ts` — unit tier.
 *
 * The landmark mesh of a cell is one non-indexed vertex-coloured geometry whose triangle count is the sum of the shape table, whose vertices lie inside the
 * cell and between the ground and 12 m, with unit normals, identical when built twice, and with the baked light making faces turned to the light brighter.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { basicCube } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import {
  bakeLandmarkLight,
  buildCellLandmarksMesh,
  landmarkShadeFloor,
  landmarkToLight,
} from "../../src/render/three/buildCellLandmarks";
import { buildCellMesh } from "../../src/render/three/buildCellMesh";
import { computeCellShadowAzimuths } from "../../src/cell-complex/cellSun";
import { computeLandmarkLayout, landmarkTriangleCount, type LandmarkPlacement } from "../../src/world-assets/landmarkLayout";
import { colonnadeVariantFor, landmarkShape, type LandmarkKind } from "../../src/world-assets/landmarkShapes";
import { computeWorldDressing } from "../../src/world-assets/worldDressing";
import { createFakePreparedAssets } from "../support/preparedAssets";

const world = compileCellComplex(basicCube);
const azimuth = 2.2;

function placementFor(kind: LandmarkKind, variant: number, seed = 5): LandmarkPlacement {
  const shape = landmarkShape(kind, variant, seed);
  return { kind, variant, x: 0, y: 0, yawRadians: 0.3, scale: 1, seed, footprintRadiusMeters: shape.footprintRadiusMeters, heightMeters: shape.heightMeters, colliders: [] };
}

const allKinds: [LandmarkKind, number[]][] = [
  ["arcade", [3, 4, 5]],
  ["tower", [0]],
  ["plinth", [0, 1, 2]],
  ["lone-arch", [0]],
  ["stilt-form", [0]],
  ["crutch-slab", [0]],
  ["obelisk", [0]],
  ["soft-disc", [0]],
  ["floating-boulders", [3, 4, 5]],
  ["great-sphere", [0]],
  ["door-frame", [0]],
  ["small-floater", [0]],
  ["pebble-stack", [5, 6, 7, 8]],
  ["needle", [0]],
  ["bone-form", [2, 3]],
  ["pebble-pair", [0]],
  ["wire-mobile", [3, 4, 5]],
  ["disc-stalk", [0, 1]],
  ["blob", [0]],
  ["colonnade", [colonnadeVariantFor(4, 9), colonnadeVariantFor(5, 9), colonnadeVariantFor(6, 11)]],
  ["ruin-arch", [0]],
  ["broken-column", [0]],
  ["ice-spire", [0]],
];

describe("buildCellLandmarksMesh", () => {
  it("emits the table's triangles for every kind, inside its footprint", () => {
    for (const [kind, variants] of allKinds) {
      for (const variant of variants) {
        const placement = placementFor(kind, variant);
        const mesh = buildCellLandmarksMesh("c", [placement], azimuth)!;
        const position = mesh.geometry.getAttribute("position");
        const normal = mesh.geometry.getAttribute("normal");
        const label = `${kind}/${variant}`;

        expect([label, position.count / 3]).toEqual([label, landmarkTriangleCount(kind, variant)]);

        for (let index = 0; index < position.count; index += 1) {
          const x = position.getX(index);
          const y = -position.getZ(index);
          const height = position.getY(index);
          expect(height, label).toBeGreaterThanOrEqual(-0.01);
          expect(height, label).toBeLessThanOrEqual(placement.heightMeters + 0.05);
          expect(Math.hypot(x, y), label).toBeLessThanOrEqual(placement.footprintRadiusMeters + 0.05);
          expect(Math.hypot(normal.getX(index), normal.getY(index), normal.getZ(index)), label).toBeCloseTo(1, 4);
        }
      }
    }
  });

  it("builds one tagged mesh per cube face from the world dressing, inside the cell polygon", () => {
    const dressing = computeWorldDressing(world);

    for (const cell of world.cells) {
      const placements = dressing.landmarksByCellId.get(cell.id)!;
      const mesh = buildCellLandmarksMesh(cell.id, placements, dressing.shadowAzimuthByCellId.get(cell.id)!)!;
      const position = mesh.geometry.getAttribute("position");

      expect(mesh.name).toBe(`landmarks:${cell.id}`);
      expect(mesh.userData).toEqual({ kind: "landmark", cellId: cell.id });
      expect(mesh.geometry.index).toBeNull();
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(["color", "normal", "position"]);
      expect(position.count).toBe(placements.reduce((sum, placement) => sum + landmarkTriangleCount(placement.kind, placement.variant), 0) * 3);
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect((mesh.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);

      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const y = -position.getZ(index);
        expect(position.getY(index)).toBeGreaterThanOrEqual(-0.01);
        expect(position.getY(index)).toBeLessThanOrEqual(12);
        for (const side of cell.sides) {
          expect((x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y).toBeGreaterThan(0);
        }
      }
    }
  });

  it("builds the same geometry twice and returns nothing for no placements", () => {
    const placements = computeLandmarkLayout(world.cells[0]);
    const first = buildCellLandmarksMesh("c", placements, azimuth)!.geometry;
    const second = buildCellLandmarksMesh("c", placements, azimuth)!.geometry;

    for (const name of ["position", "normal", "color"]) {
      expect(Array.from(first.getAttribute(name).array)).toEqual(Array.from(second.getAttribute(name).array));
    }
    expect(buildCellLandmarksMesh("c", [], azimuth)).toBeUndefined();
  });

  it("bakes the light: faces turned to the light are brighter than faces turned away", () => {
    const toLight = landmarkToLight(azimuth);
    const lit = bakeLandmarkLight(new THREE.Color(1, 1, 1), toLight.clone(), toLight);
    const away = bakeLandmarkLight(new THREE.Color(1, 1, 1), new THREE.Vector3(-toLight.x, -toLight.y, 0).normalize(), toLight);
    const under = bakeLandmarkLight(new THREE.Color(1, 1, 1), new THREE.Vector3(0, 0, -1), toLight);

    expect(lit.g).toBeGreaterThan(0.99);
    expect(away.g).toBeCloseTo(landmarkShadeFloor);
    expect(away.b).toBeGreaterThan(away.r);
    expect(under.g).toBeLessThan(away.g);
  });

  it("makes the lit side of a tower brighter than its shaded side in the mesh", () => {
    const mesh = buildCellLandmarksMesh("c", [{ ...placementFor("obelisk", 0), yawRadians: 0 }], azimuth)!;
    const normal = mesh.geometry.getAttribute("normal");
    const color = mesh.geometry.getAttribute("color");
    const toLight = landmarkToLight(azimuth);
    let litSum = 0;
    let litCount = 0;
    let darkSum = 0;
    let darkCount = 0;

    for (let triangle = 0; triangle < normal.count / 3; triangle += 1) {
      const index = triangle * 3;
      const along = normal.getX(index) * toLight.x + -normal.getZ(index) * toLight.y + normal.getY(index) * toLight.z;

      if (along > 0.4) {
        litSum += color.getY(index);
        litCount += 1;
      } else if (along < 0) {
        darkSum += color.getY(index);
        darkCount += 1;
      }
    }

    expect(litCount).toBeGreaterThan(0);
    expect(darkCount).toBeGreaterThan(0);
    expect(litSum / litCount).toBeGreaterThan(darkSum / darkCount);
  });

  it("adds the landmark mesh to a cube cell mesh given the dressing", () => {
    const cell = world.cells[0];
    const group = buildCellMesh(cell, { debugLevel: "off", portalPanelMode: "none", eyeHeightMeters: 1.6, assets: createFakePreparedAssets(), world, dressing: computeWorldDressing(world) });
    expect(group.children.some((child) => child.userData.kind === "landmark")).toBe(true);
    expect(computeCellShadowAzimuths(world).size).toBe(6);
  });
});
