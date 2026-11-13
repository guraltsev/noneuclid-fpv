/**
 * A world's discoveries (design 017 sections 9.4 and 9.6): the built-in ones with their words from the student vocabulary, minus the ones the world switches off, plus the ones its author adds, with the markers authors placed.
 * Pure. A mistake in the authored part (a clash of ids, a marker for a discovery that does not exist) never stops the world: the entry is left out and the mistake is named in `problems` for the shell to log.
 */
import { builtinDiscoveryText } from "../../world-objects/vocabulary";
import type { BuiltinDiscoveryId, DiscoveryDefinition, WorldDiscoveriesSpec } from "./api";

/** The built-in discoveries in the order the Discoveries page lists them (the order of the design's table). */
export const builtinDiscoveryIds: readonly BuiltinDiscoveryId[] = [
  "across-an-edge",
  "back-where-you-started",
  "beam-came-home",
  "beam-hits-corner",
  "tight-string",
  "new-shape",
];

/** The discoveries of a world and what was wrong with its authored part. */
export interface DiscoveryCatalog {
  readonly definitions: readonly DiscoveryDefinition[];
  readonly problems: readonly string[];
}

/** Builds the catalog of a world whose author wrote `spec` (absent for a world with no discoveries section). */
export function createDiscoveryCatalog(spec?: WorldDiscoveriesSpec): DiscoveryCatalog {
  const problems: string[] = [];
  const disabled = new Set(spec?.disable ?? []);
  const definitions: DiscoveryDefinition[] = [];

  for (const id of builtinDiscoveryIds) {
    if (disabled.has(id)) continue;
    const text = builtinDiscoveryText[id];
    definitions.push({ id, name: text.name, question: text.question, teaser: text.teaser, detector: { kind: "builtin" } });
  }

  const taken = new Set<string>(builtinDiscoveryIds);
  for (const added of spec?.add ?? []) {
    if (taken.has(added.id)) {
      problems.push(`Discovery "${added.id}" is added twice or has the id of a built-in one; the second is left out.`);
      continue;
    }
    taken.add(added.id);
    if (!disabled.has(added.id)) definitions.push(added);
  }

  for (const marker of spec?.markers ?? []) {
    const index = definitions.findIndex((definition) => definition.id === marker.discovery);
    if (index < 0) {
      if (!taken.has(marker.discovery)) problems.push(`A marker names the discovery "${marker.discovery}", which does not exist.`);
      continue;
    }
    definitions[index] = { ...definitions[index], marker: { cellId: marker.cellId, position: marker.position } };
  }

  return { definitions, problems };
}
