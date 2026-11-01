/**
 * `tests/app/appLoading.release.test.ts` — release tier.
 *
 * Every app config the catalog ships (`full`, `001`, `002`, `default`; `src/glue/appConfig.ts`) loads the built
 * site end to end: the loading screen goes away and the debug namespace is installed (the scenario runner's
 * "loaded" condition, `tests/support/scenario/openApp.ts`), and `window.noneuclid.api`'s `app.info()` reports the
 * config that was requested and a world id. Covers the audit's checks #1 (the deployed site opens and resolves a
 * config) and #30 (`?config=...` loads) as far as today's API observes them; nothing yet reads whether the config's
 * menu sections behave as configured (`_docs/tests.md` §8.5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { openApp, type ScenarioApi, type ScenarioApp } from "../support/scenario/openApp";

interface AppInfo {
  readonly worldId: string;
  readonly configName: string;
  readonly userAgent: string;
  readonly xrPresenting: boolean;
}

/** `app.info()` reports the config name it was asked to load and a non-empty world id. */
async function reportsTheRequestedConfig(api: ScenarioApi, configName: string): Promise<void> {
  const info = (await api.app.info()) as AppInfo;
  expect(info.configName).toBe(configName);
  expect(typeof info.worldId).toBe("string");
  expect(info.worldId.length).toBeGreaterThan(0);
}

describe("the app loads under every shipped config", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each(["full", "001", "002", "default"])('loads config "%s" and reports it from app.info()', async (configName) => {
    app = await openApp({ config: configName });
    await reportsTheRequestedConfig(app.api, configName);
  });
});
