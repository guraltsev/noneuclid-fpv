/**
 * The simulate and derive passes over the composed modules (design 013 sections 5.2 and 6.4).
 * Simulate ticks run in module order, each unless its `isIdle` says so. In the derive pass each module first runs its `onEvents` handlers over the events since its own cursor, then its derive ticks; a derive tick wakes when `wants` is true or when the journal holds a write of a subscribed kind at or after its cursor, reads the range `[cursor, length)`, and then moves its cursor to the journal length.
 * Cursors live here and are reset by `resetCursors` (the engine's `endFrame`, when the journal is cleared). An idle pass allocates nothing.
 */
import type { ComposedModule } from "./composeModules";
import type { ModuleFrames } from "./writeGuard";
import type { EngineEventBase, ModuleTick, StepContext } from "./moduleTypes";

/** The step context as the runner writes it. */
export type MutableStepContext = Omit<StepContext, "deltaSeconds" | "stepIndex" | "changesFrom" | "changesTo"> & {
  deltaSeconds: number;
  stepIndex: number;
  changesFrom: number;
  changesTo: number;
};

/** What the runner reads of the engine. */
export interface TickRunnerDeps {
  readonly frames: ModuleFrames;
  readonly context: MutableStepContext;
  readonly journal: { readonly length: number; lastIndexOfKind(kind: string): number };
  /** The events of the steps since the last `endFrame`; the runner reads it live. */
  readonly events: readonly EngineEventBase[];
}

/** The passes of one engine. */
export interface TickRunner {
  runSimulate(): void;
  runDerive(): void;
  resetCursors(): void;
}

interface DeriveEntry {
  readonly tick: ModuleTick;
  cursor: number;
}

interface ModuleRuntime {
  readonly moduleId: string;
  readonly writable: ReadonlySet<string>;
  readonly simulate: readonly ModuleTick[];
  readonly derive: readonly DeriveEntry[];
  readonly onEvents: ComposedModule["instance"]["onEvents"];
  eventCursor: number;
}

/** Builds the runner for `modules`, which are already in topological order. */
export function createTickRunner(modules: readonly ComposedModule[], deps: TickRunnerDeps): TickRunner {
  const { frames, context, journal, events } = deps;
  const runtimes: ModuleRuntime[] = modules.map((module) => ({
    moduleId: module.definition.id,
    writable: module.declaredKinds,
    simulate: module.instance.ticks.filter((tick) => tick.phase === "simulate"),
    derive: module.instance.ticks.filter((tick) => tick.phase === "derive").map((tick) => ({ tick, cursor: 0 })),
    onEvents: module.instance.onEvents,
    eventCursor: 0,
  }));

  return {
    runSimulate() {
      for (let m = 0; m < runtimes.length; m += 1) {
        const runtime = runtimes[m]!;
        if (runtime.simulate.length === 0) continue;
        frames.push(runtime.moduleId, runtime.writable);
        try {
          context.changesFrom = 0;
          context.changesTo = journal.length;
          for (let t = 0; t < runtime.simulate.length; t += 1) {
            const tick = runtime.simulate[t]!;
            if (tick.isIdle?.(context)) continue;
            tick.run(context);
          }
        } finally {
          frames.pop();
        }
      }
    },
    runDerive() {
      for (let m = 0; m < runtimes.length; m += 1) {
        const runtime = runtimes[m]!;
        if (runtime.onEvents === undefined && runtime.derive.length === 0) continue;
        frames.push(runtime.moduleId, runtime.writable);
        try {
          runEventHandlers(runtime);
          for (let d = 0; d < runtime.derive.length; d += 1) {
            runDeriveTick(runtime.derive[d]!);
          }
        } finally {
          frames.pop();
        }
      }
    },
    resetCursors() {
      for (const runtime of runtimes) {
        runtime.eventCursor = 0;
        for (const entry of runtime.derive) entry.cursor = 0;
      }
    },
  };

  function runEventHandlers(runtime: ModuleRuntime): void {
    const handlers = runtime.onEvents;
    const end = events.length;
    if (handlers !== undefined) {
      context.changesFrom = 0;
      context.changesTo = journal.length;
      for (let i = runtime.eventCursor; i < end; i += 1) {
        const event = events[i]!;
        handlers[event.kind]?.(event, context);
      }
    }
    runtime.eventCursor = end;
  }

  function runDeriveTick(entry: DeriveEntry): void {
    const tick = entry.tick;
    context.changesFrom = entry.cursor;
    context.changesTo = journal.length;
    if (!isWoken(tick, entry.cursor)) return;
    tick.run(context);
    entry.cursor = journal.length;
  }

  function isWoken(tick: ModuleTick, cursor: number): boolean {
    if (tick.wants?.(context)) return true;
    const subscribes = tick.subscribes;
    if (subscribes === undefined) return false;
    for (let i = 0; i < subscribes.length; i += 1) {
      if (journal.lastIndexOfKind(subscribes[i]!) >= cursor) return true;
    }
    return false;
  }
}
