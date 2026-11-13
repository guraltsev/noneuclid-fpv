/**
 * `tests/modules/geodesicEmitters/emitterTool.test.ts` — unit tier.
 *
 * The emitter tool and the requests of the emitter's page, over a real engine with a fake `ToolContext`: what a click submits, and what the client does with the answers.
 */
import { describe, expect, it } from "vitest";
import type { AimPick, CommandResult, EngineCommandBase, ToolContext, ToolDescriptor } from "../../../src/engine/moduleTypes";
import { geodesicEmittersClient, geodesicEmittersModule } from "../../../src/modules/geodesicEmitters";
import { requestGeodesicDeletion, requestGeodesicExtension, requestNewGeodesic } from "../../../src/modules/geodesicEmitters/client";
import { geodesicModelModule } from "../../../src/modules/geodesicModel";
import { defaultTraceLengthMeters } from "../../../src/world-objects/geodesic/objects";
import { getEmitterGeodesicIds } from "../../../src/world-objects/geodesic/endpoints";
import { createRuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { compileLargePortalWorld, createTorusConnectedPairScenario, totalGeodesicLength } from "../../fixtures/world-objects/geodesic";
import { createTestEngine } from "../../support/engine";

function setup(scene: { readonly world: ReturnType<typeof compileLargePortalWorld>; readonly registry: ReturnType<typeof createRuntimeObjectRegistry> } = { world: compileLargePortalWorld(), registry: createRuntimeObjectRegistry() }) {
  const { world, registry } = scene;
  const engine = createTestEngine({ registry, getWorld: () => world, modules: [geodesicModelModule(), geodesicEmittersModule()] });
  const tool: ToolDescriptor = geodesicEmittersClient().tools[0]!;
  const log = { ended: 0, messages: [] as string[], selected: [] as (readonly [string, string])[], pages: [] as string[] };
  const aim: { pick?: AimPick; yaw?: number } = { yaw: 0 };
  const submitted: { readonly ticket: number; readonly command: EngineCommandBase }[] = [];
  let toolState: unknown;
  const context: ToolContext = {
    pickTargets: () => (aim.pick === undefined ? [] : [aim.pick]),
    currentPick: () => aim.pick,
    aimYawRadians: () => aim.yaw,
    commandInFlight: () => submitted.length > 0,
    submit: (command) => void submitted.push({ ticket: engine.submit("local", command), command }),
    getToolState: <T,>() => toolState as T | undefined,
    setToolState: (_moduleId, next) => void (toolState = next),
    endTool: () => void (log.ended += 1),
    selectObject: (objectId, geodesicId) => void log.selected.push([objectId, geodesicId]),
    showObjectPage: (objectId) => void log.pages.push(objectId),
    chosenFlagType: () => "WoodenSign1",
    read: engine.read,
    query: (token) => engine.query(token),
    showMessage: (message) => void log.messages.push(message),
  };
  /** One step, handing each result to the tool as the shell does after a step. */
  function stepOnce(): void {
    engine.step(0);
    for (const entry of submitted.splice(0)) tool.onResult?.(context, engine.resultOf(entry.ticket) as CommandResult);
    engine.endFrame();
  }
  /** Steps the world until nothing is in flight. */
  function settle(): void {
    while (submitted.length > 0) stepOnce();
  }
  function click(pick: AimPick, yaw = 0): boolean {
    aim.pick = pick;
    aim.yaw = yaw;
    return tool.onPrimaryAction(context);
  }
  return { engine, registry, tool, context, log, aim, submitted, stepOnce, settle, click };
}

const floorAt = (x: number, y: number): AimPick => ({ objectKind: "floor", cellId: "a", point: { x, y, z: 0 }, withinRange: true, eyePoint: { x: 0, y: 0, z: 1.6 } });

describe("the emitter tool", () => {
  it("places on the floor, shoots a first geodesic along the aim, selects both and ends", () => {
    const { registry, click, settle, log } = setup();

    expect(click(floorAt(3, 2.5), Math.PI / 2)).toBe(true);
    settle();

    const emitter = registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!;
    const arcId = getEmitterGeodesicIds(registry, emitter.id)[0]!;
    expect(emitter.aimYawRadians).toBeCloseTo(Math.PI / 2, 12);
    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(defaultTraceLengthMeters, 6);
    expect(log.selected).toEqual([[emitter.id, arcId]]);
    expect(log.ended).toBe(1);
  });

  it("selects the cut geodesic and ends, shooting nothing more, on a geodesic", () => {
    const { registry, click, settle, log } = setup();
    click(floorAt(3, 2.5));
    settle();
    const [arcId] = getEmitterGeodesicIds(registry, registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!.id);

    click({ objectId: `${arcId}:segment:0`, objectKind: "geodesicModel/segment", cellId: "a", point: { x: 4, y: 2.5, z: 1.2 }, withinRange: true, eyePoint: { x: 0, y: 0, z: 1.6 } });
    settle();

    const placed = registry.getObjectsOfKind("geodesicEmitters/emitter")[1]!;
    expect(log.selected.at(-1)).toEqual([placed.id, arcId]);
    expect(getEmitterGeodesicIds(registry, placed.id)).toHaveLength(2);
    expect(log.ended).toBe(2);
  });

  it("adds a geodesic to an emitter in reach, and ignores one out of reach", () => {
    const { registry, click, settle, log } = setup();
    click(floorAt(3, 2.5));
    settle();
    const emitter = registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!;
    const pick: AimPick = { objectId: emitter.id, objectKind: emitter.kind, cellId: "a", point: { x: 3, y: 2.5, z: 1 }, withinRange: true, eyePoint: { x: 0, y: 0, z: 1.6 } };

    click({ ...pick, withinRange: false });
    settle();
    expect(getEmitterGeodesicIds(registry, emitter.id)).toHaveLength(1);

    click(pick);
    settle();
    expect(getEmitterGeodesicIds(registry, emitter.id)).toHaveLength(2);
    expect(log.ended).toBe(2);
  });

  it("does nothing for a vertical aim or for anything else it can hit", () => {
    const { submitted, tool, context, aim } = setup();

    aim.pick = floorAt(3, 2.5);
    aim.yaw = undefined;
    expect(tool.onPrimaryAction(context)).toBe(true);
    aim.pick = { objectId: "flag", objectKind: "placedFlags/flag", cellId: "a", point: { x: 1, y: 1, z: 0 }, withinRange: true, eyePoint: { x: 0, y: 0, z: 1.6 } };
    aim.yaw = 0;
    expect(tool.onPrimaryAction(context)).toBe(true);
    aim.pick = undefined;
    expect(tool.onPrimaryAction(context)).toBe(true);

    expect(submitted).toEqual([]);
  });

  it("shows the world's refusal and stays", () => {
    const { registry, click, settle, log } = setup();
    click(floorAt(3, 2.5));
    settle();

    click(floorAt(3.05, 2.5));
    settle();

    expect(log.messages).toEqual(["A laser cannot stand there."]);
    expect(log.ended).toBe(1);
    expect(registry.getObjectsOfKind("geodesicEmitters/emitter")).toHaveLength(1);
  });
});

describe("the emitter's page", () => {
  it("shows the page again with the new geodesic selected, and the tool does not end", () => {
    const { registry, context, click, settle, log } = setup();
    click(floorAt(3, 2.5));
    settle();
    const emitterId = registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!.id;
    log.ended = 0;

    requestNewGeodesic(context, emitterId);
    settle();

    expect(getEmitterGeodesicIds(registry, emitterId)).toHaveLength(2);
    expect(log.selected.at(-1)).toEqual([emitterId, getEmitterGeodesicIds(registry, emitterId)[1]]);
    expect(log.pages).toEqual([emitterId]);
    expect(log.ended).toBe(0);
  });

  it("shows the page again without a deleted geodesic", () => {
    const { registry, context, click, settle, log } = setup();
    click(floorAt(3, 2.5));
    settle();
    const emitterId = registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!.id;
    const arcId = getEmitterGeodesicIds(registry, emitterId)[0]!;

    requestGeodesicDeletion(context, emitterId, arcId);
    settle();

    expect(registry.get(arcId)).toBeUndefined();
    expect(log.pages).toEqual([emitterId]);
  });

  it("shows the refusal and the page as it now is, for an emitter that is gone", () => {
    const { context, settle, log } = setup();

    requestNewGeodesic(context, "gone");
    settle();

    expect(log.messages).toEqual(["That is not a laser."]);
    expect(log.ended).toBe(0);
    expect(log.pages).toEqual(["gone"]);
  });
});

describe("a press while the world has not answered", () => {
  /** An emitter at (3, 2.5) with its first geodesic, the tool ended. */
  function withEmitter() {
    const scene = setup();
    scene.click(floorAt(3, 2.5));
    scene.settle();
    const emitter = scene.registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!;
    scene.log.ended = 0;
    return { ...scene, emitter, arcId: getEmitterGeodesicIds(scene.registry, emitter.id)[0]! };
  }

  it("adds one geodesic and keeps the page open when Add geodesic is pressed twice", () => {
    const { registry, context, settle, log, emitter } = withEmitter();

    requestNewGeodesic(context, emitter.id);
    requestNewGeodesic(context, emitter.id);
    settle();

    expect(getEmitterGeodesicIds(registry, emitter.id)).toHaveLength(2);
    expect(log.ended).toBe(0);
    expect(log.pages).toEqual([emitter.id]);
  });

  it("places one emitter when the floor is pressed again elsewhere", () => {
    const { registry, click, settle, log } = setup();

    click(floorAt(3, 2.5));
    click(floorAt(1, 1));
    settle();

    expect(registry.getObjectsOfKind("geodesicEmitters/emitter")).toHaveLength(1);
    expect(registry.getObjectsOfKind("geodesicModel/arc")).toHaveLength(1);
    expect(log.ended).toBe(1);
  });

  it("shows no refusal when the same spot is pressed again", () => {
    const { registry, click, settle, log } = setup();

    click(floorAt(3, 2.5));
    click(floorAt(3, 2.5));
    settle();

    expect(registry.getObjectsOfKind("geodesicEmitters/emitter")).toHaveLength(1);
    expect(log.messages).toEqual([]);
  });

  it("adds nothing when the new emitter is pressed between the two answers", () => {
    const { registry, click, stepOnce, settle } = setup();

    click(floorAt(3, 2.5));
    stepOnce();
    const emitter = registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!;
    click({ objectId: emitter.id, objectKind: emitter.kind, cellId: "a", point: { x: 3, y: 2.5, z: 1 }, withinRange: true, eyePoint: { x: 0, y: 0, z: 1.6 } });
    settle();

    expect(getEmitterGeodesicIds(registry, emitter.id)).toHaveLength(1);
  });

  it("deletes once, with no refusal, when delete is pressed twice", () => {
    const { registry, context, settle, log, emitter, arcId } = withEmitter();

    requestGeodesicDeletion(context, emitter.id, arcId);
    requestGeodesicDeletion(context, emitter.id, arcId);
    settle();

    expect(registry.get(arcId)).toBeUndefined();
    expect(log.messages).toEqual([]);
    expect(log.pages).toEqual([emitter.id]);
  });

  it("lengthens once when a geodesic is pressed twice", () => {
    const { registry, context, settle, arcId } = withEmitter();

    requestGeodesicExtension(context, arcId);
    requestGeodesicExtension(context, arcId);
    settle();

    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(2 * defaultTraceLengthMeters, 6);
  });
});

describe("a click on a geodesic", () => {
  it("asks to lengthen a free geodesic and selects it", () => {
    const { registry, context, click, settle, log } = setup();
    click(floorAt(3, 2.5));
    settle();
    const emitterId = registry.getObjectsOfKind("geodesicEmitters/emitter")[0]!.id;
    const arcId = getEmitterGeodesicIds(registry, emitterId)[0]!;

    expect(requestGeodesicExtension(context, arcId)).toBe(true);
    settle();

    expect(totalGeodesicLength(registry, arcId)).toBeCloseTo(2 * defaultTraceLengthMeters, 6);
    expect(log.selected.at(-1)).toEqual([emitterId, arcId]);
  });

  it("asks nothing for a geodesic that connects emitters", () => {
    const { context, submitted } = setup(createTorusConnectedPairScenario());

    expect(requestGeodesicExtension(context, "g1")).toBe(false);
    expect(submitted).toEqual([]);
  });
});
