/**
 * Render inspection (src/render/three/renderInspection.ts): read-only answers about what the last frame's instance sync did, built from the code the frame uses.
 * A mouse stands 0.1 m from the portal between two rooms, so it has its own record in one room and a ghost record in the other; a rover stands for the
 * player's avatar, whose records skip the root path and hide near a camera. The tests ask the five questions of the public API namespace `render`: which
 * record sources produced what, which records exist, what the ghost rule decided, which instances were written, and why a record was or was not drawn.
 */
import { createTestEngine } from "../support/engine";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import type { PlayerPose } from "../../src/movement/playerPose";
import { createFrameRenderSnapshot } from "../../src/render/three/frameRenderSnapshot";
import type { PlayerRoverRenderModel } from "../../src/render/three/playerRoverModel";
import {
  explainObjectGhosts,
  explainObjectInstances,
  inspectInstances,
  inspectPaths,
  inspectRecordSources,
  inspectRecords,
} from "../../src/render/three/renderInspection";
import { createRootVisiblePortalPath } from "../../src/render/three/renderPortalInstances";
import { explainPortalGhosts } from "../../src/render/three/runtimeObjectGhostRecords";
import { createRuntimeObjectInstanceSync } from "../../src/render/three/runtimeObjectInstanceSync";
import {
  buildRuntimeObjectRenderArchetype,
  createRuntimeObjectRenderArchetypeDiagnostics,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import type { RuntimeObjectRenderSourceMesh } from "../../src/render/three/runtimeObjectRenderRecords";
import type { VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectBase";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createTestClientSession } from "../support/clientSession";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

function twoRoomsWithPortal(): CellComplexSpec {
  return {
    cells: [
      { id: "room-a", heightMeters: 2, baseVertices: squareRoomBase, portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }] },
      { id: "room-b", heightMeters: 2, baseVertices: squareRoomBase, portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }] },
    ],
  };
}

// 0.1 m from the west wall of room-b: the 0.2 m box reaches within 0.02 m of the portal, so the mouse is also drawn in room-a.
const mouseNearPortal: RuntimeCreatureObject = {
  id: "mouse-1",
  kind: "geo-mouse",
  cellId: "room-b",
  localPose: yawRigidTransform3(0, { x: -0.9, y: 0, z: 0 }),
  portalRenderable: true,
};

function boxMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
}

function path(cellId: string, pathId: number, depth: number, matrix = new THREE.Matrix4()): VisiblePortalPath {
  return { ...createRootVisiblePortalPath(cellId), pathId, depth, rootFromDestinationMatrix: matrix };
}

function snapshot(paths: Record<string, VisiblePortalPath[]>, cameraPositions: THREE.Vector3[] = []) {
  return createFrameRenderSnapshot({
    serial: 1,
    rootCellId: "room-b",
    visiblePathsByDestinationCell: new Map(Object.entries(paths)),
    clipIndexByPathId: new Map([[7, 3]]),
    cameraPositions,
  });
}

function roverModel(): PlayerRoverRenderModel {
  const source: RuntimeObjectRenderSourceMesh = {
    objectId: "rover",
    archetypeKey: "player-avatar:rover:mesh:0",
    mesh: boxMesh(),
    root: new THREE.Group(),
  };
  return {
    root: source.root,
    objectId: "rover",
    collectSources: () => [source],
    archetypeKeyPrefix: "player-avatar:rover",
    placement: (pose) => ({ id: "rover", cellId: pose.cellId, localPose: yawRigidTransform3(0, pose.position) }),
    recordFlags: { omitRootVisiblePath: true, suppressWithinCameraDistanceMeters: 2 },
  };
}

function setup() {
  const world = compileCellComplex(twoRoomsWithPortal());
  const registry = createRuntimeObjectRegistry([mouseNearPortal]);
  const sync = createRuntimeObjectInstanceSync({
    registry,
    runtimeObjectRootsById: new Map([[mouseNearPortal.id, new THREE.Group().add(boxMesh())]]),
    renderSourcesByKey: new Map(),
    renderArchetypesByKey: new Map(),
    renderRoot: new THREE.Group(),
    geodesicRenderSources: [],
    geodesicArchetypeKeys: [],
    playerRoverRenderModel: roverModel(),
    maxVisiblePaths: 4,
    diagnostics: createRuntimeObjectRenderArchetypeDiagnostics(),
    getWorld: () => world,
    session: createTestClientSession(),
    engine: createTestEngine({ playerPose: { cellId: "room-b", position: { x: 0.5, y: 0, z: 0 }, yawRadians: 0 } as unknown as PlayerPose }),
    buildArchetype: (source, capacity) => buildRuntimeObjectRenderArchetype(source, capacity, undefined),
  });
  return { world, sync, context: sync.inspection };
}

// The root path of room-b and one path through the portal to room-a, drawn with a matrix that puts room-a beside room-b.
function framePaths(): Record<string, VisiblePortalPath[]> {
  return {
    "room-b": [path("room-b", 0, 0)],
    "room-a": [path("room-a", 7, 1, new THREE.Matrix4().makeTranslation(-2, 0, 0))],
  };
}

describe("render inspection", () => {
  it("lists the record sources of the last collection with their counts", () => {
    const { sync, context } = setup();
    sync.sync(snapshot(framePaths()));

    expect(inspectRecordSources(context)).toEqual([
      { source: "runtime-objects", groups: 1, records: 2 },
      { source: "player-rover", groups: 1, records: 1 },
    ]);
  });

  it("lists an object's own record and its ghost, each in the frame of its cell", () => {
    const { sync, context } = setup();
    sync.sync(snapshot(framePaths()));

    const { total, records } = inspectRecords(context, { objectId: "mouse-1" });

    expect(total).toBe(2);
    expect(records.map((record) => record.cellId)).toEqual(["room-b", "room-a"]);
    expect(records[0].positionInCell).toEqual({ x: -0.9, y: 0, z: 0 });
    expect(records[1].positionInCell.x).toBeCloseTo(1.1, 6);
    expect(inspectRecords(context, { source: "player-rover" }).records[0].flags).toEqual({
      omitRootVisiblePath: true,
      suppressWithinCameraDistanceMeters: 2,
    });
    expect(inspectRecords(context, { limit: 1 })).toMatchObject({ total: 3, records: [expect.anything()] });
  });

  it("explains a part's ghost decision: footprint, disk and each cell copy's outcome", () => {
    const { sync, context } = setup();
    sync.sync(snapshot(framePaths()));

    const explained = explainObjectGhosts(context, "mouse-1");
    const decision = explained.parts[0].decision;

    expect(explained.parts).toHaveLength(1);
    expect(explained.parts[0].source).toBe("runtime-objects");
    expect(decision?.cellId).toBe("room-b");
    expect(decision?.footprint.radiusMeters).toBeGreaterThan(0);
    expect(decision?.copies.map((copy) => [copy.cellId, copy.outcome, copy.depth])).toEqual([
      ["room-b", "own", 0],
      ["room-a", "ghost", 1],
    ]);
    expect(() => explainObjectGhosts(context, "no-such-object")).toThrow('no drawn object with id "no-such-object"');
  });

  it("explains the player's rover with the flags its records carry", () => {
    const { sync, context } = setup();
    sync.sync(snapshot(framePaths()));

    const rover = explainObjectGhosts(context, "rover");

    expect(rover.parts[0].source).toBe("player-rover");
    expect(rover.parts[0].recordFlags).toEqual({ omitRootVisiblePath: true, suppressWithinCameraDistanceMeters: 2 });
    expect(rover.parts[0].decision?.copies[0].outcome).toBe("own");
  });

  it("decides the ghost copies by the same rule as the records", () => {
    const { world, sync, context } = setup();
    sync.sync(snapshot(framePaths()));
    const request = context.ghostParts("mouse-1")?.[0].request;

    expect(request).toBeDefined();
    const ghostCells = explainPortalGhosts(request!)!.copies.filter((copy) => copy.outcome === "ghost").map((copy) => copy.cellId);
    const recordCells = inspectRecords(context, { objectId: "mouse-1" }).records.filter((_record, index) => index > 0).map((record) => record.cellId);

    expect(world.cellsById.has("room-a")).toBe(true);
    expect(ghostCells).toEqual(recordCells);
  });

  it("lists archetypes with instances per cell and, on request, each path and clip row", () => {
    const { sync, context } = setup();
    // room-a is seen through the portal from a place that is not where the mouse stands, so the ghost is drawn as a second instance.
    const paths = { "room-b": [path("room-b", 0, 0)], "room-a": [path("room-a", 7, 1, new THREE.Matrix4().makeTranslation(-6, 0, 0))] };
    sync.sync(snapshot(paths, [new THREE.Vector3(10, 0, 0)]));

    const [summary] = inspectInstances(context, { archetypePrefix: "geo-mouse:mouse-1" });
    const [detailed] = inspectInstances(context, { objectId: "mouse-1", detail: true });

    expect(summary).toMatchObject({ archetypeKey: "geo-mouse:mouse-1:mesh:0", count: 2, countByCell: { "room-b": 1, "room-a": 1 } });
    expect(summary.instances).toBeUndefined();
    expect(detailed.instances?.map((instance) => [instance.cellId, instance.depth, instance.clipIndex])).toEqual([
      ["room-b", 0, -2],
      ["room-a", 1, 3],
    ]);
    expect(inspectInstances(context, { archetypePrefix: "no-such" })).toEqual([]);
  });

  it("says a ghost landing on the real object is merged into the root copy", () => {
    const { sync, context } = setup();
    // room-a unfolded beside room-b: the ghost (1.1 m in room-a) lands on the mouse (-0.9 m in room-b), so the two are one drawing.
    sync.sync(snapshot(framePaths(), [new THREE.Vector3(10, 0, 0)]));

    expect(inspectInstances(context, { objectId: "mouse-1" })[0]).toMatchObject({ count: 1, countByCell: { "room-b": 1 } });
    expect(explainObjectInstances(context, "mouse-1").decisions.map((decision) => [decision.recordCellId, decision.outcome])).toEqual([
      ["room-b", "written"],
      ["room-a", "merged-into-root-copy"],
    ]);
  });

  it("says why the rover is or is not drawn on each path", () => {
    const { sync, context } = setup();
    const paths = { "room-b": [path("room-b", 0, 0), path("room-b", 5, 1, new THREE.Matrix4().makeTranslation(0, 0, 1))] };

    sync.sync(snapshot(paths, [new THREE.Vector3(0.5, 0, 0)]));
    const near = explainObjectInstances(context, "rover");

    expect(near.rootCellId).toBe("room-b");
    expect(near.decisions.map((decision) => [decision.pathId, decision.outcome])).toEqual([
      [0, "omitted-root-path"],
      [5, "suppressed-near-camera"],
    ]);
    expect(near.decisions[1].cameraDistanceMeters).toBeLessThan(2);
    expect(near.decisions[0].positionInRoot).toBeUndefined();

    sync.sync(snapshot(paths, [new THREE.Vector3(30, 0, 0)]));
    const far = explainObjectInstances(context, "rover");

    expect(far.decisions.map((decision) => decision.outcome)).toEqual(["omitted-root-path", "written"]);
    expect(far.decisions[1]).toMatchObject({ instanceIndex: 0, pathDepth: 1 });
    expect(() => explainObjectInstances(context, "no-such-object")).toThrow('no records of object "no-such-object"');
  });

  it("changes nothing: instances are the same before and after an explanation", () => {
    const { sync, context } = setup();
    sync.sync(snapshot(framePaths(), [new THREE.Vector3(10, 0, 0)]));
    const before = JSON.stringify(inspectInstances(context, { detail: true }));

    explainObjectInstances(context, "mouse-1");
    explainObjectInstances(context, "rover");

    expect(JSON.stringify(inspectInstances(context, { detail: true }))).toBe(before);
  });

  it("refuses to explain before any frame was synced", () => {
    const { context } = setup();

    expect(() => explainObjectInstances(context, "mouse-1")).toThrow("no frame has been synced yet");
    expect(() => inspectPaths(context)).toThrow("no frame has been synced yet");
  });

  it("lists the visible paths with their screen regions and answers which cover a point", () => {
    const { sync, context } = setup();
    const left = path("room-a", 7, 1, new THREE.Matrix4().makeTranslation(-6, 0, 0));
    sync.sync(snapshot({
      "room-b": [path("room-b", 0, 0)],
      "room-a": [{ ...left, clipPolygonNdc: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 1 }] }],
    }));

    const all = inspectPaths(context);
    const covering = inspectPaths(context, { containsNdc: { x: -0.5, y: 0 } });

    expect(all).toMatchObject({ rootCellId: "room-b", total: 2 });
    expect(all.paths.map((entry) => [entry.pathId, entry.destinationCellId, entry.depth, entry.clipIndex])).toEqual([
      [0, "room-b", 0, -2],
      [7, "room-a", 1, 3],
    ]);
    expect(all.paths[1].clipPolygonNdc).toEqual([{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 1 }]);
    expect(covering.paths.map((entry) => entry.pathId)).toContain(7);
    expect(inspectPaths(context, { containsNdc: { x: 0.5, y: 0 } }).paths.map((entry) => entry.pathId)).not.toContain(7);
    expect(inspectPaths(context, { cellId: "room-a" }).total).toBe(1);
  });
});
