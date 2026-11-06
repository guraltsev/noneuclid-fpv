/**
 * `tests/modules/placedFlags.test.ts` — unit tier.
 *
 * The placed flags module, through the engine with the write guard on, and its sign tool over a fake `ToolContext`: each command's success and each refusal; a refusal changes nothing (the registry version stays); results carry the id, of the family `placedFlags/flag`; every command needs the sign tool. The module has no ticks.
 * The tool switch with a command in flight runs through the real tool host, in `tests/render/toolHost.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { AimPick, CommandResult, EngineCommandBase, ToolContext, ToolDescriptor } from "../../src/engine/moduleTypes";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { placedFlagsClient, placedFlagsModule } from "../../src/modules/placedFlags";
import { placedFlagsRefusals, placedFlagToolId, type PlacedFlagsCommand } from "../../src/modules/placedFlags/api";
import { requestFlagMessage, requestFlagRemoval } from "../../src/modules/placedFlags/client";
import { placedFlagMaxMessageLength } from "../../src/world-objects/placedFlags";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import type { PlacedFlagObject, PlacedFlagType } from "../../src/world-objects/toolObjects";
import { createTestEngine } from "../support/engine";

const world = compileCellComplex({
  cells: [{ id: "room", heightMeters: 3, baseVertices: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], portals: [] }],
});
const eyePoint = { x: 0, y: -2, z: 1.6 };
const floorAt = (x: number, y: number) => ({ objectKind: "floor", cellId: "room", point: { x, y, z: 0 }, withinRange: true, eyePoint }) satisfies AimPick;

function setup(isToolEnabled?: (toolId: string) => boolean) {
  const registry = createRuntimeObjectRegistry();
  const engine = createTestEngine({ registry, getWorld: () => world, modules: [placedFlagsModule()], playerPose: createDefaultPlayerPose("room"), ...(isToolEnabled ? { isToolEnabled } : {}) });
  function run(command: PlacedFlagsCommand): CommandResult {
    const ticket = engine.submit("local", command as EngineCommandBase);
    engine.step(0);
    const result = engine.resultOf(ticket) as CommandResult;
    engine.endFrame();
    return result;
  }
  function expectRefused(command: PlacedFlagsCommand, code: string): void {
    const version = registry.getVersion();
    expect(run(command)).toMatchObject({ ok: false, refusal: { code } });
    expect(registry.getVersion()).toBe(version);
  }
  const place = (x: number, y: number, flagType: PlacedFlagType = "WoodenSign1"): PlacedFlagsCommand => ({ kind: "placedFlags/place", cellId: "room", point: { x, y, z: 0 }, eyePoint, flagType });
  function flags(): readonly PlacedFlagObject[] {
    return registry.getObjectsOfKind("placedFlags/flag");
  }
  return { engine, registry, run, expectRefused, place, flags };
}

describe("the commands", () => {
  it("stands a flag at the point, facing the eye, with the next default message of its type", () => {
    const { run, place, flags } = setup();

    expect(run(place(1, 0.5))).toEqual({ ok: true, value: { outcome: "placed", flagId: "placedFlags/flag:0" } });
    run(place(-3, 0.5));
    run(place(3, 3, "WoodenSign2"));

    expect(flags().map((flag) => flag.message)).toEqual(["A1", "A2", "B1"]);
    expect(flags()[0]).toMatchObject({ kind: "placedFlags/flag", cellId: "room", flagType: "WoodenSign1", localPose: { translation: { x: 1, y: 0.5, z: 0 } } });
  });

  it("refuses a place taken by a wall, by another flag, or that is no place", () => {
    const { run, place, expectRefused } = setup();
    run(place(1, 0.5));

    expectRefused(place(1.2, 0.5), placedFlagsRefusals.blocked);
    expectRefused(place(4.9, 0), placedFlagsRefusals.blocked);
    expectRefused({ ...place(1, 3), cellId: "no-such-cell" } as PlacedFlagsCommand, placedFlagsRefusals.blocked);
    expectRefused({ ...place(1, 3), point: "there" } as never, placedFlagsRefusals.blocked);
    expectRefused({ ...place(1, 3), eyePoint: { x: Number.NaN, y: 0, z: 0 } } as PlacedFlagsCommand, placedFlagsRefusals.blocked);
  });

  it("refuses a type of sign there is not", () => {
    const { place, expectRefused } = setup();

    expectRefused(place(1, 3, "Banner" as PlacedFlagType), placedFlagsRefusals.unknownType);
  });

  it("sanitizes a message, and writes nothing for the same one", () => {
    const { run, place, flags, registry } = setup();
    run(place(1, 0.5));
    const flagId = flags()[0]!.id;

    expect(run({ kind: "placedFlags/setMessage", flagId, message: `A  B${"C".repeat(40)}` })).toEqual({ ok: true, value: { outcome: "messageSet", flagId } });

    expect([...flags()[0]!.message]).toHaveLength(placedFlagMaxMessageLength);
    expect(flags()[0]!.message.startsWith("A BC")).toBe(true);
    const version = registry.getVersion();
    expect(run({ kind: "placedFlags/setMessage", flagId, message: flags()[0]!.message })).toMatchObject({ ok: true });
    expect(registry.getVersion()).toBe(version);
  });

  it("refuses a message for what is no flag, and what is no message", () => {
    const { run, place, flags, expectRefused } = setup();
    run(place(1, 0.5));

    expectRefused({ kind: "placedFlags/setMessage", flagId: "no-such-flag", message: "A" }, placedFlagsRefusals.notAFlag);
    expectRefused({ kind: "placedFlags/setMessage", flagId: flags()[0]!.id, message: 7 as never }, placedFlagsRefusals.notAMessage);
  });

  it("removes a flag and refuses anything else", () => {
    const { run, place, flags, expectRefused } = setup();
    run(place(1, 0.5));
    const flagId = flags()[0]!.id;

    expect(run({ kind: "placedFlags/remove", flagId })).toEqual({ ok: true, value: { outcome: "removed", flagId } });

    expect(flags()).toEqual([]);
    expectRefused({ kind: "placedFlags/remove", flagId }, placedFlagsRefusals.notAFlag);
  });

  it("needs the sign tool for every command", () => {
    const { place, expectRefused } = setup((toolId) => toolId !== placedFlagToolId);

    expectRefused(place(1, 0.5), "world/capabilityMissing");
    expectRefused({ kind: "placedFlags/setMessage", flagId: "f", message: "A" }, "world/capabilityMissing");
    expectRefused({ kind: "placedFlags/remove", flagId: "f" }, "world/capabilityMissing");
  });

  it("has no ticks", () => {
    const { engine, registry } = setup();
    const definition = placedFlagsModule();

    const instance = definition.create({ require: () => undefined as never, objects: registry, getWorld: () => world, submitPublicCommand: () => Promise.reject(new Error("no scripts here")) });

    expect(instance.ticks).toEqual([]);
    expect(engine.read.stepIndex).toBe(0);
  });
});

describe("the sign tool", () => {
  function toolSetup() {
    const scene = setup();
    const tool: ToolDescriptor = placedFlagsClient().tools[0]!;
    const log = { ended: 0, messages: [] as string[] };
    const aim: { pick?: AimPick } = {};
    const submitted: { readonly ticket: number; readonly command: EngineCommandBase }[] = [];
    let flagType: PlacedFlagType = "WoodenSign1";
    const context: ToolContext = {
      pickTargets: () => (aim.pick === undefined ? [] : [aim.pick]),
      currentPick: () => aim.pick,
      aimYawRadians: () => 0,
      commandInFlight: () => submitted.length > 0,
      submit: (command) => void submitted.push({ ticket: scene.engine.submit("local", command), command }),
      getToolState: () => undefined,
      setToolState: () => undefined,
      endTool: () => void (log.ended += 1),
      selectObject: () => undefined,
      showObjectPage: () => undefined,
      chosenFlagType: () => flagType,
      read: scene.engine.read,
      query: (token) => scene.engine.query(token),
      showMessage: (message) => void log.messages.push(message),
    };
    function settle(): void {
      while (submitted.length > 0) {
        scene.engine.step(0);
        for (const entry of submitted.splice(0)) tool.onResult?.(context, scene.engine.resultOf(entry.ticket) as CommandResult);
        scene.engine.endFrame();
      }
    }
    function click(pick: AimPick | undefined): boolean {
      aim.pick = pick;
      return tool.onPrimaryAction(context);
    }
    return { ...scene, tool, context, log, submitted, settle, click, chooseFlagType: (next: PlacedFlagType) => void (flagType = next) };
  }

  it("places the chosen sign on the aimed floor and ends", () => {
    const { flags, click, settle, log, chooseFlagType } = toolSetup();
    chooseFlagType("WoodenSign2");

    expect(click(floorAt(1, 0.5))).toBe(true);
    settle();

    expect(flags()).toHaveLength(1);
    expect(flags()[0]).toMatchObject({ flagType: "WoodenSign2", localPose: { translation: { x: 1, y: 0.5, z: 0 } } });
    expect(log.ended).toBe(1);
  });

  it("does nothing for a second press during the wait", () => {
    const { flags, click, settle, submitted, log } = toolSetup();

    click(floorAt(1, 0.5));
    click(floorAt(-3, 0.5));
    expect(submitted).toHaveLength(1);
    settle();

    expect(flags()).toHaveLength(1);
    expect(log.ended).toBe(1);
  });

  it("asks nothing off the floor, or with nothing aimed at", () => {
    const { click, submitted } = toolSetup();

    expect(click({ ...floorAt(1, 0.5), objectKind: "geodesicEmitters/emitter", objectId: "e" })).toBe(true);
    expect(click(undefined)).toBe(true);

    expect(submitted).toEqual([]);
  });

  it("shows a refusal and stays", () => {
    const { flags, click, settle, log } = toolSetup();
    click(floorAt(1, 0.5));
    settle();

    click(floorAt(1.2, 0.5));
    settle();

    expect(log.messages).toEqual(["A sign cannot stand there."]);
    expect(log.ended).toBe(1);
    expect(flags()).toHaveLength(1);
  });

  it("takes every key typed before a tick, in order", () => {
    const { flags, click, settle, context } = toolSetup();
    click(floorAt(1, 0.5));
    settle();
    const flagId = flags()[0]!.id;

    requestFlagMessage(context, flagId, "A1X");
    requestFlagMessage(context, flagId, "A1XY");
    settle();

    expect(flags()[0]!.message).toBe("A1XY");
  });

  it("removes a sign right after a key, with both still in flight", () => {
    const { flags, click, settle, context, log } = toolSetup();
    click(floorAt(1, 0.5));
    settle();
    const flagId = flags()[0]!.id;

    requestFlagMessage(context, flagId, "A1X");
    requestFlagRemoval(context, flagId);
    settle();

    expect(flags()).toEqual([]);
    expect(log.messages).toEqual([]);
    expect(log.ended).toBe(1);
  });
});
