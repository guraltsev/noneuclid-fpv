/**
 * Main palette page, the main menu: Help, Settings, Go home and Start over as text buttons (Start over asks for a second press).
 * In VR, until job 77 puts the belt on the wrist, it also holds a row of tool tiles, with the place-flag tile showing the selected sign type.
 */
import { Container } from "@pmndrs/uikit";
import type { RuntimeToolId } from "../../../../glue/toolIds";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../../../world-objects/toolObjects";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, activeColor, borderColor, inactiveColor, sectionColor } from "../tokens";
import { createToolIcon } from "../icons";
import { createButtonText, createInteractiveSurface } from "../widgets";
import { mainMenuText } from "../../../../world-objects/vocabulary";

/**
 * Main page: the main-menu buttons, then (VR only) a row of tool tiles.
 */
export function buildMainContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "main" }>,
  options: ScenePaletteAdapterOptions,
  startOverConfirmationActive = false,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 300,
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });

  for (const entry of content.menuActions) {
    const confirming = entry.id === "start-over" && startOverConfirmationActive;
    const button = createInteractiveSurface({
      width: "100%",
      height: 56,
      label: confirming ? mainMenuText.startOverConfirm : entry.label,
      labelFontSize: 22,
      backgroundColor: confirming ? "#991b1b" : actionColor,
      onClick: () => {
        if (entry.id === "help") options.onHelpRequested?.();
        else if (entry.id === "settings") options.onLeftAction("settings");
        else if (entry.id === "go-home") options.onHomeRequested();
        else options.onReloadRequested();
      },
    });
    button.userData.scenePaletteItemId = `main-menu:${entry.id}`;
    panel.add(button);
  }

  if (content.toolOptions.length === 0) {
    return panel;
  }

  const row = new Container({
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  });
  for (const tool of content.toolOptions) {
    row.add(createToolTile(
      tool.id,
      tool.label,
      content.selectedTool,
      options,
      tool.id === "placedFlags/flag" ? content.placeFlagType : undefined,
    ));
  }

  panel.add(row);
  return panel;
}

// Tool tile button with icon and label; the place-flag tile also gets a small options button.
function createToolTile(
  toolId: RuntimeToolId,
  label: string,
  selectedTool: RuntimeToolId,
  options: ScenePaletteAdapterOptions,
  signType?: PlacedFlagType,
): Container {
  const selected = toolId === selectedTool;
  const button = createInteractiveSurface({
    width: "23%",
    height: 150,
    label: "",
    labelFontSize: 18,
    positionType: "relative",
    flexDirection: "column",
    backgroundColor: selected ? activeColor : inactiveColor,
    onClick: () => options.onToolSelected?.(toolId),
  });
  button.userData.scenePaletteItemId = `tool:${toolId}`;
  button.add(createToolIcon(toolId, signType), createButtonText(label, 16));
  if (toolId === "placedFlags/flag") {
    button.add(createSignOptionsButton(options));
  }
  return button;
}

// "..." button pinned to the tile's top right corner (absolute position, above the tile via zIndexOffset).
function createSignOptionsButton(options: ScenePaletteAdapterOptions): Container {
  const optionsButton = createInteractiveSurface({
    width: 34,
    height: 24,
    label: "...",
    labelFontSize: 13,
    positionType: "absolute",
    positionTop: 8,
    positionRight: 8,
    zIndexOffset: 8,
    backgroundColor: "#0f172a",
    onClick: () => options.onPlaceFlagOptionsRequested?.(),
  });
  optionsButton.userData.scenePaletteItemId = "tool-options:place-sign";
  return optionsButton;
}
