/**
 * Option and handle types of the in-scene palette panel adapter (the contract between the scene palette controller and the panel builders).
 */
import { Container } from "@pmndrs/uikit";
import type { PortalPanelModeId } from "../../../glue/portalPanelMode";
import type { RuntimeMenuConsoleLogLevelId } from "../../../runtime/runtimeMenuState";
import type { RuntimeDebugOverlayItemId, RuntimeToolId } from "../../../glue/toolIds";
import type { PaletteDefinition } from "../../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../../world-objects/toolObjects";

/**
 * Callbacks the palette panel invokes when the user activates a control; supplied by scenePaletteController.ts, which forwards them from createThreeApp#shell.
 * Only the header, world, config, reload, home, debug, comfort and related toggle callbacks are required; every optional callback is invoked with optional chaining, so a missing one makes that control a silent no-op.
 * Callbacks fire synchronously from the controller's select-pressed edge handling, never from uikit pointer events.
 */
export interface ScenePaletteAdapterOptions {
  /** Header left button; only the "settings" action id is routed here. */
  readonly onLeftAction: (actionId: PaletteDefinition["leftAction"]["id"]) => void;
  /** Header right button (and left slot "back" promoted from the right action); receives "close" or "back". */
  readonly onRightAction: (actionId: PaletteDefinition["rightAction"]["id"]) => void;
  readonly onWorldSelected: (worldId: string) => void;
  readonly onConfigSelected: (configName: string) => void;
  readonly onReloadRequested: () => void;
  readonly onHomeRequested: () => void;
  readonly onDebugEnabledChanged: (enabled: boolean) => void;
  readonly onDebugSettingsRequested: () => void;
  readonly onConsoleLogLevelSelected: (level: RuntimeMenuConsoleLogLevelId) => void;
  readonly onDebugOverlayToggled: (enabled: boolean) => void;
  readonly onDebugOverlayItemToggled: (itemId: RuntimeDebugOverlayItemId, enabled: boolean) => void;
  readonly onAntiNauseaModeToggled: (enabled: boolean) => void;
  /** Settings: the "Show hints" switch. */
  readonly onShowHintsToggled?: (enabled: boolean) => void;
  /** Settings: a "Controllers" switch (Use one controller, Left-handed). */
  readonly onXrHandOptionToggled?: (option: "useOneController" | "leftHanded", enabled: boolean) => void;
  readonly onPortalPanelModeSelected: (mode: PortalPanelModeId) => void;
  readonly onPortalInspectionToggled: (enabled: boolean) => void;
  readonly onCollisionGeometryWireframesToggled: (enabled: boolean) => void;
  readonly onAimCollisionOutlinesToggled: (enabled: boolean) => void;
  /** When absent, the "Copy URL with options" button on the debug settings page is not rendered. */
  readonly onCopyUrlWithOptionsRequested?: () => void;
  /** Main menu: the Help button. */
  readonly onHelpRequested?: () => void;
  /** Main page: a tool tile was activated (VR only until job 77). */
  readonly onToolSelected?: (toolId: RuntimeToolId) => void;
  /** Place-sign tile's "..." options button. */
  readonly onPlaceFlagOptionsRequested?: () => void;
  readonly onPlaceFlagTypeSelected?: (flagType: PlacedFlagType) => void;
  /** Geodesic cannon page callbacks; the cannon id comes from the palette content. Aim and rotate receive the geodesic id; delete requires one. */
  readonly onGeodesicCannonAddRequested?: (cannonId: string) => void;
  readonly onGeodesicCannonCarryRequested?: (cannonId: string) => void;
  /** An action a tool contributed to an object's page was pressed. */
  readonly onObjectActionRequested?: (objectKind: string, objectId: string, actionId: string) => void;
  readonly onGeodesicCannonRotateRequested?: (cannonId: string, geodesicId?: string) => void;
  readonly onGeodesicCannonAimRequested?: (cannonId: string, geodesicId?: string) => void;
  readonly onGeodesicCannonDeleteRequested?: (cannonId: string, geodesicId: string) => void;
  /** The Delete button of a laser's menu: the laser and its beams. */
  readonly onGeodesicCannonDeleteLaserRequested?: (cannonId: string) => void;
  /** The Delete button of a measurement's menu. */
  readonly onMeasurementDeleteRequested?: (measurementKind: "length" | "angle", measurementId: string) => void;
  /** Geometry computer page callbacks (the set-target callback is part of the contract but not invoked by this adapter). Deltas and targets are in meters. */
  readonly onGeometryComputerStepTargetRequested?: (computerId: string, axis: "a" | "b", deltaMeters: number) => void;
  readonly onGeometryComputerGoRequested?: (computerId: string) => void;
  /** Help hub and paged tutorial/goal navigation. */
  readonly onQuestionHelpTutorialRequested?: () => void;
  readonly onQuestionHelpGoalRequested?: () => void;
  readonly onTutorialPreviousRequested?: () => void;
  readonly onTutorialNextRequested?: () => void;
  /** A page was chosen from the tutorial's index. */
  readonly onTutorialPageRequested?: (pageIndex: number) => void;
  readonly onGoalPreviousRequested?: () => void;
  readonly onGoalNextRequested?: () => void;
  /** Sign editor on-panel keyboard: a character (including " " and "\n"), backspace, and delete-sign. */
  readonly onSignKeyboardCharacter?: (character: string) => void;
  readonly onSignKeyboardBackspace?: () => void;
  readonly onSignDeleteRequested?: () => void;
}

/**
 * Handle to a built palette panel: a uikit root plus content, visibility, animation and disposal controls.
 * The owner must call dispose() exactly once when the panel is discarded.
 */
export interface ScenePaletteAdapter {
  /** Panel root; add it to the scene graph. It starts hidden. Its local +Z is the panel front and its size in meters is given by scenePaletteLayout.ts. */
  readonly root: Container;
  /** Disposes the previously rendered header and body and builds new ones from definition. Rebuilds everything, so call it only when the definition changed (the controller compares serialized definitions). */
  setDefinition(definition: PaletteDefinition): void;
  /** Shows or hides the whole panel without disposing it. */
  setVisible(visible: boolean): void;
  /** Advances uikit internal updates (layout, scrolling, animations) by deltaMs milliseconds; call once per frame. */
  update(deltaMs: number): void;
  /** Disposes the rendered tree and the root, detaching the panel from its parent. */
  dispose(): void;
}
