/**
 * `tests/modules/geodesicEmitters.contract.test.ts` — unit tier.
 *
 * The contract of the geodesic emitters module, through the engine with the write guard on: each command's success and each refusal; a refusal changes nothing (the registry version stays); results carry the new ids; every command needs the emitter tool.
 */
import { describe, expect, it } from "vitest";
import type { CommandResult, EngineCommandBase } from "../../src/engine/moduleTypes";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { geodesicEmittersModule } from "../../src/modules/geodesicEmitters";
import { geodesicEmitterToolId, geodesicEmittersRefusals, type GeodesicEmittersCommand } from "../../src/modules/geodesicEmitters/api";
import { geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { getEmitterGeodesicIds } from "../../src/world-objects/geodesic/endpoints";
import { createGeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";
import { getGeodesicSegments } from "../../src/world-objects/geodesic/segments";
import { createMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import {
  createProtractorAngleObject,
  resolveProtractorCenterSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../src/world-objects/protractorTool";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld, createTorusConnectedPairScenario, createTorusTiedPairScenario, totalGeodesicLength } from "../fixtures/world-objects/geodesic";
import { removeGeodesic } from "../../src/world-objects/geodesic/lifecycle";
import { refreshMeasuredGeodesicLengthObject } from "../../src/world-objects/measureLengthTool";
import { createTestEngine, runDerivePass } from "../support/engine";

const modules = () => [geodesicModelModule(), geodesicMeasurementsModule(), geodesicEmittersModule()];
const emitterKind = "geodesicEmitters/emitter";

function setup(registry: RuntimeObjectRegistry = createRuntimeObjectRegistry(), world: ReturnType<typeof compileLargePortalWorld> = compileLargePortalWorld(), isToolEnabled?: (toolId: string) => boolean) {
  const engine = createTestEngine({ registry, getWorld: () => world, modules: modules(), ...(isToolEnabled ? { isToolEnabled } : {}) });
  function run(command: GeodesicEmittersCommand): CommandResult {
    const ticket = engine.submit("local", command as EngineCommandBase);
    engine.step(0);
    const result = engine.resultOf(ticket) as CommandResult;
    engine.endFrame();
    return result;
  }
  function value<T>(command: GeodesicEmittersCommand): T {
    const result = run(command);
    if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
    return result.value as T;
  }
  /** The command is refused with the code and the registry version stays. */
  function expectRefused(command: GeodesicEmittersCommand, code: string): void {
    const version = registry.getVersion();
    expect(run(command)).toMatchObject({ ok: false, refusal: { code } });
    expect(registry.getVersion()).toBe(version);
  }
  return { engine, registry, world, run, value, expectRefused };
}

/** An emitter at (3, 2.5) of cell "a", with a geodesic of 3 m along +x. */
function withShotGeodesic() {
  const scene = setup();
  const { emitterId } = scene.value<{ emitterId: string }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 2.5, z: 0 }, yawRadians: 0 });
  const { arcId } = scene.value<{ arcId: string }>({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: 0, lengthMeters: 3 });
  return { ...scene, emitterId, arcId };
}

describe("a deleted geodesic's measurements", () => {
  it("go in the step that deletes it, by their own tick, with the write guard on", () => {
    const { engine, registry, run, arcId } = withShotGeodesic();
    const length = createMeasuredGeodesicLengthObject({ id: "length", registry, geodesicId: arcId, playerCellId: "a", playerPoint: { x: 3, y: 2.5, z: 0 } });
    if (length === undefined) throw new Error("Expected the length.");
    registry.add(length);
    const emitterId = (registry.get(arcId) as { readonly start: { readonly anchorObjectId: string } }).start.anchorObjectId;
    const ticket = engine.submit("local", { kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId } as EngineCommandBase);

    // A frame with no tick has not applied the command yet.
    engine.applyControls(1 / 60);
    expect(registry.get("length")).toBeDefined();
    engine.step(1 / 60);
    expect(engine.resultOf(ticket)).toMatchObject({ ok: true });
    expect(registry.get(arcId)).toBeUndefined();
    expect(registry.get("length")).toBeUndefined();
    expect(run({ kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId })).toMatchObject({ ok: false });
  });

  it("take an angle too: it stays through a frame with no tick and goes with the step", () => {
    const { engine, registry, arcId } = withShotGeodesic();
    const emitterId = (registry.get(arcId) as { readonly start: { readonly anchorObjectId: string } }).start.anchorObjectId;
    const shot = engine.submit("local", { kind: "geodesicEmitters/shoot", emitterId, yawRadians: 1.5, lengthMeters: 1.5 } as EngineCommandBase);
    engine.step(0);
    const secondArcId = (engine.resultOf(shot) as unknown as { readonly value: { readonly arcId: string } }).value.arcId;
    engine.endFrame();
    const emitter = registry.get(emitterId);
    if (emitter?.kind !== emitterKind) throw new Error("Expected the emitter.");
    const center = resolveProtractorCenterSelection(registry, emitter);
    const first = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, geodesicId: arcId });
    const second = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, geodesicId: secondArcId });
    if (!first || !second) throw new Error("Expected both sides.");
    registry.add(createProtractorAngleObject({ id: "angle", center, first, second }));
    runDerivePass(engine);
    expect(registry.get("angle")).toBeDefined();

    const ticket = engine.submit("local", { kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId: secondArcId } as EngineCommandBase);
    engine.applyControls(1 / 60);
    expect(registry.get("angle")).toBeDefined();
    engine.step(1 / 60);

    expect(engine.resultOf(ticket)).toMatchObject({ ok: true });
    expect(registry.get("angle")).toBeUndefined();
  });

  it("outlive an arc removed outside a tick until the next one, and nothing reads them wrongly", () => {
    const { registry, arcId, engine } = withShotGeodesic();
    const length = createMeasuredGeodesicLengthObject({ id: "length", registry, geodesicId: arcId, playerCellId: "a", playerPoint: { x: 3, y: 2.5, z: 0 } });
    if (length === undefined) throw new Error("Expected the length.");
    registry.add(length);

    removeGeodesic(registry, arcId);
    expect(registry.get("length")).toBeDefined();

    // A frame with no tick reads the record whose arc is gone: the refresher says it is gone, and nothing throws.
    engine.applyControls(1 / 60);
    expect(registry.get("length")).toBeDefined();
    expect(refreshMeasuredGeodesicLengthObject({ registry, measurement: length, playerCellId: "a", playerPoint: { x: 3, y: 2.5, z: 0 } })).toBeUndefined();

    runDerivePass(engine);
    expect(registry.get("length")).toBeUndefined();
  });
});

describe("geodesicEmitters/place", () => {
  it("puts an emitter on the floor, with no geodesic, and answers with its id", () => {
    const { registry, run } = setup();

    const result = run({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 2.5, z: 1 }, yawRadians: 0.5 });

    expect(result).toEqual({ ok: true, value: { outcome: "placed", emitterId: "geodesicEmitters/emitter:0", arcIds: [] } });
    const emitter = registry.get("geodesicEmitters/emitter:0");
    expect(emitter).toMatchObject({ kind: emitterKind, cellId: "a", aimYawRadians: 0.5 });
    expect(emitter?.localPose.translation).toEqual({ x: 3, y: 2.5, z: 0 });
  });

  it("is refused as blocked in an unknown cell, on an emitter and for a point that is no number", () => {
    const { expectRefused, value } = setup();
    value({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 2.5, z: 0 }, yawRadians: 0 });

    expectRefused({ kind: "geodesicEmitters/place", cellId: "nowhere", point: { x: 3, y: 2.5, z: 0 }, yawRadians: 0 }, geodesicEmittersRefusals.blocked);
    expectRefused({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3.05, y: 2.5, z: 0 }, yawRadians: 0 }, geodesicEmittersRefusals.blocked);
    expectRefused({ kind: "geodesicEmitters/place", cellId: "a", point: { x: Number.NaN, y: 2.5, z: 0 }, yawRadians: 0 }, geodesicEmittersRefusals.blocked);
  });

  it("cuts a free geodesic at a point of one of its segments; the cut arc comes first", () => {
    const { registry, value, arcId } = withShotGeodesic();
    const lengthBefore = totalGeodesicLength(registry, arcId);

    const placed = value<{ emitterId: string; arcIds: readonly string[] }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 4, y: 2.5, z: 1.2 }, yawRadians: 0 });

    expect(placed.arcIds).toHaveLength(2);
    expect(placed.arcIds[0]).toBe(arcId);
    expect(placed.arcIds[1]).toMatch(/^geodesicModel\/arc:\d+$/);
    expect(getEmitterGeodesicIds(registry, placed.emitterId)).toEqual(placed.arcIds);
    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(1, 6);
    expect(totalGeodesicLength(registry, arcId) + totalGeodesicLength(registry, placed.arcIds[1]!)).toBeCloseTo(lengthBefore, 6);
  });

  it("stays on the floor beside a geodesic, leaving the geodesic whole", () => {
    const { registry, value, arcId } = withShotGeodesic();

    const placed = value<{ arcIds: readonly string[] }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 4, y: 3.5, z: 0 }, yawRadians: 0 });

    expect(placed.arcIds).toEqual([]);
    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(3, 6);
  });

  it("spends no id on a refusal", () => {
    const { value, expectRefused } = setup();

    expectRefused({ kind: "geodesicEmitters/place", cellId: "nowhere", point: { x: 3, y: 2.5, z: 0 }, yawRadians: 0 }, geodesicEmittersRefusals.blocked);

    expect(value({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 2.5, z: 0 }, yawRadians: 0 })).toMatchObject({ emitterId: "geodesicEmitters/emitter:0" });
  });

  it("is refused as too short so near the start of a segment", () => {
    const { registry, expectRefused, arcId } = withShotGeodesic();
    const first = getGeodesicSegments(registry, arcId)[0]!;
    const point = { x: first.start.x + first.direction.x * 0.01, y: first.start.y + first.direction.y * 0.01, z: 0 };

    expectRefused({ kind: "geodesicEmitters/place", cellId: first.cellId, point, yawRadians: 0 }, geodesicEmittersRefusals.tooShort);
  });

  it("is refused as blocked on a geodesic that connects emitters", () => {
    const { world, registry } = createTorusConnectedPairScenario();
    const { expectRefused } = setup(registry, world);
    const segment = getGeodesicSegments(registry, "g1")[0]!;
    const along = segment.lengthMeters / 2;
    const point = { x: segment.start.x + segment.direction.x * along, y: segment.start.y + segment.direction.y * along, z: 0 };

    expectRefused({ kind: "geodesicEmitters/place", cellId: segment.cellId, point, yawRadians: 0 }, geodesicEmittersRefusals.blocked);
  });

  it("cuts both geodesics at their crossing and names new arcs in the model's family", () => {
    const { engine, registry, value } = setup();
    const a = value<{ emitterId: string }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 2, y: 2.5, z: 0 }, yawRadians: 0 });
    const b = value<{ emitterId: string }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 1.5, z: 0 }, yawRadians: 0 });
    value({ kind: "geodesicEmitters/shoot", emitterId: a.emitterId, yawRadians: 0, lengthMeters: 2.5 });
    value({ kind: "geodesicEmitters/shoot", emitterId: b.emitterId, yawRadians: Math.PI / 2, lengthMeters: 2.5 });
    runDerivePass(engine);
    const crossing = registry.getObjectsOfKind("geodesicModel/crossing")[0];
    if (crossing === undefined) throw new Error("the geodesics do not cross");
    const point = crossing.aimStickyTarget?.localPoint ?? crossing.localPose.translation;

    const placed = value<{ emitterId: string; arcIds: readonly string[] }>({ kind: "geodesicEmitters/place", cellId: crossing.cellId, point, yawRadians: 0 });

    expect(placed.arcIds).toHaveLength(4);
    expect(placed.arcIds.every((arcId) => /^geodesicModel\/arc:\d+$/.test(arcId))).toBe(true);
  });
});

describe("geodesicEmitters/shoot", () => {
  it("makes a new arc along the yaw, in the model's id family, and turns the emitter", () => {
    const { registry, value } = setup();
    const { emitterId } = value<{ emitterId: string }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 2.5, z: 0 }, yawRadians: 0 });

    const shot = value<{ arcId: string }>({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: Math.PI / 2, lengthMeters: 1.5 });

    expect(shot).toEqual({ outcome: "shot", emitterId, arcId: "geodesicModel/arc:0" });
    expect(totalGeodesicLength(registry, "geodesicModel/arc:0")).toBeCloseTo(1.5, 6);
    expect(getGeodesicSegments(registry, "geodesicModel/arc:0")[0]?.direction.y).toBeCloseTo(1, 9);
    expect(registry.get(emitterId)).toMatchObject({ aimYawRadians: Math.PI / 2 });
  });

  it("is refused for what is no emitter, a length too short and a yaw that is no number", () => {
    const { expectRefused, emitterId, arcId } = withShotGeodesic();

    expectRefused({ kind: "geodesicEmitters/shoot", emitterId: arcId, yawRadians: 0, lengthMeters: 1 }, geodesicEmittersRefusals.notAnEmitter);
    expectRefused({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: 0, lengthMeters: 0.01 }, geodesicEmittersRefusals.tooShort);
    expectRefused({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: 0, lengthMeters: Number.NaN }, geodesicEmittersRefusals.tooShort);
    expectRefused({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: Number.NaN, lengthMeters: 1 }, geodesicEmittersRefusals.blocked);
  });
});

describe("geodesicEmitters/extend", () => {
  it("lengthens a free geodesic by the given length", () => {
    const { registry, value, emitterId, arcId } = withShotGeodesic();

    expect(value({ kind: "geodesicEmitters/extend", arcId, lengthMeters: 0.5 })).toEqual({ outcome: "extended", emitterId, arcId });

    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(3.5, 6);
  });

  it("is refused for what is not on an emitter and for a length too short", () => {
    const { expectRefused, emitterId, arcId } = withShotGeodesic();

    expectRefused({ kind: "geodesicEmitters/extend", arcId: emitterId, lengthMeters: 1 }, geodesicEmittersRefusals.notAttached);
    expectRefused({ kind: "geodesicEmitters/extend", arcId, lengthMeters: 0 }, geodesicEmittersRefusals.tooShort);
  });

  it("is refused as blocked for a geodesic that connects emitters or is tied", () => {
    const connected = createTorusConnectedPairScenario();
    setup(connected.registry, connected.world).expectRefused({ kind: "geodesicEmitters/extend", arcId: "g1", lengthMeters: 1 }, geodesicEmittersRefusals.blocked);
    const tied = createTorusTiedPairScenario();
    setup(tied.registry, tied.world).expectRefused({ kind: "geodesicEmitters/extend", arcId: "g1", lengthMeters: 1 }, geodesicEmittersRefusals.blocked);
  });
});

describe("geodesicEmitters/deleteGeodesic", () => {
  it("deletes the arc with its segments and free end; its length and angle go with it", () => {
    const { engine, registry, value, emitterId, arcId } = withShotGeodesic();
    const second = value<{ arcId: string }>({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: Math.PI / 2, lengthMeters: 1 });
    registry.add(createMeasuredGeodesicLengthObject({ id: "length", registry, geodesicId: arcId, playerCellId: "a", playerPoint: { x: 2, y: 2, z: 0 } })!);
    const emitter = registry.get(emitterId);
    if (emitter?.kind !== emitterKind) throw new Error("no emitter");
    const center = resolveProtractorCenterSelection(registry, emitter);
    const first = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, geodesicId: arcId });
    const other = resolveProtractorEmitterGeodesicSelection({ center, emitter, registry, geodesicId: second.arcId });
    if (!first || !other) throw new Error("no sides");
    registry.add(createProtractorAngleObject({ id: "angle", center, first, second: other }));
    runDerivePass(engine);

    expect(value({ kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId })).toEqual({ outcome: "geodesicDeleted", emitterId, arcId });

    expect(registry.get(arcId)).toBeUndefined();
    expect(getGeodesicSegments(registry, arcId)).toEqual([]);
    expect(registry.get(`${arcId}:free-end`)).toBeUndefined();
    expect(registry.get("length")).toBeUndefined();
    expect(registry.get("angle")).toBeUndefined();
    expect(getEmitterGeodesicIds(registry, emitterId)).toEqual([second.arcId]);
  });

  it("is refused for what is no emitter and for an arc not on the emitter", () => {
    const { expectRefused, value, emitterId, arcId } = withShotGeodesic();
    const other = value<{ emitterId: string }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x: 3, y: 4, z: 0 }, yawRadians: 0 });

    expectRefused({ kind: "geodesicEmitters/deleteGeodesic", emitterId: arcId, arcId }, geodesicEmittersRefusals.notAnEmitter);
    expectRefused({ kind: "geodesicEmitters/deleteGeodesic", emitterId: other.emitterId, arcId }, geodesicEmittersRefusals.notAttached);
    expectRefused({ kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId: "nothing" }, geodesicEmittersRefusals.notAttached);
  });
});

describe("geodesicEmitters/remove", () => {
  it("removes the emitter and its geodesics, and leaves no end on it", () => {
    const { registry, value, emitterId, arcId } = withShotGeodesic();

    expect(value({ kind: "geodesicEmitters/remove", emitterId })).toEqual({ outcome: "removed", emitterId, arcIds: [arcId] });

    expect(registry.get(emitterId)).toBeUndefined();
    expect(registry.get(arcId)).toBeUndefined();
    expect(registry.getObjectsOfKind("geodesicModel/vertex")).toEqual([]);
  });

  it("takes the whole curve of a tied arc", () => {
    const { world, registry } = createTorusTiedPairScenario();
    const { value } = setup(registry, world);

    const removed = value<{ arcIds: readonly string[] }>({ kind: "geodesicEmitters/remove", emitterId: "e1" });

    expect([...removed.arcIds].sort()).toEqual(["g1", "g2"]);
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toEqual([]);
    expect(registry.get("e2")?.kind).toBe(emitterKind);
  });

  it("is refused for what is no emitter", () => {
    const { expectRefused, arcId } = withShotGeodesic();

    expectRefused({ kind: "geodesicEmitters/remove", emitterId: arcId }, geodesicEmittersRefusals.notAnEmitter);
  });
});

describe("the emitter tool gate", () => {
  it("refuses every command while the configuration disables the emitter tool", () => {
    const registry = createRuntimeObjectRegistry();
    registry.add(createGeodesicEmitterObject({ id: "e", cellId: "a", localPose: yawRigidTransform3(0, { x: 3, y: 2.5, z: 0 }) }));
    const { expectRefused } = setup(registry, compileLargePortalWorld(), (toolId) => toolId !== geodesicEmitterToolId);

    const commands: readonly GeodesicEmittersCommand[] = [
      { kind: "geodesicEmitters/place", cellId: "a", point: { x: 4, y: 4, z: 0 }, yawRadians: 0 },
      { kind: "geodesicEmitters/shoot", emitterId: "e", yawRadians: 0, lengthMeters: 1 },
      { kind: "geodesicEmitters/extend", arcId: "g", lengthMeters: 1 },
      { kind: "geodesicEmitters/deleteGeodesic", emitterId: "e", arcId: "g" },
      { kind: "geodesicEmitters/remove", emitterId: "e" },
    ];
    for (const command of commands) expectRefused(command, "world/capabilityMissing");
  });
});
