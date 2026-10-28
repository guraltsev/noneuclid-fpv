/**
 * Renderer-neutral definition of the contextual "help lens" panel shown on desktop and in VR: a title, a body sentence and rows pairing an input glyph with an action label.
 * When the player is focusing a world object the lens describes that object and its available actions; otherwise it describes the currently selected tool (or the generic Explore text).
 * Input glyphs come from inputIntents.ts so the same definition renders correctly for keyboard/mouse and for VR controllers. The module is pure and builds fresh immutable records on each call.
 */
import type { RuntimeToolId } from "../runtime/runtimeMenuState";
import type { InputMode } from "./inputIntents";
import { formatBodyForInputMode } from "./inputModeText";
import { getInputHintGlyph, type InputHintGlyph } from "./inputIntents";
import type { WorldFocusMessageDefinition } from "./worldInteractionDefinition";

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
}

/**
 * Builds the help lens for the focused object when there is one, else for the selected tool; rows list only available actions (object case) with glyphs for the given input mode.
 */
export function createHelpLensDefinition(options: CreateHelpLensDefinitionOptions): HelpLensDefinition {
  if (options.focus) {
    return createFocusedHelpLens(options.focus, options.inputMode);
  }

  return createToolHelpLens(options.selectedTool, options.inputMode);
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

function createToolHelpLens(selectedTool: RuntimeToolId, inputMode: InputMode): HelpLensDefinition {
  const moveHint = getInputHintGlyph(inputMode, "move");
  const primaryHint = getInputHintGlyph(inputMode, "primary");
  const contextHint = getInputHintGlyph(inputMode, "context-menu");
  switch (selectedTool) {
    case "place-flag":
      return {
        title: "Sign tool",
        body: "Places a note on the floor where you aim.",
        rows: [row(primaryHint, "place sign"), row(contextHint, "open tools")],
      };
    case "geodesic-cannon":
      return {
        title: "Ray tool",
        body: "Places geodesic emitters and starts locally straight rays.",
        rows: [row(primaryHint, "place or continue ray"), row(contextHint, "open choices")],
      };
    case "measure-length":
      return {
        title: "Length tool",
        body: "Measures total length along a selected geodesic.",
        rows: [row(primaryHint, "choose geodesic"), row(contextHint, "open choices")],
      };
    case "protractor":
      return {
        title: "Protractor tool",
        body: "Measures the angle between two geodesic sides at a vertex.",
        rows: [row(primaryHint, "select vertex or side"), row(contextHint, "open choices")],
      };
    case "geodesic-cannon-carry":
      return {
        title: "Carry emitter",
        body: "Moves the selected geodesic emitter while preserving its editable rays.",
        rows: [row(primaryHint, "place emitter")],
      };
    case "geodesic-cannon-rotate":
      return {
        title: "Rotate ray",
        body: "Turns the selected geodesic around its emitter.",
        rows: [row(primaryHint, "finish rotation")],
      };
    case "geodesic-cannon-aim":
      return {
        title: "Aim ray",
        body: "Points the selected geodesic toward the aimed location.",
        rows: [row(primaryHint, "accept aim")],
      };
    case "geodesic-cannon-tie-detach":
      return {
        title: "Tie and detach",
        body: "Selects two locked incident geodesics and rebuilds them as a detached path.",
        rows: [row(primaryHint, "select geodesic")],
      };
    case "aim":
    case "none":
      return {
        title: "Explore",
        body: inputMode === "desktop"
          ? "Move with Arrow keys. Look at objects to see available actions, or open the tools menu."
          : "Move with the left stick. Look at objects to see available actions, or open the tools menu.",
        rows: [row(moveHint, "move"), row(primaryHint, "use selected/default action"), row(contextHint, "open tools or object menu")],
      };
  }
}

function row(hint: InputHintGlyph, label: string): HelpLensRow {
  return { hint, label };
}

const helpBodyByTopic: Readonly<Record<string, Readonly<Record<InputMode, string>>>> = {
  sign: {
    desktop: "A placed note in the world. Right click its menu to edit text or delete it.",
    xr: "A placed note in the world. Use the side trigger menu to edit text or delete it.",
  },
  "geometry-computer": {
    desktop: "Changes world deformation for worlds that support live geometry deformation.",
    xr: "Changes world deformation for worlds that support live geometry deformation.",
  },
  "geodesic-emitter": {
    desktop: "Creates and edits geodesic rays from this point. Right click to open its menu.",
    xr: "Creates and edits geodesic rays from this point. Use side trigger to open its menu.",
  },
  "geodesic-segment": {
    desktop: "A locally straight ray segment. Left click with the active tool to extend, measure, or select it.",
    xr: "A locally straight ray segment. Use trigger with the active tool to extend, measure, or select it.",
  },
  "geodesic-vertex": {
    desktop: "A meeting point where geodesic sides can be selected for angle measurement.",
    xr: "A meeting point where geodesic sides can be selected for angle measurement.",
  },
  "measured-length": {
    desktop: "A persistent length result attached to a geodesic. Left click to remove it.",
    xr: "A persistent length result attached to a geodesic. Use trigger to remove it.",
  },
  "protractor-angle": {
    desktop: "A persistent angle result between two selected geodesic sides. Left click to remove it.",
    xr: "A persistent angle result between two selected geodesic sides. Use trigger to remove it.",
  },
  creature: {
    desktop: "A moving object following the geometry of the world.",
    xr: "A moving object following the geometry of the world.",
  },
};
