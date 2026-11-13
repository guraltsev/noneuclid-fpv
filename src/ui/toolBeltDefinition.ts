/**
 * The tool belt (design 017 section 7.4) as renderer-neutral data: an ordered list of slots, each with its key, icon id, name, subtitle, availability and whether it is the slot in hand.
 * Role: pure. The desktop DOM belt (`src/render/dom/toolBelt.ts`) draws it today; the VR belt of job 77 draws the same list, so every layout shows the same slots in the same order. It holds no state and reads no clock.
 * Order: Hand (key "0"), Laser, Ruler, Protractor, Sign, Map (keys "1" to "5"), then the main menu slot (key "Esc"). A tool the app config switches off is left out; a tool the world cannot support (the map outside a Platonic solid) stays, disabled, with its reason. Names and subtitles come from the vocabulary module.
 */
import type { AppConfig } from "../glue/appConfig";
import type { RuntimeToolId } from "../glue/toolIds";
import { toolBeltText, toolNames } from "./vocabulary";

/** What a slot stands for: the empty hand, a main tool, or the main menu. */
export type ToolBeltSlotId = RuntimeToolId | "hand" | "main-menu";

/** Which picture a slot shows; the renderer maps it to an image. */
export type ToolBeltIconId = "hand" | "laser" | "ruler" | "protractor" | "sign" | "map" | "menu";

/** One slot of the belt. */
export interface ToolBeltSlot {
  /** The key that takes the slot: "0" to "5", or "Esc" for the main menu. */
  readonly key: string;
  readonly toolId: ToolBeltSlotId;
  readonly icon: ToolBeltIconId;
  readonly name: string;
  readonly subtitle: string;
  readonly enabled: boolean;
  /** Why the slot cannot be taken; present only when `enabled` is false. */
  readonly disabledReason?: string;
  /** True for the slot of the tool in hand (the Hand when no tool is selected). Never true for the main menu. */
  readonly active: boolean;
}

/** The belt: the slots in order. */
export interface ToolBeltDefinition {
  readonly slots: readonly ToolBeltSlot[];
}

/** What the belt is built from. */
export interface ToolBeltSource {
  /** The app config as loaded, before it was narrowed to the world: the config's own switches decide which tools are left out. */
  readonly appConfig: AppConfig;
  /** Whether the world has a map (it is a Platonic solid). */
  readonly worldHasMap: boolean;
  /** The selected tool id; "none" is the Hand. Sub-modes of a tool (rotate, aim, carry, join) count as that tool. */
  readonly selectedTool: RuntimeToolId;
}

/** The main tools in belt order with their keys and icons. */
const beltTools = [
  { key: "1", id: "geodesicEmitters/emitter", icon: "laser", enabled: (config: AppConfig) => config.tools.geodesicEmitters },
  { key: "2", id: "geodesicMeasurements/length", icon: "ruler", enabled: (config: AppConfig) => config.tools.distances },
  { key: "3", id: "geodesicMeasurements/protractor", icon: "protractor", enabled: (config: AppConfig) => config.tools.angles },
  { key: "4", id: "placedFlags/flag", icon: "sign", enabled: (config: AppConfig) => config.tools.placeFlags },
  { key: "5", id: "worldMap/map", icon: "map", enabled: (config: AppConfig) => config.tools.worldMap },
] as const;

/** True for the laser's own modes (carry, rotate, aim), which end with their own action and are not left through the belt's Hand or the key 0. */
export function isEmitterMode(toolId: RuntimeToolId): boolean {
  return toolId.startsWith("geodesicEmitters/") && toolId !== "geodesicEmitters/emitter";
}

/** The slot of the belt that stands for `selectedTool`: a sub-mode of the laser or of Join is the Laser; no tool or an unknown id is the Hand. */
export function activeBeltToolId(selectedTool: RuntimeToolId): ToolBeltSlotId {
  if (selectedTool === "none") return "hand";
  if (selectedTool.startsWith("geodesicEmitters/") || selectedTool === "geodesicModel/tie") return "geodesicEmitters/emitter";
  return selectedTool;
}

/** Builds the belt. */
export function createToolBeltDefinition(source: ToolBeltSource): ToolBeltDefinition {
  const activeId = activeBeltToolId(source.selectedTool);
  const slots: ToolBeltSlot[] = [
    {
      key: "0",
      toolId: "hand",
      icon: "hand",
      name: toolNames.none.name,
      subtitle: toolNames.none.subtitle,
      enabled: true,
      active: activeId === "hand",
    },
  ];
  for (const tool of beltTools) {
    if (!tool.enabled(source.appConfig)) continue;
    const names = toolNames[tool.id];
    const unsupported = tool.id === "worldMap/map" && !source.worldHasMap;
    slots.push({
      key: tool.key,
      toolId: tool.id,
      icon: tool.icon,
      name: names.name,
      subtitle: names.subtitle,
      enabled: !unsupported,
      ...(unsupported ? { disabledReason: toolBeltText.noMapForWorld } : {}),
      active: activeId === tool.id,
    });
  }
  slots.push({
    key: "Esc",
    toolId: "main-menu",
    icon: "menu",
    name: toolBeltText.mainMenuName,
    subtitle: toolBeltText.mainMenuSubtitle,
    enabled: true,
    active: false,
  });
  return { slots };
}

/**
 * The slot the wheel reaches from `fromToolId`, stepping by `direction` (+1 next, -1 previous) over the enabled slots among the Hand and the tools, never the main menu; it wraps around. Returns undefined when no other slot can be taken.
 */
export function stepBeltSlot(definition: ToolBeltDefinition, fromToolId: ToolBeltSlotId, direction: 1 | -1): ToolBeltSlot | undefined {
  const reachable = definition.slots.filter((slot) => slot.toolId !== "main-menu" && slot.enabled);
  const index = reachable.findIndex((slot) => slot.toolId === fromToolId);
  if (reachable.length === 0 || (index >= 0 && reachable.length === 1)) return undefined;
  // From a slot that is not reachable (never the case for the active slot) start at the Hand's side.
  const start = index >= 0 ? index : direction === 1 ? -1 : 0;
  return reachable[(start + direction + reachable.length) % reachable.length];
}

/** The slot a key takes ("0" to "5"), if the belt has it. */
export function beltSlotForKey(definition: ToolBeltDefinition, key: string): ToolBeltSlot | undefined {
  return definition.slots.find((slot) => slot.key === key);
}
