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
} from "../../src/runtime/runtimeMenuState";
import { createPaletteDefinition, questionHelpHubBody } from "../../src/ui/paletteDefinition";

describe("paged help fallback titles", () => {
  it("uses the right title for an empty goal or tutorial page list", () => {
    const base = createRuntimeMenuState({ selectedWorldId: "cube" });
    const goal = createPaletteDefinition({
      ...base,
      isOpen: true,
      page: "goal",
      goalOptions: { objectId: "g", pages: [], pageIndex: 0 },
    });
    const tutorial = createPaletteDefinition({
      ...base,
      isOpen: true,
      page: "tutorial",
      tutorialOptions: { objectId: "t", pages: [], pageIndex: 0 },
    });

    expect(goal.content).toMatchObject({ kind: "goal", title: "Goal", pageLabel: "0 / 0" });
    expect(tutorial.content).toMatchObject({ kind: "tutorial", title: "Tutorial", pageLabel: "0 / 0" });
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

    expect(next.selectedTool).toBe("place-flag");
    expect(next.placeFlagOptions.flagType).toBe("WoodenSign2");
    expect(next.page).toBe("place-flag-options");
  });

  it("selects the protractor tool from the main palette", () => {
    const state = setRuntimeMenuSelectedTool(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), "protractor");
    const definition = createPaletteDefinition(state);

    expect(state.selectedTool).toBe("protractor");
    expect(definition.content.kind).toBe("main");
    if (definition.content.kind !== "main") {
      throw new Error("Expected main palette.");
    }
    expect(definition.content.selectedTool).toBe("protractor");
  });

  it("selects the measure length tool from the main palette", () => {
    const state = setRuntimeMenuSelectedTool(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), "measure-length");
    const definition = createPaletteDefinition(state);

    expect(state.selectedTool).toBe("measure-length");
    expect(definition.content.kind).toBe("main");
    if (definition.content.kind !== "main") {
      throw new Error("Expected main palette.");
    }
    expect(definition.content.selectedTool).toBe("measure-length");
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
    expect(createPaletteDefinition(showRuntimeMenuDebugSettings(state)).content).toMatchObject({
      kind: "debug-settings",
      aimCollisionOutlinesEnabled: true,
    });
  });

  it("clears the selected tool when backing out to the main menu", () => {
    const state = setRuntimeMenuSelectedTool(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), "place-flag");

    const next = showRuntimeMenuMainPage(state);

    expect(next.page).toBe("main");
    expect(next.selectedTool).toBe("none");
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
    const definition = createPaletteDefinition(showRuntimeMenuEditSign(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      flagId: "sign-a",
      message: "A1",
    }));

    expect(definition.pageId).toBe("edit-sign");
    expect(definition.rightAction.id).toBe("close");
  });

  it("creates a geodesic ray emitter action menu with aim enabled", () => {
    const definition = createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
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
    expect(definition.content.addAction).toEqual({ label: "Add geodesic", disabled: false });
    expect(definition.content.tieAndDetachAction).toEqual({ label: "Tie & detach", disabled: true });
    expect(definition.content.geodesics).toEqual([
      { id: "g-a", label: "G1", locked: false, connectionSymbolLabel: undefined, deleteDisabled: false },
      { id: "g-b", label: "G2", locked: false, connectionSymbolLabel: undefined, deleteDisabled: false },
    ]);
  });

  it("enables tie and detach when the selected emitter has selectable endpoint roles", () => {
    const definition = createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      cannonId: "cannon-a",
      geodesicIds: ["g-a", "g-b"],
      canTieAndDetach: true,
    }));

    expect(definition.content.kind).toBe("geodesic-cannon-actions");
    if (definition.content.kind !== "geodesic-cannon-actions") {
      throw new Error("Expected geodesic cannon actions.");
    }
    expect(definition.content.tieAndDetachAction).toEqual({ label: "Tie & detach", disabled: false });
  });

  it("uses explicit global geodesic labels in emitter action menus", () => {
    const definition = createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      cannonId: "cannon-b",
      geodesicIds: ["g-b"],
      geodesicLabelsById: { "g-b": "G2" },
    }));

    expect(definition.content.kind).toBe("geodesic-cannon-actions");
    if (definition.content.kind !== "geodesic-cannon-actions") {
      throw new Error("Expected geodesic cannon actions.");
    }
    expect(definition.content.geodesics).toEqual([
      { id: "g-b", label: "G2", locked: false, connectionSymbolLabel: undefined, deleteDisabled: false },
    ]);
  });

  it("marks locked geodesic rows with a connection symbol label", () => {
    const definition = createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(createRuntimeMenuState({
      selectedWorldId: "cube",
    }), {
      cannonId: "cannon-b",
      geodesicIds: ["g-b"],
      lockedGeodesicIds: ["g-b"],
    }));

    expect(definition.content.kind).toBe("geodesic-cannon-actions");
    if (definition.content.kind !== "geodesic-cannon-actions") {
      throw new Error("Expected geodesic cannon actions.");
    }
    expect(definition.content.geodesics).toEqual([
      {
        id: "g-b",
        label: "G1",
        locked: true,
        connectionSymbolLabel: "Locked geodesic segment between emitters",
        deleteDisabled: false,
      },
    ]);
  });

  it("creates a geometry computer action menu with world deformation controls", () => {
    const definition = createPaletteDefinition(showRuntimeMenuGeometryComputerActions(createRuntimeMenuState({
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
    expect(definition.content.statusLabel).toBe("Current (1 m, 15 m) / target (1 m, 20 m)");
    expect(definition.content.widthMeters).toBe(15);
    expect(definition.content.stepActions.map((action) => action.label)).toEqual([
      "A -8 m",
      "A -1 m",
      "A +1 m",
      "A +8 m",
      "B -8 m",
      "B -1 m",
      "B +1 m",
      "B +8 m",
    ]);
    expect(definition.content.goAction).toEqual({ label: "GO!", disabled: false });
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

    const firstPage = createPaletteDefinition(state);
    const secondPage = createPaletteDefinition(setRuntimeMenuTutorialPageIndex(state, 1));

    expect(firstPage.pageId).toBe("tutorial");
    expect(firstPage.rightAction.id).toBe("back");
    expect(firstPage.content).toMatchObject({
      kind: "tutorial",
      title: "Move",
      body: "Use arrows.",
      pageLabel: "1 / 2",
      previousAction: { label: "<", disabled: true },
      nextAction: { label: ">", disabled: false },
    });
    expect(secondPage.content).toMatchObject({
      kind: "tutorial",
      title: "Act",
      body: "Click things.",
      pageLabel: "2 / 2",
      previousAction: { label: "<", disabled: false },
      nextAction: { label: ">", disabled: true },
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

    const hub = createPaletteDefinition(state);
    const tutorial = createPaletteDefinition(showRuntimeMenuQuestionTutorial(state));
    const goal = createPaletteDefinition(showRuntimeMenuGoal(state));

    expect(hub.pageId).toBe("question-help");
    expect(hub.content).toMatchObject({
      kind: "question-help",
      body: questionHelpHubBody,
      options: [
        { id: "tutorial", label: "Tutorial", disabled: false },
        { id: "goal", label: "Goal", disabled: false },
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
    const secondPage = createPaletteDefinition(setRuntimeMenuGoalPageIndex(state, 1));

    expect(createPaletteDefinition(state).content).toMatchObject({
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

    expect(createPaletteDefinition(state, undefined, "desktop").content).toMatchObject({
      kind: "tutorial",
      body: "Left click uses the selected/default action. Right click opens tools and object menus.",
    });
    expect(createPaletteDefinition(state, undefined, "xr").content).toMatchObject({
      kind: "tutorial",
      body: "Trigger uses the selected/default action. Side trigger opens tools and object menus.",
    });
  });
});
