/**
 * Renderer-neutral definition of the contextual "help lens" panel shown on desktop and in VR: a title, a body sentence and rows pairing an input glyph with an action label.
 * When the player is focusing a world object the lens describes that object and its available actions; otherwise it describes the currently selected tool (or the generic Explore text).
 * Input glyphs come from inputIntents.ts so the same definition renders correctly for keyboard/mouse and for VR controllers. The module is pure and builds fresh immutable records on each call.
 */
import type { RuntimeToolId } from "../glue/toolIds";
import type { ToolsById } from "../runtime/toolRegistry";
import type { InputMode } from "./inputIntents";
import { formatBodyForInputMode } from "./inputModeText";
import { getInputHintGlyph, type InputHintGlyph } from "./inputIntents";
import type { WorldFocusMessageDefinition } from "./worldInteractionDefinition";
import { objectSubtitles, toolNames } from "../world-objects/vocabulary";

/** One help line: an input hint glyph and what that input does. */
export interface HelpLensRow {
  readonly hint: InputHintGlyph;
  readonly label: string;
}

/** Content of the help lens: title, explanatory body and action rows. */
export interface HelpLensDefinition {
  readonly title: string;
  readonly body: string;
  readonly rows: readonly HelpLensRow[];
}

/** Inputs that decide what the help lens describes. */
export interface CreateHelpLensDefinitionOptions {
  /** Definition of the object currently focused, if any; takes precedence over the tool. */
  readonly focus?: WorldFocusMessageDefinition;
  /** Active tool, described when nothing is focused. */
  readonly selectedTool: RuntimeToolId;
  /** Whether to word text and choose glyphs for desktop or XR. */
  readonly inputMode: InputMode;
  /** The shell's tool lookup; the selected tool's help comes from its descriptor. */
  readonly toolsById: ToolsById;
}

/**
 * Builds the help lens for the focused object when there is one, else for the selected tool; rows list only available actions (object case) with glyphs for the given input mode.
 */
export function createHelpLensDefinition(options: CreateHelpLensDefinitionOptions): HelpLensDefinition {
  if (options.focus) {
    return createFocusedHelpLens(options.focus, options.inputMode);
  }

  return createToolHelpLens(options.selectedTool, options.inputMode, options.toolsById);
}

/**
 * Builds the lens for a focused object: body is the object's displayHelpMessage (rewritten for the input mode), else the topic text, else a generic sentence.
 */
function createFocusedHelpLens(focus: WorldFocusMessageDefinition, inputMode: InputMode): HelpLensDefinition {
  const topic = focus.helpTopicId ?? "default";
  const body = focus.displayHelpMessage
    ? formatBodyForInputMode(focus.displayHelpMessage, inputMode)
    : helpBodyByTopic[topic]?.[inputMode] ?? "A world object you can inspect from here.";
  const actionRows = focus.actions
    .filter((action) => action.available)
    .map((action) => ({
      hint: getInputHintGlyph(inputMode, action.intent),
      label: action.label,
    }));

  return {
    title: focus.title,
    body,
    rows: actionRows,
  };
}

function createToolHelpLens(selectedTool: RuntimeToolId, inputMode: InputMode, toolsById: ToolsById): HelpLensDefinition {
  const moveHint = getInputHintGlyph(inputMode, "move");
  const primaryHint = getInputHintGlyph(inputMode, "primary");
  const contextHint = getInputHintGlyph(inputMode, "context-menu");
  const tool = toolsById.get(selectedTool);
  if (tool !== undefined) {
    return {
      title: tool.helpTitle,
      body: tool.helpBody,
      rows: tool.helpRows.map((helpRow) => row(helpRow.input === "primary" ? primaryHint : contextHint, helpRow.label)),
    };
  }
  // No tool (none, aim): the explore text.
  return {
    title: toolNames.none.name,
    body: inputMode === "desktop"
      ? `Move with Arrow keys. ${toolNames.none.subtitle}: look at things to see what you can do, or open the menu.`
      : `Move with the left stick. ${toolNames.none.subtitle}: look at things to see what you can do, or open the menu.`,
    rows: [row(moveHint, "move"), row(primaryHint, "use what you aim at"), row(contextHint, "open the menu of what you aim at")],
  };
}

function row(hint: InputHintGlyph, label: string): HelpLensRow {
  return { hint, label };
}

const helpBodyByTopic: Readonly<Record<string, Readonly<Record<InputMode, string>>>> = {
  sign: {
    desktop: "A sign marks a place with a name. Right click its menu to rename or delete it.",
    xr: "A sign marks a place with a name. Use the side trigger menu to rename or delete it.",
  },
  "geometry-computer": {
    desktop: "The shape machine changes the shape of this world. It tells you when two settings are the same flat torus.",
    xr: "The shape machine changes the shape of this world. It tells you when two settings are the same flat torus.",
  },
  "geodesic-emitter": {
    desktop: "A laser fires straight beams from this point. Right click to open its menu.",
    xr: "A laser fires straight beams from this point. Use side trigger to open its menu.",
  },
  "geodesicModel/segment": {
    desktop: `${objectSubtitles.beam}. Left click with the active tool to make it longer, measure it, or pick it.`,
    xr: `${objectSubtitles.beam}. Use trigger with the active tool to make it longer, measure it, or pick it.`,
  },
  "geodesic-vertex": {
    desktop: "A meeting point of two beams. Use the Protractor to pick beams leaving it and measure the angle.",
    xr: "A meeting point of two beams. Use the Protractor to pick beams leaving it and measure the angle.",
  },
  "measured-length": {
    desktop: "A measurement of one beam. Left click to delete it.",
    xr: "A measurement of one beam. Use trigger to delete it.",
  },
  "protractor-angle": {
    desktop: "A measurement of the angle between two beams. Left click to delete it.",
    xr: "A measurement of the angle between two beams. Use trigger to delete it.",
  },
  creature: {
    desktop: "A moving object following the geometry of the world.",
    xr: "A moving object following the geometry of the world.",
  },
};
