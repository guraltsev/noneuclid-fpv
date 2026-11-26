/**
 * Settings palette pages: the Settings page (a sidebar of categories on the left, the chosen category's cards on the right) and the debug settings page.
 * Categories: Controls (mouse, turn, VR hands), Input guide (what each control does), Display (text size, hints, edges, tips; comfort),
 * World (the world and config pickers, when the app config allows them) and Developer (the debug switch, when allowed).
 */
import { Container, Text } from "@pmndrs/uikit";
import { Gamepad2, Keyboard, Monitor, Globe, Wrench } from "@pmndrs/uikit-lucide";
import type { PortalPanelModeId } from "../../../../glue/portalPanelMode";
import type { RuntimeMenuConsoleLogLevelId, RuntimeMouseSensitivity, RuntimeTextSize, RuntimeTurnSpeed } from "../../../../runtime/runtimeMenuState";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { controllersSettingsText, discoveryText, hintStripText, settingsText } from "../../../../ui/vocabulary";
import {
  activeColor,
  borderColor,
  chipColor,
  chipTextColor,
  fontPx,
  mutedTextColor,
  raisedHoverColor,
  sectionColor,
  textColor,
  typeScale,
} from "../tokens";
import {
  addCardRow,
  createActionButton,
  createCard,
  createChoiceSection,
  createOptionGrid,
  createOverline,
  createScrollArea,
  createSettingRow,
  createStepRow,
  createToggleRow,
} from "../widgets";

/** The categories of the Settings sidebar. */
export type SettingsCategoryId = "controls" | "input-guide" | "display" | "world" | "developer";

/** Which Settings category is shown, and how to choose another; held by the adapter for as long as the panel lives. */
export interface SettingsCategoryView {
  readonly category: SettingsCategoryId | undefined;
  select(category: SettingsCategoryId): void;
}

/**
 * Debug settings page: log level, overlay toggles (items only when the overlay is on), portal options, wireframes, aim outlines and an optional copy-URL button.
 */
export function buildDebugSettingsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "debug-settings" }>,
  options: ScenePaletteAdapterOptions,
): Container {
  const page = createScrollArea();

  page.add(createChoiceSection(
    "Console log level",
    content.consoleLogLevelOptions,
    content.consoleLogLevel,
    (id) => options.onConsoleLogLevelSelected(id as RuntimeMenuConsoleLogLevelId),
    "console-log-level",
  ));

  const overlay = createCard("Overlay");
  addCardRow(overlay, createToggleRow("UI overlay", content.debugOverlayEnabled, (enabled) => {
    options.onDebugOverlayToggled(enabled);
  }, "debug-overlay-toggle"));
  if (content.debugOverlayEnabled) {
    for (const item of content.debugOverlayItems) {
      addCardRow(overlay, createToggleRow(item.label, item.checked, (enabled) => {
        options.onDebugOverlayItemToggled(item.id, enabled);
      }, `debug-overlay-item:${item.id}`));
    }
  }
  page.add(overlay);

  page.add(createChoiceSection(
    "Portal labels",
    content.portalPanelModeOptions,
    content.portalPanelMode,
    (id) => options.onPortalPanelModeSelected(id as PortalPanelModeId),
    "portal-labels",
  ));

  const inspection = createCard("Inspection");
  addCardRow(inspection, createToggleRow("Portal inspection tools", content.portalInspectionEnabled, (enabled) => {
    options.onPortalInspectionToggled(enabled);
  }, "portal-inspection-toggle"));
  addCardRow(inspection, createToggleRow(
    "Collision geometry wireframes",
    content.collisionGeometryWireframesEnabled,
    (enabled) => {
      options.onCollisionGeometryWireframesToggled(enabled);
    },
    "collision-geometry-wireframes-toggle",
  ));
  addCardRow(inspection, createToggleRow(
    "Aim collision outlines",
    content.aimCollisionOutlinesEnabled,
    (enabled) => {
      options.onAimCollisionOutlinesToggled(enabled);
    },
    "aim-collision-outlines-toggle",
  ));
  if (options.onCopyUrlWithOptionsRequested) {
    addCardRow(inspection, createSettingRow(
      "Share these options",
      createActionButton("Copy URL", "copy-url-with-options", options.onCopyUrlWithOptionsRequested, { tone: "neutral" }),
      "Copies a link that opens the app with these settings",
    ));
  }
  page.add(inspection);
  return page;
}

/**
 * Settings page: the category sidebar and the chosen category. The categories offered depend on the device (the VR hand options) and the app config
 * (World, Developer); a category that is no longer offered falls back to the first one.
 */
export function buildSettingsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "settings" }>,
  options: ScenePaletteAdapterOptions,
  view: SettingsCategoryView = { category: undefined, select: () => {} },
): Container {
  const categories = settingsCategories(content);
  const category = categories.find((entry) => entry.id === view.category)?.id ?? categories[0]!.id;

  const layout = new Container({
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    flexDirection: "row",
    gap: 20,
  });

  const sidebar = new Container({
    width: 220,
    flexShrink: 0,
    flexDirection: "column",
    gap: 4,
    padding: 8,
    borderRadius: 16,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  for (const entry of categories) {
    sidebar.add(createCategoryTab(entry, entry.id === category, () => view.select(entry.id)));
  }
  layout.add(sidebar);

  const page = createScrollArea();
  if (category === "controls") addControls(page, content, options);
  else if (category === "input-guide") addInputGuide(page, content);
  else if (category === "display") addDisplay(page, content, options);
  else if (category === "world") addWorld(page, content, options);
  else addDeveloper(page, content, options);
  layout.add(page);
  return layout;
}

interface SettingsCategory {
  readonly id: SettingsCategoryId;
  readonly label: string;
  readonly icon: "controls" | "input-guide" | "display" | "world" | "developer";
}

// The categories this page offers, in sidebar order.
function settingsCategories(content: Extract<PaletteDefinition["content"], { readonly kind: "settings" }>): readonly SettingsCategory[] {
  const categories: SettingsCategory[] = [
    { id: "controls", label: settingsText.controls, icon: "controls" },
    { id: "input-guide", label: settingsText.inputGuide, icon: "input-guide" },
    { id: "display", label: settingsText.display, icon: "display" },
  ];
  if (content.worldSelectionSectionEnabled || content.configSelectionSectionEnabled) {
    categories.push({ id: "world", label: settingsText.world, icon: "world" });
  }
  if (content.debugSectionEnabled) {
    categories.push({ id: "developer", label: settingsText.developer, icon: "developer" });
  }
  return categories;
}

// One sidebar tab: icon and label, filled when it is the shown category.
function createCategoryTab(entry: SettingsCategory, selected: boolean, onClick: () => void): Container {
  const color = selected ? textColor : mutedTextColor;
  const tab = new Container({
    width: "100%",
    height: 52,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingX: 14,
    borderRadius: 10,
    backgroundColor: selected ? activeColor : sectionColor,
    hover: { backgroundColor: selected ? activeColor : raisedHoverColor },
    pointerEvents: "auto",
    renderOrder: 1001,
    depthTest: false,
    depthWrite: false,
  });
  tab.userData.scenePaletteAction = onClick;
  tab.userData.scenePaletteItemId = `settings-category:${entry.id}`;
  const iconProperties = { width: 22, height: 22, color, flexShrink: 0, pointerEvents: "none" as const };
  tab.add(
    entry.icon === "controls" ? new Gamepad2(iconProperties)
      : entry.icon === "input-guide" ? new Keyboard(iconProperties)
        : entry.icon === "display" ? new Monitor(iconProperties)
          : entry.icon === "world" ? new Globe(iconProperties)
            : new Wrench(iconProperties),
  );
  tab.add(new Text({
    text: entry.label,
    fontSize: fontPx(typeScale.body - 1),
    fontWeight: selected ? "bold" : "medium",
    color,
    fill: color,
    flexShrink: 1,
    pointerEvents: "none",
  }));
  return tab;
}

type SettingsContent = Extract<PaletteDefinition["content"], { readonly kind: "settings" }>;

// Controls: mouse sensitivity and Invert Y on the desktop, turn speed on both, the VR hand options in VR.
function addControls(page: Container, content: SettingsContent, options: ScenePaletteAdapterOptions): void {
  const looking = createCard(settingsText.controls);
  const desktop = content.inputMode === "desktop";
  if (desktop && options.onMouseSensitivitySelected !== undefined) {
    const onSelected = options.onMouseSensitivitySelected;
    addCardRow(looking, createStepRow(settingsText.mouseSensitivity, [
      { id: "low", label: settingsText.low },
      { id: "medium", label: settingsText.medium },
      { id: "high", label: settingsText.high },
    ], content.mouseSensitivity, (id) => onSelected(id as RuntimeMouseSensitivity), "mouse-sensitivity"));
  }
  if (desktop && options.onInvertYToggled !== undefined) {
    addCardRow(looking, createToggleRow(settingsText.invertY, content.invertYEnabled, options.onInvertYToggled, "invert-y-toggle", settingsText.invertYDescription));
  }
  if (options.onTurnSpeedSelected !== undefined) {
    const onSelected = options.onTurnSpeedSelected;
    addCardRow(looking, createStepRow(settingsText.turnSpeed, [
      { id: "slow", label: settingsText.slow },
      { id: "medium", label: settingsText.medium },
      { id: "fast", label: settingsText.fast },
    ], content.turnSpeed, (id) => onSelected(id as RuntimeTurnSpeed), "turn-speed"));
  }
  page.add(looking);

  const onXrHandOptionToggled = options.onXrHandOptionToggled;
  if (!desktop && onXrHandOptionToggled !== undefined) {
    const hands = createCard("VR controllers");
    addCardRow(hands, createToggleRow(controllersSettingsText.useOneController, content.useOneControllerEnabled, (enabled) => {
      onXrHandOptionToggled("useOneController", enabled);
    }, "use-one-controller-toggle"));
    addCardRow(hands, createToggleRow(controllersSettingsText.leftHanded, content.leftHandedEnabled, (enabled) => {
      onXrHandOptionToggled("leftHanded", enabled);
    }, "left-handed-toggle"));
    page.add(hands);
  }
}

// Input guide: one row per verb, with the name of the control that does it on this device.
function addInputGuide(page: Container, content: SettingsContent): void {
  const guide = createCard(settingsText.controlsReference);
  for (const entry of content.controlsReference) {
    addCardRow(guide, createSettingRow(entry.verb, createKeyChip(entry.glyph.label)));
  }
  page.add(guide);
}

// Display: text size, hints, edges and tips; then comfort.
function addDisplay(page: Container, content: SettingsContent, options: ScenePaletteAdapterOptions): void {
  const display = createCard(settingsText.display);
  if (options.onTextSizeSelected !== undefined) {
    const onSelected = options.onTextSizeSelected;
    addCardRow(display, createStepRow(settingsText.textSize, [
      { id: "small", label: settingsText.small },
      { id: "medium", label: settingsText.medium },
      { id: "large", label: settingsText.large },
    ], content.textSize, (id) => onSelected(id as RuntimeTextSize), "text-size"));
  }
  const onShowHintsToggled = options.onShowHintsToggled;
  if (onShowHintsToggled !== undefined) {
    addCardRow(display, createToggleRow(hintStripText.showHintsSwitch, content.showHintsEnabled, (enabled) => {
      onShowHintsToggled(enabled);
    }, "show-hints-toggle"));
  }
  const onShowEdgesToggled = options.onShowEdgesToggled;
  if (onShowEdgesToggled !== undefined) {
    addCardRow(display, createToggleRow(discoveryText.showEdges, content.showEdgesEnabled, (enabled) => {
      onShowEdgesToggled(enabled);
    }, "show-edges-toggle"));
  }
  if (options.onResetTipsRequested !== undefined) {
    addCardRow(display, createSettingRow(
      settingsText.resetTips,
      createActionButton(settingsText.resetTips, "reset-tips", options.onResetTipsRequested, { tone: "neutral" }),
      settingsText.resetTipsDescription,
    ));
  }
  page.add(display);

  const comfort = createCard(settingsText.comfort);
  addCardRow(comfort, createToggleRow(settingsText.antiNausea, content.antiNauseaModeEnabled, (enabled) => {
    options.onAntiNauseaModeToggled(enabled);
  }, "anti-nausea-vignette-toggle", settingsText.antiNauseaDescription));
  page.add(comfort);
}

// World: the world picker and the config picker the app config allows.
function addWorld(page: Container, content: SettingsContent, options: ScenePaletteAdapterOptions): void {
  if (content.worldSelectionSectionEnabled) {
    const world = new Container({ width: "100%", flexDirection: "column", gap: 8, flexShrink: 0 });
    world.add(createOverline(settingsText.world));
    world.add(createOptionGrid(content.worldOptions, content.selectedWorldId, "world", options.onWorldSelected));
    page.add(world);
  }
  if (content.configSelectionSectionEnabled) {
    const config = new Container({ width: "100%", flexDirection: "column", gap: 8, flexShrink: 0 });
    config.add(createOverline(settingsText.config));
    config.add(createOptionGrid(content.appConfigOptions, content.selectedAppConfigName, "config", options.onConfigSelected));
    page.add(config);
  }
}

// Developer: the debug switch, and the way to the debug settings page while it is on.
function addDeveloper(page: Container, content: SettingsContent, options: ScenePaletteAdapterOptions): void {
  const developer = createCard(settingsText.developer);
  addCardRow(developer, createToggleRow(settingsText.debugToolsLabel, content.debugEnabled, (enabled) => {
    options.onDebugEnabledChanged(enabled);
  }, "debug-tools-toggle", settingsText.debugToolsDescription));
  if (content.debugEnabled) {
    addCardRow(developer, createSettingRow(
      settingsText.debugSettingsTitle,
      createActionButton(settingsText.debugSettingsButton, "debug-settings", options.onDebugSettingsRequested, { tone: "neutral" }),
    ));
  }
  page.add(developer);
}

// A keycap: the name of a key or button on a light chip.
function createKeyChip(label: string): Container {
  const chip = new Container({
    paddingX: 12,
    height: 32,
    borderRadius: 8,
    backgroundColor: chipColor,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  });
  chip.add(new Text({ text: label, fontSize: fontPx(typeScale.caption), fontWeight: "bold", color: chipTextColor, fill: chipTextColor }));
  return chip;
}
