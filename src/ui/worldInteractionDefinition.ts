/**
 * Renderer-neutral description of what the player can do with the world object they are focusing: its title and a prioritized list of actions, each bound to an abstract input intent.
 * createWorldFocusMessageDefinition decides the actions from the object's kind and the active tool (for example, a geodesic segment offers Measure under the length tool, Select side under the protractor, otherwise Extend or a disabled Locked entry). Both the desktop focus tooltip and the VR panel render this one definition, and the help lens reuses it.
 * Everything is a pure function of its inputs and returns fresh immutable records.
 */
import type { RuntimeToolId } from "../runtime/runtimeMenuState";
import type { RuntimeWorldObject } from "../world-objects/runtimeObjectRegistry";
import type { InputIntent, InputMode } from "./inputIntents";
import { getInputHintGlyph } from "./inputIntents";

/** Identifier of an action the player may perform on a focused world object. */
export type WorldInteractionActionId =
  | "open-object-menu"
  | "edit-sign"
  | "open-geometry-computer"
  | "open-tutorial"
  | "extend-geodesic"
  | "measure-length"
  | "select-protractor-side"
  | "select-protractor-vertex"
  | "remove-measurement"
  | "remove-angle"
  | "add-geodesic"
  | "carry-emitter"
  | "rotate-geodesic"
  | "aim-geodesic"
  | "tie-detach-geodesics"
  | "delete-geodesic";

/** One action offered on a focused object, with the input intent that triggers it. */
export interface WorldInteractionAction {
  readonly id: WorldInteractionActionId;
  readonly label: string;
  /**
   * Abstract input (primary or context-menu) that triggers the action; resolved to a concrete control via inputIntents.ts.
   */
  readonly intent: InputIntent;
  /** False when the action is shown but cannot currently be used. */
  readonly available: boolean;
  /** Optional explanation to show when the action is unavailable. */
  readonly unavailableReason?: string;
  /** Sort key for display; lower values come first and missing means 0. */
  readonly priority?: number;
}

/** Content of the focus message for one world object: title, optional subtitle, actions and help text. */
export interface WorldFocusMessageDefinition {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions: readonly WorldInteractionAction[];
  /** Key into the help lens's per-topic body text; undefined uses a generic description. */
  readonly helpTopicId?: string;
  /** Author-provided help text from the object, which overrides the topic text. */
  readonly displayHelpMessage?: string;
}

/** Inputs for building the focus message of an object. */
export interface CreateWorldFocusMessageDefinitionOptions {
  readonly object: RuntimeWorldObject;
  readonly selectedTool: RuntimeToolId;
  /**
   * Whether the focused geodesic segment may be extended; when false and no measuring tool is active the segment shows a disabled "Locked" action.
   */
  readonly canExtendGeodesic?: boolean;
}

/**
 * Builds the focus definition for an object from its kind and the selected tool, or returns undefined when the object has no tooltip or interactable label.
 */
export function createWorldFocusMessageDefinition(
  options: CreateWorldFocusMessageDefinitionOptions,
): WorldFocusMessageDefinition | undefined {
  const title = options.object.tooltip?.label ?? options.object.interactable?.label;
  if (!title) {
    return undefined;
  }

  switch (options.object.kind) {
    case "placed-flag":
      return withObjectHelp(options.object, {
        title,
        actions: [contextAction("edit-sign", "Edit")],
        helpTopicId: "sign",
      });
    case "asset":
      if (options.object.interactable?.action === "open-geometry-computer") {
        return withObjectHelp(options.object, {
          title,
          actions: [contextAction("open-geometry-computer", "World deformation")],
          helpTopicId: "geometry-computer",
        });
      }
      if (options.object.interactable?.action === "open-tutorial") {
        return withObjectHelp(options.object, {
          title,
          actions: [primaryAction("open-tutorial", "Read")],
        });
      }
      return withObjectHelp(options.object, { title, actions: [] });
    case "geodesic-cannon":
      return withObjectHelp(options.object, {
        title,
        actions: [contextAction("open-object-menu", "Emitter menu")],
        helpTopicId: "geodesic-emitter",
      });
    case "geodesic-segment":
      return withObjectHelp(options.object, {
        title,
        actions: getGeodesicSegmentActions(options),
        helpTopicId: "geodesic-segment",
      });
    case "geodesic-intersection":
      return withObjectHelp(options.object, {
        title,
        actions: options.selectedTool === "protractor"
          ? [primaryAction("select-protractor-vertex", "Select for protractor")]
          : [],
        helpTopicId: "geodesic-vertex",
      });
    case "measured-geodesic-length":
      return withObjectHelp(options.object, {
        title,
        actions: [primaryAction("remove-measurement", "Remove")],
        helpTopicId: "measured-length",
      });
    case "protractor-angle":
      return withObjectHelp(options.object, {
        title,
        actions: [primaryAction("remove-angle", "Delete measurement")],
        helpTopicId: "protractor-angle",
      });
    case "geodesci-marmot":
    case "geo-mouse":
    case "geo-butterfly":
      return withObjectHelp(options.object, {
        title,
        actions: [],
        helpTopicId: "creature",
      });
  }
}

/**
 * Formats a definition as plain multi-line text (title, subtitle, then "<input> - <label>" per available action sorted by priority) for renderers without rich panels; returns undefined for an undefined definition.
 */
export function formatWorldFocusMessageTextForLegacyFallback(
  definition: WorldFocusMessageDefinition | undefined,
  mode: InputMode,
): string | undefined {
  if (!definition) {
    return undefined;
  }

  const rows = [definition.title];
  if (definition.subtitle) {
    rows.push(definition.subtitle);
  }

  const availableActions = [...definition.actions]
    .filter((action) => action.available)
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
  for (const action of availableActions) {
    const hints = getActionHintLabels(mode, action);
    rows.push(hints.length > 0 ? `${hints.join(" / ")} - ${action.label}` : action.label);
  }

  return rows.join("\n");
}

function getGeodesicSegmentActions(
  options: CreateWorldFocusMessageDefinitionOptions,
): readonly WorldInteractionAction[] {
  if (options.selectedTool === "measure-length") {
    return [primaryAction("measure-length", "Measure length")];
  }

  if (options.selectedTool === "protractor") {
    return [primaryAction("select-protractor-side", "Select side")];
  }

  if (options.canExtendGeodesic) {
    return [primaryAction("extend-geodesic", "Extend")];
  }

  return [{
    id: "extend-geodesic",
    label: "Locked",
    intent: "primary",
    available: false,
  }];
}

function withObjectHelp(
  object: RuntimeWorldObject,
  definition: Omit<WorldFocusMessageDefinition, "displayHelpMessage">,
): WorldFocusMessageDefinition {
  return {
    ...definition,
    displayHelpMessage: object.displayHelpMessage,
  };
}

function contextAction(id: WorldInteractionActionId, label: string): WorldInteractionAction {
  return {
    id,
    label,
    intent: "context-menu",
    available: true,
  };
}

function primaryAction(id: WorldInteractionActionId, label: string): WorldInteractionAction {
  return {
    id,
    label,
    intent: "primary",
    available: true,
  };
}

function getActionHintLabels(mode: InputMode, action: WorldInteractionAction): readonly string[] {
  const hints = [getInputHintGlyph(mode, action.intent).label];
  if (mode === "desktop" && action.intent === "context-menu") {
    hints.push(getInputHintGlyph(mode, "keyboard-context-fallback").label);
  }
  return hints;
}
