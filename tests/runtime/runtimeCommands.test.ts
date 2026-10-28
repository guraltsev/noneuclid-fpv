import { describe, expect, it } from "vitest";
import {
  dispatchRuntimeCommand,
  type CreateAppCommandDispatcherOptions,
} from "../../src/runtime/appCommandDispatcher";

describe("runtimeCommands", () => {
  function createAdapters(): {
    readonly adapters: CreateAppCommandDispatcherOptions;
    readonly calls: {
      reloads: number;
      home: number;
      changedWorlds: string[];
      debugOverlay: boolean[];
    };
  } {
    const calls = {
      reloads: 0,
      home: 0,
      changedWorlds: [] as string[],
      debugOverlay: [] as boolean[],
    };

    return {
      calls,
      adapters: {
        reloadWorld() {
          calls.reloads += 1;
        },
        goHome() {
          calls.home += 1;
        },
        changeWorld(worldId) {
          calls.changedWorlds.push(worldId);
        },
        setDebugOverlayEnabled(enabled) {
          calls.debugOverlay.push(enabled);
        },
      },
    };
  }

  it("dispatches reload-world through the reload adapter", () => {
    const { adapters, calls } = createAdapters();

    dispatchRuntimeCommand({ kind: "reload-world" }, adapters);

    expect(calls.reloads).toBe(1);
  });

  it("dispatches go-home through the home adapter", () => {
    const { adapters, calls } = createAdapters();

    dispatchRuntimeCommand({ kind: "go-home" }, adapters);

    expect(calls.home).toBe(1);
  });

  it("dispatches change-world through the world-change adapter", () => {
    const { adapters, calls } = createAdapters();

    dispatchRuntimeCommand({ kind: "change-world", worldId: "tetrahedron" }, adapters);

    expect(calls.changedWorlds).toEqual(["tetrahedron"]);
  });

  it("dispatches debug overlay toggles through the debug adapter", () => {
    const { adapters, calls } = createAdapters();

    dispatchRuntimeCommand({ kind: "set-debug-overlay", enabled: false }, adapters);

    expect(calls.debugOverlay).toEqual([false]);
  });
});
