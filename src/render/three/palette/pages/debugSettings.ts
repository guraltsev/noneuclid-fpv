/**
 * Settings palette pages: the world, config, debug and comfort settings page and the debug settings page.
 */
import { Container, Text } from "@pmndrs/uikit";
import type { PortalPanelModeId } from "../../../../glue/portalPanelMode";
import type { RuntimeMenuConsoleLogLevelId, RuntimeMouseSensitivity, RuntimeTextSize, RuntimeTurnSpeed } from "../../../../runtime/runtimeMenuState";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { controllersSettingsText, hintStripText, settingsText } from "../../../../ui/vocabulary";
import { borderColor, fontPx, scrollbarBorderColor, scrollbarColor, sectionColor, textColor } from "../tokens";
import { createActionButton, createChoiceSection, createOptionGrid, createSectionLabel, createSettingsScrollContainer, createStepRow, createToggleButton, createToggleRow } from "../widgets";

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
 * Settings page: Controls (a reference of what each control does, mouse sensitivity, Invert Y, turn speed, the VR hand options), Display (text size, Show hints, Reset tips), Comfort, then the world, config and debug sections the app config allows (the fallthrough of the page dispatcher).
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

  const createSection = (label: string): Container => {
    const section = new Container({
      width: "100%",
      flexShrink: 0,
      flexDirection: "column",
      gap: 8,
      padding: 12,
      borderRadius: 20,
      backgroundColor: sectionColor,
      borderColor,
      borderWidth: 1,
    });
    section.add(createSectionLabel(label));
    return section;
  };

  // Controls.
  const controlsSection = createSection(settingsText.controls);
  controlsSection.add(createSectionLabel(settingsText.controlsReference));
  for (const entry of content.controlsReference) {
    controlsSection.add(createControlReferenceRow(entry.verb, entry.glyph.label));
  }
  if (options.onMouseSensitivitySelected !== undefined) {
    const onSelected = options.onMouseSensitivitySelected;
    controlsSection.add(createStepRow(settingsText.mouseSensitivity, [
      { id: "low", label: settingsText.low },
      { id: "medium", label: settingsText.medium },
      { id: "high", label: settingsText.high },
    ], content.mouseSensitivity, (id) => onSelected(id as RuntimeMouseSensitivity), "mouse-sensitivity"));
  }
  if (options.onInvertYToggled !== undefined) {
    const onToggled = options.onInvertYToggled;
    controlsSection.add(createToggleRow(settingsText.invertY, content.invertYEnabled, onToggled, "invert-y-toggle"));
  }
  if (options.onTurnSpeedSelected !== undefined) {
    const onSelected = options.onTurnSpeedSelected;
    controlsSection.add(createStepRow(settingsText.turnSpeed, [
      { id: "slow", label: settingsText.slow },
      { id: "medium", label: settingsText.medium },
      { id: "fast", label: settingsText.fast },
    ], content.turnSpeed, (id) => onSelected(id as RuntimeTurnSpeed), "turn-speed"));
  }
  const onXrHandOptionToggled = options.onXrHandOptionToggled;
  if (onXrHandOptionToggled !== undefined) {
    controlsSection.add(createToggleRow(controllersSettingsText.useOneController, content.useOneControllerEnabled, (enabled) => {
      onXrHandOptionToggled("useOneController", enabled);
    }, "use-one-controller-toggle"));
    controlsSection.add(createToggleRow(controllersSettingsText.leftHanded, content.leftHandedEnabled, (enabled) => {
      onXrHandOptionToggled("leftHanded", enabled);
    }, "left-handed-toggle"));
  }
  settings.add(controlsSection);

  // Display.
  const displaySection = createSection(settingsText.display);
  if (options.onTextSizeSelected !== undefined) {
    const onSelected = options.onTextSizeSelected;
    displaySection.add(createStepRow(settingsText.textSize, [
      { id: "small", label: settingsText.small },
      { id: "medium", label: settingsText.medium },
      { id: "large", label: settingsText.large },
    ], content.textSize, (id) => onSelected(id as RuntimeTextSize), "text-size"));
  }
  const onShowHintsToggled = options.onShowHintsToggled;
  if (onShowHintsToggled !== undefined) {
    displaySection.add(createToggleRow(hintStripText.showHintsSwitch, content.showHintsEnabled, (enabled) => {
      onShowHintsToggled(enabled);
    }, "show-hints-toggle"));
  }
  if (options.onResetTipsRequested !== undefined) {
    displaySection.add(createActionButton(settingsText.resetTips, "reset-tips", options.onResetTipsRequested, { width: 160 }));
  }
  settings.add(displaySection);

  // Comfort.
  const comfortSection = createSection(settingsText.comfort);
  comfortSection.add(createToggleRow(settingsText.antiNausea, content.antiNauseaModeEnabled, (enabled) => {
    options.onAntiNauseaModeToggled(enabled);
  }, "anti-nausea-vignette-toggle"));
  settings.add(comfortSection);

  // The sections the app config gates.
  if (content.worldSelectionSectionEnabled) {
    const worldSection = createSection("World");
    worldSection.add(createOptionGrid(content.worldOptions, content.selectedWorldId, "world", options.onWorldSelected));
    settings.add(worldSection);
  }

  if (content.configSelectionSectionEnabled) {
    const configSection = createSection("Config");
    configSection.add(createOptionGrid(content.appConfigOptions, content.selectedAppConfigName, "config", options.onConfigSelected));
    settings.add(configSection);
  }

  if (content.debugSectionEnabled) {
    const debugSection = createSection("Debug");
    debugSection.add(createDebugToolsRow(content.debugEnabled, options));
    settings.add(debugSection);
  }

  return settings;
}

// One row of the controls reference: what it does, and the name of the control that does it on this device.
function createControlReferenceRow(verb: string, glyphLabel: string): Container {
  const row = new Container({ width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 });
  row.add(new Text({ text: verb, fontSize: fontPx(16), fontWeight: "medium", color: textColor, fill: textColor, flexShrink: 1, wordBreak: "break-word" }));
  const chip = new Container({ paddingX: 10, paddingY: 3, borderRadius: 10, backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center", flexShrink: 0 });
  chip.add(new Text({ text: glyphLabel, fontSize: fontPx(15), fontWeight: "bold", color: "#0f172a", fill: "#0f172a" }));
  row.add(chip);
  return row;
}
