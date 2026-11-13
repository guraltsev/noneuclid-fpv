/**
 * The per-frame input sample handed to the simulation by either the desktop or the XR controller (`DesktopInputFrame` in desktopControls derives from it).
 * Plain data in meters and radians; nothing here knows about a renderer or the DOM.
 */

import type { XrLayout } from "../glue/xrLayout";
import type { Vec3 } from "../math/vec3";

/** One frame of normalized player input from desktop or XR, consumed by movement and tool logic. */
export interface RuntimeInputFrame {
  /** Requested displacement in meters in the player's yaw-relative frame (x right, y forward, z up). */
  readonly localDisplacement: Vec3;
  /** Change of heading this frame, in radians. */
  readonly yawDeltaRadians: number;
  /** Change of look pitch this frame, in radians. */
  readonly pitchDeltaRadians: number;
  /** Pointer movement in screen pixels for the scene palette, when it is active. */
  readonly palettePointerDeltaPixels?: { readonly x: number; readonly y: number };
  /** Whether the palette select control is currently held. */
  readonly paletteSelectPressed?: boolean;
  /** Request to select the highlighted palette entry. */
  readonly paletteSelectRequested?: boolean;
  /** Request to reset the player/scene (desktop: R held for 1.5 s; VR: never). */
  readonly resetRequested: boolean;
  /** Request for the primary action (e.g. fire or place) of the active tool. */
  readonly primaryActionRequested: boolean;
  /** Request to interact with the aimed object. */
  readonly interactRequested: boolean;
  /** Request to pick up or drop the aimed carryable object. */
  readonly carryActionRequested: boolean;
  /** Request to show the help overlay. */
  readonly helpRequested: boolean;
  /** Request to put the tool away and have the empty hand (desktop key 0; VR: the belt-hand grip); absent means no request. */
  readonly handRequested?: boolean;
  /** The belt key pressed this frame ("1" to "5", desktop number keys and numpad); absent means none. */
  readonly toolKeyRequested?: string;
  /** Request to take the next belt slot (VR: the belt-hand trigger, or with one controller the stick press while the stick rests); absent means no request. */
  readonly nextToolRequested?: boolean;
  /** Request to open the main menu (VR: X on the belt hand, or with one controller the upper face button held 1 s); absent means no request. */
  readonly mainMenuRequested?: boolean;
  /** The VR controller layout this frame was read with; absent on desktop and while no controller has a gamepad. */
  readonly xrLayout?: XrLayout;
  /** Request to undo the last reset or deletion (desktop key U); absent means no request. */
  readonly undoRequested?: boolean;
  /** Which input device produced the frame. */
  readonly source: "desktop" | "xr";
}
