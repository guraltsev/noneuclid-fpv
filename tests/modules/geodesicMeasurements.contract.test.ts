/**
 * `tests/modules/geodesicMeasurements.contract.test.ts` — unit tier.
 *
 * The contract of the geodesic measurements module, through the engine with the write guard on: each command's success and each refusal; a refusal changes nothing (the registry version stays); results carry the new ids, of the families `geodesicMeasurements/length` and `geodesicMeasurements/angle`; every command needs its tool.
 */
import { describe, expect, it } from "vitest";
import type { CommandResult, EngineCommandBase } from "../../src/engine/moduleTypes";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { geodesicEmittersModule } from "../../src/modules/geodesicEmitters";
import { geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { geodesicLengthToolId, geodesicMeasurementsRefusals, geodesicProtractorToolId, type GeodesicMeasurementsCommand } from "../../src/modules/geodesicMeasurements/api";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { resolveProtractorCenterSelection, resolveProtractorSideAt } from "../../src/world-objects/protractorTool";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import type { ProtractorDirectedGeodesic } from "../../src/world-objects/toolObjects";
import { compileLargePortalWorld, totalGeodesicLength } from "../fixtures/world-objects/geodesic";
import { createTestEngine } from "../support/engine";

function setup(isToolEnabled?: (toolId: string) => boolean) {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  const engine = createTestEngine({
    registry,
    getWorld: () => world,
    modules: [geodesicModelModule(), geodesicMeasurementsModule(), geodesicEmittersModule()],
    playerPose: { ...createDefaultPlayerPose("a"), position: { x: 1, y: 1, z: 0 } },
    ...(isToolEnabled ? { isToolEnabled } : {}),
  });
  function run(command: GeodesicMeasurementsCommand | EngineCommandBase): CommandResult {
    const ticket = engine.submit("local", command as EngineCommandBase);
    engine.step(0);
    const result = engine.resultOf(ticket) as CommandResult;
    engine.endFrame();
    return result;
  }
  function value<T>(command: GeodesicMeasurementsCommand | EngineCommandBase): T {
    const result = run(command);
    if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
    return result.value as T;
  }
  function expectRefused(command: GeodesicMeasurementsCommand, code: string): void {
    const version = registry.getVersion();
    expect(run(command)).toMatchObject({ ok: false, refusal: { code } });
    expect(registry.getVersion()).toBe(version);
  }
  function shoot(x: number, y: number, yawRadians: number, lengthMeters: number) {
    const { emitterId } = value<{ emitterId: string }>({ kind: "geodesicEmitters/place", cellId: "a", point: { x, y, z: 0 }, yawRadians } as EngineCommandBase);
    const { arcId } = value<{ arcId: string }>({ kind: "geodesicEmitters/shoot", emitterId, yawRadians, lengthMeters } as EngineCommandBase);
    return { emitterId, arcId };
  }
  return { engine, registry, run, value, expectRefused, shoot };
}

/** Two free geodesics crossing at (3, 2.5), and the two sides there. */
function crossingScene() {
  const scene = setup();
  const a = scene.shoot(1, 2.5, 0, 3);
  const b = scene.shoot(3, 1, Math.PI / 2, 3);
  const crossing = scene.registry.getObjectsOfKind("geodesicModel/crossing")[0]!;
  const center = resolveProtractorCenterSelection(scene.registry, crossing);
  const sideAt = (index: 0 | 1): ProtractorDirectedGeodesic =>
    resolveProtractorSideAt(scene.registry, center, { objectId: crossing.segmentIds[index], point: { x: center.point.x + 0.1, y: center.point.y + 0.1, z: center.point.z } })!;
  return { ...scene, a, b, crossing, first: sideAt(0), second: sideAt(1) };
}

describe("createLength", () => {
  it("makes a length of the arc, named after it, near the participant", () => {
    const { value, registry, shoot } = setup();
    const { arcId } = shoot(1, 2.5, 0, 2);

    const answer = value<{ outcome: string; id: string }>({ kind: "geodesicMeasurements/createLength", arcId });

    expect(answer).toEqual({ outcome: "lengthCreated", id: "geodesicMeasurements/length:0" });
    expect(registry.get(answer.id)).toMatchObject({ kind: "geodesicMeasurements/length", geodesicId: arcId, label: "Beam 1", portalRenderable: true });
    expect(registry.get(answer.id)).toMatchObject({ lengthMeters: totalGeodesicLength(registry, arcId) });
  });

  it("moves the one label of an arc measured again", () => {
    const { value, registry, shoot, engine } = setup();
    const { arcId } = shoot(1, 2.5, 0, 2);
    const first = value<{ id: string }>({ kind: "geodesicMeasurements/createLength", arcId });
    engine.publishBody("local", { ...createDefaultPlayerPose("a"), position: { x: 2.5, y: 1, z: 0 } });

    const second = value<{ id: string }>({ kind: "geodesicMeasurements/createLength", arcId });

    expect(second.id).toBe(first.id);
    expect(registry.getObjectsOfKind("geodesicMeasurements/length")).toHaveLength(1);
  });

  it("refuses what is not an arc, and an unknown arc", () => {
    const { expectRefused, shoot } = setup();
    const { emitterId } = shoot(1, 2.5, 0, 2);

    expectRefused({ kind: "geodesicMeasurements/createLength", arcId: "no-such-arc" }, geodesicMeasurementsRefusals.notAnArc);
    expectRefused({ kind: "geodesicMeasurements/createLength", arcId: emitterId }, geodesicMeasurementsRefusals.notAnArc);
  });
});

describe("removeLength", () => {
  it("removes a length and refuses anything else", () => {
    const { value, registry, expectRefused, shoot } = setup();
    const { arcId, emitterId } = shoot(1, 2.5, 0, 2);
    const { id } = value<{ id: string }>({ kind: "geodesicMeasurements/createLength", arcId });

    expectRefused({ kind: "geodesicMeasurements/removeLength", lengthId: emitterId }, geodesicMeasurementsRefusals.notALength);
    expect(value({ kind: "geodesicMeasurements/removeLength", lengthId: id })).toEqual({ outcome: "lengthRemoved", id });

    expect(registry.get(id)).toBeUndefined();
    expectRefused({ kind: "geodesicMeasurements/removeLength", lengthId: id }, geodesicMeasurementsRefusals.notALength);
  });
});

describe("createAngle", () => {
  it("makes the angle at a crossing from its two sides", () => {
    const { value, registry, crossing, first, second } = crossingScene();

    const answer = value<{ outcome: string; id: string }>({ kind: "geodesicMeasurements/createAngle", center: crossing.id, first, second });

    expect(answer).toEqual({ outcome: "angleCreated", id: "geodesicMeasurements/angle:0" });
    expect(registry.get(answer.id)).toMatchObject({ kind: "geodesicMeasurements/angle", centerObjectId: crossing.id, first: { label: first.label }, second: { label: second.label } });
  });

  it("makes the angle at an emitter from two of its geodesics", () => {
    const { value, registry, shoot } = setup();
    const { emitterId, arcId } = shoot(2, 2.5, 0, 2);
    const { arcId: other } = value<{ arcId: string }>({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: Math.PI / 2, lengthMeters: 2 } as EngineCommandBase);
    const emitter = registry.get(emitterId);
    if (emitter?.kind !== "geodesicEmitters/emitter") throw new Error("no emitter");
    const center = resolveProtractorCenterSelection(registry, emitter);
    const side = (geodesicId: string): ProtractorDirectedGeodesic => ({ geodesicId, segmentId: `${emitterId}:${geodesicId}:emitter`, yawRadians: 0, directionSign: 1 });
    expect(center.geodesicIds).toEqual([arcId, other]);

    const { id } = value<{ id: string }>({ kind: "geodesicMeasurements/createAngle", center: emitterId, first: side(arcId), second: side(other) });

    expect(registry.get(id)).toMatchObject({ centerObjectId: emitterId });
    expect((registry.get(id) as { angleDegrees: number }).angleDegrees).toBeCloseTo(90, 6);
  });

  it("refuses a centre that is no vertex", () => {
    const { expectRefused, a, first, second } = crossingScene();

    expectRefused({ kind: "geodesicMeasurements/createAngle", center: "no-such-vertex", first, second }, geodesicMeasurementsRefusals.notACenter);
    expectRefused({ kind: "geodesicMeasurements/createAngle", center: a.arcId, first, second }, geodesicMeasurementsRefusals.notACenter);
  });

  it("refuses a side that is no ray of the centre, and one that is not a side at all", () => {
    const { expectRefused, crossing, first, shoot } = crossingScene();
    const elsewhere = shoot(1, 4.5, 0, 1);
    const stranger: ProtractorDirectedGeodesic = { geodesicId: elsewhere.arcId, segmentId: `${elsewhere.arcId}:segment:0`, yawRadians: 0 };

    expectRefused({ kind: "geodesicMeasurements/createAngle", center: crossing.id, first, second: stranger }, geodesicMeasurementsRefusals.notASide);
    expectRefused({ kind: "geodesicMeasurements/createAngle", center: crossing.id, first, second: "north" as never }, geodesicMeasurementsRefusals.notASide);
    expectRefused({ kind: "geodesicMeasurements/createAngle", center: crossing.id, first: undefined as never, second: first }, geodesicMeasurementsRefusals.notASide);
  });

  it("refuses the same end of a geodesic twice", () => {
    const { expectRefused, crossing, first } = crossingScene();

    expectRefused({ kind: "geodesicMeasurements/createAngle", center: crossing.id, first, second: first }, geodesicMeasurementsRefusals.sameSide);
  });
});

describe("removeAngle", () => {
  it("removes an angle and refuses anything else", () => {
    const { value, registry, expectRefused, crossing, first, second } = crossingScene();
    const { id } = value<{ id: string }>({ kind: "geodesicMeasurements/createAngle", center: crossing.id, first, second });

    expectRefused({ kind: "geodesicMeasurements/removeAngle", angleId: crossing.id }, geodesicMeasurementsRefusals.notAnAngle);
    expect(value({ kind: "geodesicMeasurements/removeAngle", angleId: id })).toEqual({ outcome: "angleRemoved", id });

    expect(registry.get(id)).toBeUndefined();
  });
});

describe("the tools of the commands", () => {
  it("refuses the commands of a length or an angle while its tool is disabled", () => {
    const noLength = setup((toolId) => toolId !== geodesicLengthToolId);
    noLength.expectRefused({ kind: "geodesicMeasurements/createLength", arcId: "g" }, "world/capabilityMissing");
    noLength.expectRefused({ kind: "geodesicMeasurements/removeLength", lengthId: "l" }, "world/capabilityMissing");

    const noAngle = setup((toolId) => toolId !== geodesicProtractorToolId);
    const side: ProtractorDirectedGeodesic = { geodesicId: "g", segmentId: "s", yawRadians: 0 };
    noAngle.expectRefused({ kind: "geodesicMeasurements/createAngle", center: "c", first: side, second: side }, "world/capabilityMissing");
    noAngle.expectRefused({ kind: "geodesicMeasurements/removeAngle", angleId: "a" }, "world/capabilityMissing");
  });
});
