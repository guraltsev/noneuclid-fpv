/**
 * Change journal of the runtime object registry (design 013 section 6.2) over a change ring with absolute sequence numbers (design 014 section 3.1).
 * The registry records one entry per `add`, per replacement (`update`, `moveToCell` and owner publishers) and per `remove`; a replacement that changes the kind is a `Removed` then an `Added`. The journal only observes, nothing is written through it.
 * The ring keeps every entry under a sequence number that only rises: `headSeq` is the number the next entry gets, `baseSeq` the oldest still stored. Storage is parallel arrays of a power-of-two capacity; the slot of `seq` is `seq & (capacity - 1)`. Nothing at or after `retainFromSeq` is overwritten: the ring doubles instead.
 * The journal is the frame view of the ring: its indices count from `frameStartSeq`, and `clear` moves the frame start (and the retention mark) to `headSeq` without erasing anything, so a reader holding a sequence number still reads the entries of earlier frames. An owner with cursors lowers the retention mark again with `retainFrom`.
 */
/** What the journal needs of a record. It is generic over the record type (the registry uses `RuntimeWorldObject`) so that this file does not import the registry, which imports it. */
export interface JournalRecord {
  readonly id: string;
  readonly kind: string;
}

/** What a journal entry records. */
export const enum ChangeOp {
  Added = 0,
  Updated = 1,
  Removed = 2,
}

/** Every entry ever recorded, addressed by absolute sequence number, for as long as it is retained. */
export interface ChangeRing<T extends JournalRecord> {
  /** The sequence number the next entry gets; the number of entries ever recorded. */
  readonly headSeq: number;
  /** The oldest sequence number still stored: `max(0, headSeq - capacity)`. */
  readonly baseSeq: number;
  /** Highest sequence number holding this kind, or -1 if none was ever recorded. Never reset. */
  lastSeqOfKind(kind: string): number;
  opAt(seq: number): ChangeOp;
  idAt(seq: number): string;
  kindAt(seq: number): string;
  /** The record after the write; for Removed, the record that was removed. */
  objectAt(seq: number): T;
  /** The record before the write: undefined for Added, the replaced record for Updated, the removed record for Removed. */
  beforeAt(seq: number): T | undefined;
}

/** The ring with its writing side. */
export interface ChangeRingStore<T extends JournalRecord> extends ChangeRing<T> {
  readonly capacity: number;
  readonly retainFromSeq: number;
  record(op: ChangeOp, object: T, before?: T): void;
  /** Sets the retention mark: entries at or after `seq` are never overwritten. */
  setRetainFrom(seq: number): void;
}

/** The default capacity of a ring. */
export const defaultChangeRingCapacity = 8192;

/** Creates an empty ring. `capacity` is rounded up to a power of two (tests use a small one). */
export function createChangeRing<T extends JournalRecord>(capacity: number = defaultChangeRingCapacity): ChangeRingStore<T> {
  let cap = 1;
  while (cap < capacity) cap *= 2;
  let ops: ChangeOp[] = [];
  let ids: string[] = [];
  let kinds: string[] = [];
  let objects: T[] = [];
  let befores: (T | undefined)[] = [];
  const lastSeqByKind = new Map<string, number>();
  let head = 0;
  let retain = 0;

  function grow(): void {
    const base = Math.max(0, head - cap);
    const newCap = cap * 2;
    const nOps: ChangeOp[] = [];
    const nIds: string[] = [];
    const nKinds: string[] = [];
    const nObjects: T[] = [];
    const nBefores: (T | undefined)[] = [];
    for (let seq = base; seq < head; seq += 1) {
      const from = seq & (cap - 1);
      const to = seq & (newCap - 1);
      nOps[to] = ops[from]!;
      nIds[to] = ids[from]!;
      nKinds[to] = kinds[from]!;
      nObjects[to] = objects[from]!;
      nBefores[to] = befores[from];
    }
    ops = nOps;
    ids = nIds;
    kinds = nKinds;
    objects = nObjects;
    befores = nBefores;
    cap = newCap;
  }

  return {
    get headSeq() {
      return head;
    },
    get baseSeq() {
      return Math.max(0, head - cap);
    },
    get capacity() {
      return cap;
    },
    get retainFromSeq() {
      return retain;
    },
    lastSeqOfKind: (kind) => lastSeqByKind.get(kind) ?? -1,
    opAt: (seq) => ops[seq & (cap - 1)]!,
    idAt: (seq) => ids[seq & (cap - 1)]!,
    kindAt: (seq) => kinds[seq & (cap - 1)]!,
    objectAt: (seq) => objects[seq & (cap - 1)]!,
    beforeAt: (seq) => befores[seq & (cap - 1)],
    record(op, object, before) {
      if (head - retain >= cap) grow();
      const slot = head & (cap - 1);
      ops[slot] = op;
      ids[slot] = object.id;
      kinds[slot] = object.kind;
      objects[slot] = object;
      befores[slot] = before;
      lastSeqByKind.set(object.kind, head);
      head += 1;
    },
    setRetainFrom(seq) {
      retain = seq;
    },
  };
}

/** Every registry write since the last clear, in order, as a view of the ring. */
export interface RuntimeObjectChangeJournal<T extends JournalRecord> {
  readonly length: number;
  opAt(index: number): ChangeOp;
  idAt(index: number): string;
  kindAt(index: number): string;
  /** The record after the write; for Removed, the record that was removed. */
  objectAt(index: number): T;
  /** Highest index holding this kind, or -1 if none since the last clear. O(1), no allocation. */
  lastIndexOfKind(kind: string): number;
  /** Starts a new frame: the frame start and the retention mark move to the head. */
  clear(): void;
  /** Lowers the retention mark to `seq` (never above the head), for an owner whose cursors lag behind the frame start. */
  retainFrom(seq: number): void;
  /** The whole ring behind this view, addressed by absolute sequence number. */
  readonly ring: ChangeRing<T>;
  /** The sequence number of index 0. */
  readonly frameStartSeq: number;
}

/** The registry's side of the journal: the read interface plus `record`. Not part of the public reader type. */
export interface RuntimeObjectChangeRecorder<T extends JournalRecord> extends RuntimeObjectChangeJournal<T> {
  record(op: ChangeOp, object: T, before?: T): void;
}

/** Creates an empty journal over a new ring of `capacity` (a power of two; default 8192). */
export function createRuntimeObjectChangeJournal<T extends JournalRecord>(capacity: number = defaultChangeRingCapacity): RuntimeObjectChangeRecorder<T> {
  const ring = createChangeRing<T>(capacity);
  let frameStart = 0;

  return {
    get length() {
      return ring.headSeq - frameStart;
    },
    get ring() {
      return ring;
    },
    get frameStartSeq() {
      return frameStart;
    },
    opAt: (index) => ring.opAt(frameStart + index),
    idAt: (index) => ring.idAt(frameStart + index),
    kindAt: (index) => ring.kindAt(frameStart + index),
    objectAt: (index) => ring.objectAt(frameStart + index),
    lastIndexOfKind(kind) {
      const index = ring.lastSeqOfKind(kind) - frameStart;
      return index < 0 ? -1 : index;
    },
    record: (op, object, before) => ring.record(op, object, before),
    clear() {
      frameStart = ring.headSeq;
      ring.setRetainFrom(frameStart);
    },
    retainFrom(seq) {
      ring.setRetainFrom(Math.min(seq, ring.headSeq));
    },
  };
}
