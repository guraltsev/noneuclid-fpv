/**
 * The derived cache (design 014 section 4): a value defined by a full `compute` over a source, invalidated by relevant entries on the change ring and recomputed on the next read.
 * The only contract is that `read` always equals `compute`. A read when nothing was written since the last one costs one comparison and allocates nothing.
 * Instances are keyed by the ring (never by the registry), so a guarded copy of the registry shares them. There is no reset: a new world has a new registry, hence a new ring.
 */
import { ChangeOp, type ChangeRing, type JournalRecord } from "./runtimeObjectChangeJournal";

/** What a cache reads from: the registry and its guarded copy both fit, and share one `changes`. */
export interface DerivedSource<T extends JournalRecord> {
  readonly changes: { readonly ring: ChangeRing<T> };
}

/** The definition of a cache: what it depends on and how to build it from scratch. */
export interface DerivedSpec<S extends DerivedSource<T>, T extends JournalRecord, V> {
  /** Unique; shown in `debug.derivedStats()`. */
  readonly id: string;
  readonly kinds: readonly string[];
  /** Optional, for Updated entries only. False: this update cannot alter the result. */
  readonly relevant?: (before: T, after: T) => boolean;
  /** The definition. Reads only `source`. Builds and freezes the whole result. Never writes. */
  readonly compute: (source: S) => V;
}

/** A defined cache; `read` returns the current value, recomputing it first when it is stale. */
export interface Derived<S, V> {
  read(source: S): V;
}

/** The cheap counters of one cache instance (design 014 section 5). */
export interface DerivedStats {
  readonly id: string;
  readonly reads: number;
  readonly computes: number;
  readonly entriesScanned: number;
  /** How many reads `derived-verify` also recomputed and compared. */
  readonly verifies: number;
}

interface Instance<T extends JournalRecord, V> {
  readonly id: string;
  readonly ring: ChangeRing<T>;
  readonly kinds: ReadonlySet<string>;
  cursor: number;
  hasValue: boolean;
  value: V | undefined;
  reads: number;
  computes: number;
  entriesScanned: number;
  verifies: number;
}

const instancesByRing = new WeakMap<ChangeRing<JournalRecord>, Map<unknown, Instance<JournalRecord, unknown>>>();

let computing = false;
let readObserver: ((kinds: readonly string[]) => void) | undefined;

/**
 * Installs (or, with `undefined`, removes) the observer told the declared kinds of every cache `read`, hit or miss.
 * The read tracker (`trackedReads.ts`) uses it so that a read answered from a cache still counts as a read of the cache's kinds. Idle cost: one comparison per read.
 */
export function setDerivedReadObserver(observer: ((kinds: readonly string[]) => void) | undefined): void {
  readObserver = observer;
}
let verifyEvery = 0;
let verifyCountdown = 0;

/** `derived-verify`: every `everyReads`th read also runs `compute` and throws when the two differ. 0 turns it off. */
export function setDerivedVerification(everyReads: number): void {
  verifyEvery = everyReads;
  verifyCountdown = everyReads;
}

/** Defines a cache. Call once, at module level. */
export function defineDerived<S extends DerivedSource<T>, T extends JournalRecord, V>(spec: DerivedSpec<S, T, V>): Derived<S, V> {
  const kindList = spec.kinds;
  const relevant = spec.relevant;

  function instanceFor(ring: ChangeRing<T>): Instance<T, V> {
    let bySpec = instancesByRing.get(ring as ChangeRing<JournalRecord>);
    if (bySpec === undefined) {
      bySpec = new Map();
      instancesByRing.set(ring as ChangeRing<JournalRecord>, bySpec);
    }
    let instance = bySpec.get(spec) as Instance<T, V> | undefined;
    if (instance === undefined) {
      for (const other of bySpec.values()) {
        if (other.id === spec.id) throw new Error(`derived: id ${spec.id} is defined twice`);
      }
      instance = { id: spec.id, ring, kinds: new Set(kindList), cursor: 0, hasValue: false, value: undefined, reads: 0, computes: 0, entriesScanned: 0, verifies: 0 };
      bySpec.set(spec, instance as Instance<JournalRecord, unknown>);
    }
    return instance;
  }

  function runCompute(source: S, instance: Instance<T, V>): void {
    if (computing) {
      throw new Error(`derived: ${spec.id} was read inside a compute`);
    }
    const ring = instance.ring;
    const head = ring.headSeq;
    computing = true;
    let value: V;
    try {
      value = spec.compute(source);
    } finally {
      computing = false;
    }
    if (ring.headSeq !== head) {
      throw new Error(`derived: ${spec.id} wrote during compute`);
    }
    instance.value = value;
    instance.hasValue = true;
    instance.computes += 1;
  }

  return {
    read(source) {
      const ring = source.changes.ring;
      const instance = instanceFor(ring);
      instance.reads += 1;
      if (readObserver !== undefined) readObserver(kindList);
      if (instance.hasValue && instance.cursor === ring.headSeq) {
        if (verifyEvery > 0) verify(source, instance);
        return instance.value as V;
      }
      let stale = !instance.hasValue || instance.cursor < ring.baseSeq;
      if (!stale) {
        let touched = false;
        for (let i = 0; i < kindList.length; i += 1) {
          if (ring.lastSeqOfKind(kindList[i]!) >= instance.cursor) {
            touched = true;
            break;
          }
        }
        if (touched) {
          const head = ring.headSeq;
          for (let seq = instance.cursor; seq < head; seq += 1) {
            instance.entriesScanned += 1;
            if (!instance.kinds.has(ring.kindAt(seq))) continue;
            if (ring.opAt(seq) !== ChangeOp.Updated || relevant === undefined || relevant(ring.beforeAt(seq)!, ring.objectAt(seq))) {
              stale = true;
              break;
            }
          }
        }
      }
      instance.cursor = ring.headSeq;
      if (stale) {
        try {
          runCompute(source, instance);
        } catch (error) {
          // A failed compute leaves no value, so the next read computes again instead of returning the old one.
          instance.hasValue = false;
          throw error;
        }
      }
      if (verifyEvery > 0) verify(source, instance);
      return instance.value as V;
    },
  };

  function verify(source: S, instance: Instance<T, V>): void {
    verifyCountdown -= 1;
    if (verifyCountdown > 0) return;
    verifyCountdown = verifyEvery;
    if (computing) return;
    computing = true;
    let fresh: V;
    try {
      fresh = spec.compute(source);
    } finally {
      computing = false;
    }
    instance.verifies += 1;
    if (!deepEqual(fresh, instance.value)) {
      throw new Error(`derived: ${spec.id} read differs from compute`);
    }
  }
}

/** The caches that exist on this source's ring, for the debug API. */
export function derivedStatsOf(source: DerivedSource<JournalRecord>): readonly DerivedStats[] {
  const bySpec = instancesByRing.get(source.changes.ring);
  if (bySpec === undefined) return [];
  const result: DerivedStats[] = [];
  for (const instance of bySpec.values()) {
    result.push({ id: instance.id, reads: instance.reads, computes: instance.computes, entriesScanned: instance.entriesScanned, verifies: instance.verifies });
  }
  return result;
}

/** Structural equality of plain data (also maps and sets), the check of the cache fuzz and of the derive ticks that write a record only when it changed. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEqual(value, b.get(key))) return false;
    }
    return true;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }
  if (b instanceof Map || b instanceof Set) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => key in b && deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
