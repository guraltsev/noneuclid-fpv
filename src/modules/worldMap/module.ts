/**
 * The world map module (design 013 section 16): it defines the map tool, so the engine can gate it. The map only reads the world, so the module has no commands, kinds or ticks.
 */
import type { ModuleDefinition } from "../../engine/moduleTypes";
import { worldMapToolId } from "./api";

/** The module as the engine's list takes it. */
export type WorldMapModuleDefinition = ModuleDefinition<undefined, never, never>;

/** Creates the world map module. It requires nothing. */
export function worldMapModule(): WorldMapModuleDefinition {
  return {
    id: "worldMap",
    requires: [],
    objectKinds: [],
    toolIds: [worldMapToolId],
    create: () => ({ api: undefined, queries: undefined, commands: {}, ticks: [] }),
  };
}
