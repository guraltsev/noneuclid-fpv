/**
 * Who is acting: a stack of module frames, and the write guard built on it (design 013 section 9.6).
 * The engine pushes a frame around every command handler, tick, dependency `api` call and `queries` call. With the guard on, the registry a module sees throws on a write of a kind outside the active frame's declaration, and on any write while a `queries` frame (no writable kinds) is active. With the guard off, modules get the plain registry and the wrappers below are not installed, so production pays nothing.
 */
import type { RuntimeObjectRegistry } from "../world-objects/runtimeObjectRegistry";

/** The stack of frames. A frame is the id of the module acting and the kinds it may write (null: nothing, a read-only call). */
export interface ModuleFrames {
  push(moduleId: string, writableKinds: ReadonlySet<string> | null): void;
  pop(): void;
  /** The module acting now, or undefined outside any module (client code, `create`). */
  activeModuleId(): string | undefined;
  /** Throws unless the active frame may write `kind`. */
  assertMayWrite(kind: string): void;
}

/** Creates an empty stack. */
export function createModuleFrames(): ModuleFrames {
  const moduleIds: string[] = [];
  const kinds: (ReadonlySet<string> | null)[] = [];
  let size = 0;
  return {
    push(moduleId, writableKinds) {
      moduleIds[size] = moduleId;
      kinds[size] = writableKinds;
      size += 1;
    },
    pop() {
      size -= 1;
    },
    activeModuleId: () => (size === 0 ? undefined : moduleIds[size - 1]),
    assertMayWrite(kind) {
      if (size === 0) return;
      const writable = kinds[size - 1]!;
      if (writable === null) {
        throw new Error(`write guard: a write of "${kind}" during a read-only call of module ${moduleIds[size - 1]}`);
      }
      if (!writable.has(kind)) {
        throw new Error(`write guard: module ${moduleIds[size - 1]} wrote "${kind}", which it does not declare`);
      }
    },
  };
}

/** The registry as modules see it with the guard on: every write is checked against the active frame first. */
export function guardRegistry(registry: RuntimeObjectRegistry, frames: ModuleFrames): RuntimeObjectRegistry {
  return {
    ...registry,
    add(object) {
      frames.assertMayWrite(object.kind);
      registry.add(object);
    },
    update(object) {
      frames.assertMayWrite(object.kind);
      registry.update(object);
    },
    remove(id) {
      const existing = registry.get(id);
      if (existing) frames.assertMayWrite(existing.kind);
      registry.remove(id);
    },
    claimOwnership(id) {
      const existing = registry.get(id);
      if (existing) frames.assertMayWrite(existing.kind);
      return registry.claimOwnership(id);
    },
    moveToCell(id, cellId, localPose) {
      const existing = registry.get(id);
      if (existing) frames.assertMayWrite(existing.kind);
      return registry.moveToCell(id, cellId, localPose);
    },
  };
}

/** A copy of `target` whose functions run inside a frame of `moduleId` (with `writableKinds`); other properties are kept. */
export function runFunctionsInFrame<T>(frames: ModuleFrames, moduleId: string, writableKinds: ReadonlySet<string> | null, target: T): T {
  if (typeof target !== "object" || target === null) return target;
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(target)) {
    copy[name] =
      typeof value === "function"
        ? (...args: unknown[]) => {
            frames.push(moduleId, writableKinds);
            try {
              return (value as (...callArgs: unknown[]) => unknown)(...args);
            } finally {
              frames.pop();
            }
          }
        : value;
  }
  return copy as T;
}
