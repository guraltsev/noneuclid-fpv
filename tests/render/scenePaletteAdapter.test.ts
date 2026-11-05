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
import { createPaletteDefinition } from "../../src/ui/paletteDefinition";

describe("scenePaletteAdapter", () => {
  it("maps each main tool and its nested options to the right icon", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" })));

    const itemIds = collectPaletteItemIds(adapter.root);
    const imageSources = collectPaletteImageSources(adapter.root);

    expect(itemIds).toContain("tool-options:place-sign");
    expect(imageSources).toContain(publicAssetUrl("WoodenSign1/WoodenSign1.png"));
    expect(imageSources).toContain(publicAssetUrl("flashlight/Lightsaber.png"));
    expect(imageSources).toContain(publicAssetUrl("icons/ruler-inverted.svg"));
    expect(imageSources).toContain(publicAssetUrl("icons/protractor.png"));

    adapter.dispose();
  });

  it("maps each geodesic emitter action to the right icon", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
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
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId: "tie-and-detach", tooltip: "Tie them", enabled: false }] },
    )));

    expect(collectPaletteItemIds(adapter.root)).toContain("geodesic-cannon-action:tie-and-detach");
    expect(collectPaletteActionItemIds(adapter.root)).not.toContain("geodesic-cannon-action:tie-and-detach");

    adapter.dispose();
  });

  it("renders connected geodesic emitter actions with a lock segment marker", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
    adapter.setDefinition(createPaletteDefinition(showRuntimeMenuGeodesicCannonActions(
      createRuntimeMenuState({ selectedWorldId: "cube" }),
      { cannonId: "cannon-a", geodesicIds: ["g-a"], connectedGeodesicIds: ["g-a"] },
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


  it("renders a sign's keyboard, cursor and preview, fixed keys only, with a trash action", () => {
    const adapter = createScenePaletteAdapter(createNoopOptions());
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
    const adapter = createScenePaletteAdapter(createNoopOptions());
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
