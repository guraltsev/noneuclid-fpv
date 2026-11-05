/**
 * Read tracking for pure refresh functions (design 014 D1, D9): the exact set of registry reads a refresh made, and the test of whether a range of the change ring touches it.
 * `createReadRecorder` wraps a registry in a reader that records every `get(id)` as an id, every scan of a kind as a kind, every `getSegmentsOfGeodesic(g)` as a geodesic, every whole-registry or per-cell query as "all", and every read of a derived cache as the cache's kinds.
 * A record kept by a derive tick (a length, an angle) remembers the `ReadSet` of its last refresh in a module-private memo, and the tick refreshes it again only when `ReadDigest.touches` says a write in the ring range hit that set.
 * Precision comes from what the code read, not from a hand-written list of fields or kinds: a new behaviour that changes what a refresh reads changes its read set. The only static list left is the tick's `subscribes`, which must cover `ReadSet.kinds` and `ReadSet.fetchedKinds` (a test checks it).
 */
import { setDerivedReadObserver } from "./derived";
import { ChangeOp, type ChangeRing } from "./runtimeObjectChangeJournal";
import type { RuntimeObjectRegistry, RuntimeWorldObject } from "./runtimeObjectRegistry";

/** The segment kind: reads of a geodesic's segments are tracked by geodesic id, not by kind. */
const segmentKind = "geodesicModel/segment";

/** What one refresh read. */
export interface ReadSet {
  /** Ids passed to `get`, found or not. */
  readonly ids: ReadonlySet<string>;
  /** Kinds scanned (`getObjectsOfKind`, `countOfKind`, the kinds of a derived cache that was read). */
  readonly kinds: ReadonlySet<string>;
  /** Geodesics whose segments were listed (`getSegmentsOfGeodesic`). */
  readonly segmentGeodesics: ReadonlySet<string>;
  /** A whole-registry or per-cell query was made: any write counts. */
  readonly all: boolean;
  /** The kinds of the objects `get` returned, for checking a tick's subscription. */
  readonly fetchedKinds: ReadonlySet<string>;
}

/** A recording reader and the read set of its last `run`. */
export interface ReadRecorder {
  /** Pass this where the refresh function takes the registry. Writes pass through unrecorded (a refresh does not write). */
  readonly reader: RuntimeObjectRegistry;
  /** Runs `fn` with the reader and returns its value (`reuse`: a read set from an earlier run to refill instead of allocating a new one); `lastReads()` is then the set of reads `fn` made. Not reentrant. */
  run<T>(fn: (reader: RuntimeObjectRegistry) => T, reuse?: ReadSet): T;
  /** The read set of the last `run` (a fresh object per run unless `reuse` was given, in which case that object, emptied and refilled: the memo of a record is rewritten in place and allocates nothing). */
  lastReads(): ReadSet;
}

interface MutableReadSet {
  ids: Set<string>;
  kinds: Set<string>;
  segmentGeodesics: Set<string>;
  all: boolean;
  fetchedKinds: Set<string>;
}

function emptyReads(): MutableReadSet {
  return { ids: new Set(), kinds: new Set(), segmentGeodesics: new Set(), all: false, fetchedKinds: new Set() };
}

/** Wraps `registry` (or a guarded copy of it) in a recording reader. */
export function createReadRecorder(registry: RuntimeObjectRegistry): ReadRecorder {
  let current = emptyReads();
  let recording = false;
  const overrides = new Map<PropertyKey, unknown>([
    ["get", (id: string) => {
      const object = registry.get(id);
      if (recording) {
        current.ids.add(id);
        if (object !== undefined) current.fetchedKinds.add(object.kind);
      }
      return object;
    }],
    ["getObjectsOfKind", (kind: RuntimeWorldObject["kind"]) => {
      if (recording) current.kinds.add(kind);
      return registry.getObjectsOfKind(kind);
    }],
    ["countOfKind", (kind: RuntimeWorldObject["kind"]) => {
      if (recording) current.kinds.add(kind);
      return registry.countOfKind(kind);
    }],
    ["getSegmentsOfGeodesic", (geodesicId: string) => {
      if (recording) current.segmentGeodesics.add(geodesicId);
      return registry.getSegmentsOfGeodesic(geodesicId);
    }],
  ]);
  for (const name of ["getAll", "getObjectsInCell", "getCollidableObjectsInCell", "getPlayerBlockingObjectsInCell", "getInteractableObjectsInCell", "getTooltipObjectsInCell"] as const) {
    overrides.set(name, (...args: unknown[]) => {
      if (recording) current.all = true;
      return (registry[name] as (...a: unknown[]) => unknown)(...args);
    });
  }
  // The reader inherits every other method of the registry, so only the reads are intercepted and no per-access trap runs.
  const reader = Object.assign(Object.create(registry) as RuntimeObjectRegistry, Object.fromEntries(overrides));
  const observeDerived = (kinds: readonly string[]): void => {
    if (!recording) return;
    for (const kind of kinds) current.kinds.add(kind);
  };
  return {
    reader,
    run(fn, reuse) {
      if (reuse === undefined) {
        current = emptyReads();
      } else {
        current = reuse as MutableReadSet;
        current.ids.clear();
        current.kinds.clear();
        current.segmentGeodesics.clear();
        current.fetchedKinds.clear();
        current.all = false;
      }
      recording = true;
      setDerivedReadObserver(observeDerived);
      try {
        return fn(reader);
      } finally {
        recording = false;
        setDerivedReadObserver(undefined);
      }
    },
    lastReads: () => current,
  };
}

/**
 * The writes of a ring range, digested once per tick run so that each record's read set is tested against it in time proportional to the read set.
 * Reuse one digest per tick: after warm-up `load` and `touches` allocate nothing.
 */
export class ReadDigest {
  private readonly ids = new Set<string>();
  private readonly kinds = new Set<string>();
  private readonly segmentGeodesics = new Set<string>();
  private any = false;

  /** Digests the entries `[from, to)` of `ring`: Added, Updated and Removed alike. */
  load(ring: ChangeRing<RuntimeWorldObject>, from: number, to: number): void {
    this.ids.clear();
    this.kinds.clear();
    this.segmentGeodesics.clear();
    this.any = to > from;
    for (let seq = from; seq < to; seq += 1) {
      this.ids.add(ring.idAt(seq));
      const kind = ring.kindAt(seq);
      this.kinds.add(kind);
      if (kind === segmentKind) {
        const after = ring.objectAt(seq);
        if (after.kind === segmentKind) this.segmentGeodesics.add(after.geodesicId);
        const before = ring.opAt(seq) === ChangeOp.Updated ? ring.beforeAt(seq) : undefined;
        if (before?.kind === segmentKind) this.segmentGeodesics.add(before.geodesicId);
      }
    }
  }

  /** True when a digested write hit something `reads` read. */
  touches(reads: ReadSet): boolean {
    if (!this.any) return false;
    if (reads.all) return true;
    for (const id of reads.ids) if (this.ids.has(id)) return true;
    for (const kind of reads.kinds) if (this.kinds.has(kind)) return true;
    for (const geodesicId of reads.segmentGeodesics) if (this.segmentGeodesics.has(geodesicId)) return true;
    return false;
  }
}
