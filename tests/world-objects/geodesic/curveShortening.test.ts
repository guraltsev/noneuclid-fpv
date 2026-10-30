import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  advanceCurveShorteningPairs,
  curveShorteningLengthIncreaseToleranceMeters,
  tieAndDetachGeodesicEndpoints,
} from "../../../src/world-objects/geodesic/curveShortening";
import {
  createCurveShorteningPairObject,
  createFreeGeodesicEndObject,
  createGeodesicCannonObject,
  createGeodesicIntervalObject,
  geodesicRayBeamHeightMeters,
} from "../../../src/world-objects/geodesic/objects";
import { getGeodesicEndpointAttachmentsForAnchor } from "../../../src/world-objects/geodesic/endpoints";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import {
  previewRebuildGeodesicInterval,
  rebuildDerivedGeodesicSegments,
  traceGeodesicFromLiftedChord,
} from "../../../src/world-objects/geodesic/intervals";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../../src/world-objects/geodesic/cannon";
import { yawRigidTransform3 } from "../.././../src/math/rigidTransform3";
import {
  createKinkPairScenario,
  createSegment,
  totalGeodesicLength,
  horizontalDistance,
  horizontalDirection,
  createCarryPortalTraversal,
  compileLargeWorld,
  compileLargePortalWorld,
  compileTorusLoopWorld,
  compileRotatedFreeLoopWorld,
  runCurveShorteningUntilPairGone,
  createTorusTiedPairScenario,
  createSymmetricPairScenario,
} from "./fixtures";

describe("geodesic cannon world objects: curve shortening", () => {
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

  describe("curve shortening at any frame rate (job 06)", () => {
    it("fuses the issue 66 torus pair into the same loop at 60 Hz and at 240 Hz", () => {
      for (const [deltaSeconds, maxTicks] of [[1 / 60, 300], [1 / 240, 1200]] as const) {
        const { world, registry } = createTorusTiedPairScenario();
        runCurveShorteningUntilPairGone(world, registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds, maxTicks });
        expect(registry.get("pair")).toBeUndefined();
        expect(registry.get("g2")).toBeUndefined();
        expect(registry.get("g1")).toMatchObject({
          motionState: "stable",
          start: { anchorObjectId: "e1" },
          end: { anchorObjectId: "e1" },
        });
        expect((registry.get("g1") as { portalWord?: unknown }).portalWord).toEqual([createCarryPortalTraversal(world, "torus-room", "right-left")]);
        expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(15, 6);
      }
    });

    it("does not 2-cycle next to the fuse angle on 0.2 m arcs", () => {
      for (const deltaSeconds of [1 / 60, 1 / 240]) {
        const { world, registry } = createSymmetricPairScenario(0.2, 0.01);
        runCurveShorteningUntilPairGone(world, registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds, maxTicks: 10 });
        expect(registry.get("pair")).toBeUndefined();
        expect(registry.get("g1")).toMatchObject({
          motionState: "stable",
          start: { anchorObjectId: "e1" },
          end: { anchorObjectId: "e2" },
        });
        expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(0.4, 6);
        expect(registry.get("g2")).toBeUndefined();
      }
    });

    it("reaches the fuse within ceil(distance / step) + 2 ticks at 240 Hz", () => {
      const { world, registry } = createSymmetricPairScenario(1, 1);
      const maxTicks = Math.ceil(1 / (0.4 / 240)) + 2;
      const ticks = runCurveShorteningUntilPairGone(world, registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds: 1 / 240, maxTicks });
      expect(ticks).toBeLessThanOrEqual(maxTicks);
      expect(registry.get("pair")).toBeUndefined();
      expect(registry.get("g1")).toMatchObject({
        motionState: "stable",
        start: { anchorObjectId: "e1" },
        end: { anchorObjectId: "e2" },
      });
      expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(2, 6);
    });

    it("keeps moving a free loop at 240 Hz until it is resolved", () => {
      const world = compileRotatedFreeLoopWorld();
      const registry = createRuntimeObjectRegistry();
      const point = { x: 4.9, y: 1, z: geodesicRayBeamHeightMeters };
      registry.add(createFreeGeodesicEndObject({ id: "free-loop", cellId: "a", point }));
      registry.add(createGeodesicIntervalObject({
        id: "g-loop",
        startAnchorObjectId: "free-loop",
        endAnchorObjectId: "free-loop",
        startCellId: "a",
        motionState: "moving",
        portalWord: [
          createCarryPortalTraversal(world, "a", "ab"),
          createCarryPortalTraversal(world, "b", "b-bottom"),
          createCarryPortalTraversal(world, "b", "ba"),
        ],
      }));
      expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-loop" })).toBeTruthy();
      const startLength = totalGeodesicLength(registry, "g-loop");
      expect(startLength).toBeCloseTo(7.34983, 5);
      registry.add(createCurveShorteningPairObject({
        id: "pair-loop",
        first: { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" },
        second: { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" },
        freeEndAnchorId: "free-loop",
        previousTotalLengthMeters: startLength,
        lastGoodFreeEndCellId: "a",
        lastGoodFreeEndPoint: point,
      }));

      advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 / 240 });

      const freeEnd = registry.get("free-loop");
      expect(freeEnd).toMatchObject({ kind: "free-geodesic-end", cellId: "a" });
      expect(freeEnd?.localPose.translation.x).toBeCloseTo(4.9016, 4);
      expect(freeEnd?.localPose.translation.y).toBeCloseTo(0.9997, 4);
      expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(7.347473, 5);

      runCurveShorteningUntilPairGone(world, registry, { pairId: "pair-loop", geodesicIds: ["g-loop"], deltaSeconds: 1 / 240, maxTicks: 3100 });
      expect(registry.get("pair-loop")).toBeUndefined();
      expect(registry.get("g-loop")).toBeUndefined();
      expect(registry.get("free-loop")).toBeUndefined();
    });

    it("deletes a free loop below the minimum length at 240 Hz", () => {
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

      const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 / 240 });

      expect(changed).toContain("pair-loop");
      expect(registry.get("g-loop")).toBeUndefined();
      expect(registry.get("free-loop")).toBeUndefined();
      expect(registry.get("pair-loop")).toBeUndefined();
    });
  });
});
