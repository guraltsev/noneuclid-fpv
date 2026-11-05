/**
 * The types of the world engine and of its modules (design 013 sections 5 and 9): commands and their results, participants, the read view, tokens, module definitions and the contexts the engine hands to handlers and ticks.
 * This file is the engine's public vocabulary: clients import it (and `worldEngine.ts`) and nothing else from `engine/`. Every value crossing the engine boundary is plain data (design 013 section 6.6).
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { RuntimeToolId } from "../glue/toolIds";
import type { PlayerPose } from "../movement/playerPose";
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

/** The notice that real time was dropped: the world could not keep up, even at the longest tick. */
export interface WorldBehindRealTimeEvent extends EngineEventBase {
  readonly kind: "world/behindRealTime";
  readonly message: string;
  /** The real time dropped since the last notice. */
  readonly seconds: number;
}

/** The answer to a command: accepted (with an optional value) or refused with a stable code and a sentence for people. */
export type CommandResult =
  | { readonly ok: true; readonly value?: PlainData }
  | { readonly ok: false; readonly refusal: { readonly code: string; readonly message: string } };

/** What `submit` returns: pass it to `resultOf` after the step that applied the command. */
export type CommandTicket = number;

/** Where a participant is: the same record as the player pose (cell, cell-local position, yaw, pitch). */
export type ParticipantBody = PlayerPose;

/**
 * A relation the world holds between a participant and an object (design 013 section 7). Today only carrying (`kind` "carry"); the module that owns the kind changes it, through the contexts' `setAttachments`.
 * `arrived` is part of the relation because it changes how the object moves: false while the object still glides to the carrier, true from the first frame it is at the carrier.
 * The two optional fields are what the carry module needs to rebuild the object's geodesics: the geodesic the carrier works on and the length a regrown one should have.
 */
export interface ParticipantAttachment {
  readonly kind: string;
  readonly objectId: string;
  readonly arrived: boolean;
  readonly activeGeodesicId?: string;
  readonly rotationTargetLengthMeters?: number;
}

/** The attachment of `kind` that `participant` holds, or undefined. */
export function participantAttachment(participant: ParticipantRecord | undefined, kind: string): ParticipantAttachment | undefined {
  const attachments = participant?.attachments;
  if (attachments === undefined) return undefined;
  for (let i = 0; i < attachments.length; i += 1) {
    if (attachments[i]!.kind === kind) return attachments[i];
  }
  return undefined;
}

/** Someone acting in the world. Bodies are written by the device that owns the participant (`publishBody`). Records are immutable; a change replaces the record. */
export interface ParticipantRecord {
  readonly id: string;
  readonly kind: "local-player" | "remote-player";
  /** The device that may publish this participant's body. */
  readonly ownerId: string;
  readonly body: ParticipantBody;
  /** What the participant holds in the world; changed by the module owning the attachment kind, never by the client. */
  readonly attachments: readonly ParticipantAttachment[];
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
}

/** "<family>:<serial>" for core families, "<moduleId>/<family>:<serial>" for a module's (design 013 section 10), serials from the engine. */
export interface EngineIdSource {
  next(family: string): string;
}

/** The world engine: owner of world state, which it changes only in `step` (design 013 section 5.1). Clients reach it through this interface only. */
export interface WorldEngine<Cmd extends EngineCommandBase = EngineCommandBase> {
  /** Queues a command from a participant; it is applied at the start of the next step. */
  submit(participantId: string, command: Cmd): CommandTicket;
  /** Sets a control slot, the fast channel (design 013 section 5.4); the latest value before `applyControls` is the one used. A value for a closed slot is ignored. */
  setControl(participantId: string, slot: string, value: PlainData): void;
  /** Direct write D1 (design 013 section 5.7): replaces the body of a participant this device owns. Returns false, changing nothing, for any other participant. */
  publishBody(participantId: string, body: ParticipantBody): boolean;
  /** Once per frame, before the frame's steps: runs the bodies ticks on the control slots, so what follows a participant keeps up with the frame whether or not a tick falls in it. `seconds` is the frame time the participant's own body moved in. */
  applyControls(seconds: number): void;
  /** Advances the world by `deltaSeconds`, any non-negative duration (0 is legal: it applies commands and derives). The app's ticks come from the simulation clock, which keeps them within its maximum. */
  step(deltaSeconds: number): void;
  /** Emits the `world/behindRealTime` notice: the simulation clock dropped `seconds` of real time. The shell calls it as the clock allows, at most once per second. */
  noticeBehindRealTime(seconds: number): void;
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
    /** The tool this command needs; a client is refused with `world/capabilityMissing` while the tool configuration disables it. */
    readonly requiresTool?: RuntimeToolId;
    /** Reachable by `ctx.dispatch` only; clients are refused with `world/moduleOnly`. */
    readonly moduleOnly?: true;
  };
};

/** The kinds of work: bodies ticks move what follows a participant, once per frame in `applyControls`; simulate ticks change the world and derive ticks recompute what follows from the journal, in each step. */
export type ModulePhase = "bodies" | "simulate" | "derive";

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
  /** Bodies and simulate only: true skips the tick this step. Must not allocate. */
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
  /**
   * Kinds of the core union that this module also writes, because the module that will own them does not exist yet (the emitter and geodesic kinds, until `geodesicEmitters`, design 013 job 51). Only the write guard reads it; it empties as the owners arrive.
   */
  readonly writesCoreKinds?: readonly string[];
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
}

/** One object, reused every step: never keep it across steps. */
export interface StepContext {
  readonly world: CompiledCellComplex;
  readonly objects: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  /** The range of change-ring sequence numbers this tick has not seen: read entry `seq` through `ctx.objects.changes.ring` (`objectAt(seq)`, `beforeAt(seq)`). Sequence numbers, not frame indices. */
  readonly changesFrom: number;
  readonly changesTo: number;
  participant(id: string): ParticipantRecord | undefined;
  /** Calls `fn` for every participant, in creation order, without allocating. */
  forEachParticipant(fn: (participant: ParticipantRecord) => void): void;
  /** Replaces the attachments of a participant. */
  setAttachments(participantId: string, attachments: readonly ParticipantAttachment[]): void;
  control(participantId: string, slot: string): PlainData | undefined;
  emit(event: EngineEventBase): void;
  /** Runs a command now, inside the step, as actor "world" (design 013 section 5.7). */
  dispatch(command: EngineCommandBase): CommandResult;
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
  /** Calls `fn` for every participant, in creation order, without allocating. */
  forEachParticipant(fn: (participant: ParticipantRecord) => void): void;
  /** Replaces the attachments of a participant. */
  setAttachments(participantId: string, attachments: readonly ParticipantAttachment[]): void;
  emit(event: EngineEventBase): void;
  dispatch(command: EngineCommandBase): CommandResult;
  openControl(participantId: string, slot: string): void;
  closeControl(participantId: string, slot: string): void;
}

// ---- The client part of a module: tools (design 013 sections 8.3 and 9.1) ----

/** An endpoint role of a geodesic arc, named by plain data: the arc, the role and the anchor it is attached to. */
export interface AimPickEndpoint {
  readonly geodesicId: string;
  readonly role: "start" | "end";
  readonly anchorObjectId: string;
}

/**
 * One thing along the current aim ray, as plain data (the subset of the shell's aim target that tools read). The shell builds the list, nearest first, from the portal ray walk.
 * `objectKind` is the kind of the hit object, or "floor" for a floor hit. `geodesicEndpoint` is set when the hit is the half of a geodesic that belongs to one endpoint role.
 */
export interface AimPick {
  readonly objectId?: string;
  readonly objectKind: string;
  readonly cellId: string;
  /** The aim point in the hit cell's local frame, meters. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  /** The hit is close enough to interact with. */
  readonly withinRange: boolean;
  readonly geodesicEndpoint?: AimPickEndpoint;
}

/** What a tool may do. The shell implements it; tests fake it. A tool changes the world only through `submit`. */
export interface ToolContext {
  /** Picks along the current aim ray (desktop: camera; XR: the hand ray), nearest first. A read-only query. */
  pickTargets(): readonly AimPick[];
  /** Submits a command for the local participant; its result arrives through the tool's `onResult` after the next step. */
  submit(command: EngineCommandBase): void;
  /** The client tool state of a module (`moduleToolState[moduleId]` of the client session), or undefined while its tool is idle. */
  getToolState<T>(moduleId: string): T | undefined;
  /** Replaces the client tool state of a module; undefined clears it. */
  setToolState(moduleId: string, state: unknown): void;
  /** Ends the tool: closes the menu and selects no tool. */
  endTool(): void;
  readonly read: WorldReadView;
  /** A module's read-only queries (design 013 section 5.7); never its `api`. */
  query<Q>(token: ModuleToken<unknown, Q>): Q;
  /** Shows a sentence to the person (console now, on-screen when a message system exists). */
  showMessage(message: string): void;
}

/** How an action on an object's menu page looks. */
export interface ObjectActionPresentation {
  readonly actionId: string;
  readonly label: string;
  /** Key into the palette's icon table for the action button. */
  readonly iconId: string;
  /** Text shown when the button is pointed at. */
  readonly tooltip: string;
}

/** An action offered on an object's menu page; `enabled` false shows it disabled. */
export interface ObjectActionEntry extends ObjectActionPresentation {
  readonly enabled: boolean;
}

/** The client part of a tool: everything the shell shows and does for it. A renderer-free record, in the module directory. */
export interface ToolDescriptor {
  readonly id: RuntimeToolId;
  /** The module whose client tool state this tool uses; cleared when the tool ends. */
  readonly ownerModuleId: string;
  /** Name shown on the main tool list and on the wrist indicator. */
  readonly label: string;
  /** Shorter name for the desktop badge; `label` when absent. */
  readonly badgeLabel?: string;
  readonly helpTitle: string;
  readonly helpBody: string;
  /** What the primary and context-menu inputs do while the tool is active, for the help lens. */
  readonly helpRows: readonly { readonly input: "primary" | "context-menu"; readonly label: string }[];
  /** CSS color of the wrist indicator, "#f59e0b". */
  readonly indicatorColor: string;
  /** Key into the icon tables of the desktop indicator, the wrist indicator and the palette. */
  readonly iconId: string;
  /** The aim cross is drawn while this tool is active. */
  readonly showsAimCross: boolean;
  /** `onPrimaryAction` runs every frame, not only on a primary action while no menu is open (the tools that update from the input each frame). */
  readonly runsEveryFrame?: boolean;
  /** Where the tool is started from: the main tool list, or an action on an object's menu page. */
  readonly entry:
    | { readonly kind: "main-tool" }
    | {
        readonly kind: "object-action";
        readonly objectKind: string;
        readonly action: ObjectActionPresentation;
        readonly isAvailable: (objectId: string, tool: ToolContext) => boolean;
      };
  /** The prompt shown while the tool is active, from its client tool state; undefined shows none. */
  readonly prompt?: (tool: ToolContext) => string | undefined;
  /** The primary action (click, trigger). Returns true when it consumed the input. */
  readonly onPrimaryAction: (tool: ToolContext) => boolean;
  /** Called when the tool has become active, after the world confirmed it; `objectId` is the object the action was started from. */
  readonly onStart?: (tool: ToolContext, objectId?: string) => void;
  /** Called with the result of each command this tool submitted. */
  readonly onResult?: (tool: ToolContext, result: CommandResult) => void;
  /** Called when the tool ends, whatever ended it, before the owner module's tool state is cleared. */
  readonly onEnd?: (tool: ToolContext) => void;
}

/** The client part of a module: a separate export of the module directory (`geodesicModelClient(options)`). */
export interface ModuleClient {
  readonly tools: readonly ToolDescriptor[];
}
