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
import { borderColor, surfaceColor, textColor } from "./tokens";
import { disposeRenderedChildren } from "./widgets";
import { buildHeader } from "./header";
import { buildMainContent } from "./pages/main";
import { buildGeodesicCannonActionsContent } from "./pages/geodesicActions";
import { buildGeometryComputerActionsContent } from "./pages/geometryComputer";
import { buildPagedHelpContent, buildQuestionHelpContent } from "./pages/help";
import { buildEditSignContent, buildPlaceSignOptionsContent } from "./pages/signs";
import { buildMeasurementActionsContent } from "./pages/measurements";
import { buildDebugSettingsContent, buildSettingsContent } from "./pages/debugSettings";

/**
 * Creates the in-scene palette panel: an empty, hidden uikit root at the standard palette size, ready for setDefinition.
 * The root uses depthTest/depthWrite off with a high renderOrder so the panel draws over world geometry, and accepts only "ray" pointer events.
 * The caller owns the adapter and must call dispose(); until setDefinition is called the panel has no content.
 */
export function createScenePaletteAdapter(options: ScenePaletteAdapterOptions): ScenePaletteAdapter {
  // Header and body currently attached to root; tracked so they can be disposed on the next setDefinition.
  let renderedChildren: Container[] = [];
  const root = new Container({
    width: scenePalettePanelWidthPixels,
    height: scenePalettePanelHeightPixels,
    pixelSize: scenePalettePanelPixelSize,
    flexDirection: "column",
    borderRadius: 28,
    padding: 20,
    gap: 12,
    backgroundColor: surfaceColor,
    color: textColor,
    fill: textColor,
    opacity: 1,
    overflow: "visible",
    pointerEvents: "auto",
    scrollbarColor: "#64748b",
    borderColor,
    borderWidth: 3,
    renderOrder: 999,
    depthTest: false,
    depthWrite: false,
  });
  root.name = "vr-tool-palette";
  root.visible = false;
  root.pointerEventsType = { allow: ["ray"] };

  return {
    root,
    setDefinition(nextDefinition) {
      disposeRenderedChildren(renderedChildren);
      renderedChildren = [
        buildHeader(nextDefinition, options),
        buildContent(nextDefinition, options),
      ];
      root.add(...renderedChildren);
    },
    setVisible(visible) {
      root.visible = visible;
    },
    update(deltaMs) {
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

// Select the page body by content.kind; the final fallthrough builds the settings page (world, config, debug and comfort sections).
function buildContent(
  definition: PaletteDefinition,
  options: ScenePaletteAdapterOptions,
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

  if (definition.content.kind === "question-help") {
    return buildQuestionHelpContent(definition.content, options);
  }

  if (definition.content.kind === "debug-settings") {
    return buildDebugSettingsContent(definition.content, options);
  }

  return buildSettingsContent(definition.content, options);
}
