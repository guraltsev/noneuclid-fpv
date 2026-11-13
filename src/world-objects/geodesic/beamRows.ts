/**
 * The rows of the Laser menu's beam list (design 017 section 8.5): one readable line per beam, from the registry.
 * "Beam 1 · 4.0 m · free" for a free beam, "Beam 2 · L1–L3 · linked" for a beam that runs between two lasers, "Beam 3 · string" for a beam of a string being pulled tight.
 * The words come from the vocabulary; this module only gathers the numbers (the beam's number, its length, the short ids of its two lasers).
 */
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import { beamRowLabel, laserShortIdOfLabel } from "../vocabulary";
import { getGeodesicConnection } from "./lifecycle";
import { getGeodesicTotalLengthMeters, resolveGeodesicNumber } from "./segments";

/**
 * The row text of each of `geodesicIds`, by id. `linkedIds` are the beams the menu shows as linked (between two lasers, or part of a string);
 * a linked beam whose two lasers cannot both be read is shown as a string.
 */
export function beamRowLabelsById(
  registry: RuntimeObjectRegistry,
  geodesicIds: readonly string[],
  linkedIds: readonly string[],
): Readonly<Record<string, string>> {
  const linked = new Set(linkedIds);
  const rows: Record<string, string> = {};
  for (const geodesicId of geodesicIds) {
    const number = resolveGeodesicNumber(registry, geodesicId);
    if (!linked.has(geodesicId)) {
      rows[geodesicId] = beamRowLabel(number, { kind: "free", lengthMeters: getGeodesicTotalLengthMeters(registry, geodesicId) });
      continue;
    }
    const connection = getGeodesicConnection(registry, geodesicId);
    const ends = connection?.incomingEmitterId === undefined
      ? undefined
      : [connection.outgoingEmitterId, connection.incomingEmitterId].map((emitterId) => {
          const emitter = registry.get(emitterId);
          return emitter?.kind === "geodesicEmitters/emitter" ? laserShortIdOfLabel(emitter.tooltip?.label) : undefined;
        });
    const first = ends?.[0];
    const second = ends?.[1];
    rows[geodesicId] = first !== undefined && second !== undefined
      ? beamRowLabel(number, { kind: "linked", ends: [first, second] })
      : beamRowLabel(number, { kind: "string" });
  }
  return rows;
}
