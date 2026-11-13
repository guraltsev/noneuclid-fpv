/**
 * `tests/ui/paletteDefinition.test.ts` â€” unit tier.
 *
 * `createPaletteDefinition` turns a `RuntimeMenuState` plus the app config into the renderer-neutral
 * `PaletteDefinition` both the desktop DOM menu and the VR panel (`scenePaletteAdapter`) draw from: which
 * options a page offers, which are disabled, and which sections the app config hides. These tests check that
 * decision directly, without going through either renderer. The scene adapter's own rendering mechanism (icon
 * lookup, the on-screen sign keyboard's key choice, suppressing an action for a connected geodesic) is covered in
 * `tests/render/scenePaletteAdapter.test.ts` instead, since none of it is decided here.
 */
import { describe, expect, it } from "vitest";
import { defaultAppConfig, normalizeAppConfig } from "../../src/glue/appConfig";
import {
  createRuntimeMenuState,
  showRuntimeMenuEditSign,
  showRuntimeMenuGeodesicCannonActions,
  showRuntimeMenuGeometryComputerActions,
  showRuntimeMenuPlaceFlagOptions,
  showRuntimeMenuQuestionHelp,
  showRuntimeMenuSettings,
  showRuntimeMenuTutorial,
} from "../../src/runtime/runtimeMenuState";
import {
  type GeodesicCannonActionsPaletteContent,
  type MainPaletteContent,
  type PlaceFlagOptionsPaletteContent,
  type QuestionHelpPaletteContent,
  type SettingsPaletteContent,
  type TutorialPaletteContent,
} from "../../src/ui/paletteDefinition";
import { createTestPaletteDefinition, createTestToolsById } from "../support/tools";

describe("createPaletteDefinition", () => {
  it("makes the main page the main menu on desktop, with no tool tiles", () => {
    const definition = createTestPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" }));
    const content = definition.content as MainPaletteContent;

    expect(content.menuActions.map((action) => action.label)).toEqual(["Help", "Settings", "Go home", "Start over"]);
    expect(content.toolOptions).toEqual([]);
  });

  it("lists only the app config's enabled main tools for VR, with no default tool", () => {
    const definition = createTestPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" }), defaultAppConfig, "xr");
    const content = definition.content as MainPaletteContent;

    expect(content.kind).toBe("main");
    const toolIds = content.toolOptions.map((tool) => tool.id);
    expect(toolIds).toContain("placedFlags/flag");
    expect(toolIds).toContain("geodesicEmitters/emitter");
    expect(toolIds).toContain("geodesicMeasurements/length");
    expect(toolIds).not.toContain("aim");
  });

  it("takes the main list from the tools whose entry says so, in the config's order", () => {
    const tools = new Map(createTestToolsById());
    const sign = tools.get("placedFlags/flag")!;
    tools.set("placedFlags/flag", { ...sign, entry: { kind: "sub-mode" } });

    const definition = createTestPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" }), defaultAppConfig, "xr", 0, tools);

    expect((definition.content as MainPaletteContent).toolOptions).toEqual([
      { id: "none", label: "Hand" },
      { id: "geodesicEmitters/emitter", label: "Laser" },
      { id: "geodesicMeasurements/length", label: "Ruler" },
      { id: "geodesicMeasurements/protractor", label: "Protractor" },
      { id: "worldMap/map", label: "Map" },
    ]);
  });

  it("lists every placed-flag type as a place-flag option", () => {
    const definition = createTestPaletteDefinition(showRuntimeMenuPlaceFlagOptions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
    ));
    const content = definition.content as PlaceFlagOptionsPaletteContent;

    expect(content.flagTypeOptions.map((option) => option.id)).toEqual(
      expect.arrayContaining(["WoodenSign1", "WoodenSign2"]),
    );
  });

  it("shows each contributed action with the availability the cannon options give it", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const available = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a"],
      objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: true }],
    })).content as GeodesicCannonActionsPaletteContent;
    const unavailable = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a"],
      objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: false }],
    })).content as GeodesicCannonActionsPaletteContent;

    expect(available.objectActions.map((action) => action.enabled)).toEqual([true]);
    expect(unavailable.objectActions.map((action) => action.enabled)).toEqual([false]);
  });

  it("marks a connected geodesic with a connection-symbol label; a free one with none", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const content = createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a", "g-b"],
      connectedGeodesicIds: ["g-a"],
    })).content as GeodesicCannonActionsPaletteContent;
    const [connected, free] = content.geodesics;

    expect(connected.connected).toBe(true);
    expect(connected.connectionSymbolLabel).toBe("Linked beam: a beam from one laser to another");
    expect(free.connected).toBe(false);
    expect(free.connectionSymbolLabel).toBeUndefined();
  });

  it("hides the world and config picker sections exactly as the app config says to", () => {
    const shown = createTestPaletteDefinition(
      showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "cube" })),
    ).content as SettingsPaletteContent;
    const hidden = createTestPaletteDefinition(
      showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "001-basic-cube" })),
      normalizeAppConfig({ optionsMenu: { configSelectionSection: false, worldSelectionSection: false } }),
    ).content as SettingsPaletteContent;

    expect(shown.worldSelectionSectionEnabled).toBe(true);
    expect(shown.configSelectionSectionEnabled).toBe(true);
    expect(hidden.worldSelectionSectionEnabled).toBe(false);
    expect(hidden.configSelectionSectionEnabled).toBe(false);
  });

  it("disables tutorial paging at the first and last page, and labels the current one", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const content = createTestPaletteDefinition(showRuntimeMenuTutorial(state, {
      objectId: "startingQuestionCube",
      pages: [
        { title: "Move", body: "Use arrows." },
        { title: "Act", body: "Click things." },
      ],
    })).content as TutorialPaletteContent;

    expect(content.pageLabel).toBe("1 / 2");
    expect(content.previousAction.disabled).toBe(true);
    expect(content.nextAction.disabled).toBe(false);
  });

  it("disables a help hub subpage exactly when it has no pages", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const content = createTestPaletteDefinition(showRuntimeMenuQuestionHelp(state, {
      objectId: "startingQuestionCube",
      tutorialPages: [{ title: "Move", body: "Use arrows." }],
      goalPages: [],
    })).content as QuestionHelpPaletteContent;

    expect(content.options.find((option) => option.id === "tutorial")?.disabled).toBe(false);
    expect(content.options.find((option) => option.id === "goal")?.disabled).toBe(true);
  });

  it("disables the geometry computer's go action until the target differs from the current shape", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "torus" });
    const unchanged = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 0,
      currentDepthMeters: 15,
      targetSkewXMeters: 0,
      targetDepthMeters: 15,
    }));
    const changed = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 0,
      currentDepthMeters: 15,
      targetSkewXMeters: 1,
      targetDepthMeters: 20,
    }));

    expect((unchanged.content as { goAction: { disabled: boolean } }).goAction.disabled).toBe(true);
    expect((changed.content as { goAction: { disabled: boolean } }).goAction.disabled).toBe(false);
  });

  it("shows the moduli of current and target", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "torus" });
    const content = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 0,
      currentDepthMeters: 15,
      targetSkewXMeters: 15,
      targetDepthMeters: 15,
      startSkewXMeters: 0,
      startDepthMeters: 15,
    })).content as { currentModuliLabel: string; targetModuliLabel: string };
    expect(content.currentModuliLabel).toContain("square");
    expect(content.currentModuliLabel).toContain("starting torus");
    expect(content.targetModuliLabel).toContain("1 Dehn twist");

    const unavailable = createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: false,
    })).content as { currentModuliLabel: string; targetModuliLabel: string };
    expect(unavailable.currentModuliLabel).toBe("");
    expect(unavailable.targetModuliLabel).toBe("");
  });

  it("keeps the edit-sign flag id and message, capped at the placed-flag message limit", () => {
    const content = createTestPaletteDefinition(showRuntimeMenuEditSign(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { flagId: "sign-a", message: "A\nB" },
    )).content;

    expect(content).toMatchObject({ kind: "edit-sign", flagId: "sign-a", message: "A\nB" });
    expect((content as { maxLength: number }).maxLength).toBeGreaterThan(0);
  });
});
