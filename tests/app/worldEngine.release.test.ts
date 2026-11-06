/**
 * `tests/app/worldEngine.release.test.ts` — release tier.
 *
 * `window.noneuclid.api.world` (design 013) in the built app: `participants()` lists the local player, whose body is where `debug.playerPose()` says the player is, and `submit(command)` resolves with the world's answer after the next step: a tool request is accepted in a world that enables the tool, and an unknown command is refused with a code.
 * The emitters are part of the app's experience: their commands create and remove an emitter and a geodesic in the running app.
 * The geodesic model is part of the app's experience too: its tie command answers with its refusal code. The carry module is part of the app's experience: its commands answer (a pickup of what is not there is refused with `carry/notCarriable`, a detach with nothing carried is accepted, the module-only drop is refused to a client). A tie, the flow after it and a carry through a portal are `tests/app/moduleApi.release.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openApp, type ScenarioApp } from "../support/scenario/openApp";

describe("api.world", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("lists the local player and answers submitted commands", async () => {
    app = await openApp({ world: "cube" });

    const participants = (await app.api.world.participants()) as { id: string; kind: string; body: { cellId: string } }[];
    const pose = (await app.api.debug.playerPose()) as { cellId: string };
    expect(participants.map((participant) => [participant.id, participant.kind])).toEqual([["local", "local-player"]]);
    expect(participants[0]!.body.cellId).toBe(pose.cellId);

    expect(await app.api.world.submit({ kind: "world/requestTool", toolId: "geodesicMeasurements/protractor" })).toEqual({ ok: true, value: { toolId: "geodesicMeasurements/protractor" } });
    expect(await app.api.world.submit({ kind: "nothing/here" })).toMatchObject({ ok: false, refusal: { code: "world/unknownCommand" } });
  });

  it("answers the carry commands of the experience's carry module", async () => {
    app = await openApp({ world: "cube" });

    expect(await app.api.world.submit({ kind: "carry/attach", objectId: "no-such-object" })).toMatchObject({ ok: false, refusal: { code: "carry/notCarriable" } });
    expect(await app.api.world.submit({ kind: "carry/detach" })).toEqual({ ok: true });
    expect(await app.api.world.submit({ kind: "geodesicEmitters/lift", emitterId: "missing" })).toMatchObject({ ok: false, refusal: { code: "world/moduleOnly" } });
    const participants = (await app.api.world.participants()) as { id: string; attachments: unknown[] }[];
    expect(participants[0]!.attachments).toEqual([]);
  });

  it("places an emitter, shoots from it, extends and deletes through the world commands", async () => {
    app = await openApp({ world: "cube" });
    const pose = (await app.api.debug.playerPose()) as { cellId: string; position: { x: number; y: number } };

    const placed = (await app.api.world.submit({
      kind: "geodesicEmitters/place",
      cellId: pose.cellId,
      point: { x: pose.position.x + 1, y: pose.position.y, z: 0 },
      yawRadians: 0,
    })) as { ok: boolean; value: { emitterId: string; arcIds: readonly string[] } };
    expect(placed).toMatchObject({ ok: true, value: { outcome: "placed", arcIds: [] } });
    expect(placed.value.emitterId).toMatch(/^geodesicEmitters\/emitter:\d+$/);

    const emitterId = placed.value.emitterId;
    const shot = (await app.api.world.submit({ kind: "geodesicEmitters/shoot", emitterId, yawRadians: Math.PI / 2, lengthMeters: 0.5 })) as { ok: boolean; value: { arcId: string } };
    expect(shot).toMatchObject({ ok: true, value: { outcome: "shot", emitterId } });
    expect(shot.value.arcId).toMatch(/^geodesicModel\/arc:\d+$/);

    const arcId = shot.value.arcId;
    expect(await app.api.world.submit({ kind: "geodesicEmitters/extend", arcId, lengthMeters: 0.5 })).toEqual({ ok: true, value: { outcome: "extended", emitterId, arcId } });
    expect(await app.api.world.submit({ kind: "geodesicEmitters/deleteGeodesic", emitterId, arcId })).toEqual({ ok: true, value: { outcome: "geodesicDeleted", emitterId, arcId } });
    expect(await app.api.world.submit({ kind: "geodesicEmitters/remove", emitterId: "no-such-emitter" })).toMatchObject({ ok: false, refusal: { code: "geodesicEmitters/notAnEmitter" } });
    expect(await app.api.world.submit({ kind: "geodesicEmitters/remove", emitterId })).toEqual({ ok: true, value: { outcome: "removed", emitterId, arcIds: [] } });
  });

  it("measures a geodesic and places a sign through the world commands, in the running app", async () => {
    app = await openApp({ world: "cube" });
    const pose = (await app.api.debug.playerPose()) as { cellId: string; position: { x: number; y: number } };
    const point = { x: pose.position.x + 1, y: pose.position.y, z: 0 };

    const placed = (await app.api.world.submit({ kind: "geodesicEmitters/place", cellId: pose.cellId, point, yawRadians: 0 })) as { value: { emitterId: string } };
    const shot = (await app.api.world.submit({ kind: "geodesicEmitters/shoot", emitterId: placed.value.emitterId, yawRadians: Math.PI / 2, lengthMeters: 0.5 })) as { value: { arcId: string } };

    const length = (await app.api.world.submit({ kind: "geodesicMeasurements/createLength", arcId: shot.value.arcId })) as { ok: boolean; value: { id: string } };
    expect(length).toMatchObject({ ok: true, value: { outcome: "lengthCreated" } });
    expect(length.value.id).toMatch(/^geodesicMeasurements\/length:\d+$/);
    expect(await app.api.world.submit({ kind: "geodesicMeasurements/removeLength", lengthId: length.value.id })).toMatchObject({ ok: true });
    expect(await app.api.world.submit({ kind: "geodesicMeasurements/removeLength", lengthId: length.value.id })).toMatchObject({ ok: false, refusal: { code: "geodesicMeasurements/notALength" } });
    expect(await app.api.world.submit({ kind: "geodesicMeasurements/removeAngle", angleId: "no-such-angle" })).toMatchObject({ ok: false, refusal: { code: "geodesicMeasurements/notAnAngle" } });

    const sign = (await app.api.world.submit({
      kind: "placedFlags/place",
      cellId: pose.cellId,
      point: { x: pose.position.x - 1, y: pose.position.y, z: 0 },
      eyePoint: { x: pose.position.x, y: pose.position.y, z: 1.6 },
      flagType: "WoodenSign1",
    })) as { ok: boolean; value: { flagId: string } };
    expect(sign).toMatchObject({ ok: true, value: { outcome: "placed" } });
    expect(sign.value.flagId).toMatch(/^placedFlags\/flag:\d+$/);
    const { flagId } = sign.value;
    expect(await app.api.world.submit({ kind: "placedFlags/setMessage", flagId, message: "HELLO" })).toEqual({ ok: true, value: { outcome: "messageSet", flagId } });
    expect(await app.api.world.submit({ kind: "placedFlags/remove", flagId })).toEqual({ ok: true, value: { outcome: "removed", flagId } });
    expect(await app.api.world.submit({ kind: "placedFlags/remove", flagId })).toMatchObject({ ok: false, refusal: { code: "placedFlags/notAFlag" } });
  });

  it("refuses a tie at an object that is no emitter, with the model's code", async () => {
    app = await openApp({ world: "torus-moduli" });

    const end = { geodesicId: "no-such-arc", role: "end", anchorObjectId: "no-such-emitter" };
    expect(await app.api.world.submit({ kind: "geodesicModel/tieAndDetach", emitterId: "no-such-emitter", first: end, second: { ...end, role: "start" } })).toMatchObject({
      ok: false,
      refusal: { code: "geodesicModel/notAnEmitter" },
    });
  });
});
