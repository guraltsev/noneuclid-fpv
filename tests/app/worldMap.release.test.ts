/**
 * `tests/app/worldMap.release.test.ts` — release tier.
 *
 * The map tool in the built app: the world agrees to it on a solid and refuses it on a torus, whatever the app config says, because a torus has no map. This is the one check that the app hands the world's own surface to the tool's gate; `tests/modules/worldMap.test.ts` covers the decision itself and `tests/render/worldMapRenderer.test.ts` the map.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openApp, type ScenarioApp } from "../support/scenario/openApp";

const requestMap = { kind: "world/requestTool", toolId: "worldMap/map" };

describe("the map tool in the app", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("is available on a solid", async () => {
    app = await openApp({ world: "dodecahedron", config: "full" });
    expect(await app.api.world.submit(requestMap)).toMatchObject({ ok: true });
  });

  it("is refused on a torus", async () => {
    app = await openApp({ world: "torus", config: "full" });
    expect(await app.api.world.submit(requestMap)).toMatchObject({ ok: false, refusal: { code: "world/toolDisabled" } });
  });
});
