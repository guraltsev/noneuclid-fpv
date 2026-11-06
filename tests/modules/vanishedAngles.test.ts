/**
 * `tests/modules/vanishedAngles.test.ts` — unit tier.
 *
 * An angle whose crossing vanishes (design 013 section 17, item 6), through the engine with the write guard on: it is hidden, it comes back with the crossing, and it is deleted 3 s of world time after the aiming stops.
 * "The aiming stops" is the end of the last edit or carry of either geodesic's emitter; with none, the 3 s run from the moment the crossing vanished. Frames are `runFrame`: what follows a participant moves in `applyControls`.
 * What a load keeps is what the kinds declare `saved`: `reload` copies those records into a new registry and a new engine, and the rest comes back from them.
 */
import { describe, expect, it } from "vitest";
import type { CommandResult, EngineCommandBase, WorldEngine } from "../../src/engine/moduleTypes";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { carryOffsetSlot } from "../../src/modules/carry/api";
import { geodesicEmitterYawSlot, type GeodesicEmittersResult } from "../../src/modules/geodesicEmitters/api";
import { curveShorteningModule } from "../../src/modules/curveShortening";
import { geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { createSimulationClock } from "../../src/engine/worldEngine";
import { createDefaultWorldModules, defaultSimulationClockOptions } from "../../src/runtime/experience";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { rebuildDerivedGeodesicSegments } from "../../src/world-objects/geodesic/intervals";
import { shootGeodesic } from "../../src/world-objects/geodesic/cannon";
import { createGeodesicEmitterObject, geodesicRayBeamHeightMeters as beam } from "../../src/world-objects/geodesic/objects";
import {
  createProtractorAngleObject,
  refreshProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorSideAt,
  vanishedAngleSeconds,
} from "../../src/world-objects/protractorTool";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import type { ProtractorAngleObject } from "../../src/world-objects/toolObjects";
import { compileLargePortalWorld, createSegment, createSymmetricPairScenario } from "../fixtures/world-objects/geodesic";
import { createTestEngine, runClockFrame, runDerivePass, runFrame } from "../support/engine";

const dt = 1 / 60;
const angleId = "angle";

type World = ReturnType<typeof compileLargePortalWorld>;

function angleIn(registry: RuntimeObjectRegistry): ProtractorAngleObject | undefined {
  const object = registry.get(angleId);
  return object?.kind === "geodesicMeasurements/angle" ? object : undefined;
}

/** The angle at the one crossing of the registry, between the segments of `firstArc` and `secondArc` that pass through it. */
function addCrossingAngle(registry: RuntimeObjectRegistry, firstArc: string, secondArc: string): void {
  const crossing = registry.getObjectsOfKind("geodesicModel/crossing")[0];
  if (crossing === undefined) throw new Error("no crossing");
  const center = resolveProtractorCenterSelection(registry, crossing);
  const sideOf = (arcId: string) => {
    const id = crossing.segmentIds.find((segmentId) => registry.get(segmentId)?.kind === "geodesicModel/segment" && (registry.get(segmentId) as { geodesicId: string }).geodesicId === arcId);
    const side = resolveProtractorSideAt(registry, center, { objectId: id, point: { x: center.point.x + 0.1, y: center.point.y + 0.1, z: center.point.z } });
    if (side === undefined) throw new Error(`no side on ${arcId}`);
    return side;
  };
  registry.add(createProtractorAngleObject({ id: angleId, center, first: sideOf(firstArc), second: sideOf(secondArc) }));
}

function drive(engine: WorldEngine, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
    runFrame(engine, dt);
    engine.endFrame();
  }
}

/** Room a: emitter A at (1, 2.5) shoots east, emitter B at (3, 1) shoots north; they cross at (3, 2.5), with an angle there. Facing east, B's geodesic crosses nothing. */
function aimingScene() {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  const engine = createTestEngine({ registry, getWorld: () => world, modules: createDefaultWorldModules(), playerPose: { ...createDefaultPlayerPose("a"), position: { x: 1, y: 1, z: 0 } } });

  function run(command: EngineCommandBase): CommandResult {
    const ticket = engine.submit("local", command);
    runFrame(engine, dt);
    const result = engine.resultOf(ticket) as CommandResult;
    engine.endFrame();
    return result;
  }
  function placeAndShoot(x: number, y: number, yawRadians: number, lengthMeters: number) {
    const placed = run({ kind: "geodesicEmitters/place", cellId: "a", point: { x, y, z: 0 }, yawRadians } as EngineCommandBase);
    if (!placed.ok) throw new Error(placed.refusal.code);
    const { emitterId } = placed.value as GeodesicEmittersResult;
    const shot = run({ kind: "geodesicEmitters/shoot", emitterId, yawRadians, lengthMeters } as EngineCommandBase);
    if (!shot.ok) throw new Error(shot.refusal.code);
    return { emitterId, arcId: (shot.value as { readonly arcId: string }).arcId };
  }
  const a = placeAndShoot(1, 2.5, 0, 3);
  const b = placeAndShoot(3, 1, Math.PI / 2, 3);
  addCrossingAngle(registry, a.arcId, b.arcId);
  runFrame(engine, dt);
  engine.endFrame();

  /** Holds the edit of B and turns it to `yawRadians`, frame by frame. */
  function aimB(yawRadians: number): void {
    engine.setControl("local", geodesicEmitterYawSlot, yawRadians);
    runFrame(engine, dt);
    engine.endFrame();
  }
  const beginEdit = () => expect(run({ kind: "geodesicEmitters/beginEdit", emitterId: b.emitterId, arcId: b.arcId } as EngineCommandBase)).toEqual({ ok: true });
  const endEdit = () => expect(run({ kind: "geodesicEmitters/endEdit" } as EngineCommandBase)).toEqual({ ok: true });
  /** The whole edit that takes B's geodesic off the crossing and ends. */
  function aimAway(): void {
    beginEdit();
    aimB(0);
    endEdit();
  }
  return { world, registry, engine, run, a, b, aimB, beginEdit, endEdit, aimAway };
}

describe("an angle whose crossing is aimed away", () => {
  it("is hidden, keeps what it showed, and stands still for as long as the aiming goes on", () => {
    const { registry, engine, aimB, beginEdit } = aimingScene();
    const before = angleIn(registry)!;

    beginEdit();
    aimB(0);

    expect(registry.getObjectsOfKind("geodesicModel/crossing")).toHaveLength(0);
    expect(angleIn(registry)).toMatchObject({ portalRenderable: false, vanishedSecondsLeft: vanishedAngleSeconds, angleDegrees: before.angleDegrees });
    const version = registry.getVersion();
    drive(engine, 5);
    expect(angleIn(registry)?.vanishedSecondsLeft).toBe(vanishedAngleSeconds);
    expect(registry.getVersion()).toBe(version);
  });

  it("comes back with the crossing while the aiming goes on", () => {
    const { registry, engine, aimB, beginEdit } = aimingScene();
    const before = angleIn(registry)!;
    beginEdit();
    aimB(0);
    drive(engine, 5);

    aimB(Math.PI / 2 - 0.2);

    const angle = angleIn(registry)!;
    expect(angle.portalRenderable).toBe(true);
    expect(angle.vanishedSecondsLeft).toBeUndefined();
    expect(angle.angleDegrees).toBeCloseTo(before.angleDegrees - (0.2 * 180) / Math.PI, 6);
    expect(angle.centerObjectId).toBe(registry.getObjectsOfKind("geodesicModel/crossing")[0]!.id);
  });

  it("comes back on the other half of an arc, keeping its geodesics and directions", () => {
    const { registry, aimB, beginEdit, a } = aimingScene();
    const before = angleIn(registry)!;
    expect(before.first).toMatchObject({ geodesicId: a.arcId, endRole: "end", directionSign: 1 });
    beginEdit();
    aimB(0);

    // From (3, 1) this runs back to (2, 2.5), on the half of A that starts at its emitter.
    aimB(Math.atan2(1.5, -1));

    const crossing = registry.getObjectsOfKind("geodesicModel/crossing")[0]!;
    expect(crossing.aimStickyTarget?.localPoint).toMatchObject({ x: 2, y: 2.5 });
    const angle = angleIn(registry)!;
    expect(angle).toMatchObject({ portalRenderable: true, centerObjectId: crossing.id });
    expect(angle.vanishedSecondsLeft).toBeUndefined();
    expect(angle.first).toMatchObject({ geodesicId: a.arcId, endRole: "start", directionSign: 1, yawRadians: 0 });
    expect(angle.second.geodesicId).toBe(before.second.geodesicId);
    expect(angle.second.directionSign).toBe(before.second.directionSign);
  });

  it("is given up when two sides told apart by their halves alone come back as one", () => {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry([
      createSegment({ id: "g-a:segment:0", geodesicId: "g-a", halfRole: "start", start: { x: 1, y: 2.5, z: beam }, direction: { x: 1, y: 0, z: 0 }, lengthMeters: 3 }),
      createSegment({ id: "g-b:segment:0", geodesicId: "g-b", start: { x: 3, y: 1, z: beam }, direction: { x: 0, y: 1, z: 0 }, lengthMeters: 3 }),
    ]);
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule(), geodesicMeasurementsModule()] });
    runDerivePass(engine);
    const crossing = registry.getObjectsOfKind("geodesicModel/crossing")[0]!;
    const center = resolveProtractorCenterSelection(registry, crossing);
    const side = { geodesicId: "g-a", segmentId: "g-a:segment:0", yawRadians: 0, directionSign: 1 } as const;
    const angle = createProtractorAngleObject({ id: angleId, center, first: { ...side, endRole: "start" }, second: { ...side, endRole: "end", yawRadians: Math.PI, directionSign: -1 } });

    expect(refreshProtractorAngleObject({ registry, angle: { ...angle, vanishedSecondsLeft: 1 } })).toBeUndefined();
  });

  it("comes back when the crossing returns within 3 s of the end of the edit", () => {
    const { registry, engine, aimB, beginEdit, endEdit, aimAway } = aimingScene();
    aimAway();
    drive(engine, vanishedAngleSeconds - 0.5);
    expect(angleIn(registry)?.portalRenderable).toBe(false);

    beginEdit();
    aimB(Math.PI / 2);
    endEdit();

    expect(angleIn(registry)).toMatchObject({ portalRenderable: true });
    expect(angleIn(registry)?.vanishedSecondsLeft).toBeUndefined();
    drive(engine, vanishedAngleSeconds + 1);
    expect(angleIn(registry)?.portalRenderable).toBe(true);
  });

  it("is deleted 3 s of world time after the edit ended, and not before", () => {
    const { registry, engine, aimAway } = aimingScene();
    aimAway();

    drive(engine, vanishedAngleSeconds - 0.1);
    expect(angleIn(registry)?.portalRenderable).toBe(false);
    drive(engine, 0.2);
    expect(angleIn(registry)).toBeUndefined();
  });

  it("starts the 3 s again when an edit begins during them", () => {
    const { registry, engine, aimB, beginEdit, endEdit, aimAway } = aimingScene();
    aimAway();
    drive(engine, 2);

    beginEdit();
    aimB(0.1);
    expect(angleIn(registry)?.vanishedSecondsLeft).toBe(vanishedAngleSeconds);
    drive(engine, 4);
    endEdit();

    drive(engine, vanishedAngleSeconds - 0.1);
    expect(angleIn(registry)?.portalRenderable).toBe(false);
    drive(engine, 0.2);
    expect(angleIn(registry)).toBeUndefined();
  });

  it("spends world time through frames of none, one and several ticks", () => {
    const { registry, engine, aimAway } = aimingScene();
    aimAway();
    const clock = createSimulationClock(defaultSimulationClockOptions);
    const tickCounts = new Set<number>();
    let worldSeconds = 0;
    let lastTick = 0;

    for (let frame = 0; angleIn(registry) !== undefined && frame < 5000; frame += 1) {
      const advance = runClockFrame(engine, clock, frame % 7 === 0 ? 1 / 30 : 1 / 240);
      tickCounts.add(Math.min(advance.ticks, 2));
      worldSeconds += advance.ticks * advance.tickSeconds;
      if (advance.ticks > 0) lastTick = advance.tickSeconds;
    }

    expect([...tickCounts].sort()).toEqual([0, 1, 2]);
    expect(angleIn(registry)).toBeUndefined();
    expect(worldSeconds).toBeGreaterThanOrEqual(vanishedAngleSeconds - dt);
    expect(worldSeconds).toBeLessThan(vanishedAngleSeconds + 3 * lastTick);
  });

  it("does not wait in a frame with no tick", () => {
    const { registry, engine, aimAway } = aimingScene();
    aimAway();
    const left = angleIn(registry)!.vanishedSecondsLeft;

    for (let frame = 0; frame < 600; frame += 1) {
      engine.applyControls(dt);
      engine.endFrame();
    }

    expect(angleIn(registry)?.vanishedSecondsLeft).toBe(left);
  });

  it("counts world time, not steps: one long tick spends what many short ones do", () => {
    const { registry, engine, aimAway } = aimingScene();
    aimAway();
    const left = angleIn(registry)!.vanishedSecondsLeft!;

    engine.step(1);
    engine.endFrame();

    expect(angleIn(registry)?.vanishedSecondsLeft).toBeCloseTo(left - 1, 9);
  });

  it("is deleted at the next tick when a side's geodesic is deleted: its crossing cannot return", () => {
    const { registry, run, a, aimAway } = aimingScene();
    aimAway();

    expect(run({ kind: "geodesicEmitters/deleteGeodesic", emitterId: a.emitterId, arcId: a.arcId } as EngineCommandBase)).toMatchObject({ ok: true });

    expect(angleIn(registry)).toBeUndefined();
  });

  it("can be removed while it waits, and then nothing goes on counting", () => {
    const { registry, engine, run, aimAway } = aimingScene();
    aimAway();

    expect(run({ kind: "geodesicMeasurements/removeAngle", angleId } as EngineCommandBase)).toMatchObject({ ok: true });
    const version = registry.getVersion();
    drive(engine, 1);

    expect(angleIn(registry)).toBeUndefined();
    expect(registry.getVersion()).toBe(version);
  });
});

describe("an angle whose crossing is carried away", () => {
  /** P at (1, 2.5) connected to Q at (4, 2.5); F at (3.2, 1) shoots 1.8 m north, crossing the connection at (3.2, 2.5), in the half of it that ends at Q. Q carried north tilts the connection past F's end. */
  function carryScene() {
    const world = compileLargePortalWorld();
    const registry = createRuntimeObjectRegistry();
    for (const [id, x, y] of [["P", 1, 2.5], ["Q", 4, 2.5], ["F", 3.2, 1]] as const) {
      registry.add(createGeodesicEmitterObject({ id, cellId: "a", localPose: yawRigidTransform3(0, { x, y, z: 0 }) }));
    }
    const p = registry.get("P");
    if (p?.kind !== "geodesicEmitters/emitter") throw new Error("no P");
    shootGeodesic({ world, registry, cannon: p, geodesicId: "g-pq", maxLengthMeters: 3 });
    const f = registry.get("F");
    if (f?.kind !== "geodesicEmitters/emitter") throw new Error("no F");
    const north = { ...f, aimYawRadians: Math.PI / 2, localPose: yawRigidTransform3(Math.PI / 2, f.localPose.translation) };
    registry.update(north);
    shootGeodesic({ world, registry, cannon: north, geodesicId: "g-f", maxLengthMeters: 1.8 });
    const engine = createTestEngine({ registry, getWorld: () => world, modules: createDefaultWorldModules(), playerPose: { ...createDefaultPlayerPose("a"), position: { x: 4, y: 3, z: 0 } } });
    runDerivePass(engine);
    addCrossingAngle(registry, "g-pq", "g-f");
    runDerivePass(engine);
    engine.endFrame();
    return { registry, engine };
  }

  function submit(engine: WorldEngine, command: EngineCommandBase): CommandResult {
    const ticket = engine.submit("local", command);
    runFrame(engine, dt);
    const result = engine.resultOf(ticket) as CommandResult;
    engine.endFrame();
    return result;
  }

  it("waits for as long as the carry goes on, and 3 s more", () => {
    const { registry, engine } = carryScene();
    expect(submit(engine, { kind: "carry/attach", objectId: "Q" } as EngineCommandBase)).toEqual({ ok: true });

    for (let frame = 0; frame < 120; frame += 1) {
      engine.setControl("local", carryOffsetSlot, { x: 4, y: 4.5, leashMeters: 5 });
      runFrame(engine, dt);
      engine.endFrame();
    }
    expect(registry.getObjectsOfKind("geodesicModel/crossing")).toHaveLength(0);
    expect(angleIn(registry)).toMatchObject({ portalRenderable: false, vanishedSecondsLeft: vanishedAngleSeconds });

    expect(submit(engine, { kind: "carry/detach" } as EngineCommandBase)).toEqual({ ok: true });
    drive(engine, vanishedAngleSeconds - 0.1);
    expect(angleIn(registry)?.portalRenderable).toBe(false);
    drive(engine, 0.2);
    expect(angleIn(registry)).toBeUndefined();
  });
});

describe("a crossing lost to the flow", () => {
  /** The tied curve (-2, 0), (0, 2), (2, 0) and an emitter at (-0.8, 0.9) shooting 0.8 m north, through the arc g1, which survives when the curve goes taut: the curve flows down off that geodesic. */
  function flowScene() {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    registry.add(createGeodesicEmitterObject({ id: "F", cellId: "a", localPose: yawRigidTransform3(Math.PI / 2, { x: -0.8, y: 0.9, z: 0 }), aimYawRadians: Math.PI / 2 }));
    const f = registry.get("F");
    if (f?.kind !== "geodesicEmitters/emitter") throw new Error("no F");
    shootGeodesic({ world, registry, cannon: f, geodesicId: "g-f", maxLengthMeters: 0.8 });
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule(), geodesicMeasurementsModule(), curveShorteningModule({})] });
    runDerivePass(engine);
    addCrossingAngle(registry, "g1", "g-f");
    runDerivePass(engine);
    engine.endFrame();
    return { registry, engine };
  }

  it("runs the 3 s from the moment it vanished, with no edit", () => {
    const { registry, engine } = flowScene();
    let ticks = 0;
    while (angleIn(registry)?.vanishedSecondsLeft === undefined && ticks < 3000) {
      runFrame(engine, dt);
      engine.endFrame();
      ticks += 1;
    }
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(3000);
    expect(angleIn(registry)).toMatchObject({ portalRenderable: false, vanishedSecondsLeft: vanishedAngleSeconds });

    drive(engine, vanishedAngleSeconds - 0.1);
    expect(angleIn(registry)?.portalRenderable).toBe(false);
    drive(engine, 0.2);
    expect(angleIn(registry)).toBeUndefined();
  });
});

describe("an emitter at the far end of a tied curve", () => {
  it("counts as the geodesic's emitter: a carry of it holds the 3 s", () => {
    const { world, registry } = createSymmetricPairScenario(2, 2);
    registry.add(createGeodesicEmitterObject({ id: "F", cellId: "a", localPose: yawRigidTransform3(Math.PI / 2, { x: -0.8, y: 0.9, z: 0 }), aimYawRadians: Math.PI / 2 }));
    const f = registry.get("F");
    if (f?.kind !== "geodesicEmitters/emitter") throw new Error("no F");
    shootGeodesic({ world, registry, cannon: f, geodesicId: "g-f", maxLengthMeters: 0.8 });
    const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule(), geodesicMeasurementsModule()], carrying: "e2" });
    runDerivePass(engine);
    addCrossingAngle(registry, "g1", "g-f");
    runDerivePass(engine);
    engine.endFrame();

    registry.update({ ...registry.get("free")!, localPose: yawRigidTransform3(0, { x: 0, y: 1, z: 1 }) } as never);
    rebuildDerivedGeodesicSegments({ world, registry, geodesicId: "g1" });
    drive(engine, 1);

    expect(angleIn(registry)).toMatchObject({ portalRenderable: false, vanishedSecondsLeft: vanishedAngleSeconds });
  });
});

describe("an angle after a load", () => {
  /** What a save keeps: the `saved` records. Segments and crossings are rebuilt; no memo of the old engine or registry survives. */
  function reload(world: World, from: RuntimeObjectRegistry) {
    const saved = new Set(createDefaultWorldModules().flatMap((module) => module.objectKinds).filter((kind) => kind.persistence === "saved").map((kind) => kind.kind));
    const registry = createRuntimeObjectRegistry(structuredClone(from.getAll().filter((object) => saved.has(object.kind))));
    for (const arc of registry.getObjectsOfKind("geodesicModel/arc")) rebuildDerivedGeodesicSegments({ world, registry, geodesicId: arc.id });
    const engine = createTestEngine({ registry, getWorld: () => world, modules: createDefaultWorldModules(), playerPose: { ...createDefaultPlayerPose("a"), position: { x: 1, y: 1, z: 0 } } });
    return { registry, engine };
  }

  it("is still hidden and deleted on time: what was left of the 3 s comes from the record", () => {
    const { world, registry, engine, aimAway } = aimingScene();
    aimAway();
    drive(engine, 1);
    const left = angleIn(registry)!.vanishedSecondsLeft!;

    const loaded = reload(world, registry);
    runFrame(loaded.engine, dt);

    expect(angleIn(loaded.registry)).toMatchObject({ portalRenderable: false });
    expect(angleIn(loaded.registry)?.vanishedSecondsLeft).toBeLessThanOrEqual(left);
    expect(angleIn(loaded.registry)?.vanishedSecondsLeft).toBeGreaterThan(left - 3 * dt);
    drive(loaded.engine, left - 0.1);
    expect(angleIn(loaded.registry)?.portalRenderable).toBe(false);
    drive(loaded.engine, 0.2);
    expect(angleIn(loaded.registry)).toBeUndefined();
  });

  it("comes back with a crossing that returns under another id", () => {
    const { world, registry, engine, b, aimAway } = aimingScene();
    aimAway();
    drive(engine, 1);
    const loaded = reload(world, registry);
    runFrame(loaded.engine, dt);

    const begin = loaded.engine.submit("local", { kind: "geodesicEmitters/beginEdit", emitterId: b.emitterId, arcId: b.arcId } as EngineCommandBase);
    runFrame(loaded.engine, dt);
    expect(loaded.engine.resultOf(begin)).toEqual({ ok: true });
    loaded.engine.setControl("local", geodesicEmitterYawSlot, Math.PI / 2);
    runFrame(loaded.engine, dt);

    const crossing = loaded.registry.getObjectsOfKind("geodesicModel/crossing")[0]!;
    expect(angleIn(loaded.registry)).toMatchObject({ portalRenderable: true, centerObjectId: crossing.id });
    expect(angleIn(loaded.registry)?.vanishedSecondsLeft).toBeUndefined();
  });

  it("keeps its crossing when the id the record names is not the rebuilt marker's", () => {
    const { world, registry, b, aimB, beginEdit, endEdit } = aimingScene();
    // The crossing moved, so its id still says where it was born, which a rebuilt marker does not.
    beginEdit();
    aimB(Math.PI / 2 - 0.2);
    endEdit();
    const before = angleIn(registry)!;
    expect(b.arcId).toBeDefined();

    const loaded = reload(world, registry);
    runFrame(loaded.engine, dt);

    const crossing = loaded.registry.getObjectsOfKind("geodesicModel/crossing")[0]!;
    expect(crossing.id).not.toBe(before.centerObjectId);
    expect(angleIn(loaded.registry)).toMatchObject({ portalRenderable: true, centerObjectId: crossing.id });
    expect(angleIn(loaded.registry)?.angleDegrees).toBeCloseTo(before.angleDegrees, 9);
  });

  it("has its values refreshed from the world, not from the file", () => {
    const { world, registry } = aimingScene();
    const stored = angleIn(registry)!;
    registry.update({ ...stored, angleDegrees: stored.angleDegrees + 1 });

    const loaded = reload(world, registry);
    runFrame(loaded.engine, dt);

    expect(angleIn(loaded.registry)?.angleDegrees).toBeCloseTo(stored.angleDegrees, 6);
  });
});
