/**
 * Hand roles for VR input (design 017 sections 7.2 and 7.3), renderer-free: from the input sources that have a gamepad (and the two hand options) it picks the layout and says which source is the pointer hand and which is the belt hand.
 * Two controllers: the pointer hand points, uses, opens menus and picks up; the belt hand walks and owns the tool belt. One controller: it is the pointer hand and does every verb (the belt moves to the waist).
 * The functions are generic over the source type, so the browser's `XRInputSource` and a test literal both fit.
 */
import type { XrHandOptions, XrLayout } from "../glue/xrLayout";

/** What role detection reads of an input source. */
export interface XrRoleSourceLike {
  readonly handedness?: string;
  readonly gamepad?: unknown;
}

/** The result: the layout (absent when no source has a gamepad) and the sources by role. */
export interface XrHandRoles<T extends XrRoleSourceLike> {
  readonly layout?: XrLayout;
  /** Points, uses, opens menus, picks up. With one controller, the controller itself. */
  readonly pointer?: T;
  /** Owns the belt and walking; only with two controllers. */
  readonly belt?: T;
}

/** The handedness of the pointer hand: right by default, left when the player is left-handed. */
export function pointerHandedness(options: Pick<XrHandOptions, "leftHanded">): "left" | "right" {
  return options.leftHanded ? "left" : "right";
}

/**
 * Picks the layout and the roles from `sources` (those without a gamepad are ignored).
 * - exactly one source, or "Use one controller": one controller (the forced one is the pointer hand's, or the first when that is absent); layout `one-left` for handedness left, else `one-right`;
 * - two or more: two controllers, the pointer hand is the source with the pointer handedness (else the first), the belt hand is the one with the other handedness (else the next one).
 */
export function resolveXrHandRoles<T extends XrRoleSourceLike>(sources: Iterable<T>, options: XrHandOptions): XrHandRoles<T> {
  const withGamepad = [...sources].filter((source) => source.gamepad !== undefined && source.gamepad !== null);
  if (withGamepad.length === 0) return {};
  const pointerHand = pointerHandedness(options);
  if (withGamepad.length === 1 || options.useOneController) {
    const only = (options.useOneController ? withGamepad.find((source) => source.handedness === pointerHand) : undefined) ?? withGamepad[0];
    return { layout: only.handedness === "left" ? "one-left" : "one-right", pointer: only };
  }
  const pointer = withGamepad.find((source) => source.handedness === pointerHand) ?? withGamepad[0];
  const beltHand = pointerHand === "left" ? "right" : "left";
  const belt = withGamepad.find((source) => source !== pointer && source.handedness === beltHand) ?? withGamepad.find((source) => source !== pointer);
  return { layout: "two-controllers", pointer, belt };
}

/** The time the upper face button must be held, with one controller, to open the main menu (milliseconds). */
export const mainMenuHoldMilliseconds = 1000;

/** What a tap-or-hold button reports on a frame. */
export interface TapOrHoldResult {
  /** The button was released before the hold time: a tap. */
  readonly tap: boolean;
  /** The hold time was reached on this frame (once per press). */
  readonly hold: boolean;
}

/** A button that means one thing when tapped and another when held (the upper face button with one controller). */
export interface TapOrHoldTracker {
  /** Advances by one frame. A tap fires on the release, only if the hold did not fire; the hold fires on the frame the held time reaches `holdMilliseconds` and suppresses the tap. */
  step(pressed: boolean, deltaSeconds: number): TapOrHoldResult;
  /** Forgets a press in progress (a layout change). */
  reset(): void;
}

/** Creates a {@link TapOrHoldTracker}. */
export function createTapOrHoldTracker(holdMilliseconds: number = mainMenuHoldMilliseconds): TapOrHoldTracker {
  let wasPressed = false;
  let heldMilliseconds = 0;
  let holdFired = false;
  return {
    step(pressed, deltaSeconds) {
      let tap = false;
      let hold = false;
      if (pressed) {
        if (!wasPressed) {
          heldMilliseconds = 0;
          holdFired = false;
        }
        heldMilliseconds += Math.max(0, deltaSeconds) * 1000;
        if (!holdFired && heldMilliseconds >= holdMilliseconds) {
          holdFired = true;
          hold = true;
        }
      } else if (wasPressed && !holdFired) {
        tap = true;
      }
      wasPressed = pressed;
      return { tap, hold };
    },
    reset() {
      wasPressed = false;
      heldMilliseconds = 0;
      holdFired = false;
    },
  };
}
