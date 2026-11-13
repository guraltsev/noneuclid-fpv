/**
 * The world's demonstration (src/render/three/worldDemo.ts): a laser, its beam, a ruler measurement of the beam and a
 * sign, made by the modules' ordinary commands. These tests give it a scripted `submit` that answers like the modules
 * and check the commands it sends and their order, that a tool the configuration switches off leaves its part out, and
 * that a refusal ends the part it belongs to without throwing.
 */
import { describe, expect, it } from "vitest";
import type { CommandResult, EngineCommandBase } from "../../src/engine/moduleTypes";
import type { WorldDemoSpec } from "../../src/cell-complex/specs";
import { runWorldDemo } from "../../src/render/three/worldDemo";

const demo: WorldDemoSpec = {
  cellId: "room",
  laser: { position: { x: 1, y: 2, z: 0 }, yawRadians: 3, beamLengthMeters: 12 },
  ruler: true,
  sign: { position: { x: -1, y: 1, z: 0 }, text: "Start" },
};
const viewer = { x: 0, y: 5, z: 0 };

function answering(replies: Readonly<Record<string, CommandResult>>) {
  const sent: EngineCommandBase[] = [];
  return {
    sent,
    submit: async (command: EngineCommandBase): Promise<CommandResult> => {
      sent.push(command);
      return replies[command.kind] ?? { ok: true, value: {} };
    },
  };
}

const placed: CommandResult = { ok: true, value: { outcome: "placed", emitterId: "L1", arcIds: [] } };
const shot: CommandResult = { ok: true, value: { outcome: "shot", emitterId: "L1", arcId: "A1" } };
const flag: CommandResult = { ok: true, value: { outcome: "placed", flagId: "S1" } };

describe("runWorldDemo", () => {
  it("places the laser, shoots the beam, measures it and puts up the sign with its text", async () => {
    const { sent, submit } = answering({ "geodesicEmitters/place": placed, "geodesicEmitters/shoot": shot, "placedFlags/place": flag });

    await runWorldDemo(demo, { submit, isToolEnabled: () => true, viewerPoint: viewer });

    expect(sent).toEqual([
      { kind: "geodesicEmitters/place", cellId: "room", point: { x: 1, y: 2, z: 0 }, yawRadians: 3 },
      { kind: "geodesicEmitters/shoot", emitterId: "L1", yawRadians: 3, lengthMeters: 12 },
      { kind: "geodesicMeasurements/createLength", arcId: "A1" },
      { kind: "placedFlags/place", cellId: "room", point: { x: -1, y: 1, z: 0 }, eyePoint: viewer, flagType: "WoodenSign1" },
      { kind: "placedFlags/setMessage", flagId: "S1", message: "Start" },
    ]);
  });

  it("leaves out the part whose tool the configuration switches off", async () => {
    const noRuler = answering({ "geodesicEmitters/place": placed, "geodesicEmitters/shoot": shot, "placedFlags/place": flag });
    await runWorldDemo(demo, { submit: noRuler.submit, isToolEnabled: (toolId) => toolId !== "geodesicMeasurements/length", viewerPoint: viewer });
    expect(noRuler.sent.map((command) => command.kind)).toEqual(["geodesicEmitters/place", "geodesicEmitters/shoot", "placedFlags/place", "placedFlags/setMessage"]);

    const onlySign = answering({ "placedFlags/place": flag });
    await runWorldDemo(demo, { submit: onlySign.submit, isToolEnabled: (toolId) => toolId === "placedFlags/flag", viewerPoint: viewer });
    expect(onlySign.sent.map((command) => command.kind)).toEqual(["placedFlags/place", "placedFlags/setMessage"]);
  });

  it("stops the beam's part at a refusal, and still puts up the sign", async () => {
    const refused: CommandResult = { ok: false, refusal: { code: "geodesicEmitters/blocked", message: "No." } };
    const { sent, submit } = answering({ "geodesicEmitters/place": refused, "placedFlags/place": flag });

    await runWorldDemo(demo, { submit, isToolEnabled: () => true, viewerPoint: viewer });

    expect(sent.map((command) => command.kind)).toEqual(["geodesicEmitters/place", "placedFlags/place", "placedFlags/setMessage"]);
  });

  it("makes no ruler without one asked for, and no sign without one declared", async () => {
    const { sent, submit } = answering({ "geodesicEmitters/place": placed, "geodesicEmitters/shoot": shot });

    await runWorldDemo({ ...demo, ruler: false, sign: undefined }, { submit, isToolEnabled: () => true, viewerPoint: viewer });

    expect(sent.map((command) => command.kind)).toEqual(["geodesicEmitters/place", "geodesicEmitters/shoot"]);
  });
});
