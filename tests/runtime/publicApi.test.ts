/**
 * `tests/runtime/publicApi.test.ts` — unit tier.
 *
 * The lifetime of a module's namespace of `window.noneuclid.api`: it is there while the app runs, and a restart leaves none of the old app's functions behind, also when the new app has other modules. `app`, which outlives the app, stays, and so does the API's own `help`, which lists what is there (also as a `call help` over the debug channels).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callApi } from "../../src/runtime/apiCall";
import { getPublicApi, installModuleApis, setApiNamespace } from "../../src/runtime/publicApi";

beforeEach(() => {
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installModuleApis", () => {
  it("installs each module under its id and removes it again, leaving the rest", () => {
    setApiNamespace("app", { info: () => "app" });

    const uninstall = installModuleApis(new Map([["geodesicModel", { arcsOfCurve: () => [] }]]));
    expect(Object.keys(getPublicApi()).sort()).toEqual(["app", "geodesicModel", "help"]);

    uninstall();
    expect(Object.keys(getPublicApi()).sort()).toEqual(["app", "help"]);
  });

  it("leaves no stale namespace after a restart with another experience", () => {
    const first = { isAtRest: () => true };
    const second = { place: () => undefined };

    const uninstallFirst = installModuleApis(new Map([["curveShortening", first], ["shared", first]]));
    uninstallFirst();
    installModuleApis(new Map([["shared", second]]));

    expect(Object.keys(getPublicApi()).sort()).toEqual(["help", "shared"]);
    expect(getPublicApi().shared).toBe(second);
  });
});

describe("help", () => {
  it("lists the functions, narrowed to a namespace or a function, callable by path", async () => {
    setApiNamespace("app", { info: () => "app", reload: () => undefined });
    setApiNamespace("motion", { run: () => undefined, stop: () => undefined });

    expect(await callApi(getPublicApi(), ["help"], [])).toEqual({ "": ["help"], app: ["info", "reload"], motion: ["run", "stop"] });
    expect(await callApi(getPublicApi(), ["help"], ["motion"])).toEqual({ motion: ["run", "stop"] });
    expect(await callApi(getPublicApi(), ["help"], ["motion.stop"])).toEqual({ motion: ["stop"] });
    await expect(callApi(getPublicApi(), ["help"], ["nothing"])).rejects.toThrow(/no API namespace or function "nothing"/);
  });
});
