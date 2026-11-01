/**
 * Defines RuntimeCommand, the closed discriminated union of every action the UI can request (a palette or menu press, a key, an API call), and RuntimeEffect, what a command asks the host to do beyond changing the session.
 * Commands and effects are plain immutable data. applyRuntimeCommand.ts turns a command into a new session state plus a list of effects; the rendering shell runs the effects in order. No renderer type appears here.
 */
import type { TutorialPageSpec } from "../cell-complex/specs";
import type { DebugSettings } from "../glue/debugSettings";
import type { PortalPanelModeId } from "../glue/portalPanelMode";
import type { RuntimeDebugOverlayItemId, RuntimeToolId } from "../glue/toolIds";
import type { PlacedFlagType } from "../world-objects/toolObjects";
import type { RuntimeMenuConsoleLogLevelId } from "./runtimeMenuState";

/** Payload of the cannon actions page. */
export interface ShowGeodesicCannonActionsPayload {
  readonly cannonId: string;
  readonly geodesicIds?: readonly string[];
  readonly geodesicLabelsById?: Readonly<Record<string, string>>;
  readonly lockedGeodesicIds?: readonly string[];
  readonly canTieAndDetach?: boolean;
}

/** Payload of the geometry computer page. */
export interface ShowGeometryComputerActionsPayload {
  readonly computerId: string;
  readonly available: boolean;
  readonly widthMeters?: number;
  readonly currentSkewXMeters?: number;
  readonly currentDepthMeters?: number;
  readonly targetSkewXMeters?: number;
  readonly targetDepthMeters?: number;
}

/**
 * Application-level action requested by the UI.
 * Navigation and settings commands change the session's menu state; action commands (cannon, geometry computer, sign editing, reload, world and config changes) are gated by the app configuration and answered with effects.
 */
export type RuntimeCommand =
  // Navigation.
  | { readonly kind: "open-menu" }
  | { readonly kind: "close-menu" }
  /** Closes the menu, ends the tool in progress and selects no tool. */
  | { readonly kind: "cancel-menu-and-tool" }
  /** The header's right action: leave the page one level up, or cancel from a top-level page. */
  | { readonly kind: "menu-right-action" }
  | { readonly kind: "show-settings" }
  | { readonly kind: "show-main-page" }
  | { readonly kind: "show-debug-settings" }
  | { readonly kind: "show-place-flag-options" }
  | { readonly kind: "show-edit-sign"; readonly flagId: string; readonly message: string }
  | ({ readonly kind: "show-geodesic-cannon-actions" } & ShowGeodesicCannonActionsPayload)
  | ({ readonly kind: "show-geometry-computer-actions" } & ShowGeometryComputerActionsPayload)
  | {
      readonly kind: "show-question-help";
      readonly objectId: string;
      readonly tutorialPages: readonly TutorialPageSpec[];
      readonly goalPages: readonly TutorialPageSpec[];
    }
  | { readonly kind: "show-question-tutorial" }
  | { readonly kind: "show-goal" }
  | { readonly kind: "step-tutorial-page"; readonly delta: -1 | 1 }
  | { readonly kind: "step-goal-page"; readonly delta: -1 | 1 }
  // Tool and sign selection.
  | { readonly kind: "select-tool"; readonly toolId: RuntimeToolId }
  /** A tool entered a mode of its own (rotate, aim, carry, tie-and-detach): close the menu and select that tool. Not gated and no session reset: the tool started itself. */
  | { readonly kind: "enter-tool-mode"; readonly toolId: RuntimeToolId }
  /** Ends the tool in use without closing the menu page: selects no tool. */
  | { readonly kind: "clear-selected-tool" }
  | { readonly kind: "choose-place-flag-type"; readonly flagType: PlacedFlagType }
  | { readonly kind: "set-editing-flag"; readonly flagId: string | undefined }
  | { readonly kind: "set-editing-sign-message"; readonly message: string }
  // World, config, reload.
  | { readonly kind: "select-world"; readonly worldId: string }
  | { readonly kind: "select-config"; readonly configName: string }
  | { readonly kind: "reload-world" }
  /** The reload button: the first press arms the confirmation, a press while armed reloads. */
  | { readonly kind: "press-reload"; readonly nowMs: number; readonly windowMs: number }
  /** The confirmation timer fired: disarm the reload button unless it was re-armed. */
  | { readonly kind: "expire-reload-confirmation"; readonly nowMs: number }
  | { readonly kind: "go-home" }
  | { readonly kind: "change-world"; readonly worldId: string }
  | { readonly kind: "copy-url-with-options" }
  // Debug and comfort settings.
  | { readonly kind: "set-debug-enabled"; readonly enabled: boolean }
  | { readonly kind: "set-console-log-level"; readonly level: RuntimeMenuConsoleLogLevelId }
  | { readonly kind: "set-debug-overlay"; readonly enabled: boolean }
  | { readonly kind: "toggle-debug-overlay-item"; readonly itemId: RuntimeDebugOverlayItemId; readonly enabled: boolean }
  | { readonly kind: "set-portal-panel-mode"; readonly mode: PortalPanelModeId }
  | { readonly kind: "set-portal-inspection"; readonly enabled: boolean }
  | { readonly kind: "set-collision-geometry-wireframes"; readonly enabled: boolean }
  | { readonly kind: "set-aim-collision-outlines"; readonly enabled: boolean }
  | { readonly kind: "set-anti-nausea-mode"; readonly enabled: boolean }
  /** The host changed the debug settings from outside (the URL, the API): mirror them into the menu. */
  | { readonly kind: "adopt-debug-settings"; readonly settings: DebugSettings }
  // Geodesic cannon page actions.
  | { readonly kind: "add-geodesic-to-cannon"; readonly cannonId: string }
  | { readonly kind: "start-cannon-carry"; readonly cannonId: string }
  | { readonly kind: "start-cannon-tie-and-detach"; readonly cannonId: string }
  | { readonly kind: "start-cannon-rotation"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "start-cannon-aim"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "delete-geodesic-from-cannon"; readonly cannonId: string; readonly geodesicId: string }
  // Geometry computer page actions.
  | {
      readonly kind: "step-geometry-computer-target";
      readonly computerId: string;
      readonly axis: "a" | "b";
      readonly deltaMeters: number;
    }
  | { readonly kind: "start-geometry-computer-deformation"; readonly computerId: string }
  // Sign editor page actions.
  | { readonly kind: "type-sign-character"; readonly character: string }
  | { readonly kind: "backspace-sign" }
  | { readonly kind: "delete-sign" };

/**
 * What a command asks the host to do besides changing the session. The host runs the effects of one command in order.
 */
export type RuntimeEffect =
  /** Redraw the palette from the session's menu state. */
  | { readonly kind: "sync-palette" }
  /** The menu was cancelled: drop every tool's pending selections and feedback. */
  | { readonly kind: "end-tool-session" }
  /** A tool was picked in the menu: drop the pending selections of the tools it does not use. */
  | { readonly kind: "switch-tool-session"; readonly toolId: RuntimeToolId }
  /** Re-sync runtime object instances. */
  | { readonly kind: "sync-object-instances" }
  /** The menu's debug fields changed: re-apply the debug settings and report the launch options. */
  | { readonly kind: "apply-debug-state" }
  /** The comfort fields changed: update the comfort vignette and report the launch options. */
  | { readonly kind: "apply-comfort-state" }
  | { readonly kind: "reload-world" }
  | { readonly kind: "go-home" }
  | { readonly kind: "change-world"; readonly worldId: string }
  | { readonly kind: "change-app-config"; readonly configName: string }
  | { readonly kind: "copy-url-with-options" }
  /** Start a timer that sends expire-reload-confirmation after `windowMs`. */
  | { readonly kind: "arm-reload-confirmation-timer"; readonly windowMs: number }
  | { readonly kind: "add-geodesic-to-cannon"; readonly cannonId: string }
  | { readonly kind: "start-cannon-carry"; readonly cannonId: string }
  | { readonly kind: "start-cannon-tie-and-detach"; readonly cannonId: string }
  | { readonly kind: "start-cannon-rotation"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "start-cannon-aim"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "delete-geodesic-from-cannon"; readonly cannonId: string; readonly geodesicId: string }
  | {
      readonly kind: "step-geometry-computer-target";
      readonly computerId: string;
      readonly axis: "a" | "b";
      readonly deltaMeters: number;
    }
  | { readonly kind: "start-geometry-computer-deformation"; readonly computerId: string }
  | { readonly kind: "type-sign-character"; readonly character: string }
  | { readonly kind: "backspace-sign" }
  | { readonly kind: "delete-sign" };
