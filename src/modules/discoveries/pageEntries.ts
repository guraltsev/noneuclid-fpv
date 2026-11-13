/**
 * The entries of the Discoveries page (design 017 sections 9.4 and 9.5): a found discovery shows its name and its question, a discovery not found yet shows "??? - <teaser>" and nothing else. No order is imposed beyond the catalog's.
 * "Across an edge", once found, also offers the Show edges button. Pure.
 */
import { discoveryText } from "../../world-objects/vocabulary";
import type { DiscoveryDefinition, DiscoveryPageEntry } from "./api";

/** The entries for `definitions`, given which of them are found. */
export function discoveryPageEntries(definitions: readonly DiscoveryDefinition[], isFound: (id: string) => boolean): readonly DiscoveryPageEntry[] {
  return definitions.map((definition): DiscoveryPageEntry => {
    if (!isFound(definition.id)) {
      return { id: definition.id, found: false, title: discoveryText.teaserLine(definition.teaser), text: "" };
    }
    return {
      id: definition.id,
      found: true,
      title: definition.name,
      text: definition.question,
      ...(definition.id === "across-an-edge" ? { action: "show-edges" as const } : {}),
    };
  });
}
