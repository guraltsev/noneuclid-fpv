/**
 * Desktop keyboard and pointer-lock mouse input, collected into one DesktopInputFrame per rendered frame.
 * Role: this is the desktop (non-XR) input path. Listeners accumulate events between frames; the app shell calls consumeFrame once per frame, which converts the accumulated state into a displacement, look deltas and one-shot action flags and resets the one-shot state.
 * Frames and units: localDisplacement is the player's local frame in meters for that frame (x right, y forward, z up, always 0), yaw and pitch deltas are radians (positive yaw turns left, counter-clockwise seen from above), palette pointer deltas are screen pixels.
 * Bindings: W/A/S/D or arrow keys move, Q/E turn, R reset, F interact, G carry, H help, left click acts (the first click captures the pointer lock). In palette look mode the mouse drives the palette cursor instead of the camera and movement is disabled.
 * Focus: editable targets (input, textarea, select, contenteditable) are ignored, and window blur clears held keys and buttons.
 * Lifecycle: listeners are installed on window/document/canvas at creation; the owner must call dispose() to remove them.
 */
import { vec3 } from "../../math/vec3";
import type { RuntimeInputFrame } from "./renderState";

/**
 * Input accumulated since the previous consumeFrame call, ready to be applied for one frame.
 * Derived from {@link RuntimeInputFrame} (the shared per-frame input contract, whose field documentation applies) minus its `source` tag, with the palette fields always present.
 * Desktop specifics: localDisplacement is normalized so diagonal speed does not exceed the configured move speed; yaw (mouse plus Q/E) and pitch (mouse) deltas and movement are zero in palette look mode; palettePointerDeltaPixels are screen axes (y down) accumulated only in palette look mode; the `*Requested` flags are one-shots (reset R, interact F, carry G in camera look mode, help H, primary click while the pointer is locked); paletteSelectPressed is true while the primary button is held or was clicked this frame.
 */
export type DesktopInputFrame = Omit<RuntimeInputFrame, "source"> &
  Required<Pick<RuntimeInputFrame, "palettePointerDeltaPixels" | "paletteSelectPressed" | "paletteSelectRequested">>;

/** Whether mouse movement drives the camera ("camera") or the menu/palette cursor ("palette"). */
export type DesktopLookMode = "camera" | "palette";

/** Handle to the desktop input collector created by {@link createDesktopControls}; the creator must call dispose(). */
export interface DesktopControls {
  /** False while paused. */
  readonly enabled: boolean;
  /** Switches look mode; on an actual change it discards pending mouse deltas and click/select requests so stale input does not leak across modes. */
  setLookMode(mode: DesktopLookMode): void;
  /** Returns the input for this frame and clears the accumulated one-shot state; deltaSeconds scales key-driven movement and turning. While paused it clears everything and returns an all-zero frame. */
  consumeFrame(deltaSeconds: number): DesktopInputFrame;
  /** Stops collecting input, discards pending input and releases pointer lock. */
  pause(): void;
  /** Resumes input collection and discards stale input; resolves to whether the canvas holds pointer lock afterwards (requesting it when requestPointerLock is set). */
  resume(options?: { readonly requestPointerLock?: boolean }): Promise<boolean>;
  /** Asks the browser to lock the pointer to the canvas; resolves to true on success, false when paused or on failure (a warning is logged). */
  requestPointerLock(): Promise<boolean>;
  /** True when the canvas currently holds pointer lock. */
  isPointerLocked(): boolean;
  /** Removes the event listeners installed at creation; does not release pointer lock. */
  dispose(): void;
}

/** Tuning parameters for {@link createDesktopControls}; every field is optional. */
export interface DesktopControlsOptions {
  /** Walking speed in meters per second; default 2.5. */
  readonly moveSpeedMetersPerSecond?: number;
  /** Keyboard turn rate in radians per second; default 2.25. */
  readonly turnSpeedRadiansPerSecond?: number;
  /** Mouse look gain in radians per pixel of pointer movement; default 0.0025. */
  readonly mouseSensitivityRadiansPerPixel?: number;
}

// Physical key codes (event.code) treated as movement; arrow keys mirror WASD.
const movementKeys = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
// Q turns left (positive yaw), E turns right.
const turnKeys = new Set(["KeyQ", "KeyE"]);

/** True when the event target is a text-editing element that should receive keystrokes instead of gameplay input. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Partial<Element>).tagName !== "string") {
    return false;
  }
  const element = target as HTMLElement;
  const tag = element.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
}

/**
 * Creates the desktop input collector for the given canvas and installs its listeners.
 * Key and mouse-move listeners are global (window/document), so they do not require canvas focus; mouse movement is only used while the canvas holds pointer lock. A click on the canvas without pointer lock requests it instead of triggering an action.
 */
export function createDesktopControls(
  canvas: HTMLCanvasElement,
  options: DesktopControlsOptions = {},
): DesktopControls {
  const pressedKeys = new Set<string>();
  const moveSpeed = options.moveSpeedMetersPerSecond ?? 2.5;
  const turnSpeed = options.turnSpeedRadiansPerSecond ?? 2.25;
  const mouseSensitivity = options.mouseSensitivityRadiansPerPixel ?? 0.0025;
  let paused = false;
  let pendingMouseYawDeltaRadians = 0;
  let pendingMousePitchDeltaRadians = 0;
  let pendingPalettePointerDeltaX = 0;
  let pendingPalettePointerDeltaY = 0;
  let resetRequested = false;
  let primaryActionRequested = false;
  let paletteSelectPressed = false;
  let paletteSelectRequested = false;
  // Set by a palette-mode press so the click that completes it is not also reported as a camera-mode primary action.
  let suppressNextPrimaryClick = false;
  let interactRequested = false;
  let carryActionRequested = false;
  let helpRequested = false;
  let lookMode: DesktopLookMode = "camera";

  // One-shot keys set a flag and are not tracked as held; held keys go into pressedKeys. Handled keys have their default browser action prevented.
  // Events whose target is an editable element (input, textarea, select, contenteditable) are ignored so typing is never captured.
  function onKeyDown(event: KeyboardEvent): void {
    if (paused || isEditableTarget(event.target)) {
      return;
    }

    if (
      movementKeys.has(event.code) ||
      turnKeys.has(event.code) ||
      event.code === "KeyR" ||
      event.code === "KeyF" ||
      event.code === "KeyG" ||
      event.code === "KeyH"
    ) {
      event.preventDefault();
    }

    if (event.code === "KeyR") {
      resetRequested = true;
      return;
    }

    if (event.code === "KeyF") {
      interactRequested = true;
      return;
    }

    if (event.code === "KeyG") {
      carryActionRequested = true;
      return;
    }

    if (event.code === "KeyH") {
      helpRequested = true;
      return;
    }

    pressedKeys.add(event.code);
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressedKeys.delete(event.code);
  }

  // Losing window focus swallows key/button release events, so held state is cleared to avoid stuck movement.
  function onWindowBlur(): void {
    pressedKeys.clear();
    paletteSelectPressed = false;
  }

  // With pointer lock: palette mode records a select, camera mode a primary action (unless suppressed). Without lock: capture the pointer.
  function onClick(event: MouseEvent): void {
    if (event.button !== 0) {
      return;
    }

    if (document.pointerLockElement === canvas) {
      if (lookMode === "palette") {
        event.preventDefault();
        paletteSelectRequested = true;
        suppressNextPrimaryClick = true;
      } else {
        if (suppressNextPrimaryClick) {
          event.preventDefault();
          suppressNextPrimaryClick = false;
          return;
        }
        primaryActionRequested = true;
      }
      return;
    }

    void requestPointerLock();
  }

  function onMouseDown(event: MouseEvent): void {
    if (document.pointerLockElement === canvas && lookMode === "palette" && event.button === 0) {
      event.preventDefault();
      paletteSelectPressed = true;
      suppressNextPrimaryClick = true;
    }
  }

  function onMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      paletteSelectPressed = false;
    }
  }

  // Mouse right (+movementX) lowers yaw and mouse down (+movementY) lowers pitch.
  function onMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement === canvas) {
      if (lookMode === "palette") {
        pendingPalettePointerDeltaX += event.movementX;
        pendingPalettePointerDeltaY += event.movementY;
      } else {
        pendingMouseYawDeltaRadians -= event.movementX * mouseSensitivity;
        pendingMousePitchDeltaRadians -= event.movementY * mouseSensitivity;
      }
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
  canvas.addEventListener("click", onClick);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("mousemove", onMouseMove);

  // Drops all held keys and pending events.
  function clearPendingInput(): void {
    pressedKeys.clear();
    pendingMouseYawDeltaRadians = 0;
    pendingMousePitchDeltaRadians = 0;
    pendingPalettePointerDeltaX = 0;
    pendingPalettePointerDeltaY = 0;
    resetRequested = false;
    primaryActionRequested = false;
    paletteSelectPressed = false;
    paletteSelectRequested = false;
    suppressNextPrimaryClick = false;
    interactRequested = false;
    carryActionRequested = false;
    helpRequested = false;
  }

  async function requestPointerLock(): Promise<boolean> {
    if (paused) {
      return false;
    }

    try {
      await canvas.requestPointerLock();
      return document.pointerLockElement === canvas;
    } catch (error: unknown) {
      console.warn("Unable to capture FPS pointer lock.", error);
      return false;
    }
  }

  return {
    get enabled() {
      return !paused;
    },
    setLookMode(mode) {
      if (lookMode === mode) {
        return;
      }

      lookMode = mode;
      pendingMouseYawDeltaRadians = 0;
      pendingMousePitchDeltaRadians = 0;
      pendingPalettePointerDeltaX = 0;
      pendingPalettePointerDeltaY = 0;
      primaryActionRequested = false;
      paletteSelectRequested = false;
      paletteSelectPressed = false;
    },
    consumeFrame(deltaSeconds: number): DesktopInputFrame {
      if (paused) {
        clearPendingInput();
        return {
          localDisplacement: vec3(0, 0, 0),
          yawDeltaRadians: 0,
          pitchDeltaRadians: 0,
          palettePointerDeltaPixels: { x: 0, y: 0 },
          paletteSelectPressed: false,
          paletteSelectRequested: false,
          resetRequested: false,
          primaryActionRequested: false,
          interactRequested: false,
          carryActionRequested: false,
          helpRequested: false,
        };
      }

      let yawDeltaRadians = lookMode === "camera" ? pendingMouseYawDeltaRadians : 0;
      const pitchDeltaRadians = lookMode === "camera" ? pendingMousePitchDeltaRadians : 0;
      if (lookMode === "camera") {
        yawDeltaRadians += (pressedKeys.has("KeyQ") ? 1 : 0) * turnSpeed * deltaSeconds;
        yawDeltaRadians -= (pressedKeys.has("KeyE") ? 1 : 0) * turnSpeed * deltaSeconds;
      }

      const movementEnabled = lookMode === "camera";
      const forwardInput = movementEnabled ? (
        (pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp") ? 1 : 0) -
        (pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown") ? 1 : 0)
      ) : 0;
      const rightInput = movementEnabled ? (
        (pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight") ? 1 : 0) -
        (pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft") ? 1 : 0)
      ) : 0;
      // Normalizes diagonal movement; falls back to 1 so zero input does not divide by zero.
      const inputLength = Math.hypot(forwardInput, rightInput) || 1;
      const stepMeters = moveSpeed * deltaSeconds;
      // Snapshot the per-frame flags, applying look-mode gating, before clearing them below.
      const frameResetRequested = resetRequested;
      const framePrimaryActionRequested = lookMode === "camera" ? primaryActionRequested : false;
      const framePalettePointerDeltaPixels = {
        x: pendingPalettePointerDeltaX,
        y: pendingPalettePointerDeltaY,
      };
      const framePaletteSelectPressed = lookMode === "palette" && paletteSelectPressed;
      const framePaletteSelectRequested = lookMode === "palette" && paletteSelectRequested;
      const frameInteractRequested = interactRequested;
      const frameCarryActionRequested = lookMode === "camera" && carryActionRequested;
      const frameHelpRequested = helpRequested;

      pendingMouseYawDeltaRadians = 0;
      pendingMousePitchDeltaRadians = 0;
      pendingPalettePointerDeltaX = 0;
      pendingPalettePointerDeltaY = 0;
      resetRequested = false;
      primaryActionRequested = false;
      paletteSelectRequested = false;
      interactRequested = false;
      carryActionRequested = false;
      helpRequested = false;

      return {
        localDisplacement: vec3((rightInput / inputLength) * stepMeters, (forwardInput / inputLength) * stepMeters, 0),
        yawDeltaRadians,
        pitchDeltaRadians,
        palettePointerDeltaPixels: framePalettePointerDeltaPixels,
        // A click shorter than a frame still reports as pressed for that frame.
        paletteSelectPressed: framePaletteSelectPressed || framePaletteSelectRequested,
        paletteSelectRequested: framePaletteSelectRequested,
        resetRequested: frameResetRequested,
        primaryActionRequested: framePrimaryActionRequested,
        interactRequested: frameInteractRequested,
        carryActionRequested: frameCarryActionRequested,
        helpRequested: frameHelpRequested,
      };
    },
    pause(): void {
      paused = true;
      clearPendingInput();
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    },
    async resume(resumeOptions = {}): Promise<boolean> {
      paused = false;
      clearPendingInput();
      if (resumeOptions.requestPointerLock) {
        return requestPointerLock();
      }
      return document.pointerLockElement === canvas;
    },
    requestPointerLock,
    isPointerLocked(): boolean {
      return document.pointerLockElement === canvas;
    },
    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousemove", onMouseMove);
    },
  };
}
