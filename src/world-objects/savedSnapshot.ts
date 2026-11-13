/**
 * Snapshot and restore of the student's work, for undo (design 017 section 8.8).
 * The student's work is the objects of the kinds that modules declare `persistence: "saved"` (lasers, beams, signs, measurements). A snapshot keeps those objects as they are now (registry records are immutable values, so keeping the references is enough); restoring writes back every one that is missing or has changed since.
 * Restoring writes the registry directly, as the shell's reset does; the geodesic model's derived segments and crossings are rebuilt by its own ticks from the restored beams.
 */
import { ChangeOp } from "./runtimeObjectChangeJournal";
import type { RuntimeObjectReader, RuntimeObjectRegistry, RuntimeWorldObject } from "./runtimeObjectRegistry";

/** The saved objects at one moment, in registry order. */
export type SavedSnapshot = readonly RuntimeWorldObject[];

/** The object kinds that modules declare saved. */
export function savedObjectKinds(modules: readonly { readonly objectKinds: readonly { readonly kind: string; readonly persistence: string }[] }[]): ReadonlySet<string> {
  const kinds = new Set<string>();
  for (const definition of modules) {
    for (const declaration of definition.objectKinds) {
      if (declaration.persistence === "saved") kinds.add(declaration.kind);
    }
  }
  return kinds;
}

/** Keeps every object whose kind is in `savedKinds`. */
export function takeSavedSnapshot(registry: RuntimeObjectReader, savedKinds: ReadonlySet<string>): SavedSnapshot {
  return registry.getAll().filter((object) => savedKinds.has(object.kind));
}

/**
 * Writes back the objects of `snapshot` that are absent from the registry (added) or differ from the snapshot (replaced). Objects that appeared since are left alone. Returns how many objects it wrote.
 */
export function restoreSavedSnapshot(registry: RuntimeObjectRegistry, snapshot: SavedSnapshot): number {
  let written = 0;
  for (const object of snapshot) {
    const current = registry.get(object.id);
    if (current === undefined) {
      registry.add(object);
      written += 1;
    } else if (current !== object && current.kind === object.kind) {
      registry.update(object);
      written += 1;
    }
  }
  return written;
}

/** The kinds of the saved objects removed by the writes since the last `changes.clear()` (this frame), one entry per removal. */
export function savedKindsRemovedThisFrame(registry: RuntimeObjectReader, savedKinds: ReadonlySet<string>): readonly string[] {
  const removed: string[] = [];
  const changes = registry.changes;
  for (let index = 0; index < changes.length; index += 1) {
    if (changes.opAt(index) === ChangeOp.Removed && savedKinds.has(changes.kindAt(index))) removed.push(changes.kindAt(index));
  }
  return removed;
}
