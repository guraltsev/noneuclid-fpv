/**
 * Defines the individual debug options (diagnostics logging, portal path/cull inspection, overlays, wireframes, hitbox displays) as a constant table that is the source of truth for the DebugOptionId type.
 * Parsing and serialization of the comma-separated URL form is canonical: unknown ids are dropped, duplicates removed and the result ordered by table position. Options only take effect when the debug level is not "off" (see hasActiveDebugOption).
 */
/** Ordered table of debug options with id, label and description. */
export const debugOptionDefinitions = [
  {
    id: "runtime-diagnostics",
    label: "Runtime Diagnostics",
    description: "Log asset loads, portal crossings, and slow frames to the dev console.",
  },
  {
    id: "portal-path-debug",
    label: "Portal Path Debug",
    description: "Expose portal path table summaries and dev-console inspection helpers.",
  },
  {
    id: "portal-static-cull-debug",
    label: "Portal Static Cull Debug",
    description: "Include static portal culling summaries and rejected path details.",
  },
  {
    id: "portal-visible-path-debug",
    label: "Portal Visible Path Debug",
    description: "Compute live camera-visible portal paths and show compact per-frame counts.",
  },
  {
    id: "portal-path-overlays",
    label: "Portal Path Overlays",
    description: "Allow temporary visual overlays for inspected portal paths.",
  },
  {
    id: "portal-path-overlay-instances",
    label: "ShowCellPathRendersInstances",
    description: "Render ShowCellPath overlays through the portal instance archetype path.",
  },
  {
    id: "forbidden-zone-wireframes",
    label: "Forbidden Zone Wireframes",
    description: "Render wireframe columns around forbidden portal junction zones.",
  },
  {
    id: "object-collision-wireframes",
    label: "Object Collision Wireframes",
    description: "Render wireframe cylinders for object collision shapes.",
  },
  {
    id: "selectable-hitboxes",
    label: "Selectable Hitboxes",
    description: "Render colored volumes used by the aimer for selectable objects.",
  },
  {
    id: "aim-collision-outlines",
    label: "Aim Collision Outlines",
    description: "Render wireframe outlines around the volumes used by object aiming.",
  },
] as const;

/** Id of a debug option, derived from debugOptionDefinitions. */
export type DebugOptionId = (typeof debugOptionDefinitions)[number]["id"];

const debugOptionIds = new Set<DebugOptionId>(debugOptionDefinitions.map((option) => option.id));

/**
 * Parses a comma-separated list of option ids (whitespace tolerated), dropping unknown entries and returning the rest deduplicated in table order; null or empty gives [].
 */
export function parseDebugOptions(rawValue: string | null): readonly DebugOptionId[] {
  if (!rawValue) {
    return [];
  }

  const requestedIds = new Set(
    rawValue
    .split(",")
    .map((value) => value.trim())
      .filter((value): value is DebugOptionId => debugOptionIds.has(value as DebugOptionId)),
  );

  return debugOptionDefinitions.map((option) => option.id).filter((optionId) => requestedIds.has(optionId));
}

/** Serializes options to a comma-separated string in table order, omitting duplicates. */
export function serializeDebugOptions(debugOptions: readonly DebugOptionId[]): string {
  return debugOptionDefinitions
    .map((option) => option.id)
    .filter((optionId) => debugOptions.includes(optionId))
    .join(",");
}

/** Returns whether the option is in the list, regardless of debug level. */
export function hasDebugOption(debugOptions: readonly DebugOptionId[], optionId: DebugOptionId): boolean {
  return debugOptions.includes(optionId);
}

/** Returns whether the option is in the list and the debug level is not "off". */
export function hasActiveDebugOption(
  debugLevel: "off" | "basic" | "verbose",
  debugOptions: readonly DebugOptionId[],
  optionId: DebugOptionId,
): boolean {
  return debugLevel !== "off" && hasDebugOption(debugOptions, optionId);
}
