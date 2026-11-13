/**
 * Defines RuntimeCommand, the closed discriminated union of every action the UI can request (a palette or menu press, a key, an API call), and RuntimeEffect, what a command asks the host to do beyond changing the session.
 * Commands and effects are plain immutable data. applyRuntimeCommand.ts turns a command into a new session state plus a list of effects; the rendering shell runs the effects in order. No renderer type appears here.
 */
import type { ObjectActionEntry } from "../engine/moduleTypes";
import type { TutorialPageSpec } from "../cell-complex/specs";
import type { DiscoveryPageEntry } from "../modules/discoveries";
import type { DebugSettings } from "../glue/debugSettings";
import type { PortalPanelModeId } from "../glue/portalPanelMode";
import type { RuntimeDebugOverlayItemId, RuntimeToolId } from "../glue/toolIds";
import type { GeodesicCannonToolState } from "../world-objects/geodesic/cannonToolState";
import type { PlacedFlagType } from "../world-objects/toolObjects";
import type { RuntimeMenuConsoleLogLevelId, RuntimeMouseSensitivity, RuntimeTextSize, RuntimeTurnSpeed } from "./runtimeMenuState";
import type { PendingToolRequest } from "./clientSession";

/** Payload of the cannon actions page. */
export interface ShowGeodesicCannonActionsPayload {
  readonly cannonId: string;
  readonly geodesicIds?: readonly string[];
  readonly geodesicLabelsById?: Readonly<Record<string, string>>;
  readonly connectedGeodesicIds?: readonly string[];
  /** The actions the tools contribute to the page, with their availability (design 013 section 8.3). */
  readonly objectActions?: readonly ObjectActionEntry[];
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
  readonly startSkewXMeters?: number;
  readonly startDepthMeters?: number;
  /** The parameter being typed on the keypad and the digits so far; absent while no value is being typed. */
  readonly entryAxis?: "a" | "b";
  readonly entryText?: string;
  /** Whether the "More" row is unfolded. */
  readonly moreOpen?: boolean;
}

/** An edit of the shape machine panel other than a one-metre step: a preset, the keypad, the "More" row. Targets are in meters. */
export type GeometryComputerEdit =
  | { readonly kind: "set-target"; readonly aMeters: number; readonly bMeters: number }
  | { readonly kind: "open-entry"; readonly axis: "a" | "b" }
  | { readonly kind: "entry-digit"; readonly digit: string }
  | { readonly kind: "entry-backspace" }
  | { readonly kind: "entry-apply" }
  | { readonly kind: "entry-cancel" }
  | { readonly kind: "toggle-more" };

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
  /** Opens the menu of one measurement; its Delete button is the one way to remove it. */
  | { readonly kind: "show-measurement-actions"; readonly measurementId: string; readonly measurementKind: "length" | "angle" }
  | ({ readonly kind: "show-geodesic-cannon-actions" } & ShowGeodesicCannonActionsPayload)
  | ({ readonly kind: "show-geometry-computer-actions" } & ShowGeometryComputerActionsPayload)
  | {
      readonly kind: "show-question-help";
      readonly objectId: string;
      readonly tutorialPages: readonly TutorialPageSpec[];
      readonly goalPages: readonly TutorialPageSpec[];
      /** Tool id to the reason its How to card is disabled, for the tools the world cannot support. */
      readonly toolDisabledReasons?: Readonly<Record<string, string>>;
    }
  /** "Try it" on a How to card: takes the tool and closes Help; the shell shows the card's first step as a tip. */
  | { readonly kind: "try-tool"; readonly toolId: RuntimeToolId }
  | { readonly kind: "show-question-tutorial" }
  | { readonly kind: "show-goal" }
  /** Opens the Discoveries page from the help hub; the shell fills `entries` (the discoveries found and the teasers of the rest) and a command without them does nothing. */
  | { readonly kind: "show-discoveries"; readonly entries?: readonly DiscoveryPageEntry[] }
  | { readonly kind: "step-tutorial-page"; readonly delta: -1 | 1 }
  /** Shows one page of the open tutorial, chosen from its index. */
  | { readonly kind: "show-tutorial-page"; readonly pageIndex: number }
  | { readonly kind: "step-goal-page"; readonly delta: -1 | 1 }
  // Tool and sign selection.
  | { readonly kind: "select-tool"; readonly toolId: RuntimeToolId }
  /** Ends the tool in use without closing the menu page: selects no tool. */
  | { readonly kind: "clear-selected-tool" }
  | { readonly kind: "choose-place-flag-type"; readonly flagType: PlacedFlagType }
  | { readonly kind: "set-editing-flag"; readonly flagId: string | undefined }
  | { readonly kind: "set-editing-sign-message"; readonly message: string }
  // Tool state written by the tools and the frame loop.
  | { readonly kind: "set-cannon-tool-state"; readonly state: GeodesicCannonToolState }
  /** A module's client tool state (picks, prompts); `undefined` clears it. Design 013 section 9.3. */
  | { readonly kind: "set-module-tool-state"; readonly moduleId: string; readonly state: unknown }
  /** The tool request the world has not answered yet (design 013 section 8.1), or undefined once it has. */
  | { readonly kind: "set-pending-tool-request"; readonly request: PendingToolRequest | undefined }
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
  /** The "Show hints" switch of Settings. */
  | { readonly kind: "set-show-hints"; readonly enabled: boolean }
  /** The "Show edges" switch of Settings, and the button of the Discoveries page. */
  | { readonly kind: "set-show-edges"; readonly enabled: boolean }
  /** The "Text size" step of Settings. */
  | { readonly kind: "set-text-size"; readonly size: RuntimeTextSize }
  /** The "Mouse sensitivity" step of Settings. */
  | { readonly kind: "set-mouse-sensitivity"; readonly level: RuntimeMouseSensitivity }
  /** The "Turn speed" step of Settings. */
  | { readonly kind: "set-turn-speed"; readonly level: RuntimeTurnSpeed }
  /** The "Invert Y" switch of Settings. */
  | { readonly kind: "set-invert-y"; readonly enabled: boolean }
  /** The "Reset tips" button of Settings. */
  | { readonly kind: "reset-tips" }
  /** One of the "Controllers" switches of Settings (VR hand options). */
  | { readonly kind: "set-xr-hand-option"; readonly option: "useOneController" | "leftHanded"; readonly enabled: boolean }
  /** The host changed the debug settings from outside (the URL, the API): mirror them into the menu. */
  | { readonly kind: "adopt-debug-settings"; readonly settings: DebugSettings }
  /** The portal debug helper flips the portal-path overlay's instance switch. */
  | { readonly kind: "set-show-cell-path-renders-instances"; readonly enabled: boolean }
  // Geodesic cannon page actions.
  | { readonly kind: "add-geodesic-to-cannon"; readonly cannonId: string }
  | { readonly kind: "start-cannon-carry"; readonly cannonId: string }
  | { readonly kind: "start-object-action"; readonly objectKind: string; readonly objectId: string; readonly actionId: string }
  | { readonly kind: "start-cannon-rotation"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "start-cannon-aim"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "delete-geodesic-from-cannon"; readonly cannonId: string; readonly geodesicId: string }
  /** The Delete button of a laser's menu: the laser and its beams go. */
  | { readonly kind: "delete-laser"; readonly cannonId: string }
  /** The Delete button of a measurement's menu. */
  | { readonly kind: "delete-measurement"; readonly measurementId: string; readonly measurementKind: "length" | "angle" }
  // Geometry computer page actions.
  | {
      readonly kind: "step-geometry-computer-target";
      readonly computerId: string;
      readonly axis: "a" | "b";
      readonly deltaMeters: number;
    }
  | { readonly kind: "edit-geometry-computer"; readonly computerId: string; readonly edit: GeometryComputerEdit }
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
  | { readonly kind: "start-object-action"; readonly objectKind: string; readonly objectId: string; readonly actionId: string }
  | { readonly kind: "start-cannon-rotation"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "start-cannon-aim"; readonly cannonId: string; readonly geodesicId?: string }
  | { readonly kind: "delete-geodesic-from-cannon"; readonly cannonId: string; readonly geodesicId: string }
  | { readonly kind: "delete-laser"; readonly cannonId: string }
  | { readonly kind: "delete-measurement"; readonly measurementId: string; readonly measurementKind: "length" | "angle" }
  | {
      readonly kind: "step-geometry-computer-target";
      readonly computerId: string;
      readonly axis: "a" | "b";
      readonly deltaMeters: number;
    }
  | { readonly kind: "edit-geometry-computer"; readonly computerId: string; readonly edit: GeometryComputerEdit }
  | { readonly kind: "start-geometry-computer-deformation"; readonly computerId: string }
  | { readonly kind: "type-sign-character"; readonly character: string }
  | { readonly kind: "backspace-sign" }
  | { readonly kind: "delete-sign" };
