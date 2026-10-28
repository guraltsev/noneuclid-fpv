/**
 * Defines the optional UI widgets that launch options can show (WorldSelector, DebugButton) as a constant table that is the source of truth for the UiOptionId type, with canonical parse and serialize helpers for the comma-separated URL form.
 */
/** Ordered table of UI options with id and label. */
export const uiOptionDefinitions = [
  {
    id: "WorldSelector",
    label: "World Selector",
  },
  {
    id: "DebugButton",
    label: "Debug Button",
  },
] as const;

/** Id of a UI option, derived from uiOptionDefinitions. */
export type UiOptionId = (typeof uiOptionDefinitions)[number]["id"];

const uiOptionIds = new Set<UiOptionId>(uiOptionDefinitions.map((option) => option.id));

/**
 * Parses a comma-separated list of UI option ids, dropping unknown entries and returning the rest deduplicated in table order; null or empty gives [].
 */
export function parseUiOptions(rawValue: string | null): readonly UiOptionId[] {
  if (!rawValue) {
    return [];
  }

  const requestedIds = new Set(
    rawValue
    .split(",")
    .map((value) => value.trim())
      .filter((value): value is UiOptionId => uiOptionIds.has(value as UiOptionId)),
  );

  return uiOptionDefinitions.map((option) => option.id).filter((optionId) => requestedIds.has(optionId));
}

/** Serializes UI options to a comma-separated string in table order. */
export function serializeUiOptions(uiOptions: readonly UiOptionId[]): string {
  return uiOptionDefinitions
    .map((option) => option.id)
    .filter((optionId) => uiOptions.includes(optionId))
    .join(",");
}

/** Returns whether the option is in the list. */
export function hasUiOption(uiOptions: readonly UiOptionId[], optionId: UiOptionId): boolean {
  return uiOptions.includes(optionId);
}
