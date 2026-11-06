/**
 * Identifiers of the player's tools and of the debug-overlay items, with the canonical parse and serialize of the overlay-item list.
 * They are plain vocabulary shared by app configuration, launch options, the menu state machine and the palette definitions, kept here so that configuration does not have to import the menu state.
 */

/** Item that can be shown in the on-screen debug overlay. */
export type RuntimeDebugOverlayItemId = "fps" | "location" | "portal-quantities";
/** Tool of the shell that the player can have active, including the emitter's sub-modes. */
export type CoreToolId =
  | "none"
  | "aim"
  | "placedFlags/flag"
  | "geodesicEmitters/carry"
  | "geodesicEmitters/rotate"
  | "geodesicEmitters/aim";

/**
 * The tool ids that modules define (design 013 section 8.3): each module adds its ids by interface merging, in its `api.ts`, as `interface ModuleToolIds { geodesicModelTie: "geodesicModel/tie" }`
 * (the property name is free; the value is the id, `<moduleId>/<name>`).
 */
export interface ModuleToolIds {}

/** Tool the player can have active: a core tool or one that a module defines. */
export type RuntimeToolId = CoreToolId | ModuleToolIds[keyof ModuleToolIds];

/** Overlay items shown when a launch does not choose any, in canonical order. */
export const defaultRuntimeDebugOverlayItems = ["fps", "location", "portal-quantities"] as const;

/**
 * Parses a comma-separated list of overlay item ids (null means all defaults), dropping unknown entries and returning canonical order.
 */
export function parseRuntimeDebugOverlayItems(rawValue: string | null): readonly RuntimeDebugOverlayItemId[] {
  if (rawValue === null) {
    return [...defaultRuntimeDebugOverlayItems];
  }

  const knownItems = new Set<RuntimeDebugOverlayItemId>(defaultRuntimeDebugOverlayItems);
  const requestedItems = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is RuntimeDebugOverlayItemId => knownItems.has(value as RuntimeDebugOverlayItemId));

  return orderRuntimeDebugOverlayItems(requestedItems);
}

/** Serializes overlay items to a canonical comma-separated string. */
export function serializeRuntimeDebugOverlayItems(
  items: readonly RuntimeDebugOverlayItemId[],
): string {
  return orderRuntimeDebugOverlayItems(items).join(",");
}

/** Returns the requested overlay items without duplicates, in canonical order. */
export function orderRuntimeDebugOverlayItems(
  items: readonly RuntimeDebugOverlayItemId[],
): readonly RuntimeDebugOverlayItemId[] {
  const requestedItems = new Set(items);
  return defaultRuntimeDebugOverlayItems.filter((itemId) => requestedItems.has(itemId));
}
