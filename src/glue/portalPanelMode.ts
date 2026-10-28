/**
 * Defines the portal panel display modes (none, panel, panel-with-text, text-only) as a constant table and the predicates deciding which portal visuals a mode draws.
 * The wall is the textured portal surface; the placard/text is the label with its dark backing panel.
 */
/** Ordered table of portal panel modes with id, label and description. */
export const portalPanelModeDefinitions = [
  {
    id: "none",
    label: "None",
    description: "Hide the textured portal wall and its label placard.",
  },
  {
    id: "panel",
    label: "Panel",
    description: "Show the textured portal wall without the label placard.",
  },
  {
    id: "panel-with-text",
    label: "Panel With Text",
    description: "Show the textured portal wall with the label placard.",
  },
  {
    id: "text-only",
    label: "Text Only",
    description: "Show portal labels with the dark label backing panel but without the textured portal wall.",
  },
] as const;

/** Id of a portal panel mode, derived from portalPanelModeDefinitions. */
export type PortalPanelModeId = (typeof portalPanelModeDefinitions)[number]["id"];

const portalPanelModeIds = new Set<PortalPanelModeId>(portalPanelModeDefinitions.map((mode) => mode.id));

/** Returns the matching mode for an exact id string, or undefined for null, empty or unknown input. */
export function parsePortalPanelMode(rawValue: string | null): PortalPanelModeId | undefined {
  if (!rawValue) {
    return undefined;
  }

  return portalPanelModeIds.has(rawValue as PortalPanelModeId) ? (rawValue as PortalPanelModeId) : undefined;
}

/** Returns true for modes that draw the textured portal wall (panel, panel-with-text). */
export function shouldRenderPortalWall(mode: PortalPanelModeId): boolean {
  return mode === "panel" || mode === "panel-with-text";
}

/** Returns true for modes that draw the label placard (panel-with-text, text-only). */
export function shouldRenderPortalPlacard(mode: PortalPanelModeId): boolean {
  return mode === "panel-with-text" || mode === "text-only";
}

/** Returns true for modes that draw portal label text (panel-with-text, text-only). */
export function shouldRenderPortalText(mode: PortalPanelModeId): boolean {
  return mode === "panel-with-text" || mode === "text-only";
}
