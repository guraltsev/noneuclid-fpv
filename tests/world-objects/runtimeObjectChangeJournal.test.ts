/**
 * `tests/world-objects/runtimeObjectChangeJournal.test.ts` — unit tier.
 *
 * The registry records every write (`add`, `update` and owner publishes, `moveToCell`, `remove`) in `registry.changes`,
 * the change journal of design 013 section 6.2. These tests check the entries and their order, the per-kind lookup,
 * `clear`, that reads and no-op removals record nothing, that the journal stops allocating once it has grown to its
 * largest size, and `countOfKind`.
 */
import { describe, expect, it } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { ChangeOp } from "../../src/world-objects/runtimeObjectChangeJournal";
import { createRuntimeObjectRegistry, type RuntimeObjectReader } from "../../src/world-objects/runtimeObjectRegistry";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectBase";
import type { GeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";

function mouse(id: string, cellId = "a"): RuntimeCreatureObject {
  return { id, kind: "geo-mouse", cellId, localPose: identityRigidTransform3, portalRenderable: true };
}

function cannon(id: string, cellId = "a"): GeodesicEmitterObject {
  return { id, kind: "geodesicEmitters/emitter", cellId, localPose: identityRigidTransform3, portalRenderable: true, aimYawRadians: 0 };
}

describe("runtime object change journal", () => {
  it("records add, update and remove in order with ids, kinds and records", () => {
    const registry = createRuntimeObjectRegistry();
    const moved = { ...mouse("m1"), cellId: "b" };
    registry.add(mouse("m1"));
    registry.add(cannon("c1"));
    registry.update(moved);
    registry.remove("m1");

    const journal = registry.changes;
    expect(journal.length).toBe(4);
    expect([0, 1, 2, 3].map((i) => journal.opAt(i))).toEqual([ChangeOp.Added, ChangeOp.Added, ChangeOp.Updated, ChangeOp.Removed]);
    expect([0, 1, 2, 3].map((i) => journal.idAt(i))).toEqual(["m1", "c1", "m1", "m1"]);
    expect([0, 1, 2, 3].map((i) => journal.kindAt(i))).toEqual(["geo-mouse", "geodesicEmitters/emitter", "geo-mouse", "geo-mouse"]);
    expect(journal.objectAt(2)).toBe(moved);
    expect(journal.objectAt(3)).toBe(moved);
  });

  it("hides clear, retainFrom and the writes from the reader type", () => {
    const reader: RuntimeObjectReader = createRuntimeObjectRegistry([mouse("m1")]);
    // @ts-expect-error a reader cannot start a new frame
    void reader.changes.clear;
    // @ts-expect-error a reader cannot move the retention mark
    void reader.changes.retainFrom;
    // @ts-expect-error a reader cannot write
    void reader.update;

    expect(reader.changes.ring.headSeq).toBe(1);
  });

  it("records moveToCell and owner publishes as updates", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1"), mouse("m2")]);
    registry.changes.clear();
    registry.moveToCell("m1", "b");
    const publish = registry.claimOwnership("m2");
    publish({ ...mouse("m2"), cellId: "b" });

    expect(registry.changes.length).toBe(2);
    expect(registry.changes.opAt(0)).toBe(ChangeOp.Updated);
    expect(registry.changes.opAt(1)).toBe(ChangeOp.Updated);
    expect(registry.changes.objectAt(0).cellId).toBe("b");
  });

  it("records nothing for reads, refused writes and removal of a missing id", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1")]);
    registry.changes.clear();
    registry.get("m1");
    registry.getAll();
    registry.getObjectsOfKind("geo-mouse");
    registry.remove("missing");
    expect(() => registry.add(mouse("m1"))).toThrow();
    expect(() => registry.update(mouse("missing"))).toThrow();
    registry.claimOwnership("m1");
    expect(() => registry.remove("m1")).toThrow();

    expect(registry.changes.length).toBe(0);
  });

  it("finds the last index of a kind and resets it on clear", () => {
    const registry = createRuntimeObjectRegistry();
    registry.add(mouse("m1"));
    registry.add(cannon("c1"));
    registry.add(mouse("m2"));

    expect(registry.changes.lastIndexOfKind("geo-mouse")).toBe(2);
    expect(registry.changes.lastIndexOfKind("geodesicEmitters/emitter")).toBe(1);
    expect(registry.changes.lastIndexOfKind("asset")).toBe(-1);

    registry.changes.clear();
    expect(registry.changes.length).toBe(0);
    expect(registry.changes.lastIndexOfKind("geo-mouse")).toBe(-1);
    expect(registry.changes.lastIndexOfKind("geodesicEmitters/emitter")).toBe(-1);

    registry.add(cannon("c2"));
    expect(registry.changes.lastIndexOfKind("geodesicEmitters/emitter")).toBe(0);
    expect(registry.changes.lastIndexOfKind("geo-mouse")).toBe(-1);
  });

  it("starts a fresh sequence after clear and keeps the registry contents", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1")]);
    registry.changes.clear();
    registry.add(mouse("m2"));

    expect(registry.changes.length).toBe(1);
    expect(registry.changes.idAt(0)).toBe("m2");
    expect(registry.getAll().map((object) => object.id)).toEqual(["m1", "m2"]);
  });

  it("does not grow after warm-up: repeated frames of the same size reuse the same slots", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1")]);
    registry.changes.clear();
    const frame = (): number => {
      registry.update({ ...mouse("m1"), cellId: "b" });
      registry.update(mouse("m1"));
      return registry.changes.length;
    };

    const warm = frame();
    registry.changes.clear();
    for (let i = 0; i < 1000; i += 1) {
      expect(frame()).toBe(warm);
      registry.changes.clear();
    }
  });

  it("counts objects of a kind without allocating a list", () => {
    const registry = createRuntimeObjectRegistry();
    expect(registry.countOfKind("geo-mouse")).toBe(0);
    registry.add(mouse("m1"));
    registry.add(mouse("m2"));
    registry.add(cannon("c1"));
    expect(registry.countOfKind("geo-mouse")).toBe(2);
    registry.remove("m1");
    expect(registry.countOfKind("geo-mouse")).toBe(1);
    expect(registry.countOfKind("geodesicEmitters/emitter")).toBe(1);
    expect(registry.countOfKind("asset")).toBe(0);
  });

  it("offers the reader type without the write methods", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1")]);
    const reader: RuntimeObjectReader = registry;
    expect(reader.get("m1")?.id).toBe("m1");
    expect(reader.countOfKind("geo-mouse")).toBe(1);
    expect(reader.changes).toBe(registry.changes);
    // @ts-expect-error The reader type has no write methods.
    void reader.add;
  });
});
