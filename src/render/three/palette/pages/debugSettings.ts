/**
 * Settings palette pages: the world, config, debug and comfort settings page and the debug settings page.
 */
import { Container } from "@pmndrs/uikit";
import type { PortalPanelModeId } from "../../../../glue/portalPanelMode";
import type { RuntimeMenuConsoleLogLevelId } from "../../../../runtime/runtimeMenuState";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { borderColor, scrollbarBorderColor, scrollbarColor, sectionColor } from "../tokens";
import { createActionButton, createChoiceSection, createOptionGrid, createSectionLabel, createSettingsScrollContainer, createToggleButton, createToggleRow } from "../widgets";

/**
 * Debug settings page: log level, overlay toggles (items only when the overlay is on), portal options, wireframes, aim outlines and an optional copy-URL button.
 */
export function buildDebugSettingsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "debug-settings" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const settings = createSettingsScrollContainer();

  const debugSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
    flexShrink: 0,
  });
  debugSection.add(createSectionLabel("Debug"));
    debugSection.add(createChoiceSection(
      "Console log level",
      content.consoleLogLevelOptions,
      content.consoleLogLevel,
      (id) => options.onConsoleLogLevelSelected(id as RuntimeMenuConsoleLogLevelId),
      "console-log-level",
    ));
    debugSection.add(createToggleRow("UI overlay", content.debugOverlayEnabled, (enabled) => {
      options.onDebugOverlayToggled(enabled);
    }, "debug-overlay-toggle"));

    if (content.debugOverlayEnabled) {
      for (const item of content.debugOverlayItems) {
        debugSection.add(createToggleRow(item.label, item.checked, (enabled) => {
          options.onDebugOverlayItemToggled(item.id, enabled);
        }, `debug-overlay-item:${item.id}`));
      }
    }

    debugSection.add(createChoiceSection(
      "Portal labels",
      content.portalPanelModeOptions,
      content.portalPanelMode,
      (id) => options.onPortalPanelModeSelected(id as PortalPanelModeId),
      "portal-labels",
    ));
    debugSection.add(createToggleRow("Portal inspection tools", content.portalInspectionEnabled, (enabled) => {
      options.onPortalInspectionToggled(enabled);
    }, "portal-inspection-toggle"));
    debugSection.add(createToggleRow(
      "Collision geometry wireframes",
      content.collisionGeometryWireframesEnabled,
      (enabled) => {
        options.onCollisionGeometryWireframesToggled(enabled);
      },
      "collision-geometry-wireframes-toggle",
    ));
    debugSection.add(createToggleRow(
      "Aim collision outlines",
      content.aimCollisionOutlinesEnabled,
      (enabled) => {
        options.onAimCollisionOutlinesToggled(enabled);
      },
      "aim-collision-outlines-toggle",
    ));
    if (options.onCopyUrlWithOptionsRequested) {
      debugSection.add(createActionButton(
        "Copy URL with options",
        "copy-url-with-options",
        options.onCopyUrlWithOptionsRequested,
      ));
    }

  settings.add(debugSection);
  return settings;
}

// Debug tools row: label, a "..." button to the debug settings page when enabled, and the on/off toggle.
function createDebugToolsRow(
  debugEnabled: boolean,
  options: ScenePaletteAdapterOptions,
): Container {
  const row = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  });
  row.add(createSectionLabel("Debug tools"));

  const actions = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexShrink: 0,
  });
  if (debugEnabled) {
    actions.add(createActionButton("...", "debug-settings", options.onDebugSettingsRequested, { width: 56 }));
  }
  actions.add(createToggleButton(debugEnabled, (enabled) => {
    options.onDebugEnabledChanged(enabled);
  }, "debug-tools-toggle"));

  row.add(actions);
  return row;
}

/**
 * Settings page: world, config, debug and comfort sections (the fallthrough of the page dispatcher).
 */
export function buildSettingsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "settings" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const settings = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 10,
    height: 400,
    overflow: "scroll",
    paddingRight: 24,
    scrollbarWidth: 14,
    scrollbarColor,
    scrollbarBorderColor,
    scrollbarBorderWidth: 2,
    scrollbarBorderRadius: 7,
    scrollbarZIndex: 1004,
  });

  const worldSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  worldSection.add(createSectionLabel("World"));
  worldSection.add(createOptionGrid(
    content.worldOptions,
    content.selectedWorldId,
    "world",
    options.onWorldSelected,
  ));

  const configSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  configSection.add(createSectionLabel("Config"));
  configSection.add(createOptionGrid(
    content.appConfigOptions,
    content.selectedAppConfigName,
    "config",
    options.onConfigSelected,
  ));

  const debugSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  debugSection.add(createSectionLabel("Debug"));
  debugSection.add(createDebugToolsRow(content.debugEnabled, options));

  const comfortSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  comfortSection.add(createSectionLabel("Comfort"));
  comfortSection.add(createToggleRow("Anti-nausea vignette", content.antiNauseaModeEnabled, (enabled) => {
    options.onAntiNauseaModeToggled(enabled);
  }, "anti-nausea-vignette-toggle"));

  if (content.worldSelectionSectionEnabled) {
    settings.add(worldSection);
  }

  if (content.configSelectionSectionEnabled) {
    settings.add(configSection);
  }

  if (content.debugSectionEnabled) {
    settings.add(debugSection);
  }

  settings.add(comfortSection);

  return settings;
}
