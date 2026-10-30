import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  collectLockedIncidentGeodesicIdsForEmitter,
  getGeodesicConnection,
  isGeodesicLocked,
} from "../../../src/world-objects/geodesic/lifecycle";
import {
  advanceStraighteningGeodesics,
  isGeodesicStraightening,
  tieAndDetachIncidentGeodesics,
} from "../../../src/world-objects/geodesic/legacyConnection";
import {
  createGeodesicCannonObject,
  geodesicRayBeamHeightMeters,
  geodesicRayBeamStartOffsetMeters,
} from "../../../src/world-objects/geodesic/objects";
import { getGeodesicSegments, getGeodesicTail } from "../../../src/world-objects/geodesic/segments";
import {
  placeGeodesicCannonAtGeodesicVertex,
  rebuildConnectedGeodesicBetweenEmitters,
  rebuildGeodesicToLength,
  shootGeodesic,
} from "../../../src/world-objects/geodesic/cannon";
import { updateGeodesicIntersectionObjects } from "../../../src/world-objects/geodesic/intersections";
import { yawRigidTransform3 } from "../.././../src/math/rigidTransform3";
import {
  createSegment,
  compileWorld,
  getCannonGeodesicIds,
  getCannonGeodesicYaw,
  normalizeYaw,
  horizontalDistance,
  horizontalDirection,
  compileLargeWorld,
} from "./fixtures";

describe("geodesic cannon world objects: legacy connection", () => {
  it.skip("places an emitter at a vertex and connects every geodesic side passing through it", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const horizontalSource = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a"],
      geodesicEmitterYawRadiansById: { "g-a": 0 },
      localPose: yawRigidTransform3(0, { x: -1.2, y: 1, z: 0 }),
    });
    const verticalSource = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      activeGeodesicId: "g-b",
      geodesicIds: ["g-b"],
      geodesicEmitterYawRadiansById: { "g-b": Math.PI / 2 },
      localPose: yawRigidTransform3(Math.PI / 2, { x: 1, y: -1.2, z: 0 }),
    });
    registry.add(horizontalSource);
    registry.add(verticalSource);
    shootGeodesic({ world, registry, cannon: horizontalSource, geodesicId: "g-a", maxLengthMeters: 4 });
    shootGeodesic({ world, registry, cannon: verticalSource, geodesicId: "g-b", maxLengthMeters: 4 });
    const [vertex] = updateGeodesicIntersectionObjects(registry);

    const result = placeGeodesicCannonAtGeodesicVertex({
      world,
      registry,
      cellId: "a",
      vertexPoint: vertex.aimStickyTarget?.localPoint ?? vertex.localPose.translation,
      aimYawRadians: 0,
      id: "cannon-c",
      createContinuationGeodesicId: (sourceGeodesicId) => `${sourceGeodesicId}:after-vertex`,
    });

    expect(result.placed).toBe(true);
    expect(getGeodesicTail(registry, "g-a")).toMatchObject({
      lengthMeters: 2.2,
      terminal: { kind: "emitter-hit", emitterId: "cannon-c" },
      connectionState: "connected",
    });
    expect(getGeodesicTail(registry, "g-b")).toMatchObject({
      lengthMeters: 2.2,
      terminal: { kind: "emitter-hit", emitterId: "cannon-c" },
      connectionState: "connected",
    });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(isGeodesicLocked(registry, "g-b")).toBe(true);
    expect(getCannonGeodesicIds(registry, "cannon-c")).toEqual([
      "g-a",
      "g-a:after-vertex",
      "g-b",
      "g-b:after-vertex",
    ]);
    expect(getCannonGeodesicYaw(registry, "cannon-c", "g-a")).toBeCloseTo(Math.PI);
    expect(getCannonGeodesicYaw(registry, "cannon-c", "g-a:after-vertex")).toBeCloseTo(0);
    expect(getCannonGeodesicYaw(registry, "cannon-c", "g-b")).toBeCloseTo(-Math.PI / 2);
    expect(getCannonGeodesicYaw(registry, "cannon-c", "g-b:after-vertex")).toBeCloseTo(Math.PI / 2);
    expect(getGeodesicTail(registry, "g-a:after-vertex")?.lengthMeters).toBeCloseTo(1.8);
    expect(getGeodesicTail(registry, "g-b:after-vertex")?.lengthMeters).toBeCloseTo(1.8);
    expect(registry.getAll().filter((object) => object.kind === "geodesic-intersection")).toHaveLength(0);
  });

  it.skip("rebuilds locked emitter-to-emitter geodesics after moving an endpoint", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 4 });

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 1, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-a" });
    const expectedYaw = Math.atan2(1, 2.5);

    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(getGeodesicTail(registry, "g-a")?.lengthMeters).toBeCloseTo(Math.hypot(2.5, 1) - geodesicRayBeamStartOffsetMeters);
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-a")).toBeCloseTo(expectedYaw);
    expect(getCannonGeodesicYaw(registry, "cannon-b", "g-a")).toBeCloseTo(normalizeYaw(expectedYaw + Math.PI));
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it.skip("finds and rebuilds multiple locked geodesics incident to a moved emitter", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const leftSource = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    const lowerSource = createGeodesicCannonObject({
      id: "cannon-c",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI / 2, { x: 1, y: -2, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 0, z: 0 }),
    });
    registry.add(leftSource);
    registry.add(lowerSource);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: leftSource, geodesicId: "g-a", maxLengthMeters: 4 });
    shootGeodesic({ world, registry, cannon: lowerSource, geodesicId: "g-b", maxLengthMeters: 4 });

    expect([...collectLockedIncidentGeodesicIdsForEmitter(registry, "cannon-b")].sort()).toEqual(["g-a", "g-b"]);

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 1, z: 0 }),
    });

    for (const geodesicId of collectLockedIncidentGeodesicIdsForEmitter(registry, "cannon-b")) {
      rebuildConnectedGeodesicBetweenEmitters({
        world,
        registry,
        geodesicId,
        carriedEmitterId: "cannon-b",
        carriedEmitterBeforeMove: movedIncoming,
      });
    }

    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(getGeodesicConnection(registry, "g-b")).toEqual({
      outgoingEmitterId: "cannon-c",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(getGeodesicTail(registry, "g-a")?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    expect(getGeodesicTail(registry, "g-b")?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    expect([...getCannonGeodesicIds(registry, "cannon-b")].sort()).toEqual(["g-a", "g-b"]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(isGeodesicLocked(registry, "g-b")).toBe(true);
  });

  it.skip("snaps final rebuild yaw to a passed emitter and connects precisely", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 0.05, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);

    rebuildGeodesicToLength({
      world,
      registry,
      cannon: source,
      geodesicId: "g-a",
      totalLengthMeters: 4,
      snapToEmitter: true,
    });

    const snappedYaw = Math.atan2(0.05, 2.5);
    expect(getGeodesicTail(registry, "g-a")?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-a")).toBeCloseTo(snappedYaw);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it.skip("ties and detaches two locked geodesics from an emitter as a straightening pair", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const left = createGeodesicCannonObject({
      id: "cannon-left",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }),
    });
    const center = createGeodesicCannonObject({
      id: "cannon-center",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    });
    const top = createGeodesicCannonObject({
      id: "cannon-top",
      cellId: "a",
      localPose: yawRigidTransform3(-Math.PI / 2, { x: 0, y: 2, z: 0 }),
    });
    registry.add(left);
    registry.add(center);
    registry.add(top);

    shootGeodesic({ world, registry, cannon: left, geodesicId: "g-left", maxLengthMeters: 3 });
    shootGeodesic({ world, registry, cannon: top, geodesicId: "g-top", maxLengthMeters: 3 });

    const segments = tieAndDetachIncidentGeodesics({
      world,
      registry,
      emitterId: "cannon-center",
      geodesicId: "g-tied",
    });

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.connectionState)).toEqual(["straightening", "straightening"]);
    expect(getCannonGeodesicIds(registry, "cannon-center")).toEqual([]);
    expect(getCannonGeodesicIds(registry, "cannon-left")).toEqual(["g-tied"]);
    expect(getCannonGeodesicIds(registry, "cannon-top")).toEqual(["g-tied"]);
    expect(getCannonGeodesicYaw(registry, "cannon-left", "g-tied")).toBeCloseTo(0);
    expect(getCannonGeodesicYaw(registry, "cannon-top", "g-tied")).toBeCloseTo(-Math.PI / 2);
    expect(isGeodesicStraightening(registry, "g-tied")).toBe(true);
    expect(isGeodesicLocked(registry, "g-tied")).toBe(true);
    expect(getGeodesicSegments(registry, "g-left")).toEqual([]);
    expect(getGeodesicSegments(registry, "g-top")).toEqual([]);
  });

  it.skip("advances tied detached geodesics until they become one connected locked segment", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const left = createGeodesicCannonObject({
      id: "cannon-left",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }),
    });
    const center = createGeodesicCannonObject({
      id: "cannon-center",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    });
    const top = createGeodesicCannonObject({
      id: "cannon-top",
      cellId: "a",
      localPose: yawRigidTransform3(-Math.PI / 2, { x: 0, y: 2, z: 0 }),
    });
    registry.add(left);
    registry.add(center);
    registry.add(top);
    shootGeodesic({ world, registry, cannon: left, geodesicId: "g-left", maxLengthMeters: 3 });
    shootGeodesic({ world, registry, cannon: top, geodesicId: "g-top", maxLengthMeters: 3 });
    tieAndDetachIncidentGeodesics({ world, registry, emitterId: "cannon-center", geodesicId: "g-tied" });

    for (let i = 0; i < 30 && isGeodesicStraightening(registry, "g-tied"); i += 1) {
      advanceStraighteningGeodesics({ world, registry, deltaSeconds: 1, speedMetersPerSecond: 1 });
    }

    const segments = getGeodesicSegments(registry, "g-tied");
    expect(segments).toHaveLength(1);
    expect(segments[0]?.connectionState).toBe("connected");
    expect(segments[0]?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-top" });
    expect(getCannonGeodesicYaw(registry, "cannon-left", "g-tied")).toBeCloseTo(Math.PI / 4);
    expect(getCannonGeodesicYaw(registry, "cannon-top", "g-tied")).toBeCloseTo(-3 * Math.PI / 4);
    expect(isGeodesicStraightening(registry, "g-tied")).toBe(false);
    expect(isGeodesicLocked(registry, "g-tied")).toBe(true);
  });

  it.skip("ties and detaches a vertex of a fully locked geodesic triangle", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const a = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1, y: 0, z: 0 }),
    });
    const b = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3((2 * Math.PI) / 3, { x: 1, y: 0, z: 0 }),
    });
    const c = createGeodesicCannonObject({
      id: "cannon-c",
      cellId: "a",
      localPose: yawRigidTransform3((-2 * Math.PI) / 3, { x: 0, y: Math.sqrt(3), z: 0 }),
    });
    registry.add(a);
    registry.add(b);
    registry.add(c);
    shootGeodesic({ world, registry, cannon: a, geodesicId: "g-ab", maxLengthMeters: 3 });
    shootGeodesic({ world, registry, cannon: b, geodesicId: "g-bc", maxLengthMeters: 3 });
    shootGeodesic({ world, registry, cannon: c, geodesicId: "g-ca", maxLengthMeters: 3 });

    const segments = tieAndDetachIncidentGeodesics({
      world,
      registry,
      emitterId: "cannon-a",
      geodesicId: "g-tied",
      incidentGeodesicIds: ["g-ab", "g-ca"],
    });

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.connectionState)).toEqual(["straightening", "straightening"]);
    expect(getGeodesicSegments(registry, "g-ab")).toEqual([]);
    expect(getGeodesicSegments(registry, "g-ca")).toEqual([]);
    expect(getGeodesicSegments(registry, "g-bc")).toHaveLength(1);
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual([]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-bc", "g-tied"]);
    expect(getCannonGeodesicIds(registry, "cannon-c")).toEqual(["g-bc", "g-tied"]);

    for (let i = 0; i < 30 && isGeodesicStraightening(registry, "g-tied"); i += 1) {
      advanceStraighteningGeodesics({ world, registry, deltaSeconds: 1, speedMetersPerSecond: 1 });
    }

    expect(getGeodesicSegments(registry, "g-tied")).toEqual([]);
    expect(getGeodesicSegments(registry, "g-bc")).toHaveLength(1);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-bc"]);
    expect(getCannonGeodesicIds(registry, "cannon-c")).toEqual(["g-bc"]);
  });

  it.skip("deletes both straightening halves when either half enters a forbidden zone", () => {
    const world = compileWorld(true);
    const registry = createRuntimeObjectRegistry([
      createGeodesicCannonObject({
        id: "cannon-left",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 0.25, y: 1, z: 0 }),
      }),
      createGeodesicCannonObject({
        id: "cannon-top",
        cellId: "a",
        localPose: yawRigidTransform3(-Math.PI / 2, { x: 1, y: 1.75, z: 0 }),
      }),
    ]);
    const start = { x: 1, y: 1, z: geodesicRayBeamHeightMeters };
    const vertex = { x: 1.2, y: 1.5, z: geodesicRayBeamHeightMeters };
    const end = { x: 1.95, y: 0.05, z: geodesicRayBeamHeightMeters };
    const firstDirection = horizontalDirection(start, vertex);
    const secondDirection = horizontalDirection(vertex, end);
    registry.add(createSegment({
      id: "g-tied:segment:0",
      geodesicId: "g-tied",
      start,
      direction: firstDirection,
      lengthMeters: horizontalDistance(start, vertex),
      connectionState: "straightening",
    }));
    registry.add(createSegment({
      id: "g-tied:segment:1",
      geodesicId: "g-tied",
      segmentIndex: 1,
      start: vertex,
      direction: secondDirection,
      lengthMeters: horizontalDistance(vertex, end),
      terminal: { kind: "emitter-hit", emitterId: "cannon-top" },
      connectionState: "straightening",
    }));
    const source = registry.get("cannon-left");
    if (source?.kind !== "geodesic-cannon") {
      throw new Error("Expected source.");
    }
    registry.update({
      ...source,
      geodesicIds: ["g-tied"],
      geodesicConnectionsById: {
        "g-tied": { outgoingEmitterId: "cannon-left", incomingEmitterId: "cannon-top", state: "straightening" },
      },
    });

    advanceStraighteningGeodesics({ world, registry, deltaSeconds: 1, speedMetersPerSecond: 1 });

    expect(getGeodesicSegments(registry, "g-tied")).toEqual([]);
    expect(getCannonGeodesicIds(registry, "cannon-left")).toEqual([]);
  });
});
