/**
 * `tests/app/appCommands.release.test.ts` — release tier.
 *
 * `window.noneuclid.api`'s `app.changeWorld`, `app.changeConfig` and `app.reload` (`src/main.ts`) restart the
 * running app on the requested world or config, through the same runtime command path installed once at startup.
 * Each command returns before the new world has finished loading (`_docs/tests.md` §8.5), so these scenarios wait
 * — bounded by attempts, never wall-clock time — for `app.info()` to report the change; `changeConfig` and
 * `reload` also wait for the `debug` namespace to be reinstalled (every restart disposes and recreates the
 * per-run API namespaces; see `src/render/three/appDebugHelpers.ts`) — the one case `changeWorld` does not repeat
 * (`_docs/tests.md` §2.1). Covers the audit's check #29.
 */
import { afterEach, describe, expect, it } from "vitest";
import { openApp, type ScenarioApi, type ScenarioApp } from "../support/scenario/openApp";

interface AppInfo {
  readonly worldId: string;
  readonly configName: string;
}

/** True once the debug namespace responds again, false while it is still being torn down or rebuilt. */
async function debugNamespaceIsInstalled(api: ScenarioApi): Promise<boolean> {
  try {
    await api.debug.dumpLockedGeodesicWords();
    return true;
  } catch {
    return false;
  }
}

/** `app.changeWorld` eventually restarts the app on the requested world. */
async function changesWorld(api: ScenarioApi, worldId: string): Promise<void> {
  await api.app.changeWorld(worldId);

  // Only app.info() here: changeConfig and reload already cover "the debug namespace is reinstalled after a
  // restart" (the same check on every restart would be the same behaviour tested three times, tests.md §2.1).
  const info = await api.waitFor(
    () => api.app.info() as Promise<AppInfo>,
    (value) => value.worldId === worldId,
  );

  expect(info.worldId).toBe(worldId);
}

/** `app.changeConfig` eventually restarts the app on the requested config, with the debug namespace reinstalled. */
async function changesConfigAndReinstallsDebug(api: ScenarioApi, configName: string): Promise<void> {
  await api.app.changeConfig(configName);

  const result = await api.waitFor(
    async () => ({
      info: (await api.app.info()) as AppInfo,
      debugInstalled: await debugNamespaceIsInstalled(api),
    }),
    (value) => value.info.configName === configName && value.debugInstalled,
  );

  expect(result.info.configName).toBe(configName);
}

/** `app.reload` restarts the app on the same world and config, with the debug namespace reinstalled. */
async function reloadsOnTheSameWorldAndConfig(api: ScenarioApi): Promise<void> {
  const before = (await api.app.info()) as AppInfo;

  await api.app.reload();

  const result = await api.waitFor(
    async () => ({
      info: (await api.app.info()) as AppInfo,
      debugInstalled: await debugNamespaceIsInstalled(api),
    }),
    (value) => value.debugInstalled,
  );

  expect(result.info.worldId).toBe(before.worldId);
  expect(result.info.configName).toBe(before.configName);
}

describe("app commands restart the running app", () => {
  let app: ScenarioApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("changeWorld switches to the requested world", async () => {
    app = await openApp({ world: "cube" });
    await changesWorld(app.api, "001-basic-cube");
  });

  it("changeConfig switches to the requested config", async () => {
    app = await openApp({ config: "full" });
    await changesConfigAndReinstallsDebug(app.api, "001");
  });

  it("reload restarts the app without changing world or config", async () => {
    app = await openApp({ world: "cube", config: "full" });
    await reloadsOnTheSameWorldAndConfig(app.api);
  });
});
