/**
 * Main palette page, the main menu: Help, Settings, Go home and Start over as text buttons (Start over asks for a second press).
 * The tools are on the belt, on desktop and in VR (design 017 section 7.4), so the page draws no tool tiles.
 */
import { Container } from "@pmndrs/uikit";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { actionColor, borderColor, sectionColor } from "../tokens";
import { createInteractiveSurface } from "../widgets";
import { mainMenuText } from "../../../../world-objects/vocabulary";

/**
 * Main page: the main-menu buttons.
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

  return panel;
}
