/**
 * Main palette page, the main menu: Help, Settings, Go home and Start over as full-width rows, each with an icon and a line that says what it does.
 * Start over is set apart at the bottom in the danger color and asks for a second press. The tools are on the belt, on desktop and in VR
 * (design 017 section 7.4), so the page draws no tool tiles.
 */
import { Container } from "@pmndrs/uikit";
import { CircleHelp, House, RotateCcw, Settings } from "@pmndrs/uikit-lucide";
import type { PaletteDefinition } from "../../../../ui/paletteDefinition";
import type { ScenePaletteAdapterOptions } from "../adapterTypes";
import { textColor } from "../tokens";
import { createNavigationRow, createPageBody } from "../widgets";
import { mainMenuText } from "../../../../world-objects/vocabulary";

type MainMenuEntry = Extract<PaletteDefinition["content"], { readonly kind: "main" }>["menuActions"][number];

/**
 * Main page: the main-menu rows.
 */
export function buildMainContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "main" }>,
  options: ScenePaletteAdapterOptions,
  startOverConfirmationActive = false,
): Container {
  const page = createPageBody({ gap: 12 });

  const navigation = content.menuActions.filter((entry) => entry.id !== "start-over");
  const destructive = content.menuActions.filter((entry) => entry.id === "start-over");

  for (const entry of navigation) {
    page.add(createMenuRow(entry, options, false));
  }
  if (destructive.length > 0) {
    // Start over sits at the bottom, away from the rows that only go somewhere.
    page.add(new Container({ flexGrow: 1, minHeight: 12 }));
    for (const entry of destructive) {
      page.add(createMenuRow(entry, options, startOverConfirmationActive));
    }
  }
  return page;
}

function createMenuRow(entry: MainMenuEntry, options: ScenePaletteAdapterOptions, confirming: boolean): Container {
  const iconProperties = { width: 26, height: 26, color: textColor };
  const icon = entry.id === "help" ? new CircleHelp(iconProperties)
    : entry.id === "settings" ? new Settings(iconProperties)
      : entry.id === "go-home" ? new House(iconProperties)
        : new RotateCcw(iconProperties);
  const description = entry.id === "help" ? mainMenuText.helpDescription
    : entry.id === "settings" ? mainMenuText.settingsDescription
      : entry.id === "go-home" ? mainMenuText.goHomeDescription
        : confirming ? mainMenuText.startOverConfirmDescription : mainMenuText.startOverDescription;
  return createNavigationRow({
    itemId: `main-menu:${entry.id}`,
    label: confirming ? mainMenuText.startOverConfirm : entry.label,
    description,
    icon,
    tone: entry.id === "start-over" ? "danger" : "neutral",
    chevron: entry.id === "help" || entry.id === "settings",
    onClick: () => {
      if (entry.id === "help") options.onHelpRequested?.();
      else if (entry.id === "settings") options.onLeftAction("settings");
      else if (entry.id === "go-home") options.onHomeRequested();
      else options.onReloadRequested();
    },
  });
}
