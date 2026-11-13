/**
 * `tests/render/geometryComputerMenu.test.ts` - unit tier.
 *
 * The shape machine's menu logic (src/render/three/geometryComputerMenu.ts) with a fake geometry session: presets, the number pad (digits, Back, Cancel, OK), the More row and the one-meter steps change only the pending target in the menu state;
 * the session's target changes only when Reshape world is pressed.
 */
import { describe, expect, it, vi } from "vitest";
import { createGeometryComputerMenu } from "../../src/render/three/geometryComputerMenu";
import { applyRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import type { GeometryComputerEdit, RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { createTestClientSession } from "../support/clientSession";

const torus = (skewXMeters: number, depthMeters: number) => ({ kind: "torus-skew" as const, widthMeters: 15, skewXMeters, depthMeters });

function setup() {
  const geometrySession = { state: { current: torus(0, 15), target: torus(0, 15), initial: torus(0, 15) }, setTarget: vi.fn() };
  const session = createTestClientSession();
  const syncDesktopPalette = vi.fn();
  const dispatch = (command: RuntimeCommand): void => {
    applyRuntimeCommand(session, command);
  };
  const menu = createGeometryComputerMenu({ geometrySession: geometrySession as never, session, dispatch, syncDesktopPalette });
  dispatch({ kind: "show-geometry-computer-actions", ...menu.createGeometryComputerMenuOptions("gc") });
  const edit = (change: GeometryComputerEdit): void => menu.editGeometryComputer("gc", change);
  const options = () => session.get().menuState.geometryComputerOptions;
  return { menu, edit, options, geometrySession, session, syncDesktopPalette };
}

describe("geometry computer menu edits", () => {
  it("sets a preset as the pending target without touching the session target", () => {
    const { edit, options, geometrySession } = setup();
    edit({ kind: "set-target", aMeters: 15, bMeters: 15 });
    expect(options()).toMatchObject({ targetSkewXMeters: 15, targetDepthMeters: 15 });
    expect(geometrySession.setTarget).not.toHaveBeenCalled();
  });

  it("types a value on the number pad and applies it with OK", () => {
    const { edit, options } = setup();
    edit({ kind: "open-entry", axis: "b" });
    expect(options()).toMatchObject({ entryAxis: "b", entryText: "" });
    edit({ kind: "entry-digit", digit: "2" });
    edit({ kind: "entry-digit", digit: "1" });
    edit({ kind: "entry-digit", digit: "7" });
    expect(options()?.entryText).toBe("21");
    edit({ kind: "entry-backspace" });
    expect(options()?.entryText).toBe("2");
    edit({ kind: "entry-digit", digit: "2" });
    edit({ kind: "entry-apply" });
    expect(options()).toMatchObject({ targetSkewXMeters: 0, targetDepthMeters: 22, entryAxis: undefined, entryText: undefined });
  });

  it("clamps a typed value to the range of its parameter", () => {
    const { edit, options } = setup();
    edit({ kind: "open-entry", axis: "a" });
    edit({ kind: "entry-digit", digit: "9" });
    edit({ kind: "entry-digit", digit: "9" });
    edit({ kind: "entry-apply" });
    expect(options()?.targetSkewXMeters).toBe(30);
  });

  it("cancels typing, ignores stray digits and an empty OK", () => {
    const { edit, options } = setup();
    edit({ kind: "entry-digit", digit: "5" });
    expect(options()?.entryText).toBeUndefined();
    edit({ kind: "open-entry", axis: "a" });
    edit({ kind: "entry-digit", digit: "x" });
    expect(options()?.entryText).toBe("");
    edit({ kind: "entry-apply" });
    expect(options()).toMatchObject({ entryAxis: undefined, targetSkewXMeters: 0 });
    edit({ kind: "open-entry", axis: "a" });
    edit({ kind: "entry-cancel" });
    expect(options()?.entryAxis).toBeUndefined();
  });

  it("ends typing when a step is pressed, and keeps the More row open across edits", () => {
    const { menu, edit, options } = setup();
    edit({ kind: "toggle-more" });
    expect(options()?.moreOpen).toBe(true);
    edit({ kind: "open-entry", axis: "a" });
    menu.stepGeometryComputerPendingTarget("gc", "a", 1);
    expect(options()).toMatchObject({ targetSkewXMeters: 1, entryAxis: undefined, moreOpen: true });
    edit({ kind: "toggle-more" });
    expect(options()?.moreOpen).toBe(false);
  });

  it("reshapes to the pending target only when Reshape world is pressed", () => {
    const { menu, edit, geometrySession } = setup();
    edit({ kind: "set-target", aMeters: 8, bMeters: 15 });
    menu.startGeometryComputerDeformation("gc");
    expect(geometrySession.setTarget).toHaveBeenCalledWith(expect.objectContaining({ skewXMeters: 8, depthMeters: 15 }));
  });
});
