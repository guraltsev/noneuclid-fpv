/**
 * WebXR gamepad input -> `RuntimeInputFrame` (the XR input path for locomotion and actions).
 * Reads the thumbstick axes and button states of every XR input source's gamepad, combines them,
 * and produces a frame in the player-local frame (x right, y forward, z up; meters and radians).
 * Stick-forward moves along y and stick-x turns the player (continuous turn, no strafing). Pitch is never driven from XR.
 * Button layout follows the WebXR `xr-standard` gamepad mapping: 0 trigger, 1 squeeze, 3 thumbstick click, 5 face button.
 * Held buttons in `createXrInputFrame` are level signals; only `createXrControls` converts them to rising-edge requests.
 */
import { vec3 } from "../../math/vec3";
import type { RuntimeInputFrame } from "./renderState";
import { computeContinuousTurn, computeJoystickLocomotion, type StickAxes } from "./vrLocomotion";
import { defaultVrComfortOptions, type VrComfortOptions } from "./vrComfort";

/**
 * Minimal structural subset of the DOM `Gamepad` used by XR input parsing (also lets tests pass plain objects).
 * Both fields may be absent; absent axes/buttons are treated as neutral/unpressed.
 */
export interface GamepadLike {
  readonly axes?: readonly number[];
  readonly buttons?: readonly { readonly pressed: boolean }[];
}

/**
 * Minimal structural subset of `XRInputSource` that input parsing needs.
 * Sources without a `gamepad` are ignored by `createXrInputFrame`; `handedness` and `targetRayMode` are not consulted here.
 */
export interface XrInputSourceLike {
  readonly handedness?: XRHandedness | "none" | string;
  readonly targetRayMode?: XRTargetRayMode | string;
  readonly gamepad?: GamepadLike;
}

/**
 * Stateful per-frame XR input reader that remembers button state to produce edge-triggered requests.
 */
export interface XrControls {
  /**
   * Converts the current XR input sources into one input frame, advancing the edge-detection state.
   * `deltaSeconds` is the frame time in seconds (scales stick locomotion and turn). Call exactly once per rendered XR frame:
   * every action `*Requested` flag (including reset) is true only on the frame where any source's button went from released to pressed.
   * `carryActionRequested` is always false because no carry button is bound yet (see _issues/41_documentation_audit_findings.md).
   */
  consumeFrame(inputSources: Iterable<XrInputSourceLike>, deltaSeconds: number): RuntimeInputFrame;
}

// Button indices in the WebXR `xr-standard` gamepad mapping.
const primaryTriggerButtonIndex = 0;
const sideTriggerButtonIndex = 1;
const thumbstickButtonIndex = 3;
const helpFaceButtonIndex = 5;

/**
 * Creates the stateful XR input reader used once per XR frame by createThreeApp#shell (`xrControls.consumeFrame(session.inputSources, dt)`).
 * `options` overrides fields of `defaultVrComfortOptions` (speeds, dead zone); omitted fields keep defaults.
 * Holds no resources, so there is nothing to dispose.
 */
export function createXrControls(options: Partial<VrComfortOptions> = {}): XrControls {
  const comfort = { ...defaultVrComfortOptions, ...options };
  let previousResetPressed = false;
  let previousPrimaryActionPressed = false;
  let previousInteractPressed = false;
  let previousCarryActionPressed = false;
  let previousHelpPressed = false;

  return {
    consumeFrame(inputSources, deltaSeconds) {
      // Edge detection: a request fires only when some source is pressed now and none was pressed on the previous call.
      const sources = [...inputSources];
      const frame = createXrInputFrame(sources, deltaSeconds, comfort);
      const resetPressed = sources.some((source) => isResetPressed(source.gamepad));
      const resetRequested = resetPressed && !previousResetPressed;
      const primaryActionPressed = sources.some((source) => isPrimaryActionPressed(source.gamepad));
      const primaryActionRequested = primaryActionPressed && !previousPrimaryActionPressed;
      const interactPressed = sources.some((source) => isInteractPressed(source.gamepad));
      const interactRequested = interactPressed && !previousInteractPressed;
      const carryActionPressed = sources.some((source) => isCarryActionPressed(source));
      const carryActionRequested = carryActionPressed && !previousCarryActionPressed;
      const helpPressed = sources.some((source) => isHelpPressed(source.gamepad));
      const helpRequested = helpPressed && !previousHelpPressed;
      previousResetPressed = resetPressed;
      previousPrimaryActionPressed = primaryActionPressed;
      previousInteractPressed = interactPressed;
      previousCarryActionPressed = carryActionPressed;
      previousHelpPressed = helpPressed;
      return {
        ...frame,
        resetRequested,
        primaryActionRequested,
        interactRequested,
        carryActionRequested,
        helpRequested,
      };
    },
  };
}

/**
 * Builds a stateless input frame from the given sources; all action flags reflect the instantaneous held state, not edges.
 * Stick axes from all gamepad-bearing sources are summed and clamped, then mapped to forward/back displacement
 * (`localDisplacement`, meters, player-local) and a yaw delta (radians); `pitchDeltaRadians` is always 0 and `source` is "xr".
 * `deltaSeconds` is in seconds; `options` overrides `defaultVrComfortOptions`.
 */
export function createXrInputFrame(
  inputSources: Iterable<XrInputSourceLike>,
  deltaSeconds: number,
  options: Partial<VrComfortOptions> = {},
): RuntimeInputFrame {
  const comfort = { ...defaultVrComfortOptions, ...options };
  const sources = [...inputSources].filter((source) => source.gamepad);
  const stickAxes = sources
    .map((source) => readPrimaryStickAxes(source.gamepad))
    .filter((axes): axes is StickAxes => axes !== undefined);
  const combinedAxes = combineStickAxes(stickAxes);
  const locomotion = computeJoystickLocomotion(combinedAxes, deltaSeconds, comfort);
  const yawDeltaRadians = computeContinuousTurn(combinedAxes?.x, deltaSeconds, comfort);

  return {
    localDisplacement: locomotion.localDisplacement,
    yawDeltaRadians,
    pitchDeltaRadians: 0,
    resetRequested: sources.some((source) => isResetPressed(source.gamepad)),
    primaryActionRequested: sources.some((source) => isPrimaryActionPressed(source.gamepad)),
    interactRequested: sources.some((source) => isInteractPressed(source.gamepad)),
    carryActionRequested: sources.some((source) => isCarryActionPressed(source)),
    helpRequested: sources.some((source) => isHelpPressed(source.gamepad)),
    source: "xr",
  };
}

/**
 * Sums stick vectors from several controllers and clamps each component to [-1, 1].
 * Returns `undefined` for an empty list; non-finite sums clamp to 0.
 */
export function combineStickAxes(axes: readonly StickAxes[]): StickAxes | undefined {
  if (axes.length === 0) {
    return undefined;
  }

  return {
    x: clampStickAxis(axes.reduce((sum, item) => sum + item.x, 0)),
    y: clampStickAxis(axes.reduce((sum, item) => sum + item.y, 0)),
  };
}

/**
 * Reads the thumbstick of one gamepad, preferring axes (2,3) (xr-standard thumbstick) over axes (0,1) (touchpad slot) when that pair is finite and non-zero.
 * Returns `undefined` if the gamepad is missing or has fewer than 2 axes. If neither pair qualifies it falls back to axes[0], axes[1],
 * with any missing or non-finite value replaced by 0.
 */
export function readPrimaryStickAxes(gamepad: GamepadLike | undefined): StickAxes | undefined {
  const axes = gamepad?.axes;

  if (!axes || axes.length < 2) {
    return undefined;
  }

  // Try the xr-standard thumbstick pair first, then the (0,1) pair.
  const pairs = [
    [2, 3],
    [0, 1],
  ] as const;

  for (const [xIndex, yIndex] of pairs) {
    const x = axes[xIndex];
    const y = axes[yIndex];

    if (Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) > 0) {
      return { x, y };
    }
  }

  return { x: Number.isFinite(axes[0]) ? axes[0] : 0, y: Number.isFinite(axes[1]) ? axes[1] : 0 };
}

function clampStickAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
}

/**
 * True while the thumbstick-click button (index 3) is held; false for a missing gamepad or button.
 */
export function isResetPressed(gamepad: GamepadLike | undefined): boolean {
  const buttons = gamepad?.buttons;

  if (!buttons) {
    return false;
  }

  return buttons[thumbstickButtonIndex]?.pressed === true;
}

/**
 * True while the primary trigger (button 0) is held.
 */
export function isPrimaryActionPressed(gamepad: GamepadLike | undefined): boolean {
  return gamepad?.buttons?.[primaryTriggerButtonIndex]?.pressed === true;
}

/**
 * True while the side trigger / squeeze (button 1) is held.
 */
export function isInteractPressed(gamepad: GamepadLike | undefined): boolean {
  return gamepad?.buttons?.[sideTriggerButtonIndex]?.pressed === true;
}

/**
 * Placeholder for a carry-action binding; always returns false (the `source` argument is unused).
 * Consequently `carryActionRequested` is never set from this module. Which button should carry is an open design decision (_issues/41_documentation_audit_findings.md).
 */
export function isCarryActionPressed(source: XrInputSourceLike): boolean {
  void source;
  return false;
}

/**
 * True while the help face button (button 5) is held.
 */
export function isHelpPressed(gamepad: GamepadLike | undefined): boolean {
  return gamepad?.buttons?.[helpFaceButtonIndex]?.pressed === true;
}

/**
 * Returns a fresh neutral XR input frame (zero motion, no requests, `source: "xr"`), for frames with no usable input.
 */
export function emptyXrInputFrame(): RuntimeInputFrame {
  return {
    localDisplacement: vec3(0, 0, 0),
    yawDeltaRadians: 0,
    pitchDeltaRadians: 0,
    resetRequested: false,
    primaryActionRequested: false,
    interactRequested: false,
    carryActionRequested: false,
    helpRequested: false,
    source: "xr",
  };
}
