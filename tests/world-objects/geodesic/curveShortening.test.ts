import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../.././../src/world-objects/runtimeObjectRegistry";
import {
  advanceCurveShorteningPairs,
  resolveCurveShorteningPair,
  tieAndDetachGeodesicEndpoints,
  type CurveShorteningNotice,
} from "../../../src/world-objects/geodesic/curveShortening";
import { isGeodesicLocked } from "../../../src/world-objects/geodesic/lifecycle";
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
  createSegment,
  totalGeodesicLength,
  createCarryPortalTraversal,
  compileLargeWorld,
  compileLargePortalWorld,
  compileTorusLoopWorld,
  compileRotatedFreeLoopWorld,
  compileNarrowPortalWorld,
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
    }));

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: 1 });

    expect(changed).toEqual(["g-a", "g-b"]);
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

  describe("exact resolution", () => {
    function createCornerScenario() {
      const world = compileLargePortalWorld();
      const registry = createRuntimeObjectRegistry();
      registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 0.1, z: 0 }) }));
      registry.add(createGeodesicCannonObject({ id: "e2", cellId: "b", localPose: yawRigidTransform3(0, { x: 2, y: 0.1, z: 0 }) }));
      registry.add(createFreeGeodesicEndObject({ id: "F", cellId: "a", point: { x: 4.5, y: 2.5, z: geodesicRayBeamHeightMeters } }));
      registry.add(createGeodesicIntervalObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "F", startCellId: "a", motionState: "moving" }));
      registry.add(createGeodesicIntervalObject({
        id: "g2",
        startAnchorObjectId: "F",
        endAnchorObjectId: "e2",
        startCellId: "a",
        portalWord: [createCarryPortalTraversal(world, "a", "ab")],
        motionState: "moving",
      }));
      expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" })).toBeTruthy();
      expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g2" })).toBeTruthy();
      registry.add(createCurveShorteningPairObject({
        id: "pair",
        first: { geodesicId: "g1", role: "end", anchorObjectId: "F" },
        second: { geodesicId: "g2", role: "start", anchorObjectId: "F" },
        freeEndAnchorId: "F",
        lastGoodFreeEndCellId: "a",
        lastGoodFreeEndPoint: { x: 4.5, y: 2.5, z: geodesicRayBeamHeightMeters },
      }));
      return { world, registry };
    }

    it("B1: wraps the junction disk with one corner when the chord would pass too close to it", () => {
      const { world, registry } = createCornerScenario();
      const notices: CurveShorteningNotice[] = [];

      const result = resolveCurveShorteningPair({ world, registry, pairId: "pair", onNotice: (notice) => notices.push(notice) });

      expect(result).toMatchObject({ status: "resolved", geodesicIds: ["g1", "g1:piece:1"], removedIds: ["g2"] });
      expect(notices).toEqual([]);
      expect(registry.get("pair")).toBeUndefined();
      expect(registry.get("F")).toBeUndefined();
      expect(registry.get("g2")).toBeUndefined();
      const corners = registry.getAll().filter((object) => object.kind === "geodesic-corner");
      expect(corners).toHaveLength(1);
      expect(corners[0]).toMatchObject({ id: "pair:corner:0", cellId: "a", junctionId: "a:vertex-1", side: "right" });
      expect(corners[0].localPose.translation.x).toBeCloseTo(4.998114, 5);
      expect(corners[0].localPose.translation.y).toBeCloseTo(0.150095, 5);
      expect(registry.get("g1")).toMatchObject({
        motionState: "stable",
        start: { anchorObjectId: "e1" },
        end: { anchorObjectId: "pair:corner:0" },
        portalWord: [],
      });
      expect(registry.get("g1:piece:1")).toMatchObject({
        motionState: "stable",
        start: { anchorObjectId: "pair:corner:0" },
        end: { anchorObjectId: "e2" },
        portalWord: [createCarryPortalTraversal(world, "a", "ab")],
      });
      expect(isGeodesicLocked(registry, "g1")).toBe(true);
      expect(isGeodesicLocked(registry, "g1:piece:1")).toBe(true);
      expect(totalGeodesicLength(registry, "g1") + totalGeodesicLength(registry, "g1:piece:1")).toBeCloseTo(3.001883, 6);
    });

    it("B2: resolves a symmetric pair to the straight chord", () => {
      const { world, registry } = createSymmetricPairScenario(1, 1);

      const result = resolveCurveShorteningPair({ world, registry, pairId: "pair" });

      expect(result).toMatchObject({ status: "resolved", geodesicIds: ["g1"], removedIds: ["g2"] });
      expect(registry.get("g1")).toMatchObject({ motionState: "stable", start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e2" } });
      expect(registry.get("g2")).toBeUndefined();
      expect(registry.getAll().filter((object) => object.kind === "geodesic-corner")).toEqual([]);
      expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(2, 9);
    });

    it("B3: resolves the issue 66 torus pair to a stable loop at the emitter", () => {
      const { world, registry } = createTorusTiedPairScenario();

      const result = resolveCurveShorteningPair({ world, registry, pairId: "pair" });

      expect(result.status).toBe("resolved");
      expect(registry.get("g1")).toMatchObject({
        motionState: "stable",
        start: { anchorObjectId: "e1" },
        end: { anchorObjectId: "e1" },
        portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
      });
      expect(registry.get("g2")).toBeUndefined();
      expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(15, 9);
      expect(getGeodesicSegments(registry, "g1")).toHaveLength(3);
    });

    it("B4: deletes a free loop that encircles a cone point and sends a notice", () => {
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
      registry.add(createCurveShorteningPairObject({
        id: "pair-loop",
        first: { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" },
        second: { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" },
        freeEndAnchorId: "free-loop",
        lastGoodFreeEndCellId: "a",
        lastGoodFreeEndPoint: point,
      }));
      const notices: CurveShorteningNotice[] = [];

      const result = resolveCurveShorteningPair({ world, registry, pairId: "pair-loop", onNotice: (notice) => notices.push(notice) });

      expect(result).toMatchObject({ status: "deleted" });
      expect(registry.get("g-loop")).toBeUndefined();
      expect(registry.get("free-loop")).toBeUndefined();
      expect(registry.get("pair-loop")).toBeUndefined();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ kind: "free-loop-collapsed", geodesicId: "g-loop" });
    });

    it("B5: a torus free loop stays as one stable loop on its free end", () => {
      const world = compileTorusLoopWorld();
      const registry = createRuntimeObjectRegistry();
      const point = { x: 1, y: 2.3, z: geodesicRayBeamHeightMeters };
      registry.add(createFreeGeodesicEndObject({ id: "free-loop", cellId: "torus-room", point }));
      registry.add(createGeodesicIntervalObject({
        id: "g-loop",
        startAnchorObjectId: "free-loop",
        endAnchorObjectId: "free-loop",
        startCellId: "torus-room",
        motionState: "moving",
        portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
      }));
      expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-loop" })).toBeTruthy();
      registry.add(createCurveShorteningPairObject({
        id: "pair-loop",
        first: { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" },
        second: { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" },
        freeEndAnchorId: "free-loop",
        lastGoodFreeEndCellId: "torus-room",
        lastGoodFreeEndPoint: point,
      }));

      const result = resolveCurveShorteningPair({ world, registry, pairId: "pair-loop" });

      expect(result).toMatchObject({ status: "resolved", geodesicIds: ["g-loop"] });
      expect(registry.get("pair-loop")).toBeUndefined();
      expect(registry.get("free-loop")).toBeDefined();
      expect(registry.get("g-loop")).toMatchObject({
        motionState: "stable",
        start: { anchorObjectId: "free-loop" },
        end: { anchorObjectId: "free-loop" },
      });
      expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(15, 9);
      expect(registry.getAll().filter((object) => object.kind === "geodesic-corner")).toEqual([]);
    });

    function createNarrowPortalScenario(freeEndCellId: "a" | "b") {
      const world = compileNarrowPortalWorld();
      const registry = createRuntimeObjectRegistry();
      registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: 1, y: 0.5, z: 0 }) }));
      registry.add(createGeodesicCannonObject({ id: "e2", cellId: "b", localPose: yawRigidTransform3(0, { x: 1, y: 0.5, z: 0 }) }));
      registry.add(createFreeGeodesicEndObject({ id: "F", cellId: freeEndCellId, point: { x: 1, y: 1, z: geodesicRayBeamHeightMeters } }));
      const through = [createCarryPortalTraversal(world, "a", "ab")];
      registry.add(createGeodesicIntervalObject({
        id: "g1",
        startAnchorObjectId: "e1",
        endAnchorObjectId: "F",
        startCellId: "a",
        portalWord: freeEndCellId === "a" ? [] : through,
        motionState: "moving",
      }));
      registry.add(createGeodesicIntervalObject({
        id: "g2",
        startAnchorObjectId: "F",
        endAnchorObjectId: "e2",
        startCellId: freeEndCellId,
        portalWord: freeEndCellId === "a" ? through : [],
        motionState: "moving",
      }));
      registry.add(createCurveShorteningPairObject({
        id: "pair",
        first: { geodesicId: "g1", role: "end", anchorObjectId: "F" },
        second: { geodesicId: "g2", role: "start", anchorObjectId: "F" },
        freeEndAnchorId: "F",
        lastGoodFreeEndCellId: freeEndCellId,
        lastGoodFreeEndPoint: { x: 1, y: 1, z: geodesicRayBeamHeightMeters },
      }));
      return { world, registry };
    }

    it("B6: an infeasible word leaves everything unchanged and marks the pair unresolved", () => {
      const { world, registry } = createNarrowPortalScenario("a");
      const before = {
        g1: registry.get("g1"),
        g2: registry.get("g2"),
        F: registry.get("F"),
        segments: registry.getAll().filter((object) => object.kind === "geodesic-segment"),
      };
      const notices: CurveShorteningNotice[] = [];

      const result = resolveCurveShorteningPair({ world, registry, pairId: "pair", onNotice: (notice) => notices.push(notice) });

      expect(result).toEqual({ status: "unresolved", reason: "infeasible" });
      expect(registry.get("g1")).toEqual(before.g1);
      expect(registry.get("g2")).toEqual(before.g2);
      expect(registry.get("F")).toEqual(before.F);
      expect(registry.getAll().filter((object) => object.kind === "geodesic-segment")).toEqual(before.segments);
      expect(registry.get("pair")).toMatchObject({ state: "unresolved" });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ kind: "unresolved", pairId: "pair", reason: "infeasible" });
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
