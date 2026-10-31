import { describe, expect, it } from "vitest";
import { normalizeAppConfig } from "../../src/glue/appConfig";
import { publicAssetUrl } from "../../src/glue/assetUrls";
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
import { createScenePaletteLibraryAdapter } from "../../src/render/three/scenePaletteLibraryAdapter";
import { createPaletteDefinition } from "../../src/ui/paletteDefinition";

describe("scenePaletteLibraryAdapter", () => {
  it("renders explicit main tool tiles without a default tool tile", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" })));

    const itemIds = collectPaletteItemIds(adapter.root);
    const imageSources = collectPaletteImageSources(adapter.root);

    expect(itemIds).not.toContain("tool:aim");
    expect(itemIds).toContain("settings");
    expect(itemIds).toContain("close");
    expect(itemIds).toContain("go-home");
    expect(itemIds).toContain("reload-world");
    expect(itemIds).toContain("tool:place-flag");
    expect(itemIds).toContain("tool:geodesic-cannon");
    expect(itemIds).toContain("tool:measure-length");
    expect(itemIds).toContain("tool-options:place-sign");
    expect(imageSources).toContain(publicAssetUrl("WoodenSign1/WoodenSign1.png"));
    expect(imageSources).toContain(publicAssetUrl("flashlight/Lightsaber.png"));
    expect(imageSources).toContain(publicAssetUrl("icons/ruler-inverted.svg"));
    expect(imageSources).toContain(publicAssetUrl("icons/protractor.png"));

    adapter.dispose();
  });

  it("renders place sign options", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuPlaceFlagOptions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const imageSources = collectPaletteImageSources(adapter.root);

    expect(itemIds).not.toContain("go-home");
    expect(itemIds).not.toContain("reload-world");
    expect(itemIds).toContain("sign-type:WoodenSign1");
    expect(itemIds).toContain("sign-type:WoodenSign2");
    expect(imageSources).toContain(publicAssetUrl("WoodenSign1/WoodenSign1.png"));
    expect(imageSources).toContain(publicAssetUrl("WoodenSign2/WoodenSign2.png"));

    adapter.dispose();
  });

  it("renders geodesic ray emitter actions with aim only for unlocked geodesics", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], canTieAndDetach: true },
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const actionIds = collectPaletteActionItemIds(adapter.root);
    const imageSources = collectPaletteImageSources(adapter.root);

    expect(itemIds).not.toContain("go-home");
    expect(itemIds).not.toContain("reload-world");
    expect(itemIds).toContain("geodesic-cannon-action:add-geodesic");
    expect(itemIds).toContain("geodesic-cannon-action:carry");
    expect(itemIds).toContain("geodesic-cannon-action:tie-and-detach");
    expect(itemIds).not.toContain("geodesic-cannon-action:rotate:g-a");
    expect(itemIds).toContain("geodesic-cannon-action:aim:g-a");
    expect(itemIds).toContain("geodesic-cannon-action:delete:g-a");
    expect(actionIds).toContain("geodesic-cannon-action:add-geodesic");
    expect(actionIds).toContain("geodesic-cannon-action:carry");
    expect(actionIds).toContain("geodesic-cannon-action:tie-and-detach");
    expect(actionIds).not.toContain("geodesic-cannon-action:rotate:g-a");
    expect(actionIds).toContain("geodesic-cannon-action:aim:g-a");
    expect(actionIds).toContain("geodesic-cannon-action:delete:g-a");
    expect(imageSources).toContain(publicAssetUrl("icons/aim-inverted.png"));
    expect(imageSources).toContain(publicAssetUrl("icons/carry-inverted.svg"));
    expect(imageSources).toContain(publicAssetUrl("icons/unlink-inverted.png"));

    adapter.dispose();
  });

  it("omits the tie-and-detach action when it is unavailable", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], canTieAndDetach: false },
    )));

    expect(collectPaletteItemIds(adapter.root)).toContain("geodesic-cannon-action:tie-and-detach");
    expect(collectPaletteActionItemIds(adapter.root)).not.toContain("geodesic-cannon-action:tie-and-detach");

    adapter.dispose();
  });

  it("renders locked geodesic emitter actions with a lock segment marker", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], lockedGeodesicIds: ["g-a"] },
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const actionIds = collectPaletteActionItemIds(adapter.root);
    const imageSources = collectPaletteImageSources(adapter.root);

    expect(itemIds).not.toContain("go-home");
    expect(itemIds).not.toContain("reload-world");
    expect(itemIds).not.toContain("geodesic-cannon-action:rotate:g-a");
    expect(itemIds).not.toContain("geodesic-cannon-action:aim:g-a");
    expect(itemIds).toContain("geodesic-cannon-action:delete:g-a");
    expect(actionIds).not.toContain("geodesic-cannon-action:rotate:g-a");
    expect(actionIds).not.toContain("geodesic-cannon-action:aim:g-a");
    expect(actionIds).toContain("geodesic-cannon-action:delete:g-a");
    expect(imageSources).toContain(publicAssetUrl("icons/lock.png"));

    adapter.dispose();
  });


  it("renders sign editing with fixed number, QWERTY, space, enter, backspace, cursor, and trash controls", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    const definition = createPaletteDefinition(showRuntimeMenuEditSign(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { flagId: "sign-a", message: "A\nB" },
    ));
    adapter.setDefinition(definition);

    const itemIds = collectPaletteItemIds(adapter.root);
    const previewLines = collectSignPreviewLines(adapter.root);

    expect(definition.rightAction.id).toBe("close");
    expect(itemIds).not.toContain("go-home");
    expect(itemIds).not.toContain("reload-world");
    expect(previewLines).toEqual(["A", "B|", ""]);
    expect(itemIds).toContain("sign-key:1");
    expect(itemIds).toContain("sign-key:0");
    expect(itemIds).toContain("sign-key:Q");
    expect(itemIds).toContain("sign-key:M");
    expect(itemIds).toContain("sign-key:Enter");
    expect(itemIds).toContain("sign-key:Space");
    expect(itemIds).toContain("sign-key:Backspace");
    expect(itemIds).toContain("sign-action:trash");
    expect(itemIds).not.toContain("sign-key:Erase");
    expect(itemIds).not.toContain("sign-key:Shift");
    expect(itemIds).not.toContain("sign-key:CapsLock");
    expect(itemIds).not.toContain("sign-key:Ctrl");
    expect(itemIds).not.toContain("sign-key:Alt");
    expect(itemIds).not.toContain("sign-key:ArrowLeft");
    expect(itemIds).not.toContain("sign-key:ArrowRight");

    adapter.dispose();
  });

  it("renders a fundamental tile picture on geometry computer action menus", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuGeometryComputerActions(
      createRuntimeMenuState({ selectedWorldId: "torus" }),
      {
        computerId: "torus-geometry-computer",
        available: true,
        widthMeters: 15,
        currentSkewXMeters: 0,
        currentDepthMeters: 15,
        targetSkewXMeters: 1,
        targetDepthMeters: 20,
      },
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const imageSources = collectPaletteImageSources(adapter.root);
    const diagramPoints = collectGeometryComputerDiagramWorldPoints(adapter.root);

    expect(itemIds).not.toContain("go-home");
    expect(itemIds).not.toContain("reload-world");
    expect(itemIds).toContain("geometry-computer:diagram");
    expect(imageSources).toContain("world-deformation-parallelogram");
    expect(diagramPoints).toEqual({
      current: [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 15, y: 15 },
        { x: 0, y: 15 },
      ],
      target: [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 16, y: 20 },
        { x: 1, y: 20 },
      ],
    });

    adapter.dispose();
  });

  it("renders tutorial paging controls", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuTutorial(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      {
        objectId: "startingQuestionCube",
        pages: [
          { title: "Move", body: "Use arrows." },
          { title: "Act", body: "Click things." },
        ],
      },
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const actionIds = collectPaletteActionItemIds(adapter.root);

    expect(itemIds).not.toContain("go-home");
    expect(itemIds).not.toContain("reload-world");
    expect(itemIds).toContain("tutorial:previous");
    expect(itemIds).toContain("tutorial:next");
    expect(actionIds).not.toContain("tutorial:previous");
    expect(actionIds).toContain("tutorial:next");

    adapter.dispose();
  });

  it("renders help hub choices", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuQuestionHelp(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      {
        objectId: "startingQuestionCube",
        tutorialPages: [{ title: "Move", body: "Use arrows." }],
        goalPages: [{ title: "Goal", body: "Find a portal." }],
      },
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const actionIds = collectPaletteActionItemIds(adapter.root);

    expect(itemIds).toContain("question-help:tutorial");
    expect(itemIds).toContain("question-help:goal");
    expect(actionIds).toContain("question-help:tutorial");
    expect(actionIds).toContain("question-help:goal");

    adapter.dispose();
  });

  it("renders world and config choices in settings", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuSettings(
      createRuntimeMenuState({ selectedWorldId: "cube", selectedAppConfigName: "full" }),
    )));

    const itemIds = collectPaletteItemIds(adapter.root);

    expect(itemIds).toContain("config:default");
    expect(itemIds).toContain("config:full");
    expect(itemIds).toContain("config:001");
    expect(itemIds).toContain("config:002");
    expect(itemIds).toContain("config:003");
    expect(itemIds).toContain("world:cube");
    expect(itemIds).toContain("world:torus");
    expect(itemIds).toContain("world:torus-moduli");

    adapter.dispose();
  });

  it("hides world and config choices when the active config disables those settings sections", () => {
    const adapter = createScenePaletteLibraryAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(
      showRuntimeMenuSettings(createRuntimeMenuState({ selectedWorldId: "001-basic-cube" })),
      normalizeAppConfig({
        optionsMenu: {
          configSelectionSection: false,
          worldSelectionSection: false,
        },
      }),
    ));

    const itemIds = collectPaletteItemIds(adapter.root);

    expect(itemIds).not.toContain("world:cube");
    expect(itemIds).not.toContain("world:torus");
    expect(itemIds).not.toContain("config:default");
    expect(itemIds).not.toContain("config:full");

    adapter.dispose();
  });
});

function collectPaletteItemIds(root: { readonly children: readonly any[]; readonly userData?: Record<string, unknown> }): string[] {
  const ids: string[] = [];
  const visit = (node: { readonly children?: readonly any[]; readonly userData?: Record<string, unknown> }) => {
    if (typeof node.userData?.scenePaletteItemId === "string") {
      ids.push(node.userData.scenePaletteItemId);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return ids;
}

function collectPaletteImageSources(root: { readonly children: readonly any[]; readonly userData?: Record<string, unknown> }): string[] {
  const sources: string[] = [];
  const visit = (node: { readonly children?: readonly any[]; readonly userData?: Record<string, unknown> }) => {
    const src = node.userData?.scenePaletteIconSrc;
    if (typeof src === "string") {
      sources.push(src);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return sources;
}

function collectPaletteActionItemIds(root: { readonly children: readonly any[]; readonly userData?: Record<string, unknown> }): string[] {
  const ids: string[] = [];
  const visit = (node: { readonly children?: readonly any[]; readonly userData?: Record<string, unknown> }) => {
    if (
      typeof node.userData?.scenePaletteItemId === "string" &&
      typeof node.userData?.scenePaletteAction === "function"
    ) {
      ids.push(node.userData.scenePaletteItemId);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return ids;
}

function collectGeometryComputerDiagramWorldPoints(
  root: { readonly children: readonly any[]; readonly userData?: Record<string, unknown> },
): unknown {
  let points: unknown;
  const visit = (node: { readonly children?: readonly any[]; readonly userData?: Record<string, unknown> }) => {
    points ??= node.userData?.scenePaletteDiagramWorldPoints;
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return points;
}

function collectSignPreviewLines(root: { readonly children: readonly any[]; readonly userData?: Record<string, unknown> }): string[] {
  const lines: { readonly index: number; readonly text: string }[] = [];
  const visit = (node: { readonly children?: readonly any[]; readonly userData?: Record<string, unknown> }) => {
    if (
      typeof node.userData?.scenePaletteSignPreviewLine === "number" &&
      typeof node.userData?.scenePaletteSignPreviewText === "string"
    ) {
      lines.push({
        index: node.userData.scenePaletteSignPreviewLine,
        text: node.userData.scenePaletteSignPreviewText,
      });
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return lines.sort((left, right) => left.index - right.index).map((line) => line.text);
}

function createNoopOptions(): Parameters<typeof createScenePaletteLibraryAdapter>[0] {
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
    onToolSelected: () => undefined,
    onPlaceFlagOptionsRequested: () => undefined,
    onPlaceFlagTypeSelected: () => undefined,
    onSignKeyboardCharacter: () => undefined,
    onSignKeyboardBackspace: () => undefined,
    onSignDeleteRequested: () => undefined,
  };
}
