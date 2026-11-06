/**
 * `tests/modules/geodesicMeasurementTools.test.ts` — unit tier.
 *
 * The length tool, the protractor and the removal of a label, over a real engine with a fake `ToolContext`: what a press submits, what a press during the wait does (nothing), and what the client does with the answers. The tool switch with a command in flight runs through the real tool host, in `tests/render/toolHost.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { AimPick, CommandResult, EngineCommandBase, ToolContext, ToolDescriptor } from "../../src/engine/moduleTypes";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { geodesicEmittersModule } from "../../src/modules/geodesicEmitters";
import { geodesicMeasurementsClient, geodesicMeasurementsModule } from "../../src/modules/geodesicMeasurements";
import { geodesicLengthToolId, geodesicProtractorToolId } from "../../src/modules/geodesicMeasurements/api";
import { requestAngleRemoval, requestLengthRemoval } from "../../src/modules/geodesicMeasurements/client";
import { geodesicModelModule } from "../../src/modules/geodesicModel";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld } from "../fixtures/world-objects/geodesic";
import { createTestEngine } from "../support/engine";

const eyePoint = { x: 0, y: 0, z: 1.6 };

function valueOf<T>(result: CommandResult): T {
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result.value as T;
}

function setup(toolId: typeof geodesicLengthToolId | typeof geodesicProtractorToolId) {
  const world = compileLargePortalWorld();
  const registry = createRuntimeObjectRegistry();
  const engine = createTestEngine({
    registry,
    getWorld: () => world,
    modules: [geodesicModelModule(), geodesicMeasurementsModule(), geodesicEmittersModule()],
    playerPose: { ...createDefaultPlayerPose("a"), position: { x: 1, y: 1, z: 0 } },
  });
  const tool: ToolDescriptor = geodesicMeasurementsClient().tools.find((candidate) => candidate.id === toolId)!;
  const log = { ended: 0, messages: [] as string[] };
  const aim: { pick?: AimPick } = {};
  const submitted: { readonly ticket: number; readonly command: EngineCommandBase }[] = [];
  let toolState: unknown;
  const context: ToolContext = {
    pickTargets: () => (aim.pick === undefined ? [] : [aim.pick]),
    currentPick: () => aim.pick,
    aimYawRadians: () => 0,
    commandInFlight: () => submitted.length > 0,
    submit: (command) => void submitted.push({ ticket: engine.submit("local", command), command }),
    getToolState: <T,>() => toolState as T | undefined,
    setToolState: (_moduleId, next) => void (toolState = next),
    endTool: () => void (log.ended += 1),
    selectObject: () => undefined,
    showObjectPage: () => undefined,
    chosenFlagType: () => "WoodenSign1",
    read: engine.read,
    query: (token) => engine.query(token),
    showMessage: (message) => void log.messages.push(message),
  };
  function settle(): void {
    while (submitted.length > 0) {
      engine.step(0);
      for (const entry of submitted.splice(0)) tool.onResult?.(context, engine.resultOf(entry.ticket) as CommandResult);
      engine.endFrame();
    }
  }
  function click(pick: AimPick | undefined): boolean {
    aim.pick = pick;
    return tool.onPrimaryAction(context);
  }
  function run(command: EngineCommandBase): CommandResult {
    const ticket = engine.submit("local", command);
    engine.step(0);
    const result = engine.resultOf(ticket) as CommandResult;
    engine.endFrame();
    return result;
  }
  function shoot(x: number, y: number, yawRadians: number, lengthMeters: number) {
    const placed = run({ kind: "geodesicEmitters/place", cellId: "a", point: { x, y, z: 0 }, yawRadians } as EngineCommandBase);
    const { emitterId } = valueOf<{ emitterId: string }>(placed);
    const shot = run({ kind: "geodesicEmitters/shoot", emitterId, yawRadians, lengthMeters } as EngineCommandBase);
    return { emitterId, arcId: valueOf<{ arcId: string }>(shot).arcId };
  }
  return { engine, registry, tool, context, log, submitted, settle, click, run, shoot, state: () => toolState };
}

function onSegment(registry: ReturnType<typeof createRuntimeObjectRegistry>, arcId: string, offset = 0.5): AimPick {
  const segment = registry.getSegmentsOfGeodesic(arcId)[0]!;
  return {
    objectId: segment.id,
    objectKind: segment.kind,
    cellId: segment.cellId,
    point: { x: segment.start.x + segment.direction.x * offset, y: segment.start.y + segment.direction.y * offset, z: segment.start.z },
    withinRange: true,
    eyePoint,
  };
}

describe("the length tool", () => {
  it("measures the geodesic of the aimed segment and ends", () => {
    const { registry, click, settle, log, shoot } = setup(geodesicLengthToolId);
    const { arcId } = shoot(1, 2.5, 0, 2);

    expect(click(onSegment(registry, arcId))).toBe(true);
    settle();

    expect(registry.getObjectsOfKind("geodesicMeasurements/length").map((length) => length.geodesicId)).toEqual([arcId]);
    expect(log.ended).toBe(1);
  });

  it("does nothing for a second press during the wait", () => {
    const { registry, click, settle, submitted, shoot, log } = setup(geodesicLengthToolId);
    const { arcId } = shoot(1, 2.5, 0, 2);

    click(onSegment(registry, arcId));
    click(onSegment(registry, arcId));
    expect(submitted).toHaveLength(1);
    settle();

    expect(registry.getObjectsOfKind("geodesicMeasurements/length")).toHaveLength(1);
    expect(log.ended).toBe(1);
  });

  it("asks nothing out of reach, off a geodesic, or with nothing aimed at", () => {
    const { registry, click, submitted, shoot } = setup(geodesicLengthToolId);
    const { arcId, emitterId } = shoot(1, 2.5, 0, 2);

    expect(click({ ...onSegment(registry, arcId), withinRange: false })).toBe(true);
    expect(click({ objectId: emitterId, objectKind: "geodesicEmitters/emitter", cellId: "a", point: { x: 1, y: 2.5, z: 1 }, withinRange: true, eyePoint })).toBe(true);
    expect(click(undefined)).toBe(true);

    expect(submitted).toEqual([]);
  });

  it("shows a refusal and stays", () => {
    const { registry, engine, click, settle, shoot, log } = setup(geodesicLengthToolId);
    const { arcId, emitterId } = shoot(1, 2.5, 0, 2);

    // Queued first: the world runs it before the tool's command.
    engine.submit("local", { kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId } as EngineCommandBase);
    click(onSegment(registry, arcId));
    settle();

    expect(log.messages).toEqual(["That is not a geodesic."]);
    expect(log.ended).toBe(0);
  });

  it("removes a label on request, once for a double click", () => {
    const { registry, context, settle, submitted, shoot, run, log } = setup(geodesicLengthToolId);
    const { arcId } = shoot(1, 2.5, 0, 2);
    run({ kind: "geodesicMeasurements/createLength", arcId } as EngineCommandBase);
    const [length] = registry.getObjectsOfKind("geodesicMeasurements/length");

    requestLengthRemoval(context, length!.id);
    requestLengthRemoval(context, length!.id);
    expect(submitted).toHaveLength(1);
    settle();

    expect(registry.getObjectsOfKind("geodesicMeasurements/length")).toEqual([]);
    expect(log.ended).toBe(0);
  });

  it("prompts for a geodesic", () => {
    const { tool, context } = setup(geodesicLengthToolId);

    expect(tool.prompt?.(context)).toBe("select: geodesic");
  });
});

describe("the protractor", () => {
  /** Two free geodesics crossing at (3, 2.5). */
  function atCrossing() {
    const scene = setup(geodesicProtractorToolId);
    const a = scene.shoot(1, 2.5, 0, 3);
    const b = scene.shoot(3, 1.5, Math.PI / 2, 3);
    const crossing = scene.registry.getObjectsOfKind("geodesicModel/crossing")[0]!;
    const vertex: AimPick = { objectId: crossing.id, objectKind: crossing.kind, cellId: "a", point: crossing.aimStickyTarget!.localPoint, withinRange: true, eyePoint };
    const sideOf = (arcId: string): AimPick => {
      const segment = crossing.segmentIds.map((id) => scene.registry.get(id)).find((object) => object?.kind === "geodesicModel/segment" && object.geodesicId === arcId);
      if (segment?.kind !== "geodesicModel/segment") throw new Error("no segment");
      const { localPoint } = crossing.aimStickyTarget!;
      return { objectId: segment.id, objectKind: segment.kind, cellId: "a", point: { x: localPoint.x + segment.direction.x * 0.1, y: localPoint.y + segment.direction.y * 0.1, z: localPoint.z }, withinRange: true, eyePoint };
    };
    return { ...scene, a, b, crossing, vertex, sideOf };
  }

  it("takes the vertex, then two sides, then asks the world and ends", () => {
    const { registry, tool, context, click, settle, log, state, vertex, sideOf, a, b, crossing } = atCrossing();
    expect(tool.prompt?.(context)).toBe("select: vertex");

    click(vertex);
    expect(tool.prompt?.(context)).toBe("select: side1");
    click(sideOf(a.arcId));
    expect(tool.prompt?.(context)).toBe("select: side2");
    click(sideOf(b.arcId));
    settle();

    const [angle] = registry.getObjectsOfKind("geodesicMeasurements/angle");
    expect(angle).toMatchObject({ centerObjectId: crossing.id, first: { geodesicId: a.arcId, label: "G1" }, second: { geodesicId: b.arcId, label: "G2" } });
    expect(angle?.angleDegrees).toBeCloseTo(90, 6);
    expect(log.ended).toBe(1);
    expect(state()).toBeUndefined();
  });

  it("does nothing for a press during the wait", () => {
    const { registry, click, settle, submitted, vertex, sideOf, a, b, log } = atCrossing();
    click(vertex);
    click(sideOf(a.arcId));
    click(sideOf(b.arcId));

    click(sideOf(b.arcId));
    click(vertex);
    expect(submitted).toHaveLength(1);
    settle();

    expect(registry.getObjectsOfKind("geodesicMeasurements/angle")).toHaveLength(1);
    expect(log.ended).toBe(1);
  });

  it("takes an emitter as the vertex, and its geodesic as a side", () => {
    const scene = setup(geodesicProtractorToolId);
    const { emitterId, arcId } = scene.shoot(2, 2.5, 0, 2);
    const other = valueOf<{ arcId: string }>(scene.run({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: Math.PI / 2, lengthMeters: 2 } as EngineCommandBase));
    const emitterPick = (emitterGeodesicId?: string): AimPick => ({
      objectId: emitterId, objectKind: "geodesicEmitters/emitter", cellId: "a", point: { x: 2, y: 2.5, z: 1 }, withinRange: true, eyePoint, ...(emitterGeodesicId ? { emitterGeodesicId } : {}),
    });

    scene.click(emitterPick());
    scene.click(emitterPick(arcId));
    scene.click(emitterPick(other.arcId));
    scene.settle();

    const [angle] = scene.registry.getObjectsOfKind("geodesicMeasurements/angle");
    expect(angle?.angleDegrees).toBeCloseTo(90, 6);
  });

  it("ignores what is no vertex, what is out of reach, and the same side twice", () => {
    const { click, state, submitted, vertex, sideOf, a } = atCrossing();

    click(sideOf(a.arcId));
    expect(state()).toBeUndefined();
    click({ ...vertex, withinRange: false });
    expect(state()).toBeUndefined();

    click(vertex);
    click(sideOf(a.arcId));
    const picks = state();
    click(sideOf(a.arcId));

    expect(state()).toBe(picks);
    expect(submitted).toEqual([]);
  });

  it("shows a refusal, stays, and starts its picks again", () => {
    const { registry, engine, click, settle, log, state, vertex, sideOf, a, b } = atCrossing();
    click(vertex);
    click(sideOf(a.arcId));
    // Queued first: the world runs it before the tool's command.
    engine.submit("local", { kind: "geodesicEmitters/deleteGeodesic", emitterId: a.emitterId, arcId: a.arcId } as EngineCommandBase);
    click(sideOf(b.arcId));

    settle();

    expect(log.messages).toHaveLength(1);
    expect(log.ended).toBe(0);
    expect(state()).toBeUndefined();
    expect(registry.getObjectsOfKind("geodesicMeasurements/angle")).toEqual([]);
  });

  it("removes a label on request, once for a double click", () => {
    const { registry, context, click, settle, submitted, vertex, sideOf, a, b } = atCrossing();
    click(vertex);
    click(sideOf(a.arcId));
    click(sideOf(b.arcId));
    settle();
    const [angle] = registry.getObjectsOfKind("geodesicMeasurements/angle");

    requestAngleRemoval(context, angle!.id);
    requestAngleRemoval(context, angle!.id);
    expect(submitted).toHaveLength(1);
    settle();

    expect(registry.getObjectsOfKind("geodesicMeasurements/angle")).toEqual([]);
  });
});
