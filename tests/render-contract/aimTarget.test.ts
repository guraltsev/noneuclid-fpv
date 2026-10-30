import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildPortalPathTables, type PortalRenderPath } from "../../src/cell-complex/portalPaths";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createAimInteraction } from "../../src/render/three/aimInteraction";
import { createPlacedFlagObject } from "../../src/world-objects/placedFlags";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import {
  createGeodesicCannonObject,
  geodesicRayBeamHeightMeters,
  type GeodesicIntersectionObject,
  type GeodesicSegmentObject,
} from "../../src/world-objects/geodesic/objects";
import { createProtractorAngleObject } from "../../src/world-objects/protractorTool";
import {
  getGeodesicEmitterAimCylinderBounds,
  getGeodesicEmitterAimSphereCenter,
  resolveAimTarget,
  resolveAimTargets,
} from "../../src/render/three/aimTarget";
import { rigidTransformToThreeMatrix, worldPointToThree } from "../../src/render/three/worldAxes";

describe("resolveAimTarget", () => {
  it("resolves the floor point in the current cell", () => {
    const world = compileCellComplex(singleRoomWorld());
    const registry = createRuntimeObjectRegistry();
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: 1.5 }, { x: 0, y: 0, z: 0 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("floor");
    expect(target?.cellId).toBe("room");
    expect(target?.localPoint.x).toBeCloseTo(0);
    expect(target?.localPoint.y).toBeCloseTo(0);
    expect(target?.localPoint.z).toBeCloseTo(0);
    expect(target?.localNormal).toEqual({ x: 0, y: 0, z: 1 });
    expect(target?.rootNormal.x).toBeCloseTo(0);
    expect(target?.rootNormal.y).toBeCloseTo(0);
    expect(target?.rootNormal.z).toBeCloseTo(1);
  });

  it("resolves collidable runtime objects before the floor behind them", () => {
    const world = compileCellComplex(singleRoomWorld());
    const flag = createPlacedFlagObject({
      id: "flag-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      flagType: "WoodenSign1",
    });
    const registry = createRuntimeObjectRegistry([flag]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: 0.575 }, { x: 0, y: 0, z: 0.575 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("flag-a");
    expect(target?.localNormal.x).toBeCloseTo(0);
    expect(target?.localNormal.y).toBeCloseTo(-1);
    expect(target?.localNormal.z).toBeCloseTo(0);
  });

  it("selects geodesic emitters beyond the ordinary aim distance", () => {
    const world = compileCellComplex(largeRoomWorld());
    const emitter = createGeodesicCannonObject({
      id: "emitter-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 40, y: 0, z: 0 }),
    });
    const registry = createRuntimeObjectRegistry([emitter]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const sphereCenter = getGeodesicEmitterAimSphereCenter(emitter);
    const camera = cameraLookingAt(
      { x: 0, y: 0, z: sphereCenter.z },
      { x: 40, y: 0.18, z: sphereCenter.z },
    );

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
      maxDistanceMeters: 24,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("emitter-a");
    expect(target?.localPoint).toEqual(sphereCenter);
    expect(target?.distanceMeters).toBeGreaterThan(39);
  });

  it("lowers the geodesic emitter top aim sphere by 0.3 meters", () => {
    const emitter = createGeodesicCannonObject({
      id: "emitter-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 40, y: 0, z: 0 }),
    });

    expect(getGeodesicEmitterAimSphereCenter(emitter)).toEqual({
      x: 40,
      y: 0,
      z: geodesicRayBeamHeightMeters - 0.3,
    });
  });

  it("uses a halved geodesic emitter aim cylinder radius", () => {
    const emitter = createGeodesicCannonObject({
      id: "emitter-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 40, y: 0, z: 0 }),
    });

    const bounds = getGeodesicEmitterAimCylinderBounds(emitter);

    expect(bounds?.radius).toBeCloseTo(0.19);
  });

  it("misses geodesic emitters just outside the narrowed cylindrical aim outline", () => {
    const world = compileCellComplex(largeRoomWorld());
    const emitter = createGeodesicCannonObject({
      id: "emitter-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 40, y: 0, z: 0 }),
    });
    const registry = createRuntimeObjectRegistry([emitter]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: 0.2, z: 1.08 }, { x: 40, y: 0.2, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
      maxDistanceMeters: 24,
    });

    expect(target).toBeUndefined();
  });

  it("resolves a floor point in a visible destination cell", () => {
    const world = compileCellComplex(twoRoomPortalWorld());
    const registry = createRuntimeObjectRegistry();
    const pathTable = buildPortalPathTables(world, { maxDepth: 1 }).tablesByRootCellId.get("room-a")!;
    const destinationPath = pathTable.paths.find((path) => path.destinationCellId === "room-b")!;
    const rootTarget = destinationLocalPointInRoot(destinationPath, { x: 0, y: 0, z: 0 });
    const camera = cameraLookingAt({ x: 0, y: 0, z: 1.5 }, rootTarget);

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: "room-a",
    });

    expect(target?.kind).toBe("floor");
    expect(target?.cellId).toBe("room-b");
    expect(target?.localPoint.x).toBeCloseTo(0);
    expect(target?.localPoint.y).toBeCloseTo(0);
    expect(target?.localNormal).toEqual({ x: 0, y: 0, z: 1 });
    expect(target?.rootNormal.z).toBeCloseTo(1);
  });

  it("does not resolve floor aiming inside a forbidden zone", () => {
    const world = compileCellComplex(twoRoomPortalWorld());
    const registry = createRuntimeObjectRegistry();
    const pathTable = buildPortalPathTables(world, { maxDepth: 1 }).tablesByRootCellId.get("room-a")!;
    const destinationPath = pathTable.paths.find((path) => path.destinationCellId === "room-b")!;
    const rootTarget = destinationLocalPointInRoot(destinationPath, { x: -1, y: -1, z: 0 });
    const camera = cameraLookingAt({ x: 0, y: 0, z: 1.5 }, rootTarget);

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: "room-a",
    });

    expect(target).toBeUndefined();
  });

  it("resolves geodesic ray segments along the segment body", () => {
    const world = compileCellComplex(singleRoomWorld());
    const segment = createGeodesicSegment();
    const registry = createRuntimeObjectRegistry([segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: 1.08 }, { x: 0, y: 0, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-a");
    expect(target?.localPoint.x).toBeCloseTo(0);
    expect(target?.localPoint.z).toBeCloseTo(1.08);
  });

  it("resolves geodesic ray segments near their emitter when the smaller emitter hitbox is missed", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a"],
    });
    const segment = createGeodesicSegment({
      start: { x: 0, y: 0, z: 1.08 },
      lengthMeters: 2,
    });
    const registry = createRuntimeObjectRegistry([cannon, segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0.5, y: 0.12, z: 1.5 }, { x: 0.5, y: 0.12, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-a");
    expect(target?.localPoint.x).toBeCloseTo(0.5);
  });

  it("prioritizes geodesic emitters over overlapping geodesic ray segments", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a"],
    });
    const segment = createGeodesicSegment({
      start: { x: 0.2, y: 0, z: 1.08 },
      lengthMeters: 1.8,
    });
    const registry = createRuntimeObjectRegistry([cannon, segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -0.35, z: 1.08 }, { x: 0.8, y: 0, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("cannon-a");
  });

  it("reports the aimed geodesic id on geodesic emitter handles", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a", "g-b"],
      geodesicEmitterYawRadiansById: {
        "g-a": 0,
        "g-b": Math.PI / 2,
      },
    });
    const registry = createRuntimeObjectRegistry([cannon]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;

    const firstTarget = resolveAimTarget({
      world,
      registry,
      camera: cameraLookingAt(
        { x: 0.32, y: -2, z: geodesicRayBeamHeightMeters },
        { x: 0.32, y: 0, z: geodesicRayBeamHeightMeters },
      ),
      rootCellId: rootPath.destinationCellId,
    });
    const secondTarget = resolveAimTarget({
      world,
      registry,
      camera: cameraLookingAt(
        { x: 2, y: 0.32, z: geodesicRayBeamHeightMeters },
        { x: 0, y: 0.32, z: geodesicRayBeamHeightMeters },
      ),
      rootCellId: rootPath.destinationCellId,
    });

    expect(firstTarget?.object?.id).toBe("cannon-a");
    expect(firstTarget?.geodesicEmitterGeodesicId).toBe("g-a");
    expect(secondTarget?.object?.id).toBe("cannon-a");
    expect(secondTarget?.geodesicEmitterGeodesicId).toBe("g-b");
  });

  it("still resolves other geodesic emitter handles while one handle is ignored", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a", "g-b"],
      geodesicEmitterYawRadiansById: {
        "g-a": 0,
        "g-b": Math.PI / 2,
      },
    });
    const registry = createRuntimeObjectRegistry([cannon]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;

    const target = resolveAimTarget({
      world,
      registry,
      camera: cameraLookingAt(
        { x: 2, y: 0.32, z: geodesicRayBeamHeightMeters },
        { x: 0, y: 0.32, z: geodesicRayBeamHeightMeters },
      ),
      rootCellId: rootPath.destinationCellId,
      ignoredGeodesicIds: ["g-a"],
    });

    expect(target?.object?.id).toBe("cannon-a");
    expect(target?.geodesicEmitterGeodesicId).toBe("g-b");
  });

  it("reports the next available geodesic id when an ignored geodesic is aimed through the emitter body", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a", "g-b"],
      geodesicEmitterYawRadiansById: {
        "g-a": 0,
        "g-b": Math.PI / 2,
      },
    });
    const registry = createRuntimeObjectRegistry([cannon]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;

    const target = resolveAimTarget({
      world,
      registry,
      camera: cameraLookingAt(
        { x: 0, y: -2, z: geodesicRayBeamHeightMeters - 0.3 },
        { x: 0, y: 0, z: geodesicRayBeamHeightMeters - 0.3 },
      ),
      rootCellId: rootPath.destinationCellId,
      ignoredGeodesicIds: ["g-a"],
    });

    expect(target?.object?.id).toBe("cannon-a");
    expect(target?.geodesicEmitterGeodesicId).toBe("g-b");
  });

  it("misses geodesic emitter handle capsules outside the narrowed radius", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a"],
    });
    const registry = createRuntimeObjectRegistry([cannon]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const bodyTarget = resolveAimTarget({
      world,
      registry,
      camera: cameraLookingAt(
        { x: 0.5, y: 0.14, z: 1.5 },
        { x: 0.5, y: 0.14, z: geodesicRayBeamHeightMeters },
      ),
      rootCellId: rootPath.destinationCellId,
      maxDistanceMeters: 0.5,
    });
    const endTarget = resolveAimTarget({
      world,
      registry,
      camera: cameraLookingAt(
        { x: 0.85, y: 0.14, z: 1.5 },
        { x: 0.85, y: 0.14, z: geodesicRayBeamHeightMeters },
      ),
      rootCellId: rootPath.destinationCellId,
      maxDistanceMeters: 0.5,
    });

    expect(bodyTarget).toBeUndefined();
    expect(endTarget).toBeUndefined();
  });

  it("keeps short geodesic ray segments selectable near their emitter when the emitter hitbox is missed", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
      activeGeodesicId: "g-a",
      geodesicIds: ["g-a"],
    });
    const segment = createGeodesicSegment({
      start: { x: 0.2, y: 0, z: 1.08 },
      lengthMeters: 0.8,
    });
    const registry = createRuntimeObjectRegistry([cannon, segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0.95, y: -2, z: 1.08 }, { x: 0.95, y: 0, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-a");
    expect(target?.localPoint.x).toBeCloseTo(0.95);
  });

  it("prioritizes geodesic intersection balloons over overlapping geodesic ray segments", () => {
    const world = compileCellComplex(singleRoomWorld());
    const segment = createGeodesicSegment({
      start: { x: -0.5, y: 0, z: 1.08 },
      lengthMeters: 1,
    });
    const vertex = createGeodesicIntersection({
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 1.23 }),
    });
    const registry = createRuntimeObjectRegistry([segment, vertex]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: 1.23 }, { x: 0, y: 0, z: 1.23 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("vertex-a");
    expect(target?.object?.kind).toBe("geodesic-intersection");
  });

  it("prioritizes geodesic emitters over overlapping geodesic intersection balloons", () => {
    const world = compileCellComplex(singleRoomWorld());
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    });
    const sphereCenter = getGeodesicEmitterAimSphereCenter(cannon);
    const vertex = createGeodesicIntersection({
      localPose: yawRigidTransform3(0, sphereCenter),
    });
    const registry = createRuntimeObjectRegistry([vertex, cannon]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: sphereCenter.z }, sphereCenter);

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("cannon-a");
  });

  it("snaps sticky object aim targets to their declared local point", () => {
    const world = compileCellComplex(singleRoomWorld());
    const vertex = createGeodesicIntersection({
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 1.33 }),
      aimStickyTarget: {
        localPoint: { x: 0, y: 0, z: 1.08 },
      },
    });
    const registry = createRuntimeObjectRegistry([vertex]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: 1.33 }, { x: 0, y: 0, z: 1.33 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("vertex-a");
    expect(target?.localPoint).toEqual({ x: 0, y: 0, z: 1.08 });
    expect(target?.rootPoint.z).toBeCloseTo(1.08);
  });

  it("resolves protractor angles from the floating label hitbox", () => {
    const world = compileCellComplex(singleRoomWorld());
    const angle = createProtractorAngle({
      centerPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    });
    const registry = createRuntimeObjectRegistry([angle]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const labelCenter = angle.labelHitbox?.center;
    if (!labelCenter) {
      throw new Error("Expected protractor angle label hitbox.");
    }
    const camera = cameraLookingAt(
      { x: labelCenter.x, y: -2, z: labelCenter.z },
      labelCenter,
    );

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("angle-a");
    expect(target?.localPoint).toEqual(labelCenter);
  });

  it("misses protractor angles outside their floating label hitbox", () => {
    const world = compileCellComplex(singleRoomWorld());
    const angle = createProtractorAngle({
      centerPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    });
    const registry = createRuntimeObjectRegistry([angle]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const labelCenter = angle.labelHitbox?.center;
    if (!labelCenter) {
      throw new Error("Expected protractor angle label hitbox.");
    }
    const camera = cameraLookingAt(
      { x: labelCenter.x + 0.5, y: -2, z: labelCenter.z },
      { x: labelCenter.x + 0.5, y: labelCenter.y, z: labelCenter.z },
    );

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target).toBeUndefined();
  });

  it("prioritizes protractor angles over overlapping geodesic emitters", () => {
    const world = compileCellComplex(singleRoomWorld());
    const angle = createProtractorAngle({
      centerPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    });
    const labelCenter = angle.labelHitbox?.center;
    if (!labelCenter) {
      throw new Error("Expected protractor angle label hitbox.");
    }
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "room",
      localPose: yawRigidTransform3(0, {
        x: labelCenter.x,
        y: labelCenter.y,
        z: labelCenter.z - (geodesicRayBeamHeightMeters - 0.3),
      }),
    });
    const registry = createRuntimeObjectRegistry([cannon, angle]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt(
      { x: labelCenter.x, y: -2, z: labelCenter.z },
      labelCenter,
    );

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("angle-a");
  });

  it("prioritizes protractor angles over overlapping geodesic intersection vertices", () => {
    const world = compileCellComplex(singleRoomWorld());
    const angle = createProtractorAngle({
      centerPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    });
    const labelCenter = angle.labelHitbox?.center;
    if (!labelCenter) {
      throw new Error("Expected protractor angle label hitbox.");
    }
    const vertex = createGeodesicIntersection({
      localPose: yawRigidTransform3(0, labelCenter),
    });
    const registry = createRuntimeObjectRegistry([vertex, angle]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt(
      { x: labelCenter.x, y: -2, z: labelCenter.z },
      labelCenter,
    );

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("angle-a");
  });

  it("ignores geodesic ray segments for a selected geodesic when requested", () => {
    const world = compileCellComplex(singleRoomWorld());
    const segment = createGeodesicSegment({ geodesicId: "g-active" });
    const registry = createRuntimeObjectRegistry([segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: 1.08 }, { x: 0, y: 0, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
      ignoredGeodesicIds: ["g-active"],
    });

    expect(target).toBeUndefined();
  });

  it("still resolves geodesic ray segments from other geodesics while one geodesic is ignored", () => {
    const world = compileCellComplex(singleRoomWorld());
    const segment = createGeodesicSegment({ geodesicId: "g-other" });
    const registry = createRuntimeObjectRegistry([segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0, y: -2, z: 1.08 }, { x: 0, y: 0, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
      ignoredGeodesicIds: ["g-active"],
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-a");
  });

  it("resolves the tail geodesic ray segment before the floor below it", () => {
    const world = compileCellComplex(singleRoomWorld());
    const first = createGeodesicSegment({ id: "segment-a", start: { x: -0.9, y: 0, z: 1.08 }, lengthMeters: 0.6 });
    const tail = createGeodesicSegment({
      id: "segment-b",
      segmentIndex: 1,
      start: { x: -0.3, y: 0, z: 1.08 },
      lengthMeters: 0.8,
    });
    const registry = createRuntimeObjectRegistry([first, tail]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: 0.2, y: -2, z: 1.08 }, { x: 0.2, y: 0, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-b");
    expect(target?.localPoint.x).toBeCloseTo(0.2);
    expect(target?.localPoint.z).toBeCloseTo(1.08);
  });

  it("resolves geodesic ray segments from a shallow first-person angle", () => {
    const world = compileCellComplex(singleRoomWorld());
    const segment = createGeodesicSegment({
      start: { x: -0.4, y: 0, z: 1.08 },
      direction: { x: 0.984183, y: 0.177153, z: 0 },
      lengthMeters: 1.2,
    });
    const registry = createRuntimeObjectRegistry([segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: -0.7, y: -0.25, z: 1.05 }, { x: 0.45, y: 0.08, z: 1.02 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-a");
  });

  it("reports the geodesic centerline point for shallow far segment hits", () => {
    const world = compileCellComplex(singleRoomWorld());
    const segment = createGeodesicSegment({
      start: { x: -0.8, y: 0, z: 1.08 },
      lengthMeters: 1.8,
    });
    const registry = createRuntimeObjectRegistry([segment]);
    const rootPath = buildPortalPathTables(world, { maxDepth: 0 }).tablesByRootCellId.get("room")!.pathsById.get(0)!;
    const camera = cameraLookingAt({ x: -3.5, y: -0.9, z: 1.08 }, { x: 0.55, y: 0, z: 1.08 });

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: rootPath.destinationCellId,
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-a");
    expect(target?.localPoint.x).toBeCloseTo(0.55, 1);
    expect(target?.localPoint.y).toBeCloseTo(0);
    expect(target?.geodesicSegmentDistanceMeters).toBeCloseTo(1.35, 1);
  });

  it("resolves geodesic ray segment instances through visible portal paths", () => {
    const world = compileCellComplex(twoRoomPortalWorld());
    const segment = createGeodesicSegment({
      cellId: "room-b",
      start: { x: -0.5, y: 0, z: 1.08 },
      localPose: yawRigidTransform3(0, { x: -0.5, y: 0, z: 1.08 }),
    });
    const registry = createRuntimeObjectRegistry([segment]);
    const pathTable = buildPortalPathTables(world, { maxDepth: 1 }).tablesByRootCellId.get("room-a")!;
    const destinationPath = pathTable.paths.find((path) => path.destinationCellId === "room-b")!;
    const rootTarget = destinationLocalPointInRoot(destinationPath, { x: 0, y: 0, z: 1.08 });
    const camera = cameraLookingAt({ x: 0, y: 0, z: 1.08 }, rootTarget);

    const target = resolveAimTarget({
      world,
      registry,
      camera,
      rootCellId: "room-a",
    });

    expect(target?.kind).toBe("object");
    expect(target?.object?.id).toBe("segment-a");
    expect(target?.cellId).toBe("room-b");
    expect(target?.hopCount).toBe(1);
  });
});

describe("ray walk", () => {
  const smallFlagCollision = { radius: 0.3, height: 1, offset: { x: 0, y: 0, z: 0.5 } };
  const flagIn = (cellId: string, x: number, y: number, id = "flag-b") =>
    createPlacedFlagObject({
      id,
      cellId,
      localPose: yawRigidTransform3(0, { x, y, z: 0 }),
      flagType: "WoodenSign1",
      collision: smallFlagCollision,
    });

  it("continues through a portal the ray really crosses and reports hops and root points", () => {
    const world = compileCellComplex(rayWalkWorld());
    const registry = createRuntimeObjectRegistry([flagIn("room-b", 0, 0)]);
    const targets = resolveAimTargets({
      world,
      registry,
      camera: cameraLookingAt({ x: 0, y: -0.5, z: 1.45 }, { x: 2, y: 0, z: 0.5 }),
      rootCellId: "room-a",
    });

    expect(targets[0]?.object?.id).toBe("flag-b");
    expect(targets[0]?.cellId).toBe("room-b");
    expect(targets[0]?.hopCount).toBe(1);
    expect(targets[0]?.rootPoint.x).toBeGreaterThan(1.5);
    expect(targets[0]?.rootPoint.x).toBeLessThan(2.5);
  });

  it("does not pick anything in the neighbour when the ray hits the wall beside the portal", () => {
    const world = compileCellComplex(rayWalkWorld());
    const registry = createRuntimeObjectRegistry([flagIn("room-b", 0.5, 0.8)]);
    const targets = resolveAimTargets({
      world,
      registry,
      camera: cameraLookingAt({ x: 0, y: 0.5, z: 0.5 }, { x: 0.8, y: 1, z: 0.5 }),
      rootCellId: "room-a",
    });

    expect(targets.filter((target) => target.cellId === "room-b")).toEqual([]);
    expect(targets).toEqual([]);
  });

  it("hits an object that straddles the entry portal exactly once", () => {
    const world = compileCellComplex(rayWalkWorld());
    const registry = createRuntimeObjectRegistry([flagIn("room-b", -0.9, 0)]);
    const targets = resolveAimTargets({
      world,
      registry,
      camera: cameraLookingAt({ x: 0, y: 0, z: 0.5 }, { x: 2, y: 0, z: 0.5 }),
      rootCellId: "room-a",
    });

    expect(targets.filter((target) => target.object?.id === "flag-b")).toHaveLength(1);
  });

  it("ignores the part of an object that pokes past the far wall", () => {
    const world = compileCellComplex(rayWalkWorld());
    const registry = createRuntimeObjectRegistry([flagIn("room-b", 0.9, 0.9)]);
    const targets = resolveAimTargets({
      world,
      registry,
      camera: cameraLookingAt({ x: 0, y: 0, z: 0.5 }, { x: 2.9, y: 1.15, z: 0.5 }),
      rootCellId: "room-a",
    });

    expect(targets).toEqual([]);
  });

  it("stops at a lower target cell when the ray crosses the portal above its ceiling", () => {
    const world = compileCellComplex(rayWalkWorld(1));
    const registry = createRuntimeObjectRegistry([flagIn("room-b", 0.5, 0)]);
    const through = resolveAimTargets({
      world,
      registry,
      camera: cameraLookingAt({ x: 0, y: 0, z: 1.45 }, { x: 1, y: 0, z: 1.2 }),
      rootCellId: "room-a",
    });
    const below = resolveAimTargets({
      world,
      registry,
      camera: cameraLookingAt({ x: 0, y: 0, z: 0.9 }, { x: 1, y: 0, z: 0.8 }),
      rootCellId: "room-a",
    });

    expect(through).toEqual([]);
    expect(below[0]?.object?.id).toBe("flag-b");
  });

  it("picks the floor of the origin cell for a vertical ray", () => {
    const world = compileCellComplex(rayWalkWorld());
    const targets = resolveAimTargets({
      world,
      registry: createRuntimeObjectRegistry(),
      camera: cameraLookingAt({ x: 0, y: 0, z: 1.5 }, { x: 0, y: 0, z: 0 }),
      rootCellId: "room-a",
    });

    expect(targets[0]?.kind).toBe("floor");
    expect(targets[0]?.cellId).toBe("room-a");
    expect(targets[0]?.hopCount).toBe(0);
  });

  it("starts in the cell that holds a ray origin held through a portal", () => {
    const world = compileCellComplex(rayWalkWorld());
    const targets = resolveAimTargets({
      world,
      registry: createRuntimeObjectRegistry(),
      camera: cameraLookingAt({ x: 1.2, y: 0, z: 1.4 }, { x: 1.2, y: 0, z: 0 }),
      rootCellId: "room-a",
      rootAnchorPoint: { x: 0.8, y: 0, z: 1.4 },
    });

    expect(targets[0]?.kind).toBe("floor");
    expect(targets[0]?.cellId).toBe("room-b");
    expect(targets[0]?.hopCount).toBe(0);
    expect(targets[0]?.localPoint.x).toBeCloseTo(-0.8);
    expect(targets[0]?.localPoint.y).toBeCloseTo(0);
    expect(targets[0]?.rootPoint.x).toBeCloseTo(1.2);
    expect(targets[0]?.rootPoint.y).toBeCloseTo(0);
    expect(targets[0]?.rootPoint.z).toBeCloseTo(0);
  });

  it("resolves once per distinct ray and frame through the aim interaction", () => {
    const world = compileCellComplex(rayWalkWorld());
    const registry = createRuntimeObjectRegistry();
    const resolver = vi.fn(resolveAimTargets);
    let frameSerial = 1;
    const interaction = createAimInteraction({
      camera: new THREE.PerspectiveCamera(),
      renderer: {} as THREE.WebGLRenderer,
      xrRig: {} as never,
      runtimeObjectRegistry: registry,
      getWorld: () => world,
      getDebugLevel: () => "off" as never,
      getMenuState: () => ({ selectedTool: "none" }) as never,
      getCannonToolState: () => ({ activeGeodesicId: undefined }) as never,
      getPlayerPose: () => ({ cellId: "room-a", position: { x: 0, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 }),
      getFrameSerial: () => frameSerial,
      resolveAimTargets: resolver,
    });
    const camera = cameraLookingAt({ x: 0, y: 0, z: 1.5 }, { x: 0.5, y: 0.5, z: 0 });
    const ray = {
      origin: camera.position.clone(),
      direction: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
      quaternion: camera.quaternion.clone(),
    };

    interaction.resolveCurrentAimTargets(ray);
    interaction.resolveCurrentAimTargets(ray);
    interaction.resolveCurrentAimTarget(ray);
    expect(resolver).toHaveBeenCalledTimes(1);

    interaction.invalidateAimCache();
    interaction.resolveCurrentAimTargets(ray);
    expect(resolver).toHaveBeenCalledTimes(2);

    frameSerial = 2;
    interaction.resolveCurrentAimTargets(ray);
    expect(resolver).toHaveBeenCalledTimes(3);
  });
});

// room-a (north, south, west walls; east portal) glued to room-b (west portal), both 2 m by 2 m; room-b sits at x = 2 in room-a's frame.
function rayWalkWorld(roomBHeightMeters = 2): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareBase(),
        portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
      },
      {
        id: "room-b",
        heightMeters: roomBHeightMeters,
        baseVertices: squareBase(),
        portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
      },
    ],
  };
}
function cameraLookingAt(
  position: { readonly x: number; readonly y: number; readonly z: number },
  target: { readonly x: number; readonly y: number; readonly z: number },
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 100);
  camera.position.copy(worldPointToThree(position));
  camera.lookAt(worldPointToThree(target));
  camera.updateMatrixWorld(true);
  return camera;
}

function destinationLocalPointInRoot(
  path: PortalRenderPath,
  point: { readonly x: number; readonly y: number; readonly z: number },
): { readonly x: number; readonly y: number; readonly z: number } {
  const rootPoint = worldPointToThree(point).applyMatrix4(rigidTransformToThreeMatrix(path.rootFromDestination));
  return {
    x: rootPoint.x,
    y: -rootPoint.z,
    z: rootPoint.y,
  };
}

function singleRoomWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 3,
        baseVertices: squareBase(),
        portals: [],
      },
    ],
  };
}

function largeRoomWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room",
        heightMeters: 3,
        baseVertices: [
          { x: -100, y: -100 },
          { x: 100, y: -100 },
          { x: 100, y: 100 },
          { x: -100, y: 100 },
        ],
        portals: [],
      },
    ],
  };
}

function twoRoomPortalWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 3,
        baseVertices: squareBase(),
        portals: [
          {
            id: "north",
            sideIndex: 2,
            targetCellId: "room-b",
            targetPortalId: "south",
          },
        ],
      },
      {
        id: "room-b",
        heightMeters: 3,
        baseVertices: squareBase(),
        portals: [
          {
            id: "south",
            sideIndex: 0,
            targetCellId: "room-a",
            targetPortalId: "north",
          },
        ],
      },
    ],
  };
}

function squareBase(): readonly { readonly x: number; readonly y: number }[] {
  return [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
}

function createGeodesicSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "segment-a",
    kind: "geodesic-segment",
    cellId: "room",
    localPose: yawRigidTransform3(0, { x: -0.5, y: 0, z: 1.08 }),
    portalRenderable: true,
    tooltip: {
      label: "Geodesic",
      rangeMeters: 6,
    },
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: -0.5, y: 0, z: 1.08 },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 1,
    terminal: { kind: "open" },
    ...overrides,
  };
}

function createGeodesicIntersection(overrides: Partial<GeodesicIntersectionObject> = {}): GeodesicIntersectionObject {
  return {
    id: "vertex-a",
    kind: "geodesic-intersection",
    cellId: "room",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 1.23 }),
    portalRenderable: true,
    tooltip: {
      label: "vertex",
      rangeMeters: 3,
    },
    geodesicIds: ["g-a", "g-b"],
    segmentIds: ["segment-a", "segment-b"],
    ...overrides,
  };
}

function createProtractorAngle(options: {
  readonly centerPoint: { readonly x: number; readonly y: number; readonly z: number };
}) {
  return createProtractorAngleObject({
    id: "angle-a",
    center: {
      objectId: "vertex-a",
      cellId: "room",
      point: options.centerPoint,
      geodesicIds: ["g-a", "g-b"],
    },
    first: {
      geodesicId: "g-a",
      segmentId: "segment-a",
      yawRadians: 0,
    },
    second: {
      geodesicId: "g-b",
      segmentId: "segment-b",
      yawRadians: Math.PI / 2,
    },
  });
}
