/**
 * `tests/render/buildCellLandmarks.test.ts` — unit tier.
 *
 * The landmark mesh of a cell is one non-indexed vertex-coloured geometry with exactly the triangles of its placements' parts, whose vertices lie inside
 * the cell and between the ground and 12 m, with unit normals, identical when built twice, with the baked light making faces turned to the light
 * brighter and glowing parts at full colour.
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
import { computeLandmarkLayout, type LandmarkPlacement } from "../../src/world-assets/landmarkLayout";
import { buildFacePalette } from "../../src/world-assets/facePalettes";
import { faceThemes } from "../../src/world-assets/faceThemes";
import { measureParts, type LandmarkPart } from "../../src/world-assets/landmarkParts";
import { createSeededRandom } from "../../src/world-assets/seededNoise";
import { computeWorldDressing } from "../../src/world-assets/worldDressing";
import { createFakePreparedAssets } from "../support/preparedAssets";

const world = compileCellComplex(basicCube);
const azimuth = 2.2;
const palette = buildFacePalette(30, "complementary");

function placementOf(parts: readonly LandmarkPart[], kind = "test", yawRadians = 0.3): LandmarkPlacement {
  const measure = measureParts(parts);
  return {
    themeId: "test",
    kind,
    role: "major",
    x: 0,
    y: 0,
    yawRadians,
    scale: 1,
    seed: 5,
    parts,
    triangles: measure.triangles,
    footprintRadiusMeters: measure.footprintRadiusMeters,
    heightMeters: measure.heightMeters,
    colliders: [],
    floating: [],
  };
}

describe("buildCellLandmarksMesh", () => {
  it("draws every generator's triangles inside its footprint, with unit normals", () => {
    for (const theme of faceThemes) {
      for (const generator of [...theme.major, ...theme.minor, ...theme.prop]) {
        const placement = placementOf(generator.build({ random: createSeededRandom(7), palette }), generator.name);
        const mesh = buildCellLandmarksMesh("c", [placement], azimuth)!;
        const position = mesh.geometry.getAttribute("position");
        const normal = mesh.geometry.getAttribute("normal");
        const label = `${theme.id}/${generator.name}`;

        expect([label, position.count / 3]).toEqual([label, placement.triangles]);

        for (let index = 0; index < position.count; index += 1) {
          const x = position.getX(index);
          const y = -position.getZ(index);
          // Legs, posts and tilted shards may sink a little into the ground (the floor hides it), never far.
          expect(position.getY(index), label).toBeGreaterThanOrEqual(-0.5);
          expect(position.getY(index), label).toBeLessThanOrEqual(placement.heightMeters + 0.05);
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
      expect(position.count).toBe(placements.reduce((sum, placement) => sum + placement.triangles, 0) * 3);
      expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect((mesh.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);

      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const y = -position.getZ(index);
        expect(position.getY(index)).toBeGreaterThanOrEqual(-0.5);
        expect(position.getY(index)).toBeLessThanOrEqual(12);
        for (const side of cell.sides) {
          expect((x - side.start.x) * side.inwardNormal.x + (y - side.start.y) * side.inwardNormal.y).toBeGreaterThan(0);
        }
      }
    }
  });

  it("builds the same geometry twice and returns nothing for no placements", () => {
    const dressing = computeWorldDressing(world);
    const placements = computeLandmarkLayout(world.cells[0], { look: dressing.lookByCellId.get(world.cells[0].id) });
    expect(placements.length).toBeGreaterThan(0);
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
    const mesh = buildCellLandmarksMesh("c", [placementOf([{ shape: "prism", at: [0, 0, 0], sides: 8, r0: 0.8, r1: 0.6, h: 7, color: "#cccccc" }], "obelisk", 0)], azimuth)!;
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

  it("draws glowing parts at their full colour, without the baked light", () => {
    const mesh = buildCellLandmarksMesh("c", [placementOf([{ shape: "box", at: [0, 0, 1], sx: 1, sy: 1, sz: 1, color: "#ffffff", glow: true }])], azimuth)!;
    const color = mesh.geometry.getAttribute("color");
    for (let index = 0; index < color.count; index += 1) {
      expect(color.getX(index)).toBeCloseTo(1, 6);
    }
  });

  it("adds the landmark mesh to a cube cell mesh given the dressing", () => {
    const cell = world.cells[0];
    const group = buildCellMesh(cell, { debugLevel: "off", portalPanelMode: "none", eyeHeightMeters: 1.6, assets: createFakePreparedAssets(), world, dressing: computeWorldDressing(world) });
    expect(group.children.some((child) => child.userData.kind === "landmark")).toBe(true);
    expect(computeCellShadowAzimuths(world).size).toBe(6);
  });
});
