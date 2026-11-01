/**
 * `tests/app/renderInspection.release.test.ts` — release tier.
 *
 * The debugging half of `window.noneuclid.api`: `debug.setPlayerPose(cellId, x, y, yawDegrees, pitchDegrees?)` puts the player somewhere
 * reproducible and `debug.playerPose()` reads it back; the `render` namespace (`recordSources`, `records`, `explainGhosts`, `instances`,
 * `explainInstances`; src/render/three/renderInspection.ts) answers what the last frame's instance sync did. The pure logic is tested in
 * `tests/render/renderInspection.test.ts`; this scenario covers the wiring in the real app: the functions exist, take their arguments and return plain data.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openApp, type ScenarioApp } from "../support/scenario/openApp";

interface PoseDump {
  readonly cellId: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
}

describe("debug.playerPose and the render inspection namespace", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("sets the player pose and reads it back, and rejects an unknown cell", async () => {
    app = await openApp({ world: "cube" });
    const api = app.api;

    const set = (await api.debug.setPlayerPose("front", 1.5, -2, 90, -10)) as PoseDump;
    expect(set).toEqual({ cellId: "front", position: { x: 1.5, y: -2, z: 0 }, yawDegrees: 90, pitchDegrees: -10 });

    const read = await api.waitFor(
      async () => (await api.debug.playerPose()) as PoseDump,
      (pose) => pose.position.x === 1.5,
    );
    expect(read).toEqual(set);

    await expect(api.debug.setPlayerPose("no-such-cell", 0, 0, 0)).rejects.toThrow(/no cell "no-such-cell"/);
  });

  it("answers the render questions with plain data once a frame has been synced", async () => {
    app = await openApp({ world: "cube" });
    const api = app.api;

    const sources = (await api.waitFor(
      async () => (await api.render.recordSources()) as readonly { source: string; records: number }[],
      (list) => list.some((entry) => entry.source === "player-rover"),
    ));
    expect(sources.find((entry) => entry.source === "player-rover")?.records).toBeGreaterThan(0);

    const roverRecords = (await api.render.records({ source: "player-rover" })) as { total: number; records: { objectId: string }[] };
    expect(roverRecords.total).toBeGreaterThan(0);

    const roverId = roverRecords.records[0].objectId;
    const ghosts = (await api.render.explainGhosts(roverId)) as { parts: { decision?: { copies: { outcome: string }[] } }[] };
    expect(ghosts.parts[0].decision?.copies[0].outcome).toBe("own");

    const instances = (await api.render.instances({ archetypePrefix: "player-avatar" })) as { count: number }[];
    expect(instances.length).toBeGreaterThan(0);

    const explained = (await api.render.explainInstances(roverId)) as { decisions: { outcome: string }[] };
    expect(explained.decisions.length).toBeGreaterThan(0);
  });
});
