import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { moveDynamicObject } from "../../src/movement/moveDynamicObject";
import {
  createRuntimeObjectRegistry,
  runtimeObjectToDynamicObjectState,
} from "../../src/world-objects/runtimeObjectRegistry";
import {
  collectLockedIncidentGeodesicIdsForEmitter,
  advanceCurveShorteningPairs,
  advanceStraighteningGeodesics,
  createCurveShorteningPairObject,
  curveShorteningLengthIncreaseToleranceMeters,
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  collectGeodesicPortalWord,
  connectGeodesicToEmitter,
  extendGeodesic,
  geodesicRayBeamHeightMeters,
  geodesicRayBeamStartOffsetMeters,
  getGeodesicEndpointAttachmentsForAnchor,
  getGeodesicEndpoints,
  getGeodesicConnection,
  getGeodesicSegments,
  getGeodesicTail,
  getRememberedGeodesicIntersectionObject,
  isGeodesicLocked,
  isGeodesicStraightening,
  minGeodesicSegmentLengthMeters,
  placeGeodesicCannonAtGeodesicVertex,
  placeGeodesicCannonOnGeodesic,
  previewRebuildGeodesicInterval,
  pruneMissingGeodesicIntersectionObjects,
  rebuildConnectedGeodesicBetweenEmitters,
  rebuildGeodesicToLength,
  replaceGeodesicEndpointAttachment,
  removeGeodesic,
  removeUnlockedGeodesicsFromCannon,
  resolveGeodesicCannonAimYawRadians,
  resolveGeodesicEndpointSelectionFromSegmentHit,
  resolveGeodesicNumber,
  rebuildDerivedGeodesicSegments,
  shootGeodesic,
  tieAndDetachIncidentGeodesics,
  tieAndDetachGeodesicEndpoints,
  traceGeodesicFromLiftedChord,
  traceGeodesicSegment,
  updateGeodesicIntersectionObjects,
  updateLockedGeodesicPortalWordForCarriedAnchorTraversal,
  type GeodesicSegmentObject,
} from "../../src/world-objects/geodesicCannon";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";

describe("geodesic cannon world objects", () => {
  it("traces an open one-meter horizontal segment", () => {
    const result = traceGeodesicSegment({
      world: compileWorld(false),
      cellId: "a",
      start: { x: 0.5, y: 0.5, z: 0.32 },
      direction: { x: 1, y: 0, z: 0 },
      maxLengthMeters: 1,
    });

    expect(result.lengthMeters).toBe(1);
    expect(result.terminal).toEqual({ kind: "open" });
  });

  it("extends same-cell aimable geodesics by rebuilding endpoint halves", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    registry.add(cannon);

    const first = shootGeodesic({ world, registry, cannon, geodesicId: "g-a" });
    const second = extendGeodesic({ world, registry, geodesicId: "g-a" });

    expect(cannon.collision).toEqual({
      radius: 0.3,
      height: 0.75,
      offset: { x: 0, y: 0, z: 0.375 },
    });
    expect(cannon.tooltip?.label).toBe("Geodesic emitter");
    expect(cannon.tooltip?.rangeMeters).toBe(2.5);
    expect(cannon.tooltip?.desktopPrompt).toBeUndefined();
    expect(cannon.tooltip?.xrPrompt).toBeUndefined();
    expect(first.lengthMeters).toBe(1);
    expect(first.geodesicNumber).toBe(1);
    expect(first.tooltip?.label).toBe("Geodesic G1");
    expect(first.tooltip?.rangeMeters).toBe(6);
    expect(first.tooltip?.desktopPrompt).toBeUndefined();
    expect(first.tooltip?.xrPrompt).toBeUndefined();
    expect(second?.segmentIndex).toBe(1);
    expect(second?.lengthMeters).toBe(2);
    expect(second?.geodesicNumber).toBe(1);
    expect(second?.tooltip?.label).toBe("Geodesic G1");
    expect(second?.tooltip?.rangeMeters).toBe(6);
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(4);
    expect(getGeodesicSegments(registry, "g-a").map((segment) => segment.halfRole)).toEqual(["start", "end"]);
    expect(resolveGeodesicEndpointSelectionFromSegmentHit(registry, "g-a:segment:0")).toMatchObject({
      geodesicId: "g-a",
      role: "start",
      anchorObjectId: "cannon-a",
    });
    expect(getGeodesicEndpointAttachmentsForAnchor(registry, "cannon-a")).toEqual([
      { geodesicId: "g-a", role: "start", anchorObjectId: "cannon-a" },
    ]);
    const freeEndId = getGeodesicEndpoints(registry, "g-a")?.[1].anchorObjectId;
    expect(freeEndId).toBeDefined();
    expect(freeEndId ? getGeodesicEndpointAttachmentsForAnchor(registry, freeEndId) : []).toEqual([
      { geodesicId: "g-a", role: "end", anchorObjectId: freeEndId },
    ]);
  });

  it("numbers multiple geodesics from the same emitter pole incrementally", () => {
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
    const second = shootGeodesic({ world, registry, cannon: updatedCannon, geodesicId: "g-b" });

    expect(first.tooltip?.label).toBe("Geodesic G1");
    expect(second.geodesicNumber).toBe(2);
    expect(second.tooltip?.label).toBe("Geodesic G2");
    expect(second.start.y).toBeCloseTo(0);
    const finalCannon = registry.get("cannon-a");
    expect(finalCannon?.kind === "geodesic-cannon" ? finalCannon.geodesicIds : []).toEqual(["g-a", "g-b"]);
  });

  it("numbers geodesics globally across emitters", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const firstCannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    const secondCannon = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI / 2, { x: 1.5, y: 0, z: 0 }),
    });
    registry.add(firstCannon);
    registry.add(secondCannon);

    const first = shootGeodesic({ world, registry, cannon: firstCannon, geodesicId: "g-a" });
    const second = shootGeodesic({ world, registry, cannon: secondCannon, geodesicId: "g-b" });

    expect(first.geodesicNumber).toBe(1);
    expect(first.tooltip?.label).toBe("Geodesic G1");
    expect(second.geodesicNumber).toBe(2);
    expect(second.tooltip?.label).toBe("Geodesic G2");
    expect(resolveGeodesicNumber(registry, "g-a")).toBe(1);
    expect(resolveGeodesicNumber(registry, "g-b")).toBe(2);
  });

  it("preserves existing global geodesic numbers when lower numbers are absent", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        geodesicNumber: 2,
      }),
    ]);

    expect(resolveGeodesicNumber(registry, "g-b")).toBe(2);
    expect(resolveGeodesicNumber(registry, "g-c")).toBe(1);
  });

  it("starts the first ray segment at the visual laser emitter", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -1.5, y: 0, z: 0 }),
    });
    registry.add(cannon);

    const first = shootGeodesic({ world, registry, cannon, geodesicId: "g-a" });

    expect(first.start.x).toBeCloseTo(-1.5 + geodesicRayBeamStartOffsetMeters);
    expect(first.start.y).toBeCloseTo(0);
    expect(first.start.z).toBeCloseTo(geodesicRayBeamHeightMeters);
  });

  it("resolves cannon aim yaw from the local euclidean target direction", () => {
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 0 }),
    });

    expect(resolveGeodesicCannonAimYawRadians(cannon, { x: 1, y: 4, z: 2 })).toBeCloseTo(Math.PI / 2);
    expect(resolveGeodesicCannonAimYawRadians(cannon, { x: -2, y: 1, z: -1 })).toBeCloseTo(Math.PI);
  });

  it("does not resolve aim yaw at the same horizontal point as the cannon", () => {
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 0 }),
    });

    expect(resolveGeodesicCannonAimYawRadians(cannon, { x: 1, y: 1, z: 2 })).toBeUndefined();
  });

  it("shortens a segment at a wall hit", () => {
    const result = traceGeodesicSegment({
      world: compileWorld(false),
      cellId: "a",
      start: { x: 1.5, y: 1, z: 0.32 },
      direction: { x: 1, y: 0, z: 0 },
      maxLengthMeters: 1,
    });

    expect(result.lengthMeters).toBeCloseTo(0.5);
    expect(result.terminal).toEqual({ kind: "wall-hit", sideIndex: 1 });
  });

  it("stops immediately when a segment starts inside a forbidden zone", () => {
    const world = compileWorld(true);
    const result = traceGeodesicSegment({
      world,
      cellId: "a",
      start: { x: 1.95, y: 0.05, z: geodesicRayBeamHeightMeters },
      direction: { x: -1, y: 0, z: 0 },
      maxLengthMeters: 1,
    });

    expect(result.terminal).toEqual({ kind: "forbidden-zone-hit", junctionId: "a:vertex-1" });
    expect(result.lengthMeters).toBeCloseTo(0);
  });

  it("shortens a segment at a forbidden zone hit and refuses to extend it", () => {
    const world = compileWorld(true);
    const directionLength = Math.hypot(1, -1);
    const direction = { x: 1 / directionLength, y: -1 / directionLength, z: 0 };
    const result = traceGeodesicSegment({
      world,
      cellId: "a",
      start: { x: 1, y: 1, z: geodesicRayBeamHeightMeters },
      direction,
      maxLengthMeters: 2,
    });

    expect(result.lengthMeters).toBeCloseTo(Math.SQRT2 - 0.15);
    expect(result.terminal).toEqual({ kind: "forbidden-zone-hit", junctionId: "a:vertex-1" });

    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(Math.atan2(direction.y, direction.x), { x: 1, y: 1, z: 0 }),
    }));
    registry.add({
      id: "g-a:segment:0",
      kind: "geodesic-segment",
      cellId: "a",
      localPose: yawRigidTransform3(Math.atan2(direction.y, direction.x), result.start),
      portalRenderable: true,
      geodesicId: "g-a",
      segmentIndex: 0,
      start: result.start,
      direction: result.direction,
      lengthMeters: result.lengthMeters,
      terminal: result.terminal,
    });

    expect(extendGeodesic({ world, registry, geodesicId: "g-a" })).toBeUndefined();
  });

  it("rebuilds rotated geodesics to the remembered total length after moving past a forbidden zone", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(cannon);
    rebuildGeodesicToLength({
      world,
      registry,
      cannon,
      geodesicId: "g-a",
      totalLengthMeters: 4.7,
    });
    const rememberedLength = totalGeodesicLength(registry, "g-a");

    const blockedCannon = createGeodesicCannonObject({
      ...cannon,
      aimYawRadians: Math.atan2(-2.5, 4),
    });
    rebuildGeodesicToLength({
      world,
      registry,
      cannon: blockedCannon,
      geodesicId: "g-a",
      totalLengthMeters: rememberedLength,
    });

    expect(totalGeodesicLength(registry, "g-a")).toBeLessThan(rememberedLength);
    expect(getGeodesicSegments(registry, "g-a").at(-1)?.terminal.kind).toBe("forbidden-zone-hit");

    const clearCannon = createGeodesicCannonObject({
      ...cannon,
      aimYawRadians: 0,
    });
    rebuildGeodesicToLength({
      world,
      registry,
      cannon: clearCannon,
      geodesicId: "g-a",
      totalLengthMeters: rememberedLength,
    });

    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(rememberedLength);
  });

  it("breaks carried geodesics completely when the rebuilt path crosses a forbidden zone", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(cannon);
    rebuildGeodesicToLength({
      world,
      registry,
      cannon,
      geodesicId: "g-a",
      totalLengthMeters: 4.7,
    });
    const rememberedLength = totalGeodesicLength(registry, "g-a");

    const blockedCannon = createGeodesicCannonObject({
      ...cannon,
      aimYawRadians: Math.atan2(-2.5, 4),
    });
    const rebuilt = rebuildGeodesicToLength({
      world,
      registry,
      cannon: blockedCannon,
      geodesicId: "g-a",
      totalLengthMeters: rememberedLength,
      breakOnForbiddenZone: true,
    });

    expect(rebuilt).toEqual([]);
    expect(getGeodesicSegments(registry, "g-a")).toEqual([]);
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual([]);
  });

  it("removes unlocked geodesics immediately when lifting an emitter", () => {
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
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-open", maxLengthMeters: 1 });
    const updatedSource = registry.get("cannon-a");
    if (updatedSource?.kind !== "geodesic-cannon") {
      throw new Error("Expected updated source emitter.");
    }
    shootGeodesic({ world, registry, cannon: updatedSource, geodesicId: "g-locked", maxLengthMeters: 4 });

    const removed = removeUnlockedGeodesicsFromCannon(registry, "cannon-a");

    expect(removed).toEqual(["g-open"]);
    expect(getGeodesicSegments(registry, "g-open")).toEqual([]);
    expect(getGeodesicSegments(registry, "g-locked").length).toBeGreaterThan(0);
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual(["g-locked"]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-locked"]);
  });

  it("rebuilds total length as one segment per crossed cell piece", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    registry.add(cannon);

    rebuildGeodesicToLength({
      world,
      registry,
      cannon,
      geodesicId: "g-a",
      totalLengthMeters: 2,
    });

    const segments = getGeodesicSegments(registry, "g-a");
    expect(segments.map((segment) => segment.cellId)).toEqual(["a", "b"]);
    expect(segments[0]?.terminal.kind).toBe("portal-hit");
    expect(segments.at(-1)?.terminal.kind).toBe("open");
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(2);
  });

  it("shoots seamlessly across a portal and records the continuation target data", () => {
    const world = compileWorld(true);
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1.5, y: 1, z: 0 }),
    });
    registry.add(cannon);

    const first = shootGeodesic({ world, registry, cannon, geodesicId: "g-a", maxLengthMeters: 1 });
    const updatedCannon = registry.get("cannon-a");
    expect(first.segmentIndex).toBe(0);
    expect(updatedCannon?.kind === "geodesic-cannon" ? updatedCannon.geodesicIds : []).toEqual(["g-a"]);
    expect(first.terminal.kind).toBe("portal-hit");
    if (first.terminal.kind !== "portal-hit") {
      throw new Error("Expected portal-hit terminal.");
    }
    expect(first.terminal.targetCellId).toBe("b");
    expect(first.terminal.targetPortalId).toBe("ba");
    const segments = getGeodesicSegments(registry, "g-a");
    expect(segments).toHaveLength(2);
    expect(segments[1]?.segmentIndex).toBe(1);
    expect(segments[1]?.cellId).toBe("b");
    expect(segments[1]?.start).toEqual(first.terminal.targetStart);

    const second = extendGeodesic({ world, registry, geodesicId: "g-a", maxLengthMeters: 1 });
    expect(second?.segmentIndex).toBe(2);
    expect(second?.cellId).toBe("b");
    expect(getGeodesicSegments(registry, "g-a").map((segment) => segment.cellId)).toEqual(["a", "b", "b"]);
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(2);
  });

  it("extends seamlessly across a portal when the requested length crosses the boundary", () => {
    const world = compileWorld(true);
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1.5, y: 1, z: 0 }),
    });
    registry.add(cannon);

    const first = shootGeodesic({ world, registry, cannon, geodesicId: "g-a", maxLengthMeters: 0.25 });
    const extended = extendGeodesic({ world, registry, geodesicId: "g-a", maxLengthMeters: 1 });
    const segments = getGeodesicSegments(registry, "g-a");

    expect(first.terminal.kind).toBe("open");
    expect(extended?.segmentIndex).toBe(2);
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.cellId)).toEqual(["a", "b", "b"]);
    expect(segments[0]?.terminal.kind).toBe("portal-hit");
    expect(segments[1]?.start).toEqual(
      segments[0]?.terminal.kind === "portal-hit" ? segments[0].terminal.targetStart : undefined,
    );
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(1.25);
  });

  it("extends open tails and refuses wall-hit tails", () => {
    const world = compileWorld(false);
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0.25, y: 1, z: 0 }),
    });
    registry.add(cannon);

    shootGeodesic({ world, registry, cannon, geodesicId: "g-a", maxLengthMeters: 0.25 });
    const second = extendGeodesic({ world, registry, geodesicId: "g-a", maxLengthMeters: 0.5 });
    const third = extendGeodesic({ world, registry, geodesicId: "g-a", maxLengthMeters: 1 });

    expect(second?.segmentIndex).toBe(1);
    expect(second?.lengthMeters).toBeCloseTo(0.375);
    expect(second?.terminal.kind).toBe("open");
    expect(third?.segmentIndex).toBe(1);
    expect(third?.terminal.kind).toBe("wall-hit");
    expect(getGeodesicSegments(registry, "g-a")).toHaveLength(2);
    expect(extendGeodesic({ world, registry, geodesicId: "g-a" })).toBeUndefined();
  });

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

  it("ignores stale carried portal transitions that do not match the carried endpoint move", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0.75, y: 1, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 2.75, y: 1, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    const beforeMove = registry.get("cannon-b");
    if (beforeMove?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...beforeMove,
      localPose: yawRigidTransform3(Math.PI, { x: 3, y: 1.25, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: beforeMove,
      carriedEmitterPortalTransition: createCarryPortalTransition(world, "a", "ab"),
      carriedPortalWord: [createCarryPortalTraversal(world, "a", "ab")],
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
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

  it("rebuilds locked emitter-to-emitter geodesics after an endpoint moves across a portal", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "a",
      sourcePortalId: "ab",
      targetCellId: "b",
      targetPortalId: "ba",
    }]);

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 3, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-a" });
    const expectedYaw = Math.atan2(0.5, 2);

    expect(rebuilt.map((segment) => segment.cellId)).toEqual(["a", "b"]);
    expect(rebuilt[0]?.terminal.kind).toBe("portal-hit");
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(totalGeodesicLength(registry, "g-a")).toBeCloseTo(Math.hypot(2, 0.5) - geodesicRayBeamStartOffsetMeters);
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-a")).toBeCloseTo(expectedYaw);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps the portal clone while carrying a locked endpoint in a wrapping cell", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 4, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: -4, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 8 });

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: -3.5, y: 0, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: movedIncoming,
    });

    expect(rebuilt.length).toBeGreaterThanOrEqual(2);
    expect(rebuilt.map((segment) => segment.cellId).every((cellId) => cellId === "torus-room")).toBe(true);
    expect(rebuilt[0]?.terminal.kind).toBe("portal-hit");
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(getCannonGeodesicYaw(registry, "cannon-a", "g-a")).toBeCloseTo(0);
  });

  it("does not unlock or hide a carried geodesic when the direct clone is too short", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 4, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: -4, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 8 });

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      localPose: yawRigidTransform3(Math.PI, { x: 4.05, y: 0, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: movedIncoming,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(rebuilt[0]?.terminal.kind).toBe("portal-hit");
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    const sourceYaw = Math.atan2(rebuilt[0]?.direction.y ?? 0, rebuilt[0]?.direction.x ?? 1);
    expect(getCannonPoseYaw(registry, "cannon-a")).toBeCloseTo(sourceYaw);
    expect(getCannonPoseYaw(registry, "cannon-b")).toBeCloseTo(normalizeYaw(sourceYaw + Math.PI));
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("derives a same-cell portal carry transition from the carried endpoint motion", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 5, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: 7.4, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "torus-room",
    }));

    registry.update({
      ...incoming,
      localPose: yawRigidTransform3(Math.PI, { x: -7.4, y: 0, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: incoming,
    });

    expect(rebuilt.length).toBeGreaterThanOrEqual(2);
    expect(rebuilt.some((segment) => segment.terminal.kind === "portal-hit")).toBe(true);
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "torus-room",
      sourcePortalId: "right-left",
      targetCellId: "torus-room",
      targetPortalId: "left-right",
    }]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps the portal word unchanged during same-cell fixed-face carry without player traversal", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "torus-room",
      localPose: yawRigidTransform3(Math.PI, { x: 2, y: 0, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "torus-room",
    }));

    registry.update({
      ...incoming,
      localPose: yawRigidTransform3(Math.PI, { x: 2.5, y: 0.25, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: incoming,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps a carried endpoint connected when it crosses back through the portal", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

    const movedIncoming = registry.get("cannon-b");
    if (movedIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...movedIncoming,
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.8, y: 2.5, z: 0 }),
    });

    const carryWord = [
      ...collectGeodesicPortalWord(world, registry, "g-a"),
      createCarryPortalTraversal(world, "b", "ba"),
    ];
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: movedIncoming,
      carriedEmitterPortalTransition: createCarryPortalTransition(world, "b", "ba"),
      carriedPortalWord: carryWord,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual(["g-a"]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-a"]);
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
  });

  it("updates a locked interval portal word from carried endpoint player traversal before rebuild", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "a",
      sourcePortalId: "ab",
      targetCellId: "b",
      targetPortalId: "ba",
    }]);

    registry.update({
      ...incoming,
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.8, y: 2.5, z: 0 }),
    });

    const nextWord = updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
      registry,
      geodesicId: "g-a",
      carriedAnchorObjectId: "cannon-b",
      traversal: createCarryPortalTraversal(world, "b", "ba"),
    });
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-a" });

    expect(nextWord).toEqual([]);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("normalizes an out-of-cell carried emitter through one portal on release before final rebuild", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 5.2, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

    const releaseMove = moveDynamicObject({
      world,
      object: runtimeObjectToDynamicObjectState(incoming),
      displacement: { x: 0, y: 0, z: 0 },
      ignoreForbiddenZones: true,
    });
    expect(releaseMove.crossedPortal).toBe(true);
    expect(releaseMove.crossedPortalId).toBe("ab");
    registry.update({
      ...incoming,
      cellId: releaseMove.object.cellId,
      localPose: releaseMove.object.localPose,
    });

    const nextWord = updateLockedGeodesicPortalWordForCarriedAnchorTraversal({
      registry,
      geodesicId: "g-a",
      carriedAnchorObjectId: "cannon-b",
      traversal: createCarryPortalTraversal(world, "a", "ab"),
    });
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-a" });

    expect(nextWord).toEqual([{
      sourceCellId: "a",
      sourcePortalId: "ab",
      targetCellId: "b",
      targetPortalId: "ba",
    }]);
    expect(rebuilt.some((segment) => segment.terminal.kind === "portal-hit")).toBe(true);
    expect(rebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("rebuilds a live carried geodesic to a formal out-of-bounds emitter without mutating the word", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 5.2, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

    const strictRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
    });
    expect(strictRebuilt).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesic-interval");

    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
      allowOutOfBoundsCarriedEndpoint: true,
    });

    expect(liveRebuilt.some((segment) => segment.terminal.kind === "portal-hit")).toBe(true);
    expect(liveRebuilt.at(-1)).toMatchObject({
      terminal: { kind: "emitter-hit", emitterId: "cannon-b" },
      connectionState: "connected",
    });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesic-interval");
  });

  it("preserves a locked interval after a failed live carry rebuild", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
      portalWord: [{
        sourceCellId: "a",
        sourcePortalId: "missing",
        targetCellId: "b",
        targetPortalId: "ba",
      }],
    }));

    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
    });

    expect(liveRebuilt).toEqual([]);
    expect(registry.get("g-a")?.kind).toBe("geodesic-interval");

    const finalRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
    });

    expect(finalRebuilt).toEqual([]);
    expect(registry.get("g-a")).toBeUndefined();
  });

  it("destroys a locked interval during live carry when the rebuilt path crosses a forbidden zone", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 1, y: 2.5, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 5, y: 0, z: 0 }),
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-b",
      startCellId: "a",
    }));

    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      preserveGeodesicOnRebuildFailure: true,
      allowOutOfBoundsCarriedEndpoint: true,
    });

    expect(liveRebuilt).toEqual([]);
    expect(registry.get("g-a")).toBeUndefined();
    expect(getGeodesicSegments(registry, "g-a")).toEqual([]);
  });

  it("derives a different-cell portal carry transition from endpoint cells without player transition state", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });

    const previousIncoming = registry.get("cannon-b");
    if (previousIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    registry.update({
      ...previousIncoming,
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 4.8, y: 2.5, z: 0 }),
    });

    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: previousIncoming,
    });

    expect(rebuilt.length).toBeGreaterThan(0);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
  });

  it("keeps a carried endpoint connected after the final drop rebuild", () => {
    const world = compileThreeCellPortalWorld();
    const registry = createRuntimeObjectRegistry();
    const source = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "front",
      localPose: yawRigidTransform3(0, { x: 4, y: 2.5, z: 0 }),
    });
    const incoming = createGeodesicCannonObject({
      id: "cannon-b",
      cellId: "left",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    });
    registry.add(source);
    registry.add(incoming);
    shootGeodesic({ world, registry, cannon: source, geodesicId: "g-a", maxLengthMeters: 3 });
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual([{
      sourceCellId: "front",
      sourcePortalId: "front-left",
      targetCellId: "left",
      targetPortalId: "left-front",
    }]);

    const previousIncoming = registry.get("cannon-b");
    if (previousIncoming?.kind !== "geodesic-cannon") {
      throw new Error("Expected incoming emitter.");
    }
    const carriedIncoming = {
      ...previousIncoming,
      cellId: "back",
      localPose: yawRigidTransform3(Math.PI, { x: 1, y: 2.5, z: 0 }),
    };
    registry.update(carriedIncoming);

    const carryWord = [
      ...collectGeodesicPortalWord(world, registry, "g-a"),
      createCarryPortalTraversal(world, "left", "left-back"),
    ];
    const liveRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedEmitterBeforeMove: previousIncoming,
      carriedEmitterPortalTransition: createCarryPortalTransition(world, "left", "left-back"),
      carriedPortalWord: carryWord,
    });
    expect(liveRebuilt.length).toBeGreaterThan(0);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);

    const dropRebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world,
      registry,
      geodesicId: "g-a",
      carriedEmitterId: "cannon-b",
      carriedPortalWord: carryWord,
    });

    expect(dropRebuilt.length).toBeGreaterThan(0);
    expect(getGeodesicConnection(registry, "g-a")).toEqual({
      outgoingEmitterId: "cannon-a",
      incomingEmitterId: "cannon-b",
      state: "connected",
    });
    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual(["g-a"]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-a"]);
    expect(isGeodesicLocked(registry, "g-a")).toBe(true);
    expect(collectGeodesicPortalWord(world, registry, "g-a")).toEqual(carryWord);
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

  it("detaches the two endpoint roles of a same-emitter loop into one curve-shortening free end", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const emitter = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "torus-room",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    });
    registry.add(emitter);
    registry.add(createGeodesicIntervalObject({
      id: "g-loop",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-a",
      startCellId: "torus-room",
      portalWord: [{
        sourceCellId: "torus-room",
        sourcePortalId: "right-left",
        targetCellId: "torus-room",
        targetPortalId: "left-right",
      }],
    }));
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });

    const pair = tieAndDetachGeodesicEndpoints({
      world,
      registry,
      detachedEmitterId: "cannon-a",
      first: { geodesicId: "g-loop", role: "start", anchorObjectId: "cannon-a" },
      second: { geodesicId: "g-loop", role: "end", anchorObjectId: "cannon-a" },
      createPairId: () => "pair-loop",
      createFreeEndId: () => "free-loop",
    });

    expect(pair).toMatchObject({
      id: "pair-loop",
      kind: "curve-shortening-pair",
      first: { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" },
      second: { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" },
      freeEndAnchorId: "free-loop",
      state: "moving",
    });
    expect(getGeodesicEndpointAttachmentsForAnchor(registry, "free-loop")).toEqual([
      { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" },
      { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" },
    ]);
    expect(registry.get("g-loop")).toMatchObject({ kind: "geodesic-interval", motionState: "moving" });
    expect(getGeodesicSegments(registry, "g-loop").map((segment) => segment.connectionState)).toContain("straightening");
  });

  it("fuses a ready curve-shortening pair into one stable locked interval using the lower geodesic id", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-left",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-right",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 2, y: 0, z: 0 }),
    }));
    registry.add(createFreeGeodesicEndObject({
      id: "free-shared",
      cellId: "a",
      point: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-b",
      startAnchorObjectId: "cannon-left",
      endAnchorObjectId: "free-shared",
      startCellId: "a",
      motionState: "moving",
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-a",
      startAnchorObjectId: "free-shared",
      endAnchorObjectId: "cannon-right",
      startCellId: "a",
      motionState: "moving",
    }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-b" });
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-a" });
    registry.add(createCurveShorteningPairObject({
      id: "pair-a",
      first: { geodesicId: "g-b", role: "end", anchorObjectId: "free-shared" },
      second: { geodesicId: "g-a", role: "start", anchorObjectId: "free-shared" },
      freeEndAnchorId: "free-shared",
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
      state: "ready-to-fuse",
    }));

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

    expect(changed).toEqual(["g-a"]);
    expect(registry.get("g-b")).toBeUndefined();
    expect(registry.get("free-shared")).toBeUndefined();
    expect(registry.get("pair-a")).toBeUndefined();
    expect(registry.get("g-a")).toMatchObject({
      kind: "geodesic-interval",
      motionState: "stable",
      start: { geodesicId: "g-a", role: "start", anchorObjectId: "cannon-left" },
      end: { geodesicId: "g-a", role: "end", anchorObjectId: "cannon-right" },
    });
    expect(getGeodesicSegments(registry, "g-a").at(-1)?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-right" });
  });

  describe("fusing into an already existing geodesic", () => {
    function setup(existing: Parameters<typeof createGeodesicIntervalObject>[0]) {
      const world = compileLargeWorld();
      const registry = createRuntimeObjectRegistry();
      registry.add(createGeodesicCannonObject({ id: "cannon-left", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
      registry.add(createGeodesicCannonObject({ id: "cannon-right", cellId: "a", localPose: yawRigidTransform3(Math.PI, { x: 2, y: 0, z: 0 }) }));
      registry.add(createFreeGeodesicEndObject({ id: "free-shared", cellId: "a", point: { x: 0, y: 0, z: geodesicRayBeamHeightMeters } }));
      registry.add(createGeodesicIntervalObject({ id: "g-b", startAnchorObjectId: "cannon-left", endAnchorObjectId: "free-shared", startCellId: "a", motionState: "moving" }));
      registry.add(createGeodesicIntervalObject({ id: "g-a", startAnchorObjectId: "free-shared", endAnchorObjectId: "cannon-right", startCellId: "a", motionState: "moving" }));
      rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-b" });
      rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-a" });
      registry.add(createGeodesicIntervalObject(existing));
      rebuildDerivedGeodesicSegments({ world, registry, geodesicId: existing.id });
      registry.add(createCurveShorteningPairObject({
        id: "pair-a",
        first: { geodesicId: "g-b", role: "end", anchorObjectId: "free-shared" },
        second: { geodesicId: "g-a", role: "start", anchorObjectId: "free-shared" },
        freeEndAnchorId: "free-shared",
        lastGoodFreeEndCellId: "a",
        lastGoodFreeEndPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
        state: "ready-to-fuse",
      }));
      return { world, registry };
    }

    it("keeps the existing geodesic and drops the new one when both have the same endpoints and word", () => {
      const { world, registry } = setup({ id: "g-old", startAnchorObjectId: "cannon-left", endAnchorObjectId: "cannon-right", startCellId: "a" });

      advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

      expect(registry.get("g-old")).toMatchObject({ kind: "geodesic-interval", motionState: "stable" });
      expect(registry.get("g-a")).toBeUndefined();
      expect(registry.get("g-b")).toBeUndefined();
      expect(registry.get("free-shared")).toBeUndefined();
      expect(registry.get("pair-a")).toBeUndefined();
    });

    it("recognizes the existing geodesic when it is stored in the opposite direction", () => {
      const { world, registry } = setup({ id: "g-old", startAnchorObjectId: "cannon-right", endAnchorObjectId: "cannon-left", startCellId: "a" });

      advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

      expect(registry.get("g-old")).toBeDefined();
      expect(registry.get("g-a")).toBeUndefined();
      expect(registry.get("g-b")).toBeUndefined();
    });

    it("keeps a geodesic between the same emitters that lies in a different homotopy class", () => {
      const { world, registry } = setup({
        id: "g-other",
        startAnchorObjectId: "cannon-left",
        endAnchorObjectId: "cannon-right",
        startCellId: "a",
        // Only the stored word matters to the identity check; the segments of this interval are not needed.
        portalWord: [{ sourceCellId: "a", sourcePortalId: "p", targetCellId: "a", targetPortalId: "q" }],
      });

      advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

      expect(registry.get("g-other")).toBeDefined();
      expect(registry.get("g-a")).toMatchObject({ kind: "geodesic-interval", motionState: "stable" });
      expect(registry.get("pair-a")).toBeUndefined();
    });
  });

  it("emits a debug diagnostic when a shortening pair is marked ready by mobile angle", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-left",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-right",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 2, y: 0, z: 0 }),
    }));
    registry.add(createFreeGeodesicEndObject({
      id: "free-shared",
      cellId: "a",
      point: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-left",
      startAnchorObjectId: "cannon-left",
      endAnchorObjectId: "free-shared",
      startCellId: "a",
      motionState: "moving",
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-right",
      startAnchorObjectId: "free-shared",
      endAnchorObjectId: "cannon-right",
      startCellId: "a",
      motionState: "moving",
    }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-left" });
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-right" });
    registry.add(createCurveShorteningPairObject({
      id: "pair-straight",
      first: { geodesicId: "g-left", role: "end", anchorObjectId: "free-shared" },
      second: { geodesicId: "g-right", role: "start", anchorObjectId: "free-shared" },
      freeEndAnchorId: "free-shared",
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    const debugEvents: { readonly message: string; readonly detail?: unknown }[] = [];

    advanceCurveShorteningPairs({
      world,
      registry,
      deltaSeconds: 1,
      onDebugMessage: (message, detail) => debugEvents.push({ message, detail }),
    });

    expect(registry.get("pair-straight")).toMatchObject({ kind: "curve-shortening-pair", state: "ready-to-fuse" });
    expect(debugEvents[0]?.message).toBe("curve-shortening pair marked ready-to-fuse by mobile angle");
    expect(debugEvents[0]?.detail).toMatchObject({
      pairId: "pair-straight",
      turnAngleDegrees: 180,
      angleDeltaFromPiDegrees: 0,
      fuseAngleToleranceDegrees: 1.719,
    });
  });

  it("does not use monotonicity as a collapse criterion for non-straight pairs", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-left",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-top",
      cellId: "a",
      localPose: yawRigidTransform3(-Math.PI / 2, { x: 0, y: 2, z: 0 }),
    }));
    registry.add(createFreeGeodesicEndObject({
      id: "free-shared",
      cellId: "a",
      point: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-left",
      startAnchorObjectId: "cannon-left",
      endAnchorObjectId: "free-shared",
      startCellId: "a",
      motionState: "moving",
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-top",
      startAnchorObjectId: "free-shared",
      endAnchorObjectId: "cannon-top",
      startCellId: "a",
      motionState: "moving",
    }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-left" });
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-top" });
    registry.add(createCurveShorteningPairObject({
      id: "pair-kink",
      first: { geodesicId: "g-left", role: "end", anchorObjectId: "free-shared" },
      second: { geodesicId: "g-top", role: "start", anchorObjectId: "free-shared" },
      freeEndAnchorId: "free-shared",
      previousTotalLengthMeters: 0,
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    const debugEvents: { readonly message: string; readonly detail?: unknown }[] = [];

    advanceCurveShorteningPairs({
      world,
      registry,
      deltaSeconds: 1,
      onDebugMessage: (message, detail) => debugEvents.push({ message, detail }),
    });

    expect(registry.get("pair-kink")).toMatchObject({ kind: "curve-shortening-pair", state: "moving" });
    expect(debugEvents.map((event) => event.message)).not.toContain("curve-shortening pair marked ready-to-fuse by mobile angle");
    expect(debugEvents.map((event) => event.message)).not.toContain("curve-shortening pair rolled back by monotonicity rejection without fusing");
  });

  it("rolls back a shortening step whose total length would increase beyond the tolerance", () => {
    // previousTotalLengthMeters is deliberately far below the real total, so any previewed step looks like a length increase.
    const { world, registry } = createKinkPairScenario({ previousTotalLengthMeters: 0.01 });
    const segmentsBefore = getGeodesicSegments(registry, "g-left");
    const pairBefore = registry.get("pair-kink");

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

    expect(curveShorteningLengthIncreaseToleranceMeters).toBe(1e-4);
    expect(changed).toEqual([]);
    expect(registry.get("free-shared")).toMatchObject({ cellId: "a", localPose: { translation: { x: 0, y: 0 } } });
    expect(getGeodesicSegments(registry, "g-left")).toEqual(segmentsBefore);
    expect(registry.get("pair-kink")).toEqual(pairBefore);
  });

  it("records the new total length after a monotone shortening step", () => {
    const { world, registry } = createKinkPairScenario({ previousTotalLengthMeters: 100 });

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

    expect([...changed].sort()).toEqual(["g-left", "g-top"]);
    const pair = registry.get("pair-kink");
    const total = totalGeodesicLength(registry, "g-left") + totalGeodesicLength(registry, "g-top");
    expect(pair).toMatchObject({ state: "moving" });
    expect((pair as { previousTotalLengthMeters?: number }).previousTotalLengthMeters).toBeCloseTo(total, 9);
    expect(total).toBeLessThan(4);
  });

  it("does not report a pair as changed when a non-forbidden preview failure commits nothing", () => {
    const { world, registry } = createKinkPairScenario({});
    const top = registry.get("cannon-top");
    if (top?.kind !== "geodesic-cannon") {
      throw new Error("cannon-top missing");
    }
    // Move the far emitter outside the cell: the previewed arc hits a wall (not a forbidden zone).
    registry.update({ ...top, localPose: yawRigidTransform3(-Math.PI / 2, { x: 0, y: 10, z: 0 }) });
    const segmentsBefore = getGeodesicSegments(registry, "g-top");

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

    expect(changed).toEqual([]);
    expect(registry.get("pair-kink")).toMatchObject({ state: "moving" });
    expect(registry.get("free-shared")).toMatchObject({ localPose: { translation: { x: 0, y: 0 } } });
    expect(getGeodesicSegments(registry, "g-top")).toEqual(segmentsBefore);
  });

  it("deletes a degenerate free loop together with its derived objects", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createFreeGeodesicEndObject({
      id: "free-loop",
      cellId: "a",
      point: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-loop",
      startAnchorObjectId: "free-loop",
      endAnchorObjectId: "free-loop",
      startCellId: "a",
      motionState: "moving",
    }));
    registry.add(createSegment({
      id: "g-loop:segment:0",
      geodesicId: "g-loop",
      segmentIndex: 0,
      direction: { x: 1, y: 0, z: 0 },
      lengthMeters: 0.03,
      connectionState: "straightening",
    }));
    registry.add(createSegment({
      id: "g-loop:segment:1",
      geodesicId: "g-loop",
      segmentIndex: 1,
      start: { x: 0.03, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: -1, z: 0 },
      lengthMeters: 0.03,
      connectionState: "straightening",
    }));
    registry.add(createCurveShorteningPairObject({
      id: "pair-loop",
      first: { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" },
      second: { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" },
      freeEndAnchorId: "free-loop",
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    }));

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

    expect(changed).toContain("pair-loop");
    expect(registry.get("g-loop")).toBeUndefined();
    expect(registry.get("free-loop")).toBeUndefined();
    expect(registry.get("pair-loop")).toBeUndefined();
    expect(getGeodesicSegments(registry, "g-loop")).toEqual([]);
  });

  it("reverts a ready-to-fuse pair to moving when its fusion preview fails without a forbidden zone", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-left", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "cannon-right", cellId: "a", localPose: yawRigidTransform3(Math.PI, { x: 2, y: 0, z: 0 }) }));
    registry.add(createFreeGeodesicEndObject({ id: "free-shared", cellId: "a", point: { x: 0, y: 0, z: geodesicRayBeamHeightMeters } }));
    registry.add(createGeodesicIntervalObject({ id: "g-b", startAnchorObjectId: "cannon-left", endAnchorObjectId: "free-shared", startCellId: "a", motionState: "moving" }));
    registry.add(createGeodesicIntervalObject({ id: "g-a", startAnchorObjectId: "free-shared", endAnchorObjectId: "cannon-right", startCellId: "a", motionState: "moving" }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-b" });
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-a" });
    registry.add(createCurveShorteningPairObject({
      id: "pair-a",
      first: { geodesicId: "g-b", role: "end", anchorObjectId: "free-shared" },
      second: { geodesicId: "g-a", role: "start", anchorObjectId: "free-shared" },
      freeEndAnchorId: "free-shared",
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
      state: "ready-to-fuse",
    }));
    const right = registry.get("cannon-right");
    if (right?.kind !== "geodesic-cannon") {
      throw new Error("cannon-right missing");
    }
    // The fused chord would leave the cell through a wall.
    registry.update({ ...right, localPose: yawRigidTransform3(Math.PI, { x: 10, y: 0, z: 0 }) });

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

    expect(changed).toEqual(["pair-a"]);
    expect(registry.get("pair-a")).toMatchObject({ kind: "curve-shortening-pair", state: "moving" });
    expect(registry.get("g-b")).toMatchObject({ motionState: "moving" });
    expect(registry.get("free-shared")).toBeDefined();
  });

  it("names a free end by its object kind rather than by an id substring in a preview", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
    registry.add(createFreeGeodesicEndObject({ id: "tip-7", cellId: "a", point: { x: 1, y: 0, z: geodesicRayBeamHeightMeters } }));
    const interval = createGeodesicIntervalObject({
      id: "g-tip",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "tip-7",
      startCellId: "a",
    });
    registry.add(interval);

    const preview = previewRebuildGeodesicInterval({ world, registry, interval });

    expect(preview?.terminal).toEqual({ kind: "free-end", freeEndObjectId: "tip-7" });
  });

  it("refuses to realize a lifted chord that hits a wall and leaves the segments untouched", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
    registry.add(createFreeGeodesicEndObject({ id: "tip-7", cellId: "a", point: { x: 1, y: 0, z: geodesicRayBeamHeightMeters } }));
    registry.add(createGeodesicIntervalObject({ id: "g-tip", startAnchorObjectId: "cannon-a", endAnchorObjectId: "tip-7", startCellId: "a" }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-tip" });
    const segmentsBefore = getGeodesicSegments(registry, "g-tip");

    const result = traceGeodesicFromLiftedChord({
      world,
      registry,
      geodesicId: "g-tip",
      sourceCellId: "a",
      sourcePoint: { x: -2, y: 0, z: geodesicRayBeamHeightMeters },
      yawRadians: 0,
      lengthMeters: 10,
    });

    expect(result).toBeUndefined();
    expect(getGeodesicSegments(registry, "g-tip")).toEqual(segmentsBefore);
  });

  it("moves a shortening free end through a portal and recomputes moved-start portal words", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createFreeGeodesicEndObject({
      id: "free-shared",
      cellId: "a",
      point: { x: 4.95, y: 2.5, z: geodesicRayBeamHeightMeters },
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-b1",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 0.5, y: 2.2, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-b2",
      cellId: "b",
      localPose: yawRigidTransform3(Math.PI, { x: 0.5, y: 2.8, z: 0 }),
    }));
    const portalWord = [createCarryPortalTraversal(world, "a", "ab")];
    registry.add(createGeodesicIntervalObject({
      id: "g-top",
      startAnchorObjectId: "free-shared",
      endAnchorObjectId: "cannon-b1",
      startCellId: "a",
      portalWord,
      motionState: "moving",
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-bottom",
      startAnchorObjectId: "free-shared",
      endAnchorObjectId: "cannon-b2",
      startCellId: "a",
      portalWord,
      motionState: "moving",
    }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-top" });
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-bottom" });
    registry.add(createCurveShorteningPairObject({
      id: "pair-portal",
      first: { geodesicId: "g-top", role: "start", anchorObjectId: "free-shared" },
      second: { geodesicId: "g-bottom", role: "start", anchorObjectId: "free-shared" },
      freeEndAnchorId: "free-shared",
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 4.95, y: 2.5, z: geodesicRayBeamHeightMeters },
    }));

    advanceCurveShorteningPairs({
      world,
      registry,
      deltaSeconds: 1,
      speedMetersPerSecond: 1,
    });

    expect(registry.get("free-shared")).toMatchObject({ kind: "free-geodesic-end", cellId: "b" });
    expect(registry.get("g-top")).toMatchObject({
      kind: "geodesic-interval",
      cellId: "b",
      startCellId: "b",
      portalWord: [],
    });
    expect(registry.get("g-bottom")).toMatchObject({
      kind: "geodesic-interval",
      cellId: "b",
      startCellId: "b",
      portalWord: [],
    });
  });

  it("absorbs a very short incident half into the longer half instead of waiting for pi angle fusion", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-left",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-right",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 2, y: 0, z: 0 }),
    }));
    registry.add(createFreeGeodesicEndObject({
      id: "free-shared",
      cellId: "a",
      point: { x: 1.995, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-long",
      startAnchorObjectId: "cannon-left",
      endAnchorObjectId: "free-shared",
      startCellId: "a",
      motionState: "moving",
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-short",
      startAnchorObjectId: "free-shared",
      endAnchorObjectId: "cannon-right",
      startCellId: "a",
      motionState: "moving",
    }));
    registry.add(createSegment({
      id: "g-long:segment:0",
      geodesicId: "g-long",
      start: { x: -2, y: -0.4, z: geodesicRayBeamHeightMeters },
      direction: horizontalDirection({ x: -2, y: -0.4 }, { x: 1.995, y: 0 }),
      lengthMeters: horizontalDistance({ x: -2, y: -0.4 }, { x: 1.995, y: 0 }),
      connectionState: "straightening",
      terminal: { kind: "open" },
      halfRole: "end",
    }));
    registry.add(createSegment({
      id: "g-short:segment:0",
      geodesicId: "g-short",
      start: { x: 1.995, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 1, y: 0, z: 0 },
      lengthMeters: 0.005,
      connectionState: "straightening",
      terminal: { kind: "emitter-hit", emitterId: "cannon-right" },
      halfRole: "start",
    }));
    registry.add(createCurveShorteningPairObject({
      id: "pair-short",
      first: { geodesicId: "g-long", role: "end", anchorObjectId: "free-shared" },
      second: { geodesicId: "g-short", role: "start", anchorObjectId: "free-shared" },
      freeEndAnchorId: "free-shared",
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 1.995, y: 0, z: geodesicRayBeamHeightMeters },
    }));
    const debugEvents: { readonly message: string; readonly detail?: unknown }[] = [];

    advanceCurveShorteningPairs({
      world,
      registry,
      deltaSeconds: 1,
      onDebugMessage: (message, detail) => debugEvents.push({ message, detail }),
    });

    expect(registry.get("g-short")).toBeUndefined();
    expect(registry.get("free-shared")).toBeUndefined();
    expect(registry.get("pair-short")).toBeUndefined();
    expect(registry.get("g-long")).toMatchObject({
      kind: "geodesic-interval",
      motionState: "stable",
      start: { geodesicId: "g-long", role: "start", anchorObjectId: "cannon-left" },
      end: { geodesicId: "g-long", role: "end", anchorObjectId: "cannon-right" },
    });
    expect(getGeodesicSegments(registry, "g-long").at(-1)?.terminal).toEqual({ kind: "emitter-hit", emitterId: "cannon-right" });
    expect(debugEvents[0]?.message).toBe("curve-shortening pair absorbed short incident half");
  });

  it("absorbs a near-minimum half when the next shortening preview would make it degenerate", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({
      id: "cannon-near",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
    }));
    registry.add(createGeodesicCannonObject({
      id: "cannon-far",
      cellId: "a",
      localPose: yawRigidTransform3(Math.PI, { x: 0, y: -2, z: 0 }),
    }));
    registry.add(createFreeGeodesicEndObject({
      id: "free-shared",
      cellId: "a",
      point: { x: 0, y: 0.1505, z: geodesicRayBeamHeightMeters },
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-short",
      startAnchorObjectId: "cannon-near",
      endAnchorObjectId: "free-shared",
      startCellId: "a",
      motionState: "moving",
    }));
    registry.add(createGeodesicIntervalObject({
      id: "g-long",
      startAnchorObjectId: "cannon-far",
      endAnchorObjectId: "free-shared",
      startCellId: "a",
      motionState: "moving",
    }));
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-short" });
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-long" });
    registry.add(createCurveShorteningPairObject({
      id: "pair-near-min",
      first: { geodesicId: "g-long", role: "end", anchorObjectId: "free-shared" },
      second: { geodesicId: "g-short", role: "end", anchorObjectId: "free-shared" },
      freeEndAnchorId: "free-shared",
      lastGoodFreeEndCellId: "a",
      lastGoodFreeEndPoint: { x: 0, y: 0.1505, z: geodesicRayBeamHeightMeters },
    }));

    advanceCurveShorteningPairs({
      world,
      registry,
      deltaSeconds: 1,
      speedMetersPerSecond: 0.4,
    });

    expect(registry.get("g-short")).toBeUndefined();
    expect(registry.get("pair-near-min")).toBeUndefined();
    expect(registry.get("free-shared")).toBeUndefined();
    expect(registry.get("g-long")).toMatchObject({
      kind: "geodesic-interval",
      motionState: "stable",
      start: { geodesicId: "g-long", role: "start", anchorObjectId: "cannon-far" },
      end: { geodesicId: "g-long", role: "end", anchorObjectId: "cannon-near" },
    });
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

  it("looks up tails and removes segment chains", () => {
    const world = compileWorld(false);
    const registry = createRuntimeObjectRegistry();
    const cannon = createGeodesicCannonObject({
      id: "cannon-a",
      cellId: "a",
      localPose: yawRigidTransform3(0, { x: 0.25, y: 1, z: 0 }),
    });
    registry.add(cannon);
    shootGeodesic({ world, registry, cannon, geodesicId: "g-a", maxLengthMeters: 0.5 });
    extendGeodesic({ world, registry, geodesicId: "g-a", maxLengthMeters: 0.5 });

    expect(getGeodesicTail(registry, "g-a")?.segmentIndex).toBe(1);
    expect(getGeodesicSegments(registry, "g-a")).toHaveLength(2);
    removeGeodesic(registry, "g-a");
    expect(registry.getAll().filter((object) => object.kind === "geodesic-segment")).toHaveLength(0);
    expect(registry.get("cannon-a")?.kind).toBe("geodesic-cannon");
  });

  it("clears the old emitter legacy attachment when an interval endpoint is detached", () => {
    const registry = createRuntimeObjectRegistry([
      createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
        activeGeodesicId: "g-a",
        geodesicIds: ["g-a"],
      }),
      createGeodesicCannonObject({
        id: "cannon-b",
        cellId: "a",
        localPose: yawRigidTransform3(Math.PI, { x: 1, y: 0, z: 0 }),
        activeGeodesicId: "g-a",
        geodesicIds: ["g-a"],
      }),
      createFreeGeodesicEndObject({
        id: "free-a",
        cellId: "a",
        point: { x: 0.5, y: 0, z: geodesicRayBeamHeightMeters },
      }),
      createGeodesicIntervalObject({
        id: "g-a",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "cannon-b",
        startCellId: "a",
        motionState: "stable",
      }),
    ]);

    replaceGeodesicEndpointAttachment(registry, "g-a", "start", "free-a");

    expect(getCannonGeodesicIds(registry, "cannon-a")).toEqual([]);
    expect(getCannonGeodesicIds(registry, "cannon-b")).toEqual(["g-a"]);
  });

  it("clears stale active emitter state when a deleted interval is no longer in geodesicIds", () => {
    const registry = createRuntimeObjectRegistry([
      createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }),
        activeGeodesicId: "g-a",
        geodesicIds: [],
        geodesicEmitterYawRadiansById: { "g-a": 0 },
        geodesicConnectionsById: { "g-a": { outgoingEmitterId: "cannon-a", state: "open" } },
      }),
      createFreeGeodesicEndObject({
        id: "free-a",
        cellId: "a",
        point: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
      }),
      createGeodesicIntervalObject({
        id: "g-a",
        startAnchorObjectId: "cannon-a",
        endAnchorObjectId: "free-a",
        startCellId: "a",
        motionState: "stable",
      }),
    ]);

    removeGeodesic(registry, "g-a");

    const cannon = registry.get("cannon-a");
    expect(cannon?.kind === "geodesic-cannon" ? cannon.activeGeodesicId : undefined).toBeUndefined();
    expect(cannon?.kind === "geodesic-cannon" ? cannon.geodesicEmitterYawRadiansById : undefined).toEqual({});
    expect(cannon?.kind === "geodesic-cannon" ? cannon.geodesicConnectionsById : undefined).toEqual({});
  });

  it("creates a vertex balloon where two geodesics intersect outside an emitter", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [vertex] = updateGeodesicIntersectionObjects(registry);

    expect(vertex).toMatchObject({
      kind: "geodesic-intersection",
      cellId: "a",
      tooltip: { label: "vertex", rangeMeters: 3 },
      geodesicIds: ["g-a", "g-b"],
      segmentIds: ["g-a:segment:0", "g-b:segment:0"],
    });
    expect(vertex.localPose.translation).toEqual({ x: 1, y: 1, z: geodesicRayBeamHeightMeters + 0.25 });
    expect(vertex.aimStickyTarget?.localPoint).toEqual({ x: 1, y: 1, z: geodesicRayBeamHeightMeters });
    expect(registry.getAll().filter((object) => object.kind === "geodesic-intersection")).toHaveLength(1);
  });

  it("does not create a vertex balloon at an emitter when geodesics intersect there", () => {
    const registry = createRuntimeObjectRegistry([
      createGeodesicCannonObject({
        id: "cannon-a",
        cellId: "a",
        localPose: yawRigidTransform3(0, { x: 1, y: 1, z: 0 }),
      }),
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const vertices = updateGeodesicIntersectionObjects(registry);

    expect(vertices).toEqual([]);
    expect(registry.getAll().filter((object) => object.kind === "geodesic-intersection")).toHaveLength(0);
  });

  it("keeps vertex identity while a geodesic pair intersection moves continuously", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [first] = updateGeodesicIntersectionObjects(registry);
    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 1.5, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    const [moved] = updateGeodesicIntersectionObjects(registry);

    expect(moved.id).toBe(first.id);
    expect(moved.aimStickyTarget?.localPoint).toEqual({ x: 1.5, y: 1, z: geodesicRayBeamHeightMeters });
  });

  it("remembers a missing vertex and recreates it with the same identity within ten meters", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [first] = updateGeodesicIntersectionObjects(registry);
    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 4, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    expect(updateGeodesicIntersectionObjects(registry)).toEqual([]);
    expect(getRememberedGeodesicIntersectionObject(registry, first.id)?.id).toBe(first.id);

    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 1.25, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    const [recreated] = updateGeodesicIntersectionObjects(registry);

    expect(recreated.id).toBe(first.id);
  });

  it("prunes non-existent vertex memory and refuses to match jumps beyond ten meters", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 20,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);

    const [first] = updateGeodesicIntersectionObjects(registry);
    registry.update(createSegment({
      id: "g-b:segment:0",
      geodesicId: "g-b",
      start: { x: 14, y: 0, z: geodesicRayBeamHeightMeters },
      direction: { x: 0, y: 1, z: 0 },
      lengthMeters: 2,
    }));

    const [jumped] = updateGeodesicIntersectionObjects(registry);

    expect(jumped.id).not.toBe(first.id);
    expect(pruneMissingGeodesicIntersectionObjects(registry)).toEqual([first.id]);
    expect(getRememberedGeodesicIntersectionObject(registry, first.id)).toBeUndefined();
  });

  it("removes stale vertex balloons when a geodesic is removed", () => {
    const registry = createRuntimeObjectRegistry([
      createSegment({
        id: "g-a:segment:0",
        geodesicId: "g-a",
        start: { x: 0, y: 1, z: geodesicRayBeamHeightMeters },
        direction: { x: 1, y: 0, z: 0 },
        lengthMeters: 2,
      }),
      createSegment({
        id: "g-b:segment:0",
        geodesicId: "g-b",
        start: { x: 1, y: 0, z: geodesicRayBeamHeightMeters },
        direction: { x: 0, y: 1, z: 0 },
        lengthMeters: 2,
      }),
    ]);
    updateGeodesicIntersectionObjects(registry);

    removeGeodesic(registry, "g-a");

    expect(registry.getAll().filter((object) => object.kind === "geodesic-intersection")).toHaveLength(0);
  });

  it("rejects zero directions", () => {
    expect(() =>
      traceGeodesicSegment({
        world: compileWorld(false),
        cellId: "a",
        start: { x: 1, y: 1, z: 0.32 },
        direction: { x: 0, y: 0, z: 0 },
        maxLengthMeters: 1,
      }),
    ).toThrow(/near-zero Vec3/);
  });
});

// Kink scenario: free end at the origin joins an arc from a left emitter (-2, 0) and an arc from a top emitter (0, 2), so the corner
// is a right angle and the pair is `"moving"`. Cell `a` of `compileLargeWorld` is 6 m wide.
function createKinkPairScenario(options: { readonly previousTotalLengthMeters?: number }) {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "cannon-left", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "cannon-top", cellId: "a", localPose: yawRigidTransform3(-Math.PI / 2, { x: 0, y: 2, z: 0 }) }));
  registry.add(createFreeGeodesicEndObject({ id: "free-shared", cellId: "a", point: { x: 0, y: 0, z: geodesicRayBeamHeightMeters } }));
  registry.add(createGeodesicIntervalObject({ id: "g-left", startAnchorObjectId: "cannon-left", endAnchorObjectId: "free-shared", startCellId: "a", motionState: "moving" }));
  registry.add(createGeodesicIntervalObject({ id: "g-top", startAnchorObjectId: "free-shared", endAnchorObjectId: "cannon-top", startCellId: "a", motionState: "moving" }));
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-left" });
  rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-top" });
  registry.add(createCurveShorteningPairObject({
    id: "pair-kink",
    first: { geodesicId: "g-left", role: "end", anchorObjectId: "free-shared" },
    second: { geodesicId: "g-top", role: "start", anchorObjectId: "free-shared" },
    freeEndAnchorId: "free-shared",
    previousTotalLengthMeters: options.previousTotalLengthMeters,
    lastGoodFreeEndCellId: "a",
    lastGoodFreeEndPoint: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
  }));
  return { world, registry };
}

function createSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "g-a:segment:0",
    kind: "geodesic-segment",
    cellId: "a",
    localPose: yawRigidTransform3(0, { x: 0, y: 0, z: geodesicRayBeamHeightMeters }),
    portalRenderable: true,
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: 0, y: 0, z: geodesicRayBeamHeightMeters },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 1,
    terminal: { kind: "open" },
    ...overrides,
  };
}

function compileWorld(withPortal: boolean) {
  return compileCellComplex({
    cells: [
      {
        id: "a",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        portals: withPortal ? [{ id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" }] : [],
      },
      {
        id: "b",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        portals: withPortal ? [{ id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" }] : [],
      },
    ],
  });
}

function totalGeodesicLength(registry: ReturnType<typeof createRuntimeObjectRegistry>, geodesicId: string): number {
  return getGeodesicSegments(registry, geodesicId)
    .reduce((total, segment) => total + segment.lengthMeters, 0);
}

function getCannonGeodesicIds(registry: ReturnType<typeof createRuntimeObjectRegistry>, cannonId: string): readonly string[] {
  const cannon = registry.get(cannonId);
  return cannon?.kind === "geodesic-cannon" ? cannon.geodesicIds : [];
}

function getCannonGeodesicYaw(
  registry: ReturnType<typeof createRuntimeObjectRegistry>,
  cannonId: string,
  geodesicId: string,
): number | undefined {
  const cannon = registry.get(cannonId);
  return cannon?.kind === "geodesic-cannon" ? cannon.geodesicEmitterYawRadiansById?.[geodesicId] : undefined;
}

function getCannonPoseYaw(
  registry: ReturnType<typeof createRuntimeObjectRegistry>,
  cannonId: string,
): number | undefined {
  const cannon = registry.get(cannonId);
  return cannon?.kind === "geodesic-cannon"
    ? Math.atan2(cannon.localPose.rotation.m10, cannon.localPose.rotation.m00)
    : undefined;
}

function normalizeYaw(yawRadians: number): number {
  return Math.atan2(Math.sin(yawRadians), Math.cos(yawRadians));
}

function horizontalDistance(left: { readonly x: number; readonly y: number }, right: { readonly x: number; readonly y: number }): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function horizontalDirection(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly z: 0 } {
  const length = horizontalDistance(start, end);
  return { x: (end.x - start.x) / length, y: (end.y - start.y) / length, z: 0 };
}

function createCarryPortalTransition(
  world: ReturnType<typeof compileLargePortalWorld> | ReturnType<typeof compileThreeCellPortalWorld>,
  sourceCellId: string,
  sourcePortalId: string,
) {
  const portal = world.cellsById.get(sourceCellId)?.portalsById.get(sourcePortalId);
  if (!portal) {
    throw new Error(`Missing portal ${sourceCellId}:${sourcePortalId}.`);
  }

  return {
    sourceCellId,
    sourcePortalId,
    targetCellId: portal.targetCellId,
    targetPortalId: portal.targetPortalId,
    transformToTarget: portal.transformToTarget,
  };
}

function createCarryPortalTraversal(
  world: ReturnType<typeof compileLargePortalWorld> | ReturnType<typeof compileThreeCellPortalWorld>,
  sourceCellId: string,
  sourcePortalId: string,
) {
  const portal = world.cellsById.get(sourceCellId)?.portalsById.get(sourcePortalId);
  if (!portal) {
    throw new Error(`Missing portal ${sourceCellId}:${sourcePortalId}.`);
  }

  return {
    sourceCellId,
    sourcePortalId,
    targetCellId: portal.targetCellId,
    targetPortalId: portal.targetPortalId,
  };
}

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

function compileLargePortalWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "a",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "ab", sideIndex: 1, targetCellId: "b", targetPortalId: "ba" }],
      },
      {
        id: "b",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "ba", sideIndex: 3, targetCellId: "a", targetPortalId: "ab" }],
      },
    ],
  });
}

function compileThreeCellPortalWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "front",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "front-left", sideIndex: 1, targetCellId: "left", targetPortalId: "left-front" }],
      },
      {
        id: "left",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [
          { id: "left-front", sideIndex: 3, targetCellId: "front", targetPortalId: "front-left" },
          { id: "left-back", sideIndex: 1, targetCellId: "back", targetPortalId: "back-left" },
        ],
      },
      {
        id: "back",
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
        portals: [{ id: "back-left", sideIndex: 3, targetCellId: "left", targetPortalId: "left-back" }],
      },
    ],
  });
}

function compileTorusLoopWorld() {
  return compileCellComplex({
    cells: [
      {
        id: "torus-room",
        heightMeters: 3,
        baseVertices: [
          { x: -7.5, y: -7.5 },
          { x: 7.5, y: -7.5 },
          { x: 7.5, y: 7.5 },
          { x: -7.5, y: 7.5 },
        ],
        portals: [
          { id: "bottom-top", sideIndex: 0, targetCellId: "torus-room", targetPortalId: "top-bottom" },
          { id: "right-left", sideIndex: 1, targetCellId: "torus-room", targetPortalId: "left-right" },
          { id: "top-bottom", sideIndex: 2, targetCellId: "torus-room", targetPortalId: "bottom-top" },
          { id: "left-right", sideIndex: 3, targetCellId: "torus-room", targetPortalId: "right-left" },
        ],
      },
    ],
  });
}
