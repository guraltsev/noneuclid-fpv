/**
 * `tests/runtime/runtimeMenuState.test.ts` — unit tier.
 *
 * `RuntimeMenuState` holds the palette's own state (open page, selected tool, debug settings, in-progress sign
 * edits, goal/tutorial page indices) separately from the scene; its `showRuntimeMenu*`/`setRuntimeMenu*` functions
 * are the only way it changes, and `createPaletteDefinition` reads it into the content a renderer-independent
 * palette displays. These tests check tool selection, each page transition and its content, derived debug settings,
 * and the fallback title/page-label shown for an empty goal or tutorial page list.
 */
import { describe, expect, it } from "vitest";
import {
  createRuntimeMenuState,
  createDebugSettingsFromRuntimeMenuState,
  selectRuntimeMenuPlaceFlagToolType,
  setRuntimeMenuAimCollisionOutlinesEnabled,
  setRuntimeMenuEditingSignMessage,
  setRuntimeMenuGoalPageIndex,
  setRuntimeMenuSelectedTool,
  setRuntimeMenuTutorialPageIndex,
  showRuntimeMenuDebugSettings,
  showRuntimeMenuGeodesicCannonActions,
  showRuntimeMenuGeometryComputerActions,
  showRuntimeMenuGoal,
  showRuntimeMenuMainPage,
  showRuntimeMenuEditSign,
  showRuntimeMenuPlaceFlagOptions,
  showRuntimeMenuQuestionHelp,
  showRuntimeMenuQuestionTutorial,
  showRuntimeMenuTutorial,
  showRuntimeMenuTutorialIndex,
  showRuntimeMenuTutorialPage,
} from "../../src/runtime/runtimeMenuState";
import { questionHelpHubBody } from "../../src/ui/paletteDefinition";
import { createTestPaletteDefinition } from "../support/tools";

describe("paged help fallback titles", () => {
  it("uses the right title for an empty goal or tutorial page list", () => {
    const base = createRuntimeMenuState({ selectedWorldId: "cube" });
    const goal = createTestPaletteDefinition({
      ...base,
      isOpen: true,
      page: "goal",
      goalOptions: { objectId: "g", pages: [], pageIndex: 0 },
    });
    const tutorial = createTestPaletteDefinition({
      ...base,
      isOpen: true,
      page: "tutorial",
      tutorialOptions: { objectId: "t", pages: [], pageIndex: 0, view: "page" },
    });

    expect(goal.content).toMatchObject({ kind: "goal", title: "Things to try", pageLabel: "0 / 0" });
    expect(tutorial.content).toMatchObject({ kind: "tutorial", title: "How to", pageLabel: "0 / 0" });
  });
});

describe("runtimeMenuState", () => {
  it("starts with no tool selected by default", () => {
    const state = createRuntimeMenuState({
      selectedWorldId: "cube",
    });

    expect(state.selectedTool).toBe("none");
  });

  it("keeps no tool selected when a caller clears the selection", () => {
    const state = createRuntimeMenuState({
      selectedWorldId: "cube",
    });

    expect(setRuntimeMenuSelectedTool(state, "none").selectedTool).toBe("none");
  });

  it("selects the place-flag tool when a flag type is selected", () => {
    const state = showRuntimeMenuPlaceFlagOptions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }));

    const next = selectRuntimeMenuPlaceFlagToolType(state, "WoodenSign2");

    expect(next.selectedTool).toBe("placedFlags/flag");
    expect(next.placeFlagOptions.flagType).toBe("WoodenSign2");
    expect(next.page).toBe("place-flag-options");
  });

  it("selects the protractor tool from the main palette", () => {
    const state = setRuntimeMenuSelectedTool(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), "geodesicMeasurements/protractor");
    const definition = createTestPaletteDefinition(state);

    expect(state.selectedTool).toBe("geodesicMeasurements/protractor");
    expect(definition.content.kind).toBe("main");
    if (definition.content.kind !== "main") {
      throw new Error("Expected main palette.");
    }
    expect(definition.content.selectedTool).toBe("geodesicMeasurements/protractor");
  });

  it("selects the measure length tool from the main palette", () => {
    const state = setRuntimeMenuSelectedTool(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), "geodesicMeasurements/length");
    const definition = createTestPaletteDefinition(state);

    expect(state.selectedTool).toBe("geodesicMeasurements/length");
    expect(definition.content.kind).toBe("main");
    if (definition.content.kind !== "main") {
      throw new Error("Expected main palette.");
    }
    expect(definition.content.selectedTool).toBe("geodesicMeasurements/length");
  });

  it("serializes the aim collision outline debug toggle", () => {
    const state = setRuntimeMenuAimCollisionOutlinesEnabled(createRuntimeMenuState({
      selectedWorldId: "cube",
      debugSettings: {
        debugLevel: "basic",
        portalPanelMode: "none",
        debugOptions: [],
      },
    }), true);

    expect(createDebugSettingsFromRuntimeMenuState(state).debugOptions).toContain("aim-collision-outlines");
    expect(createTestPaletteDefinition(showRuntimeMenuDebugSettings(state)).content).toMatchObject({
      kind: "debug-settings",
      aimCollisionOutlinesEnabled: true,
    });
  });

  it("keeps the selected tool when backing out to the main menu", () => {
    const state = setRuntimeMenuSelectedTool(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), "placedFlags/flag");

    const next = showRuntimeMenuMainPage(state);

    expect(next.page).toBe("main");
    expect(next.selectedTool).toBe("placedFlags/flag");
  });

  it("tracks the active in-game sign editor message", () => {
    const state = showRuntimeMenuEditSign(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      flagId: "sign-a",
      message: "A1",
    });

    const next = setRuntimeMenuEditingSignMessage(state, "A12");

    expect(next.isOpen).toBe(true);
    expect(next.page).toBe("edit-sign");
    expect(next.editSignOptions).toEqual({
      flagId: "sign-a",
      message: "A12",
    });
  });

  it("treats the sign editor as an object-specific menu that closes when backing out", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuEditSign(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      flagId: "sign-a",
      message: "A1",
    }));

    expect(definition.pageId).toBe("edit-sign");
    expect(definition.rightAction.id).toBe("close");
  });

  it("creates a geodesic ray emitter action menu with aim enabled", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      cannonId: "cannon-a",
      geodesicIds: ["g-a", "g-b"],
    }));

    expect(definition.pageId).toBe("geodesic-cannon-actions");
    expect(definition.rightAction.id).toBe("close");
    expect(definition.content.kind).toBe("geodesic-cannon-actions");
    if (definition.content.kind !== "geodesic-cannon-actions") {
      throw new Error("Expected geodesic cannon actions.");
    }
    expect(definition.content.addAction).toEqual({ label: "+ Add beam", disabled: false });
    expect(definition.content.objectActions).toEqual([]);
    expect(definition.content.geodesics).toEqual([
      { id: "g-a", label: "Beam 1", connected: false, connectionSymbolLabel: undefined, deleteDisabled: false, aimDisabled: false },
      { id: "g-b", label: "Beam 2", connected: false, connectionSymbolLabel: undefined, deleteDisabled: false, aimDisabled: false },
    ]);
  });

  it("lists the actions the tools contribute to the emitter page", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      cannonId: "cannon-a",
      geodesicIds: ["g-a", "g-b"],
      objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: true }],
    }));

    expect(definition.content.kind).toBe("geodesic-cannon-actions");
    if (definition.content.kind !== "geodesic-cannon-actions") {
      throw new Error("Expected geodesic cannon actions.");
    }
    expect(definition.content.objectActions).toEqual([{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: true }]);
  });

  it("uses explicit global geodesic labels in emitter action menus", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      cannonId: "cannon-b",
      geodesicIds: ["g-b"],
      geodesicLabelsById: { "g-b": "Beam 2" },
    }));

    expect(definition.content.kind).toBe("geodesic-cannon-actions");
    if (definition.content.kind !== "geodesic-cannon-actions") {
      throw new Error("Expected geodesic cannon actions.");
    }
    expect(definition.content.geodesics).toEqual([
      { id: "g-b", label: "Beam 2", connected: false, connectionSymbolLabel: undefined, deleteDisabled: false, aimDisabled: false },
    ]);
  });

  it("marks connected geodesic rows with a connection symbol label", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      cannonId: "cannon-b",
      geodesicIds: ["g-b"],
      connectedGeodesicIds: ["g-b"],
    }));

    expect(definition.content.kind).toBe("geodesic-cannon-actions");
    if (definition.content.kind !== "geodesic-cannon-actions") {
      throw new Error("Expected geodesic cannon actions.");
    }
    expect(definition.content.geodesics).toEqual([
      {
        id: "g-b",
        label: "Beam 1",
        connected: true,
        connectionSymbolLabel: "Linked beam: a beam from one laser to another",
        deleteDisabled: false,
        aimDisabled: true,
        aimDisabledReason: "Linked beams cannot be aimed",
      },
    ]);
  });

  it("creates a geometry computer action menu with world deformation controls", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(createRuntimeMenuState({
      selectedWorldId: "torus",
    }), {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 1,
      currentDepthMeters: 15,
      targetSkewXMeters: 1,
      targetDepthMeters: 20,
    }));

    expect(definition.pageId).toBe("geometry-computer-actions");
    expect(definition.rightAction.id).toBe("close");
    expect(definition.content.kind).toBe("geometry-computer-actions");
    if (definition.content.kind !== "geometry-computer-actions") {
      throw new Error("Expected geometry computer actions.");
    }
    expect(definition.content.statusLabel).toBe("Now: Shift 1.0 m, Height 15.0 m. Target: Shift 1.0 m, Height 20.0 m.");
    expect(definition.content.widthMeters).toBe(15);
    expect(definition.content.stepActions.map((action) => `${action.axis} ${action.label}`)).toEqual([
      "a -1 m",
      "a +1 m",
      "b -1 m",
      "b +1 m",
    ]);
    expect(definition.content.goAction).toEqual({ label: "Reshape world", disabled: false });
  });

  it("creates a paged tutorial menu", () => {
    const state = showRuntimeMenuTutorial(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      objectId: "startingQuestionCube",
      pages: [
        { title: "Move", body: "Use arrows." },
        { title: "Act", body: "Click things." },
      ],
    });

    const index = createTestPaletteDefinition(state);
    const firstPage = createTestPaletteDefinition(showRuntimeMenuTutorialPage(state, 0));
    const secondPage = createTestPaletteDefinition(setRuntimeMenuTutorialPageIndex(state, 1));

    expect(index.content).toMatchObject({
      kind: "tutorial",
      view: "index",
      title: "How to",
      topics: [{ pageIndex: 0, title: "Move" }, { pageIndex: 1, title: "Act" }],
    });
    expect(showRuntimeMenuTutorialIndex(showRuntimeMenuTutorialPage(state, 1)).tutorialOptions?.view).toBe("index");
    expect(firstPage.pageId).toBe("tutorial");
    expect(firstPage.rightAction.id).toBe("back");
    expect(firstPage.content).toMatchObject({
      kind: "tutorial",
      view: "page",
      title: "Move",
      body: "Use arrows.",
      pageLabel: "1 / 2",
      previousAction: { label: "Previous", disabled: true },
      nextAction: { label: "Next", disabled: false },
    });
    expect(secondPage.content).toMatchObject({
      kind: "tutorial",
      title: "Act",
      body: "Click things.",
      pageLabel: "2 / 2",
      previousAction: { label: "Previous", disabled: false },
      nextAction: { label: "Next", disabled: true },
    });
  });

  it("creates a help hub with tutorial and goal choices", () => {
    const state = showRuntimeMenuQuestionHelp(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      objectId: "startingQuestionCube",
      tutorialPages: [{ title: "Move", body: "Use arrows." }],
      goalPages: [{ title: "Goal", body: "Find a portal." }],
    });

    const hub = createTestPaletteDefinition(state);
    const tutorial = createTestPaletteDefinition(showRuntimeMenuQuestionTutorial(state));
    const goal = createTestPaletteDefinition(showRuntimeMenuGoal(state));

    expect(hub.pageId).toBe("question-help");
    expect(hub.content).toMatchObject({
      kind: "question-help",
      body: questionHelpHubBody,
      options: [
        { id: "goal", label: "Things to try", disabled: false },
        { id: "tutorial", label: "How to", disabled: false },
        { id: "discoveries", label: "Discoveries", disabled: false },
      ],
    });
    expect(tutorial.content).toMatchObject({ kind: "tutorial", title: "Move" });
    expect(goal.content).toMatchObject({ kind: "goal", title: "Goal" });
  });

  it("creates a paged goal menu", () => {
    const state = showRuntimeMenuGoal(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      objectId: "startingQuestionCube",
      pages: [
        { title: "Goal", body: "Find a portal." },
        { title: "Bonus", body: "Return home." },
      ],
    });
    const secondPage = createTestPaletteDefinition(setRuntimeMenuGoalPageIndex(state, 1));

    expect(createTestPaletteDefinition(state).content).toMatchObject({
      kind: "goal",
      title: "Goal",
      pageLabel: "1 / 2",
      previousAction: { disabled: true },
      nextAction: { disabled: false },
    });
    expect(secondPage.content).toMatchObject({
      kind: "goal",
      title: "Bonus",
      pageLabel: "2 / 2",
      previousAction: { disabled: false },
      nextAction: { disabled: true },
    });
  });

  it("formats tutorial page bodies for desktop and VR", () => {
    const state = showRuntimeMenuTutorial(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      objectId: "startingQuestionCube",
      pages: [{
        title: "Use actions",
        body: "Use primary action or trigger for the selected/default action. Use context action or side trigger for tools and object menus.",
      }],
    });

    expect(createTestPaletteDefinition(state, undefined, "desktop").content).toMatchObject({
      kind: "tutorial",
      body: "Left click uses the selected/default action. Right click opens tools and object menus.",
    });
    expect(createTestPaletteDefinition(state, undefined, "xr").content).toMatchObject({
      kind: "tutorial",
      body: "Trigger uses the selected/default action. Side trigger opens tools and object menus.",
    });
  });
});
