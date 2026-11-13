/**
 * The one command path: applyRuntimeCommand(session, command) changes the session through a pure reducer and returns the effects the host must run.
 * reduceRuntimeCommand(state, command) is the pure part: (session state, command) -> (next session state, effects). It touches no renderer, no clock and no registry, so it is tested without Three.js.
 * Menu and tool transitions live only here (the transitions themselves are the pure functions of runtimeMenuState.ts); commands the app configuration disables are ignored and yield no effects.
 * Effects are listed in the order the host must run them, including where the palette is redrawn ("sync-palette").
 */
import { isRuntimeToolEnabled } from "../glue/appConfig";
import { hasActiveDebugOption } from "../glue/debugOptions";
import type { DebugSettings } from "../glue/debugSettings";
import type { RuntimeToolId } from "../glue/toolIds";
import type { ClientSession, ClientSessionState } from "./clientSession";
import type { RuntimeCommand, RuntimeEffect } from "./runtimeCommands";
import {
  closeRuntimeMenu,
  createDebugSettingsFromRuntimeMenuState,
  createRuntimeMenuState,
  openRuntimeMenu,
  selectRuntimeMenuPlaceFlagToolType,
  setRuntimeMenuAimCollisionOutlinesEnabled,
  setRuntimeMenuAntiNauseaModeEnabled,
  setRuntimeMenuShowEdgesEnabled,
  setRuntimeMenuShowHintsEnabled,
  setRuntimeMenuTextSize,
  setRuntimeMenuMouseSensitivity,
  setRuntimeMenuTurnSpeed,
  setRuntimeMenuInvertY,
  resetRuntimeMenuTips,
  markRuntimeMenuHelpCardRead,
  setRuntimeMenuXrHandOption,
  setRuntimeMenuCollisionGeometryWireframesEnabled,
  setRuntimeMenuConsoleLogLevel,
  setRuntimeMenuDebugEnabled,
  setRuntimeMenuDebugOverlayEnabled,
  setRuntimeMenuEditingFlagId,
  setRuntimeMenuEditingSignMessage,
  setRuntimeMenuGoalPageIndex,
  setRuntimeMenuPortalInspectionEnabled,
  setRuntimeMenuPortalPanelMode,
  setRuntimeMenuReloadConfirmUntilMs,
  setRuntimeMenuSelectedAppConfigName,
  setRuntimeMenuSelectedTool,
  setRuntimeMenuSelectedWorldId,
  setRuntimeMenuTutorialPageIndex,
  showRuntimeMenuTutorialIndex,
  showRuntimeMenuTutorialPage,
  showRuntimeMenuDebugSettings,
  showRuntimeMenuEditSign,
  showRuntimeMenuGeodesicCannonActions,
  showRuntimeMenuGeometryComputerActions,
  showRuntimeMenuMeasurementActions,
  showRuntimeMenuDiscoveries,
  showRuntimeMenuGoal,
  showRuntimeMenuMainPage,
  showRuntimeMenuPlaceFlagOptions,
  showRuntimeMenuQuestionHelp,
  showRuntimeMenuQuestionTutorial,
  showRuntimeMenuSettings,
  toggleRuntimeMenuDebugOverlayItem,
  type RuntimeMenuState,
} from "./runtimeMenuState";

/** Result of reducing one command: the next session state and the effects to run. */
export interface RuntimeCommandResult {
  readonly state: ClientSessionState;
  readonly effects: readonly RuntimeEffect[];
}

const syncPalette: RuntimeEffect = { kind: "sync-palette" };

/**
 * Applies `command` to the session and returns the effects the host runs, in order. The session is updated before any effect runs.
 */
export function applyRuntimeCommand(session: ClientSession, command: RuntimeCommand): readonly RuntimeEffect[] {
  const result = reduceRuntimeCommand(session.get(), command);
  session.update(() => result.state);
  return result.effects;
}

/**
 * Pure reducer: the next session state and the ordered effects for one command. Returns the same state object when the command changes nothing.
 */
export function reduceRuntimeCommand(state: ClientSessionState, command: RuntimeCommand): RuntimeCommandResult {
  const menu = state.menuState;
  const config = state.appConfig;
  const toolEnabled = (toolId: RuntimeToolId): boolean => isRuntimeToolEnabled(config, toolId);
  const withMenu = (next: RuntimeMenuState, ...effects: RuntimeEffect[]): RuntimeCommandResult => ({
    state: next === menu ? state : { ...state, menuState: next },
    effects,
  });
  const nothing: RuntimeCommandResult = { state, effects: [] };
  const effectsOnly = (...effects: RuntimeEffect[]): RuntimeCommandResult => ({ state, effects });
  /** Debug-field transitions: change the menu, take the debug settings from it, then re-apply them (which also redraws the palette). */
  const debugChange = (next: RuntimeMenuState): RuntimeCommandResult => ({
    state: withDebugSettings({ ...state, menuState: next }, createDebugSettingsFromRuntimeMenuState(next)),
    effects: [{ kind: "apply-debug-state" }],
  });

  switch (command.kind) {
    case "open-menu":
      return withMenu(openRuntimeMenu(menu), syncPalette);
    case "close-menu":
      return withMenu(closeRuntimeMenu(menu), syncPalette);
    case "cancel-menu-and-tool":
      return cancelMenuAndTool(menu, withMenu);
    case "menu-right-action":
      if (
        menu.page === "main" ||
        menu.page === "edit-sign" ||
        menu.page === "measurement-actions" ||
        menu.page === "geodesic-cannon-actions" ||
        menu.page === "geometry-computer-actions" ||
        menu.page === "question-help"
      ) {
        return cancelMenuAndTool(menu, withMenu);
      }
      return withMenu(menuOneLevelUp(menu), syncPalette);
    case "show-settings":
      return withMenu(showRuntimeMenuSettings(menu), syncPalette);
    case "show-main-page":
      return withMenu(menuOneLevelUp(menu), syncPalette);
    case "show-debug-settings":
      return config.menu.debugSectionEnabled ? withMenu(showRuntimeMenuDebugSettings(menu), syncPalette) : nothing;
    case "show-place-flag-options":
      return toolEnabled("placedFlags/flag") ? withMenu(showRuntimeMenuPlaceFlagOptions(menu), syncPalette) : nothing;
    case "show-edit-sign":
      return withMenu(showRuntimeMenuEditSign(menu, { flagId: command.flagId, message: command.message }), syncPalette);
    case "show-measurement-actions":
      return withMenu(
        showRuntimeMenuMeasurementActions(menu, { measurementId: command.measurementId, measurementKind: command.measurementKind }),
        syncPalette,
      );
    case "show-geodesic-cannon-actions": {
      const { kind: _kind, ...payload } = command;
      return withMenu(showRuntimeMenuGeodesicCannonActions(menu, payload), syncPalette);
    }
    case "show-geometry-computer-actions": {
      const { kind: _kind, ...payload } = command;
      return withMenu(showRuntimeMenuGeometryComputerActions(menu, payload), syncPalette);
    }
    case "show-question-help":
      return withMenu(
        showRuntimeMenuQuestionHelp(menu, {
          objectId: command.objectId,
          // A card of a tool (it has a `toolId`) was already chosen against the tool belt by the shell: it stays for a tool the world cannot support.
          tutorialPages: command.tutorialPages.filter(
            (page) => page.toolId !== undefined || !page.requiresTools || page.requiresTools.some((toolId) => toolEnabled(toolId as RuntimeToolId)),
          ),
          goalPages: command.goalPages,
          ...(command.toolDisabledReasons !== undefined ? { toolDisabledReasons: command.toolDisabledReasons } : {}),
        }),
        syncPalette,
      );
    case "try-tool":
      if (!toolEnabled(command.toolId)) {
        return nothing;
      }
      return withMenu(
        closeRuntimeMenu(setRuntimeMenuSelectedTool(menu, command.toolId)),
        { kind: "switch-tool-session", toolId: command.toolId },
        syncPalette,
      );
    case "show-question-tutorial":
      return withMenu(showRuntimeMenuQuestionTutorial(menu), syncPalette);
    case "show-goal":
      return withMenu(showRuntimeMenuGoal(menu), syncPalette);
    case "show-discoveries":
      return command.entries === undefined ? nothing : withMenu(showRuntimeMenuDiscoveries(menu, command.entries), syncPalette);
    case "step-tutorial-page":
      if (menu.page !== "tutorial" || !menu.tutorialOptions) {
        return nothing;
      }
      return withMenu(markShownCardRead(setRuntimeMenuTutorialPageIndex(menu, menu.tutorialOptions.pageIndex + command.delta)), syncPalette);
    case "show-tutorial-page":
      if (menu.page !== "tutorial" || !menu.tutorialOptions) {
        return nothing;
      }
      return withMenu(markShownCardRead(showRuntimeMenuTutorialPage(menu, command.pageIndex)), syncPalette);
    case "step-goal-page":
      if (menu.page !== "goal" || !menu.goalOptions) {
        return nothing;
      }
      return withMenu(setRuntimeMenuGoalPageIndex(menu, menu.goalOptions.pageIndex + command.delta), syncPalette);
    case "select-tool":
      if (!toolEnabled(command.toolId)) {
        return nothing;
      }
      return withMenu(
        closeRuntimeMenu(setRuntimeMenuSelectedTool(menu, command.toolId)),
        { kind: "switch-tool-session", toolId: command.toolId },
        syncPalette,
      );
    case "clear-selected-tool":
      return withMenu(setRuntimeMenuSelectedTool(menu, "none"), syncPalette);
    case "choose-place-flag-type":
      return toolEnabled("placedFlags/flag")
        ? withMenu(closeRuntimeMenu(selectRuntimeMenuPlaceFlagToolType(menu, command.flagType)), syncPalette)
        : nothing;
    case "set-editing-flag":
      return withMenu(setRuntimeMenuEditingFlagId(menu, command.flagId), syncPalette);
    case "set-editing-sign-message":
      return withMenu(setRuntimeMenuEditingSignMessage(menu, command.message), syncPalette);
    case "select-world":
      if (!config.menu.worldSelectionSectionEnabled) {
        return nothing;
      }
      return withMenu(
        setRuntimeMenuSelectedWorldId(menu, command.worldId),
        syncPalette,
        { kind: "change-world", worldId: command.worldId },
      );
    case "select-config":
      if (!config.menu.configSelectionSectionEnabled) {
        return nothing;
      }
      return withMenu(
        setRuntimeMenuSelectedAppConfigName(menu, command.configName),
        syncPalette,
        { kind: "change-app-config", configName: command.configName },
      );
    case "reload-world":
      return effectsOnly({ kind: "reload-world" });
    case "press-reload":
      if ((menu.reloadConfirmUntilMs ?? 0) > command.nowMs) {
        return withMenu(setRuntimeMenuReloadConfirmUntilMs(menu, undefined), syncPalette, { kind: "reload-world" });
      }
      return withMenu(
        setRuntimeMenuReloadConfirmUntilMs(menu, command.nowMs + command.windowMs),
        syncPalette,
        { kind: "arm-reload-confirmation-timer", windowMs: command.windowMs },
      );
    case "expire-reload-confirmation":
      if ((menu.reloadConfirmUntilMs ?? 0) > command.nowMs) {
        return nothing;
      }
      return withMenu(setRuntimeMenuReloadConfirmUntilMs(menu, undefined), syncPalette);
    case "go-home":
      return effectsOnly({ kind: "go-home" });
    case "change-world":
      return effectsOnly({ kind: "change-world", worldId: command.worldId });
    case "copy-url-with-options":
      return effectsOnly({ kind: "copy-url-with-options" });
    case "set-debug-enabled":
      return config.menu.debugSectionEnabled ? debugChange(setRuntimeMenuDebugEnabled(menu, command.enabled)) : nothing;
    case "set-console-log-level":
      return debugChange(setRuntimeMenuConsoleLogLevel(menu, command.level));
    case "set-debug-overlay":
      return debugChange(setRuntimeMenuDebugOverlayEnabled(menu, command.enabled));
    case "toggle-debug-overlay-item":
      return debugChange(toggleRuntimeMenuDebugOverlayItem(menu, command.itemId, command.enabled));
    case "set-portal-panel-mode":
      return debugChange(setRuntimeMenuPortalPanelMode(menu, command.mode));
    case "set-portal-inspection":
      return debugChange(setRuntimeMenuPortalInspectionEnabled(menu, command.enabled));
    case "set-collision-geometry-wireframes":
      return debugChange(setRuntimeMenuCollisionGeometryWireframesEnabled(menu, command.enabled));
    case "set-aim-collision-outlines":
      return debugChange(setRuntimeMenuAimCollisionOutlinesEnabled(menu, command.enabled));
    case "set-anti-nausea-mode":
      return {
        state: {
          ...state,
          menuState: setRuntimeMenuAntiNauseaModeEnabled(menu, command.enabled),
          vrComfortOptions: { ...state.vrComfortOptions, antiNauseaModeEnabled: command.enabled },
        },
        effects: [{ kind: "apply-comfort-state" }],
      };
    case "set-show-edges":
      return { state: { ...state, menuState: setRuntimeMenuShowEdgesEnabled(menu, command.enabled) }, effects: [] };
    case "set-show-hints":
      return { state: { ...state, menuState: setRuntimeMenuShowHintsEnabled(menu, command.enabled) }, effects: [] };
    case "set-text-size":
      return { state: { ...state, menuState: setRuntimeMenuTextSize(menu, command.size) }, effects: [] };
    case "set-mouse-sensitivity":
      return { state: { ...state, menuState: setRuntimeMenuMouseSensitivity(menu, command.level) }, effects: [] };
    case "set-turn-speed":
      return { state: { ...state, menuState: setRuntimeMenuTurnSpeed(menu, command.level) }, effects: [] };
    case "set-invert-y":
      return { state: { ...state, menuState: setRuntimeMenuInvertY(menu, command.enabled) }, effects: [] };
    case "reset-tips":
      return { state: { ...state, menuState: resetRuntimeMenuTips(menu) }, effects: [] };
    case "set-xr-hand-option":
      return { state: { ...state, menuState: setRuntimeMenuXrHandOption(menu, command.option, command.enabled) }, effects: [] };
    case "set-show-cell-path-renders-instances":
      return { state: { ...state, showCellPathRendersInstances: command.enabled }, effects: [] };
    case "set-cannon-tool-state":
      return { state: { ...state, cannonToolState: command.state }, effects: [] };
    case "set-module-tool-state": {
      const { [command.moduleId]: previous, ...rest } = state.moduleToolState;
      if (command.state === undefined) {
        return previous === undefined ? nothing : { state: { ...state, moduleToolState: rest }, effects: [] };
      }
      return { state: { ...state, moduleToolState: { ...rest, [command.moduleId]: command.state } }, effects: [] };
    }
    case "set-pending-tool-request":
      return command.request === state.pendingToolRequest ? nothing : { state: { ...state, pendingToolRequest: command.request }, effects: [] };
    case "adopt-debug-settings": {
      const seeded = createRuntimeMenuState({
        selectedWorldId: menu.selectedWorldId,
        debugSettings: command.settings,
        debugOverlayEnabled: menu.debugOverlayEnabled,
        debugOverlayItems: menu.debugOverlayItems,
      });
      return {
        state: {
          ...withDebugSettings(state, command.settings),
          menuState: {
            ...menu,
            debugEnabled: seeded.debugEnabled,
            consoleLogLevel: seeded.consoleLogLevel,
            portalPanelMode: seeded.portalPanelMode,
            portalInspectionEnabled: seeded.portalInspectionEnabled,
            collisionGeometryWireframesEnabled: seeded.collisionGeometryWireframesEnabled,
            aimCollisionOutlinesEnabled: seeded.aimCollisionOutlinesEnabled,
          },
        },
        effects: [syncPalette],
      };
    }
    case "add-geodesic-to-cannon":
      return toolEnabled("geodesicEmitters/emitter") ? effectsOnly({ ...command }) : nothing;
    case "start-cannon-carry":
    case "start-object-action":
    case "start-cannon-rotation":
    case "start-cannon-aim":
      // The world decides whether the tool is allowed (the tool request); nothing is checked here.
      return effectsOnly({ ...command });
    case "delete-geodesic-from-cannon":
    case "delete-laser":
    case "delete-measurement":
    case "step-geometry-computer-target":
    case "edit-geometry-computer":
    case "start-geometry-computer-deformation":
    case "type-sign-character":
    case "backspace-sign":
    case "delete-sign":
      return effectsOnly({ ...command });
  }
}

/** The state with new debug settings; the portal-path overlay switch follows the debug options. */
function withDebugSettings(state: ClientSessionState, debugSettings: DebugSettings): ClientSessionState {
  return {
    ...state,
    debugSettings,
    showCellPathRendersInstances: hasActiveDebugOption(
      debugSettings.debugLevel,
      debugSettings.debugOptions,
      "portal-path-overlay-instances",
    ),
  };
}

/** Closes the menu and selects no tool; the host drops every tool's pending selection first. */
function cancelMenuAndTool(
  menu: RuntimeMenuState,
  withMenu: (next: RuntimeMenuState, ...effects: RuntimeEffect[]) => RuntimeCommandResult,
): RuntimeCommandResult {
  return withMenu(
    closeRuntimeMenu(setRuntimeMenuSelectedTool(menu, "none")),
    { kind: "end-tool-session" },
    syncPalette,
  );
}

/** Remembers the card the open tutorial now shows as read (the tick on its button in How to). */
function markShownCardRead(menu: RuntimeMenuState): RuntimeMenuState {
  const options = menu.tutorialOptions;
  const title = options?.pages[options.pageIndex]?.title;
  return options === undefined || options.view !== "page" || title === undefined ? menu : markRuntimeMenuHelpCardRead(menu, title);
}

/** The page one level up: debug settings go to settings, a tutorial page to the tutorial's index, the index and goal to the help hub, everything else to the main page. */
function menuOneLevelUp(menu: RuntimeMenuState): RuntimeMenuState {
  if (menu.page === "debug-settings") {
    return showRuntimeMenuSettings(menu);
  }
  if (menu.page === "tutorial" && menu.tutorialOptions?.view === "page" && menu.tutorialOptions.pages.length > 1) {
    return showRuntimeMenuTutorialIndex(menu);
  }
  if (menu.page === "tutorial" || menu.page === "goal" || menu.page === "discoveries") {
    return showRuntimeMenuQuestionHelp(menu);
  }
  return showRuntimeMenuMainPage(menu);
}
