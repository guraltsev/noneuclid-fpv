/**
 * Resolves the tooltip text for palette items from their string item ids.
 * Item ids are namespaced strings produced by the palette renderers (for example "tool:placedFlags/flag", "geodesic-cannon-action:rotate:<id>", "sign-key:A"); this module is the single place that turns them into human-readable labels, so desktop and VR show the same tooltips. It is a pure lookup with no state.
 */
import { discoveryText, helpText, mainMenuText, menuControlText, objectActions, settingsText, shapeMachineText, surfaceNames, toolNames } from "../world-objects/vocabulary";

/** The tooltips of the main menu buttons (design 017 section 7.5), by the id after "main-menu:". */
const mainMenuTooltips: Readonly<Record<string, string | undefined>> = {
  help: surfaceNames.help,
  settings: mainMenuText.settings,
  "go-home": objectActions.goHome,
  "start-over": objectActions.startOver,
};

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

  if (itemId.startsWith("main-menu:")) {
    return mainMenuTooltips[itemId.slice("main-menu:".length)];
  }

  if (itemId.startsWith("geodesic-cannon-action:delete:")) {
    return `${objectActions.delete} beam`;
  }

  if (itemId.startsWith("geodesic-cannon-action:rotate:")) {
    return "Rotate";
  }

  if (itemId.startsWith("geodesic-cannon-action:aim:")) {
    return objectActions.aim;
  }

  if (itemId.startsWith("geometry-computer:")) {
    return shapeMachineTooltip(itemId.slice("geometry-computer:".length));
  }

  if (itemId.startsWith("tutorial:")) {
    return itemId.endsWith(":previous") ? "Previous page" : "Next page";
  }

  if (itemId.startsWith("goal:")) {
    return itemId.endsWith(":previous") ? "Previous page" : "Next page";
  }

  if (itemId === "question-help:tutorial") {
    return "How to";
  }

  if (itemId === "question-help:goal") {
    return "Things to try";
  }

  if (itemId === "question-help:discoveries") {
    return surfaceNames.discoveries;
  }

  if (itemId.startsWith("tutorial-topic:")) {
    return surfaceNames.howTo;
  }

  if (itemId.startsWith("mouse-sensitivity:")) {
    return settingsText.mouseSensitivity;
  }

  if (itemId.startsWith("turn-speed:")) {
    return settingsText.turnSpeed;
  }

  if (itemId.startsWith("text-size:")) {
    return settingsText.textSize;
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
  "tutorial-try-it": `${helpText.tryIt}: take this tool and close Help`,
  "invert-y-toggle": settingsText.invertY,
  "show-edges-toggle": `${discoveryText.showEdges}: draw a line on the floor where faces are glued`,
  "discoveries:show-edges": `${discoveryText.showEdges}: draw a line on the floor where faces are glued`,
  "reset-tips": `${settingsText.resetTips}: show the tool tips again`,
  "close": "Close",
  "back": "Back",
  "go-home": objectActions.goHome,
  "reload-world": objectActions.startOver,
  "debug-settings": "Debug settings",
  "debug-tools-toggle": "Debug tools",
  "tool-options:place-sign": "Sign options",
  "geodesic-cannon-action:add-geodesic": "Fire one more beam from this laser",
  "geodesic-cannon-action:delete-laser": menuControlText.deleteLaserTooltip,
  "measurement-action:delete": menuControlText.deleteMeasurementTooltip,
  "geodesic-cannon-action:carry": `${objectActions.pickUp} the laser: linked beams stay attached, free ones are removed`,
  "sign-action:trash": `${objectActions.delete} sign`,
  "sign-key:Space": "Space",
  "sign-key:Enter": "New line",
  "sign-key:Backspace": "Backspace",
};

/** The tooltip of a shape machine control, from the part of its id after "geometry-computer:". */
function shapeMachineTooltip(part: string): string | undefined {
  const parameterName = (axis: string | undefined): string => (axis === "b" ? shapeMachineText.height : shapeMachineText.shift);
  const [family, first, second] = part.split(":");
  switch (family) {
    case "step":
      return shapeMachineText.stepTooltip(parameterName(first), Number(second));
    case "value":
      return shapeMachineText.valueTooltip(parameterName(first));
    case "preset": {
      const labels: Readonly<Record<string, string | undefined>> = {
        square: shapeMachineText.presets.square,
        "half-shift": shapeMachineText.presets.halfShift,
        "whole-shift": shapeMachineText.presets.wholeShift,
        tall: shapeMachineText.presets.tall,
      };
      const label = labels[first ?? ""];
      return label === undefined ? undefined : shapeMachineText.presetTooltip(label);
    }
    case "key":
      return first === "ok" ? shapeMachineText.ok : first === "cancel" ? shapeMachineText.cancel : first === "back" ? shapeMachineText.backspace : first;
    case "more":
      return shapeMachineText.moreTooltip;
    case "go":
      return shapeMachineText.reshapeTooltip;
    case "diagram":
      return shapeMachineText.diagramTooltip;
    case "same-as-start":
      return shapeMachineText.sameAsStart;
    default:
      return undefined;
  }
}

function toolTooltip(toolId: string): string | undefined {
  switch (toolId) {
    case "none":
      return `${toolNames.none.name}: ${toolNames.none.subtitle}`;
    case "placedFlags/flag":
      return `${toolNames["placedFlags/flag"].name}: ${toolNames["placedFlags/flag"].subtitle}`;
    case "geodesicEmitters/emitter":
      return `${toolNames["geodesicEmitters/emitter"].name}: ${toolNames["geodesicEmitters/emitter"].subtitle}`;
    case "geodesicMeasurements/length":
      return `${toolNames["geodesicMeasurements/length"].name}: ${toolNames["geodesicMeasurements/length"].subtitle}`;
    case "geodesicMeasurements/protractor":
      return `${toolNames["geodesicMeasurements/protractor"].name}: ${toolNames["geodesicMeasurements/protractor"].subtitle}`;
    case "worldMap/map":
      return `${toolNames["worldMap/map"].name}: ${toolNames["worldMap/map"].subtitle}`;
    default:
      return undefined;
  }
}
