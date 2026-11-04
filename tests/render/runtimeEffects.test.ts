/**
 * `tests/render/runtimeEffects.test.ts` — unit tier.
 *
 * `createRuntimeEffects` routes each effect the reducer lists to the handle that does the work. These tests run effects against
 * recording stand-ins: palette and instance syncs, ending a tool session, a restart request going through `requestAppRestart`, a cannon
 * action, and the reload-confirmation timer, which dispatches an expiry once and is cancelled by `dispose`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { createRuntimeEffects, type RuntimeEffectsDeps } from "../../src/render/three/runtimeEffects";
import { createTestClientSession } from "../support/clientSession";

function createHarness() {
  const dispatched: RuntimeCommand[] = [];
  const calls = {
    syncDesktopPalette: vi.fn(),
    syncTieAndDetachSelectionHighlights: vi.fn(),
    clearProtractorToolFeedback: vi.fn(),
    requestRuntimeObjectInstanceSync: vi.fn(),
    requestAppRestart: vi.fn((restart: () => void) => restart()),
    addGeodesicToCannon: vi.fn(),
    onWorldChangeRequested: vi.fn(),
  };
  const noop = vi.fn();
  const deps: RuntimeEffectsDeps = {
    session: createTestClientSession(),
    dispatch: (command) => dispatched.push(command),
    host: { onWorldChangeRequested: calls.onWorldChangeRequested },
    syncDesktopPalette: calls.syncDesktopPalette,
    syncTieAndDetachSelectionHighlights: calls.syncTieAndDetachSelectionHighlights,
    clearProtractorToolFeedback: calls.clearProtractorToolFeedback,
    requestRuntimeObjectInstanceSync: calls.requestRuntimeObjectInstanceSync,
    applyMenuDebugState: noop,
    applyMenuComfortState: noop,
    requestAppRestart: calls.requestAppRestart,
    teleportPlayerHome: noop,
    addGeodesicToCannon: calls.addGeodesicToCannon,
    startGeodesicCannonCarry: noop,
    startGeodesicCannonTieAndDetach: noop,
    startGeodesicCannonRotation: noop,
    startGeodesicCannonAim: noop,
    deleteGeodesicFromCannon: noop,
    stepGeometryComputerPendingTarget: noop,
    startGeometryComputerDeformation: noop,
    appendEditingSignCharacter: noop,
    backspaceEditingSignMessage: noop,
    deleteEditingSign: noop,
  };
  return { effects: createRuntimeEffects(deps), dispatched, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createRuntimeEffects", () => {
  it("syncs the palette and the object instances", () => {
    const { effects, calls } = createHarness();

    effects.run({ kind: "sync-palette" });
    effects.run({ kind: "sync-object-instances" });

    expect(calls.syncDesktopPalette).toHaveBeenCalledTimes(1);
    expect(calls.requestRuntimeObjectInstanceSync).toHaveBeenCalledTimes(1);
  });

  it("clears both tool states and the feedback when a tool session ends", () => {
    const { effects, dispatched, calls } = createHarness();

    effects.run({ kind: "end-tool-session" });

    expect(dispatched).toEqual([
      { kind: "set-protractor-tool-state", state: {} },
      { kind: "set-cannon-tool-state", state: {} },
    ]);
    expect(calls.syncTieAndDetachSelectionHighlights).toHaveBeenCalledWith([]);
    expect(calls.clearProtractorToolFeedback).toHaveBeenCalledTimes(1);
  });

  it("asks for an app restart before telling the host about a world change", () => {
    const { effects, calls } = createHarness();

    effects.run({ kind: "change-world", worldId: "torus" });

    expect(calls.requestAppRestart).toHaveBeenCalledTimes(1);
    expect(calls.onWorldChangeRequested).toHaveBeenCalledWith("torus");
  });

  it("routes a cannon action to its handle", () => {
    const { effects, calls } = createHarness();

    effects.run({ kind: "add-geodesic-to-cannon", cannonId: "cannon-a" });

    expect(calls.addGeodesicToCannon).toHaveBeenCalledWith("cannon-a");
  });

  it("expires the reload confirmation once after its window", () => {
    vi.useFakeTimers();
    const { effects, dispatched } = createHarness();

    effects.run({ kind: "arm-reload-confirmation-timer", windowMs: 2000 });
    vi.advanceTimersByTime(2000);

    expect(dispatched.map((command) => command.kind)).toEqual(["expire-reload-confirmation"]);
  });

  it("cancels a pending reload confirmation on dispose", () => {
    vi.useFakeTimers();
    const { effects, dispatched } = createHarness();

    effects.run({ kind: "arm-reload-confirmation-timer", windowMs: 2000 });
    effects.dispose();
    vi.advanceTimersByTime(5000);

    expect(dispatched).toEqual([]);
  });
});
