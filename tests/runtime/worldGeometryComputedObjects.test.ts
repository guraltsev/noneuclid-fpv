import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { vec3 } from "../../src/math/vec3";
import { applyGeometryCommitComputedObjectPolicy } from "../../src/runtime/worldGeometryComputedObjects";
import {
  createGeodesicCannonObject,
  geodesicRayBeamHeightMeters,
  getGeodesicSegments,
  getGeodesicTail,
  isGeodesicLocked,
  shootGeodesic,
} from "../../src/world-objects/geodesicCannon";
import { createMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import {
  createProtractorAngleObject,
  protractorAngleRadiusMeters,
  resolveProtractorCenterSelection,
  resolveProtractorDirectedGeodesicSelection,
  resolveProtractorEmitterGeodesicSelection,
  type ProtractorAngleObject,
} from "../../src/world-objects/protractorTool";
import {
  createRuntimeObjectRegistry,
  type RuntimeWorldObject,
} from "../../src/world-objects/runtimeObjectRegistry";

describe("world geometry computed object policy", () => {
  it("clears unlocked geodesics and attached computed objects after a geometry commit", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, vec3(-1.5, 0, 0)),
    });
    registry.add(cannon);
    shootGeodesic({ world, registry, cannon, geodesicId: "g-open", maxLengthMeters: 1.5 });
    const measurement = createMeasuredGeodesicLengthObject({
      id: "measure-open",
      registry,
      geodesicId: "g-open",
      playerCellId: "a",
      playerPoint: vec3(-0.75, 0, geodesicRayBeamHeightMeters),
    });
    if (!measurement) {
      throw new Error("Expected open geodesic measurement fixture.");
    }
    registry.add(measurement);
    registry.add(createProtractorFixture("angle-open", "cannon-a", "g-open"));

    const removedMeasurements: string[] = [];
    const removedAngles: string[] = [];
    const result = applyGeometryCommitComputedObjectPolicy({
      world,
      registry,
      playerCellId: "a",
      playerPoint: vec3(0, 0, geodesicRayBeamHeightMeters),
      callbacks: {
        removeMeasuredGeodesicLength: (id) => removedMeasurements.push(id),
        removeProtractorAngle: (id) => removedAngles.push(id),
      },
    });

    expect(isGeodesicLocked(registry, "g-open")).toBe(false);
    expect(result.removedGeodesicIds).toContain("g-open");
    expect(result.removedMeasuredGeodesicLengthIds).toEqual(["measure-open"]);
    expect(result.removedProtractorAngleIds).toEqual(["angle-open"]);
    expect(removedMeasurements).toEqual(["measure-open"]);
    expect(removedAngles).toEqual(["angle-open"]);
    expect(getGeodesicSegments(registry, "g-open")).toHaveLength(0);
    expect(registry.get("measure-open")).toBeUndefined();
    expect(registry.get("angle-open")).toBeUndefined();
    expect(cannonGeodesicIds(registry.get("cannon-a"))).not.toContain("g-open");
  });

  it("rebuilds locked geodesics and refreshes attached measurements and protractor angles", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const leftSource = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, vec3(-1.5, 0, 0)),
    });
    const lowerSource = createGeodesicCannonObject({
      id: "cannon-c",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI / 2, vec3(1, -2, 0)),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, vec3(1, 0, 0)),
    });
    registry.add(leftSource);
    registry.add(lowerSource);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: leftSource, geodesicId: "g-a", maxLengthMeters: 4 });
    shootGeodesic({ world, registry, cannon: lowerSource, geodesicId: "g-b", maxLengthMeters: 4 });
    const measurement = createMeasuredGeodesicLengthObject({
      id: "measure-g-a",
      registry,
      geodesicId: "g-a",
      playerCellId: "a",
      playerPoint: vec3(0, 0, geodesicRayBeamHeightMeters),
    });
    if (!measurement) {
      throw new Error("Expected locked geodesic measurement fixture.");
    }
    registry.add(measurement);
    registry.add(createIncomingEmitterAngle(registry.get("cannon-b")));
    const previousLength = measurement.lengthMeters;
    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, vec3(1, 1, 0)),
    });

    const syncedMeasurements: string[] = [];
    const syncedAngles: string[] = [];
    const result = applyGeometryCommitComputedObjectPolicy({
      world,
      registry,
      playerCellId: "a",
      playerPoint: vec3(0, 0, geodesicRayBeamHeightMeters),
      callbacks: {
        syncMeasuredGeodesicLength: (object) => syncedMeasurements.push(object.id),
        syncProtractorAngle: (object) => syncedAngles.push(object.id),
      },
    });

    expect([...result.rebuiltGeodesicIds].sort()).toEqual(["g-a", "g-b"]);
    expect(result.failedLockedGeodesicIds).toEqual([]);
    expect(result.refreshedMeasuredGeodesicLengthIds).toContain("measure-g-a");
    expect(result.refreshedProtractorAngleIds).toContain("angle-incoming");
    expect(syncedMeasurements).toContain("measure-g-a");
    expect(syncedAngles).toContain("angle-incoming");
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(isGeodesicLocked(registry, "g-b")).toBe(true);
    expect(getGeodesicTail(registry, "g-a")?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    const refreshedMeasurement = registry.get("measure-g-a");
    expect(refreshedMeasurement?.kind).toBe("measured-geodesic-length");
    if (refreshedMeasurement?.kind === "measured-geodesic-length") {
      expect(refreshedMeasurement.lengthMeters).not.toBeCloseTo(previousLength);
    }
    const angle = registry.get("angle-incoming");
    expect(angle?.kind).toBe("protractor-angle");
    if (angle?.kind === "protractor-angle") {
      expect(angle.centerPoint.x).toBeCloseTo(1);
      expect(angle.centerPoint.y).toBeCloseTo(1);
      expect(angle.centerPoint.z).toBeCloseTo(geodesicRayBeamHeightMeters);
    }
  });

  it("keeps segment-selected angles while shared locked endpoints are rebuilt", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const leftSource = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, vec3(-1.5, 0, 0)),
    });
    const lowerSource = createGeodesicCannonObject({
      id: "cannon-c",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI / 2, vec3(1, -2, 0)),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, vec3(1, 0, 0)),
    });
    registry.add(leftSource);
    registry.add(lowerSource);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: leftSource, geodesicId: "g-a", maxLengthMeters: 4 });
    shootGeodesic({ world, registry, cannon: lowerSource, geodesicId: "g-b", maxLengthMeters: 4 });
    registry.add(createIncomingSegmentAngle(registry.get("cannon-b"), registry));
    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, vec3(1, 1, 0)),
    });

    const result = applyGeometryCommitComputedObjectPolicy({
      world,
      registry,
      playerCellId: "a",
      playerPoint: vec3(0, 0, geodesicRayBeamHeightMeters),
    });

    expect(result.removedProtractorAngleIds).toEqual([]);
    expect(result.refreshedProtractorAngleIds).toEqual(["angle-segment-incoming"]);
    expect(registry.get("angle-segment-incoming")?.kind).toBe("protractor-angle");
  });

  it("rebuilds locked interval geodesics even without legacy cannon-owned ids", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, vec3(-1.5, 0, 0)),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, vec3(1, 0, 0)),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 4 });
    for (const object of registry.getAll()) {
      if (object.kind === "geodesic-cannon") {
        registry.update({
          ...object,
          activeGeodesicId: undefined,
          geodesicIds: [],
          geodesicEmitterYawRadiansById: {},
          geodesicConnectionsById: {},
        });
      }
    }
    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, vec3(1, 1, 0)),
    });

    const result = applyGeometryCommitComputedObjectPolicy({
      world,
      registry,
      playerCellId: "a",
      playerPoint: vec3(0, 0, geodesicRayBeamHeightMeters),
    });

    expect(result.rebuiltGeodesicIds).toEqual(["g-a"]);
    expect(result.removedGeodesicIds).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(getGeodesicTail(registry, "g-a")?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
  });
});

function compileLargeWorld() {
  return compileCellComplex({
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
}

function createProtractorFixture(
  id: string,
  centerObjectId: string,
  geodesicId: string,
): ProtractorAngleObject {
  const centerPoint = vec3(0, 0, geodesicRayBeamHeightMeters);
  return {
    id,
    kind: "protractor-angle",
    cellId: "a",
    localPose: yawRigidTransform3(0, centerPoint),
    aimStickyTarget: { localPoint: centerPoint },
    portalRenderable: true,
    centerObjectId,
    centerPoint,
    first: {
      geodesicId,
      segmentId: `${centerObjectId}:${geodesicId}:emitter`,
      yawRadians: 0,
      directionSign: 1,
    },
    second: {
      geodesicId,
      segmentId: `${centerObjectId}:${geodesicId}:emitter`,
      yawRadians: Math.PI / 3,
      directionSign: 1,
    },
    angleRadians: Math.PI / 3,
    angleDegrees: 60,
    radiusMeters: protractorAngleRadiusMeters,
  };
}

function createIncomingEmitterAngle(object: RuntimeWorldObject | undefined): ProtractorAngleObject {
  if (object?.kind !== "geodesic-cannon") {
    throw new Error("Expected incoming emitter.");
  }

  const center = resolveProtractorCenterSelection(object);
  const first = resolveProtractorEmitterGeodesicSelection({ center, emitter: object, geodesicId: "g-a" });
  const second = resolveProtractorEmitterGeodesicSelection({ center, emitter: object, geodesicId: "g-b" });
  if (!first || !second) {
    throw new Error("Expected incoming emitter selections.");
  }

  return createProtractorAngleObject({
    id: "angle-incoming",
    center,
    first,
    second,
  });
}

function createIncomingSegmentAngle(
  object: RuntimeWorldObject | undefined,
  registry: ReturnType<typeof createRuntimeObjectRegistry>,
): ProtractorAngleObject {
  if (object?.kind !== "geodesic-cannon") {
    throw new Error("Expected incoming emitter.");
  }

  const center = resolveProtractorCenterSelection(object);
  const firstSegment = getGeodesicSegments(registry, "g-a").at(-1);
  const secondSegment = getGeodesicSegments(registry, "g-b").at(-1);
  if (!firstSegment || !secondSegment) {
    throw new Error("Expected incoming segments.");
  }

  const first = resolveProtractorDirectedGeodesicSelection({
    center,
    segment: firstSegment,
    hitPoint: center.point,
  });
  const second = resolveProtractorDirectedGeodesicSelection({
    center,
    segment: secondSegment,
    hitPoint: center.point,
  });
  if (!first || !second) {
    throw new Error("Expected incoming segment selections.");
  }

  return createProtractorAngleObject({
    id: "angle-segment-incoming",
    center,
    first,
    second,
  });
}

function cannonGeodesicIds(object: RuntimeWorldObject | undefined): readonly string[] {
  return object?.kind === "geodesic-cannon" ? object.geodesicIds : [];
}
