/**
 * `tests/app/worldEngine.release.test.ts` — release tier.
 *
 * `window.noneuclid.api.world` (design 013) in the built app: `participants()` lists the local player, whose body is where `debug.playerPose()` says the player is, and `submit(command)` resolves with the world's answer after the next step: a tool request is accepted in a world that enables the tool, and an unknown command is refused with a code.
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
});
