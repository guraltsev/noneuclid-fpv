/**
 * `tests/runtime/applyRuntimeCommand.test.ts` — unit tier.
 *
 * `applyRuntimeCommand` is the one command path shared by the desktop menu, the XR palette and the public API:
 * a pure reducer turns (session state, command) into the next session state and an ordered list of effects for the
 * host. These tests cover every command variant without Three.js: the menu or tool state it produces, the effects it
 * asks for (including where the palette is redrawn), and that a command the app configuration disables does nothing.
 * The first four tests are the former `dispatchRuntimeCommand` tests (reload, go home, change world, debug overlay).
 */
import { describe, expect, it } from "vitest";
import { defaultAppConfig, type AppConfig } from "../../src/glue/appConfig";
import { applyRuntimeCommand, reduceRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import { defaultVrComfortOptions } from "../../src/glue/vrComfortOptions";
import { createClientSession, type ClientSessionState } from "../../src/runtime/clientSession";
import type { RuntimeCommand, RuntimeEffect } from "../../src/runtime/runtimeCommands";
import {
  createRuntimeMenuState,
  openRuntimeMenu,
  showRuntimeMenuGoal,
  showRuntimeMenuQuestionHelp,
  showRuntimeMenuSettings,
  showRuntimeMenuTutorial,
  type RuntimeMenuState,
} from "../../src/runtime/runtimeMenuState";

const sync: RuntimeEffect = { kind: "sync-palette" };
const pages = [
  { title: "One", body: "first" },
  { title: "Two", body: "second" },
];

function stateWith(menu?: Partial<RuntimeMenuState>, appConfig: AppConfig = defaultAppConfig): ClientSessionState {
  return {
    menuState: { ...createRuntimeMenuState({ selectedWorldId: "cube" }), ...menu },
    appConfig,
    debugSettings: { debugLevel: "off", portalPanelMode: "none", debugOptions: [] },
    showCellPathRendersInstances: false,
    vrComfortOptions: defaultVrComfortOptions,
    cannonToolState: {},
    protractorToolState: {},
    moduleToolState: {},
    pendingToolRequest: undefined,
  };
}

function reduce(command: RuntimeCommand, state: ClientSessionState = stateWith()) {
  return reduceRuntimeCommand(state, command);
}

function disabled(patch: {
  readonly menu?: Partial<AppConfig["menu"]>;
  readonly tools?: Partial<AppConfig["tools"]>;
}): AppConfig {
  return {
    ...defaultAppConfig,
    menu: { ...defaultAppConfig.menu, ...patch.menu },
    tools: { ...defaultAppConfig.tools, ...patch.tools },
  };
}

describe("applyRuntimeCommand: host actions", () => {
  it("asks the host to reload for reload-world", () => {
    expect(reduce({ kind: "reload-world" }).effects).toEqual([{ kind: "reload-world" }]);
  });

  it("asks the host to go home for go-home", () => {
    expect(reduce({ kind: "go-home" }).effects).toEqual([{ kind: "go-home" }]);
  });

  it("asks the host to change the world for change-world, without touching the menu", () => {
    const result = reduce({ kind: "change-world", worldId: "tetrahedron" });

    expect(result.effects).toEqual([{ kind: "change-world", worldId: "tetrahedron" }]);
    expect(result.state.menuState.selectedWorldId).toBe("cube");
  });

  it("sets the debug overlay flag and re-applies the debug state for set-debug-overlay", () => {
    const result = reduce({ kind: "set-debug-overlay", enabled: false });

    expect(result.state.menuState.debugOverlayEnabled).toBe(false);
    expect(result.effects).toEqual([{ kind: "apply-debug-state" }]);
  });

  it("asks the host to copy the URL for copy-url-with-options", () => {
    expect(reduce({ kind: "copy-url-with-options" }).effects).toEqual([{ kind: "copy-url-with-options" }]);
  });

  it("applies a command to the session and returns the effects", () => {
    const session = createClientSession(stateWith());

    const effects = applyRuntimeCommand(session, { kind: "open-menu" });

    expect(session.get().menuState.isOpen).toBe(true);
    expect(effects).toEqual([sync]);
  });

  it("keeps the state object when a command changes nothing", () => {
    const state = stateWith();

    expect(reduce({ kind: "step-tutorial-page", delta: 1 }, state).state).toBe(state);
  });
});

describe("applyRuntimeCommand: navigation", () => {
  it("opens the menu", () => {
    expect(reduce({ kind: "open-menu" })).toMatchObject({ state: { menuState: { isOpen: true } }, effects: [sync] });
  });

  it("closes the menu", () => {
    const result = reduce({ kind: "close-menu" }, stateWith({ isOpen: true }));

    expect(result.state.menuState.isOpen).toBe(false);
    expect(result.effects).toEqual([sync]);
  });

  it("cancels the menu and the tool: closed, no tool, tool sessions ended, then redraw", () => {
    const result = reduce({ kind: "cancel-menu-and-tool" }, stateWith({ isOpen: true, selectedTool: "protractor" }));

    expect(result.state.menuState).toMatchObject({ isOpen: false, selectedTool: "none" });
    expect(result.effects).toEqual([{ kind: "end-tool-session" }, { kind: "sync-object-instances" }, sync]);
  });

  it("cancels from a top-level page on the right action", () => {
    const result = reduce({ kind: "menu-right-action" }, stateWith({ isOpen: true, page: "main", selectedTool: "protractor" }));

    expect(result.state.menuState).toMatchObject({ isOpen: false, selectedTool: "none" });
    expect(result.effects[0]).toEqual({ kind: "end-tool-session" });
  });

  it("goes one level up on the right action from a nested page", () => {
    const debugPage = stateWith({ isOpen: true, page: "debug-settings" });
    const helpHub = showRuntimeMenuQuestionHelp(openRuntimeMenu(stateWith().menuState), {
      objectId: "o",
      tutorialPages: pages,
      goalPages: pages,
    });
    const tutorial = { ...stateWith(), menuState: showRuntimeMenuTutorial(helpHub, { objectId: "o", pages }) };

    expect(reduce({ kind: "menu-right-action" }, debugPage).state.menuState.page).toBe("settings");
    expect(reduce({ kind: "menu-right-action" }, tutorial).state.menuState.page).toBe("question-help");
    expect(reduce({ kind: "menu-right-action" }, stateWith({ isOpen: true, page: "settings" })).state.menuState.page).toBe("main");
    expect(reduce({ kind: "menu-right-action" }, debugPage).effects).toEqual([sync]);
  });

  it("shows the settings page", () => {
    expect(reduce({ kind: "show-settings" })).toMatchObject({ state: { menuState: { page: "settings" } }, effects: [sync] });
  });

  it("goes back one level for show-main-page", () => {
    const result = reduce({ kind: "show-main-page" }, stateWith({ isOpen: true, page: "debug-settings" }));

    expect(result.state.menuState.page).toBe("settings");
    expect(reduce({ kind: "show-main-page" }, stateWith({ isOpen: true, page: "settings" })).state.menuState.page).toBe("main");
  });

  it("shows the debug settings page, unless the debug section is disabled", () => {
    expect(reduce({ kind: "show-debug-settings" }).state.menuState.page).toBe("debug-settings");

    const off = stateWith({}, disabled({ menu: { debugSectionEnabled: false } }));
    expect(reduce({ kind: "show-debug-settings" }, off)).toEqual({ state: off, effects: [] });
  });

  it("shows the place-flag options page, unless the tool is disabled", () => {
    expect(reduce({ kind: "show-place-flag-options" }).state.menuState.page).toBe("place-flag-options");

    const off = stateWith({}, disabled({ tools: { placeFlags: false } }));
    expect(reduce({ kind: "show-place-flag-options" }, off)).toEqual({ state: off, effects: [] });
  });

  it("shows the sign editor page", () => {
    const result = reduce({ kind: "show-edit-sign", flagId: "flag-1", message: "hi" });

    expect(result.state.menuState).toMatchObject({
      isOpen: true,
      page: "edit-sign",
      editingFlagId: "flag-1",
      editSignOptions: { flagId: "flag-1", message: "hi" },
    });
    expect(result.effects).toEqual([sync]);
  });

  it("shows the geodesic cannon actions page", () => {
    const objectActions = [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: true }];
    const result = reduce({ kind: "show-geodesic-cannon-actions", cannonId: "c1", geodesicIds: ["g1"], objectActions });

    expect(result.state.menuState.page).toBe("geodesic-cannon-actions");
    expect(result.state.menuState.geodesicCannonOptions).toMatchObject({ cannonId: "c1", geodesicIds: ["g1"], objectActions });
    expect(result.effects).toEqual([sync]);
  });

  it("shows the geometry computer actions page", () => {
    const result = reduce({ kind: "show-geometry-computer-actions", computerId: "gc", available: true, targetSkewXMeters: 1 });

    expect(result.state.menuState.page).toBe("geometry-computer-actions");
    expect(result.state.menuState.geometryComputerOptions).toMatchObject({ computerId: "gc", available: true, targetSkewXMeters: 1 });
  });

  it("shows the question help hub", () => {
    const result = reduce({ kind: "show-question-help", objectId: "o", tutorialPages: pages, goalPages: [] });

    expect(result.state.menuState.page).toBe("question-help");
    expect(result.state.menuState.questionHelpOptions).toMatchObject({ objectId: "o" });
    expect(result.effects).toEqual([sync]);
  });

  it("shows the tutorial and the goal from the help hub", () => {
    const hub = {
      ...stateWith(),
      menuState: showRuntimeMenuQuestionHelp(stateWith().menuState, { objectId: "o", tutorialPages: pages, goalPages: pages }),
    };

    expect(reduce({ kind: "show-question-tutorial" }, hub).state.menuState.page).toBe("tutorial");
    expect(reduce({ kind: "show-goal" }, hub).state.menuState.page).toBe("goal");
  });

  it("steps the tutorial page and stays within its pages", () => {
    const tutorial = { ...stateWith(), menuState: showRuntimeMenuTutorial(stateWith().menuState, { objectId: "o", pages }) };
    const next = reduce({ kind: "step-tutorial-page", delta: 1 }, tutorial);

    expect(next.state.menuState.tutorialOptions?.pageIndex).toBe(1);
    expect(next.effects).toEqual([sync]);
    expect(reduce({ kind: "step-tutorial-page", delta: 1 }, next.state).state.menuState.tutorialOptions?.pageIndex).toBe(1);
    expect(reduce({ kind: "step-tutorial-page", delta: 1 })).toMatchObject({ effects: [] });
  });

  it("steps the goal page and stays within its pages", () => {
    const goal = { ...stateWith(), menuState: showRuntimeMenuGoal(stateWith().menuState, { objectId: "o", pages }) };
    const next = reduce({ kind: "step-goal-page", delta: 1 }, goal);

    expect(next.state.menuState.goalOptions?.pageIndex).toBe(1);
    expect(reduce({ kind: "step-goal-page", delta: -1 }, next.state).state.menuState.goalOptions?.pageIndex).toBe(0);
    expect(reduce({ kind: "step-goal-page", delta: 1 })).toMatchObject({ effects: [] });
  });
});

describe("applyRuntimeCommand: tools and signs", () => {
  it("selects a tool: menu closed with the tool, other tools' sessions switched off, then redraw", () => {
    const result = reduce({ kind: "select-tool", toolId: "protractor" }, stateWith({ isOpen: true }));

    expect(result.state.menuState).toMatchObject({ isOpen: false, selectedTool: "protractor" });
    expect(result.effects).toEqual([{ kind: "switch-tool-session", toolId: "protractor" }, sync]);
  });

  it("ignores a tool the app configuration disables", () => {
    const off = stateWith({ isOpen: true }, disabled({ tools: { angles: false } }));

    expect(reduce({ kind: "select-tool", toolId: "protractor" }, off)).toEqual({ state: off, effects: [] });
  });

  it("enters a tool mode: menu closed with that tool, no session reset and no gate", () => {
    const off = stateWith({ isOpen: true }, disabled({ tools: { geodesicEmitters: false } }));
    const result = reduce({ kind: "enter-tool-mode", toolId: "geodesic-cannon-carry" }, off);

    expect(result.state.menuState).toMatchObject({ isOpen: false, selectedTool: "geodesic-cannon-carry" });
    expect(result.effects).toEqual([sync]);
  });

  it("clears the selected tool without closing the page", () => {
    const result = reduce({ kind: "clear-selected-tool" }, stateWith({ isOpen: true, selectedTool: "measure-length" }));

    expect(result.state.menuState).toMatchObject({ isOpen: true, selectedTool: "none" });
    expect(result.effects).toEqual([sync]);
  });

  it("chooses the place-flag type, selects the tool and closes the menu", () => {
    const result = reduce({ kind: "choose-place-flag-type", flagType: "WoodenSign2" }, stateWith({ isOpen: true }));

    expect(result.state.menuState).toMatchObject({ isOpen: false, selectedTool: "place-flag" });
    expect(result.state.menuState.placeFlagOptions.flagType).toBe("WoodenSign2");

    const off = stateWith({}, disabled({ tools: { placeFlags: false } }));
    expect(reduce({ kind: "choose-place-flag-type", flagType: "WoodenSign2" }, off)).toEqual({ state: off, effects: [] });
  });

  it("sets and clears the id of the flag being edited", () => {
    const set = reduce({ kind: "set-editing-flag", flagId: "f" });

    expect(set.state.menuState.editingFlagId).toBe("f");
    expect(reduce({ kind: "set-editing-flag", flagId: undefined }, set.state).state.menuState.editingFlagId).toBeUndefined();
    expect(set.effects).toEqual([sync]);
  });

  it("sets the message of the sign being edited", () => {
    const editing = reduce({ kind: "show-edit-sign", flagId: "f", message: "a" }).state;

    expect(reduce({ kind: "set-editing-sign-message", message: "ab" }, editing).state.menuState.editSignOptions?.message).toBe("ab");
  });

  it("forwards sign keyboard commands to the host", () => {
    expect(reduce({ kind: "type-sign-character", character: "Q" }).effects).toEqual([{ kind: "type-sign-character", character: "Q" }]);
    expect(reduce({ kind: "backspace-sign" }).effects).toEqual([{ kind: "backspace-sign" }]);
    expect(reduce({ kind: "delete-sign" }).effects).toEqual([{ kind: "delete-sign" }]);
  });
});

describe("applyRuntimeCommand: world, config and reload", () => {
  it("selects a world: remembered, palette redrawn, then the host switches", () => {
    const result = reduce({ kind: "select-world", worldId: "torus" });

    expect(result.state.menuState.selectedWorldId).toBe("torus");
    expect(result.effects).toEqual([sync, { kind: "change-world", worldId: "torus" }]);

    const off = stateWith({}, disabled({ menu: { worldSelectionSectionEnabled: false } }));
    expect(reduce({ kind: "select-world", worldId: "torus" }, off)).toEqual({ state: off, effects: [] });
  });

  it("selects a config: remembered, palette redrawn, then the host switches", () => {
    const result = reduce({ kind: "select-config", configName: "full" });

    expect(result.state.menuState.selectedAppConfigName).toBe("full");
    expect(result.effects).toEqual([sync, { kind: "change-app-config", configName: "full" }]);

    const off = stateWith({}, disabled({ menu: { configSelectionSectionEnabled: false } }));
    expect(reduce({ kind: "select-config", configName: "full" }, off)).toEqual({ state: off, effects: [] });
  });

  it("arms the reload confirmation on the first press and reloads on the second", () => {
    const first = reduce({ kind: "press-reload", nowMs: 1000, windowMs: 2000 });

    expect(first.state.menuState.reloadConfirmUntilMs).toBe(3000);
    expect(first.effects).toEqual([sync, { kind: "arm-reload-confirmation-timer", windowMs: 2000 }]);

    const second = reduce({ kind: "press-reload", nowMs: 2500, windowMs: 2000 }, first.state);

    expect(second.state.menuState.reloadConfirmUntilMs).toBeUndefined();
    expect(second.effects).toEqual([sync, { kind: "reload-world" }]);
  });

  it("disarms the reload confirmation when its timer fires, unless it was re-armed", () => {
    const armed = reduce({ kind: "press-reload", nowMs: 1000, windowMs: 2000 }).state;

    expect(reduce({ kind: "expire-reload-confirmation", nowMs: 3000 }, armed).state.menuState.reloadConfirmUntilMs).toBeUndefined();
    expect(reduce({ kind: "expire-reload-confirmation", nowMs: 2000 }, armed)).toEqual({ state: armed, effects: [] });
  });
});

describe("applyRuntimeCommand: debug and comfort settings", () => {
  it("sets the debug switch, unless the debug section is disabled", () => {
    const on = reduce({ kind: "set-debug-enabled", enabled: true });

    expect(on.state.menuState.debugEnabled).toBe(true);
    expect(on.effects).toEqual([{ kind: "apply-debug-state" }]);

    const off = stateWith({}, disabled({ menu: { debugSectionEnabled: false } }));
    expect(reduce({ kind: "set-debug-enabled", enabled: true }, off)).toEqual({ state: off, effects: [] });
  });

  it("sets the console log level and takes the debug settings from the menu", () => {
    const result = reduce({ kind: "set-console-log-level", level: "verbose" }, reduce({ kind: "set-debug-enabled", enabled: true }).state);

    expect(result.state.menuState.consoleLogLevel).toBe("verbose");
    expect(result.state.debugSettings.debugLevel).toBe("verbose");
    expect(result.effects).toEqual([{ kind: "apply-debug-state" }]);
  });

  it("toggles a debug overlay item", () => {
    const base = stateWith({ debugOverlayItems: [] });
    const on = reduce({ kind: "toggle-debug-overlay-item", itemId: "fps", enabled: true }, base);

    expect(on.state.menuState.debugOverlayItems).toContain("fps");
    expect(reduce({ kind: "toggle-debug-overlay-item", itemId: "fps", enabled: false }, on.state).state.menuState.debugOverlayItems).not.toContain("fps");
  });

  it("sets the portal panel mode", () => {
    const result = reduce({ kind: "set-portal-panel-mode", mode: "none" });

    expect(result.state.menuState.portalPanelMode).toBe("none");
    expect(result.effects).toEqual([{ kind: "apply-debug-state" }]);
  });

  it("sets portal inspection, collision wireframes and aim outlines", () => {
    expect(reduce({ kind: "set-portal-inspection", enabled: true }).state.menuState.portalInspectionEnabled).toBe(true);
    expect(reduce({ kind: "set-collision-geometry-wireframes", enabled: true }).state.menuState.collisionGeometryWireframesEnabled).toBe(true);
    expect(reduce({ kind: "set-aim-collision-outlines", enabled: true }).state.menuState.aimCollisionOutlinesEnabled).toBe(true);
  });

  it("sets anti-nausea mode and asks the host to update the comfort vignette", () => {
    const result = reduce({ kind: "set-anti-nausea-mode", enabled: false });

    expect(result.state.menuState.antiNauseaModeEnabled).toBe(false);
    expect(result.state.vrComfortOptions.antiNauseaModeEnabled).toBe(false);
    expect(result.effects).toEqual([{ kind: "apply-comfort-state" }]);
  });

  it("mirrors debug settings that changed from outside into the menu", () => {
    const result = reduce({
      kind: "adopt-debug-settings",
      settings: { debugLevel: "verbose", portalPanelMode: "none", debugOptions: ["runtime-diagnostics"] },
    }, stateWith({ page: "settings" }));

    expect(result.state.menuState).toMatchObject({ debugEnabled: true, consoleLogLevel: "verbose", page: "settings" });
    expect(result.state.debugSettings).toEqual({ debugLevel: "verbose", portalPanelMode: "none", debugOptions: ["runtime-diagnostics"] });
    expect(result.effects).toEqual([sync]);
  });
});

describe("applyRuntimeCommand: cannon and geometry computer actions", () => {
  const settingsState = { ...stateWith(), menuState: showRuntimeMenuSettings(stateWith().menuState) };

  it("forwards each cannon action to the host when its tool is enabled", () => {
    expect(reduce({ kind: "add-geodesic-to-cannon", cannonId: "c" }).effects).toEqual([{ kind: "add-geodesic-to-cannon", cannonId: "c" }]);
    expect(reduce({ kind: "start-cannon-carry", cannonId: "c" }).effects).toEqual([{ kind: "start-cannon-carry", cannonId: "c" }]);
    const objectAction = { kind: "start-object-action", objectKind: "geodesic-cannon", objectId: "c", actionId: "tie-and-detach" } as const;
    expect(reduce(objectAction).effects).toEqual([objectAction]);
    expect(reduce({ kind: "start-cannon-rotation", cannonId: "c", geodesicId: "g" }).effects).toEqual([
      { kind: "start-cannon-rotation", cannonId: "c", geodesicId: "g" },
    ]);
    expect(reduce({ kind: "start-cannon-aim", cannonId: "c", geodesicId: "g" }).effects).toEqual([
      { kind: "start-cannon-aim", cannonId: "c", geodesicId: "g" },
    ]);
  });

  it("ignores cannon actions when emitters are disabled, but still deletes", () => {
    const off = stateWith({}, disabled({ tools: { geodesicEmitters: false } }));

    expect(reduce({ kind: "add-geodesic-to-cannon", cannonId: "c" }, off).effects).toEqual([]);
    expect(reduce({ kind: "start-cannon-carry", cannonId: "c" }, off).effects).toEqual([]);
    expect(reduce({ kind: "start-cannon-rotation", cannonId: "c" }, off).effects).toEqual([]);
    expect(reduce({ kind: "start-cannon-aim", cannonId: "c" }, off).effects).toEqual([]);
    expect(reduce({ kind: "delete-geodesic-from-cannon", cannonId: "c", geodesicId: "g" }, off).effects).toEqual([
      { kind: "delete-geodesic-from-cannon", cannonId: "c", geodesicId: "g" },
    ]);
  });

  it("forwards geometry computer actions to the host without changing the menu", () => {
    const step = reduce({ kind: "step-geometry-computer-target", computerId: "gc", axis: "a", deltaMeters: 0.5 }, settingsState);

    expect(step.effects).toEqual([{ kind: "step-geometry-computer-target", computerId: "gc", axis: "a", deltaMeters: 0.5 }]);
    expect(step.state).toBe(settingsState);
    expect(reduce({ kind: "start-geometry-computer-deformation", computerId: "gc" }).effects).toEqual([
      { kind: "start-geometry-computer-deformation", computerId: "gc" },
    ]);
  });
});

describe("applyRuntimeCommand: tool and player state", () => {
  it("flips the portal-path instance switch, and re-derives it from the debug options", () => {
    const flipped = reduce({ kind: "set-show-cell-path-renders-instances", enabled: true });

    expect(flipped.state.showCellPathRendersInstances).toBe(true);
    expect(flipped.effects).toEqual([]);

    const adopted = reduce({
      kind: "adopt-debug-settings",
      settings: { debugLevel: "basic", portalPanelMode: "none", debugOptions: ["portal-path-overlay-instances"] },
    });

    expect(adopted.state.showCellPathRendersInstances).toBe(true);
    expect(reduce({ kind: "set-debug-enabled", enabled: false }, adopted.state).state.showCellPathRendersInstances).toBe(false);
  });

  it("replaces the cannon tool state", () => {
    const result = reduce({ kind: "set-cannon-tool-state", state: { selectedCannonId: "c", activeGeodesicId: "g" } });

    expect(result.state.cannonToolState).toEqual({ selectedCannonId: "c", activeGeodesicId: "g" });
    expect(result.effects).toEqual([]);
  });

  it("replaces the protractor tool state", () => {
    const result = reduce({ kind: "set-protractor-tool-state", state: {} });

    expect(result.state.protractorToolState).toEqual({});
    expect(result.effects).toEqual([]);
  });

  it("sets and clears one module's client tool state without touching the others", () => {
    const first = reduce({ kind: "set-module-tool-state", moduleId: "geodesicModel", state: { picks: [] } });
    const second = reduce({ kind: "set-module-tool-state", moduleId: "other", state: 1 }, first.state);
    expect(second.state.moduleToolState).toEqual({ geodesicModel: { picks: [] }, other: 1 });

    const cleared = reduce({ kind: "set-module-tool-state", moduleId: "geodesicModel", state: undefined }, second.state);
    expect(cleared.state.moduleToolState).toEqual({ other: 1 });
    expect(reduce({ kind: "set-module-tool-state", moduleId: "missing", state: undefined }, cleared.state).state).toBe(cleared.state);
    expect(cleared.effects).toEqual([]);
  });

  it("records a pending tool request and clears it", () => {
    const request = { toolId: "protractor" as const, ticket: 3 };
    const pending = reduce({ kind: "set-pending-tool-request", request });

    expect(pending.state.pendingToolRequest).toBe(request);
    expect(reduce({ kind: "set-pending-tool-request", request }, pending.state).state).toBe(pending.state);
    expect(reduce({ kind: "set-pending-tool-request", request: undefined }, pending.state).state.pendingToolRequest).toBeUndefined();
  });
});
