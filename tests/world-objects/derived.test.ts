/**
 * `tests/world-objects/derived.test.ts` — unit tier.
 *
 * The derived cache (design 014 section 4) is a value defined by a full `compute`, invalidated by relevant entries on the registry's change ring. These tests use toy definitions over creatures: when a read recomputes and when it does not, the rule that Added and Removed always invalidate, the ring wrap, the shared instance of a guarded registry copy, the nested-read and write-in-compute errors, the verify mode, and the oracle fuzz harness (which must itself fail on a wrong `relevant`).
 */
import { afterEach, describe, expect, it } from "vitest";
import { identityRigidTransform3 } from "../../src/math/rigidTransform3";
import { defineDerived, derivedStatsOf, setDerivedVerification } from "../../src/world-objects/derived";
import { createRuntimeObjectRegistry, type RuntimeObjectReader, type RuntimeObjectRegistry, type RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";
import type { RuntimeCreatureObject } from "../../src/world-objects/runtimeObjectBase";
import type { GeodesicEmitterObject } from "../../src/world-objects/geodesic/objects";
import { expectDerivedMatchesCompute, type FuzzWrite } from "../support/derivedFuzz";

let serial = 0;

function mouse(id: string, cellId: string, portalRenderable = true): RuntimeCreatureObject {
  return { id, kind: "geo-mouse", cellId, localPose: identityRigidTransform3, portalRenderable };
}

function cannon(id: string, aimYawRadians = 0): GeodesicEmitterObject {
  return { id, kind: "geodesicEmitters/emitter", cellId: "a", localPose: identityRigidTransform3, portalRenderable: true, aimYawRadians };
}

const describeMice = (source: RuntimeObjectReader) =>
  Object.freeze(source.getObjectsOfKind("geo-mouse").map((object) => `${object.id}@${object.cellId}`).sort());

/** A toy cache: the mice with their cells. `relevant` says only a change of cell matters. Counts its computes. */
function toyCache(relevant?: (before: RuntimeWorldObject, after: RuntimeWorldObject) => boolean) {
  const counter = { computes: 0 };
  const derived = defineDerived<RuntimeObjectReader, RuntimeWorldObject, readonly string[]>({
    id: `toy-${serial++}`,
    kinds: ["geo-mouse"],
    relevant,
    compute: (source) => {
      counter.computes += 1;
      return describeMice(source);
    },
  });
  return { derived, counter };
}

const cellChanged = (before: RuntimeWorldObject, after: RuntimeWorldObject) => before.cellId !== after.cellId;

afterEach(() => setDerivedVerification(0));

describe("defineDerived", () => {
  it("computes on the first read and returns the same object on the second", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const { derived, counter } = toyCache(cellChanged);

    const first = derived.read(registry);
    expect(derived.read(registry)).toBe(first);
    expect(first).toEqual(["m1@a"]);
    expect(counter.computes).toBe(1);
  });

  it("invalidates on Added and Removed even when relevant answers false", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const { derived, counter } = toyCache(() => false);
    derived.read(registry);

    registry.add(mouse("m2", "a"));
    expect(derived.read(registry)).toEqual(["m1@a", "m2@a"]);
    registry.remove("m1");
    expect(derived.read(registry)).toEqual(["m2@a"]);
    expect(counter.computes).toBe(3);
  });

  it("invalidates on an Updated entry only when relevant says so", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const { derived, counter } = toyCache(cellChanged);
    derived.read(registry);

    registry.update(mouse("m1", "a", false));
    derived.read(registry);
    expect(counter.computes).toBe(1);
    registry.update(mouse("m1", "b"));
    expect(derived.read(registry)).toEqual(["m1@b"]);
    expect(counter.computes).toBe(2);
  });

  it("treats every update of a declared kind as relevant when relevant is absent", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const { derived, counter } = toyCache();
    derived.read(registry);

    registry.update(mouse("m1", "a", false));
    derived.read(registry);
    expect(counter.computes).toBe(2);
  });

  it("is not invalidated by a write of an undeclared kind", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const { derived, counter } = toyCache();
    derived.read(registry);

    registry.add(cannon("c1"));
    registry.update(cannon("c1", 1));
    registry.remove("c1");
    derived.read(registry);
    expect(counter.computes).toBe(1);
  });

  it("recomputes when its cursor fell below the base of the ring", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const { derived, counter } = toyCache(cellChanged);
    derived.read(registry);
    registry.add(cannon("c1"));
    // Each frame end releases the entries, so enough undeclared writes wrap the default ring.
    const ring = registry.changes.ring;
    for (let i = 1; ring.baseSeq < 3; i += 1) {
      registry.changes.clear();
      registry.update(cannon("c1", i));
    }
    expect(ring.baseSeq).toBeGreaterThan(1);

    derived.read(registry);
    expect(counter.computes).toBe(2);
  });

  it("shares one instance between a registry and its guarded copy", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const copy = { ...registry };
    const { derived, counter } = toyCache(cellChanged);

    derived.read(registry);
    derived.read(copy);
    expect(counter.computes).toBe(1);
    expect(derivedStatsOf(registry)).toHaveLength(1);
    expect(derivedStatsOf(copy)).toEqual(derivedStatsOf(registry));
    expect(derivedStatsOf(registry)[0]).toMatchObject({ reads: 2, computes: 1 });
  });

  it("throws on a read inside a compute and clears the flag", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const inner = toyCache().derived;
    const outer = defineDerived<RuntimeObjectReader, RuntimeWorldObject, number>({
      id: `outer-${serial++}`,
      kinds: ["geo-mouse"],
      compute: (source) => inner.read(source).length,
    });

    expect(() => outer.read(registry)).toThrow(/was read inside a compute/);
    expect(inner.read(registry)).toEqual(["m1@a"]);
  });

  it("throws when a compute writes and clears the flag", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const writer = defineDerived<RuntimeObjectRegistry, RuntimeWorldObject, number>({
      id: `writer-${serial++}`,
      kinds: ["geo-mouse"],
      compute: (source) => {
        source.add(cannon("c-from-compute"));
        return 0;
      },
    });

    expect(() => writer.read(registry)).toThrow(/wrote during compute/);
    expect(toyCache().derived.read(registry)).toEqual(["m1@a"]);
  });

  it("computes again after a compute threw on a cache that had a value", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    let fail = false;
    const flaky = defineDerived<RuntimeObjectReader, RuntimeWorldObject, number>({
      id: `flaky-${serial++}`,
      kinds: ["geo-mouse"],
      compute: (source) => {
        if (fail) throw new Error("boom");
        return source.getObjectsOfKind("geo-mouse").length;
      },
    });

    expect(flaky.read(registry)).toBe(1);
    registry.add(mouse("m2", "a"));
    fail = true;
    expect(() => flaky.read(registry)).toThrow(/boom/);
    fail = false;
    expect(flaky.read(registry)).toBe(2);
  });

  it("with verification on, throws when the cached value disagrees with compute", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    // A wrong filter: the cell change is never seen, so the cached value goes stale.
    const { derived } = toyCache(() => false);
    derived.read(registry);
    registry.update(mouse("m1", "b"));
    setDerivedVerification(1);

    expect(() => derived.read(registry)).toThrow(/differs from compute/);
  });

  it("with verification off, does not compare", () => {
    const registry = createRuntimeObjectRegistry([mouse("m1", "a")]);
    const { derived } = toyCache(() => false);
    derived.read(registry);
    registry.update(mouse("m1", "b"));

    expect(derived.read(registry)).toEqual(["m1@a"]);
  });
});

describe("expectDerivedMatchesCompute", () => {
  let nextId = 0;
  const cells = ["a", "b", "c"];
  const writes: readonly FuzzWrite[] = [
    (registry, pick) => registry.add(mouse(`f${nextId++}`, cells[pick(3)]!)),
    (registry, pick) => {
      const mice = registry.getObjectsOfKind("geo-mouse");
      if (mice.length > 0) registry.remove(mice[pick(mice.length)]!.id);
    },
    // Moves a mouse to another cell: the update `relevant` must see.
    (registry, pick) => {
      const mice = registry.getObjectsOfKind("geo-mouse");
      if (mice.length > 0) registry.update({ ...mice[pick(mice.length)]!, cellId: cells[pick(3)]! });
    },
    // Changes a field `relevant` ignores.
    (registry, pick) => {
      const mice = registry.getObjectsOfKind("geo-mouse");
      if (mice.length > 0) {
        const chosen = mice[pick(mice.length)]!;
        registry.update({ ...chosen, portalRenderable: !chosen.portalRenderable });
      }
    },
    // A kind the cache does not declare.
    (registry, pick) => {
      if (registry.get("fuzz-cannon") === undefined) registry.add(cannon("fuzz-cannon"));
      else registry.update(cannon("fuzz-cannon", pick(100)));
    },
  ];

  it("passes for a correct relevant", () => {
    const registry = createRuntimeObjectRegistry();
    const { derived } = toyCache(cellChanged);

    expectDerivedMatchesCompute({ derived, compute: describeMice, registry, writes });
  });

  it("fails for a wrong relevant (a harness that cannot fail proves nothing)", () => {
    const registry = createRuntimeObjectRegistry();
    const { derived } = toyCache(() => false);

    expect(() => expectDerivedMatchesCompute({ derived, compute: describeMice, registry, writes })).toThrow();
  });
});
