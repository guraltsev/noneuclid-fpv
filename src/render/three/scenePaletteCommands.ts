/**
 * What the scene palette's buttons do: one callback per palette action, each dispatching the command that action stands for (selecting a tool is a request to the world instead).
 *
 * The palette controller knows nothing of commands; this table is the only place that maps its callbacks to the command path.
 * The module keeps no state.
 */
import type { RuntimeToolId } from "../../glue/toolIds";
import type { RuntimeCommand } from "../../runtime/runtimeCommands";
import type { ScenePaletteControllerOptions } from "./scenePaletteController";

/** Dependencies of {@link createScenePaletteCommands}. */
export interface ScenePaletteCommandsDeps {
  /** The one command path. */
  dispatch(command: RuntimeCommand): void;
  /** Asks the world whether a tool may be selected; the tool is selected when the world accepts (design 013 section 8.1). */
  requestTool(toolId: RuntimeToolId): void;
  /** How long after the first press of "reload" a second press confirms it, milliseconds. */
  readonly reloadConfirmationWindowMs: number;
}

/** The palette controller's action callbacks. */
export type ScenePaletteCommands = Pick<
  ScenePaletteControllerOptions,
  | "onOpenRequested" | "onCloseRequested" | "onShowSettingsRequested" | "onShowMainRequested" | "onWorldSelected"
  | "onConfigSelected" | "onReloadRequested" | "onHomeRequested" | "onDebugEnabledChanged" | "onDebugSettingsRequested"
  | "onConsoleLogLevelSelected" | "onDebugOverlayToggled" | "onDebugOverlayItemToggled" | "onAntiNauseaModeToggled"
  | "onPortalPanelModeSelected" | "onPortalInspectionToggled" | "onCollisionGeometryWireframesToggled"
  | "onAimCollisionOutlinesToggled" | "onCopyUrlWithOptionsRequested" | "onToolSelected" | "onPlaceFlagOptionsRequested"
  | "onPlaceFlagTypeSelected" | "onGeodesicCannonAddRequested" | "onGeodesicCannonCarryRequested"
  | "onObjectActionRequested" | "onGeodesicCannonRotateRequested" | "onGeodesicCannonAimRequested"
  | "onGeodesicCannonDeleteRequested" | "onGeometryComputerStepTargetRequested" | "onGeometryComputerGoRequested"
  | "onQuestionHelpTutorialRequested" | "onQuestionHelpGoalRequested" | "onTutorialPreviousRequested"
  | "onTutorialNextRequested" | "onTutorialPageRequested" | "onGoalPreviousRequested" | "onGoalNextRequested" | "onSignKeyboardCharacter"
  | "onSignKeyboardBackspace" | "onSignDeleteRequested"
>;

/** Creates the palette's action callbacks over `dispatch`. */
export function createScenePaletteCommands(deps: ScenePaletteCommandsDeps): ScenePaletteCommands {
  const { dispatch, requestTool, reloadConfirmationWindowMs } = deps;
  return {
    onOpenRequested() {
      dispatch({ kind: "open-menu" });
    },
    onCloseRequested() {
      dispatch({ kind: "cancel-menu-and-tool" });
    },
    onShowSettingsRequested() {
      dispatch({ kind: "show-settings" });
    },
    onShowMainRequested() {
      dispatch({ kind: "show-main-page" });
    },
    onWorldSelected(worldId) {
      dispatch({ kind: "select-world", worldId });
    },
    onConfigSelected(configName) {
      dispatch({ kind: "select-config", configName });
    },
    onReloadRequested() {
      dispatch({ kind: "press-reload", nowMs: Date.now(), windowMs: reloadConfirmationWindowMs });
    },
    onHomeRequested() {
      dispatch({ kind: "go-home" });
    },
    onDebugEnabledChanged(enabled) {
      dispatch({ kind: "set-debug-enabled", enabled });
    },
    onDebugSettingsRequested() {
      dispatch({ kind: "show-debug-settings" });
    },
    onConsoleLogLevelSelected(level) {
      dispatch({ kind: "set-console-log-level", level });
    },
    onDebugOverlayToggled(enabled) {
      dispatch({ kind: "set-debug-overlay", enabled });
    },
    onDebugOverlayItemToggled(itemId, enabled) {
      dispatch({ kind: "toggle-debug-overlay-item", itemId, enabled });
    },
    onAntiNauseaModeToggled(enabled) {
      dispatch({ kind: "set-anti-nausea-mode", enabled });
    },
    onPortalPanelModeSelected(mode) {
      dispatch({ kind: "set-portal-panel-mode", mode });
    },
    onPortalInspectionToggled(enabled) {
      dispatch({ kind: "set-portal-inspection", enabled });
    },
    onCollisionGeometryWireframesToggled(enabled) {
      dispatch({ kind: "set-collision-geometry-wireframes", enabled });
    },
    onAimCollisionOutlinesToggled(enabled) {
      dispatch({ kind: "set-aim-collision-outlines", enabled });
    },
    onCopyUrlWithOptionsRequested() {
      dispatch({ kind: "copy-url-with-options" });
    },
    onToolSelected(toolId) {
      if (toolId === "none") {
        dispatch({ kind: "close-menu" });
        dispatch({ kind: "clear-selected-tool" });
        return;
      }
      requestTool(toolId);
    },
    onPlaceFlagOptionsRequested() {
      dispatch({ kind: "show-place-flag-options" });
    },
    onPlaceFlagTypeSelected(flagType) {
      dispatch({ kind: "choose-place-flag-type", flagType });
    },
    onGeodesicCannonAddRequested(cannonId) {
      dispatch({ kind: "add-geodesic-to-cannon", cannonId });
    },
    onGeodesicCannonCarryRequested(cannonId) {
      dispatch({ kind: "start-cannon-carry", cannonId });
    },
    onObjectActionRequested(objectKind, objectId, actionId) {
      dispatch({ kind: "start-object-action", objectKind, objectId, actionId });
    },
    onGeodesicCannonRotateRequested(cannonId, geodesicId) {
      dispatch({ kind: "start-cannon-rotation", cannonId, geodesicId });
    },
    onGeodesicCannonAimRequested(cannonId, geodesicId) {
      dispatch({ kind: "start-cannon-aim", cannonId, geodesicId });
    },
    onGeodesicCannonDeleteRequested(cannonId, geodesicId) {
      dispatch({ kind: "delete-geodesic-from-cannon", cannonId, geodesicId });
    },
    onGeometryComputerStepTargetRequested(computerId, axis, deltaMeters) {
      dispatch({ kind: "step-geometry-computer-target", computerId, axis, deltaMeters });
    },
    onGeometryComputerGoRequested(computerId) {
      dispatch({ kind: "start-geometry-computer-deformation", computerId });
    },
    onQuestionHelpTutorialRequested() {
      dispatch({ kind: "show-question-tutorial" });
    },
    onQuestionHelpGoalRequested() {
      dispatch({ kind: "show-goal" });
    },
    onTutorialPreviousRequested() {
      dispatch({ kind: "step-tutorial-page", delta: -1 });
    },
    onTutorialNextRequested() {
      dispatch({ kind: "step-tutorial-page", delta: 1 });
    },
    onTutorialPageRequested(pageIndex) {
      dispatch({ kind: "show-tutorial-page", pageIndex });
    },
    onGoalPreviousRequested() {
      dispatch({ kind: "step-goal-page", delta: -1 });
    },
    onGoalNextRequested() {
      dispatch({ kind: "step-goal-page", delta: 1 });
    },
    onSignKeyboardCharacter(character) {
      dispatch({ kind: "type-sign-character", character });
    },
    onSignKeyboardBackspace() {
      dispatch({ kind: "backspace-sign" });
    },
    onSignDeleteRequested() {
      dispatch({ kind: "delete-sign" });
    },
  };
}
