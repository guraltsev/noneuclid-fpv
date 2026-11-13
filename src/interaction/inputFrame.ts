/**
 * The per-frame input sample handed to the simulation by either the desktop or the XR controller (`DesktopInputFrame` in desktopControls derives from it).
 * Plain data in meters and radians; nothing here knows about a renderer or the DOM.
 */

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
  /** Request to reset the player/scene. */
  readonly resetRequested: boolean;
  /** Request for the primary action (e.g. fire or place) of the active tool. */
  readonly primaryActionRequested: boolean;
  /** Request to interact with the aimed object. */
  readonly interactRequested: boolean;
  /** Request to pick up or drop the aimed carryable object. */
  readonly carryActionRequested: boolean;
  /** Request to show the help overlay. */
  readonly helpRequested: boolean;
  /** Request to put the tool away and have the empty hand (desktop key 0); absent means no request. */
  readonly handRequested?: boolean;
  /** Which input device produced the frame. */
  readonly source: "desktop" | "xr";
}
