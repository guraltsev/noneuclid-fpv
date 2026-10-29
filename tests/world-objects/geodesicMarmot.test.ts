import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { torus } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { transformDirection3 } from "../../src/math/rigidTransform3";
import { createGeodesicMarmot, createGeodesicMarmotRuntime, createGeodesicMarmotRuntimeObject } from "../../src/world-objects/geodesicMarmot";
import type { PreparedWorldAssets } from "../../src/render/three/preloadWorldAssets";

describe("createGeodesicMarmotRuntime", () => {
  it("uses anchor crossing semantics and reparents on the same crossing frame", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const marmot = createGeodesicMarmot({
      id: "front-runner",
      position: { x: 0.75, y: 0, z: 0.5 },
      velocity: { x: 2, y: 0 },
    });
    const runtime = createGeodesicMarmotRuntime(marmot, "room-a", stubAssets());
    const roomARoot = new THREE.Group();
    const roomBRoot = new THREE.Group();
    const cellRoots = new Map<string, THREE.Object3D>([
      ["room-a", roomARoot],
      ["room-b", roomBRoot],
    ]);

    runtime.syncParent(cellRoots);
    expect(runtime.cellId).toBe("room-a");
    expect(runtime.root.parent).toBe(roomARoot);

    runtime.update(world, 0.1);
    runtime.syncParent(cellRoots);

    expect(runtime.cellId).toBe("room-a");
    expect(runtime.root.parent).toBe(roomARoot);
    expect(runtime.root.position.x).toBeCloseTo(0.95);

    runtime.update(world, 0.05);
    runtime.syncParent(cellRoots);

    expect(runtime.cellId).toBe("room-b");
    expect(runtime.root.parent).toBe(roomBRoot);
    expect(runtime.root.position.x).toBeCloseTo(-0.95);
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
      return undefined;
    },
  };
}

function twoRoomsWithPortal() {
  const squareRoomBase = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];

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

describe("geodesic marmot heading", () => {
  it("walks along its body +y axis in the authored velocity direction", () => {
    for (const velocity of [{ x: 1, y: 0 }, { x: -0.5, y: 1 }, { x: 0.3, y: -0.8 }]) {
      const spec = createGeodesicMarmot({ id: "m", position: { x: 0, y: 0, z: 0 }, velocity });
      const object = createGeodesicMarmotRuntimeObject(spec, "cell");
      // The runtime advances by transformDirection3(localPose, (0, speed * dt, 0)).
      const heading = transformDirection3(object.localPose, { x: 0, y: 1, z: 0 });
      const speed = Math.hypot(velocity.x, velocity.y);
      expect(heading.x).toBeCloseTo(velocity.x / speed, 9);
      expect(heading.y).toBeCloseTo(velocity.y / speed, 9);
    }
  });

  it("turns away from a forbidden zone instead of freezing", () => {
    const world = compileCellComplex(torus);
    // Walks diagonally into the zone at the corner (7.5, 7.5) of the 15 m torus room.
    const spec = createGeodesicMarmot({ id: "m", position: { x: 5, y: 5, z: 0 }, velocity: { x: 1, y: 1 } });
    const runtime = createGeodesicMarmotRuntime(spec, "torus-room", stubAssets());
    const frames = 1200;
    let movedFrames = 0;
    let sawTurn = false;
    for (let frame = 0; frame < frames; frame += 1) {
      const before = runtime.root.position.clone();
      runtime.update(world, 1 / 60);
      const after = runtime.root.position;
      if (after.distanceTo(before) > 1e-9) movedFrames += 1;
      if (after.x < before.x - 1e-9) sawTurn = true;
    }
    expect(movedFrames / frames).toBeGreaterThanOrEqual(0.9);
    expect(sawTurn).toBe(true);
  });
});
