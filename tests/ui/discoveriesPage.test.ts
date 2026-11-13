/**
 * `tests/ui/discoveriesPage.test.ts` - unit tier.
 *
 * The Discoveries page: Help opens it with the entries the shell supplies (a command without entries does nothing), the page lists found discoveries with their name and question and the rest as "??? - teaser" lines, "Across an edge" offers the Show edges button, which toggles the same setting as the Settings switch, the header's back action returns to the help hub, and the page payload is cleared when the menu closes or returns to the main page.
 */
import { describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { defaultVrComfortOptions } from "../../src/glue/vrComfortOptions";
import { reduceRuntimeCommand } from "../../src/runtime/applyRuntimeCommand";
import type { ClientSessionState } from "../../src/runtime/clientSession";
import type { RuntimeCommand } from "../../src/runtime/runtimeCommands";
import { closeRuntimeMenu, createRuntimeMenuState, showRuntimeMenuMainPage, showRuntimeMenuQuestionHelp } from "../../src/runtime/runtimeMenuState";
import { createDiscoveryCatalog, discoveryPageEntries } from "../../src/modules/discoveries";
import { createPaletteDefinition } from "../../src/ui/paletteDefinition";
import { resolvePaletteTooltipLabel } from "../../src/ui/paletteTooltips";

const entries = discoveryPageEntries(createDiscoveryCatalog().definitions, (id) => id === "across-an-edge" || id === "new-shape");

function helpOpen(): ClientSessionState {
  const menuState = showRuntimeMenuQuestionHelp({ ...createRuntimeMenuState({ selectedWorldId: "cube" }), isOpen: true }, {
    objectId: "startingQuestionCube",
    tutorialPages: [],
    goalPages: [],
  });
  return {
    menuState,
    appConfig: defaultAppConfig,
    debugSettings: { debugLevel: "off", portalPanelMode: "none", debugOptions: [] },
    showCellPathRendersInstances: false,
    vrComfortOptions: defaultVrComfortOptions,
    cannonToolState: {},
    moduleToolState: {},
    pendingToolRequest: undefined,
  };
}

function reduce(command: RuntimeCommand, state: ClientSessionState = helpOpen()) {
  return reduceRuntimeCommand(state, command);
}

function definitionOf(state: ClientSessionState) {
  return createPaletteDefinition(state.menuState, defaultAppConfig, "desktop", 0);
}

describe("opening the Discoveries page", () => {
  it("shows the entries the shell supplies, found first-hand and teasers for the rest", () => {
    const opened = reduce({ kind: "show-discoveries", entries }).state;
    expect(opened.menuState.page).toBe("discoveries");

    const content = definitionOf(opened).content;
    expect(content.kind).toBe("discoveries");
    if (content.kind !== "discoveries") return;
    expect(content.title).toBe("Discoveries");
    expect(content.countLabel).toBe("2 of 6 found");
    expect(content.entries.map((entry) => entry.title)).toEqual([
      "Across an edge",
      "??? - there is more than one way back to where you began",
      "??? - a beam can find its way back to its own laser",
      "??? - something happens when a beam reaches a corner",
      "??? - a string made of joined beams pulls itself tight",
      "A new shape",
    ]);
    expect(content.entries[0]!.text).toBe("Which face did you land on? Was it the one you expected?");
    expect(content.entries[1]!.text).toBe("");
  });

  it("does nothing without entries and says so on a page for a world with none", () => {
    expect(reduce({ kind: "show-discoveries" }).state.menuState.page).toBe("question-help");

    const empty = reduce({ kind: "show-discoveries", entries: [] }).state;
    const content = definitionOf(empty).content;
    if (content.kind !== "discoveries") throw new Error("not the Discoveries page");
    expect(content.body).toBe("This world has nothing to discover.");
    expect(content.countLabel).toBe("");
  });

  it("goes back to the help hub and clears the payload when the menu closes or returns to main", () => {
    const opened = reduce({ kind: "show-discoveries", entries }).state;
    expect(reduce({ kind: "menu-right-action" }, opened).state.menuState.page).toBe("question-help");
    expect(closeRuntimeMenu(opened.menuState).discoveriesOptions).toBeUndefined();
    expect(showRuntimeMenuMainPage(opened.menuState).discoveriesOptions).toBeUndefined();
  });
});

describe("Show edges", () => {
  it("is offered under Across an edge only, with the invitation, and toggles with the setting", () => {
    const opened = reduce({ kind: "show-discoveries", entries }).state;
    const content = definitionOf(opened).content;
    if (content.kind !== "discoveries") throw new Error("not the Discoveries page");
    expect(content.entries[0]!.showEdges).toMatchObject({
      invitation: "Want to see where the faces are glued?",
      shown: false,
      action: { label: "Show edges", disabled: false },
    });
    expect(content.entries.slice(1).every((entry) => entry.showEdges === undefined)).toBe(true);

    const shown = reduce({ kind: "set-show-edges", enabled: true }, opened).state;
    expect(shown.menuState.showEdgesEnabled).toBe(true);
    const after = definitionOf(shown).content;
    if (after.kind !== "discoveries") throw new Error("not the Discoveries page");
    expect(after.entries[0]!.showEdges).toMatchObject({ shown: true, action: { label: "Hide edges" } });
  });

  it("is off by default and appears in Settings as a switch", () => {
    const state = helpOpen();
    expect(state.menuState.showEdgesEnabled).toBeUndefined();

    const settings = reduce({ kind: "show-settings" }).state;
    const content = definitionOf(settings).content;
    if (content.kind !== "settings") throw new Error("not the Settings page");
    expect(content.showEdgesEnabled).toBe(false);
    expect(definitionOf(reduce({ kind: "set-show-edges", enabled: true }, settings).state).content).toMatchObject({ kind: "settings", showEdgesEnabled: true });
  });

  it("has tooltips on the button and the switch", () => {
    expect(resolvePaletteTooltipLabel("discoveries:show-edges")).toContain("Show edges");
    expect(resolvePaletteTooltipLabel("show-edges-toggle")).toContain("Show edges");
  });
});
