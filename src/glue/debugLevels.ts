/**
 * Defines the debug levels (off, basic, verbose) as a single constant table that is the source of truth for the DebugLevelId type, the settings UI and URL parsing.
 * Level semantics: "off" disables debug systems, "basic" lets selected debug features run, "verbose" additionally keeps detailed console traces flowing.
 */
/** Ordered table of debug levels with id, menu label and description. */
export const debugLevelDefinitions = [
  {
    id: "off",
    label: "Off",
    description: "Keep debug systems disabled while leaving the launcher available.",
  },
  {
    id: "basic",
    label: "Basic",
    description: "Enable selected visual and runtime debug features.",
  },
  {
    id: "verbose",
    label: "Verbose",
    description: "Enable selected debug features and keep detailed console traces flowing.",
  },
] as const;

/** Id of a debug level, derived from debugLevelDefinitions. */
export type DebugLevelId = (typeof debugLevelDefinitions)[number]["id"];

const debugLevelIds = new Set<DebugLevelId>(debugLevelDefinitions.map((level) => level.id));

/**
 * Returns the matching DebugLevelId for an exact id string, or undefined for null, empty or unknown input.
 */
export function parseDebugLevel(rawValue: string | null): DebugLevelId | undefined {
  if (!rawValue) {
    return undefined;
  }

  return debugLevelIds.has(rawValue as DebugLevelId) ? (rawValue as DebugLevelId) : undefined;
}

/** Returns true for every level except "off". */
export function isDebugLevelEnabled(debugLevel: DebugLevelId): boolean {
  return debugLevel !== "off";
}

/** Returns true only for "verbose". */
export function isVerboseDebugLevel(debugLevel: DebugLevelId): boolean {
  return debugLevel === "verbose";
}
