/**
 * `tests/modules/curveShortening/curveShortening.test.ts` - unit tier.
 *
 * The curve shortening module (design 013 section 13.2) driven through the world engine with the module write guard on. Curve shortening is a flow: tying two connected endpoints at a shared vertex makes a piecewise-geodesic curve whose
 * tied vertices relax over many steps (each moves along the descent direction of the total length by an exact line search, the neighbouring arcs are re-realized as geodesic chords of their portal words, and a vertex whose turning angle is
 * below the tolerance is merged away). A curve has no lifecycle: the flow is at rest when every tied vertex is quiet. These tests check: tying through the command; one small step moving a vertex a bounded distance; the flow of a two-arc curve,
 * a curve of six arcs with five tied vertices, a torus loop pair and free loops reaching the known taut geometry within a tolerance; the total length never growing and the number of vertices never growing at any step; the same limit at 60 Hz
 * and 240 Hz; a loop around a cone point shrinking until it is deleted with a notice; and a curve that would need a wrap vertex at a forbidden-zone disk being destroyed with a notice. The flow on its own, against a scripted model, is in `flow.test.ts`.
 */
import { createFixtureArc as createGeodesicArcObject } from "../../support/arcs";
import { describe, expect, it } from "vitest";
import type { CommandResult, EngineEventBase } from "../../../src/engine/moduleTypes";
import { curveDynamicsToken, type CurveShorteningEvent } from "../../../src/modules/curveShortening/api";
import { curveShorteningSpeedMetersPerSecond } from "../../../src/modules/curveShortening/policies";
import { carryOffsetSlot, type CarryAttachCommand, type CarryDetachCommand } from "../../../src/modules/carry/api";
import { carryModule } from "../../../src/modules/carry";
import { geodesicEmittersModule } from "../../../src/modules/geodesicEmitters";
import { curveShorteningModule } from "../../../src/modules/curveShortening";
import { createDefaultPlayerPose } from "../../../src/movement/playerPose";
import { geodesicModelToken, type GeodesicTieAndDetachCommand } from "../../../src/modules/geodesicModel/api";
import { geodesicModelModule } from "../../../src/modules/geodesicModel";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { derivedStatsOf } from "../../../src/world-objects/derived";
import { arcConnectsEmitters } from "../../../src/world-objects/geodesic/lifecycle";
import {
  createGeodesicVertexObject,
  createGeodesicEmitterObject,
  geodesicRayBeamHeightMeters,
  type GeodesicSegmentObject,
} from "../../../src/world-objects/geodesic/objects";
import { getGeodesicEndpointAttachmentsForAnchor, isTied } from "../../../src/world-objects/geodesic/endpoints";
import { getGeodesicSegments } from "../../../src/world-objects/geodesic/segments";
import { rebuildDerivedGeodesicSegments } from "../../../src/world-objects/geodesic/intervals";
import { rebuildConnectedGeodesicBetweenEmitters } from "../../../src/world-objects/geodesic/cannon";
import { geodesicMeasurementsModule } from "../../../src/modules/geodesicMeasurements";
import { createMeasuredGeodesicLengthObject } from "../../../src/world-objects/measureLengthTool";
import { yawRigidTransform3 } from "../../../src/math/rigidTransform3";
import { expectSegmentsAreRealizedFromArcs } from "../../support/segmentOracle";
import { createSimulationClock } from "../../../src/engine/simulationClock";
import { defaultSimulationClockOptions } from "../../../src/runtime/experience";
import { createTestEngine, runClockFrame, runFrame } from "../../support/engine";
import {
  compileLargeWorld,
  compileRotatedFreeLoopWorld,
  compileTorusLoopWorld,
  createCarryPortalTraversal,
  compileLargePortalWorld,
  createFlowTestEngine,
  createSymmetricPairScenario,
  createTorusConnectedPairScenario,
  createTorusTiedPairScenario,
  runCurveShorteningUntilAtRest,
  totalGeodesicLength,
} from "../../fixtures/world-objects/geodesic";

const beamZ = geodesicRayBeamHeightMeters;
const frame60Hz = 1 / 60;

type Registry = ReturnType<typeof createRuntimeObjectRegistry>;
type FlowEngine = ReturnType<typeof createFlowTestEngine>;

function maxSideViolation(world: ReturnType<typeof compileLargeWorld>, registry: Registry): number {
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

/** The vertex a successful tie reports. */
function vertexIdOf(result: CommandResult | undefined): string {
  if (result?.ok !== true) throw new Error("The tie was refused.");
  return (result.value as unknown as { vertexId: string }).vertexId;
}

/** One engine step of `seconds` and the end of the frame; the events of the step are appended to `events` when given. */
function stepFlow(engine: FlowEngine, seconds: number, events?: EngineEventBase[]): void {
  engine.step(seconds);
  if (events !== undefined) engine.forEachEvent((event) => events.push(event));
  engine.endFrame();
}

/** The events of the curve shortening module among `events`. */
function flowEvents(events: readonly EngineEventBase[]): CurveShorteningEvent[] {
  return events.filter((event): event is CurveShorteningEvent => event.kind.startsWith("curveShortening/"));
}

// Emitters e1 and e2 in the 6 m cell joined by a chain of arcs through the given tied vertices (a zigzag when the points alternate sides).
function createChainScenario(start: { x: number; y: number }, end: { x: number; y: number }, vertices: readonly { x: number; y: number }[]) {
  const world = compileLargeWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicEmitterObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { ...start, z: 0 }) }));
  registry.add(createGeodesicEmitterObject({ id: "e2", cellId: "a", localPose: yawRigidTransform3(0, { ...end, z: 0 }) }));
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
    }));
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: `g${index}` })).toBeTruthy();
  }
  return { world, registry };
}

function totalCurveLength(registry: Registry): number {
  return registry.getObjectsOfKind("geodesicModel/segment").reduce((total, segment) => total + segment.lengthMeters, 0);
}

describe("geodesic cannon world objects: tie and detach", () => {
  it("detaches the two endpoint roles of a same-emitter loop onto one tied vertex", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicEmitterObject({ id: "cannon-a", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 0, y: 0, z: 0 }) }));
    registry.add(createGeodesicArcObject({
      id: "g-loop",
      startAnchorObjectId: "cannon-a",
      endAnchorObjectId: "cannon-a",
      startCellId: "torus-room",
      portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
    }));
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-loop" });
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule()] });

    const tie: GeodesicTieAndDetachCommand = {
      kind: "geodesicModel/tieAndDetach",
      emitterId: "cannon-a",
      first: { geodesicId: "g-loop", role: "start", anchorObjectId: "cannon-a" },
      second: { geodesicId: "g-loop", role: "end", anchorObjectId: "cannon-a" },
    };
    const ticket = engine.submit("local", tie);
    engine.step(0);
    const result = engine.resultOf(ticket);

    expect(result).toMatchObject({ ok: true });
    const vertexId = vertexIdOf(result);
    expect(getGeodesicEndpointAttachmentsForAnchor(registry, vertexId)).toEqual([
      { geodesicId: "g-loop", role: "start", anchorObjectId: vertexId },
      { geodesicId: "g-loop", role: "end", anchorObjectId: vertexId },
    ]);
    expect(registry.get("g-loop")).toMatchObject({ kind: "geodesicModel/arc" });
    // A closed loop on one vertex is not tied, so it shows as open (design 013 section 13.1).
    expect(isTied(registry, "g-loop")).toBe(false);
    expect(getGeodesicSegments(registry, "g-loop").map((segment) => segment.connectionState)).toContain("open");
  });

  it("tying two connected arcs at one emitter makes two tied arcs and a vertex at the emitter", () => {
    const world = compileLargeWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicEmitterObject({ id: "left", cellId: "a", localPose: yawRigidTransform3(0, { x: -2, y: 0, z: 0 }) }));
    registry.add(createGeodesicEmitterObject({ id: "middle", cellId: "a", localPose: yawRigidTransform3(0, { x: 0, y: 1, z: 0 }) }));
    registry.add(createGeodesicEmitterObject({ id: "right", cellId: "a", localPose: yawRigidTransform3(0, { x: 2, y: 0, z: 0 }) }));
    registry.add(createGeodesicArcObject({ id: "g-lm", startAnchorObjectId: "left", endAnchorObjectId: "middle", startCellId: "a" }));
    registry.add(createGeodesicArcObject({ id: "g-mr", startAnchorObjectId: "middle", endAnchorObjectId: "right", startCellId: "a" }));
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-lm" });
    rebuildConnectedGeodesicBetweenEmitters({ world, registry, geodesicId: "g-mr" });
    expect(arcConnectsEmitters(registry, "g-lm")).toBe(true);
    expect(arcConnectsEmitters(registry, "g-mr")).toBe(true);
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule()] });

    const tie: GeodesicTieAndDetachCommand = {
      kind: "geodesicModel/tieAndDetach",
      emitterId: "middle",
      first: { geodesicId: "g-lm", role: "end", anchorObjectId: "middle" },
      second: { geodesicId: "g-mr", role: "start", anchorObjectId: "middle" },
    };
    const ticket = engine.submit("local", tie);
    engine.step(0);
    const result = engine.resultOf(ticket);

    expect(result).toMatchObject({ ok: true });
    const vertexId = vertexIdOf(result);
    expect(registry.get("g-lm")).toMatchObject({ end: { anchorObjectId: vertexId } });
    expect(registry.get("g-mr")).toMatchObject({ start: { anchorObjectId: vertexId } });
    expect(isTied(registry, "g-lm")).toBe(true);
    expect(isTied(registry, "g-mr")).toBe(true);
    expect(registry.get(vertexId)).toMatchObject({ kind: "geodesicModel/vertex", cellId: "a", localPose: { translation: { x: 0, y: 1 } } });
    expect(totalGeodesicLength(registry, "g-lm")).toBeCloseTo(Math.hypot(2, 1), 9);
  });

  it("flows the curve in the step that applied the tie", () => {
    const { world, registry } = createTorusConnectedPairScenario();
    const engine = createFlowTestEngine(world, registry);
    const lengthBefore = totalCurveLength(registry);

    const tie: GeodesicTieAndDetachCommand = {
      kind: "geodesicModel/tieAndDetach",
      emitterId: "e2",
      first: { geodesicId: "g1", role: "end", anchorObjectId: "e2" },
      second: { geodesicId: "g2", role: "start", anchorObjectId: "e2" },
    };
    const ticket = engine.submit("local", tie);
    engine.step(frame60Hz);

    expect(engine.resultOf(ticket)).toMatchObject({ ok: true });
    expect(totalCurveLength(registry)).toBeLessThan(lengthBefore);
  });
});

describe("curve shortening flow of a two-arc curve", () => {
  it("one small step moves the tied vertex a bounded distance and leaves the flow moving", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const engine = createFlowTestEngine(world, registry);
    const before = totalCurveLength(registry);
    const g1Before = getGeodesicSegments(registry, "g1");
    const g2Before = getGeodesicSegments(registry, "g2");

    stepFlow(engine, frame60Hz);

    expect(getGeodesicSegments(registry, "g1")).not.toEqual(g1Before);
    expect(getGeodesicSegments(registry, "g2")).not.toEqual(g2Before);
    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(false);
    expect(isTied(registry, "g1")).toBe(true);
    const free = registry.get("free");
    const moved = Math.hypot((free?.localPose.translation.x ?? 0) - 0, (free?.localPose.translation.y ?? 0) - 2);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(curveShorteningSpeedMetersPerSecond * frame60Hz + 1e-9);
    expect(totalCurveLength(registry)).toBeLessThan(before);
  });

  it("shortens over many steps and ends as the straight chord between the emitters", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const engine = createFlowTestEngine(world, registry);

    const ticks = runCurveShorteningUntilAtRest(engine, { geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });

    expect(ticks).toBeGreaterThan(20);
    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    expect(registry.get("free")).toBeUndefined();
    expect(registry.get("g2")).toBeUndefined();
    expect(registry.get("g1")).toMatchObject({ start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e2" } });
    expect(isTied(registry, "g1")).toBe(false);
    expect(arcConnectsEmitters(registry, "g1")).toBe(true);
    expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(4, 2);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
    expectSegmentsAreRealizedFromArcs(world, registry);
  });

  it("reaches the same limit at 60 Hz and 240 Hz", () => {
    const slow = createSymmetricPairScenario(2, 1.5);
    const fast = createSymmetricPairScenario(2, 1.5);

    runCurveShorteningUntilAtRest(createFlowTestEngine(slow.world, slow.registry), { geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });
    runCurveShorteningUntilAtRest(createFlowTestEngine(fast.world, fast.registry), { geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz / 4, maxTicks: 16000 });

    expect(totalGeodesicLength(slow.registry, "g1")).toBeCloseTo(totalGeodesicLength(fast.registry, "g1"), 2);
    expect(isTied(slow.registry, "g1")).toBe(false);
    expect(isTied(fast.registry, "g1")).toBe(false);
  });

  it("takes a step's duration as given: a long step moves a vertex as far as its speed allows", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const engine = createFlowTestEngine(world, registry);

    stepFlow(engine, 1);

    const free = registry.get("free");
    const moved = Math.hypot((free?.localPose.translation.x ?? 0) - 0, (free?.localPose.translation.y ?? 0) - 2);
    expect(moved).toBeGreaterThan(curveShorteningSpeedMetersPerSecond * 0.5);
    expect(moved).toBeLessThanOrEqual(curveShorteningSpeedMetersPerSecond + 1e-9);
  });

  it("reaches rest in the same simulated time through the clock at 5 Hz and at 120 Hz", () => {
    const simulatedSecondsToRest = (frameHertz: number): number => {
      const { world, registry } = createSymmetricPairScenario(2, 2);
      const engine = createFlowTestEngine(world, registry);
      const flow = engine.query(curveDynamicsToken);
      const clock = createSimulationClock(defaultSimulationClockOptions);
      let simulated = 0;
      for (let frame = 0; frame < 100000 && !flow.isAtRest(); frame += 1) {
        const { ticks, tickSeconds } = runClockFrame(engine, clock, 1 / frameHertz);
        simulated += ticks * tickSeconds;
      }
      expect(flow.isAtRest()).toBe(true);
      return simulated;
    };

    const slow = simulatedSecondsToRest(5);
    const fast = simulatedSecondsToRest(120);

    expect(Math.abs(slow - fast) / fast).toBeLessThan(0.05);
  });

  it("does nothing for a non-positive frame time", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const engine = createFlowTestEngine(world, registry);

    stepFlow(engine, 0);

    expect(registry.get("free")).toMatchObject({ localPose: { translation: { x: 0, y: 2 } } });
  });

  it("flows a curve tied across a portal to the straight geodesic of its class", () => {
    const { world, registry } = createTorusTiedPairScenario();
    const engine = createFlowTestEngine(world, registry);

    const ticks = runCurveShorteningUntilAtRest(engine, { geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });

    expect(ticks).toBeGreaterThan(1);
    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    expect(registry.get("free")).toBeUndefined();
    expect(registry.get("g2")).toBeUndefined();
    expect(registry.get("g1")).toMatchObject({
      start: { anchorObjectId: "e1" },
      end: { anchorObjectId: "e1" },
      portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
    });
    expect(arcConnectsEmitters(registry, "g1")).toBe(true);
    expect(totalGeodesicLength(registry, "g1")).toBeCloseTo(15, 2);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
    expectSegmentsAreRealizedFromArcs(world, registry);
  });

  it("leaves every emitter's pose and cell unchanged over many steps with no carry", () => {
    const { world, registry } = createTorusTiedPairScenario();
    const engine = createFlowTestEngine(world, registry);
    const emittersBefore = registry.getObjectsOfKind("geodesicEmitters/emitter");

    runCurveShorteningUntilAtRest(engine, { geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });

    for (const emitter of emittersBefore) {
      expect(registry.get(emitter.id)).toBe(emitter);
    }
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

  it("starts as six arcs through five tied vertices", () => {
    const { world, registry } = createChainScenario({ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, zigzag);
    const engine = createFlowTestEngine(world, registry);

    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(6);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(5);
    const tied: string[] = [];
    engine.query(geodesicModelToken).forEachTiedVertex((vertexId) => tied.push(vertexId));
    expect(tied).toEqual(["v0", "v1", "v2", "v3", "v4"]);
  });

  it("never lengthens, never gains a vertex, relaxes every vertex and ends on the straight chord", () => {
    const { world, registry } = createChainScenario({ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, zigzag);
    const engine = createFlowTestEngine(world, registry);
    const flow = engine.query(curveDynamicsToken);
    let previousLength = totalCurveLength(registry);
    let previousVertices = registry.getObjectsOfKind("geodesicModel/vertex").length;
    const initialLength = previousLength;
    let ticks = 0;

    while (!flow.isAtRest() && ticks < 20000) {
      stepFlow(engine, frame60Hz);
      ticks += 1;
      const length = totalCurveLength(registry);
      const vertices = registry.getObjectsOfKind("geodesicModel/vertex").length;
      expect(length).toBeLessThanOrEqual(previousLength + 1e-9);
      expect(vertices).toBeLessThanOrEqual(previousVertices);
      previousLength = length;
      previousVertices = vertices;
    }

    expect(flow.isAtRest()).toBe(true);
    expect(ticks).toBeGreaterThan(50);
    expect(initialLength).toBeGreaterThan(10);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(0);
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(1);
    expect(registry.getObjectsOfKind("geodesicModel/arc")[0]).toMatchObject({
      start: { anchorObjectId: "e1" },
      end: { anchorObjectId: "e2" },
    });
    expect(previousLength).toBeCloseTo(5, 1);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
    expectSegmentsAreRealizedFromArcs(world, registry);
  });

  it("keeps arcs moving until the last vertex is removed", () => {
    const { world, registry } = createChainScenario({ x: -2.5, y: 0 }, { x: 2.5, y: 0 }, zigzag);
    const engine = createFlowTestEngine(world, registry);

    for (let tick = 0; tick < 30; tick += 1) {
      stepFlow(engine, frame60Hz);
    }

    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(false);
    for (const interval of registry.getObjectsOfKind("geodesicModel/arc")) {
      expect(isTied(registry, interval.id)).toBe(true);
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
      portalWord: word,
    }));
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-loop" })).toBeTruthy();
    return registry;
  }

  it("makes a torus free loop a taut loop on its vertex, which goes quiet", () => {
    const world = compileTorusLoopWorld();
    const registry = createFreeLoop(world, "torus-room", { x: 1, y: 2.3 }, [createCarryPortalTraversal(world, "torus-room", "right-left")]);
    const engine = createFlowTestEngine(world, registry);

    runCurveShorteningUntilAtRest(engine, { geodesicIds: ["g-loop"], deltaSeconds: frame60Hz, maxTicks: 10 });

    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    expect(registry.get("g-loop")).toMatchObject({ start: { anchorObjectId: "free-loop" }, end: { anchorObjectId: "free-loop" } });
    expect(totalGeodesicLength(registry, "g-loop")).toBeCloseTo(15, 6);
  });

  it("shrinks a loop around a cone point until it is deleted with a notice", () => {
    const world = compileRotatedFreeLoopWorld();
    const registry = createFreeLoop(world, "a", { x: 4.9, y: 1 }, [
      createCarryPortalTraversal(world, "a", "ab"),
      createCarryPortalTraversal(world, "b", "b-bottom"),
      createCarryPortalTraversal(world, "b", "ba"),
    ]);
    const engine = createFlowTestEngine(world, registry);
    const events: EngineEventBase[] = [];
    let previousLength = totalCurveLength(registry);
    let ticks = 0;

    while (!engine.query(curveDynamicsToken).isAtRest() && ticks < 4000) {
      stepFlow(engine, frame60Hz, events);
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
    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    const notices = flowEvents(events);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: "curveShortening/freeLoopCollapsed",
      arcId: "g-loop",
      message: "The loop around a cone point shrank to a point and was removed.",
    });
  });
});

describe("curve shortening flow when a vertex cannot move", () => {
  it("collapses a curve whose emitters are closer than the minimum geodesic length", () => {
    const { world, registry } = createChainScenario({ x: 0, y: 0 }, { x: 0.1, y: 0 }, [{ x: 0.05, y: 1 }]);
    const engine = createFlowTestEngine(world, registry);
    const events: EngineEventBase[] = [];

    let ticks = 0;
    while (!engine.query(curveDynamicsToken).isAtRest() && ticks < 2000) {
      stepFlow(engine, frame60Hz, events);
      ticks += 1;
    }

    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(0);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(0);
    expect(flowEvents(events).some((event) => event.kind === "curveShortening/collapsed" || event.kind === "curveShortening/destroyed")).toBe(true);
  });
});

describe("a flow that collapses a measured curve", () => {
  it("leaves the measurements to their own ticks, with the write guard on", () => {
    const { world, registry } = createChainScenario({ x: 0, y: 0 }, { x: 0.1, y: 0 }, [{ x: 0.05, y: 1 }]);
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule(), geodesicMeasurementsModule(), curveShorteningModule()] });
    const length = createMeasuredGeodesicLengthObject({ id: "length", registry, geodesicId: "g0", playerCellId: "a", playerPoint: { x: 0, y: 0, z: 0 } });
    if (length === undefined) throw new Error("Expected the length.");
    registry.add(length);

    let ticks = 0;
    while (registry.getObjectsOfKind("geodesicModel/arc").length > 0 && ticks < 2000) {
      stepFlow(engine, frame60Hz);
      ticks += 1;
    }

    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(0);
    expect(registry.get("length")).toBeUndefined();
  });
});

describe("curve shortening flow across portals and around junction disks", () => {
  it("flows three vertices through the torus seam to the straight chord of its class", () => {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    const seam = createCarryPortalTraversal(world, "torus-room", "right-left");
    registry.add(createGeodesicEmitterObject({ id: "e1", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: 6, y: 0, z: 0 }) }));
    registry.add(createGeodesicEmitterObject({ id: "e2", cellId: "torus-room", localPose: yawRigidTransform3(0, { x: -5, y: 0, z: 0 }) }));
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
      }));
      expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: arc.id })).toBeTruthy();
    }
    const engine = createFlowTestEngine(world, registry);
    let previousLength = totalCurveLength(registry);
    let previousVertices = 3;
    let ticks = 0;

    while (!engine.query(curveDynamicsToken).isAtRest() && ticks < 20000) {
      stepFlow(engine, frame60Hz);
      ticks += 1;
      const length = totalCurveLength(registry);
      const count = registry.getObjectsOfKind("geodesicModel/vertex").length;
      expect(length).toBeLessThanOrEqual(previousLength + 1e-9);
      expect(count).toBeLessThanOrEqual(previousVertices);
      previousLength = length;
      previousVertices = count;
    }

    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(1);
    expect(registry.getObjectsOfKind("geodesicModel/arc")[0]).toMatchObject({
      start: { anchorObjectId: "e1" },
      end: { anchorObjectId: "e2" },
      portalWord: [seam],
    });
    expect(previousLength).toBeCloseTo(4, 1);
    expect(maxSideViolation(world, registry)).toBeLessThan(1e-6);
  });
});

describe("the arc index during a flow", () => {
  it("is computed a handful of times and read many times over a whole flow run", () => {
    const { world, registry } = createTorusTiedPairScenario();
    const engine = createFlowTestEngine(world, registry);

    runCurveShorteningUntilAtRest(engine, { geodesicIds: ["g1", "g2"], deltaSeconds: frame60Hz, maxTicks: 4000 });

    const stats = derivedStatsOf(registry).find((entry) => entry.id === "geodesicModel/arcIndex");
    expect(stats?.computes).toBeLessThanOrEqual(6);
    expect(stats?.reads).toBeGreaterThan(50);
  });
});

// F is a tied vertex of a curve from e1 in cell a to e2 in cell b, and a forbidden-zone disk is in the way of the merge: the flow cannot cut the corner without a wrap vertex.
function createWrapScenario() {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  registry.add(createGeodesicEmitterObject({ id: "e1", cellId: "a", localPose: yawRigidTransform3(0, { x: 4, y: 0.1, z: 0 }) }));
  registry.add(createGeodesicEmitterObject({ id: "e2", cellId: "b", localPose: yawRigidTransform3(0, { x: 2, y: 0.1, z: 0 }) }));
  registry.add(createGeodesicVertexObject({ id: "F", cellId: "a", point: { x: 4.5, y: 2.5, z: beamZ } }));
  registry.add(createGeodesicArcObject({ id: "g1", startAnchorObjectId: "e1", endAnchorObjectId: "F", startCellId: "a" }));
  registry.add(createGeodesicArcObject({
    id: "g2",
    startAnchorObjectId: "F",
    endAnchorObjectId: "e2",
    startCellId: "a",
    portalWord: [createCarryPortalTraversal(world, "a", "ab")],
  }));
  expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" })).toBeTruthy();
  expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g2" })).toBeTruthy();
  return { world, registry };
}

describe("curve shortening flow that would need a wrap vertex", () => {
  it("destroys the whole curve, inserting no vertex, when a forbidden-zone disk is in the way", () => {
    const { world, registry } = createWrapScenario();
    const engine = createFlowTestEngine(world, registry);
    const events: EngineEventBase[] = [];
    let previousLength = totalCurveLength(registry);

    for (let tick = 0; tick < 3000 && registry.getObjectsOfKind("geodesicModel/arc").length > 0; tick += 1) {
      stepFlow(engine, frame60Hz, events);
      const length = totalCurveLength(registry);
      expect(length).toBeLessThanOrEqual(previousLength + 1e-9);
      expect(registry.getObjectsOfKind("geodesicModel/vertex").length).toBeLessThanOrEqual(1);
      previousLength = length;
    }

    expect(registry.getObjectsOfKind("geodesicModel/arc")).toEqual([]);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toEqual([]);
    expect(registry.getObjectsOfKind("geodesicModel/segment")).toEqual([]);
    const notices = flowEvents(events);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "curveShortening/destroyed", vertexId: "F" });
    const { arcIds, reason } = notices[0] as { arcIds: readonly string[]; reason: string };
    expect([...arcIds].sort()).toEqual(["g1", "g2"]);
    expect(notices[0]!.message).toBe(`The tied geodesic could not shorten any further and was removed (${reason}).`);
    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
  });

  it("gives no second notice on the steps after the curve is destroyed", () => {
    const { world, registry } = createWrapScenario();
    const engine = createFlowTestEngine(world, registry);
    const events: EngineEventBase[] = [];
    for (let tick = 0; tick < 3000 && registry.getObjectsOfKind("geodesicModel/arc").length > 0; tick += 1) {
      stepFlow(engine, frame60Hz);
    }

    for (let tick = 0; tick < 50; tick += 1) {
      stepFlow(engine, frame60Hz, events);
    }

    expect(flowEvents(events)).toEqual([]);
  });

});

describe("curve shortening flow of a taut closed loop", () => {
  function tautLoopEngine() {
    const world = compileTorusLoopWorld();
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicVertexObject({ id: "free-loop", cellId: "torus-room", point: { x: 1, y: 2.3, z: beamZ } }));
    registry.add(createGeodesicArcObject({
      id: "g-loop",
      startAnchorObjectId: "free-loop",
      endAnchorObjectId: "free-loop",
      startCellId: "torus-room",
      portalWord: [createCarryPortalTraversal(world, "torus-room", "right-left")],
    }));
    expect(rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g-loop" })).toBeTruthy();
    const engine = createFlowTestEngine(world, registry);
    runCurveShorteningUntilAtRest(engine, { geodesicIds: ["g-loop"], deltaSeconds: frame60Hz, maxTicks: 10 });
    return { engine, registry };
  }

  it("is at rest and scans no kind over many steps", () => {
    const { engine, registry } = tautLoopEngine();
    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    const scansBefore = { ...registry.getKindScanCounts() };

    for (let step = 0; step < 100; step += 1) stepFlow(engine, frame60Hz);

    expect(registry.getKindScanCounts()).toEqual(scansBefore);
  });

  it("forgets the vertex when its arc is moved off it", () => {
    const { engine, registry } = tautLoopEngine();
    const flow = engine.query(curveDynamicsToken);
    const arc = registry.get("g-loop");
    if (arc?.kind !== "geodesicModel/arc") throw new Error("missing arc");

    // The new record no longer names the vertex; only the record before the write does. A vertex left in the memo would keep the flow from being at rest.
    registry.update({ ...arc, start: { ...arc.start, anchorObjectId: "elsewhere" }, end: { ...arc.end, anchorObjectId: "elsewhere" } });
    stepFlow(engine, 0);

    expect(flow.isAtRest()).toBe(true);
  });

  it("wakes when its arc is written, and goes quiet again", () => {
    const { engine, registry } = tautLoopEngine();
    const flow = engine.query(curveDynamicsToken);
    const arc = registry.get("g-loop");
    if (arc?.kind !== "geodesicModel/arc") throw new Error("missing arc");

    registry.update({ ...arc });
    stepFlow(engine, 0);
    expect(flow.isAtRest()).toBe(false);

    stepFlow(engine, frame60Hz);
    expect(flow.isAtRest()).toBe(true);
  });
});

describe("an experience without the flow", () => {
  it("keeps a tied curve as tied over many steps", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule()] });
    const arcsBefore = [registry.get("g1"), registry.get("g2")];
    const vertexBefore = registry.get("free");

    for (let step = 0; step < 300; step += 1) {
      engine.step(frame60Hz);
      engine.endFrame();
    }

    expect([registry.get("g1"), registry.get("g2")]).toEqual(arcsBefore);
    expect(registry.get("free")).toBe(vertexBefore);
    expect(isTied(registry, "g1")).toBe(true);
  });
});

describe("curve shortening flow while an emitter is carried", () => {
  it("moves the end node of the carried emitter, and the curve still merges", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    const engine = createTestEngine({
      registry,
      getWorld: () => world,
      modules: [geodesicModelModule(), geodesicEmittersModule(), carryModule(), curveShorteningModule()],
      playerPose: { ...createDefaultPlayerPose("a"), position: { x: -1.5, y: 0, z: 0 } },
    });
    const submit = (command: CarryAttachCommand | CarryDetachCommand) => {
      const ticket = engine.submit("local", command);
      engine.step(0);
      const result = engine.resultOf(ticket);
      engine.endFrame();
      return result;
    };

    expect(submit({ kind: "carry/attach", objectId: "e1" })).toEqual({ ok: true });
    engine.setControl("local", carryOffsetSlot, { x: -2.5, y: 1, leashMeters: 5 });
    for (let step = 0; step < 30; step += 1) {
      runFrame(engine, frame60Hz);
      engine.endFrame();
    }
    expect(registry.get("e1")?.localPose.translation.y).toBeGreaterThan(0.5);
    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(false);
    expect(submit({ kind: "carry/detach" })).toEqual({ ok: true });

    let ticks = 0;
    while (!engine.query(curveDynamicsToken).isAtRest() && ticks < 4000) {
      engine.step(frame60Hz);
      engine.endFrame();
      ticks += 1;
    }

    expect(engine.query(curveDynamicsToken).isAtRest()).toBe(true);
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toHaveLength(0);
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(1);
    expect(registry.getObjectsOfKind("geodesicModel/arc")[0]).toMatchObject({ start: { anchorObjectId: "e1" }, end: { anchorObjectId: "e2" } });
    const e1 = registry.get("e1")!.localPose.translation;
    const e2 = registry.get("e2")!.localPose.translation;
    expect(totalCurveLength(registry)).toBeCloseTo(Math.hypot(e2.x - e1.x, e2.y - e1.y), 2);
    expectSegmentsAreRealizedFromArcs(world, registry);
  });
});
