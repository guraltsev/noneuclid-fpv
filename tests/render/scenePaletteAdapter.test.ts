/**
 * Scene palette adapter (src/render/three/palette/scenePaletteAdapter.ts): turns a `PaletteDefinition`
 * (src/ui/paletteDefinition.ts) into a Three.js object tree the VR panel renders, tagging every interactive mesh
 * with a `scenePaletteItemId` (and `scenePaletteAction` where it is clickable) that the input layer reads back.
 * This file covers only what the adapter itself decides that `PaletteDefinition` does not: which icon goes with
 * which tool and action, the on-screen sign-editing keyboard's key choice and cursor/preview layout, and
 * suppressing an action for a connected geodesic. Which options a page offers and which are disabled is
 * `createPaletteDefinition`'s decision, covered directly in `tests/ui/paletteDefinition.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  createRuntimeMenuState,
  showRuntimeMenuEditSign,
  showRuntimeMenuGeodesicCannonActions,
  showRuntimeMenuGeometryComputerActions,
} from "../../src/runtime/runtimeMenuState";
import { publicAssetUrl } from "../../src/glue/assetUrls";
import { createScenePaletteAdapter } from "../../src/render/three/palette/scenePaletteAdapter";
import { createTestPaletteDefinition } from "../support/tools";

describe("scenePaletteAdapter", () => {
  it("builds the desktop main page as the four main-menu buttons, without tool tiles", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createTestPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" })));

    const itemIds = collectPaletteItemIds(adapter.root);

    expect(itemIds).toEqual(expect.arrayContaining(["main-menu:help", "main-menu:settings", "main-menu:go-home", "main-menu:start-over"]));
    expect(itemIds.some((id) => id.startsWith("tool:"))).toBe(false);

    adapter.dispose();
  });

  it("maps each geodesic emitter action to the right icon", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: true }] },
    )));

    const imageSources = collectPaletteImageSources(adapter.root);

    expect(imageSources).toContain(publicAssetUrl("icons/aim-inverted.png"));
    expect(imageSources).toContain(publicAssetUrl("icons/carry-inverted.svg"));
    expect(imageSources).toContain(publicAssetUrl("icons/unlink-inverted.png"));

    adapter.dispose();
  });

  it("omits a contributed action when it is unavailable", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: false }] },
    )));

    expect(collectPaletteItemIds(adapter.root)).toContain("geodesic-cannon-action:tie-and-detach");
    expect(collectPaletteActionItemIds(adapter.root)).not.toContain("geodesic-cannon-action:tie-and-detach");

    adapter.dispose();
  });

  it("renders connected geodesic emitter actions with a lock segment marker", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createTestPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], connectedGeodesicIds: ["g-a"] },
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const actionIds = collectPaletteActionItemIds(adapter.root);
    const imageSources = collectPaletteImageSources(adapter.root);

    expect(itemIds).not.toContain("go-home");
    expect(itemIds).not.toContain("reload-world");
    expect(itemIds).not.toContain("geodesic-cannon-action:rotate:g-a");
    // A linked beam keeps its Aim button, greyed out and inert, with the reason under it.
    expect(itemIds).toContain("geodesic-cannon-action:aim:g-a");
    expect(itemIds).toContain("geodesic-cannon-action:delete:g-a");
    expect(actionIds).not.toContain("geodesic-cannon-action:rotate:g-a");
    expect(actionIds).not.toContain("geodesic-cannon-action:aim:g-a");
    expect(collectDisabledReasons(adapter.root)).toContain("Linked beams cannot be aimed");
    expect(actionIds).toContain("geodesic-cannon-action:delete:g-a");
    expect(imageSources).toContain(publicAssetUrl("icons/lock.png"));

    adapter.dispose();
  });


  it("renders a sign's keyboard, cursor and preview, fixed keys only, with a trash action", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    const definition = createTestPaletteDefinition(showRuntimeMenuEditSign(
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

  it("draws the shape machine as Shift and Height, a badge, presets and Reshape world", () => {
    const edits: unknown[] = [];
    const adapter = createScenePaletteAdapter({
      ...createNoopOptions(),
      onGeometryComputerEditRequested: (_computerId, change) => edits.push(change),
      onGeometryComputerStepTargetRequested: (_computerId, axis, delta) => edits.push({ step: axis, delta }),
    });
    adapter.setDefinition(createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(
      createRuntimeMenuState({ selectedWorldId: "torus" }),
      {
        computerId: "torus-geometry-computer",
        available: true,
        widthMeters: 15,
        currentSkewXMeters: 0,
        currentDepthMeters: 15,
        targetSkewXMeters: 15,
        targetDepthMeters: 15,
        startSkewXMeters: 0,
        startDepthMeters: 15,
      },
    )));

    const itemIds = collectPaletteItemIds(adapter.root);
    const texts = collectTexts(adapter.root);
    expect(itemIds).toContain("geometry-computer:same-as-start");
    expect(itemIds).toEqual(expect.arrayContaining([
      "geometry-computer:value:a", "geometry-computer:step:a:-1", "geometry-computer:step:a:1", "geometry-computer:step:b:-1", "geometry-computer:step:b:1",
      "geometry-computer:preset:square", "geometry-computer:preset:half-shift", "geometry-computer:preset:whole-shift", "geometry-computer:preset:tall",
      "geometry-computer:more", "geometry-computer:go",
    ]));
    expect(itemIds).not.toContain("geometry-computer:step:a:8");
    expect(itemIds).not.toContain("geometry-computer:key:1");
    expect(texts).toEqual(expect.arrayContaining(["Same world as the start", "Shift 15.0 m", "Height 15.0 m", "Reshape world", "More", "Square", "Tall"]));
    expect(texts).not.toContain("GO!");
    // Folded: the modulus lines are not drawn.
    expect(texts.some((text) => text.includes("modulus"))).toBe(false);

    clickItem(adapter.root, "geometry-computer:preset:tall");
    clickItem(adapter.root, "geometry-computer:value:b");
    clickItem(adapter.root, "geometry-computer:step:a:1");
    clickItem(adapter.root, "geometry-computer:more");
    expect(edits).toEqual([
      { kind: "set-target", aMeters: 0, bMeters: 30 },
      { kind: "open-entry", axis: "b" },
      { step: "a", delta: 1 },
      { kind: "toggle-more" },
    ]);
    adapter.dispose();
  });

  it("draws the number pad while a value is typed and sends its keys", () => {
    const edits: unknown[] = [];
    const adapter = createScenePaletteAdapter({ ...createNoopOptions(), onGeometryComputerEditRequested: (_computerId, change) => edits.push(change) });
    adapter.setDefinition(createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(
      createRuntimeMenuState({ selectedWorldId: "torus" }),
      {
        computerId: "torus-geometry-computer",
        available: true,
        widthMeters: 15,
        currentSkewXMeters: 0,
        currentDepthMeters: 15,
        targetSkewXMeters: 0,
        targetDepthMeters: 15,
        entryAxis: "a",
        entryText: "1",
      },
    )));

    const texts = collectTexts(adapter.root);
    expect(texts).toContain("1|");
    // The pad takes the room of the presets and the More row while a value is typed.
    expect(collectPaletteItemIds(adapter.root)).not.toContain("geometry-computer:preset:tall");
    expect(collectPaletteItemIds(adapter.root)).not.toContain("geometry-computer:more");
    for (const key of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "back", "cancel", "ok"]) {
      expect(collectPaletteItemIds(adapter.root)).toContain(`geometry-computer:key:${key}`);
    }
    clickItem(adapter.root, "geometry-computer:key:7");
    clickItem(adapter.root, "geometry-computer:key:back");
    clickItem(adapter.root, "geometry-computer:key:cancel");
    clickItem(adapter.root, "geometry-computer:key:ok");
    expect(edits).toEqual([
      { kind: "entry-digit", digit: "7" },
      { kind: "entry-backspace" },
      { kind: "entry-cancel" },
      { kind: "entry-apply" },
    ]);
    adapter.dispose();
  });

  it("draws the width and the modulus lines only when the More row is unfolded", () => {
    const draw = (moreOpen: boolean) => {
      const adapter = createScenePaletteAdapter(createNoopOptions());
      adapter.setDefinition(createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(
        createRuntimeMenuState({ selectedWorldId: "torus" }),
        { computerId: "gc", available: true, widthMeters: 15, currentSkewXMeters: 0, currentDepthMeters: 15, targetSkewXMeters: 3, targetDepthMeters: 15, moreOpen },
      )));
      const texts = collectTexts(adapter.root);
      adapter.dispose();
      return texts;
    };
    expect(draw(false).some((text) => text.includes("modulus"))).toBe(false);
    expect(draw(false)).toContain("More");
    const unfolded = draw(true);
    expect(unfolded).toContain("Less");
    expect(unfolded).toContain("Width 15.0 m, fixed");
    expect(unfolded.some((text) => text.startsWith("Target:") && text.includes("modulus"))).toBe(true);
  });

  it("renders a fundamental tile picture on geometry computer action menus", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createTestPaletteDefinition(showRuntimeMenuGeometryComputerActions(
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

function collectTexts(root: { readonly children: readonly any[] }): string[] {
  const texts: string[] = [];
  const visit = (node: { readonly children?: readonly any[]; readonly inputProperties?: any }) => {
    const value = node.inputProperties?.text;
    if (typeof value === "string") {
      texts.push(value);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return texts;
}

function clickItem(root: { readonly children: readonly any[]; readonly userData?: Record<string, unknown> }, itemId: string): void {
  const visit = (node: { readonly children?: readonly any[]; readonly userData?: Record<string, unknown> }): boolean => {
    if (node.userData?.scenePaletteItemId === itemId && typeof node.userData.scenePaletteAction === "function") {
      node.userData.scenePaletteAction();
      return true;
    }
    return (node.children ?? []).some(visit);
  };
  if (!visit(root)) {
    throw new Error(`no clickable palette item ${itemId}`);
  }
}

function collectDisabledReasons(root: { readonly children: readonly any[]; readonly userData?: Record<string, unknown> }): string[] {
  const reasons: string[] = [];
  const visit = (node: { readonly children?: readonly any[]; readonly userData?: Record<string, unknown> }) => {
    if (typeof node.userData?.scenePaletteDisabledReason === "string") {
      reasons.push(node.userData.scenePaletteDisabledReason);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return reasons;
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

function createNoopOptions(): Parameters<typeof createScenePaletteAdapter>[0] {
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
