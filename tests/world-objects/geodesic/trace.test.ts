import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  createGeodesicCannonObject,
  geodesicRayBeamHeightMeters,
  geodesicRayBeamStartOffsetMeters,
  resolveGeodesicCannonAimYawRadians,
} from "../../../src/world-objects/geodesic/objects";
import { extendGeodesic, rebuildGeodesicToLength, shootGeodesic } from "../../../src/world-objects/geodesic/cannon";
import {
  getGeodesicEndpointAttachmentsForAnchor,
  getGeodesicEndpoints,
  resolveGeodesicEndpointSelectionFromSegmentHit,
} from "../../../src/world-objects/geodesic/endpoints";
import { getGeodesicSegments, resolveGeodesicNumber } from "../../../src/world-objects/geodesic/segments";
import { removeUnlockedGeodesicsFromCannon } from "../../../src/world-objects/geodesic/lifecycle";
import { traceGeodesicSegment } from "../../../src/world-objects/geodesic/trace";
import { yawRigidTransform3 } from "../.././../src/math/rigidTransform3";
import {
  createSegment,
  compileWorld,
  totalGeodesicLength,
  getCannonGeodesicIds,
  compileLargeWorld,
  compileLargePortalWorld,
} from "./fixtures";

describe("geodesic cannon world objects: trace", () => {
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
