/**
 * `tests/render/helpSettingsPalette.test.ts` - unit tier.
 *
 * The palette pages of the help that teaches and of the new Settings, built by the scene palette adapter: the How to index shows "Start here" and a tick on an opened card, a tool card has a "Try it" button that names its tool (and is inert, with its reason, for a tool the world cannot support), the Settings page lists the controls reference and the display and control steps and calls back with the step chosen, and the palette font tokens follow the text size.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defaultStartingQuestionCubeGoalPages, defaultStartingQuestionCubeTutorialPages } from "../../src/authoring/worldBuilder";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { createScenePaletteAdapter } from "../../src/render/three/palette/scenePaletteAdapter";
import { fontPx, paletteTextScales, setPaletteTextScale } from "../../src/render/three/palette/tokens";
import {
  createRuntimeMenuState,
  markRuntimeMenuHelpCardRead,
  showRuntimeMenuQuestionHelp,
  showRuntimeMenuQuestionTutorial,
  showRuntimeMenuSettings,
  showRuntimeMenuTutorialPage,
  type RuntimeMenuState,
} from "../../src/runtime/runtimeMenuState";
import { selectHowToPages } from "../../src/ui/howToCards";
import { createPaletteDefinition } from "../../src/ui/paletteDefinition";
import { createToolBeltDefinition } from "../../src/ui/toolBeltDefinition";

type Node = { readonly children?: readonly Node[]; readonly userData?: Record<string, unknown> };

function collect(root: Node, pick: (node: Node) => unknown): unknown[] {
  const found: unknown[] = [];
  const visit = (node: Node) => {
    const value = pick(node);
    if (value !== undefined) found.push(value);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
}

function actionOf(root: Node, itemId: string): (() => void) | undefined {
  const node = collect(root, (candidate) => (candidate.userData?.scenePaletteItemId === itemId ? candidate : undefined))[0] as Node | undefined;
  const action = node?.userData?.scenePaletteAction;
  return typeof action === "function" ? (action as () => void) : undefined;
}

function noopOptions() {
  return {
    onLeftAction: () => undefined,
    onRightAction: () => undefined,
    onWorldSelected: () => undefined,
    onConfigSelected: () => undefined,
    onReloadRequested: () => undefined,
    onHomeRequested: () => undefined,
    onDebugEnabledChanged: () => undefined,
    onDebugSettingsRequested: () => undefined,
    onConsoleLogLevelSelected: () => undefined,
    onDebugOverlayToggled: () => undefined,
    onDebugOverlayItemToggled: () => undefined,
    onAntiNauseaModeToggled: () => undefined,
    onPortalPanelModeSelected: () => undefined,
    onPortalInspectionToggled: () => undefined,
    onCollisionGeometryWireframesToggled: () => undefined,
    onAimCollisionOutlinesToggled: () => undefined,
  };
}

function howToState(worldHasMap: boolean, read: readonly string[] = [], pageIndex?: number): RuntimeMenuState {
  const belt = createToolBeltDefinition({ appConfig: defaultAppConfig, worldHasMap, selectedTool: "none" });
  const howTo = selectHowToPages(defaultStartingQuestionCubeTutorialPages, belt);
  let state = showRuntimeMenuQuestionTutorial(showRuntimeMenuQuestionHelp(createRuntimeMenuState({ selectedWorldId: "cube" }), {
    objectId: "startingQuestionCube",
    tutorialPages: howTo.pages,
    goalPages: defaultStartingQuestionCubeGoalPages,
    toolDisabledReasons: howTo.toolDisabledReasons,
  }));
  for (const title of read) state = markRuntimeMenuHelpCardRead(state, title);
  if (pageIndex !== undefined) state = showRuntimeMenuTutorialPage(state, pageIndex);
  return state;
}

describe("How to on the palette", () => {
  afterEach(() => setPaletteTextScale(1));

  it("marks Basics as the place to start and ticks the cards that were opened", () => {
    const adapter = createScenePaletteAdapter(noopOptions());
    adapter.setDefinition(createPaletteDefinition(howToState(true, ["Basics"]), defaultAppConfig, "desktop", 0));

    const texts = collect(adapter.root as unknown as Node, (node) => node.userData?.scenePaletteItemId).filter((id) => String(id).startsWith("tutorial-topic:"));
    expect(texts).toHaveLength(6);
    expect(collect(adapter.root as unknown as Node, (node) => (node.userData?.scenePaletteReadTick === true ? true : undefined))).toHaveLength(1);
    adapter.dispose();
  });

  it("gives a tool card a Try it button that names its tool", () => {
    const tried: string[] = [];
    const adapter = createScenePaletteAdapter({ ...noopOptions(), onTutorialTryItRequested: (toolId) => tried.push(toolId) });
    adapter.setDefinition(createPaletteDefinition(howToState(true, [], 1), defaultAppConfig, "desktop", 0));

    actionOf(adapter.root as unknown as Node, "tutorial-try-it")?.();
    expect(tried).toEqual(["geodesicEmitters/emitter"]);
    adapter.dispose();
  });

  it("leaves Try it inert on the Map card of a world without a map, with the reason on the card", () => {
    const adapter = createScenePaletteAdapter({ ...noopOptions(), onTutorialTryItRequested: () => undefined });
    adapter.setDefinition(createPaletteDefinition(howToState(false, [], 5), defaultAppConfig, "desktop", 0));

    expect(actionOf(adapter.root as unknown as Node, "tutorial-try-it")).toBeUndefined();
    const reasons = collect(adapter.root as unknown as Node, (node) => node.userData?.scenePaletteDisabledReason);
    expect(reasons).toContain("No map for this world");
    adapter.dispose();
  });

  it("has no Try it on the Basics card", () => {
    const adapter = createScenePaletteAdapter({ ...noopOptions(), onTutorialTryItRequested: () => undefined });
    adapter.setDefinition(createPaletteDefinition(howToState(true, [], 0), defaultAppConfig, "desktop", 0));

    const ids = collect(adapter.root as unknown as Node, (node) => node.userData?.scenePaletteItemId);
    expect(ids).not.toContain("tutorial-try-it");
    adapter.dispose();
  });

  it("scales the panel's font sizes with the text size", () => {
    expect(fontPx(20)).toBe(20);
    setPaletteTextScale(paletteTextScales.large);
    expect(fontPx(20)).toBe(25);
    setPaletteTextScale(paletteTextScales.small);
    expect(fontPx(20)).toBe(17);
  });
});

describe("Settings on the palette", () => {
  it("lists the controls reference and calls back with the step chosen", () => {
    const calls: string[] = [];
    const adapter = createScenePaletteAdapter({
      ...noopOptions(),
      onMouseSensitivitySelected: (level) => calls.push(`mouse:${level}`),
      onTurnSpeedSelected: (level) => calls.push(`turn:${level}`),
      onInvertYToggled: (enabled) => calls.push(`invert:${enabled}`),
      onTextSizeSelected: (size) => calls.push(`text:${size}`),
      onShowHintsToggled: (enabled) => calls.push(`hints:${enabled}`),
      onResetTipsRequested: () => calls.push("reset-tips"),
      onXrHandOptionToggled: (option, enabled) => calls.push(`${option}:${enabled}`),
    });
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "cube" })), defaultAppConfig, "desktop", 0));

    const root = adapter.root as unknown as Node;
    actionOf(root, "mouse-sensitivity:high")?.();
    actionOf(root, "turn-speed:slow")?.();
    actionOf(root, "invert-y-toggle")?.();
    actionOf(root, "text-size:large")?.();
    actionOf(root, "show-hints-toggle")?.();
    actionOf(root, "reset-tips")?.();
    actionOf(root, "left-handed-toggle")?.();

    expect(calls).toEqual(["mouse:high", "turn:slow", "invert:true", "text:large", "hints:false", "reset-tips", "leftHanded:true"]);
    adapter.dispose();
  });

  it("generates the controls reference from the intents of the device", () => {
    const desktop = createPaletteDefinition(showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "cube" })), defaultAppConfig, "desktop", 0).content;
    const vr = createPaletteDefinition(showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "cube" })), defaultAppConfig, "xr", 0, "one-right").content;
    if (desktop.kind !== "settings" || vr.kind !== "settings") throw new Error("expected the settings page");

    expect(desktop.controlsReference.map((entry) => entry.verb)).toEqual(["Look", "Walk", "Use", "Menu", "Switch tool", "What's this?", "Main menu"]);
    expect(desktop.controlsReference.find((entry) => entry.verb === "Main menu")?.glyph.label).toBe("Esc");
    expect(vr.controlsReference.find((entry) => entry.verb === "Main menu")?.glyph.label).toBe("Hold B");
  });
});
