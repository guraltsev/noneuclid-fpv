import { describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import { createPaletteDefinitionCache } from "../../src/ui/paletteDefinition";

const createInitialRuntimeMenuState = () => createRuntimeMenuState({ selectedWorldId: "cube" });

describe("createPaletteDefinitionCache", () => {
  it("returns the same definition and version for the same state, mode and clock flag", () => {
    const cache = createPaletteDefinitionCache(defaultAppConfig);
    const state = createInitialRuntimeMenuState();
    const first = cache.get(state, "desktop", 0);
    const second = cache.get(state, "desktop", 5);

    expect(second.version).toBe(first.version);
    expect(second.definition).toBe(first.definition);
  });

  it("bumps the version for a new state object or a different input mode", () => {
    const cache = createPaletteDefinitionCache(defaultAppConfig);
    const state = createInitialRuntimeMenuState();
    const first = cache.get(state, "desktop", 0);
    const second = cache.get({ ...state }, "desktop", 0);
    const third = cache.get({ ...state }, "xr", 0);

    expect(second.version).toBe(first.version + 1);
    expect(third.version).toBe(second.version + 1);
  });

  it("rebuilds when the reload confirmation expires for the same state object", () => {
    const cache = createPaletteDefinitionCache(defaultAppConfig);
    const state = { ...createInitialRuntimeMenuState(), reloadConfirmUntilMs: 1000 };
    const active = cache.get(state, "desktop", 500);
    const expired = cache.get(state, "desktop", 1500);

    expect(active.definition.reloadConfirmationActive).toBe(true);
    expect(expired.version).toBe(active.version + 1);
    expect(expired.definition.reloadConfirmationActive).toBe(false);
  });
});
