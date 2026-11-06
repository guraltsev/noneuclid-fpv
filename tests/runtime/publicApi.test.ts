/**
 * `tests/runtime/publicApi.test.ts` — unit tier.
 *
 * The lifetime of a module's namespace of `window.noneuclid.api`: it is there while the app runs, and a restart leaves none of the old app's functions behind, also when the new app has other modules. `app`, which outlives the app, stays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(Object.keys(getPublicApi()).sort()).toEqual(["app", "geodesicModel"]);

    uninstall();
    expect(Object.keys(getPublicApi())).toEqual(["app"]);
  });

  it("leaves no stale namespace after a restart with another experience", () => {
    const first = { isAtRest: () => true };
    const second = { place: () => undefined };

    const uninstallFirst = installModuleApis(new Map([["curveShortening", first], ["shared", first]]));
    uninstallFirst();
    installModuleApis(new Map([["shared", second]]));

    expect(getPublicApi()).toEqual({ shared: second });
    expect(getPublicApi().shared).toBe(second);
  });
});
