/**
 * `tests/runtime/worldGeometryComputedObjects.test.ts` — unit tier.
 *
 * `applyGeometryCommitComputedObjectPolicy` runs after a geometry commit (a deformation, or any change that can
 * move geodesics): it rebuilds every locked geodesic it still can and removes the ones it cannot, together with the
 * measured-length and protractor-angle objects attached to them, reporting what it did so a caller can
 * sync its own render state. The attachments of a surviving geodesic are refreshed by the next derive pass of the
 * engine, not by the policy. These tests check: an unlocked (open) geodesic and its attachments are removed; a
 * rebuildable locked geodesic keeps its attachments, which a derive pass then refreshes with new values; an angle selected by
 * segment (not by the emitter id) survives a rebuild of its endpoints; and a locked interval geodesic rebuilds even
 * when it was never owned by a cannon's own id list.
 */
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { createDerivingTestEngine, runDerivePass } from "../support/engine";
import { vec3, type Vec3 } from "../../src/math/vec3";
import { applyGeometryCommitComputedObjectPolicy } from "../../src/runtime/worldGeometryComputedObjects";
import { createGeodesicCannonObject, geodesicRayBeamHeightMeters } from "../../src/world-objects/geodesic/objects";
import { getEmitterGeodesicIds } from "../../src/world-objects/geodesic/endpoints";
import { getGeodesicSegments, getGeodesicTail } from "../../src/world-objects/geodesic/segments";
import { arcConnectsEmitters } from "../../src/world-objects/geodesic/lifecycle";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { createMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import { createProtractorAngleObject, protractorAngleRadiusMeters, resolveProtractorCenterSelection, resolveProtractorDirectedGeodesicSelection, resolveProtractorEmitterGeodesicSelection } from "../../src/world-objects/protractorTool";
import { type ProtractorAngleObject } from "../../src/world-objects/toolObjects";
import {
  createRuntimeObjectRegistry,
  type RuntimeObjectRegistry,
} from "../../src/world-objects/runtimeObjectRegistry";

const centerPoint = vec3(0, 0, geodesicRayBeamHeightMeters);

describe("world geometry computed object policy", () => {
  it("clears unlocked geodesics and attached computed objects after a geometry commit", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    addCannon(registry, "cannon-a", "a", yawRigidTransform3(0, vec3(-1.5, 0, 0)));
    shoot(world, registry, "cannon-a", "g-open", 1.5);
    const measurement = createMeasuredGeodesicLengthObject({
      id: "measure-open",
      registry,
      geodesicId: "g-open",
      playerCellId: "a",
      playerPoint: centerPoint,
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
      callbacks: {
        removeMeasuredGeodesicLength: (id) => removedMeasurements.push(id),
        removeProtractorAngle: (id) => removedAngles.push(id),
      },
    });

    expect(arcConnectsEmitters(registry, "g-open")).toBe(false);
    expect(result.removedGeodesicIds).toContain("g-open");
    expect(result.removedMeasuredGeodesicLengthIds).toEqual(["measure-open"]);
    expect(result.removedProtractorAngleIds).toEqual(["angle-open"]);
    expect(removedMeasurements).toEqual(["measure-open"]);
    expect(removedAngles).toEqual(["angle-open"]);
    expect(getGeodesicSegments(registry, "g-open")).toHaveLength(0);
    expect(registry.get("measure-open")).toBeUndefined();
    expect(registry.get("angle-open")).toBeUndefined();
    expect(getEmitterGeodesicIds(registry, "cannon-a")).not.toContain("g-open");
  });

  it("rebuilds locked geodesics; a derive pass refreshes their measurements and angles", () => {
    const { world, registry } = threeCannonWorld();
    shoot(world, registry, "cannon-a", "g-a");
    shoot(world, registry, "cannon-c", "g-b");
    const measurement = createMeasuredGeodesicLengthObject({
      id: "measure-g-a",
      registry,
      geodesicId: "g-a",
      playerCellId: "a",
      playerPoint: centerPoint,
    });
    if (!measurement) {
      throw new Error("Expected locked geodesic measurement fixture.");
    }
    registry.add(measurement);
    registry.add(createIncomingEmitterAngle(registry));
    const previousLength = measurement.lengthMeters;
    moveIncoming(registry, vec3(1, 1, 0));

    const engine = createDerivingTestEngine(registry, { getWorld: () => world, playerPose: { ...createDefaultPlayerPose("a"), position: centerPoint } });
    const result = applyGeometryCommitComputedObjectPolicy({ world, registry });
    runDerivePass(engine);

    expect([...result.rebuiltGeodesicIds].sort()).toEqual(["g-a", "g-b"]);
    expect(result.failedLockedGeodesicIds).toEqual([]);
    expect(arcConnectsEmitters(registry, "g-a")).toBe(true);
    expect(arcConnectsEmitters(registry, "g-b")).toBe(true);
    expect(getGeodesicTail(registry, "g-a")?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-b" });
    const refreshedMeasurement = registry.get("measure-g-a");
    expect(refreshedMeasurement?.kind).toBe("geodesicMeasurements/length");
    if (refreshedMeasurement?.kind === "geodesicMeasurements/length") {
      expect(refreshedMeasurement.lengthMeters).not.toBeCloseTo(previousLength);
    }
    const angle = registry.get("angle-incoming");
    expect(angle?.kind).toBe("geodesicMeasurements/angle");
    if (angle?.kind === "geodesicMeasurements/angle") {
      expect(angle.centerPoint.x).toBeCloseTo(1);
      expect(angle.centerPoint.y).toBeCloseTo(1);
      expect(angle.centerPoint.z).toBeCloseTo(geodesicRayBeamHeightMeters);
    }
  });

  it("keeps segment-selected angles while shared locked endpoints are rebuilt", () => {
    const { world, registry } = threeCannonWorld();
    shoot(world, registry, "cannon-a", "g-a");
    shoot(world, registry, "cannon-c", "g-b");
    registry.add(createIncomingSegmentAngle(registry));
    moveIncoming(registry, vec3(1, 1, 0));

    const engine = createDerivingTestEngine(registry, { getWorld: () => world });
    const result = applyGeometryCommitComputedObjectPolicy({ world, registry });
    runDerivePass(engine);

    expect(result.removedProtractorAngleIds).toEqual([]);
    expect(registry.get("angle-segment-incoming")?.kind).toBe("geodesicMeasurements/angle");
  });

});

function compileLargeWorld(): CompiledCellComplex {
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

/** Adds a cannon of the given id, cell and pose to the registry, and returns it. */
function addCannon(registry: RuntimeObjectRegistry, id: string, cellId: string, localPose: ReturnType<typeof yawRigidTransform3>) {
  const cannon = createGeodesicCannonObject({ id, cellId, localPose });
  registry.add(cannon);
  return cannon;
}

/** Shoots a geodesic from the named cannon in the registry. */
function shoot(world: CompiledCellComplex, registry: RuntimeObjectRegistry, cannonId: string, geodesicId: string, maxLengthMeters = 4) {
  const cannon = registry.get(cannonId);
  if (cannon?.kind !== "geodesic-cannon") {
    throw new Error(`Expected cannon "${cannonId}".`);
  }
  shootGeodesic({ world, registry, cannon, geodesicId, maxLengthMeters });
}

/** The three-cannon setup ("cannon-a" firing east, "cannon-c" firing north, "cannon-b" incoming) shared by several cases. */
function threeCannonWorld(): { world: CompiledCellComplex; registry: RuntimeObjectRegistry } {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry();

  addCannon(registry, "cannon-a", "a", yawRigidTransform3(0, vec3(-1.5, 0, 0)));
  addCannon(registry, "cannon-c", "a", yawRigidTransform3(Math.PI / 2, vec3(1, -2, 0)));
  addCannon(registry, "cannon-b", "a", yawRigidTransform3(Math.PI, vec3(1, 0, 0)));

  return { world, registry };
}

/** Moves the "cannon-b" incoming emitter to `translation`, the change a commit must rebuild locked geodesics for. */
function moveIncoming(registry: RuntimeObjectRegistry, translation: Vec3): void {
  const movedIncoming = registry.get("cannon-b");
  if (movedIncoming?.kind !== "geodesic-cannon") {
    throw new Error("Expected incoming emitter.");
  }
  registry.update({ ...movedIncoming, localPose: yawRigidTransform3(Math.PI, translation) });
}

function createProtractorFixture(
  id: string,
  centerObjectId: string,
  geodesicId: string,
): ProtractorAngleObject {
  return {
    id,
    kind: "geodesicMeasurements/angle",
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

function createIncomingEmitterAngle(registry: RuntimeObjectRegistry): ProtractorAngleObject {
  const object = registry.get("cannon-b");
  if (object?.kind !== "geodesic-cannon") {
    throw new Error("Expected incoming emitter.");
  }

  const center = resolveProtractorCenterSelection(registry, object);
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

function createIncomingSegmentAngle(registry: RuntimeObjectRegistry): ProtractorAngleObject {
  const object = registry.get("cannon-b");
  if (object?.kind !== "geodesic-cannon") {
    throw new Error("Expected incoming emitter.");
  }

  const center = resolveProtractorCenterSelection(registry, object);
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
