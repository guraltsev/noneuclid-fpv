/**
 * `tests/world-objects/geodesic/arcIndex.test.ts` — unit tier.
 *
 * The arc index groups arc ends by anchor: attachments, ArcEnd records, distinct arc ids and tied vertices, in registry order, frozen. These tests check each list on a hand-built registry (an arc with both ends on one anchor, a closed loop), the order guarantees, the filter that ignores vertex moves and portal words, and the oracle fuzz against a full recompute.
 */
import { describe, expect, it } from "vitest";
import { identityRigidTransform3 } from "../../../src/math/rigidTransform3";
import { derivedStatsOf } from "../../../src/world-objects/derived";
import { arcIndex, computeArcIndex } from "../../../src/world-objects/geodesic/arcIndex";
import {
  arcsAtVertex,
  forEachTiedVertex,
  getEmitterGeodesicIds,
  getGeodesicEndpointAttachmentsForAnchor,
  isTied,
  isVertexSharedWithOtherArc,
  tiedVertexCount,
} from "../../../src/world-objects/geodesic/endpoints";
import {
  createGeodesicArcObject,
  createGeodesicEmitterObject,
  createGeodesicVertexObject,
  type GeodesicArcObject,
} from "../../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry, type RuntimeObjectRegistry } from "../../../src/world-objects/runtimeObjectRegistry";
import { expectDerivedMatchesCompute, type FuzzWrite } from "../../support/derivedFuzz";

const arc = (id: string, start: string, end: string): GeodesicArcObject =>
  createGeodesicArcObject({ id, startAnchorObjectId: start, endAnchorObjectId: end, startCellId: "a" });
const vertex = (id: string) => createGeodesicVertexObject({ id, cellId: "a", point: { x: 0, y: 0, z: 0 } });
const emitter = (id: string) => createGeodesicEmitterObject({ id, cellId: "a", localPose: identityRigidTransform3 });
const computesOf = (registry: RuntimeObjectRegistry) => derivedStatsOf(registry).find((s) => s.id === "geodesicModel/arcIndex")!.computes;

// e1 -g1-> v1 -g2-> v2 -g3-> e2, plus a loop g4 on v3 and an arc g5 from e1 to e1.
function chain(): RuntimeObjectRegistry {
  return createRuntimeObjectRegistry([
    emitter("e1"), emitter("e2"), vertex("v1"), vertex("v2"), vertex("v3"),
    arc("g1", "e1", "v1"), arc("g2", "v1", "v2"), arc("g3", "v2", "e2"), arc("g4", "v3", "v3"), arc("g5", "e1", "e1"),
  ]);
}

describe("arcIndex", () => {
  it("lists the ends of each anchor in registry order, start before end", () => {
    const registry = chain();

    expect(arcsAtVertex(registry, "v1")).toEqual([{ arcId: "g1", role: "end" }, { arcId: "g2", role: "start" }]);
    expect(arcsAtVertex(registry, "v2")).toEqual([{ arcId: "g2", role: "end" }, { arcId: "g3", role: "start" }]);
    expect(getGeodesicEndpointAttachmentsForAnchor(registry, "e1").map((a) => `${a.geodesicId}:${a.role}`)).toEqual(["g1:start", "g5:start", "g5:end"]);
    expect(arcsAtVertex(registry, "nobody")).toEqual([]);
  });

  it("lists an arc with both ends on one anchor twice in the ends and once in the arc ids", () => {
    const registry = chain();

    expect(arcsAtVertex(registry, "e1").map((end) => end.arcId)).toEqual(["g1", "g5", "g5"]);
    expect(getEmitterGeodesicIds(registry, "e1")).toEqual(["g1", "g5"]);
    expect(getEmitterGeodesicIds(registry, "e2")).toEqual(["g3"]);
  });

  it("ties vertices with two or more ends, a closed loop included, in registry order", () => {
    const registry = chain();
    const visited: string[] = [];

    forEachTiedVertex(registry, (id) => visited.push(id));

    expect(visited).toEqual(["v1", "v2", "v3"]);
    expect(tiedVertexCount(registry)).toBe(3);
    expect(arcsAtVertex(registry, "v3")).toHaveLength(2);
    expect(isTied(registry, "g4")).toBe(false);
    expect(isTied(registry, "g1")).toBe(true);
    expect(isTied(registry, "g3")).toBe(true);
    expect(isVertexSharedWithOtherArc(registry, "v3", "g4")).toBe(false);
    expect(isVertexSharedWithOtherArc(registry, "v1", "g1")).toBe(true);
    expect(isVertexSharedWithOtherArc(registry, "e1", "g1")).toBe(false);
  });

  it("freezes every list and gives an anchor with no ends no key", () => {
    const index = arcIndex.read(chain());

    expect(Object.isFrozen(index.tiedVertexIds)).toBe(true);
    expect(Object.isFrozen(index.attachmentsByAnchor.get("e1"))).toBe(true);
    expect(Object.isFrozen(index.endsByAnchor.get("v1"))).toBe(true);
    expect(Object.isFrozen(index.arcIdsByAnchor.get("v1"))).toBe(true);
    expect(index.endsByAnchor.has("nobody")).toBe(false);
  });

  it("keeps registry order of arcs as added, and an arc's position when it is re-anchored", () => {
    const registry = createRuntimeObjectRegistry([vertex("v"), vertex("w"), emitter("e"), arc("b", "e", "v"), arc("a", "e", "w"), arc("c", "e", "v")]);
    expect(arcsAtVertex(registry, "v").map((end) => end.arcId)).toEqual(["b", "c"]);

    registry.update(arc("a", "e", "v"));
    expect(arcsAtVertex(registry, "v").map((end) => end.arcId)).toEqual(["b", "a", "c"]);

    registry.update(arc("b", "e", "w"));
    expect(arcsAtVertex(registry, "v").map((end) => end.arcId)).toEqual(["a", "c"]);
    expect(arcsAtVertex(registry, "w").map((end) => end.arcId)).toEqual(["b"]);
  });

  it("does not recompute when a vertex moves or an arc's portal word changes", () => {
    const registry = chain();
    const first = arcIndex.read(registry);
    const computesBefore = computesOf(registry);

    registry.update(createGeodesicVertexObject({ id: "v1", cellId: "a", point: { x: 5, y: 1, z: 0 } }));
    registry.update({ ...(registry.get("g2") as GeodesicArcObject), portalWord: [] });

    expect(arcIndex.read(registry)).toBe(first);
    expect(computesOf(registry)).toBe(computesBefore);
  });

  it("matches a full recompute under random writes", () => {
    const registry = chain();
    let serial = 0;
    const anchors = () => registry.getAll().filter((o) => o.kind === "geodesicModel/vertex" || o.kind === "geodesicEmitters/emitter").map((o) => o.id);
    const arcs = () => registry.getObjectsOfKind("geodesicModel/arc");
    const writes: FuzzWrite[] = [
      (r, pick) => {
        const ids = anchors();
        r.add(arc(`n${serial++}`, ids[pick(ids.length)]!, ids[pick(ids.length)]!));
      },
      (r, pick) => {
        const list = arcs();
        if (list.length > 0) r.remove(list[pick(list.length)]!.id);
      },
      (r, pick) => {
        const list = arcs();
        const ids = anchors();
        if (list.length === 0) return;
        const target = list[pick(list.length)]!;
        r.update(pick(2) === 0
          ? { ...target, start: { ...target.start, anchorObjectId: ids[pick(ids.length)]! } }
          : { ...target, end: { ...target.end, anchorObjectId: ids[pick(ids.length)]! } });
      },
      (r, pick) => {
        const list = arcs();
        if (list.length > 0) r.update({ ...list[pick(list.length)]!, portalWord: [] });
      },
      (r, pick) => {
        const vs = r.getObjectsOfKind("geodesicModel/vertex");
        if (vs.length === 0) return;
        const v = vs[pick(vs.length)]!;
        r.update({ ...v, localPose: { ...v.localPose, translation: { x: pick(9), y: 0, z: 0 } } });
      },
      (r) => {
        r.add(vertex(`nv${serial++}`));
      },
      (r, pick) => {
        const vs = r.getObjectsOfKind("geodesicModel/vertex");
        if (vs.length > 0) r.remove(vs[pick(vs.length)]!.id);
      },
      (r, pick) => {
        const es = r.getObjectsOfKind("geodesicEmitters/emitter");
        if (es.length > 0) r.update({ ...es[pick(es.length)]!, aimYawRadians: pick(7) });
      },
    ];

    expectDerivedMatchesCompute({ derived: arcIndex, compute: computeArcIndex, registry, writes });
  });
});
