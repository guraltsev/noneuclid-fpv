/**
 * The bodies, simulate and derive passes over the composed modules (design 013 sections 5.2 and 6.4).
 * Bodies ticks (step phase 3) and simulate ticks (phase 4) run in module order, each unless its `isIdle` says so. In the derive pass each module first runs its `onEvents` handlers over the events since its own cursor, then its derive ticks; a derive tick wakes when `wants` is true or when the ring holds a write of a subscribed kind at or after its cursor, reads the sequence range `[cursor, headSeq)`, and then moves its cursor to `headSeq`; a tick that does not wake moves its cursor to `headSeq` too, since it had nothing to read and must not hold the ring back.
 * Cursors are absolute sequence numbers of the change ring and live here. Derive cursors survive `endFrame` (which only moves the journal's frame start); event cursors are reset by `resetEventCursors`, because `endFrame` clears the events. `lowestCursor` tells the engine how far back the ring must be retained. An idle pass allocates nothing.
 */
import type { JournalRecord, RuntimeObjectChangeJournal } from "../world-objects/runtimeObjectChangeJournal";
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
  readonly journal: Pick<RuntimeObjectChangeJournal<JournalRecord>, "ring" | "frameStartSeq">;
  /** The events of the steps since the last `endFrame`; the runner reads it live. */
  readonly events: readonly EngineEventBase[];
}

/** The passes of one engine. */
export interface TickRunner {
  /** Step phase 3: ticks that move what follows a participant. */
  runBodies(): void;
  runSimulate(): void;
  runDerive(): void;
  /** Starts the event cursors again; `endFrame` clears the events. Derive cursors are not touched. */
  resetEventCursors(): void;
  /** The lowest derive cursor, or `Number.POSITIVE_INFINITY` with no derive ticks. */
  lowestCursor(): number;
}

interface DeriveEntry {
  readonly tick: ModuleTick;
  cursor: number;
}

interface ModuleRuntime {
  readonly moduleId: string;
  readonly writable: ReadonlySet<string>;
  readonly bodies: readonly ModuleTick[];
  readonly simulate: readonly ModuleTick[];
  readonly derive: readonly DeriveEntry[];
  readonly onEvents: ComposedModule["instance"]["onEvents"];
  eventCursor: number;
}

/** Builds the runner for `modules`, which are already in topological order. */
export function createTickRunner(modules: readonly ComposedModule[], deps: TickRunnerDeps): TickRunner {
  const { frames, context, journal, events } = deps;
  const ring = journal.ring;
  const runtimes: ModuleRuntime[] = modules.map((module) => ({
    moduleId: module.definition.id,
    writable: module.writableKinds,
    bodies: module.instance.ticks.filter((tick) => tick.phase === "bodies"),
    simulate: module.instance.ticks.filter((tick) => tick.phase === "simulate"),
    derive: module.instance.ticks.filter((tick) => tick.phase === "derive").map((tick) => ({ tick, cursor: ring.baseSeq })),
    onEvents: module.instance.onEvents,
    eventCursor: 0,
  }));

  function runIdleable(phase: "bodies" | "simulate"): void {
    for (let m = 0; m < runtimes.length; m += 1) {
      const runtime = runtimes[m]!;
      const ticks = phase === "bodies" ? runtime.bodies : runtime.simulate;
      if (ticks.length === 0) continue;
      frames.push(runtime.moduleId, runtime.writable);
      try {
        context.changesFrom = journal.frameStartSeq;
        context.changesTo = ring.headSeq;
        for (let t = 0; t < ticks.length; t += 1) {
          const tick = ticks[t]!;
          if (tick.isIdle?.(context)) continue;
          tick.run(context);
        }
      } finally {
        frames.pop();
      }
    }
  }

  return {
    runBodies: () => runIdleable("bodies"),
    runSimulate: () => runIdleable("simulate"),
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
    resetEventCursors() {
      for (const runtime of runtimes) runtime.eventCursor = 0;
    },
    lowestCursor() {
      let lowest = Number.POSITIVE_INFINITY;
      for (const runtime of runtimes) {
        for (const entry of runtime.derive) if (entry.cursor < lowest) lowest = entry.cursor;
      }
      return lowest;
    },
  };

  function runEventHandlers(runtime: ModuleRuntime): void {
    const handlers = runtime.onEvents;
    const end = events.length;
    if (handlers !== undefined) {
      context.changesFrom = journal.frameStartSeq;
      context.changesTo = ring.headSeq;
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
    context.changesTo = ring.headSeq;
    if (!isWoken(tick, entry.cursor)) {
      entry.cursor = ring.headSeq;
      return;
    }
    tick.run(context);
    entry.cursor = ring.headSeq;
  }

  function isWoken(tick: ModuleTick, cursor: number): boolean {
    if (tick.wants?.(context)) return true;
    const subscribes = tick.subscribes;
    if (subscribes === undefined) return false;
    for (let i = 0; i < subscribes.length; i += 1) {
      if (ring.lastSeqOfKind(subscribes[i]!) >= cursor) return true;
    }
    return false;
  }
}
