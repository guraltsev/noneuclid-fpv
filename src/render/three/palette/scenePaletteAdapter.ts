/**
 * Builds the in-scene tool palette panel as a @pmndrs/uikit component tree from a renderer-neutral PaletteDefinition (src/ui/paletteDefinition.ts).
 * The adapter is purely a view: it lays out a header (left action, utility and contextual buttons, right action) and a page body chosen by definition.content.kind,
 * and turns every clickable element into a Container whose userData carries the action callback and an item id. scenePaletteController.ts ray-casts the panel and reads those userData keys;
 * it activates the first ancestor with scenePaletteAction and looks up the tooltip from scenePaletteItemId.
 * Layout units are uikit pixels on a 980x760 panel (scenePaletteLayout.ts); scenePalettePanelPixelSize converts them to meters, so the root Container is a flat panel in its own local frame with +Z as the front.
 * The same adapter serves the XR and the desktop palette. This module assembles the pieces (header.ts, pages/*.ts, widgets.ts, icons.ts, latticeDiagram.ts);
 * content is rebuilt wholesale on each setDefinition (no diffing), and disposal of the previous uikit tree is handled by widgets.ts.
 */
import { Container } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../ui/paletteDefinition";
import { scenePalettePanelHeightPixels, scenePalettePanelPixelSize, scenePalettePanelWidthPixels } from "../scenePaletteLayout";
import type { ScenePaletteAdapter, ScenePaletteAdapterOptions } from "./adapterTypes";
import { borderColor, panelPadding, surfaceColor, textColor, toPanelText } from "./tokens";
import { disposeRenderedChildren } from "./widgets";
import { buildHeader } from "./header";
import { buildMainContent } from "./pages/main";
import { buildGeodesicCannonActionsContent } from "./pages/geodesicActions";
import { buildGeometryComputerActionsContent } from "./pages/geometryComputer";
import { buildDiscoveriesContent } from "./pages/discoveries";
import { buildPagedHelpContent, buildQuestionHelpContent } from "./pages/help";
import { buildEditSignContent, buildPlaceSignOptionsContent } from "./pages/signs";
import { buildMeasurementActionsContent } from "./pages/measurements";
import { buildDebugSettingsContent, buildSettingsContent, type SettingsCategoryId } from "./pages/debugSettings";

/**
 * Creates the in-scene palette panel: an empty, hidden uikit root at the standard palette size, ready for setDefinition.
 * The root uses depthTest/depthWrite off with a high renderOrder so the panel draws over world geometry, and accepts only "ray" pointer events.
 * The caller owns the adapter and must call dispose(); until setDefinition is called the panel has no content.
 */
export function createScenePaletteAdapter(options: ScenePaletteAdapterOptions): ScenePaletteAdapter {
  // Header and body currently attached to root; tracked so they can be disposed on the next setDefinition.
  let renderedChildren: Container[] = [];
  // The Settings category shown in its sidebar: view state of this panel, kept while the panel lives so Settings reopens where it was left.
  let settingsCategory: SettingsCategoryId | undefined;
  let currentDefinition: PaletteDefinition | undefined;
  // Set when a sidebar category was chosen; the page is rebuilt on the next update, outside the pointer dispatch that chose it.
  let rebuildRequested = false;
  const root = new Container({
    width: scenePalettePanelWidthPixels,
    height: scenePalettePanelHeightPixels,
    pixelSize: scenePalettePanelPixelSize,
    flexDirection: "column",
    borderRadius: 28,
    padding: panelPadding,
    gap: 18,
    backgroundColor: surfaceColor,
    color: textColor,
    fill: textColor,
    opacity: 1,
    overflow: "hidden",
    pointerEvents: "auto",
    borderColor,
    borderWidth: 2,
    renderOrder: 999,
    depthTest: false,
    depthWrite: false,
  });
  root.name = "vr-tool-palette";
  root.visible = false;
  root.pointerEventsType = { allow: ["ray"] };

  const settingsView = {
    get category() {
      return settingsCategory;
    },
    select(category: SettingsCategoryId) {
      if (category === settingsCategory) return;
      settingsCategory = category;
      rebuildRequested = true;
    },
  };

  const render = (definition: PaletteDefinition) => {
    currentDefinition = definition;
    const nextDefinition = withPanelText(definition);
    rebuildRequested = false;
    disposeRenderedChildren(renderedChildren);
    renderedChildren = [
      buildHeader(nextDefinition, options),
      buildContent(nextDefinition, options, settingsView),
    ];
    root.add(...renderedChildren);
  };

  return {
    root,
    setDefinition(nextDefinition) {
      render(nextDefinition);
    },
    setVisible(visible) {
      root.visible = visible;
    },
    update(deltaMs) {
      if (rebuildRequested && currentDefinition !== undefined) {
        render(currentDefinition);
      }
      root.update(deltaMs);
    },
    dispose() {
      disposeRenderedChildren(renderedChildren);
      renderedChildren = [];
      root.removeFromParent();
      root.dispose();
    },
  };
}

// The definition with every string made drawable by the panel's font (see toPanelText); ids are plain ASCII and pass unchanged.
function withPanelText<T>(value: T): T {
  if (typeof value === "string") {
    return toPanelText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => withPanelText(entry)) as T;
  }
  if (value !== null && typeof value === "object") {
    const mapped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      mapped[key] = withPanelText(entry);
    }
    return mapped as T;
  }
  return value;
}

// Select the page body by content.kind; the final fallthrough builds the settings page (world, config, debug and comfort sections).
function buildContent(
  definition: PaletteDefinition,
  options: ScenePaletteAdapterOptions,
  settingsView: { readonly category: SettingsCategoryId | undefined; select(category: SettingsCategoryId): void },
): Container {
  if (definition.content.kind === "main") {
    return buildMainContent(definition.content, options, definition.reloadConfirmationActive);
  }

  if (definition.content.kind === "place-flag-options") {
    return buildPlaceSignOptionsContent(definition.content, options);
  }

  if (definition.content.kind === "edit-sign") {
    return buildEditSignContent(definition.content, options);
  }

  if (definition.content.kind === "measurement-actions") {
    return buildMeasurementActionsContent(definition.content);
  }

  if (definition.content.kind === "geodesic-cannon-actions") {
    return buildGeodesicCannonActionsContent(definition.content, options);
  }

  if (definition.content.kind === "geometry-computer-actions") {
    return buildGeometryComputerActionsContent(definition.content, options);
  }

  if (definition.content.kind === "tutorial") {
    return buildPagedHelpContent(definition.content, options);
  }

  if (definition.content.kind === "goal") {
    return buildPagedHelpContent(definition.content, options);
  }

  if (definition.content.kind === "discoveries") {
    return buildDiscoveriesContent(definition.content, options);
  }

  if (definition.content.kind === "question-help") {
    return buildQuestionHelpContent(definition.content, options);
  }

  if (definition.content.kind === "debug-settings") {
    return buildDebugSettingsContent(definition.content, options);
  }

  return buildSettingsContent(definition.content, options, settingsView);
}
