/**
 * Geodesic creature consistency dump (src/render/three/geodesicCreatureDebug.ts): cross-checks a creature's
 * Three.js root, its runtime-object-registry record, and the compiled cell it should be inside, reporting a short
 * issue code for each disagreement (cell mismatch between registry and parent, or a visible creature marked
 * portal-renderable whose own root is hidden — an ancestor cell being hidden is not itself an issue). Read-only
 * and allocation-heavy; for on-demand debugging, not per-frame use.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createSimpleGeoCreature } from "../../src/world-objects/simpleGeoCreature";
import { createSimpleGeoCreatureRuntime } from "../../src/render/three/creatures/simpleGeoCreatureView";
import { collectGeodesicCreatureDebugDump } from "../../src/render/three/geodesicCreatureDebug";
import { createFakePreparedAssets } from "../support/preparedAssets";

describe("geodesic creature debug dump", () => {
  it("reports a consistent runtime creature with no issues", () => {
    const world = compileCellComplex(singleRoom());
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0, 0],
      scale: 0.1,
      speed: 0,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room", stubAssets(), registry);
    const roomRoot = new THREE.Group();
    const cellRoots = new Map<string, THREE.Object3D>([["room", roomRoot]]);

    runtime.syncParent(cellRoots);

    const dump = collectGeodesicCreatureDebugDump({
      world,
      runtimes: [runtime],
      registry,
      cellRoots,
    });

    expect(dump.creatureCount).toBe(1);
    expect(dump.issueCount).toBe(0);
    expect(dump.records[0]).toMatchObject({
      id: "mouse",
      kind: "geo-mouse",
      runtimeCellId: "room",
      registryCellId: "room",
      parentCellId: "room",
      issues: [],
    });
  });

  it("flags registry and parent mismatches", () => {
    const world = compileCellComplex(twoRoomsWithPortal());
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0, 0],
      scale: 0.1,
      speed: 0,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room-a", stubAssets(), registry);
    const roomARoot = new THREE.Group();
    const roomBRoot = new THREE.Group();
    const cellRoots = new Map<string, THREE.Object3D>([
      ["room-a", roomARoot],
      ["room-b", roomBRoot],
    ]);
    const object = registry.get("mouse");

    if (!object) {
      throw new Error("Expected registry object.");
    }

    roomBRoot.add(runtime.root);
    // The test fakes a registry that disagrees with the runtime; releasing ownership is the only legal way to do that.
    registry.releaseOwnership("mouse");
    registry.update({ ...object, cellId: "room-b" });

    const dump = collectGeodesicCreatureDebugDump({
      world,
      runtimes: [runtime],
      registry,
      cellRoots,
    });

    expect(dump.issueCount).toBeGreaterThan(0);
    expect(dump.records[0]?.issues).toEqual(
      expect.arrayContaining(["registry-cell-mismatch", "parent-cell-mismatch"]),
    );
  });

  it("allows portal-renderable creatures under hidden source cell roots", () => {
    const world = compileCellComplex(singleRoom());
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0, 0],
      scale: 0.1,
      speed: 0,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room", stubAssets(), registry);
    const roomRoot = new THREE.Group();
    const cellRoots = new Map<string, THREE.Object3D>([["room", roomRoot]]);

    runtime.syncParent(cellRoots);
    roomRoot.visible = false;

    const dump = collectGeodesicCreatureDebugDump({
      world,
      runtimes: [runtime],
      registry,
      cellRoots,
    });

    expect(dump.issueCount).toBe(0);
    expect(dump.records[0]).toMatchObject({
      renderVisible: true,
      ancestorsVisible: false,
      issues: [],
    });
  });

  it("still flags portal-renderable creatures when their own root is hidden", () => {
    const world = compileCellComplex(singleRoom());
    const registry = createRuntimeObjectRegistry();
    const mouse = createSimpleGeoCreature("geo-mouse", "mouse", "mouse/Mouse.glb", {
      position: [0, 0, 0],
      scale: 0.1,
      speed: 0,
    });
    const runtime = createSimpleGeoCreatureRuntime(mouse, "room", stubAssets(), registry);
    const roomRoot = new THREE.Group();
    const cellRoots = new Map<string, THREE.Object3D>([["room", roomRoot]]);

    runtime.syncParent(cellRoots);
    runtime.root.visible = false;

    const dump = collectGeodesicCreatureDebugDump({
      world,
      runtimes: [runtime],
      registry,
      cellRoots,
    });

    expect(dump.records[0]?.issues).toContain("render-hidden");
  });
});

function stubAssets() {
  return createFakePreparedAssets({
    getTexture: () => undefined,
    getConfiguredTexture: () => undefined,
  });
}

function singleRoom(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 2,
        baseVertices: [
          { x: -2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
        portals: [],
      },
    ],
  };
}

function twoRoomsWithPortal(): CellComplexSpec {
  const squareRoomBase = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
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
