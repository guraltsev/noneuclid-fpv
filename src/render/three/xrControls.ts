/**
 * WebXR gamepad input -> `RuntimeInputFrame` (the XR input path for locomotion and actions), with hand roles (design 017 sections 7.2 and 7.3).
 * The layout comes from the input sources that have a gamepad (`resolveXrHandRoles`): two controllers (a pointer hand and a belt hand) or one controller that does every verb. Frames are in the player-local frame (x right, y forward, z up; meters and radians); pitch is never driven from XR.
 * Two controllers: pointer hand trigger Use, grip Menu, lower face Pick up, upper face What's this?, stick x turn; belt hand stick walk and turn, trigger next tool, grip Hand, lower face main menu.
 * One controller: stick y walk and x turn, trigger Use, grip Menu, lower face Pick up, upper face tap What's this? and 1 s hold main menu, stick press next tool (only when the stick rests).
 * Button layout follows the WebXR `xr-standard` gamepad mapping: 0 trigger, 1 grip (squeeze), 3 thumbstick press, 4 lower face button (A right, X left), 5 upper face button (B right, Y left).
 * Held buttons in `createXrInputFrame` are level signals; only `createXrControls` converts them to requests (rising edges, a release for a tap, a hold time).
 */
import { vec3 } from "../../math/vec3";
import type { RuntimeInputFrame } from "../../interaction/inputFrame";
import { computeContinuousTurn, computeJoystickLocomotion, type StickAxes } from "../../interaction/vrLocomotion";
import { createTapOrHoldTracker, resolveXrHandRoles, type XrHandRoles } from "../../interaction/xrHandRoles";
import { defaultXrHandOptions, type XrHandOptions, type XrLayout } from "../../glue/xrLayout";
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
 * Sources without a `gamepad` are ignored; `handedness` decides the roles, `targetRayMode` is not consulted here.
 */
export interface XrInputSourceLike {
  readonly handedness?: XRHandedness | "none" | string;
  readonly targetRayMode?: XRTargetRayMode | string;
  readonly gamepad?: GamepadLike;
}

/**
 * Stateful per-frame XR input reader that remembers button state to produce requests.
 */
export interface XrControls {
  /**
   * Converts the current XR input sources into one input frame, advancing the edge-detection state.
   * `deltaSeconds` is the frame time in seconds (scales stick locomotion, turn and the 1 s hold). Call exactly once per rendered XR frame:
   * every `*Requested` flag (reset is never requested from VR) is true only on the frame where the button of its role went from released to pressed.
   * With one controller the upper face button's tap (What's this?) fires on release and its hold (main menu) at 1 s.
   * A change of layout between frames raises no request on that frame (a button that changed meaning is not a press).
   */
  consumeFrame(inputSources: Iterable<XrInputSourceLike>, deltaSeconds: number): RuntimeInputFrame;
  /** Sets the two hand options ("Use one controller", "Left-handed"); they apply from the next `consumeFrame`. */
  setHandOptions(options: XrHandOptions): void;
  /** The layout the last `consumeFrame` read; undefined before the first frame and while no source has a gamepad. */
  layout(): XrLayout | undefined;
}

// Button indices in the WebXR `xr-standard` gamepad mapping.
const triggerButtonIndex = 0;
const gripButtonIndex = 1;
const stickPressButtonIndex = 3;
const lowerFaceButtonIndex = 4;
const upperFaceButtonIndex = 5;

/** What the roles are asking for, as held (level) signals. */
interface VerbLevels {
  readonly layout: XrLayout | undefined;
  readonly primary: boolean;
  readonly interact: boolean;
  readonly carry: boolean;
  /** Upper face button of the pointer hand. */
  readonly upperFace: boolean;
  /** Belt-hand trigger (two controllers), or the raw stick press (one controller). */
  readonly nextTool: boolean;
  readonly hand: boolean;
  /** Belt-hand lower face button (two controllers). */
  readonly mainMenu: boolean;
  /** The pointer-hand stick rests inside the dead zone (only meaningful with one controller). */
  readonly stickRests: boolean;
}

const noVerbs: VerbLevels = { layout: undefined, primary: false, interact: false, carry: false, upperFace: false, nextTool: false, hand: false, mainMenu: false, stickRests: true };

function pressedAt(gamepad: GamepadLike | undefined, index: number): boolean {
  return gamepad?.buttons?.[index]?.pressed === true;
}

function readVerbLevels(roles: XrHandRoles<XrInputSourceLike>, deadZone: number): VerbLevels {
  const layout = roles.layout;
  if (layout === undefined) return noVerbs;
  const pointer = roles.pointer?.gamepad;
  const belt = roles.belt?.gamepad;
  const oneController = layout !== "two-controllers";
  const stick = readPrimaryStickAxes(pointer);
  return {
    layout,
    primary: pressedAt(pointer, triggerButtonIndex),
    interact: pressedAt(pointer, gripButtonIndex),
    carry: pressedAt(pointer, lowerFaceButtonIndex),
    upperFace: pressedAt(pointer, upperFaceButtonIndex),
    nextTool: oneController ? pressedAt(pointer, stickPressButtonIndex) : pressedAt(belt, triggerButtonIndex),
    hand: !oneController && pressedAt(belt, gripButtonIndex),
    mainMenu: !oneController && pressedAt(belt, lowerFaceButtonIndex),
    stickRests: stick === undefined || (Math.abs(stick.x) <= deadZone && Math.abs(stick.y) <= deadZone),
  };
}

/**
 * Creates the stateful XR input reader used once per XR frame by createThreeApp#shell (`xrControls.consumeFrame(session.inputSources, dt)`).
 * `options` overrides fields of `defaultVrComfortOptions` (speeds, dead zone); omitted fields keep defaults. `initialHandOptions` default to both switches off.
 * Holds no resources, so there is nothing to dispose.
 */
export function createXrControls(options: Partial<VrComfortOptions> = {}, initialHandOptions: XrHandOptions = defaultXrHandOptions): XrControls {
  const comfort = { ...defaultVrComfortOptions, ...options };
  let handOptions = initialHandOptions;
  let previous: VerbLevels | undefined;
  let lastLayout: XrLayout | undefined;
  const upperFaceTracker = createTapOrHoldTracker();

  return {
    setHandOptions(next) {
      handOptions = next;
    },
    layout() {
      return lastLayout;
    },
    consumeFrame(inputSources, deltaSeconds) {
      const sources = [...inputSources];
      const roles = resolveXrHandRoles(sources, handOptions);
      const frame = createXrInputFrame(sources, deltaSeconds, comfort, handOptions);
      const now = readVerbLevels(roles, comfort.joystickDeadZone);
      const before = previous ?? noVerbs;
      const layoutChanged = previous !== undefined && now.layout !== previous.layout;
      if (layoutChanged) upperFaceTracker.reset();
      previous = now;
      lastLayout = now.layout;
      const oneController = now.layout === "one-left" || now.layout === "one-right";
      // A request fires when the verb's button is down now and was not on the previous call; a layout change raises nothing.
      const rises = (current: boolean, earlier: boolean): boolean => !layoutChanged && current && !earlier;
      const upper = layoutChanged ? { tap: false, hold: false } : upperFaceTracker.step(oneController && now.upperFace, deltaSeconds);
      return {
        ...frame,
        resetRequested: false,
        primaryActionRequested: rises(now.primary, before.primary),
        interactRequested: rises(now.interact, before.interact),
        carryActionRequested: rises(now.carry, before.carry),
        helpRequested: oneController ? upper.tap : rises(now.upperFace, before.upperFace),
        // With one controller the stick press counts only if the stick rested at the moment of the press.
        nextToolRequested: rises(now.nextTool, before.nextTool) && (!oneController || now.stickRests),
        handRequested: rises(now.hand, before.hand),
        mainMenuRequested: oneController ? upper.hold : rises(now.mainMenu, before.mainMenu),
      };
    },
  };
}

/**
 * Builds a stateless input frame from the given sources; all action flags reflect the instantaneous held state, not edges.
 * Walking is the belt hand's stick y (with one controller, that controller's); turning is the sum of the x axes of the sticks present (pointer hand and belt hand), clamped. `localDisplacement` is in meters, player-local; the yaw delta in radians; `pitchDeltaRadians` is always 0 and `source` is "xr".
 * `deltaSeconds` is in seconds; `options` overrides `defaultVrComfortOptions`; `handOptions` choose the roles (default both off). `nextToolRequested` is the held belt-hand trigger, or the held stick press while the stick rests; `mainMenuRequested` is the held belt-hand lower face button (the one-controller hold needs time, so only `createXrControls` raises it).
 */
export function createXrInputFrame(
  inputSources: Iterable<XrInputSourceLike>,
  deltaSeconds: number,
  options: Partial<VrComfortOptions> = {},
  handOptions: XrHandOptions = defaultXrHandOptions,
): RuntimeInputFrame {
  const comfort = { ...defaultVrComfortOptions, ...options };
  const roles = resolveXrHandRoles([...inputSources], handOptions);
  const levels = readVerbLevels(roles, comfort.joystickDeadZone);
  const pointerStick = readPrimaryStickAxes(roles.pointer?.gamepad);
  const beltStick = readPrimaryStickAxes(roles.belt?.gamepad);
  const turnAxes = combineStickAxes([pointerStick, beltStick].filter((axes): axes is StickAxes => axes !== undefined));
  // The belt hand walks; with one controller the only stick does.
  const walkAxes = roles.belt !== undefined ? beltStick : pointerStick;
  const locomotion = computeJoystickLocomotion(walkAxes, deltaSeconds, comfort);
  const yawDeltaRadians = computeContinuousTurn(turnAxes?.x, deltaSeconds, comfort);

  return {
    localDisplacement: locomotion.localDisplacement,
    yawDeltaRadians,
    pitchDeltaRadians: 0,
    // The stick press no longer resets the world (design 017 section 8.8): a frame from VR never asks for it.
    resetRequested: false,
    primaryActionRequested: levels.primary,
    interactRequested: levels.interact,
    carryActionRequested: levels.carry,
    helpRequested: levels.upperFace,
    nextToolRequested: levels.nextTool && levels.stickRests,
    handRequested: levels.hand,
    mainMenuRequested: levels.mainMenu,
    ...(levels.layout !== undefined ? { xrLayout: levels.layout } : {}),
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
 * True while the primary trigger (button 0) is held.
 */
export function isPrimaryActionPressed(gamepad: GamepadLike | undefined): boolean {
  return pressedAt(gamepad, triggerButtonIndex);
}

/**
 * True while the side trigger / squeeze (button 1) is held.
 */
export function isInteractPressed(gamepad: GamepadLike | undefined): boolean {
  return pressedAt(gamepad, gripButtonIndex);
}

/**
 * True while the lower face button (button 4: A on the right controller, X on the left) is held on `source`.
 * This is the XR carry binding; false for a missing gamepad or button.
 */
export function isCarryActionPressed(source: XrInputSourceLike): boolean {
  return pressedAt(source.gamepad, lowerFaceButtonIndex);
}

/**
 * True while the help face button (button 5) is held.
 */
export function isHelpPressed(gamepad: GamepadLike | undefined): boolean {
  return pressedAt(gamepad, upperFaceButtonIndex);
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
    nextToolRequested: false,
    handRequested: false,
    mainMenuRequested: false,
    source: "xr",
  };
}
