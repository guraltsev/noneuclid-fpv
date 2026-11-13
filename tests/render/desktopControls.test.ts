/**
 * Desktop keyboard and pointer-lock mouse input (src/render/three/desktopControls.ts): accumulates events between
 * frames into one `DesktopInputFrame` per `consumeFrame` call. In palette look mode the mouse drives the palette
 * cursor instead of the camera, clicks select rather than fire, and movement is disabled; editable DOM targets
 * (input, textarea, select, contenteditable) are ignored; window blur clears held keys and buttons; `dispose()`
 * removes every listener.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopControls } from "../../src/render/three/desktopControls";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktopControls", () => {
  it("does not convert right-click release into a palette select", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);
    controls.setLookMode("palette");

    dispatchMouse(windowTarget, "mousedown", 2);
    dispatchMouse(canvas, "click", 2);
    dispatchMouse(windowTarget, "mouseup", 2);

    const frame = controls.consumeFrame(1 / 60);

    expect(frame.paletteSelectPressed).toBe(false);
    expect(frame.paletteSelectRequested).toBe(false);
    expect(frame.primaryActionRequested).toBe(false);

    controls.dispose();
  });

  it("maps left-click to palette select while in palette look mode", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);
    controls.setLookMode("palette");

    dispatchMouse(windowTarget, "mousedown", 0);
    dispatchMouse(canvas, "click", 0);

    const frame = controls.consumeFrame(1 / 60);

    expect(frame.paletteSelectPressed).toBe(true);
    expect(frame.paletteSelectRequested).toBe(true);
    expect(frame.primaryActionRequested).toBe(false);

    controls.dispose();
  });

  it("does not convert the trailing click from a palette selection into a world primary action", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);
    controls.setLookMode("palette");

    dispatchMouse(windowTarget, "mousedown", 0);
    controls.setLookMode("camera");
    dispatchMouse(windowTarget, "mouseup", 0);
    dispatchMouse(canvas, "click", 0);

    const frameAfterPaletteSelection = controls.consumeFrame(1 / 60);

    expect(frameAfterPaletteSelection.primaryActionRequested).toBe(false);

    dispatchMouse(canvas, "click", 0);
    const frameAfterWorldClick = controls.consumeFrame(1 / 60);

    expect(frameAfterWorldClick.primaryActionRequested).toBe(true);

    controls.dispose();
  });

  it("maps G to a carry action while in camera look mode", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "KeyG");
    const frame = controls.consumeFrame(1 / 60);
    const nextFrame = controls.consumeFrame(1 / 60);

    expect(frame.carryActionRequested).toBe(true);
    expect(nextFrame.carryActionRequested).toBe(false);

    controls.dispose();
  });

  it("maps H to a help action edge", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "KeyH");
    const frame = controls.consumeFrame(1 / 60);
    const nextFrame = controls.consumeFrame(1 / 60);

    expect(frame.helpRequested).toBe(true);
    expect(nextFrame.helpRequested).toBe(false);

    controls.dispose();
  });

  it("maps 0 to a hand edge that puts the tool away", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "Digit0");
    const frame = controls.consumeFrame(1 / 60);
    const nextFrame = controls.consumeFrame(1 / 60);

    expect(frame.handRequested).toBe(true);
    expect(nextFrame.handRequested).toBe(false);

    controls.dispose();
  });

  it("maps the number keys 1 to 5 and the numpad to a one-frame belt key", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "Digit2");
    const first = controls.consumeFrame(1 / 60);
    dispatchKey(windowTarget, "keydown", "Numpad5");
    const second = controls.consumeFrame(1 / 60);
    dispatchKey(windowTarget, "keydown", "Digit6");
    const third = controls.consumeFrame(1 / 60);

    expect(first.toolKeyRequested).toBe("2");
    expect(second.toolKeyRequested).toBe("5");
    expect(third.toolKeyRequested).toBeUndefined();

    controls.dispose();
  });

  it("clears held keys when the window loses focus", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "KeyW");
    expect(controls.consumeFrame(1).localDisplacement.y).toBeGreaterThan(0);

    windowTarget.dispatchEvent(new Event("blur"));
    expect(controls.consumeFrame(1).localDisplacement.y).toBe(0);

    controls.dispose();
    dispatchKey(windowTarget, "keydown", "KeyW");
    windowTarget.dispatchEvent(new Event("blur"));
    // Listeners are removed: the key press after dispose is not tracked either.
    expect(controls.consumeFrame(1).localDisplacement.y).toBe(0);
  });

  it("ignores gameplay keys targeted at editable elements without preventing default", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
      const event = new Event("keydown", { cancelable: true }) as Event & { code: string };
      event.code = "KeyW";
      Object.defineProperty(event, "target", { value: target });
      windowTarget.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(controls.consumeFrame(1).localDisplacement.y).toBe(0);

    const canvasEvent = new Event("keydown", { cancelable: true }) as Event & { code: string };
    canvasEvent.code = "KeyW";
    Object.defineProperty(canvasEvent, "target", { value: { tagName: "CANVAS" } });
    windowTarget.dispatchEvent(canvasEvent);
    expect(canvasEvent.defaultPrevented).toBe(true);
    expect(controls.consumeFrame(1).localDisplacement.y).toBeGreaterThan(0);

    controls.dispose();
  });
});

describe("desktopControls hold-to-reset", () => {
  it("fires no reset at 1499 ms and one reset at 1500 ms of holding R", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "KeyR");
    expect(controls.consumeFrame(1.499).resetRequested).toBe(false);
    expect(controls.resetHoldProgress).toBeGreaterThan(0.99);
    expect(controls.consumeFrame(0.001).resetRequested).toBe(true);
    // The same hold never fires twice, and its ring is gone.
    expect(controls.consumeFrame(1).resetRequested).toBe(false);
    expect(controls.resetHoldProgress).toBe(0);

    controls.dispose();
  });

  it("does nothing for a short press and restarts the hold after a release", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "KeyR");
    expect(controls.consumeFrame(1).resetRequested).toBe(false);
    expect(controls.resetHoldProgress).toBeCloseTo(1 / 1.5, 6);
    dispatchKey(windowTarget, "keyup", "KeyR");
    expect(controls.resetHoldProgress).toBe(0);
    expect(controls.consumeFrame(5).resetRequested).toBe(false);

    dispatchKey(windowTarget, "keydown", "KeyR");
    expect(controls.consumeFrame(1).resetRequested).toBe(false);
    expect(controls.consumeFrame(0.5).resetRequested).toBe(true);

    controls.dispose();
  });

  it("reports U as a one-shot undo request", () => {
    const { canvas, windowTarget } = installPointerLockDom();
    const controls = createDesktopControls(canvas);

    dispatchKey(windowTarget, "keydown", "KeyU");
    expect(controls.consumeFrame(1 / 60).undoRequested).toBe(true);
    expect(controls.consumeFrame(1 / 60).undoRequested).toBe(false);

    controls.dispose();
  });
});

function installPointerLockDom(): {
  readonly canvas: HTMLCanvasElement;
  readonly windowTarget: EventTarget;
} {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget() as EventTarget & {
    pointerLockElement: Element | null;
    exitPointerLock: () => void;
  };
  const canvas = new EventTarget() as HTMLCanvasElement & {
    requestPointerLock: () => Promise<void>;
  };

  documentTarget.pointerLockElement = canvas;
  documentTarget.exitPointerLock = () => {
    documentTarget.pointerLockElement = null;
  };
  canvas.requestPointerLock = async () => {
    documentTarget.pointerLockElement = canvas;
  };

  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);

  return { canvas, windowTarget };
}

function dispatchMouse(target: EventTarget, type: string, button: number): void {
  const event = new Event(type, { cancelable: true }) as Event & {
    button: number;
    movementX: number;
    movementY: number;
  };
  event.button = button;
  event.movementX = 0;
  event.movementY = 0;
  target.dispatchEvent(event);
}

function dispatchKey(target: EventTarget, type: string, code: string): void {
  const event = new Event(type, { cancelable: true }) as Event & {
    code: string;
  };
  event.code = code;
  target.dispatchEvent(event);
}
