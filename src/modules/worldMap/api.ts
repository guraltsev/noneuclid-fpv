/**
 * The world map's public face (design 013 section 12.1): the tool's id. The map changes nothing in the world, so the module has no commands, kinds or queries.
 */

declare module "../../glue/toolIds" {
  interface ModuleToolIds {
    /** The map tool: holds the world in miniature until it is dismissed. */
    worldMapMap: "worldMap/map";
  }
}

/** The id of the map tool. */
export const worldMapToolId = "worldMap/map" as const;
