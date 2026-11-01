/**
 * `tests/render/scenePaletteCommands.test.ts` — unit tier.
 *
 * `createScenePaletteCommands` maps each palette action to the command it stands for. These tests press a sample of the
 * callbacks and check the command that reaches `dispatch`: opening and closing the menu, picking a world, the two-step reload,
 * a cannon action with its geodesic, and the sign keyboard.
 */
import { describe, expect, it, vi } from "vitest";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { createScenePaletteCommands } from "../../src/render/three/scenePaletteCommands";

function createHarness() {
  const dispatched: RuntimeCommand[] = [];
  const commands = createScenePaletteCommands({
    dispatch: (command) => dispatched.push(command),
    reloadConfirmationWindowMs: 2000,
  });
  return { commands, dispatched };
}

describe("createScenePaletteCommands", () => {
  it("opens and closes the menu through the command path", () => {
    const { commands, dispatched } = createHarness();

    commands.onOpenRequested();
    commands.onCloseRequested();

    expect(dispatched).toEqual([{ kind: "open-menu" }, { kind: "cancel-menu-and-tool" }]);
  });

  it("selects a world and a tool by id", () => {
    const { commands, dispatched } = createHarness();

    commands.onWorldSelected("torus");
    commands.onToolSelected("protractor");

    expect(dispatched).toEqual([
      { kind: "select-world", worldId: "torus" },
      { kind: "select-tool", toolId: "protractor" },
    ]);
  });

  it("presses reload with the clock time and the confirmation window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(12_345);
    const { commands, dispatched } = createHarness();

    commands.onReloadRequested();
    vi.useRealTimers();

    expect(dispatched).toEqual([{ kind: "press-reload", nowMs: 12_345, windowMs: 2000 }]);
  });

  it("forwards a cannon action with its cannon and geodesic ids", () => {
    const { commands, dispatched } = createHarness();

    commands.onGeodesicCannonAimRequested("cannon-a", "g-1");

    expect(dispatched).toEqual([{ kind: "start-cannon-aim", cannonId: "cannon-a", geodesicId: "g-1" }]);
  });

  it("forwards the sign keyboard keys", () => {
    const { commands, dispatched } = createHarness();

    commands.onSignKeyboardCharacter("A");
    commands.onSignKeyboardBackspace();
    commands.onSignDeleteRequested();

    expect(dispatched).toEqual([
      { kind: "type-sign-character", character: "A" },
      { kind: "backspace-sign" },
      { kind: "delete-sign" },
    ]);
  });
});
