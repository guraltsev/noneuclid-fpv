/**
 * Main palette page: a row of tool tiles, with the place-flag tile showing the currently selected sign type.
 */
import { Container } from "@pmndrs/uikit";
import type { RuntimeToolId } from "../../../../glue/toolIds";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../../../world-objects/toolObjects";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { activeColor, borderColor, inactiveColor, sectionColor } from "../tokens";
import { createToolIcon } from "../icons";
import { createButtonText, createInteractiveSurface } from "../widgets";

/**
 * Main page: a row of tool tiles, with the place-flag tile showing the currently selected sign type.
 */
export function buildMainContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "main" }>,
  options: ScenePaletteAdapterOptions,
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

  const row = new Container({
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
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
