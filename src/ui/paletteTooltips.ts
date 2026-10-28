/**
 * Resolves the tooltip text for palette items from their string item ids.
 * Item ids are namespaced strings produced by the palette renderers (for example "tool:place-flag", "geodesic-cannon-action:rotate:<id>", "sign-key:A"); this module is the single place that turns them into human-readable labels, so desktop and VR show the same tooltips. It is a pure lookup with no state.
 */
/**
 * Returns the tooltip for a palette item id (prefix families like tool:, tutorial:, sign-key: are decoded, others looked up in a fixed table), or undefined for an undefined or unknown id.
 */
export function resolvePaletteTooltipLabel(itemId: string | undefined): string | undefined {
  if (!itemId) {
    return undefined;
  }

  if (itemId.startsWith("tool:")) {
    return toolTooltip(itemId.slice("tool:".length));
  }

  if (itemId.startsWith("geodesic-cannon-action:delete:")) {
    return "Delete geodesic";
  }

  if (itemId.startsWith("geodesic-cannon-action:rotate:")) {
    return "Rotate";
  }

  if (itemId.startsWith("geodesic-cannon-action:aim:")) {
    return "Aim";
  }

  if (itemId.startsWith("geometry-computer:set:")) {
    return "Set skew";
  }

  if (itemId.startsWith("geometry-computer:step:")) {
    return "Step skew";
  }

  if (itemId.startsWith("tutorial:")) {
    return itemId.endsWith(":previous") ? "Previous page" : "Next page";
  }

  if (itemId.startsWith("goal:")) {
    return itemId.endsWith(":previous") ? "Previous page" : "Next page";
  }

  if (itemId === "question-help:tutorial") {
    return "Tutorial";
  }

  if (itemId === "question-help:goal") {
    return "Goal";
  }

  if (itemId.startsWith("sign-type:")) {
    return "Choose sign type";
  }

  if (itemId.startsWith("sign-key:")) {
    return itemId.slice("sign-key:".length);
  }

  return fixedTooltips[itemId];
}

const fixedTooltips: Readonly<Record<string, string>> = {
  "settings": "Settings",
  "close": "Close",
  "back": "Back",
  "go-home": "Home",
  "reload-world": "Reload",
  "debug-settings": "Debug settings",
  "debug-tools-toggle": "Debug tools",
  "tool-options:place-sign": "Sign options",
  "geodesic-cannon-action:add-geodesic": "Add geodesic",
  "geodesic-cannon-action:carry": "Move emitter while maintaining attached geodesics",
  "geodesic-cannon-action:tie-and-detach": "Select two geodesics attached to this emitter, tie them together, and release them from the emitter",
  "sign-action:trash": "Delete sign",
  "sign-key:Space": "Space",
  "sign-key:Enter": "New line",
  "sign-key:Backspace": "Backspace",
};

function toolTooltip(toolId: string): string | undefined {
  switch (toolId) {
    case "place-flag":
      return "Place sign";
    case "geodesic-cannon":
      return "Create and terminate straight lines";
    case "measure-length":
      return "Measure length";
    case "protractor":
      return "Measure angle";
    default:
      return undefined;
  }
}
