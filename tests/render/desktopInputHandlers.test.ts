/**
 * `tests/render/desktopInputHandlers.test.ts` — unit tier.
 *
 * `createDesktopInputHandlers` turns DOM events and controller input into shell actions. These tests drive the handle with a
 * shell session and recording stand-ins: Escape toggles the menu through the palette toggle (and dismisses a pinned help when
 * there is nothing to toggle), a right click on the canvas opens the menu of the aimed object only and says so when nothing is aimed,
 * Tab cycles the focused target and the wheel steps the tool, both only while no menu is open, the input frames carry their source,
 * and the palette is fed from the desktop pointer.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createDesktopInputHandlers } from "../../src/render/three/desktopInputHandlers";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import type { RuntimeInputFrame } from "../../src/interaction/inputFrame";
import { createTestClientSession } from "../support/clientSession";
import { createTestToolsById } from "../support/tools";

const canvas = {};

function emptyFrame(): Omit<RuntimeInputFrame, "source"> {
  return {
    localDisplacement: { x: 0, y: 0, z: 0 },
    yawDeltaRadians: 0,
    pitchDeltaRadians: 0,
    resetRequested: false,
    primaryActionRequested: false,
    interactRequested: false,
    carryActionRequested: false,
    helpRequested: false,
  };
}

function createHarness(
  options: { readonly menuOpen?: boolean; readonly presenting?: boolean; readonly pinnedHelp?: boolean; readonly menuResult?: "closed" | "opened" | "nothing"; readonly xrSources?: readonly object[] } = {},
) {
  const session = createTestClientSession(
    options.menuOpen ? { menuState: { ...createRuntimeMenuState({ selectedWorldId: "test" }), isOpen: true } } : {},
  );
  const calls = {
    openContextMenu: vi.fn(() => options.menuResult ?? "opened"),
    showNotice: vi.fn(),
    stepTool: vi.fn(),
    toggle: vi.fn(),
    cycle: vi.fn(() => true),
    dismissHelp: vi.fn(() => options.pinnedHelp ?? false),
    lookMode: vi.fn(),
    paletteUpdate: vi.fn(),
    desktopPaletteInput: vi.fn(() => ({})),
    xrPaletteInput: vi.fn(() => ({})),
    handModels: vi.fn(),
    handUi: vi.fn((_frame: { readonly inputSources: readonly object[] }) => ({
      layout: "two-controllers" as const,
      paletteSources: [{ handedness: "right" }],
      pointerHandedness: "right" as const,
      toastAnchor: { kind: "wrist" as const, handedness: "left" as const },
    })),
  };
  const handlers = createDesktopInputHandlers({
    session,
    appConfig: defaultAppConfig,
    toolsById: createTestToolsById(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: canvas, xr: { isPresenting: options.presenting ?? false, getSession: () => (options.xrSources ? { inputSources: options.xrSources as never } : null) } },
    xrRig: { root: new THREE.Group() },
    controls: { setLookMode: calls.lookMode, consumeFrame: () => emptyFrame() as never, isPointerLocked: () => false },
    xrControls: { consumeFrame: () => emptyFrame() as never },
    scenePaletteController: { update: calls.paletteUpdate },
    desktopScenePaletteInput: { update: calls.desktopPaletteInput as never },
    xrScenePaletteInput: { update: calls.xrPaletteInput as never },
    xrControllerHandModels: { update: calls.handModels },
    xrHandUi: { update: calls.handUi as never },
    beltDefinition: () => ({ slots: [] }),
    resolveActiveRootAimRay: () => undefined,
    cycleFocusedAimTarget: calls.cycle,
    openContextMenuFromAim: calls.openContextMenu,
    showNotice: calls.showNotice,
    stepTool: calls.stepTool,
    applyDesktopScenePaletteToggle: calls.toggle,
    dismissHelpLensFocus: calls.dismissHelp,
  });
  return { handlers, calls };
}

function keyEvent(code: string) {
  return { code, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe("createDesktopInputHandlers", () => {
  it("opens the context menu on a right click on the canvas", () => {
    const { handlers, calls } = createHarness();
    const event = { button: 2, target: canvas, preventDefault: vi.fn() } as unknown as MouseEvent;

    handlers.onDesktopMouseDown(event);

    expect(calls.openContextMenu).toHaveBeenCalledTimes(1);
    expect(calls.openContextMenu).toHaveBeenCalledWith(undefined, { objectOnly: true });
    expect(calls.showNotice).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("says to aim at something when a right click finds no menu", () => {
    const { handlers, calls } = createHarness({ menuResult: "nothing" });

    handlers.onDesktopMouseDown({ button: 2, target: canvas, preventDefault: vi.fn() } as unknown as MouseEvent);

    expect(calls.showNotice).toHaveBeenCalledWith("Aim at something to open its menu");
  });

  it("ignores a left click, a click off the canvas, and any click in XR", () => {
    const desktop = createHarness();
    desktop.handlers.onDesktopMouseDown({ button: 0, target: canvas, preventDefault: vi.fn() } as unknown as MouseEvent);
    desktop.handlers.onDesktopMouseDown({ button: 2, target: {}, preventDefault: vi.fn() } as unknown as MouseEvent);
    const xr = createHarness({ presenting: true });
    xr.handlers.onDesktopMouseDown({ button: 2, target: canvas, preventDefault: vi.fn() } as unknown as MouseEvent);

    expect(desktop.calls.openContextMenu).not.toHaveBeenCalled();
    expect(xr.calls.openContextMenu).not.toHaveBeenCalled();
  });

  it("toggles the menu on Escape, closing it when open", () => {
    const { handlers, calls } = createHarness({ menuOpen: true });
    const event = keyEvent("Escape");

    handlers.onDesktopPaletteKeyDown(event);

    expect(calls.toggle).toHaveBeenCalledWith("close");
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("dismisses a pinned help on Escape when no menu is open", () => {
    const { handlers, calls } = createHarness({ pinnedHelp: true });
    const event = keyEvent("Escape");

    handlers.onDesktopPaletteKeyDown(event);

    expect(calls.dismissHelp).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("cycles the focused target on Tab only while no menu is open", () => {
    const closed = createHarness();
    closed.handlers.onDesktopPaletteKeyDown(keyEvent("Tab"));
    const open = createHarness({ menuOpen: true });
    open.handlers.onDesktopPaletteKeyDown(keyEvent("Tab"));

    expect(closed.calls.cycle).toHaveBeenCalledTimes(1);
    expect(open.calls.cycle).not.toHaveBeenCalled();
  });

  function wheel(deltaY: number, timeStamp: number) {
    return { target: canvas, deltaY, deltaMode: 0, timeStamp, preventDefault: vi.fn() } as unknown as WheelEvent;
  }

  it("steps the tool with the wheel, not the target, and only while no menu is open", () => {
    const closed = createHarness();
    closed.handlers.onDesktopWheel(wheel(100, 1000));
    closed.handlers.onDesktopWheel(wheel(-100, 2000));
    const open = createHarness({ menuOpen: true });
    open.handlers.onDesktopWheel(wheel(100, 1000));

    expect(closed.calls.stepTool.mock.calls).toEqual([[1], [-1]]);
    expect(closed.calls.cycle).not.toHaveBeenCalled();
    expect(open.calls.stepTool).not.toHaveBeenCalled();
  });

  it("takes one tool from a flick of small wheel events", () => {
    const { handlers, calls } = createHarness();
    for (let step = 0; step < 10; step += 1) handlers.onDesktopWheel(wheel(15, 1000 + step * 10));

    expect(calls.stepTool).toHaveBeenCalledTimes(1);
  });

  it("tags its input frames with their source and sets the palette look mode", () => {
    const closed = createHarness();
    const open = createHarness({ menuOpen: true });

    expect(closed.handlers.getDesktopInputFrame(0.016).source).toBe("desktop");
    expect(open.handlers.getDesktopInputFrame(0.016).source).toBe("desktop");
    expect(closed.calls.lookMode).toHaveBeenCalledWith("camera");
    expect(open.calls.lookMode).toHaveBeenCalledWith("palette");
    expect(closed.handlers.getXrInputFrame(0.016)).toMatchObject({ source: "xr", primaryActionRequested: false });
  });

  it("feeds the palette from the desktop pointer when XR is not active", () => {
    const { handlers, calls } = createHarness();

    handlers.updateScenePalette(false, undefined, null, undefined, 0.016, { ...emptyFrame(), source: "desktop" });

    expect(calls.desktopPaletteInput).toHaveBeenCalledTimes(1);
    expect(calls.paletteUpdate).toHaveBeenCalledTimes(1);
  });

  it("feeds the XR palette the pointer hand only, and the hand models the toast anchor", () => {
    const left = { handedness: "left" };
    const right = { handedness: "right" };
    const { handlers, calls } = createHarness({ presenting: true, xrSources: [left, right] });
    const xrFrame = { getPose: () => undefined } as unknown as XRFrame;

    handlers.updateScenePalette(true, xrFrame, {} as XRReferenceSpace, undefined, 0.016, { ...emptyFrame(), source: "xr" });

    expect(calls.handUi).toHaveBeenCalledTimes(1);
    expect(calls.handUi.mock.calls[0][0].inputSources).toEqual([left, right]);
    expect(calls.xrPaletteInput).toHaveBeenCalledWith(expect.objectContaining({ inputSources: [{ handedness: "right" }] }));
    expect(calls.handModels).toHaveBeenCalledWith(expect.objectContaining({ pointerHandedness: "right", toastAnchor: { kind: "wrist", handedness: "left" } }));
    expect(calls.desktopPaletteInput).not.toHaveBeenCalled();
  });
});

