/**
 * Change journal of the runtime object registry: every registry write since the last `clear`, in order (design 013 section 6.2).
 * The registry records one entry per `add`, per replacement (`update`, `moveToCell` and owner publishers) and per `remove`; the journal only observes, nothing is written through it. Readers (views, label runtimes, derived-state passes) scan it after a step and the frame owner clears it.
 * Storage is four parallel arrays overwritten in place with a `length` counter: it allocates only while it grows past its largest size, and `clear` resets the counter and the per-kind marks without truncating anything.
 */
import type { RuntimeWorldObject } from "./runtimeObjectRegistry";

/** What a journal entry records. */
export const enum ChangeOp {
  Added = 0,
  Updated = 1,
  Removed = 2,
}

/** Every registry write since the last clear, in order. Reused: it allocates only while growing past its largest size. */
export interface RuntimeObjectChangeJournal {
  readonly length: number;
  opAt(index: number): ChangeOp;
  idAt(index: number): string;
  kindAt(index: number): string;
  /** The record after the write; for Removed, the record that was removed. */
  objectAt(index: number): RuntimeWorldObject;
  /** Highest index holding this kind, or -1 if none since the last clear. O(1), no allocation. */
  lastIndexOfKind(kind: string): number;
  clear(): void;
}

/** The registry's side of the journal: the read interface plus `record`. Not part of the public reader type. */
export interface RuntimeObjectChangeRecorder extends RuntimeObjectChangeJournal {
  record(op: ChangeOp, object: RuntimeWorldObject): void;
}

/** Creates an empty journal. */
export function createRuntimeObjectChangeJournal(): RuntimeObjectChangeRecorder {
  const ops: ChangeOp[] = [];
  const ids: string[] = [];
  const kinds: string[] = [];
  const objects: RuntimeWorldObject[] = [];
  const lastIndexByKind = new Map<string, number>();
  // Kinds marked since the last clear, so that `clear` resets only those.
  const touchedKinds: string[] = [];
  let touchedCount = 0;
  let length = 0;

  return {
    get length() {
      return length;
    },
    opAt: (index) => ops[index]!,
    idAt: (index) => ids[index]!,
    kindAt: (index) => kinds[index]!,
    objectAt: (index) => objects[index]!,
    lastIndexOfKind: (kind) => lastIndexByKind.get(kind) ?? -1,
    record(op, object) {
      ops[length] = op;
      ids[length] = object.id;
      kinds[length] = object.kind;
      objects[length] = object;
      if ((lastIndexByKind.get(object.kind) ?? -1) < 0) {
        touchedKinds[touchedCount] = object.kind;
        touchedCount += 1;
      }
      lastIndexByKind.set(object.kind, length);
      length += 1;
    },
    clear() {
      for (let i = 0; i < touchedCount; i += 1) {
        lastIndexByKind.set(touchedKinds[i]!, -1);
      }
      touchedCount = 0;
      length = 0;
    },
  };
}
