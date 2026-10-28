import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { createPlayerRoverRenderModel } from "../../src/render/three/playerRoverModel";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

describe("player rover render model", () => {
  it("does not emit clone-adjacent ghost records when the player body touches a portal side", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const model = createPlayerRoverRenderModel(stubAssets());
    expect(model).toBeDefined();

    const archetypeKeys = model!.collectSources().map((source) => source.archetypeKey);
    const records = model!.collectRecords(
      {
        cellId: "room-a",
        position: { x: 0.95, y: 0, z: 0 },
        yawRadians: 0,
        pitchRadians: 0,
      },
      archetypeKeys,
      {
        ghostWorld: world,
        collision: simpleCollisionCylinder(0.1, 1, { x: 0, y: 0, z: 0.5 }),
      },
    );

    expect(records.map((record) => record.cellId)).toEqual(["room-a"]);
    expect(records[0]?.omitRootVisiblePath).toBe(true);
    expect(records[0]?.objectId).toBe("user-robot");
    expect(records[0]?.suppressWithinCameraDistanceMeters).toBe(2);
  });
});

function stubAssets(): PreparedWorldAssets {
  return {
    getTexture() {
      return undefined;
    },
    getConfiguredTexture() {
      return undefined;
    },
    instantiateGltf() {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
      return {
        scene,
        animations: [],
      };
    },
  };
}

function twoRoomsWithPortal(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "east",
            sideIndex: 1,
            targetCellId: "room-b",
            targetPortalId: "west",
          },
        ],
      },
      {
        id: "room-b",
        heightMeters: 2,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "west",
            sideIndex: 3,
            targetCellId: "room-a",
            targetPortalId: "east",
          },
        ],
      },
    ],
  };
}
