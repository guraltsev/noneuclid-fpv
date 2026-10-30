import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  createGeodesicCannonObject,
  geodesicRayBeamHeightMeters,
  minGeodesicSegmentLengthMeters,
} from "../../../src/world-objects/geodesic/objects";
import {
  collectGeodesicPortalWord,
  getGeodesicSegments,
  getGeodesicTail,
} from "../../../src/world-objects/geodesic/segments";
import {
  connectGeodesicToEmitter,
  extendGeodesic,
  placeGeodesicCannonOnGeodesic,
  rebuildGeodesicToLength,
  shootGeodesic,
} from "../../../src/world-objects/geodesic/cannon";
import { getGeodesicEndpointAttachmentsForAnchor } from "../../../src/world-objects/geodesic/endpoints";
import { getGeodesicConnection, isGeodesicLocked, removeGeodesic } from "../../../src/world-objects/geodesic/lifecycle";
import { yawRigidTransform3 } from "../.././../src/math/rigidTransform3";
import {
  totalGeodesicLength,
  getCannonGeodesicIds,
  getCannonGeodesicYaw,
  compileLargeWorld,
  compileTorusLoopWorld,
} from "./fixtures";

describe("geodesic cannon world objects: cannon", () => {
  it("places an incoming emitter on a segment, truncates the geodesic, and locks it", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    registry.add(cannon);
    const first = shootGeodesic({ world, registry, cannon, geodesicId: "g-a" });

    const result = placeGeodesicCannonOnGeodesic({
      world,
      registry,
      geodesicId: "g-a",
      segmentId: first.id,
      distanceAlongSegmentMeters: 1,
      aimYawRadians: Math.PI / 2,
      id: "cannon-b",
    });

    expect(result.placed).toBe(true);
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(1);
    expect(getGeodesicSegments(registry, "g-a").map((segment) => segment.halfRole)).toEqual(["start", "end"]);
    expect(getGeodesicSegments(registry, "g-a").map((segment) => segment.connectionState)).toEqual(["connected", "connected"]);
    expect(getGeodesicTail(registry, "g-a")).toMatchObject({ terminal: { kind: "emitter-hit", emitterId: "cannon-b" } });
    expect(getGeodesicTail(registry, "g-a")?.tooltip).toEqual({
      label: "Geodesic G1",
      rangeMeters: 6,
    });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    const continuationId = "g-a:continuation:cannon-b";
    expect(isGeodesicLocked(registry, continuationId)).toBe(false);
    expect(getGeodesicEndpointAttachmentsForAnchor(registry, "cannon-b").map((attachment) => attachment.geodesicId).sort())
      .toEqual(["g-a", continuationId]);
    expect(getCannonGeodesicYaw(registry, "cannon-b", "g-a")).toBeCloseTo(Math.PI);
    expect(extendGeodesic({ world, registry, geodesicId: "g-a" })).toBeUndefined();
    expect(extendGeodesic({ world, registry, geodesicId: continuationId })).toBeDefined();
  });

  it("refuses to place an emitter where splitting would create a tiny segment", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    registry.add(cannon);
    const segment = shootGeodesic({ world, registry, cannon, geodesicId: "g-a" });

    const result = placeGeodesicCannonOnGeodesic({
      world,
      registry,
      geodesicId: "g-a",
      segmentId: segment.id,
      distanceAlongSegmentMeters: minGeodesicSegmentLengthMeters / 2,
      aimYawRadians: 0,
      id: "cannon-b",
    });

    expect(result.placed).toBe(false);
    expect(registry.get("cannon-b")).toBeUndefined();
    expect(getGeodesicTail(registry, "g-a")?.terminal.kind).toBe("open");
  });

  it("places an incoming emitter on the selected geodesic when the source owns multiple geodesics", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    registry.add(cannon);
    const first = shootGeodesic({ world, registry, cannon, geodesicId: "g-a" });
    const updatedCannon = registry.get("cannon-a");
    if (updatedCannon?.kind !== "geodesic-cannon") {
      throw new Error("Expected updated geodesic cannon.");
    }

    shootGeodesic({
      world,
      registry,
      cannon: {
        ...updatedCannon,
        aimYawRadians: Math.PI / 2,
        localPose: yawRigidTransform3(Math.PI / 2, updatedCannon.localPose.translation),
      },
      geodesicId: "g-b",
    });

    const result = placeGeodesicCannonOnGeodesic({
      world,
      registry,
      geodesicId: "g-a",
      segmentId: first.id,
      distanceAlongSegmentMeters: 1,
      aimYawRadians: Math.PI / 2,
      id: "cannon-b",
    });

    expect(result.placed).toBe(true);
    const tail = getGeodesicTail(registry, "g-a");
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(1);
    expect(tail).toMatchObject({ terminal: { kind: "emitter-hit", emitterId: "cannon-b" } });
    expect(getGeodesicSegments(registry, "g-b").length).toBeGreaterThan(0);
    expect(getGeodesicTail(registry, "g-b")?.terminal.kind).not.toBe("emitter-hit");
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-a")).toBeCloseTo(0);
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-b")).toBeCloseTo(Math.PI / 2);
    expect(getCannonGeodesicYaw(registry, "cannon-b", "g-a")).toBeCloseTo(Math.PI);
  });

  it("connects immediately when an aimed geodesic reaches an emitter", () => {
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

    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(2.5);
    expect(getGeodesicTail(registry, "g-a")?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    expect(getGeodesicTail(registry, "g-a")?.tooltip).toEqual({
      label: "Geodesic G1",
      rangeMeters: 6,
    });
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-a"]);
    expect(getCannonGeodesicYaw(registry, "cannon-b", "g-a")).toBeCloseTo(Math.PI);
  });

  it("recomputes an emitter-hit lock so the segment lands on the emitter pole", () => {
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

    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 4 });

    const tail = getGeodesicTail(registry, "g-a");
    if (!tail) {
      throw new Error("Expected a locked geodesic tail.");
    }
    const endpoint = {
      x: tail.start.x + tail.direction.x * tail.lengthMeters,
      y: tail.start.y + tail.direction.y * tail.lengthMeters,
      z: tail.start.z + tail.direction.z * tail.lengthMeters,
    };

    expect(tail.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    expect(endpoint.x).toBeCloseTo(1);
    expect(endpoint.y).toBeCloseTo(0.05);
    expect(endpoint.z).toBeCloseTo(geodesicRayBeamHeightMeters);
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(Math.hypot(2.5, 0.05));
  });

  it("connects a looped-world geodesic back to its source emitter", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 4, y: 0, z: 0 }),
    });
    registry.add(source);

    rebuildGeodesicToLength({
      world,
      registry,
      cannon: source,
      geodesicId: "g-a",
      totalLengthMeters: 15,
    });

    const segments = getGeodesicSegments(registry, "g-a");
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments.map((segment) => segment.cellId).every((cellId) => cellId === "torus-room")).toBe(true);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).not.toHaveLength(0);
    expect(getGeodesicTail(registry, "g-a")).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-a" },
      connectionState: "connected",
    });
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-a",
      state: "connected",
    });
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual(["g-a"]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(getGeodesicEndpointAttachmentsForAnchor(registry, "cannon-a").map((attachment) => attachment.role).sort())
      .toEqual(["end", "start"]);
  });

  it("does not connect to emitters during preview rebuilds", () => {
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
      connectEmitters: false,
    });

    expect(getGeodesicTail(registry, "g-a")?.terminal.kind).toBe("open");
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(4);
    expect(isGeodesicLocked(registry, "g-a")).toBe(false);
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      state: "open",
    });
  });

  it("does not connect until extension reaches the target emitter", () => {
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

    const first = shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 1 });
    const second = extendGeodesic({ world, registry, geodesicId: "g-a", maxLengthMeters: 3 });

    expect(first.terminal.kind).toBe("open");
    expect(second?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("deleting a connected geodesic removes association from both emitters", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a"],
      geodesicEmitterYawRadiansById: { "g-a": 0 },
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    connectGeodesicToEmitter({
      world,
      registry,
      geodesicId: "g-a",
      incomingEmitterId: "cannon-b",
      totalLengthMeters: 2.3,
    });

    removeGeodesic(registry, "g-a");

    expect(getGeodesicSegments(registry, "g-a")).toHaveLength(0);
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual([]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual([]);
  });
});
