/**
 * The world engine (design 013 section 5): the owner of world state, which changes only inside `step`, from queued commands, and inside `applyControls`, from control slots.
 * It holds the participants, the engine-allocated ids, the composed modules and their step order, the events and the command results; the registry of world objects stays where it is and the engine owns the frame end of its change journal: `endFrame` moves the journal's frame start (it erases no entry) and sets how far back the ring is retained, from the lowest derive cursor. Clients (the shell, tests, scripts) use the `WorldEngine` interface of moduleTypes.ts only.
 * Once per frame, `applyControls` runs the bodies ticks: attachments follow their carriers at frame rate, whether or not the frame has a tick (the fast channel, section 5.4). One step: apply queued commands, simulate ticks, derive pass, (deformation: empty until it moves in). Everything crossing the interface is plain data, and `read` hands out the engine's own records by reference.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { RuntimeToolId } from "../glue/toolIds";
import type { PlayerPose } from "../movement/playerPose";
import type { RuntimeObjectRegistry } from "../world-objects/runtimeObjectRegistry";
import { composeModules, contributedNamePattern, declaredKindsOf, type ComposedHandler } from "./composeModules";
import { coreObjectKinds, coreToolIds, moduleOwnedCoreKinds } from "./coreIds";
import { createEngineIdSource } from "./ids";
import { createTickRunner, type MutableStepContext } from "./moduleTicks";
import { createControlSlots, createParticipantTable, localParticipantId } from "./participants";
import { createToolGates } from "./toolGates";
import { createModuleFrames, guardRegistry, runFunctionsInFrame } from "./writeGuard";
import type {
  AnyModuleDefinition,
  CommandContext,
  CommandResult,
  CommandTicket,
  EngineCommandBase,
  EngineEventBase,
  EngineIdSource,
  ParticipantRecord,
  WorldEngine,
  WorldBehindRealTimeEvent,
  WorldReadView,
  WorldRequestToolCommand,
} from "./moduleTypes";

/** How deep `ctx.dispatch` may nest before it throws. */
const maxDispatchDepth = 8;

/** What the engine is built from. */
export interface WorldEngineOptions {
  readonly registry: RuntimeObjectRegistry;
  /** The active world; read on demand, because a geometry commit replaces it. */
  readonly getWorld: () => CompiledCellComplex;
  /** The participants the world starts with. */
  readonly participants: readonly ParticipantRecord[];
  /** The experience's modules in list order. Default: none. */
  readonly modules?: readonly AnyModuleDefinition[];
  /** The tool configuration: false disables a tool in this world. Default: every tool is enabled. */
  readonly isToolEnabled?: (toolId: RuntimeToolId) => boolean;
  /** Check every module write against the module's declared kinds (design 013 section 9.6). Default: off. */
  readonly writeGuard?: boolean;
}

interface QueuedCommand {
  readonly ticket: CommandTicket;
  readonly participantId: string;
  readonly command: EngineCommandBase;
}

function refuse(code: string, message: string): CommandResult {
  return { ok: false, refusal: { code, message } };
}

function assertDuration(name: string, seconds: number): void {
  if (!(seconds >= 0) || !Number.isFinite(seconds)) throw new RangeError(`${name} needs a finite, non-negative duration, got ${seconds}`);
}

/** Creates the engine; throws a `ModuleCompositionError` when the module list is invalid. */
export function createWorldEngine(options: WorldEngineOptions): WorldEngine {
  const registry = options.registry;
  const definitions = options.modules ?? [];
  const guardOn = options.writeGuard === true;
  const frames = createModuleFrames();
  const moduleObjects = guardOn ? guardRegistry(registry, frames) : registry;
  const participants = createParticipantTable(options.participants);
  const controls = createControlSlots();
  const coreIds = createEngineIdSource((id) => registry.get(id) !== undefined);
  const activeIds: EngineIdSource = {
    next(family) {
      const moduleId = frames.activeModuleId();
      return coreIds.next(moduleId === undefined ? family : `${moduleId}/${family}`);
    },
  };

  const kindsOfModule = new Map(definitions.map((definition) => [definition.id, declaredKindsOf(definition)]));
  const experience = composeModules(definitions, {
    coreObjectKinds,
    moduleOwnedCoreKinds,
    coreToolIds,
    objects: moduleObjects,
    getWorld: options.getWorld,
    wrapApi: (moduleId, api) => (guardOn ? runFunctionsInFrame(frames, moduleId, kindsOfModule.get(moduleId)!, api) : api),
  });
  const queriesByToken = new Map<string, unknown>();
  for (const module of experience.modules) {
    const token = module.definition.provides;
    if (token) {
      queriesByToken.set(token.id, guardOn ? runFunctionsInFrame(frames, module.definition.id, null, module.instance.queries) : module.instance.queries);
    }
  }

  const events: EngineEventBase[] = [];
  const results = new Map<CommandTicket, CommandResult>();
  let queue: QueuedCommand[] = [];
  let nextTicket = 0;
  let stepIndex = 0;
  let dispatchDepth = 0;
  let currentParticipantId = "world";
  let firstError: unknown;

  const read: WorldReadView = {
    get stepIndex() {
      return stepIndex;
    },
    get world() {
      return options.getWorld();
    },
    objects: registry,
    participant: (id) => participants.get(id),
    participants: () => participants.list(),
  };

  const gates = createToolGates({
    isToolEnabled: options.isToolEnabled ?? (() => true),
    toolIds: [...coreToolIds, ...experience.moduleToolIds],
  });

  function emit(event: EngineEventBase): void {
    const moduleId = frames.activeModuleId();
    if (moduleId !== undefined && !(contributedNamePattern.test(event.kind) && event.kind.startsWith(`${moduleId}/`))) {
      throw new Error(`module ${moduleId} emitted the event "${event.kind}", which is not of the form ${moduleId}/<noun>`);
    }
    events.push(event);
  }

  function assertSlotName(slot: string): void {
    const moduleId = frames.activeModuleId();
    if (moduleId !== undefined && !(contributedNamePattern.test(slot) && slot.startsWith(`${moduleId}/`))) {
      throw new Error(`module ${moduleId} used the control slot "${slot}", which is not of the form ${moduleId}/<noun>`);
    }
  }

  /** Runs a handler in the frame of its module, as `participantId`. */
  function runHandler(handler: ComposedHandler, command: EngineCommandBase, participantId: string): CommandResult {
    const savedParticipantId = currentParticipantId;
    currentParticipantId = participantId;
    frames.push(handler.moduleId, kindsOfModule.get(handler.moduleId) ?? new Set<string>());
    try {
      return handler.run(command as never, commandContext);
    } finally {
      frames.pop();
      currentParticipantId = savedParticipantId;
    }
  }

  /** `ctx.dispatch`: runs the handler now, as actor "world". */
  function dispatchFromModule(command: EngineCommandBase): CommandResult {
    const caller = frames.activeModuleId();
    if (caller === undefined) throw new Error("dispatch is available inside a step only");
    if (dispatchDepth >= maxDispatchDepth) throw new Error(`dispatch of ${command.kind} nests deeper than ${maxDispatchDepth}`);
    const handler = experience.handlers.get(command.kind);
    if (!handler) throw new Error(`module ${caller} dispatched the unknown command ${command.kind}`);
    const allowed =
      handler.moduleId === caller ||
      experience.modules.some((module) => module.definition.id === caller && module.requiredModuleIds.has(handler.moduleId));
    if (!allowed) throw new Error(`module ${caller} dispatched ${command.kind}, a command of ${handler.moduleId}, which is not in its requires`);
    dispatchDepth += 1;
    try {
      return runHandler(handler, command, "world");
    } finally {
      dispatchDepth -= 1;
    }
  }

  function closeControl(participantId: string, slot: string): void {
    assertSlotName(slot);
    controls.close(participantId, slot);
  }

  const stepContext: MutableStepContext = {
    get world() {
      return options.getWorld();
    },
    objects: moduleObjects,
    deltaSeconds: 0,
    changesFrom: 0,
    changesTo: 0,
    participant: (id) => participants.get(id),
    forEachParticipant: (fn) => participants.forEach(fn),
    setAttachments: (participantId, attachments) => void participants.setAttachments(participantId, attachments),
    control: (participantId, slot) => controls.get(participantId, slot),
    closeControl,
    emit,
    dispatch: dispatchFromModule,
    ids: activeIds,
  };

  const commandContext: CommandContext = {
    get participantId() {
      return currentParticipantId;
    },
    get world() {
      return options.getWorld();
    },
    objects: moduleObjects,
    ids: activeIds,
    participant: (id) => participants.get(id),
    forEachParticipant: (fn) => participants.forEach(fn),
    setAttachments: (participantId, attachments) => void participants.setAttachments(participantId, attachments),
    emit,
    dispatch: dispatchFromModule,
    openControl(participantId, slot) {
      assertSlotName(slot);
      controls.open(participantId, slot);
    },
    closeControl,
  };

  const ticks = createTickRunner(experience.modules, { frames, context: stepContext, journal: registry.changes });

  function requestTool(command: WorldRequestToolCommand): CommandResult {
    if (!gates.isKnownTool(command.toolId)) return refuse("world/unknownTool", `There is no tool "${command.toolId}".`);
    const refusal = gates.refusal(command.toolId);
    if (refusal) return refuse(refusal.code, refusal.message);
    return { ok: true, value: { toolId: command.toolId } };
  }

  /** A client's command: the checks of design 013 sections 5.7 and 8.1, then the handler. */
  function applyClientCommand(participantId: string, command: EngineCommandBase): CommandResult {
    if (participants.get(participantId) === undefined) return refuse("world/unknownParticipant", `There is no participant "${participantId}".`);
    if (command.kind === "world/requestTool") return requestTool(command as WorldRequestToolCommand);
    const handler = experience.handlers.get(command.kind);
    if (!handler) return refuse("world/unknownCommand", `There is no command "${command.kind}".`);
    if (handler.moduleOnly) return refuse("world/moduleOnly", `The command "${command.kind}" is for modules only.`);
    if (handler.requiresTool !== undefined) {
      const refusal = gates.refusal(handler.requiresTool);
      if (refusal) return refuse("world/capabilityMissing", refusal.message);
    }
    return runHandler(handler, command, participantId);
  }

  function applyQueuedCommands(): void {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    for (const queued of batch) {
      let result: CommandResult;
      try {
        result = applyClientCommand(queued.participantId, queued.command);
      } catch (error) {
        firstError ??= error;
        result = refuse("world/internalError", "The command failed inside the world.");
      }
      results.set(queued.ticket, result);
    }
  }

  return {
    submit(participantId, command) {
      const ticket = nextTicket;
      nextTicket += 1;
      queue.push({ ticket, participantId, command });
      return ticket;
    },
    setControl: (participantId, slot, value) => controls.set(participantId, slot, value),
    publishBody: (participantId, body) => participants.publishBody(participantId, body),
    applyControls(seconds) {
      assertDuration("applyControls", seconds);
      stepContext.deltaSeconds = seconds;
      ticks.runBodies();
    },
    step(deltaSeconds) {
      assertDuration("step", deltaSeconds);
      stepIndex += 1;
      stepContext.deltaSeconds = deltaSeconds;
      firstError = undefined;
      applyQueuedCommands();
      ticks.runSimulate();
      ticks.runDerive();
      if (firstError !== undefined) {
        const error = firstError;
        firstError = undefined;
        throw error;
      }
    },
    noticeBehindRealTime(seconds) {
      const notice: WorldBehindRealTimeEvent = {
        kind: "world/behindRealTime",
        message: `The world could not keep up and skipped ${seconds.toFixed(2)} s of real time.`,
        seconds,
      };
      emit(notice);
    },
    read,
    ids: coreIds,
    resultOf: (ticket) => results.get(ticket),
    forEachEvent(fn) {
      for (let i = 0; i < events.length; i += 1) fn(events[i]!);
    },
    query<Q>(token: { readonly id: string }): Q {
      if (!queriesByToken.has(token.id)) throw new Error(`no module in the experience provides ${token.id}`);
      return queriesByToken.get(token.id) as Q;
    },
    endFrame() {
      registry.changes.clear();
      events.length = 0;
      if (results.size > 0) results.clear();
      registry.changes.retainFrom(Math.min(registry.changes.frameStartSeq, ticks.lowestCursor()));
    },
  };
}

export type { WorldEngine } from "./moduleTypes";
export { createLocalPlayerParticipant, localParticipantId } from "./participants";
export { createSimulationClock, type SimulationClockOptions } from "./simulationClock";

/** The pose of the local player: where this device's body is in the world. */
export function readLocalPlayerPose(engine: Pick<WorldEngine, "read">): PlayerPose {
  const participant = engine.read.participant(localParticipantId);
  if (participant === undefined) throw new Error("The engine has no local player.");
  return participant.body;
}

/** Publishes the local player's body (direct write D1, design 013 section 5.7); the local device owns it, so a refusal is a bug. */
export function publishLocalPlayerPose(engine: Pick<WorldEngine, "publishBody">, pose: PlayerPose): void {
  if (!engine.publishBody(localParticipantId, pose)) throw new Error("The engine refused the local player's body.");
}
