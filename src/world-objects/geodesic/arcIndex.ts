/**
 * The arc index (design 014 section 7.1): which arc ends sit on each anchor, built by one pass over the arcs and cached.
 * A vertex pose change cannot alter it, and an arc update alters it only when an end moves to another anchor, so it stays valid through a whole flow run.
 * Lists follow registry insertion order, which fixes the order the flow reads `u1`, `u2` and visits tied vertices. It imports only `objects.ts`, so `endpoints.ts` can import it.
 */
import { defineDerived } from "../derived";
import type { RuntimeObjectReader, RuntimeWorldObject } from "../runtimeObjectRegistry";
import type { GeodesicEndpointAttachment, GeodesicEndRole } from "./objects";

/** An arc end: one endpoint role of an arc. */
export interface ArcEnd {
  readonly arcId: string;
  readonly role: GeodesicEndRole;
}

/** The arc ends grouped by anchor. Every list is frozen. */
export interface ArcIndex {
  /** Attachments on each anchor, arcs in registry order, start before end. Frozen. */
  readonly attachmentsByAnchor: ReadonlyMap<string, readonly GeodesicEndpointAttachment[]>;
  /** The same ends as ArcEnd records. Frozen. */
  readonly endsByAnchor: ReadonlyMap<string, readonly ArcEnd[]>;
  /** Distinct arc ids on each anchor, in first-seen order. Frozen. */
  readonly arcIdsByAnchor: ReadonlyMap<string, readonly string[]>;
  /** Vertices with two or more arc ends, closed loops included, in registry order. Frozen. */
  readonly tiedVertexIds: readonly string[];
}

/** The shared answer for an anchor with no arc ends. */
export const noArcIndexEntries: readonly never[] = Object.freeze([]);

/** True only when both are arcs and an end changed anchor. A vertex update returns false: the index holds no pose. */
function anchorsDiffer(before: RuntimeWorldObject, after: RuntimeWorldObject): boolean {
  return before.kind === "geodesicModel/arc" && after.kind === "geodesicModel/arc" &&
    (before.start.anchorObjectId !== after.start.anchorObjectId || before.end.anchorObjectId !== after.end.anchorObjectId);
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function freezeLists<K, V>(map: Map<K, V[]>): ReadonlyMap<K, readonly V[]> {
  for (const list of map.values()) Object.freeze(list);
  return map;
}

function buildArcIndex(source: RuntimeObjectReader): ArcIndex {
  const attachments = new Map<string, GeodesicEndpointAttachment[]>();
  const ends = new Map<string, ArcEnd[]>();
  const arcIds = new Map<string, string[]>();
  for (const arc of source.getObjectsOfKind("geodesicModel/arc")) {
    for (const role of ["start", "end"] as const) {
      const attachment = arc[role];
      const anchorId = attachment.anchorObjectId;
      pushTo(attachments, anchorId, attachment);
      pushTo(ends, anchorId, Object.freeze({ arcId: arc.id, role }));
      const ids = arcIds.get(anchorId);
      if (ids === undefined) arcIds.set(anchorId, [arc.id]);
      else if (ids[ids.length - 1] !== arc.id) ids.push(arc.id);
    }
  }
  const tied: string[] = [];
  for (const vertex of source.getObjectsOfKind("geodesicModel/vertex")) {
    if ((ends.get(vertex.id)?.length ?? 0) >= 2) tied.push(vertex.id);
  }
  return Object.freeze({
    attachmentsByAnchor: freezeLists(attachments),
    endsByAnchor: freezeLists(ends),
    arcIdsByAnchor: freezeLists(arcIds),
    tiedVertexIds: Object.freeze(tied),
  });
}

/** Read with `arcIndex.read(registry)`. No `repair`: it recomputes only when an arc or vertex is added or removed or an end changes anchor. */
export const arcIndex = defineDerived<RuntimeObjectReader, RuntimeWorldObject, ArcIndex>({
  id: "geodesicModel/arcIndex",
  kinds: ["geodesicModel/arc", "geodesicModel/vertex"],
  relevant: anchorsDiffer,
  compute: buildArcIndex,
});

/** The index computed from scratch, for the oracle tests. */
export const computeArcIndex = buildArcIndex;
