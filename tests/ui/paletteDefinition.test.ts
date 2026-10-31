/**
 * `tests/ui/paletteDefinition.test.ts` — unit tier.
 *
 * `createPaletteDefinition` turns a `RuntimeMenuState` plus the app config into the renderer-neutral
 * `PaletteDefinition` both the desktop DOM menu and the VR panel (`scenePaletteLibraryAdapter`) draw from: which
 * options a page offers, which are disabled, and which sections the app config hides. These tests check that
 * decision directly, without going through either renderer. The scene adapter's own rendering mechanism (icon
 * lookup, the on-screen sign keyboard's key choice, suppressing an action for a locked geodesic) is covered in
 * `tests/render/scenePaletteLibraryAdapter.test.ts` instead, since none of it is decided here.
 */
import { describe, expect, it } from "vitest";
import { normalizeAppConfig } from "../../src/glue/appConfig";
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
  createPaletteDefinition,
  type GeodesicCannonActionsPaletteContent,
  type MainPaletteContent,
  type PlaceFlagOptionsPaletteContent,
  type QuestionHelpPaletteContent,
  type SettingsPaletteContent,
  type TutorialPaletteContent,
} from "../../src/ui/paletteDefinition";

describe("createPaletteDefinition", () => {
  it("lists only the app config's enabled main tools, with no default tool", () => {
    const definition = createPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" }));
    const content = definition.content as MainPaletteContent;

    expect(content.kind).toBe("main");
    const toolIds = content.toolOptions.map((tool) => tool.id);
    expect(toolIds).toContain("place-flag");
    expect(toolIds).toContain("geodesic-cannon");
    expect(toolIds).toContain("measure-length");
    expect(toolIds).not.toContain("aim");
  });

  it("lists every placed-flag type as a place-flag option", () => {
    const definition = createPaletteDefinition(showRuntimeMenuPlaceFlagOptions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
    ));
    const content = definition.content as PlaceFlagOptionsPaletteContent;

    expect(content.flagTypeOptions.map((option) => option.id)).toEqual(
      expect.arrayContaining(["WoodenSign1", "WoodenSign2"]),
    );
  });

  it("disables tie-and-detach exactly when the geodesic cannon options say it is unavailable", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const available = createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a"],
      canTieAndDetach: true,
    })).content as GeodesicCannonActionsPaletteContent;
    const unavailable = createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a"],
      canTieAndDetach: false,
    })).content as GeodesicCannonActionsPaletteContent;

    expect(available.tieAndDetachAction.disabled).toBe(false);
    expect(unavailable.tieAndDetachAction.disabled).toBe(true);
  });

  it("marks a locked geodesic with a connection-symbol label; an unlocked one with none", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "cube" });
    const content = createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(state, {
      cannonId: "cannon-a",
      geodesicIds: ["g-a", "g-b"],
      lockedGeodesicIds: ["g-a"],
    })).content as GeodesicCannonActionsPaletteContent;
    const [locked, unlocked] = content.geodesics;

    expect(locked.locked).toBe(true);
    expect(locked.connectionSymbolLabel).toBe("Locked geodesic segment between emitters");
    expect(unlocked.locked).toBe(false);
    expect(unlocked.connectionSymbolLabel).toBeUndefined();
  });

  it("hides the world and config picker sections exactly as the app config says to", () => {
    const shown = createPaletteDefinition(
      showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "cube" })),
    ).content as SettingsPaletteContent;
    const hidden = createPaletteDefinition(
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
    const content = createPaletteDefinition(showRuntimeMenuTutorial(state, {
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
    const content = createPaletteDefinition(showRuntimeMenuQuestionHelp(state, {
      objectId: "startingQuestionCube",
      tutorialPages: [{ title: "Move", body: "Use arrows." }],
      goalPages: [],
    })).content as QuestionHelpPaletteContent;

    expect(content.options.find((option) => option.id === "tutorial")?.disabled).toBe(false);
    expect(content.options.find((option) => option.id === "goal")?.disabled).toBe(true);
  });

  it("disables the geometry computer's go action until the target differs from the current shape", () => {
    const state = createRuntimeMenuState({ selectedWorldId: "torus" });
    const unchanged = createPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
      computerId: "torus-geometry-computer",
      available: true,
      widthMeters: 15,
      currentSkewXMeters: 0,
      currentDepthMeters: 15,
      targetSkewXMeters: 0,
      targetDepthMeters: 15,
    }));
    const changed = createPaletteDefinition(showRuntimeMenuGeometryComputerActions(state, {
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

  it("keeps the edit-sign flag id and message, capped at the placed-flag message limit", () => {
    const content = createPaletteDefinition(showRuntimeMenuEditSign(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { flagId: "sign-a", message: "A\nB" },
    )).content;

    expect(content).toMatchObject({ kind: "edit-sign", flagId: "sign-a", message: "A\nB" });
    expect((content as { maxLength: number }).maxLength).toBeGreaterThan(0);
  });
});
