/**
 * `tests/app/worldEngine.release.test.ts` — release tier.
 *
 * `window.noneuclid.api.world` (design 013) in the built app: `participants()` lists the local player, whose body is where `debug.playerPose()` says the player is, and `submit(command)` resolves with the world's answer after the next step: a tool request is accepted in a world that enables the tool, and an unknown command is refused with a code.
 * The geodesic model is part of the app's experience too: its tie command answers with its refusal code (tying two arcs needs emitters and arcs, which the public API cannot create yet, so the flow that follows a tie is covered at the unit tier, `tests/modules/curveShortening/`). The carry module is part of the app's experience: its commands answer (a pickup of what is not there is refused with `carry/notCarriable`, a detach with nothing carried is accepted, the module-only drop is refused to a client). Carrying an emitter through a portal needs API calls that place an emitter and move the hand, which the public API does not have yet; that path is covered at the unit tier (`tests/modules/carry.test.ts`, `tests/render/geodesicCannonCarry.test.ts`).
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

    expect(await app.api.world.submit({ kind: "world/requestTool", toolId: "protractor" })).toEqual({ ok: true, value: { toolId: "protractor" } });
    expect(await app.api.world.submit({ kind: "nothing/here" })).toMatchObject({ ok: false, refusal: { code: "world/unknownCommand" } });
  });

  it("answers the carry commands of the experience's carry module", async () => {
    app = await openApp({ world: "cube" });

    expect(await app.api.world.submit({ kind: "carry/attach", objectId: "no-such-object" })).toMatchObject({ ok: false, refusal: { code: "carry/notCarriable" } });
    expect(await app.api.world.submit({ kind: "carry/detach" })).toEqual({ ok: true });
    expect(await app.api.world.submit({ kind: "carry/drop", participantId: "local", reason: "leash" })).toMatchObject({ ok: false, refusal: { code: "world/moduleOnly" } });
    const participants = (await app.api.world.participants()) as { id: string; attachments: unknown[] }[];
    expect(participants[0]!.attachments).toEqual([]);
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
