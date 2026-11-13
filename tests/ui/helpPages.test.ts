/**
 * `tests/ui/helpPages.test.ts` - unit tier.
 *
 * Help has three pages (Things to try, How to, Discoveries) and How to is generated against the world: the Basics card is marked "Start here" and comes first, the tool cards follow in belt order, a card of a tool the config switches off is left out, a card of a tool the world cannot support stays with its reason, and "Try it" is offered on the cards of tools. The sentences that depend on the config (what Settings has) and on the device (how to open the main menu) are generated.
 */
import { describe, expect, it } from "vitest";
import { defaultStartingQuestionCubeGoalPages, defaultStartingQuestionCubeTutorialPages } from "../../src/authoring/worldBuilder";
import { defaultAppConfig, type AppConfig } from "../../src/glue/appConfig";
import { createRuntimeMenuState, showRuntimeMenuQuestionHelp, showRuntimeMenuQuestionTutorial, showRuntimeMenuTutorialPage, markRuntimeMenuHelpCardRead } from "../../src/runtime/runtimeMenuState";
import { lostSentence, selectHowToPages, settingsSections } from "../../src/ui/howToCards";
import { createPaletteDefinition } from "../../src/ui/paletteDefinition";
import { createToolBeltDefinition } from "../../src/ui/toolBeltDefinition";

function howToDefinition(options: { worldHasMap: boolean; config?: AppConfig; pageIndex?: number; read?: readonly string[]; inputMode?: "desktop" | "xr" }) {
  const config = options.config ?? defaultAppConfig;
  const belt = createToolBeltDefinition({ appConfig: config, worldHasMap: options.worldHasMap, selectedTool: "none" });
  const howTo = selectHowToPages(defaultStartingQuestionCubeTutorialPages, belt);
  let state = showRuntimeMenuQuestionHelp(createRuntimeMenuState({ selectedWorldId: "cube" }), {
    objectId: "startingQuestionCube",
    tutorialPages: howTo.pages,
    goalPages: defaultStartingQuestionCubeGoalPages,
    toolDisabledReasons: howTo.toolDisabledReasons,
  });
  state = showRuntimeMenuQuestionTutorial(state);
  for (const title of options.read ?? []) state = markRuntimeMenuHelpCardRead(state, title);
  if (options.pageIndex !== undefined) state = showRuntimeMenuTutorialPage(state, options.pageIndex);
  return createPaletteDefinition(state, config, options.inputMode ?? "desktop", 0);
}

describe("Help: the three pages", () => {
  it("offers Things to try, How to and Discoveries, all three open", () => {
    const state = showRuntimeMenuQuestionHelp(createRuntimeMenuState({ selectedWorldId: "cube" }), {
      objectId: "startingQuestionCube",
      tutorialPages: defaultStartingQuestionCubeTutorialPages,
      goalPages: defaultStartingQuestionCubeGoalPages,
    });
    const hub = createPaletteDefinition(state, defaultAppConfig, "desktop", 0).content;
    expect(hub.kind).toBe("question-help");
    if (hub.kind !== "question-help") return;
    expect(hub.options.map((option) => option.label)).toEqual(["Things to try", "How to", "Discoveries"]);
    expect(hub.options[2]).toMatchObject({ id: "discoveries", disabled: false });
    expect(hub.body).toBe("Lost? Press Esc and choose Go home.");
  });

  it("writes the help hub sentence from the main-menu binding of the layout", () => {
    expect(lostSentence("desktop")).toBe("Lost? Press Esc and choose Go home.");
    expect(lostSentence("xr", "two-controllers")).toBe("Lost? Press X and choose Go home.");
    expect(lostSentence("xr")).toBe("Lost? Press X and choose Go home.");
    expect(lostSentence("xr", "one-right")).toBe("Lost? Hold B and choose Go home.");
    expect(lostSentence("xr", "one-left")).toBe("Lost? Hold Y and choose Go home.");
  });
});

describe("Help: How to is generated", () => {
  it("lists Basics first, marked Start here, then the tools in belt order", () => {
    const content = howToDefinition({ worldHasMap: true }).content;
    expect(content.kind).toBe("tutorial");
    if (content.kind !== "tutorial") return;
    expect(content.view).toBe("index");
    expect(content.topics.map((topic) => topic.title)).toEqual(["Basics", "Laser", "Ruler", "Protractor", "Sign", "Map"]);
    expect(content.topics.map((topic) => topic.startHere)).toEqual([true, false, false, false, false, false]);
    expect(content.topics.every((topic) => topic.disabledReason === undefined)).toBe(true);
  });

  it("keeps the Map card in a world without a map, with the reason", () => {
    const index = howToDefinition({ worldHasMap: false }).content;
    if (index.kind !== "tutorial") throw new Error("expected the tutorial");
    const map = index.topics.find((topic) => topic.title === "Map");
    expect(map).toMatchObject({ disabledReason: "No map for this world" });

    const card = howToDefinition({ worldHasMap: false, pageIndex: 5 }).content;
    if (card.kind !== "tutorial") throw new Error("expected the tutorial");
    expect(card).toMatchObject({ view: "page", title: "Map", toolId: "worldMap/map", disabledReason: "No map for this world" });
    expect(card.tryItAction).toMatchObject({ label: "Try it", disabled: true, disabledReason: "No map for this world" });
  });

  it("leaves out the card of a tool the config switches off", () => {
    const config: AppConfig = { ...defaultAppConfig, tools: { ...defaultAppConfig.tools, distances: false, worldMap: false } };
    const index = howToDefinition({ worldHasMap: true, config }).content;
    if (index.kind !== "tutorial") throw new Error("expected the tutorial");
    expect(index.topics.map((topic) => topic.title)).toEqual(["Basics", "Laser", "Protractor", "Sign"]);
  });

  it("offers Try it on a tool card and not on Basics, and shows a tick on a card that was opened", () => {
    const laser = howToDefinition({ worldHasMap: true, pageIndex: 1, read: ["Basics"] }).content;
    if (laser.kind !== "tutorial") throw new Error("expected the tutorial");
    expect(laser).toMatchObject({ title: "Laser", toolId: "geodesicEmitters/emitter", tryItAction: { label: "Try it", disabled: false } });
    expect(laser.imageSrc).toContain("tutorial/rays.jpg");
    expect(laser.topics[0]).toMatchObject({ title: "Basics", read: true });
    expect(laser.topics[1]).toMatchObject({ title: "Laser", read: false });

    const basics = howToDefinition({ worldHasMap: true, pageIndex: 0 }).content;
    if (basics.kind !== "tutorial") throw new Error("expected the tutorial");
    expect(basics.tryItAction).toBeUndefined();
    expect(basics.startHere).toBe(true);
  });

  it("writes what Settings has from the config, and the way to the main menu from the device", () => {
    expect(settingsSections(defaultAppConfig).slice(0, 3)).toEqual(["Controls", "Display", "Comfort"]);
    const config: AppConfig = { ...defaultAppConfig, menu: { ...defaultAppConfig.menu, debugSectionEnabled: true, worldSelectionSectionEnabled: false, configSelectionSectionEnabled: false } };
    const desktop = howToDefinition({ worldHasMap: true, pageIndex: 0, config }).content;
    if (desktop.kind !== "tutorial") throw new Error("expected the tutorial");
    expect(desktop.body).toContain("Settings has Controls, Display, Comfort and Debug.");
    expect(desktop.body).toContain("Lost? Press Esc and choose Go home.");

    const vr = howToDefinition({ worldHasMap: true, pageIndex: 0, config, inputMode: "xr" }).content;
    if (vr.kind !== "tutorial") throw new Error("expected the tutorial");
    expect(vr.body).toContain("Lost? Press X and choose Go home.");
    expect(vr.body).not.toContain("Press Esc");
  });
});
