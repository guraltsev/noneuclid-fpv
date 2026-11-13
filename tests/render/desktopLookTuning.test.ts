/**
 * Desktop look tuning (src/render/three/desktopControls.ts `setLookTuning`): the Settings steps for mouse sensitivity, turn speed and Invert Y change how far a mouse movement or a held turn key turns the view, and the defaults leave it as it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopControls } from "../../src/render/three/desktopControls";

afterEach(() => {
  vi.unstubAllGlobals();
});

function install() {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget() as EventTarget & { pointerLockElement: Element | null };
  const canvas = new EventTarget() as HTMLCanvasElement;
  documentTarget.pointerLockElement = canvas;
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  return { canvas, windowTarget, documentTarget };
}

function move(target: EventTarget, movementX: number, movementY: number): void {
  const event = new Event("mousemove") as Event & { movementX: number; movementY: number };
  event.movementX = movementX;
  event.movementY = movementY;
  target.dispatchEvent(event);
}

function key(target: EventTarget, type: "keydown" | "keyup", code: string): void {
  const event = new Event(type, { cancelable: true }) as Event & { code: string };
  event.code = code;
  target.dispatchEvent(event);
}

describe("desktop look tuning", () => {
  it("scales the mouse look and inverts the vertical axis", () => {
    const { canvas, documentTarget } = install();
    const controls = createDesktopControls(canvas);

    move(documentTarget, 10, 10);
    const normal = controls.consumeFrame(1 / 60);

    controls.setLookTuning({ mouseSensitivityFactor: 2, turnSpeedFactor: 1, invertY: true });
    move(documentTarget, 10, 10);
    const tuned = controls.consumeFrame(1 / 60);

    expect(tuned.yawDeltaRadians).toBeCloseTo(normal.yawDeltaRadians * 2, 10);
    expect(tuned.pitchDeltaRadians).toBeCloseTo(-normal.pitchDeltaRadians * 2, 10);
    controls.dispose();
  });

  it("scales the keyboard turn rate", () => {
    const { canvas, windowTarget } = install();
    const controls = createDesktopControls(canvas);

    key(windowTarget, "keydown", "KeyQ");
    const normal = controls.consumeFrame(0.1).yawDeltaRadians;
    controls.setLookTuning({ mouseSensitivityFactor: 1, turnSpeedFactor: 0.5, invertY: false });
    const slow = controls.consumeFrame(0.1).yawDeltaRadians;
    key(windowTarget, "keyup", "KeyQ");

    expect(normal).toBeGreaterThan(0);
    expect(slow).toBeCloseTo(normal * 0.5, 10);
    controls.dispose();
  });
});
