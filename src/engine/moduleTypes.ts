/**
 * The types of the world engine and of its modules (design 013 sections 5 and 9): commands and their results, participants, the read view, tokens, module definitions and the contexts the engine hands to handlers and ticks.
 * This file is the engine's public vocabulary: clients import it (and `worldEngine.ts`) and nothing else from `engine/`. Every value crossing the engine boundary is plain data (design 013 section 6.6).
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { RuntimeToolId } from "../glue/toolIds";
import type { PlayerPose } from "../movement/playerPose";
import type { RuntimeObjectChangeJournal } from "../world-objects/runtimeObjectChangeJournal";
import type { RuntimeObjectReader, RuntimeObjectRegistry } from "../world-objects/runtimeObjectRegistry";

/** Data that survives a structured clone: what commands, results, events and control slots carry. */
export type PlainData =
  | null
  | boolean
  | number
  | string
  | readonly PlainData[]
  | { readonly [key: string]: PlainData };

/** A command: plain data with a namespaced kind (`"world/requestTool"`, `"geodesicModel/tieAndDetach"`). */
export interface EngineCommandBase {
  readonly kind: string;
}

/** An event: plain data with a namespaced kind. Events that address one participant carry `participantId`; `message` is a sentence for people. */
export interface EngineEventBase {
  readonly kind: string;
  readonly message?: string;
  readonly participantId?: string;
}

/** The engine's own command: ask whether this participant may switch to a tool (design 013 section 8.1). The world records nothing; the answer is the result. */
export interface WorldRequestToolCommand extends EngineCommandBase {
  readonly kind: "world/requestTool";
  readonly toolId: RuntimeToolId;
}

/** Emitted when a tool that was open to a participant no longer is; a client with that tool selected leaves it and shows `message`. */
export interface WorldToolRevokedEvent extends EngineEventBase {
  readonly kind: "world/toolRevoked";
  readonly participantId: string;
  readonly toolId: RuntimeToolId;
  readonly message: string;
}

/** The answer to a command: accepted (with an optional value) or refused with a stable code and a sentence for people. */
export type CommandResult =
  | { readonly ok: true; readonly value?: PlainData }
  | { readonly ok: false; readonly refusal: { readonly code: string; readonly message: string } };

/** What `submit` returns: pass it to `resultOf` after the step that applied the command. */
export type CommandTicket = number;

/** Where a participant is: the same record as the player pose (cell, cell-local position, yaw, pitch). */
export type ParticipantBody = PlayerPose;

/** Someone acting in the world. Bodies are written by the device that owns the participant (`publishBody`). Records are immutable; a change replaces the record. */
export interface ParticipantRecord {
  readonly id: string;
  readonly kind: "local-player" | "remote-player";
  /** The device that may publish this participant's body. */
  readonly ownerId: string;
  readonly body: ParticipantBody;
}

/** The read-only world state clients use between steps. Handed out by reference; valid until the next step (design 013 section 6.5). */
export interface WorldReadView {
  readonly stepIndex: number;
  readonly world: CompiledCellComplex;
  /** The registry's read methods only, on the registry itself: `objects.get(id)` is the very record the registry holds. */
  readonly objects: RuntimeObjectReader;
  participant(id: string): ParticipantRecord | undefined;
  /** Every participant, in creation order (a fresh array). */
  participants(): readonly ParticipantRecord[];
  /** Every participant write since the last `endFrame`. */
  readonly participantChanges: RuntimeObjectChangeJournal<ParticipantRecord>;
}

/** "<family>:<serial>" for core families, "<moduleId>/<family>:<serial>" for a module's (design 013 section 10), serials from the engine. */
export interface EngineIdSource {
  next(family: string): string;
}

/** A module's answer for one participant and tool; undefined means "no objection". Pure function of the read view. */
export type ToolGate = (input: {
  readonly participantId: string;
  readonly toolId: RuntimeToolId;
  readonly read: WorldReadView;
}) => { readonly refused: true; readonly code: string; readonly message: string } | undefined;

/** The world engine: owner of world state, which it changes only in `step` (design 013 section 5.1). Clients reach it through this interface only. */
export interface WorldEngine<Cmd extends EngineCommandBase = EngineCommandBase> {
  /** Queues a command from a participant; it is applied at the start of the next step. */
  submit(participantId: string, command: Cmd): CommandTicket;
  /** Sets a control slot; the latest value before a step is the one sampled. A value for a closed slot is ignored. */
  setControl(participantId: string, slot: string, value: PlainData): void;
  /** Direct write D1 (design 013 section 5.7): replaces the body of a participant this device owns. Returns false, changing nothing, for any other participant. */
  publishBody(participantId: string, body: ParticipantBody): boolean;
  /** Advances the world by `deltaSeconds` (0 is legal: it applies commands and derives). */
  step(deltaSeconds: number): void;
  /** Read-only world state. */
  readonly read: WorldReadView;
  /** Allocates ids for legacy world writers that still create objects themselves. */
  readonly ids: EngineIdSource;
  /** Result of a command applied since the last `endFrame`. */
  resultOf(ticket: CommandTicket): CommandResult | undefined;
  /** Events of the steps since the last `endFrame`, in order. */
  forEachEvent(fn: (event: EngineEventBase) => void): void;
  /** A module's read-only queries; never its `api`. */
  query<Q>(token: ModuleToken<unknown, Q>): Q;
  /** Called by the client after it has read changes, events and results: clears the journals, events and results. */
  endFrame(): void;
}

/** A typed name for an exported module API. `Api` and `Queries` are phantom: only the id exists at runtime. */
export interface ModuleToken<Api, Queries = Record<string, never>> {
  readonly id: string;
  readonly __api?: Api;
  readonly __queries?: Queries;
}

/** Creates a token. */
export function defineModuleToken<Api, Queries = Record<string, never>>(id: string): ModuleToken<Api, Queries> {
  return { id };
}

/** One handler per command kind; the mapped type makes the set exhaustive. */
export type CommandHandlers<C extends EngineCommandBase> = {
  readonly [K in C["kind"]]: {
    readonly run: (command: Extract<C, { kind: K }>, ctx: CommandContext) => CommandResult;
    /** The tool a participant must be allowed to use; a client without it is refused with `world/capabilityMissing`. */
    readonly requiresTool?: RuntimeToolId;
    /** Reachable by `ctx.dispatch` only; clients are refused with `world/moduleOnly`. */
    readonly moduleOnly?: true;
  };
};

/** The two kinds of per-step work: simulate ticks change the world, derive ticks recompute what follows from the journal. */
export type ModulePhase = "simulate" | "derive";

/** An object kind a module declares. Exactly one module declares each kind. */
export interface ObjectKindDeclaration {
  readonly kind: string;
  readonly label: "real" | "cheap-derived" | "expensive-derived";
  readonly persistence: "saved" | "rebuilt" | "transient";
}

/** Per-step work of a module, in a phase. */
export interface ModuleTick {
  /** "<moduleId>/<name>". */
  readonly id: string;
  readonly phase: ModulePhase;
  /** Kinds this tick writes, all declared by its module. */
  readonly writes: readonly string[];
  /** Derive only: kinds whose journal entries wake the tick. */
  readonly subscribes?: readonly string[];
  /** Derive only: wakes the tick without a journal entry. Must not allocate. */
  readonly wants?: (ctx: StepContext) => boolean;
  /** Simulate only: true skips the tick this step. Must not allocate. */
  readonly isIdle?: (ctx: StepContext) => boolean;
  readonly run: (ctx: StepContext) => void;
}

/** The world part of a module. */
export interface ModuleDefinition<
  Api = unknown,
  Cmd extends EngineCommandBase = never,
  Evt extends EngineEventBase = never,
  Queries = unknown,
> {
  readonly id: string;
  /** At most one token. */
  readonly provides?: ModuleToken<Api, Queries>;
  readonly requires: readonly ModuleToken<unknown, unknown>[];
  readonly objectKinds: readonly ObjectKindDeclaration[];
  /** Tool ids this module defines; the engine knows them for gating. */
  readonly toolIds?: readonly RuntimeToolId[];
  readonly create: (ctx: ModuleCreateContext) => ModuleInstance<Api, Cmd, Evt, Queries>;
}

/** What a module's `create` returns. */
export interface ModuleInstance<
  Api,
  Cmd extends EngineCommandBase,
  Evt extends EngineEventBase,
  Queries = unknown,
> {
  /** For dependents only; functions only; may hold operations. */
  readonly api: Api;
  /** For dependents and clients; read-only. */
  readonly queries: Queries;
  readonly commands: CommandHandlers<Cmd>;
  readonly ticks: readonly ModuleTick[];
  /** Handlers for events of any module, run before this module's derive ticks. */
  readonly onEvents?: { readonly [kind: string]: (event: EngineEventBase, ctx: StepContext) => void };
  readonly toolGates?: readonly ToolGate[];
  /** Phantom: the events this module emits. */
  readonly __events?: Evt;
}

/** Any module, whatever its command and API types. */
export type AnyModuleDefinition = ModuleDefinition<unknown, never, EngineEventBase, unknown>;

/** What a module's `create` receives. */
export interface ModuleCreateContext {
  /** Returns the provider's `api`; throws unless the token is in this module's `requires`. */
  require<A>(token: ModuleToken<A, unknown>): A;
  readonly objects: RuntimeObjectRegistry;
  readonly getWorld: () => CompiledCellComplex;
  readonly ids: EngineIdSource;
}

/** One object, reused every step: never keep it across steps. */
export interface StepContext {
  readonly world: CompiledCellComplex;
  readonly objects: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  readonly stepIndex: number;
  /** The journal range this tick has not seen. */
  readonly changesFrom: number;
  readonly changesTo: number;
  participant(id: string): ParticipantRecord | undefined;
  control(participantId: string, slot: string): PlainData | undefined;
  emit(event: EngineEventBase): void;
  /** Runs a command now, inside the step, as actor "world" (design 013 section 5.7). */
  dispatch(command: EngineCommandBase): CommandResult;
  /** Tells the engine that the answers of the tool gates for this participant may have changed. */
  capabilitiesChanged(participantId: string): void;
  readonly ids: EngineIdSource;
}

/** What a command handler receives. */
export interface CommandContext {
  /** The issuing participant, or "world" for a dispatched command. */
  readonly participantId: string;
  readonly world: CompiledCellComplex;
  readonly objects: RuntimeObjectRegistry;
  readonly ids: EngineIdSource;
  participant(id: string): ParticipantRecord | undefined;
  emit(event: EngineEventBase): void;
  dispatch(command: EngineCommandBase): CommandResult;
  openControl(participantId: string, slot: string): void;
  closeControl(participantId: string, slot: string): void;
}
