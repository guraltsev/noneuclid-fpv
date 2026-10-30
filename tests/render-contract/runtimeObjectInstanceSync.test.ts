import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createFrameRenderSnapshot } from "../../src/render/three/frameRenderSnapshot";
import type { PlayerRoverRenderModel } from "../../src/render/three/playerRoverModel";
import { createRootVisiblePortalPath, unclippedPortalClipIndex } from "../../src/render/three/renderPortalInstances";
import {
  buildRuntimeObjectRenderArchetype,
  createRuntimeObjectRenderArchetypeDiagnostics,
} from "../../src/render/three/runtimeObjectRenderArchetypes";
import { createRuntimeObjectInstanceSync } from "../../src/render/three/runtimeObjectInstanceSync";
import type { RuntimeObjectRenderSourceMesh } from "../../src/render/three/runtimeObjectRenderRecords";
import { rigidTransformToThreeMatrix } from "../../src/render/three/worldAxes";
import {
  createRuntimeObjectRegistry,
  createRuntimeStaticAssetObject,
  type RuntimeCreatureObject,
  type RuntimeWorldObject,
} from "../../src/world-objects/runtimeObjectRegistry";
import { createPlainWorldObject } from "../../src/world-objects/worldObjectOwner";
import type { PlayerPose } from "../../src/movement/playerPose";
import type { VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";

const squareRoomBase = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

function twoRoomsWithPortal(): CellComplexSpec {
  return {
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
}

function mouse(id: string, x = 0): RuntimeCreatureObject {
  return {
    id,
    kind: "geo-mouse",
    cellId: "room-b",
    localPose: yawRigidTransform3(0, { x, y: 0, z: 0 }),
    portalRenderable: true,
  };
}

function boxRoot(): THREE.Group {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)));
  return root;
}

function path(cellId: string, pathId: number, depth: number, matrix = new THREE.Matrix4()): VisiblePortalPath {
  return { ...createRootVisiblePortalPath(cellId), pathId, depth, rootFromDestinationMatrix: matrix };
}

function snapshot(
  paths: Record<string, VisiblePortalPath[]>,
  cameraPositions: THREE.Vector3[] = [],
  clip: Map<number, number> = new Map(),
) {
  return createFrameRenderSnapshot({
    serial: 1,
    rootCellId: "room-b",
    visiblePathsByDestinationCell: new Map(Object.entries(paths)),
    clipIndexByPathId: clip,
    cameraPositions,
  });
}

function setup(objects: RuntimeWorldObject[], rover?: PlayerRoverRenderModel) {
  const world = compileCellComplex(twoRoomsWithPortal());
  const registry = createRuntimeObjectRegistry(objects);
  const roots = new Map(objects.map((object) => [object.id, boxRoot() as THREE.Object3D]));
  const renderSourcesByKey = new Map<string, RuntimeObjectRenderSourceMesh>();
  const renderArchetypesByKey = new Map();
  const sync = createRuntimeObjectInstanceSync({
    registry,
    runtimeObjectRootsById: roots,
    renderSourcesByKey,
    renderArchetypesByKey,
    renderRoot: new THREE.Group(),
    geodesicRenderSources: [],
    geodesicArchetypeKeys: [],
    playerRoverRenderModel: rover,
    maxVisiblePaths: 4,
    diagnostics: createRuntimeObjectRenderArchetypeDiagnostics(),
    getWorld: () => world,
    getPlayerPose: () => ({ cellId: "room-b", position: { x: 0, y: 0, z: 0 }, yawRadians: 0 }) as unknown as PlayerPose,
    buildArchetype: (source, capacity) => buildRuntimeObjectRenderArchetype(source, capacity, undefined),
  });
  return { registry, sync, renderArchetypesByKey };
}

function readMatrix(mesh: THREE.InstancedMesh, index: number): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
}

describe("runtimeObjectInstanceSync", () => {
  it("collects records once per sync", () => {
    const { sync } = setup([mouse("mouse-1")]);
    const snap = snapshot({ "room-b": [path("room-b", 0, 0)] });

    sync.sync(snap);
    sync.sync(snap);
    sync.sync(snap);

    expect(sync.stats.syncs).toBe(3);
    expect(sync.stats.recordCollections).toBe(3);
  });

  it("reuses the records of unchanged objects, ghosts included", () => {
    const { sync, registry } = setup([mouse("mouse-1")]);
    const snap = snapshot({ "room-b": [path("room-b", 0, 0)] });

    sync.sync(snap);
    sync.sync(snap);
    expect(sync.stats.ghostComputations).toBe(1);

    registry.update(mouse("mouse-1", 0.1));
    sync.sync(snap);
    expect(sync.stats.ghostComputations).toBe(2);
  });

  it("uses the snapshot root and paths, not a player cell", () => {
    const { sync, renderArchetypesByKey } = setup([mouse("mouse-1")]);
    const snap = snapshot({
      "room-b": [path("room-b", 0, 0)],
      "room-a": [path("room-a", 5, 1, new THREE.Matrix4().makeTranslation(3, 0, 0))],
    });

    sync.sync(snap);

    const archetype = renderArchetypesByKey.get("geo-mouse:mouse-1:mesh:0");
    expect(archetype.mesh.count).toBe(1);
    expect(archetype.portalClipIndexAttribute.getX(0)).toBe(unclippedPortalClipIndex);
    expect(readMatrix(archetype.mesh, 0).elements).toEqual(
      rigidTransformToThreeMatrix(mouse("mouse-1").localPose).elements,
    );
  });

  it("follows a re-rooted render frame (single-view XR)", () => {
    const { sync, renderArchetypesByKey } = setup([mouse("mouse-1", 0.3)]);
    const renderFromRoot = new THREE.Matrix4().makeRotationY(0.3).setPosition(1, 0, -2);

    sync.sync(snapshot({ "room-b": [path("room-b", 0, 0)] }));
    const archetype = renderArchetypesByKey.get("geo-mouse:mouse-1:mesh:0");
    const before = readMatrix(archetype.mesh, 0);

    sync.sync(snapshot({ "room-b": [path("room-b", 0, 0, renderFromRoot.clone())] }));
    const after = readMatrix(archetype.mesh, 0);
    const expected = new THREE.Matrix4().multiplyMatrices(renderFromRoot, before);

    expect(archetype.mesh.count).toBe(1);
    after.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index], 6));
  });

  it("uses the snapshot camera positions for rover suppression", () => {
    const roverSource: RuntimeObjectRenderSourceMesh = {
      objectId: "rover",
      archetypeKey: "player-avatar:rover:mesh:0",
      mesh: new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2)),
      root: new THREE.Group(),
    };
    const rover: PlayerRoverRenderModel = {
      root: roverSource.root,
      objectId: "rover",
      collectSources: () => [roverSource],
      collectRecords: () => [
        {
          objectId: "rover",
          cellId: "room-b",
          archetypeKey: roverSource.archetypeKey,
          localMatrix: new THREE.Matrix4(),
          omitRootVisiblePath: true,
          suppressWithinCameraDistanceMeters: 2,
        },
      ],
    };
    const { sync, renderArchetypesByKey } = setup([mouse("mouse-1")], rover);
    const paths = { "room-b": [path("room-b", 5, 1)] };

    sync.sync(snapshot(paths, [new THREE.Vector3(0, 0, 0)]));
    expect(renderArchetypesByKey.get(roverSource.archetypeKey).mesh.count).toBe(0);

    sync.sync(snapshot(paths, [new THREE.Vector3(10, 0, 0)]));
    expect(renderArchetypesByKey.get(roverSource.archetypeKey).mesh.count).toBe(1);
  });

  it("gives each object only the archetype keys of its own prefix", () => {
    const { sync, renderArchetypesByKey } = setup([mouse("mouse-1", -0.5), mouse("mouse-10", 0.5)]);

    sync.sync(snapshot({ "room-b": [path("room-b", 0, 0)] }));

    const first = renderArchetypesByKey.get("geo-mouse:mouse-1:mesh:0");
    const second = renderArchetypesByKey.get("geo-mouse:mouse-10:mesh:0");
    expect(first.mesh.count).toBe(1);
    expect(second.mesh.count).toBe(1);
    expect(readMatrix(first.mesh, 0).elements).toEqual(rigidTransformToThreeMatrix(mouse("mouse-1", -0.5).localPose).elements);
    expect(readMatrix(second.mesh, 0).elements).toEqual(rigidTransformToThreeMatrix(mouse("mouse-10", 0.5).localPose).elements);
  });

  it("draws a static asset at its record pose and follows a published pose", () => {
    const spec = { id: "house", kind: "asset" as const, assetPath: "models/house.glb", position: { x: 0.2, y: 0, z: 0 } };
    const record = { ...createRuntimeStaticAssetObject(spec, "room-b"), localPose: yawRigidTransform3(0.3, { x: 0.2, y: 0.1, z: 0 }) };
    const { sync, registry, renderArchetypesByKey } = setup([record]);
    const owner = createPlainWorldObject(registry, record);
    const snap = snapshot({ "room-b": [path("room-b", 0, 0)] });

    sync.sync(snap);
    const archetype = renderArchetypesByKey.get("asset:house:mesh:0");
    expect(archetype.mesh.count).toBe(1);
    readMatrix(archetype.mesh, 0).elements.forEach((value, i) => expect(value).toBeCloseTo(rigidTransformToThreeMatrix(record.localPose).elements[i], 6));

    const moved = yawRigidTransform3(1, { x: -0.4, y: 0.3, z: 0 });
    owner.place("room-b", moved);
    sync.sync(snap);
    readMatrix(archetype.mesh, 0).elements.forEach((value, i) => expect(value).toBeCloseTo(rigidTransformToThreeMatrix(moved).elements[i], 6));
  });

  it("does not walk ghosts again for an unchanged static asset record", () => {
    const spec = { id: "house", kind: "asset" as const, assetPath: "models/house.glb", position: { x: 0, y: 0, z: 0 } };
    const { sync } = setup([createRuntimeStaticAssetObject(spec, "room-b")]);
    const snap = snapshot({ "room-b": [path("room-b", 0, 0)] });

    sync.sync(snap);
    sync.sync(snap);
    sync.sync(snap);

    expect(sync.stats.ghostComputations).toBe(1);
  });
});
