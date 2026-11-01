/**
 * The player's rover at a portal side (src/render/three/runtimeObjectGhostRecords.ts, playerRoverModel.ts), on the real tetrahedron world and the real rover
 * model bounds. The bug this pins: standing 7 cm from a portal side, the rover is drawn cut off along that side with nothing on its far side. The rover's
 * drawn centre is offset from its origin (the model is not centred on the player), so for some yaws that centre lies across the portal side, outside the
 * rover's own cell, and the developed disk, which assumes a centre inside its start cell, then found no cell beyond the side and made no ghost.
 * The pose is the one the maintainer reproduced it at (face-c, 9.96735, 6.593276, yaw -58.12 degrees); the numbers are in tests.md terms a reproduction, not a tolerance.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { tetrahedron } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createPlayerRoverRenderModel, playerRoverAssetPath } from "../../src/render/three/playerRoverModel";
import {
  collectPortalGhostRuntimeObjectRenderRecords,
  explainPortalGhosts,
} from "../../src/render/three/runtimeObjectGhostRecords";
import { collectRuntimeObjectRenderSourceMeshes, computeRenderSourceFootprint } from "../../src/render/three/runtimeObjectRenderRecords";
import { createFakePreparedAssets } from "../support/preparedAssets";
import { readGlbBounds } from "../support/glbBounds";

const world = compileCellComplex(tetrahedron);

// The real rover.glb box in a stand-in scene, placed by the real rover model (scale and half turn), so the footprint is the one the app measures.
function realRoverModel() {
  const bounds = readGlbBounds(new URL(`../../public/assets/${playerRoverAssetPath}`, import.meta.url));
  const size = bounds.max.map((max, axis) => max - bounds.min[axis]);
  const centre = bounds.max.map((max, axis) => (max + bounds.min[axis]) / 2);
  const assets = createFakePreparedAssets({
    instantiateGltf: () => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]).translate(centre[0], centre[1], centre[2]), new THREE.MeshBasicMaterial()));
      return { scene, animations: [] };
    },
  });
  const model = createPlayerRoverRenderModel(assets)!;
  const footprint = computeRenderSourceFootprint(model.collectSources())!;
  return { model, footprint, keys: model.collectSources().map((source) => source.archetypeKey) };
}

const degrees = (value: number): number => (value * Math.PI) / 180;

describe("the player's rover standing 7 cm from a portal side of the tetrahedron", () => {
  const { model, footprint, keys } = realRoverModel();
  // face-c, 7.4 cm below its top side (y = 6.667), which is glued to face-a; the vertex at the side's end is 1.6 m away.
  const pose = (yawDegrees: number) =>
    model.placement({ cellId: "face-c", position: { x: 9.96735, y: 6.593276, z: 0 }, yawRadians: degrees(yawDegrees), pitchRadians: 0 });
  const ghostCells = (yawDegrees: number) =>
    collectPortalGhostRuntimeObjectRenderRecords({ world, object: pose(yawDegrees), archetypeKeys: keys, renderFootprint: footprint }).map((record) => record.cellId);

  it("has a drawn centre that is offset from its origin, and a disk reaching far past the side", () => {
    expect(Math.hypot(footprint.center.x, footprint.center.y)).toBeGreaterThan(0.1);
    expect(footprint.radiusMeters).toBeGreaterThan(0.9);
  });

  it("is drawn in face-a too, at the pose where the cut was seen", () => {
    expect(ghostCells(-58.120558)).toContain("face-a");
  });

  it("makes that one ghost and no other: the drawn disk reaches only face-a", () => {
    expect(ghostCells(-58.120558)).toEqual(["face-a"]);
  });

  it("explains that copy as a ghost in face-a reached through the side", () => {
    const explained = explainPortalGhosts({ world, object: pose(-58.120558), archetypeKeys: keys, renderFootprint: footprint })!;

    expect(explained.copies.some((copy) => copy.cellId === "face-a" && copy.outcome === "ghost")).toBe(true);
  });

  it("is drawn in face-a for every heading, whichever way the drawn centre points", () => {
    const missing: number[] = [];

    for (let yaw = -180; yaw < 180; yaw += 5) {
      if (!ghostCells(yaw).includes("face-a")) {
        missing.push(yaw);
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("the measured rover footprint", () => {
  it("is built from the real model (a stand-in for it would not reproduce the offset)", () => {
    const { footprint } = realRoverModel();

    expect(footprint.radiusMeters).toBeCloseTo(0.9628, 3);
    expect(footprint.center.y).toBeCloseTo(0.146, 3);
    expect(collectRuntimeObjectRenderSourceMeshes).toBeDefined();
  });
});
