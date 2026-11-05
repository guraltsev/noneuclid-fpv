/**
 * `tests/render/geometryCommit.test.ts` — unit tier.
 *
 * Contract of the geometry commit (src/render/three/geometryCommit.ts) and of its pure transforms on a one-room world whose
 * deformation moves every point 0.5 m east. `commit` maps the player (it keeps its cell and is moved by the cell map; with no image
 * it is sent home), moves the emitters, re-solves the derived objects (an open geodesic of an emitter is gone afterwards), swaps
 * the active world and only then calls `afterSwap`; `commitReady` commits only when the geometry session has a snapshot.
 */
import { readLocalPlayerPose } from "../../src/engine/worldEngine";
import { createTestEngine } from "../support/engine";
import { describe, expect, it, vi } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellDeformationMap } from "../../src/cell-complex/worldGeometryDeformations";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { simpleCollisionCylinder } from "../../src/movement/dynamicObject";
import { createDefaultPlayerPose, playerPoseToDynamicObject, type PlayerPose } from "../../src/movement/playerPose";
import { createWorldDeformationFamilyRegistry } from "../../src/runtime/worldGeometryDeformationFamilies";
import type { WorldGeometrySnapshot } from "../../src/runtime/worldGeometrySession";
import { createGeometryCommit } from "../../src/render/three/geometryCommit";
import {
  transformGeodesicCannonForGeometryCommit,
  transformPlayerPoseForGeometryCommit,
} from "../../src/render/three/geometryCommitTransforms";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { createGeodesicCannonObject } from "../../src/world-objects/geodesic/objects";
import { getGeodesicSegments } from "../../src/world-objects/geodesic/segments";
import { createObjectHost } from "../../src/world-objects/worldObjectOwner";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

const world = compileCellComplex({
  cells: [
    {
      id: "a",
      heightMeters: 3,
      baseVertices: [
        { x: -3, y: -3 },
        { x: 3, y: -3 },
        { x: 3, y: 3 },
        { x: -3, y: 3 },
      ],
      portals: [],
    },
  ],
});

const eastByHalfMeter: CellDeformationMap = {
  cellId: "a",
  mapPoint: (point) => vec3(point.x + 0.5, point.y, point.z),
  mapDirection: (direction) => direction,
};
const mapsByCellId = new Map([["a", eastByHalfMeter]]);

function playerCollisionState(pose: PlayerPose) {
  return playerPoseToDynamicObject(pose, simpleCollisionCylinder(0.3, 1.7, { x: 0, y: 0, z: 0.85 }));
}

function snapshotOf(version: number): WorldGeometrySnapshot {
  return {
    version,
    deformation: { kind: "fake" } as never,
    spec: undefined as never,
    world,
    staticCull: buildStaticallyCulledPortalPathTables(world, { maxDepth: 0, toleranceMeters: 1e-6, maxKeptPathsPerRoot: 1 }),
    buildStats: { requestedAtMs: 0, completedAtMs: 0, worker: false },
  };
}

describe("geometry commit transforms", () => {
  it("keeps the player's cell and moves the pose by the cell map", () => {
    const result = transformPlayerPoseForGeometryCommit(
      { ...createDefaultPlayerPose("a"), position: vec3(1, 1, 0) },
      mapsByCellId,
      world,
      playerCollisionState,
    );

    expect(result.kind).toBe("pose");
    if (result.kind === "pose") {
      expect(result.pose.cellId).toBe("a");
      expect(result.pose.position.x).toBeCloseTo(1.5);
      expect(result.pose.position.y).toBeCloseTo(1);
    }
  });

  it("sends a player whose cell has no image home", () => {
    const result = transformPlayerPoseForGeometryCommit(createDefaultPlayerPose("a"), new Map(), world, playerCollisionState);

    expect(result).toEqual({ kind: "reset" });
  });

  it("moves an emitter with its map and drops one whose cell has no map", () => {
    const cannon = createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, vec3(-1, 0, 0)) });

    const moved = transformGeodesicCannonForGeometryCommit(cannon, mapsByCellId);

    expect(moved?.localPose.translation.x).toBeCloseTo(-0.5);
    expect(moved?.aimYawRadians).toBeCloseTo(0);
    expect(transformGeodesicCannonForGeometryCommit(cannon, new Map())).toBeUndefined();
  });
});

describe("geometry commit", () => {
  function setup(pending: WorldGeometrySnapshot[] = []) {
    const runtimeObjectRegistry = createRuntimeObjectRegistry();
    const engine = createTestEngine({ registry: runtimeObjectRegistry, playerPose: { ...createDefaultPlayerPose("a"), position: vec3(1, 1, 0) } });
    const family = { kind: "fake", createDynamicObjectMaps: () => mapsByCellId };
    const afterSwap = vi.fn();
    const commit = createGeometryCommit({
      initialSnapshot: snapshotOf(0),
      maxVisiblePaths: 10,
      familyRegistry: createWorldDeformationFamilyRegistry([family as never]),
      geometrySession: { pollReadySnapshot: () => pending.shift() },
      engine,
      runtimeObjectRegistry,
      objectHost: createObjectHost(),
      createPlayerCollisionState: playerCollisionState,
      resetPlayerToHome: vi.fn(),
      removePlacedFlagRuntime: vi.fn(),
      syncPlacedFlagRuntime: vi.fn(),
      computedObjectCallbacks: {},
      afterSwap: (snapshot) => afterSwap(snapshot, commit.active().snapshot.version),
    });
    return { engine, runtimeObjectRegistry, commit, afterSwap };
  }

  it("maps the player and emitters, drops open geodesics and swaps before afterSwap", () => {
    const { engine, runtimeObjectRegistry, commit, afterSwap } = setup();
    const cannon = createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, vec3(-1.5, 0, 0)) });
    runtimeObjectRegistry.add(cannon);
    shootGeodesic({ world, registry: runtimeObjectRegistry, cannon, geodesicId: "g-open", maxLengthMeters: 1.5 });
    expect(getGeodesicSegments(runtimeObjectRegistry, "g-open").length).toBeGreaterThan(0);

    const next = snapshotOf(1);
    commit.commit(next);

    expect(readLocalPlayerPose(engine).position.x).toBeCloseTo(1.5);
    const moved = runtimeObjectRegistry.get("cannon-a");
    expect(moved?.localPose.translation.x).toBeCloseTo(-1);
    expect(getGeodesicSegments(runtimeObjectRegistry, "g-open")).toHaveLength(0);
    expect(commit.active().snapshot).toBe(next);
    expect(afterSwap).toHaveBeenCalledWith(next, 1);
  });

  it("commits on commitReady only when the geometry session has a snapshot", () => {
    const next = snapshotOf(1);
    const { commit, afterSwap } = setup([next]);

    commit.commitReady();
    commit.commitReady();

    expect(afterSwap).toHaveBeenCalledTimes(1);
    expect(commit.active().snapshot).toBe(next);
  });

  it("throws when the deformation family is not registered", () => {
    const { commit } = setup();
    const unknown = { ...snapshotOf(1), deformation: { kind: "unknown" } as never };

    expect(() => commit.commit(unknown)).toThrow(/Unknown world deformation family/);
  });
});
