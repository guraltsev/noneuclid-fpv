/**
 * `tests/runtime/helpSettingsCommands.test.ts` - unit tier.
 *
 * The commands behind the help that teaches and the new Settings: "Try it" takes a tool and closes the menu (and does nothing for a tool the config switches off), opening a How to card remembers it as read, the display and control steps are stored in the menu state, "Reset tips" is counted, a card of a tool stays in How to when the shell chose it against the belt, and the help payloads are cleared when the menu closes or returns to the main page.
 */
import { describe, expect, it } from "vitest";
import { defaultAppConfig, type AppConfig } from "../../src/glue/appConfig";
import { reduceRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import { defaultVrComfortOptions } from "../../src/glue/vrComfortOptions";
import type { ClientSessionState } from "../../src/runtime/clientSession";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { closeRuntimeMenu, createRuntimeMenuState, showRuntimeMenuMainPage, showRuntimeMenuQuestionHelp, type RuntimeMenuState } from "../../src/runtime/runtimeMenuState";

const pages = [
  { title: "Basics", body: "b", startHere: true },
  { title: "Laser", body: "l", toolId: "geodesicEmitters/emitter", requiresTools: ["geodesicEmitters/emitter"] },
  { title: "Map", body: "m", toolId: "worldMap/map", requiresTools: ["worldMap/map"] },
];

function stateWith(menu?: Partial<RuntimeMenuState>, appConfig: AppConfig = defaultAppConfig): ClientSessionState {
  return {
    menuState: { ...createRuntimeMenuState({ selectedWorldId: "cube" }), ...menu },
    appConfig,
    debugSettings: { debugLevel: "off", portalPanelMode: "none", debugOptions: [] },
    showCellPathRendersInstances: false,
    vrComfortOptions: defaultVrComfortOptions,
    cannonToolState: {},
    moduleToolState: {},
    pendingToolRequest: undefined,
  };
}

function reduce(command: RuntimeCommand, state: ClientSessionState = stateWith()) {
  return reduceRuntimeCommand(state, command);
}

function helpOpen(): ClientSessionState {
  return {
    ...stateWith(),
    menuState: showRuntimeMenuQuestionHelp({ ...createRuntimeMenuState({ selectedWorldId: "cube" }), isOpen: true }, {
      objectId: "o",
      tutorialPages: pages,
      goalPages: [],
      toolDisabledReasons: { "worldMap/map": "No map for this world" },
    }),
  };
}

describe("Try it", () => {
  it("takes the tool and closes the menu", () => {
    const result = reduce({ kind: "try-tool", toolId: "geodesicEmitters/emitter" }, helpOpen());

    expect(result.state.menuState).toMatchObject({ isOpen: false, page: "main", selectedTool: "geodesicEmitters/emitter" });
    expect(result.state.menuState.questionHelpOptions).toBeUndefined();
    expect(result.effects).toContainEqual({ kind: "switch-tool-session", toolId: "geodesicEmitters/emitter" });
  });

  it("does nothing for a tool the config switches off", () => {
    const config: AppConfig = { ...defaultAppConfig, tools: { ...defaultAppConfig.tools, geodesicEmitters: false } };
    const open = { ...helpOpen(), appConfig: config };
    const result = reduce({ kind: "try-tool", toolId: "geodesicEmitters/emitter" }, open);

    expect(result.state).toBe(open);
    expect(result.effects).toEqual([]);
  });
});

describe("How to cards", () => {
  it("keeps the card of a tool the shell chose, even when the world config drops the tool", () => {
    const config: AppConfig = { ...defaultAppConfig, tools: { ...defaultAppConfig.tools, worldMap: false } };
    const result = reduce({ kind: "show-question-help", objectId: "o", tutorialPages: pages, goalPages: [], toolDisabledReasons: { "worldMap/map": "No map for this world" } }, stateWith(undefined, config));
    const options = result.state.menuState.questionHelpOptions;

    expect(options?.tutorialPages.map((page) => page.title)).toEqual(["Basics", "Laser", "Map"]);
    expect(options?.toolDisabledReasons).toEqual({ "worldMap/map": "No map for this world" });
  });

  it("remembers an opened card as read, once", () => {
    const hub = helpOpen();
    const index = reduce({ kind: "show-question-tutorial" }, hub).state;
    expect(index.menuState.helpCardsRead).toBeUndefined();

    const first = reduce({ kind: "show-tutorial-page", pageIndex: 1 }, index).state;
    expect(first.menuState.helpCardsRead).toEqual(["Laser"]);
    const next = reduce({ kind: "step-tutorial-page", delta: 1 }, first).state;
    expect(next.menuState.helpCardsRead).toEqual(["Laser", "Map"]);
    const back = reduce({ kind: "step-tutorial-page", delta: -1 }, next).state;
    expect(back.menuState.helpCardsRead).toEqual(["Laser", "Map"]);
  });

  it("clears the help payloads when the menu closes or returns to the main page", () => {
    const open = helpOpen().menuState;
    expect(closeRuntimeMenu(open).questionHelpOptions).toBeUndefined();
    expect(showRuntimeMenuMainPage(open).questionHelpOptions).toBeUndefined();
  });
});

describe("Settings: display and controls", () => {
  it("stores the text size, the look steps, Invert Y and the tips reset count", () => {
    let state = stateWith();
    state = reduce({ kind: "set-text-size", size: "large" }, state).state;
    state = reduce({ kind: "set-mouse-sensitivity", level: "high" }, state).state;
    state = reduce({ kind: "set-turn-speed", level: "slow" }, state).state;
    state = reduce({ kind: "set-invert-y", enabled: true }, state).state;
    state = reduce({ kind: "reset-tips" }, state).state;
    state = reduce({ kind: "reset-tips" }, state).state;

    expect(state.menuState).toMatchObject({ textSize: "large", mouseSensitivity: "high", turnSpeed: "slow", invertYEnabled: true, tipsResetCount: 2 });
  });

  it("seeds the menu state from remembered values and leaves the defaults out", () => {
    const seeded = createRuntimeMenuState({ selectedWorldId: "cube", textSize: "small", mouseSensitivity: "medium", invertYEnabled: true, helpCardsRead: ["Basics"] });
    expect(seeded).toMatchObject({ textSize: "small", invertYEnabled: true, helpCardsRead: ["Basics"] });
    expect("mouseSensitivity" in seeded).toBe(false);
  });
});
