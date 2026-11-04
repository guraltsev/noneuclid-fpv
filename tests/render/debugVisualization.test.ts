/**
 * Debug visualization sync (src/render/three/debugVisualization.ts): rebuilds a debug overlay group (here,
 * selectable hitboxes) only when its cache key changes or a rebuild is forced, reporting whether it rebuilt.
 * The returned boolean is the renderer's signal to the caller that it did work this frame; callers never read the
 * group's contents to tell.
 */
import * as THREE from "three";
import { createTestClientSession } from "../support/clientSession";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import type { DebugOptionId } from "../../src/glue/debugOptions";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { createDebugVisualization } from "../../src/render/three/debugVisualization";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { type RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectBase";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

const spec: CellComplexSpec = {
  cells: [
    {
      id: "room-a",
      heightMeters: 2,
      baseVertices: squareRoomBase,
      portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
    },
    {
      id: "room-b",
      heightMeters: 2,
      baseVertices: squareRoomBase,
      portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
    },
  ],
};

function target(x = 0): RuntimeCreatureObject {
  return {
    id: "mouse-1",
    kind: "geo-mouse",
    cellId: "room-a",
    localPose: yawRigidTransform3(0, { x, y: 0, z: 0.5 }),
    collision: simpleCollisionCylinder(0.2, 0.4),
    portalRenderable: true,
    tooltip: { label: "Mouse" },
  };
}

describe("syncSelectableHitboxDebugIfChanged", () => {
  it("rebuilds only when the key changes or the call is forced", () => {
    const world = compileCellComplex(spec);
    const registry = createRuntimeObjectRegistry([target()]);
    const roomA = new THREE.Group();
    const cellMeshes = new Map<string, THREE.Object3D>([["room-a", roomA], ["room-b", new THREE.Group()]]);
    const options: readonly DebugOptionId[] = ["selectable-hitboxes"];
    const groups = new Map<string, THREE.Group>();
    const { syncSelectableHitboxDebugIfChanged } = createDebugVisualization({
      runtimeObjectRegistry: registry,
      dynamicObjectRuntimes: [],
      cellMeshes,
      staticObjectCollisionWireframeGroupsByCellId: new Map(),
      selectableHitboxDebugGroupsByCellId: groups,
      aimCollisionOutlineDebugGroupsByCellId: new Map(),
      getWorld: () => world,
      session: createTestClientSession({ debugSettings: { debugLevel: "basic", portalPanelMode: "none", debugOptions: options } }),
    });
    const key = (forced = false, cellRootsGeneration = 0) => ({
      registryVersion: registry.getVersion(),
      cellRootsGeneration,
      forced,
    });

    expect(syncSelectableHitboxDebugIfChanged(key())).toBe(true);
    expect(syncSelectableHitboxDebugIfChanged(key())).toBe(false);

    registry.update(target(0.1));
    expect(syncSelectableHitboxDebugIfChanged(key())).toBe(true);
    expect(syncSelectableHitboxDebugIfChanged(key())).toBe(false);
    expect(syncSelectableHitboxDebugIfChanged(key(true))).toBe(true);
    expect(syncSelectableHitboxDebugIfChanged(key(false, 1))).toBe(true);
    expect(syncSelectableHitboxDebugIfChanged(key(false, 1))).toBe(false);
  });
});
