/**
 * `tests/world-objects/geodesic/curveShortening.test.ts` ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â unit tier.
 *
 * Curve shortening is a flow: tying two locked endpoints at a shared free end makes a piecewise-geodesic curve whose free vertices relax over
 * many ticks of `advanceCurveShorteningPairs` (each moves along the descent direction of the total length by an exact line search, the
 * neighbouring arcs are re-realized as geodesic chords of their portal words, and a vertex whose turning angle is below the tolerance is
 * removed). These tests check: tying; one small tick leaving a moving pair that has moved a bounded distance; the flow of a two-arc pair, a
 * curve of six arcs with five free vertices, a torus loop pair and free loops reaching the known taut geometry within a tolerance; the
 * total length never growing and the number of free vertices never growing at any tick; the same limit at 60 Hz and 240 Hz; a loop around a
 * cone point shrinking until it is deleted with a notice; and a curve that would need a wrap vertex at a forbidden-zone disk being left unresolved.
 */
import { describe, expect, it } from "vitest";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import {
  advanceCurveShorteningPairs,
  curveShorteningSpeedMetersPerSecond,
  tieAndDetachGeodesicEndpoints,
  type CurveShorteningNotice,
} from "../../../src/world-objects/geodesic/curveShortening";
import { isGeodesicLocked } from "../../../src/world-objects/geodesic/lifecycle";
import {
  createCurveShorteningPairObject,
  createGeodesicVertexObject,
  createGeodesicCannonObject,
  createGeodesicArcObject,
  geodesicRayBeamHeightMeters,
  type GeodesicSegmentObject,
} from "../../../src/world-objects/geodesic/objects";
import { getGeodesicEndpointAttachmentsForAnchor } from "../../../src/world-objects/geodesic/endpoints";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { rebuildDerivedGeodesicSegments } from "../../../src/world-objects/geodesic/intervals";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../../src/world-objects/geodesic/cannon";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import {
  compileLargeWorld,
  compileRotatedFreeLoopWorld,
  compileTorusLoopWorld,
  createCarryPortalTraversal,
  compileLargePortalWorld,
  createSymmetricPairScenario,
  createTorusTiedPairScenario,
  runCurveShorteningUntilPairGone,
  totalGeodesicLength,
} from "../../fixtures/world-objects/geodesic";

const beamZ = geodesicRayBeamHeightMeters;
const frame60Hz = 1 / 60;

function maxSideViolation(world: ReturnType<typeof compileLargeWorld>, registry: ReturnType<typeof createRuntimeObjectRegistry>): number {
  let worst = 0;
  for (const segment of registry.getAll().filter((object): object is GeodesicSegmentObject => object.kind === "geodesicModel/segment")) {
    const cell = world.cellsById.get(segment.cellId);
    if (!cell) {
      throw new Error(`Missing cell ${segment.cellId}.`);
    }
    const end = {
      x: segment.start.x + segment.direction.x * segment.lengthMeters,
      y: segment.start.y + segment.direction.y * segment.lengthMeters,
    };
    for (const side of cell.sides) {
      for (const point of [segment.start, end]) {
        const signed = (point.x - side.start.x) * side.inwardNormal.x + (point.y - side.start.y) * side.inwardNormal.y;
        worst = Math.max(worst, -signed);
      }
    }
  }
  return worst;
}

// Emitters e1 and e2 in the 6 m cell joined by a chain of moving arcs through the given free vertices (a zigzag when the points alternate sides).
function createChainScenario(start: { x: number; y: number }, end: { x: number; y: number }, vertices: readonly { x: number; y: number }[]) {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { ...start, z: 0 }) }));
  registry.add(createGeodesicCannonObject({ id: "e2", cellId: "a", localPose: yawRigidTransform3(0, { ...end, z: 0 }) }));
  const ids = vertices.map((_, index) => `v${index}`);
  vertices.forEach((point, index) => {
    registry.add(createGeodesicVertexObject({ id: ids[index], cellId: "a", point: { ...point, z: beamZ } }));
  });
  const anchors = ["e1", ...ids, "e2"];
  for (let index = 0; index + 1 < anchors.length; index += 1) {
    registry.add(createGeodesicArcObject({
      id: `g${index}`,
      startAnchorObjectId: anchors[index],
      endAnchorObjectId: anchors[index + 1],
      startCellId: "a",
      motionState: "moving",
    }));
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: `g${index}` })).toBeTruthy();
  }
  registry.add(createCurveShorteningPairObject({ id: "pair", vertexIds: ids, cellId: "a" }));
  return { world, registry };
}

function totalCurveLength(registry: ReturnType<typeof createRuntimeObjectRegistry>): number {
  return registry.getObjectsOfKind("geodesicModel/segment").reduce((total, segment) => total + segment.lengthMeters, 0);
}

describe("geodesic cannon world objects: tie and detach", () => {
  it("detaches the two endpoint roles of a same-emitter loop into one curve-shortening free end", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "cannon-a", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }) }));
    registry.add(createGeodesicArcObject({
      id: "g-loop",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-a",
      startCellId: "torus-room",
      portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
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

    expect(pair).toMatchObject({ id: "pair-loop", kind: "curve-shortening-pair", vertexIds: ["free-loop"], state: "moving" });
    expect(getGeodesicEndpointAttachmentsForAnchor(registry, "free-loop")).toEqual([
      { geodesicId: "g-loop", role: "start", anchorObjectId: "free-loop" },
      { geodesicId: "g-loop", role: "end", anchorObjectId: "free-loop" },
    ]);
    expect(registry.get("g-loop")).toMatchObject({ kind: "geodesicModel/arc", motionState: "moving" });
    expect(getGeodesicSegments(registry, "g-loop").map((segment) => segment.connectionState)).toContain("moving");
  });

  it("tying two locked intervals at one emitter creates two moving intervals and a pair", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "left", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "middle", cellId: "a", localPose: yawRigidTransform3(0, { x: 0, y: 1, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "right", cellId: "a", localPose: yawRigidTransform3(0, { x: 2, y: 0, z: 0 }) }));
    registry.add(createGeodesicArcObject({ id: "g-lm", startAnchorObjectId: "left", endAnchorObjectId: "middle", startCellId: "a" }));
    registry.add(createGeodesicArcObject({ id: "g-mr", startAnchorObjectId: "middle", endAnchorObjectId: "right", startCellId: "a" }));
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-lm" });
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-mr" });
    expect(isGeodesicLocked(registry, "g-lm")).toBe(true);
    expect(isGeodesicLocked(registry, "g-mr")).toBe(true);

    const pair = tieAndDetachGeodesicEndpoints({
      world,
      registry,
      detachedEmitterId: "middle",
      first: { geodesicId: "g-lm", role: "end", anchorObjectId: "middle" },
      second: { geodesicId: "g-mr", role: "start", anchorObjectId: "middle" },
      createPairId: () => "pair",
      createFreeEndId: () => "free",
    });

    expect(pair).toMatchObject({ id: "pair", state: "moving", vertexIds: ["free"] });
    expect(registry.getAll().filter((object) => object.kind === "curve-shortening-pair")).toHaveLength(1);
    expect(registry.get("g-lm")).toMatchObject({ motionState: "moving", end: { anchorObjectId: "free" } });
    expect(registry.get("g-mr")).toMatchObject({ motionState: "moving", start: { anchorObjectId: "free" } });
    expect(registry.get("free")).toMatchObject({ kind: "geodesicModel/vertex", cellId: "a", localPose: { translation: { x: 0, y: 1 } } });
    expect(totalGeodesicLength(registry, "g-lm")).toBeCloseTo(Math.hypot(2, 1), 9);
  });
});

describe("curve shortening flow of a two-arc pair", () => {
  it("one small tick moves the free end a bounded distance and leaves a moving pair", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const before = totalCurveLength(registry);

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz });

    expect(changed).toEqual(expect.arrayContaining(["g1", "g2"]));
    expect(registry.get("pair")).toMatchObject({ state: "moving" });
    expect(registry.get("g1")).toMatchObject({ motionState: "moving" });
    const free = registry.get("free");
    const moved = Math.hypot((free?.localPose.translation.x ?? 0) - 0, (free?.localPose.translation.y ?? 0) - 2);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(curveShorteningSpeedMetersPerSecond * frame60Hz + 1e-9);
    expect(totalCurveLength(registry)).toBeLessThan(before);
  });

  it("shortens over many ticks and ends as the straight stable chord between the emitters", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);

    const ticks = runCurveShorteningUntilPairGone(world, registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });

    expect(ticks).toBeGreaterThan(20);
    expect(registry.get("pair")).toBeUndefined();
    expect(registry.get("free")).toBeUndefined();
    expect(registry.get("g2")).toBeUndefined();
    expect(registry.get("g1")).toMatchObject({ motionState: "stable", start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e2" } });
    expect(isGeodesicLocked(registry, "g1")).toBe(true);
    expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(4, 2);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
  });

  it("reaches the same limit at 60 Hz and 240 Hz", () => {
    const slow = createSymmetricPairScenario(2, 1.5);
    const fast = createSymmetricPairScenario(2, 1.5);

    runCurveShorteningUntilPairGone(slow.world, slow.registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });
    runCurveShorteningUntilPairGone(fast.world, fast.registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz / 4, maxTicks: 16000 });

    expect(totalGeodesicLength(slow.registry, "g1")).toBeCloseTo(totalGeodesicLength(fast.registry, "g1"), 2);
    expect(slow.registry.get("g1")).toMatchObject({ motionState: "stable" });
    expect(fast.registry.get("g1")).toMatchObject({ motionState: "stable" });
  });

  it("is a single frame's worth of motion per tick whatever the frame time is", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);

    advanceCurveShorteningPairs({ world, registry, deltaSeconds: 5 });

    const free = registry.get("free");
    const moved = Math.hypot((free?.localPose.translation.x ?? 0) - 0, (free?.localPose.translation.y ?? 0) - 2);
    expect(moved).toBeLessThanOrEqual(curveShorteningSpeedMetersPerSecond * 0.1 + 1e-9);
  });

  it("does nothing for a non-positive frame time", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);

    expect(advanceCurveShorteningPairs({ world, registry, deltaSeconds: 0 })).toEqual([]);
    expect(registry.get("free")).toMatchObject({ localPose: { translation: { x: 0, y: 2 } } });
  });

  it("flows a pair tied across a portal to the straight stable geodesic of its class", () => {
    const { world, registry } = createTorusTiedPairScenario();

    const ticks = runCurveShorteningUntilPairGone(world, registry, { pairId: "pair", geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });

    expect(ticks).toBeGreaterThan(1);
    expect(registry.get("pair")).toBeUndefined();
    expect(registry.get("free")).toBeUndefined();
    expect(registry.get("g2")).toBeUndefined();
    expect(registry.get("g1")).toMatchObject({
      motionState: "stable",
      start: { anchorObjectId: "e1" },
      end: { anchorObjectId: "e1" },
      portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
    });
    expect(isGeodesicLocked(registry, "g1")).toBe(true);
    expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(15, 2);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
  });
});

describe("curve shortening flow of a curve with many vertices", () => {
  const zigzag = [
    { x: -1.5, y: 1.5 },
    { x: -0.5, y: -1.4 },
    { x: 0.5, y: 1.2 },
    { x: 1.2, y: -1.0 },
    { x: 2.0, y: 0.8 },
  ];

  it("starts as six arcs through five free vertices", () => {
    const { registry } = createChainScenario({ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, zigzag);

    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(6);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(5);
    expect(registry.get("pair")).toMatchObject({ vertexIds: ["v0", "v1", "v2", "v3", "v4"] });
  });

  it("never lengthens, never gains a vertex, relaxes every vertex and ends on the straight chord", () => {
    const { world, registry } = createChainScenario({ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, zigzag);
    let previousLength = totalCurveLength(registry);
    let previousVertices = registry.getObjectsOfKind("geodesicModel/vertex").length;
    const initialLength = previousLength;
    let ticks = 0;

    while (registry.get("pair") && ticks < 20000) {
      advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz });
      ticks += 1;
      const length = totalCurveLength(registry);
      const vertices = registry.getObjectsOfKind("geodesicModel/vertex").length;
      expect(length).toBeLessThanOrEqual(previousLength + 1e-9);
      expect(vertices).toBeLessThanOrEqual(previousVertices);
      previousLength = length;
      previousVertices = vertices;
    }

    expect(registry.get("pair")).toBeUndefined();
    expect(ticks).toBeGreaterThan(50);
    expect(initialLength).toBeGreaterThan(10);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(0);
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(1);
    expect(registry.getObjectsOfKind("geodesicModel/arc")[0]).toMatchObject({
      motionState: "stable",
      start: { anchorObjectId: "e1" },
      end: { anchorObjectId: "e2" },
    });
    expect(previousLength).toBeCloseTo(5, 1);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
  });

  it("keeps arcs moving until the last vertex is removed", () => {
    const { world, registry } = createChainScenario({ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, zigzag);

    for (let tick = 0; tick < 30; tick += 1) {
      advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz });
    }

    expect(registry.get("pair")).toMatchObject({ state: "moving" });
    for (const interval of registry.getObjectsOfKind("geodesicModel/arc")) {
      expect(interval.motionState).toBe("moving");
    }
  });
});

describe("curve shortening flow of loops", () => {
  function createFreeLoop(world: ReturnType<typeof compileTorusLoopWorld>, cellId: string, point: { x: number; y: number }, word: ReturnType<typeof createCarryPortalTraversal>[]) {
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicVertexObject({ id: "free-loop", cellId, point: { ...point, z: beamZ } }));
    registry.add(createGeodesicArcObject({
      id: "g-loop",
      startAnchorObjectId: "free-loop",
      endAnchorObjectId: "free-loop",
      startCellId: cellId,
      motionState: "moving",
      portalWord: word,
    }));
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-loop" })).toBeTruthy();
    registry.add(createCurveShorteningPairObject({ id: "pair-loop", vertexIds: ["free-loop"], cellId }));
    return registry;
  }

  it("makes a torus free loop a stable loop on its free end", () => {
    const world = compileTorusLoopWorld();
    const registry = createFreeLoop(world, "torus-room", { x: 1, y: 2.3 }, [createCarryPortalTraversal(world, "torus-room", "right-left")]);

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz });

    expect(changed).toEqual(expect.arrayContaining(["g-loop", "pair-loop"]));
    expect(registry.get("pair-loop")).toBeUndefined();
    expect(registry.get("g-loop")).toMatchObject({ motionState: "stable", start: { anchorObjectId: "free-loop" }, end: { anchorObjectId: "free-loop" } });
    expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(15, 6);
  });

  it("shrinks a loop around a cone point until it is deleted with a notice", () => {
    const world = compileRotatedFreeLoopWorld();
    const registry = createFreeLoop(world, "a", { x: 4.9, y: 1 }, [
      createCarryPortalTraversal(world, "a", "ab"),
      createCarryPortalTraversal(world, "b", "b-bottom"),
      createCarryPortalTraversal(world, "b", "ba"),
    ]);
    const notices: CurveShorteningNotice[] = [];
    let previousLength = totalCurveLength(registry);
    let ticks = 0;

    while (registry.get("pair-loop") && ticks < 4000) {
      advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz, onNotice: (notice) => notices.push(notice) });
      ticks += 1;
      if (registry.get("g-loop")) {
        const length = totalCurveLength(registry);
        expect(length).toBeLessThanOrEqual(previousLength + 1e-9);
        previousLength = length;
      }
    }

    expect(ticks).toBeGreaterThan(1);
    expect(registry.get("g-loop")).toBeUndefined();
    expect(registry.get("free-loop")).toBeUndefined();
    expect(registry.get("pair-loop")).toBeUndefined();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "free-loop-collapsed", geodesicId: "g-loop" });
  });
});

describe("curve shortening flow when a vertex cannot move", () => {
  it("collapses a pair whose emitters are closer than the minimum geodesic length", () => {
    const { world, registry } = createChainScenario({ x: 0, y: 0 }, { x: 0.1, y: 0 }, [{ x: 0.05, y: 1 }]);
    const notices: CurveShorteningNotice[] = [];

    let ticks = 0;
    while (registry.get("pair") && ticks < 2000) {
      advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz, onNotice: (notice) => notices.push(notice) });
      ticks += 1;
    }

    expect(registry.get("pair")).toBeUndefined();
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(0);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(0);
    expect(notices.some((notice) => notice.kind === "collapsed" || notice.kind === "unresolved")).toBe(true);
  });

  it("leaves an unresolved pair untouched and skips it on later ticks", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const pair = registry.get("pair");
    if (pair?.kind !== "curve-shortening-pair") {
      throw new Error("missing pair");
    }
    registry.update({ ...pair, state: "unresolved" });
    const lengthBefore = totalCurveLength(registry);

    const changed = advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz });

    expect(changed).toEqual([]);
    expect(totalCurveLength(registry)).toBe(lengthBefore);
  });
});

describe("curve shortening flow across portals and around junction disks", () => {
  it("flows three vertices through the torus seam to the straight chord of its class", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const seam = createCarryPortalTraversal(world, "torus-room", "right-left");
    registry.add(createGeodesicCannonObject({ id: "e1", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 6, y: 0, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "e2", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: -5, y: 0, z: 0 }) }));
    const vertices = [{ id: "v0", x: 7, y: 2 }, { id: "v1", x: -7, y: -2 }, { id: "v2", x: -6, y: 1.5 }];
    for (const vertex of vertices) {
      registry.add(createGeodesicVertexObject({ id: vertex.id, cellId: "torus-room", point: { x: vertex.x, y: vertex.y, z: beamZ } }));
    }
    const arcs = [
      { id: "g0", from: "e1", to: "v0", word: [] },
      { id: "g1", from: "v0", to: "v1", word: [seam] },
      { id: "g2", from: "v1", to: "v2", word: [] },
      { id: "g3", from: "v2", to: "e2", word: [] },
    ];
    for (const arc of arcs) {
      registry.add(createGeodesicArcObject({
        id: arc.id,
        startAnchorObjectId: arc.from,
        endAnchorObjectId: arc.to,
        startCellId: "torus-room",
        portalWord: arc.word,
        motionState: "moving",
      }));
      expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: arc.id })).toBeTruthy();
    }
    registry.add(createCurveShorteningPairObject({ id: "pair", vertexIds: ["v0", "v1", "v2"], cellId: "torus-room" }));
    let previousLength = totalCurveLength(registry);
    let previousVertices = 3;
    let ticks = 0;

    while (registry.get("pair") && ticks < 20000) {
      advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz });
      ticks += 1;
      const length = totalCurveLength(registry);
      const count = registry.getObjectsOfKind("geodesicModel/vertex").length;
      expect(length).toBeLessThanOrEqual(previousLength + 1e-9);
      expect(count).toBeLessThanOrEqual(previousVertices);
      previousLength = length;
      previousVertices = count;
    }

    expect(registry.get("pair")).toBeUndefined();
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(1);
    expect(registry.getObjectsOfKind("geodesicModel/arc")[0]).toMatchObject({
      motionState: "stable",
      start: { anchorObjectId: "e1" },
      end: { anchorObjectId: "e2" },
      portalWord: [seam],
    });
    expect(previousLength).toBeCloseTo(4, 1);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
  });
});

describe("curve shortening flow that would need a wrap vertex", () => {
  it("is left unresolved, without inserting a vertex, when a forbidden-zone disk is in the way", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicCannonObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 0.1, z: 0 }) }));
    registry.add(createGeodesicCannonObject({ id: "e2", cellId: "b", localPose: yawRigidTransform3(0, { x: 2, y: 0.1, z: 0 }) }));
    registry.add(createGeodesicVertexObject({ id: "F", cellId: "a", point: { x: 4.5, y: 2.5, z: beamZ } }));
    registry.add(createGeodesicArcObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "F", startCellId: "a", motionState: "moving" }));
    registry.add(createGeodesicArcObject({
      id: "g2",
      startAnchorObjectId: "F",
      endAnchorObjectId: "e2",
      startCellId: "a",
      portalWord: [createCarryPortalTraversal(world, "a", "ab")],
      motionState: "moving",
    }));
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" })).toBeTruthy();
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g2" })).toBeTruthy();
    registry.add(createCurveShorteningPairObject({ id: "pair", vertexIds: ["F"], cellId: "a" }));
    const notices: CurveShorteningNotice[] = [];
    let previousLength = totalCurveLength(registry);

    for (let tick = 0; tick < 3000 && registry.get("pair")?.kind === "curve-shortening-pair" && (registry.get("pair") as { state: string }).state === "moving"; tick += 1) {
      advanceCurveShorteningPairs({ world, registry, deltaSeconds: frame60Hz, onNotice: (notice) => notices.push(notice) });
      const length = totalCurveLength(registry);
      expect(length).toBeLessThanOrEqual(previousLength + 1e-9);
      expect(registry.getObjectsOfKind("geodesicModel/vertex").length).toBeLessThanOrEqual(1);
      previousLength = length;
    }

    expect(registry.get("pair")).toMatchObject({ state: "unresolved" });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "unresolved" });
    expect(registry.getObjectsOfKind("geodesicModel/arc").every((interval) => interval.motionState === "moving")).toBe(true);
  });
});