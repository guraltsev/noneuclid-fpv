# 013 - World engine, clients and modules

> **Status: living design document, draft.** Written 2026-11-03 for issue
> [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md), then widened the same day
> (maintainer): the split between world state and client state and the module system are one design. It is the core of
> [012](012-engine-api.md) and details its P1 to P3, P7, P8 and P17. Status rules as in 012:
> **Agreed** (decided by the maintainer), **Proposed** (under discussion), **Open**, **Rejected**. Every item below is
> Proposed unless marked otherwise. Jobs 48 to 60 built most of it and were merged on 2026-11-05; this text was then
> aligned with the code and with [014](014-derived-state-and-caches.md). "Implemented" does not mean **Agreed**: what was
> Proposed stays Proposed until the maintainer decides. Section 2 is kept as the state before the wave.

This document designs three things that only make sense together:

- the **world engine**, which owns world state and changes it only in steps, from commands;
- the **clients** (the desktop and VR shell, tests, bots, agents), which hold their own client state and talk to the
  world through commands, control slots, queries and a change journal;
- the **modules** through which every behaviour (a tool, a dynamic, a rule) enters both.

Section 15 turns it into implementation jobs, each written so that a coding model can carry it out without design
decisions of its own.

## 1. Decisions taken

| Date | Decision | Status |
| --- | --- | --- |
| 2026-11-03 | The world/client split and the module system are **one coherent design**, in this document; 012 keeps goals, principles, multiplayer, transports and phasing. | **Agreed** (maintainer) |
| 2026-11-03 | **World state is distinct from client state.** The world engine holds what exists in the world and how it is related; the shell (a client) holds how one person is interacting: menu, camera, overlays, comfort, the selected tool. | **Agreed** (maintainer) |
| 2026-11-03 | **The selected tool is client state; tools send messages** (commands). Lasting relations between a participant and a world object (carrying an emitter) are world state, created and ended by commands. Revises 012 P3 of 2026-11-01: the shell session keeps menu and tools, but who carries what moves to the world. | **Agreed** (maintainer) |
| 2026-11-03 | **Confirmation protocol**: before a client switches to a tool it asks the world; the world may refuse (a student who has not found a protractor yet is refused, and the client shows why). | **Agreed** (maintainer); protocol details proposed in section 8 |
| 2026-11-03 | **Behaviour and interaction go through commands** unless a path is particularly hot; direct access is strictly specified (section 5.7). | **Agreed** (maintainer); the list in 5.7 proposed |
| 2026-11-03 | The engine runs **on the main thread**, but clients reach it only through interfaces a worker could also provide (section 6.6). The Quest prototype of 012 P7 becomes a later job, not a blocker. | **Agreed** (maintainer) |
| 2026-11-03 | The first module is a **geodesic model** (piecewise geodesics: arcs, vertices, their operations) built on stateless **geometry tools** such as homotopy. Tying belongs to the model. The curve shortening flow is a separate module that depends on it. | **Agreed** (maintainer); the tools are core layers imported directly, not modules (13.1) |
| 2026-11-03 | **Carrying an emitter drags the end node of a tied curve; the curve shortening flow never acts on an end node.** The two behaviours are independent (13.1). Revises "behaviour unchanged" below for this one case: lifting an emitter no longer deletes a tied curve. | **Agreed** (maintainer); details proposed in 13.1 |
| 2026-11-03 | **A curve has no lifecycle.** No final locked state: a curve is a chain of arcs, and the flow stops by a natural condition, when no interior vertex is left to act on. A vertex at rest **always merges** away. | **Agreed** (maintainer); details proposed in 13.2 |
| 2026-11-03 | The flow now is the **simplest algorithm** (today's motion and merging), built so that a later, more physical algorithm can take tension into account and create intermediate vertices (13.2, section 16). | **Agreed** (maintainer) |
| 2026-11-03 | The flow's motion and merging move into its module unchanged (blocked curves end `unresolved`); a later job adds the "destroy" policy of 2026-11-02 as a policy. | **Agreed** (maintainer) |
| 2026-11-03 | Work inside a step is ordered by fixed phases, then module dependencies, then the experience's list order. | **Agreed** (maintainer) |
| 2026-11-03 | Performance is enforced by a bench with a `--check` mode against a committed baseline, run in every job's acceptance. No CI is added. | **Agreed** (maintainer) |
| 2026-11-03 | **Naming**: every name a module contributes is `<moduleId>/<noun>`, nouns from the mathematical model; renaming is part of the jobs (section 10). | **Agreed** (maintainer) |
| 2026-11-03 | The tie tool's selection highlight stays on the segments, behind a model API call, until a client overlay replaces it. | **Agreed** (maintainer) |
| 2026-11-02 | When a flow touches a forbidden-zone singularity, the geodesic is destroyed. Implemented by job 55. | **Agreed** (maintainer, earlier) |
| 2026-11-05 | **A blocked curve is destroyed, whatever blocked it**, not only at a forbidden zone, until a better behaviour exists. The maintainer does not want `unresolved` as a resting state. | **Agreed** (maintainer) |
| 2026-11-05 | **Simulation time belongs to the simulation** (012 P8): ticks of length \(h\), default \(1/90\) s, maximum \(1/30\) s. The shell never passes frame time. The local body stays outside the ticks, published at draw time, until locomotion moves into the engine. Not built yet: the code still steps once per frame. | **Agreed** (maintainer) |
| 2026-11-05 | **Read tracking for measurements is on by default** (`geodesicMeasurementsModule({ trackReads })`, `world-objects/trackedReads.ts`; 014 D14). It costs a little with few records and pays with many that a change does not touch, and the step is well within budget. | **Agreed** (maintainer) |
| 2026-11-05 | **`unresolve` is deleted**: a blocked curve is always destroyed. Better behaviour comes with a later algorithm, not as a resting state. | **Agreed** (maintainer) |
| 2026-11-05 | **Engine hooks with no user are deleted** and listed in section 18, so that the design work survives: `onEvents`, module tool gates, revocation, the participant journal, `deviceId`, `ctx.stepIndex`, create-context `ids`. | **Agreed** (maintainer) |
| 2026-11-05 | **A free geodesic is not destroyed at a corner.** Aimed or rotated through one, it stops there, remembers its length and extends as soon as the corner is cleared. A later effect makes the corner glow. The length is world state (issue 93). | **Agreed** (maintainer) |
| 2026-11-05 | **The next batch is `geodesicEmitters`**, with the time change and `publicApi` (section 16). | **Agreed** (maintainer) |

## 2. Where the code stood before this wave (checked 2026-11-03)

**State.** `AppSessionState` (`src/runtime/appSession.ts:29-50`, job 46) holds everything mutable in one record.
Classified by the line of this document:

| Field | Today | World or client |
| --- | --- | --- |
| `menuState` | menu open, page, selected tool, sign and help payloads | client |
| `appConfig` | menu sections and the four enabled tool groups | split: the tool list is world configuration (section 8.2), the menu layout is client |
| `debugSettings`, `showCellPathRendersInstances`, `vrComfortOptions` | | client |
| `playerPose` | the player's cell and pose | world (the participant's body) |
| `cannonToolState` | selected cannon, active geodesic, tie picks | client (the emitter tools' selection) |
| `carry` | who is carried, `arrived` | world (an attachment, 012 P4) |
| `protractorToolState` | protractor picks | client |
| `objectIdSerials` | id counters | world (engine-allocated ids, 012 P6) |

World objects are in the `RuntimeObjectRegistry` (`src/world-objects/runtimeObjectRegistry.ts`): a closed union of
records that imports the geodesic types, one global `version` counter, no listeners, no per-kind version;
`getObjectsOfKind` allocates on every call.

**Who writes the world.** Render-side tools write the registry directly: `geodesicCannonTools.ts` (shoot, aim, carry,
tie), `toolObjectRuntimes.ts` (lengths, angles), `runtimeObjectActions.ts`, `placedFlags`, `geometryCommit.ts` after a
deformation. Commands exist only for the menu: `RuntimeCommand` (`src/runtime/runtimeCommands.ts`, about 60 kinds) is
reduced by `applyRuntimeCommand` into session changes plus effects that the render layer runs.

**The flow.** A correction to issue 84 first: `free-geodesic-end` and `motionState` are core geometry used by every shot
geodesic (`shootGeodesic`, `cannon.ts:243`; `isAimableFreeGeodesic`, `endpoints.ts:237`). Only the
`curve-shortening-pair` kind, `tieAndDetachGeodesicEndpoints` and `advanceCurveShorteningPairs` are the flow's.

| Place | What it does |
| --- | --- |
| `createThreeApp.ts:1249-1268` | Calls `advanceCurveShorteningPairs`, then for each returned id refreshes protractor angles and measured lengths, prunes intersection markers and their angles, requests a hitbox sync. |
| `geodesicCannonTools.ts:590-670` | The tie tool: two picks kept in the session, then `tieAndDetachGeodesicEndpoints` with ids from `Date.now()`. |
| `geodesicCannonTools.ts:313-344, 691-703, 794-801, 944-971` | Four more hand-written follow-up lists after other geodesic edits. |
| `src/runtime/worldGeometryComputedObjects.ts:32-111` | A second, drifted copy of the same refreshers, used after a deformation. |
| `world-objects/geodesic/intersections.ts:63-99` | Every geodesic mutator requests the intersection update by hand: about 40 call sites. |

**Tools.** `RuntimeToolId` (`src/glue/toolIds.ts`) is a closed union enumerated by hand in about ten files: frame
dispatch (`createThreeApp.ts:1184-1221`), desktop indicator, VR wrist indicator, help lens, tooltips, aim cross,
palette, effects, `appConfig`.

**Persistence.** None. **Performance checks.** `npm run bench` prints tables with no thresholds; `frameAllocations`
needs `gc()` and nothing passes `--expose-gc`; the only workflow publishes Pages.

**Rules to amend.** `_docs/llm-implementation-workflow.md` forbids "plugin systems, generic registries, global event
buses"; `_docs/coding_style.md` forbids generic plugin layers unless required, and identifiers ending in `System`.

## 3. Vocabulary

- **World state**: what exists in a world and how it is related; the same for every participant, reproduced by replay.
- **Client state**: how one person interacts with the world; never sent to the world, never replayed.
- **World engine** (`engine`): the owner of world state. It changes it only inside `step`, from commands and control
  slots.
- **Client**: anything that talks to the engine: the shell (desktop and VR), tests, scenario scripts, bots, agents.
- **Participant**: someone acting in the world: today, the local player. Has a body, attachments and control slots.
- **Command**: a plain-data request to change the world, with a result (accepted, or refused with a reason).
- **Control slot**: a latest-value-wins input the engine samples every step (012 P1): movement axes, a carry offset.
- **Attachment**: a lasting relation between a participant and a world object, held by the world (carrying).
- **Module**: a unit of behaviour with a world part (kinds, commands, ticks, queries, tool gates) and a client part
  (tools, views).
- **Interface token**: a typed name for a module's exported API; dependents require tokens, not modules.
- **Experience**: the ordered list of configured modules a world runs with, composed once.
- **Tick**: per-step work of a module, in a phase (`simulate` or `derive`). "System" is avoided in identifiers.
- **Change journal**: every world write since the clients last read, in order; reused, no allocation once warm.
- **Read view**: the read-only face of world state that clients use between steps.

## 4. The line between world and client

**Agreed** (2026-11-03). A piece of state is **world state** when any of these holds:

1. another participant must see it or be constrained by it (an emitter carried by Ana cannot be picked up by Ben);
2. it changes what the world does over time (a geodesic that flows, a creature that moves);
3. a replay must reproduce it.

Otherwise it is **client state**. The test is the state, not the code that changes it: a client tool may start a world
relation (picking up starts a carry) and a world event may end client state (a revoked tool closes the client's tool).

| Client state (the shell session) | World state (the engine) |
| --- | --- |
| menu open, current page, help and sign pages | world objects (registry) |
| selected tool, tool picks (tie ends, protractor arms), prompts, highlights | participants: body pose, attachments, control slots |
| camera, overlays, debug settings, comfort options | per-participant capabilities (which tools they may use) |
| desktop or VR input mapping | engine ids, step index, geometry version |
| a pending tool request (section 8) | the module state of section 9.3 |

Consequences:

- The shell session (`AppSessionState`) becomes the **client session**. It loses `playerPose`, `carry` and
  `objectIdSerials` to the world. The menu, the tool selection and the tool picks stay, as decided on 2026-11-01.
- A tool is a client's way of building commands. Tests, bots and agents need no tools: they send the same commands.
- Nothing in the client session is replayed or sent over a network, except as presence information a client chooses to
  publish (S2: head pose, the tool in hand), which is informative, never authoritative.

## 5. The world engine

### 5.1 What it owns

```ts
// src/engine/worldEngine.ts
export interface WorldEngine<Cmd extends EngineCommandBase> {
  /** Queue a command from a participant; it is applied at the start of the next step. */
  submit(participantId: string, command: Cmd): CommandTicket;
  /** Set a control slot of a participant; the latest value before a step is the one sampled. */
  setControl(participantId: string, slot: string, value: PlainData): void;
  /** Direct write D1 (section 5.7): the owner of a participant replaces its body. False for a non-owner, and nothing changes. */
  publishBody(participantId: string, body: ParticipantBody): boolean;
  /** Advance the world by one tick of `deltaSeconds` (012 P8: the simulation's tick length, never frame time; 0 is legal). */
  step(deltaSeconds: number): void;
  /** Read-only world state, valid until the next step (section 6.6). */
  readonly read: WorldReadView;
  /** Results of the commands applied by the last step, by ticket. Cleared by `endFrame`. */
  resultOf(ticket: CommandTicket): CommandResult | undefined;
  /** Events of the steps since the last `endFrame`, in order. */
  forEachEvent(fn: (event: EngineEventBase) => void): void;
  /** A module's read-only queries. Never its `api`, which holds operations (section 5.7). */
  query<Q>(token: ModuleToken<unknown, Q>): Q;
  /** Called by the client after it has read changes, events and results. */
  endFrame(): void;
  /** Legacy writers only (section 14): the engine's id source, until their module allocates its own ids. */
  readonly ids: EngineIdSource;
}
```

It owns:

- **the registry** of world objects, with the change journal (6.2);
- **participants**: `{ id, kind: "local-player" | ..., body (cell, pose), attachments, capabilities }`. Today one: the
  local player. Bodies are written by their **owner** (012 P5): the device owning the participant publishes its pose
  with `publishBody`, by the same ownership rule as the registry's owner publisher (`claimOwnership`);
- **control slots** per participant;
- **ids**: `<moduleId>/<family>:<serial>` from engine counters (012 P6; no `Date.now()`);
- **the step index** and **geometry version**;
- **the composed modules** (section 9).

It does **not** own: rendering, picking caches, input devices, the menu, the selected tool.

### 5.2 One step

**Agreed** order (012 P8, 2026-10-30), made concrete:

1. **Commands**: apply the queued commands in arrival order. Each handler returns a result; results are stored by
   ticket. A refused command changes nothing.
2. **Control slots**: sample the latest values.
3. **Bodies**: ticks of the phase `bodies`: locomotion and dynamics of participants (today the shell moves the player and
   publishes the pose; it moves into this phase after this wave, section 16); attachments follow their carriers (carry, section 7).
4. **Module simulate ticks** (the flow; later creatures).
5. **Module derive pass** (crossings, measured lengths, angles).
6. **Finalize**: the step's events are final.
7. **Deformation**, if a job is ready (012 P8, P9): carry everything across, emit `world/geometryChanged`, one more
   derive pass in the new geometry. **Not built**: the shell commits a deformation at the start of its frame, outside the
   step, until the deformation job (section 16).

Rendering is not part of a step; the client reads the result.

### 5.3 Commands and results

- A command is plain data with a namespaced kind (`"geodesicModel/tieAndDetach"`, section 10) and only intrinsic
  geometric data: ids, endpoint roles, cell-local locations; never rays (012 P2, agreed). The engine adds the issuing
  participant (`CommandContext.participantId`).
- **Results**:

  ```ts
  export type CommandResult =
    | { readonly ok: true; readonly value?: PlainData }
    | { readonly ok: false; readonly refusal: { readonly code: string; readonly message: string } };
  ```

  `code` is a stable string for programs (`"geodesicModel/notConnected"`, `"world/capabilityMissing"`); `message` is a
  sentence for people ("You have not found a protractor yet."). Handlers never throw for a refusal; a thrown exception
  is a bug: `step` finishes, stores `{ code: "world/internalError" }` as the result, then rethrows to the shell's frame error
  guard. The client still reads the result in that frame (issue 87).
- **Timing**: a command is applied at the next step. In the app, a click submits during the frame's input or tool phase
  and the step runs later in the same frame, so the result is there before the UI phase. Commands submitted between
  frames (palette clicks) apply in the next frame's step, at most one frame later. With ticks (012 P8) a frame may run no
  step, and a result then waits for the next tick, at most \(h\) later. Tests write
  `const t = engine.submit(p, cmd); engine.step(0); engine.resultOf(t)`: a step of zero seconds is legal and only
  applies commands and derives.
- **API**: `window.noneuclid.api.world.submit(command)` submits for the local participant and resolves with the result
  after the next step, so scenario scripts and agents can `await` it.

### 5.4 Control slots

- A slot is named `<moduleId>/<noun>` (or `world/<noun>` for the engine's own), holds plain data, and is sampled at
  phase 2. Absolute values or rates, never deltas (012 P1 refinement 2).
- Slots are opened and closed by commands: `carry/attach` opens `carry/offset` for that participant; `carry/detach`
  closes it. A value set on a closed slot is ignored.
- Movement slots (`world/moveIntent`, `world/look`) come after this wave (section 16); until then the shell moves the body itself.

### 5.5 Events

Events are plain data with namespaced kinds, emitted by commands and ticks, collected per step, readable by clients until
`endFrame`. Participant-addressed events carry `participantId`.

### 5.6 Queries

Read-only functions on the read view and on modules' `queries` (`engine.query(token)`). Picking (012 P2: "a
read-only query") stays in `src/interaction/aimTarget.ts`, which is renderer-free; the shell's aim cache wraps it. It
reads the read view only.

### 5.7 The access rule

**Agreed** (maintainer, 2026-11-03): behaviour and interaction go through commands unless a path is particularly hot,
and direct access is strictly specified. The list below is proposed.

A client changes the world in one of three ways, tried in this order:

1. **A command**, the default: everything a person or a script does (shoot, tie, delete, pick up, select a tool). It is
   validated, can be refused, and is replayable. It costs no latency: the step runs later in the same frame.
2. **A control slot**, for a continuous input that changes every frame and has no result of its own (`carry/offset`).
   Opened and closed by commands (5.4).
3. **A direct write**, only if it is on the list below. Nothing else may write.

| Id | Direct write | Who | Why a command does not fit | Ends |
| --- | --- | --- | --- | --- |
| D1 | `engine.publishBody` | the participant's owner | the body pose changes every frame and the camera must not lag it | desktop: when movement slots arrive (section 16); the VR head and hands stay client state on top of the body |

Adding a row needs the maintainer, a measured reason (a bench or frame trace showing a command or slot is too slow) and
an end condition. "It was easier" is not a reason. Legacy writers (section 14) are not on this list: they are debt with
a deadline.

Reading is not direct access in this sense: `engine.read`, journals, events, `resultOf` and `queries` are open to every
client, because they cannot change the world (6.5).

**Between modules the same preference holds** (maintainer, 2026-11-03: commands are the preferred way to interact). A tick
or a handler writes its own kinds directly, since it is the behaviour itself. To change what another module owns, it calls
`ctx.dispatch(command)`:

- synchronous: the handler runs now, inside the step, and the `CommandResult` is returned, so nothing lands a step late;
- same handlers, same refusals as a client's command; the actor is `"world"`, so `requiresTool` is not checked;
- a handler marked `moduleOnly` is refused to clients with `world/moduleOnly`, so a client cannot `removeCurve`;
- a module dispatches only its own commands and those of the modules it `requires`; nesting deeper than 8 throws;
- the write guard treats the writes as the handler's module, so each module still writes only its own kinds;
- replays record client commands only; dispatched commands follow from them.

A dependency's `api` is the module-level direct route, and it is closed like the client list:

| Id | Direct call | Who | Why a command does not fit | Ends |
| --- | --- | --- | --- | --- |
| M1 | `previewVertexMove`, `commitVertexMove` | `curveShortening` tick | called for each vertex each step, many times in the line search; the preview is opaque, not plain data, and allocating a command per call would cost frame time | if a bench shows `dispatch` is as cheap |
| M2 | `previewVertexRemoval` | `curveShortening` tick | a read whose result is opaque, used to choose a policy; writes nothing | when its result is plain data, it moves to `queries` |

Clients never hold an `api`:

- a module exposes `api` (dependents only) and `queries` (dependents and clients, read-only);
- `engine.query` and `ToolContext.query` return `queries`; `ModuleCreateContext.require` returns `api`;
- `publicApi` holds reads, or wrappers that submit a command; never a write of its own.

Checked by: the types (no client-visible type holds an operation); the write guard (9.6), which also fails a write during
a `queries` call; each module's contract test (`queries` leave the registry version unchanged).

## 6. How clients read the world

### 6.1 The read view

```ts
export interface WorldReadView {
  readonly stepIndex: number;
  readonly geometryVersion: number;
  readonly world: CompiledCellComplex;
  /** The registry's read methods only: get, getObjectsOfKind, getObjectsInCell, ..., countOfKind, changes. */
  readonly objects: RuntimeObjectReader;
  participant(id: string): ParticipantRecord | undefined;
}
```

`RuntimeObjectReader` is a new type: `RuntimeObjectRegistry` minus `add`, `update`, `remove`, `claimOwnership`,
`releaseOwnership`, `moveToCell`. Clients receive the reader type; only the engine and modules hold the writer.

### 6.2 The change journal

The registry records every write in `src/world-objects/runtimeObjectChangeJournal.ts`, exposed as `registry.changes`. The
journal below is the frame's view of a **ring** with absolute sequence numbers and `beforeAt`, `registry.changes.ring`
(014 section 3): the frame view keeps this interface, and everything that reads across frames reads the ring.

```ts
export const enum ChangeOp { Added = 0, Updated = 1, Removed = 2 }

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
```

Implementation rules: parallel arrays (`ops`, `ids`, `kinds`, `objects`) with a `length` counter, overwritten in
place; `lastIndexByKind: Map<string, number>` plus a reused `touchedKinds: string[]` so `clear` resets only the kinds
used; `clear` sets `length = 0` without truncating. The registry's `add`, `replaceObject` (serving `update` and owner
publishers) and `remove` each record one entry; nothing else in the registry changes.

Participants are not registry objects: they are few and change every frame. The engine keeps them in its own table; clients read it through `engine.read.participant`.

### 6.3 Who clears it

`engine.endFrame()` clears the frame views, events and results, and moves the frame start of the ring. It does not reset
tick cursors. The shell calls it at the end of its frame, after views, label runtimes and the UI have read them. A write made
after `step` and before `endFrame`, or between frames (legacy direct writes, section 14), reaches the next derive pass.

### 6.4 The derive pass

Run at step phase 5 (and phase 7 after a deformation):

- each derive tick keeps a cursor, a sequence number of the ring. It wakes when `wants(ctx)` is true, or when
  `lastSeqOfKind(k) >= cursor` for a `k` in its `subscribes`; it reads `[changesFrom, changesTo)` through
  `ctx.objects.changes.ring`, filtering by kind. A pass that does not wake a tick still moves its cursor to the head;
- ticks run in module order, then in the order of the module's `ticks` array; a tick sees every earlier tick's writes
  (rule 9 of 9.2 forbids subscribing to a later writer).

This replaces the hand-written follow-up lists: the registry already knows what changed, and every dependent reads that
from one place. Intersections stop being requested by hand (job 52).

### 6.5 Rendering

Commands are how a client changes the world; they are not how it sees the world. A client has a realtime view: on the
main thread, `engine.read` is the engine's own state, handed out by reference. Reading it costs what reading the
registry costs today: no message, no copy, no serialisation, no waiting for a reply.

Each kind of client need has one channel:

| Need | Channel | Cost |
| --- | --- | --- |
| Current state to draw this frame | `engine.read`, pulled synchronously | a lookup |
| Retained three.js objects, labels, hitboxes | the journal: touch only what changed | nothing on an idle frame |
| One-off transitions (a sound, a notice) | events | one per transition; poses are state, never events (012 P7) |
| Answer to a command | `resultOf` | once per command |

The frame (**Agreed**, 012 P8 of 2026-11-05; **not built**: today the shell runs one step per frame with the frame time,
capped at 0.1 s):

1. Sample input; `submit` commands, `setControl` slots, `publishBody` for the local body (D1, section 5.7).
2. Convert elapsed real time into ticks with an accumulator and run that many `engine.step(h)`: none, one or several.
3. Label runtimes and the UI read; build the render snapshot from `engine.read` and the journal (012 P7, client side,
   unchanged) and draw.
4. `engine.endFrame()`.

So what is drawn is the state of the latest tick. The camera and the VR head and hand poses never pass through a command:
the client that owns a body publishes it (D1), and the headset's pose at draw time is client state applied on top of it, so
ticks add no VR latency. Until locomotion moves into the engine (section 16), the local player moves on frames and the world
moves on ticks. `afterStep` hooks of the shell run once per frame, not once per tick: they replay every event since `endFrame`, so
running them per tick would deliver events twice. A client view that needs three.js lives in `src/render/three/...` and syncs
from the journal.

*Proposed* (the 012 P7 candidate, to be measured in the later prototype): with the engine in a worker or on a network,
`engine.read` keeps this interface and stays synchronous, but is backed by a local replica fed by the journal. Clients do
not change, and a frame never waits for the engine; it draws the newest complete step the replica holds.

### 6.6 Worker-ready rules

**Agreed** direction (main thread now, a worker possible later). Rules that keep the worker possible:

1. Clients reach the engine only through `WorldEngine`: `submit`, `setControl`, `publishBody`, `read`, `resultOf`,
   `forEachEvent`, `query`, `endFrame`. No client imports engine internals (enforced, section 12.2).
2. Everything crossing that boundary is plain data; `read` hands out immutable records (012 P7 commitment 1, agreed
   tentatively) and is valid only until the next step: no client keeps a record across steps and expects it current.
3. Query APIs return plain data, never live handles.
4. The journals are the feed format for a replica: a worker or a network peer would send journal entries and events
   per step. That is the later P7 prototype's job to measure (job list, section 16).

## 7. Attachments: carrying as world state

**Agreed** (012 P4, 2026-10-30; placement revised 2026-11-03): carrying is a relation held by the world.

- `carry/attach { objectId }`: refused if the object is not carriable (`world-objects/carry.ts` contract), out of reach,
  or already carried by someone (`"carry/alreadyCarried"`, message "Already carried by Ana.") — first come, first
  served (012 P5). On success the participant's record gains the attachment and the slot `carry/offset` opens. Today the
  shell lifts the emitter before the world answers; that is issue 88.
- Each step, phase 3, the carried object moves by the carry contract of job 47 (displacement messages from the offset,
  bounded steps, re-homing, wall stop; job 47 made a junction a wall). The module also has the commands and events
  `carry/drop`, `carry/moved` and `carry/released`.
- The carried emitter drags the end nodes of its geodesics, tied curves included (13.1).
- `carry/detach`: release is only a detach (P4).
- When the engine ends an attachment itself, it emits `carry/dropped { participantId, objectId, reason }` and the client leaves
  its carry tool.

The client carry tool keeps only its UI (the prompt, which hand). `CarryRecord` leaves the client session; `arrived`
(the leash state) becomes a field of the attachment, because it changes how the object moves.

Rotate and aim of an emitter are the same kind of relation ("Ana is editing emitter C", with a slot for the aim) and
follow in the emitter module (section 16).

## 8. Tools and the confirmation protocol

### 8.1 The protocol

**Agreed** in principle (maintainer, 2026-11-03): the client asks before switching to a tool, and the world may refuse.

1. The person selects the protractor. The client submits `world/requestTool { toolId: "geodesicMeasurements/protractor" }`
   and marks the tool **pending** (the button shows a spinner; the old tool stays active).
2. At the next step the engine asks the **tool gates** (8.2). The first refusal wins.
3. Result `ok`: the client switches tool. Result refused: the client stays on the old tool and shows the message ("You
   have not found a protractor yet."). In single player both happen in the same or the next frame.
4. Commands that need a tool declare it (`requiresTool` on the command handler, 9.1). The engine checks the same gates
   before running the handler and refuses with `world/capabilityMissing`. The request in step 1 gives early feedback;
   the check in step 4 is what enforces, so a script or a stale client is refused the same way.
5. *Specified, not built* (section 18): a tool revoked while a client holds it.

The world never records which tool is selected: requesting is a question, not a state change. *Rejected alternative:*
world-held "equipped tool" state. It would be state only humans use, would need a round trip and replay entries for
every switch, and nothing in the world depends on it. If an experience makes a tool a **physical object** (one
protractor on the table that students must share), picking it up is an attachment (section 7), and its gate answers
"held by Ana" while someone else holds it.

### 8.2 Tool gates

- The engine's own gate: the experience's **tool configuration** (today `appConfig.tools`, the four groups
  `placeFlags`, `geodesicEmitters`, `distances`, `angles`): a tool outside it is refused with `world/toolDisabled`.
  It is world configuration, fixed per world load.
- Module gates are *specified, not built* (section 18). The configuration gate is the only one today.

### 8.3 Client tool descriptors

Each tool's client part is one renderer-free record (in the module directory, client file, section 12.1):

```ts
export interface ToolDescriptor {
  readonly id: RuntimeToolId;
  /** The module whose client tool state this tool uses; cleared when the tool ends. */
  readonly ownerModuleId: string;
  readonly label: string;                 // "Tie"
  readonly helpTitle: string;             // help lens
  readonly helpBody: string;
  readonly indicatorColor: string;        // desktop indicator and VR wrist, "#f59e0b"
  readonly iconId: string;                // palette icon table
  readonly showsAimCross: boolean;
  /** Where the tool is started from: the main tool list, or an action on an object's page. */
  readonly entry:
    | { readonly kind: "main-tool" }
    | { readonly kind: "object-action"; readonly objectKind: string; readonly actionId: string;
        readonly isAvailable: (objectId: string, tool: ToolContext) => boolean };
  /** Prompt shown while the tool is active, from its client tool state. */
  readonly prompt: (tool: ToolContext) => string | undefined;
  /** The primary action (click, trigger). Returns true when consumed. */
  readonly onPrimaryAction: (tool: ToolContext) => boolean;
  /** Called when the tool becomes active (after the world confirmed it). */
  readonly onStart?: (tool: ToolContext, objectId?: string) => void;
  /** Called with the result of a command this tool submitted. */
  readonly onResult?: (tool: ToolContext, result: CommandResult) => void;
}

/** What a tool may do. The shell implements it; tests fake it. */
export interface ToolContext {
  /** Picks along the current aim ray (desktop: camera; XR: the hand ray). A read-only query. */
  pickTargets(): readonly AimPick[];
  /** Submits a command for the local participant; the result arrives through onResult. */
  submit(command: EngineCommandBase): void;
  getToolState<T>(moduleId: string): T | undefined;       // client session, moduleToolState[moduleId]
  setToolState(moduleId: string, state: unknown): void;     // through a client runtime command
  endTool(): void;                                          // clear-selected-tool + close-menu
  readonly read: WorldReadView;
  query<Q>(token: ModuleToken<unknown, Q>): Q;             // queries only (section 5.7)
  showMessage(message: string): void;                      // refusals; console and on-screen when it exists
}
```

`AimPick` is the plain-data subset of today's aim target: `{ objectId, kind, cellId, point, withinRange,
geodesicEndpoint? }`, built by the shell from `resolveCurrentAimTargets`.

The tool-id union becomes core ids plus module ids by interface merging (`interface ModuleToolIds {}` in
`glue/toolIds.ts`). The shell builds `toolsById` once, from the experience's client parts plus its own descriptors for
not-yet-migrated tools; every place that enumerates tool ids today reads it:

- frame dispatch (`createThreeApp.ts:1184-1221`) becomes `toolsById.get(selectedTool)?.onPrimaryAction(ctx)`;
- desktop indicator, VR wrist indicator, help lens, palette tooltips, aim cross;
- the emitter page's action list (today a hard-coded tie button and `canTieAndDetach`) becomes the object-action
  contributions for that object kind, each `{ actionId, label, iconId, enabled }`;
- the `switch-tool-session` effect clears the client tool state of the ending tool's `ownerModuleId`.

Carry, rotate and aim keep their per-frame updates in the shell until their modules exist (section 16).

## 9. Modules

### 9.1 Types

In `src/engine/moduleTypes.ts`:

```ts
/** A typed name for an exported module API. `Api` is phantom: only the id exists at runtime. */
export interface ModuleToken<Api, Queries = Record<string, never>> { readonly id: string; readonly __api?: Api; readonly __queries?: Queries }
export function defineModuleToken<Api, Queries = Record<string, never>>(id: string): ModuleToken<Api, Queries>;

export interface EngineCommandBase { readonly kind: string }
export interface EngineEventBase { readonly kind: string; readonly message?: string; readonly participantId?: string }

/** One handler per command kind; the mapped type makes the set exhaustive. */
export type CommandHandlers<C extends EngineCommandBase> = {
  readonly [K in C["kind"]]: {
    readonly run: (command: Extract<C, { kind: K }>, ctx: CommandContext) => CommandResult;
    /** The tool a participant must be allowed to use (section 8.1, step 4). */
    readonly requiresTool?: RuntimeToolId;
    /** Reachable by `ctx.dispatch` only; clients are refused with `world/moduleOnly` (section 5.7). */
    readonly moduleOnly?: true;
  };
};

export type ModulePhase = "bodies" | "simulate" | "derive";

/** An object kind a module declares. Exactly one module declares each kind. */
export interface ObjectKindDeclaration {
  readonly kind: string;
  readonly label: "real" | "cheap-derived" | "expensive-derived";   // 012 P7 commitment 3
  readonly persistence: "saved" | "rebuilt" | "transient";          // section 11
}

export interface ModuleTick {
  readonly id: string;                                    // "<moduleId>/<name>"
  readonly phase: ModulePhase;
  readonly writes: readonly string[];                     // kinds, all declared by this module
  readonly subscribes?: readonly string[];                // derive only
  readonly wants?: (ctx: StepContext) => boolean;         // derive only; must not allocate
  readonly isIdle?: (ctx: StepContext) => boolean;        // simulate only; must not allocate
  readonly run: (ctx: StepContext) => void;
}

/** The world part of a module. */
export interface ModuleDefinition<Api = unknown, Cmd extends EngineCommandBase = never, Evt extends EngineEventBase = never, Queries = unknown> {
  readonly id: string;
  readonly provides?: ModuleToken<Api, Queries>;          // at most one
  readonly requires: readonly ModuleToken<unknown, unknown>[];
  readonly objectKinds: readonly ObjectKindDeclaration[];
  /** Tool ids this module defines; the engine knows them for gating (section 8). */
  readonly toolIds?: readonly RuntimeToolId[];
  readonly create: (ctx: ModuleCreateContext) => ModuleInstance<Api, Cmd, Evt, Queries>;
}

export interface ModuleInstance<Api, Cmd extends EngineCommandBase, Evt extends EngineEventBase, Queries = unknown> {
  readonly api: Api;                                      // dependents only; functions only; may hold operations
  readonly queries: Queries;                              // dependents and clients; read-only, plain data (5.7)
  readonly commands: CommandHandlers<Cmd>;
  readonly ticks: readonly ModuleTick[];
  readonly publicApi?: { readonly [name: string]: (...args: never[]) => unknown };  // api.<moduleId>, plain data; reads or submits only (5.7)
  readonly __events?: Evt;                                                          // phantom
}

export interface ModuleCreateContext {
  require<A>(token: ModuleToken<A, unknown>): A;          // throws unless in `requires`
  readonly objects: RuntimeObjectRegistry;
  readonly getWorld: () => CompiledCellComplex;
}

/** One object, reused every step; never keep it across steps. */
export interface StepContext {
  readonly world: CompiledCellComplex;
  readonly objects: RuntimeObjectRegistry;
  readonly deltaSeconds: number;
  readonly changesFrom: number;                           // journal range this tick has not seen
  readonly changesTo: number;
  participant(id: string): ParticipantRecord | undefined;
  control(participantId: string, slot: string): PlainData | undefined;
  emit(event: EngineEventBase): void;
  /** Runs a command now, inside the step (section 5.7). */
  dispatch(command: EngineCommandBase): CommandResult;
  readonly ids: EngineIdSource;
}

export interface CommandContext {
  readonly participantId: string;
  readonly world: CompiledCellComplex;
  readonly objects: RuntimeObjectRegistry;
  readonly ids: EngineIdSource;
  participant(id: string): ParticipantRecord | undefined;
  emit(event: EngineEventBase): void;
  dispatch(command: EngineCommandBase): CommandResult;      // section 5.7
  openControl(participantId: string, slot: string): void;
  closeControl(participantId: string, slot: string): void;
}

/** "<moduleId>/<family>:<serial>" (section 10), serials in the engine. No Date.now(). */
export interface EngineIdSource { next(family: string): string }

```

`reset` and `transformGeometry` are not built (014 section 9): nothing needs them yet. The deformation job adds the second. The
code adds `writesCoreKinds` (the carry module, until the emitter kind has a module) and `forEachParticipant`, `setAttachments` on
the contexts; `src/engine/moduleTypes.ts` is the reference.

The **client part** of a module is a separate export (`client.ts` in the module directory):

```ts
export interface ModuleClient {
  readonly tools?: readonly ToolDescriptor[];
  /** Initial client tool state; typed by interface merging into `ModuleToolStates` of the client session. */
  readonly initialToolState?: unknown;
}
```

A module directory exports a factory for the world part (`geodesicModel(options)`) and its client part
(`geodesicModelClient(options)`). Options are plain data (section 9.5). Composition of the world part happens in the
engine; the shell composes the client parts.

### 9.2 Dependencies and composition

- A module requires **tokens**; `ctx.require(token)` returns the provider's `api`. A dependent imports only the
  provider's `api.ts` (types and token; section 12.2).
- `composeModules(definitions)` runs once at engine creation and fails with a `ModuleCompositionError` listing **every**
  problem:
  1. two modules with the same id;
  2. two modules providing the same token;
  3. a required token no module provides ("module curveShortening requires geodesicModel; no module in the experience
     provides it");
  4. a dependency cycle, named as a path;
  5. an object kind declared twice, or declared by a module and also a core kind;
  6. two handlers for one command kind, or two modules defining one tool id;
  7. a tick writing a kind its module does not declare;
  8. a derive tick subscribing to a kind not declared by its module, a (transitively) required module, or the core;
  9. a derive tick subscribing to a kind written by a derive tick that runs after it;
  10. `ctx.require` of a token not in `requires`;
  11. a contributed name (kind, tool id, command, event, slot) that breaks the naming rule (section 10) or whose
      prefix is not the module's id;
  12. a `requiresTool` naming a tool id that no module in the experience defines.
- Modules are created in **topological order** of `requires`, ties broken by list order; the same order runs ticks.

### 9.3 Where module state lives

| State | Where | Example |
| --- | --- | --- |
| Shared world state (real) | registry objects of the module's declared kinds | a flow's vertex list |
| Per-participant world state | attachments and control slots of the participant record | a carry |
| Client tool state | client session `moduleToolState[moduleId]`, changed by the client command `set-module-tool-state` | tie picks |
| Configuration | factory options, fixed for the run | `speedLaw: "constant"` |
| Caches (derived) | a cache or a memo of 014 (section 2, D9); a cache needs no reset | the arc index; the flow's `quiet` |

A module keeps no other mutable state. So the world has one holder of real state (the engine: registry plus
participants) and each client one (its session).

### 9.4 Object kinds by interface merging

The registry union stays the type of stored records; modules add theirs without the registry importing them:

```ts
// src/world-objects/runtimeObjectRegistry.ts
/** Records declared by modules (src/modules/*), added by interface merging; see design 013, section 9.4. */
export interface ModuleObjectRecords {}
export type RuntimeWorldObject = /* the core members */ | ModuleObjectRecords[keyof ModuleObjectRecords];

// src/modules/curveShortening/objects.ts
declare module "../../world-objects/runtimeObjectRegistry" {
  interface ModuleObjectRecords {
  }
}
```

Every module compiled into the build is in the union; exhaustive switches over kinds list them all (for example
`tests/render/runtimeObjectPortalGhostContract.test.ts:59`). At runtime the engine rejects a write of a kind no composed
module declares (9.6). Tool ids (`ModuleToolIds`) and client tool states (`ModuleToolStates`) merge the same way.
*Rejected alternative:* a registry generic in its record type: it changes every geodesic function's signature for type
precision that composition already checks at runtime.

### 9.5 Policies versus replacement modules

A variation is a **policy** when it changes a decision at a point the module already reaches and leaves its kinds, the
invariants stated in its `api.ts`, and the meaning of its events unchanged. A policy is a factory option with a closed
set of named values (plain data), each mapped to a function in the module's `policies.ts`. A variation that changes the
state model or an invariant is a **replacement module** providing the **same token**, so dependents do not change.

| Variation | Kind | How |
| --- | --- | --- |
| Instant straightening | policy | `speedLaw: "instant"` (run to rest within one step, bounded) |
| Speed from tension | policy | `speedLaw: "tension"` (section 16) |
| Intermediate vertices | policy | `refinement` option, added with that job (section 16) |
| Frozen curves (tie works, the curve stays kinked) | composition | leave `curveShortening` out; the model still ties |
| No tie tool | policy of the model | `geodesicModel({ tieTool: false })`: the command stays for scripts and tests |
| Stick at the corner, insert a vertex there | replacement | another module providing `curveDynamicsToken` |

### 9.6 Write guard

In tests, and with the debug setting `moduleWriteGuard`, each tick and command handler gets a guarded registry that
throws on a write of a kind outside its module's declaration. Writes made through a provider's API run under the
provider's declaration. In production the plain registry is passed, at no cost.

A call through a dependency's `api` counts as a write of the providing module, as `dispatch` does (5.7).

## 10. Naming

**Agreed** (maintainer, 2026-11-03): this rule, and renaming is part of the jobs.

Today's names are unclear: kinds and tool ids share one flat set of strings with no owner; names drifted from what they
name (`"curve-shortening-pair"` holds a list of vertices; `"geodesic-cannon"` is an emitter in the docs;
`"free-geodesic-end"` is a vertex once shared; `"geodesci-marmot"` is a typo); styles are mixed.

**The rule.** Every name a module contributes is `<moduleId>/<noun>`: object kinds, tool ids, command kinds, event
kinds, control slots and id families. The engine's own names use the prefix `world/`.

- `moduleId` is camelCase; `noun` is camelCase and is the word of `_docs/MATHEMATICAL_MODEL.md`. Commands are verbs
  (`tieAndDetach`), events past participles (`vertexTied`).
- Object ids are `<moduleId>/<family>:<serial>` (`"geodesicModel/vertex:12"`). Not yet for arcs and measurements, which legacy
  writers still allocate (`geodesic:<n>`): they follow when their tools move into modules.
- A core kind keeps its string until the job that moves it into a module renames it.
- `docs:check` (job 51) checks string literals of kinds, tool ids, commands, events and slots under `src/modules/`
  against `^[a-z][A-Za-z0-9]*/[a-z][A-Za-z0-9]*$` with the module's directory as prefix; composition checks the same
  at runtime (rule 11 of 9.2).

**Renames in this wave:**

| Today | New | Job |
| --- | --- | --- |
| `geodesic-interval` | `geodesicModel/arc` | 51 |
| `free-geodesic-end` | `geodesicModel/vertex` (both an unshared free end and a shared vertex) | 51 |
| `geodesic-segment` | `geodesicModel/segment` | 51 |
| `geodesic-intersection` | `geodesicModel/crossing` | 51 |
| `measured-geodesic-length`, `protractor-angle` | `geodesicMeasurements/length`, `geodesicMeasurements/angle` | 52 |
| `curve-shortening-pair` | deleted: a curve has no lifecycle object (13.2) | 53 |
| `motionState` | deleted: `isTied(arcId)`, from the arc's ends | 51 |
| `isGeodesicLocked` | `arcConnectsEmitters`: a fact about the ends, not a state; the word "locked" is retired | 51 |
| `geodesic-cannon-tie-detach` (tool) | `geodesicModel/tie` | 54 |
| id families `"geodesic"`, `curve-shortening:${Date.now()}:…`, `free-end:…` | `geodesicModel/arc:<n>`, `geodesicModel/vertex:<n>` | 51 |

The emitter, flags, assets and creatures are renamed by the jobs that make their modules (`geodesicEmitters/emitter`,
and the marmot typo goes then).

**What a rename does**, so that it stays mechanical:

1. Replace the string everywhere in `src/` and `tests/`; typecheck finds the misses, because kinds are literal types.
2. Rename the TypeScript names the string belongs to, in the same job:

   | Old type | New type |
   | --- | --- |
   | `GeodesicIntervalObject` | `GeodesicArcObject` |
   | `FreeGeodesicEndObject` | `GeodesicVertexObject` |
   | `GeodesicIntersectionObject` | `GeodesicCrossingObject` |

   with their constructors and guards (`createFreeGeodesicEndObject` becomes `createGeodesicVertexObject`). Other
   functions keep their names unless a name states something false.
3. Update `_docs/MATHEMATICAL_MODEL.md` and the module header of `world-objects/geodesic/objects.ts` so that "arc",
   "vertex" and "crossing" are defined there, with the old word given once as "formerly".
4. Debug dumps, API output and fixture names follow. No alias for old strings: nothing is saved (section 11).

## 11. Persistence

Nothing is saved today; these rules make kinds declared from now on carry what a save format will need. Only the
declarations and a contract test are built in this wave.

- Every declared kind has a `persistence`: `saved` (real state), `rebuilt` (derived; its module rebuilds it after load:
  segments, crossings) or `transient` (neither: tool highlights).
- A save file lists the experience's modules `{ id, version }`, then the `saved` records and the participants'
  attachments. Client state is never saved.
- Loading into an experience that lacks a module drops its `saved` records (the load result lists them); core records
  naming the absent module are repaired by the rule below.
- **No dynamics record.** The flow saves nothing: a curve is its arcs and vertices. A curve saved while shortening resumes
  by itself after a load; loaded without the flow, it stays as it is.
- A contract test asserts that every declared kind has a `label` and a `persistence`.

## 12. Layers, files and import rules

### 12.1 Files

```text
src/engine/                    world engine core; imports no module
  worldEngine.ts               createWorldEngine: queue, step order, results, events, endFrame
  participants.ts              participant records, attachments, control slots, participant journal
  moduleTypes.ts               section 9.1
  composeModules.ts            checks of 9.2, topological order, flat tick arrays, handler map
  moduleTicks.ts               bodies, simulate and derive passes, cursors
  writeGuard.ts                the write guard
  toolGates.ts                 the configuration gate (world/requestTool itself is in worldEngine.ts)
  ids.ts, coreIds.ts           EngineIdSource
src/modules/
  geodesicModel/
    api.ts                     token, API type, command and event types: the only file other modules may import
    index.ts                   world factory
    client.ts                  client factory: the tie tool descriptor
    module.ts                  world definition over world-objects/geodesic; the tie command; the crossings tick
    tieTool.ts                 (job 54)
  geodesicMeasurements/        (job 52)
  curveShortening/
    api.ts, index.ts, module.ts
    flow.ts                    the flow, moved from world-objects/geodesic/curveShortening.ts
    policies.ts                speedLaw
  carry/                       (job 50) attach, detach, the carry/offset slot, over world-objects/carry.ts
src/runtime/experience.ts      the default experience: world modules and their client parts
src/runtime/clientSession.ts   the client session (renamed from appSession.ts in job 49)
src/world-objects/runtimeObjectChangeJournal.ts
```

The piecewise-geodesic implementation **stays in `src/world-objects/geodesic/`** in this wave: legacy callers import it,
and `world-objects` cannot import the higher `modules` layer. The module is a facade; the boundary applies to modules.

### 12.2 `docs:check` rules (job 48)

1. **New layers** in `scripts/docs/lib.mjs`, after `interaction`:
   - `engine`: `may: ["math", "cell-complex", "diagnostics", "movement", "world-objects", "glue", "interaction"]`;
   - `modules`: `may: [...the same, "engine"]`;
   - `runtime`, `ui` and `render` gain `"engine"` and `"modules"`.
2. **A new rule shape** in `moduleImportRules`: `{ fromPrefix, toPrefix, onlyVia, exceptFromPrefixes?, reason }`.
   An import from a file under `fromPrefix` of a file under `toPrefix` is a violation unless the target is in `onlyVia`
   (entries ending in `/` are prefixes) or the importer is under an `exceptFromPrefixes` entry. Rules:
   - for every module directory `X` (generated from the directories of `src/modules/`):
     `{ fromPrefix: "modules/", toPrefix: "modules/X/", onlyVia: ["modules/X/api.ts"], exceptFromPrefixes: ["modules/X/"] }`;
   - `{ fromPrefix: "modules/", toPrefix: "world-objects/geodesic/", onlyVia: [<the geometry tools of 13.1>], exceptFromPrefixes: ["modules/geodesicModel/"] }`;
   - clients use the engine's public face only: `{ fromPrefix: "render/", toPrefix: "engine/", onlyVia: ["engine/worldEngine.ts", "engine/moduleTypes.ts"] }`,
     and the same for `ui/`;
   - **legacy world writers**: render and ui files that import a world-objects mutator today are listed in
     `legacyWorldWriters` in `lib.mjs`; any other render or ui file importing one is a violation. The list may only
     shrink (a test compares it with the committed copy).
3. Unit tests for the new shape in `tests/project/moduleImportRules.test.ts`.

Type-only imports count. Interface merging (`declare module "..."`) is not an import for the checker; that is intended.

### 12.3 Amended rules

- `_docs/llm-implementation-workflow.md` and `_docs/coding_style.md`: the engine and module layers of design 013 are the
  one sanctioned plugin layer; do not add another plugin system, registry or event bus. Per-step module functions are
  "ticks". The naming rule of section 10.

## 13. The first modules

### 13.1 `geodesicModel`

The **geodesic model**: piecewise-geodesic curves on the glued complex (**Agreed** 2026-11-03). It holds state (arcs,
vertices, their realization) and the operations on it, built on stateless **geometry tools**.

- Kinds: `geodesicModel/arc` (with a portal word as homotopy class), `geodesicModel/vertex`, `geodesicModel/segment`
  (realization), `geodesicModel/crossing` (markers).
- Operations: realize an arc as the geodesic chord of its class; move a vertex (each incident arc keeps its class; its
  word changes by the portals the vertex crosses); remove a vertex by merging its two arcs; tie two endpoint roles at a
  new vertex; delete a curve.
- **Tying belongs to the model** (**Agreed**): surgery on a piecewise geodesic, needing no dynamics. The model owns the
  tie command, the tie tool and the event `geodesicModel/vertexTied`. A dynamics module acts on whatever tied vertices exist.
  Without one, a tied curve stays as tied.

**Geometry tools**, **Agreed** packaging (core layers imported directly, not modules): pure functions of the compiled complex and of words, no registry, no state.
They are the 012 P15 combinatorial and manifold layers, not modules: nothing about them varies per experience, and a
module boundary would only add indirection on hot paths. Every module may import them directly.

| Tool | Mathematical content | Today |
| --- | --- | --- |
| Homotopy | portal words in the free group on portals (junctions removed, 012 P2): reduction, inverse, equality, sub-words between roles, update when an end crosses a portal | `world-objects/geodesic/portalWord.ts`, `reduceAdjacentInversePortalTraversals` in `objects.ts` |
| Development | the developing map along a word: pull a point back through inverse portal transforms | `world-objects/geodesic/development.ts` |
| Tracing (exponential map) | the straight line from a point in a direction, through portals, to a length, wall or forbidden zone | `world-objects/geodesic/trace.ts`, `cell-complex/segmentWalk.ts` |

They stay in place in this wave (listed in `onlyVia`, 12.2); a later job moves them, with the word and traversal types,
into a P15 manifold layer below `world-objects`.

The emitter (`geodesic-cannon`) stays core until the emitter module (section 16); any object with `canAttachGeodesics`
is an anchor. The model's kinds keep their declaring files in `objects.ts` and stay in the core union in this wave; the
module's `objectKinds` lists them, and they count as its kinds for composition rule 5.

`src/modules/geodesicModel/api.ts`:

```ts
export const geodesicModelToken = defineModuleToken<GeodesicModelApi, GeodesicModelQueries>("geodesicModel");

/** An arc end at a vertex: one endpoint role of an arc. */
export interface ArcEnd { readonly arcId: string; readonly role: "start" | "end" }

/** Unit tangent of an arc at a vertex, pointing away from it, in the vertex's cell frame, with the arc's chord length. */
export interface ArcTangent { readonly x: number; readonly y: number; readonly lengthMeters: number }

/** What clients and dependents receive. */
export interface GeodesicModelQueries {
  /** Both endpoint roles attached to the vertex (a loop on it contributes two). Order: registry insertion order. */
  arcsAtVertex(vertexId: string): readonly ArcEnd[];
  /** Tangents of the arcs at the vertex; with `displacedTo`, as if the vertex stood at that point of its own cell (no portal walk). undefined if an arc cannot be lifted. */
  arcTangentsAtVertex(vertexId: string, arcs: readonly ArcEnd[], displacedTo?: { readonly x: number; readonly y: number }): readonly ArcTangent[] | undefined;
  /** Total length (meters) of the distinct arcs among `arcs`. */
  lengthOfArcs(arcs: readonly ArcEnd[]): number;
  /** Both ends on emitters: a geodesic with no interior vertex. */
  connectsEmitters(arcId: string): boolean;
  /** The arc has an end on a tied vertex (replaces `motionState: "moving"` for display). A closed loop on one vertex is not tied. */
  isTied(arcId: string): boolean;
  /** Vertices with two arc ends, closed loops included. O(1). */
  tiedVertexCount(): number;
  /** Visits them in registry insertion order. No allocation. */
  forEachTiedVertex(fn: (vertexId: string) => void): void;
  /** Every arc of the curve through this vertex, walked over shared vertices. Answered by the arc index (014), as are the two above. */
  arcsOfCurve(vertexId: string): readonly string[];
  /** The arc's last rebuild failed during a carry, so it still shows its old path (13.1). */
  isStale(arcId: string): boolean;
}

/** Dependents only: the hot route M1, M2 of section 5.7. Everything else is a command. */
export interface GeodesicModelApi extends GeodesicModelQueries {
  /** Walk the vertex `lengthMeters` along `direction` (vertex cell frame) through portals; update the arcs' words; realize them. undefined if the walk or a chord fails. */
  previewVertexMove(input: { readonly vertexId: string; readonly arcs: readonly ArcEnd[]; readonly direction: { readonly x: number; readonly y: number }; readonly lengthMeters: number }): VertexMovePreview | undefined;
  commitVertexMove(preview: VertexMovePreview): void;
  /** What removing the vertex would give: a merged arc, a taut loop, a collapsed curve, or blocked. */
  previewVertexRemoval(input: { readonly vertexId: string; readonly arcs: readonly ArcEnd[] }): VertexRemovalPreview;
}

export interface VertexMovePreview {
  readonly vertexId: string;
  readonly lengthAfterMeters: number;
  /** Opaque to callers: the new vertex record and the realized arcs. */
  readonly internal: unknown;
}

export type VertexRemovalPreview =
  | { readonly kind: "merge"; readonly mergedArcId: string; readonly removedArcId: string; readonly internal: unknown }
  | { readonly kind: "loopTaut"; readonly arcId: string }
  | { readonly kind: "collapsed"; readonly arcIds: readonly string[]; readonly loop: boolean }
  | { readonly kind: "blocked"; readonly reason: "loopBlocked" | "mergeBlocked" | "anchor" | "missingArc" };

/** Detach two endpoint roles from an emitter and tie them at a new shared vertex, born at the emitter's beam point (the geometry does not change). */
export type GeodesicModelCommand =
  | {
      readonly kind: "geodesicModel/tieAndDetach";
      readonly emitterId: string;
      readonly first: GeodesicEndpointSelection;
      readonly second: GeodesicEndpointSelection;
    }
  /** Tool highlight of one endpoint's half of a geodesic (today's segment `highlightState`); transient. */
  | { readonly kind: "geodesicModel/highlightEndpoint"; readonly selection: GeodesicEndpointSelection; readonly on: boolean }
  /** moduleOnly. Recomputes the removal preview and applies it; refused with `geodesicModel/vertexBlocked` if blocked. Result `{ arcIds }`, the arcs changed or removed. Merging into an existing equal locked arc deletes both (today's findEquivalentStableInterval). */
  | { readonly kind: "geodesicModel/removeVertex"; readonly vertexId: string; readonly arcs: readonly ArcEnd[] }
  /** moduleOnly. Deletes the arcs, their segments and every vertex left with no arc. */
  | { readonly kind: "geodesicModel/removeCurve"; readonly arcIds: readonly string[] };

export type GeodesicModelEvent =
  | { readonly kind: "geodesicModel/vertexTied"; readonly vertexId: string; readonly arcIds: readonly string[] };
```

- **Command `tieAndDetach`** (`requiresTool: "geodesicModel/tie"`): today's `tieAndDetachGeodesicEndpointsNow` without
  the pair; vertex id from `ids.next("vertex")`. Success: emit `vertexTied`, result `{ vertexId }`. Refusal codes
  (today all `undefined`): `geodesicModel/sameEndpoint`, `geodesicModel/notAnEmitter`, `geodesicModel/notAttached`,
  `geodesicModel/notConnected`, `geodesicModel/rebuildFailed` (rolled back).
- **Options**: `{ tieTool: boolean }` (default `true`); without it the client part contributes no tie tool and the
  model defines no tie tool id, so `requiresTool` is dropped from the command.
- **Commands `highlightEndpoint`, `removeVertex`, `removeCurve`** (types above); the last two are `moduleOnly`. Each is atomic: on refusal nothing changes.
- **`publicApi`**: `{ tieAndDetach(emitterId, first, second) }` as `api.geodesicModel`, for scenario scripts; it submits
  the `tieAndDetach` command and resolves with the result.
- **Tie tool** (client part, `tieTool.ts`, job 54):
  - entry: an object action on the emitter kind, available when the emitter has at least two attachments on arcs that connect emitters
    (today's `canTieAndDetachGeodesicsFromCannon`); starting it goes through `world/requestTool`;
  - client tool state `{ emitterId; picks: GeodesicEndpointSelection[] }` in `moduleToolState.geodesicModel`;
  - `onPrimaryAction`: the first in-range segment pick, resolved to an endpoint (today's
    `resolveTieAndDetachEndpointFromAim`); a duplicate pick is ignored; on the second pick, submit `tieAndDetach`;
  - `onResult`: success ends the tool; a refusal shows the message and keeps the tool with no picks;
  - highlights through the `highlightEndpoint` command (agreed to stay on the segments until a client overlay exists).

The three internals named in issue 84:

| Internal | Decision |
| --- | --- |
| `replaceDerivedSegmentsFromTraces` | Stays internal, wrapped by `commitVertexMove` and the `removeVertex` command (atomic, rollback-safe). |
| `withDeferredGeodesicIntersections`, `requestGeodesicIntersectionUpdate` | Deleted (job 52): crossings become the derive tick `geodesicModel/crossings` (subscribes `geodesicModel/segment`, writes `geodesicModel/crossing`), once per derive pass. Removed markers are journal `Removed` entries, which the angle tick reads. |

The new operations go into `src/world-objects/geodesic/vertices.ts`, **moved** out of `curveShortening.ts`:
`arcsAtVertex` from `incidentArcEnds`; `arcTangentsAtVertex` from `tangentAwayFromVertex`; `lengthOfArcs` from
`totalLengthOfArcs`; `previewVertexMove` from `tryMoveVertex` and `withVertexCrossings`; `commitVertexMove` without the
pair update; `previewVertexRemoval` and the `removeVertex` command from the geometric part of `mergeVertexOrFail` and
`findEquivalentStableInterval`; `tieAtNewVertex` from `tieAndDetachGeodesicEndpointsNow` without the pair.

**End nodes and interior vertices.** **Agreed** (maintainer, 2026-11-03): a curve's end nodes are the arc ends on an
emitter; its interior vertices are `geodesicModel/vertex` objects shared by two or more arc ends. The emitter drags the
end node; the flow never acts on one. Neither behaviour knows about the other: carrying changes an end node, the flow
changes interior vertices, and each works from the arcs as they stand. Without the flow, a dragged tied curve stays
frozen at its vertex. The failure rules below are **Agreed** too (2026-11-03).

An arc **follows its emitter** when it has an end on that emitter and connects emitters, or when its other end is a shared
vertex (a tied arc). New predicate `arcFollowsEmitter` in `lifecycle.ts`. Today's code stops at "locked"
(`arcConnectsEmitters` after job 51) in four places, and each becomes `arcFollowsEmitter`:

| Place | Today | After |
| --- | --- | --- |
| `removeUnlockedGeodesicsFromCannon` | deletes every unlocked arc on lift | deletes only an arc that does not follow: a plain shot geodesic with an unshared free end, as today |
| `moveEmitterAlongRoute` (`cannon.ts`) | updates the words of locked arcs | also tied arcs, so a portal crossing keeps the class; a word that cannot follow still refuses the move |
| `rebuildEmitterGeodesics` (`carryEnd.ts`) | rebuilds locked arcs; can regrow a tied arc | rebuilds following arcs with their words; never regrows a tied arc |
| `rebuildConnectedGeodesicBetweenEmittersNow` | returns early unless locked | proceeds for following arcs |

Tying, aim, rotate and the deformation policy keep `arcConnectsEmitters`: a curve that has merged connects emitters again,
and a curve still shortening at a geometry commit is deleted, as today.

Failures while dragging:

- **Chord hits a forbidden zone:** a locked arc is deleted, as today. A tied arc takes its **whole curve** with it, because
  deleting one arc would leave a dangling half (the same removal as `removeCurve`; in line with the decision of
  2026-11-02).
- **Any other failed rebuild during the carry:** the arc keeps its old path, as today (`preserveGeodesicOnRebuildFailure`),
  and is marked with the transient field `stale: true`; the next successful rebuild clears it. At release, a failed rebuild
  of a tied arc removes the whole curve.
- **The flow and a stale arc:** a stale arc would make `previewVertexMove` fail, and the flow would read that as blocked
  and destroy the curve over a momentary failure. So the flow skips a vertex with a
  stale incident arc for that step (`isStale`). It knows nothing of carrying.

The guard on the flow's side: `previewVertexMove` and `previewVertexRemoval` refuse an id that is not a
`geodesicModel/vertex` (undefined and `blocked`), so no flow, present or replacement, can move an end node.

### 13.2 `curveShortening`

The curve shortening flow on curves with tied vertices: the gradient flow of length, exact line search. No tool, no
command, no object kind: it acts on the vertices the model has tied. A curve has no lifecycle (**Agreed**, 2026-11-03):
nothing starts, finishes or locks. The flow applies one rule each step, and it stops because nothing is left to act on.

**The rule, for each tied vertex** in `forEachTiedVertex` order (Gauss-Seidel, as today). With `u1`, `u2` the unit tangents
of its two arc ends, pointing away from it:

1. A vertex with a stale incident arc (13.1) is skipped for this step.
2. **At rest**, `|u1 + u2| < curveShorteningTautTurnRadians`: it **always merges** (**Agreed**): dispatch
   `geodesicModel/removeVertex`. A taut closed loop on one vertex has nothing to merge with (preview `loopTaut`): its vertex
   stays, as a base point, and goes quiet.
3. Otherwise it moves along `u1 + u2`: `previewVertexMove` and `commitVertexMove`, step from the speed law, capped by the
   line search.
4. A vertex that cannot move tries the merge, as today (the corner cut of `mergeVertexOrFail`). If that is refused, its whole
   curve is destroyed (`arcsOfCurve`, then dispatched `geodesicModel/removeCurve`), and `curveShortening/destroyed` carries the vertex and the reason.

A curve has merged every vertex when it is one arc between emitters. Motion, tolerances, step halving and merging are
today's code, moved. The one timing change: the first flow step is in the step that applied the tie, not the next.

**What merging costs.** A merged arc can no longer bend there: while a neighbouring vertex
moves it stays one chord, and a dragged curve is rigid once merged. That is accepted for the simplest algorithm. Inserting
vertices (below) restores the bend. In the app each tie makes one vertex, so a flow has no neighbour today.

**Quiet vertices.** The flow keeps a private memo `quiet` of vertices with nothing to do: taut closed loops. A derive tick `curveShortening/wake` (`subscribes: ["geodesicModel/arc"]`) removes from `quiet` every vertex whose
arc changed, so a dragged loop acts again. `quiet` is a memo, not world state (014 section 9): it empties
through the `wake` tick alone, because a geometry commit deletes every arc that does not connect emitters and the tick sees
those removals, and a load makes a new engine.

- Requires `geodesicModelToken`; provides `curveDynamicsToken` (so a stick-at-corner module can replace it).
- Options `{ speedLaw: "constant" }`.

```ts
export const curveDynamicsToken = defineModuleToken<CurveDynamicsApi, CurveDynamicsApi>("curveDynamics");

export interface CurveDynamicsApi {
  /** True when every tied vertex is quiet. */
  isAtRest(): boolean;
}

/** policies.ts. Metres this vertex may move this step, before the line search caps it. */
export type SpeedLaw = (input: { readonly tangentSum: { readonly x: number; readonly y: number }; readonly deltaSeconds: number }) => number;

export type CurveShorteningEvent =
  | { readonly kind: "curveShortening/freeLoopCollapsed"; readonly arcId: string; readonly message: string }
  | { readonly kind: "curveShortening/collapsed"; readonly arcIds: readonly string[]; readonly message: string }
  | { readonly kind: "curveShortening/destroyed"; readonly vertexId: string; readonly reason: string; readonly arcIds: readonly string[]; readonly message: string };
```

The shell's generic event sink logs every event with a `message` to the console and `runtimeDiagnostics().recordDebugEvent`.

- **Tick `curveShortening/step`** (simulate): `writes: []` (the model writes); `isIdle` is
  `tiedVertexCount() === quiet.size`, no allocation.
- **`speedLaw: "constant"`** returns `curveShorteningSpeedMetersPerSecond * min(deltaSeconds, maxCurveShorteningDeltaSeconds)`,
  today's step budget.
- **`publicApi`**: `{ isAtRest() }` as `api.curveShortening`.

**Built for extension** (**Agreed**: a later algorithm takes tension into account and creates intermediate vertices):

- **Tension** is a new `SpeedLaw` (for example proportional to `|u1 + u2|`). The line search stays as the cap, so no other
  code changes. Only `"constant"` is built now.
- **Intermediate vertices.** "The vertex count never grows" is a property of this algorithm, not of the model, and must not
  appear in `geodesicModel/api.ts`. The model's invariant is only that a tied vertex has two arc ends. Nothing may assume one
  vertex per curve: the tick visits every tied vertex, and `arcsOfCurve` walks any chain. A later job adds the command
  `geodesicModel/insertVertex` and a `refinement` option. Nothing of either is built now.

## 14. Migration: legacy direct writes

The shell's render-side tools write the world directly today (section 2). Moving all of them behind commands at once is
too large. Rule for the wave:

- New behaviour reaches the world only by the routes of section 5.7.
- Existing direct writers are listed in `legacyWorldWriters` (12.2) and may stay until their module job; the list only
  shrinks.
- Direct writes still go through the registry, so the journal sees them and derived state stays correct.
- Legacy menu actions that act on the world (`start-cannon-*`, `delete-geodesic-from-cannon` effects) are converted
  when their module is built.

## 15. Jobs

**Done** (merged 2026-11-05), kept as history: the job files in `.agents/jobs/_done/` and the batch reports in
`.agents/jobs/_reports/` say what was built. Job 51 failed once and returned on design 014, with jobs 56 to 60 before job 52.
Not done from these lists: the release scenarios of jobs 50, 53 and 54, which wait for `publicApi` (section 16).

Numbered after the last job (47). Each leaves typecheck, tests, smoke and `docs:check` green, and runs
`npm run bench -- moduleStep --check` in its "Done when". The job files are `.agents/jobs/48_...` to `55_...`; the summaries below
are their specification.

### Job 48: baseline, change journal, layers and rules

1. **Baseline first, before any other change.** `scripts/bench/moduleStep.bench.ts`, three scenes from
   `tests/fixtures/world-objects/geodesic.ts`:
   - **idle**: `createTorusLoopBenchmarkScene` plus four measured lengths and two protractor angles, no flow;
   - **flow**: `createTorusTiedPairScenario`, stepped with `dt = 1/90` until no pair is left or 600 steps;
   - **flow+dependents**: the flow scene plus a measured length and a protractor angle on the tied geodesics.

   A "legacy driver" reproduces today's objects-phase sequence with world-objects functions:
   `advanceCurveShorteningPairs`, then `refreshMeasuredGeodesicLengthObject` and `refreshProtractorAngleObject` for the
   returned ids, then `pruneMissingGeodesicIntersectionObjects`. It reports the median step time (7 trials) per scene
   and bytes allocated per step on **idle** (20,000 steps, `heapUsed` delta after `gc()`).
   `scripts/bench/run.mjs` passes `--expose-gc` (`NODE_OPTIONS`), which also fixes `frameAllocations`. `--record`
   writes `scripts/bench/baselines/moduleStep.json` with the host name; `--check` exits 1 when **idle** or
   **flow+dependents** exceed baseline × 1.05 + 2 µs, **flow** exceeds baseline × 1.10, or **idle** allocates more than
   16 bytes per step; on another host it warns and exits 0. Record and commit the baseline.
2. The change journal (6.2) and `countOfKind`; tests for order, kinds, clear and no growth after warm-up.
3. `RuntimeObjectReader` (6.1).
4. `docs:check`: the layers and rules of 12.2 (with `legacyWorldWriters` filled from today's code), with tests; the
   amended docs of 12.3.

### Job 49: the world engine and the client session

1. `src/engine/` (sections 5, 6, 9): `createWorldEngine`, participants with the participant journal, control slots
   (no slots yet), ids, the command queue and results, the step order of 5.2 (phases 3 and 7 empty hooks for now),
   events, `endFrame`, `composeModules` with an empty list, the derive pass, the write guard, `world/requestTool` with
   the configuration gate and revocation. Tests: every composition error of 9.2; topological order; derive wake rules
   and cursors; command results, refusal, zero-second steps; `endFrame` resets; tool request accepted and refused.
2. **The split** (section 4): `appSession.ts` becomes `clientSession.ts` (`ClientSessionState`), losing `playerPose`
   and `objectIdSerials`. The local player becomes participant `"local"`; the shell's movement code publishes the pose
   with `publishBody`; everything that read `session.get().playerPose` reads `engine.read.participant("local")`.
   Engine ids replace `objectIdSerials` (`takeObjectIdSerial` callers use `engine` ids).
3. The shell creates the engine, submits nothing yet, calls `engine.step(dt)` after the creature loop and
   `engine.endFrame()` at the end of the frame; `api.world` (`submit`, `participants`); `moduleToolState` in the
   client session with `set-module-tool-state`; the generic event sink.
4. Tool selection goes through `world/requestTool`: selecting a tool in the palette or VR submits the request and
   switches on `ok`; a refusal shows the message. Test with a config that disables a tool.
5. Switch the bench's **idle** scene to "legacy sequence plus an empty engine step"; `--check` passes (the cost of the
   bare engine).
6. The realtime view (section 6.5): tests that `engine.read.objects.get(id)` returns the very record the registry holds
   (`toBe`, not a copy), and that a body pose published before `engine.step` is what `engine.read.participant("local")`
   returns after it, in the same frame.
7. The access rule (section 5.7): `publishBody` refused for a non-owner; the write guard fails a write made during a
   `queries` call; `engine.query` returns `queries`, not `api` (test with a fake module exposing both); `dispatch` returns the result
   synchronously and its writes are in the journal for the same step; a client submitting a `moduleOnly` command is
   refused with `world/moduleOnly`; dispatching a command of a module not in `requires`, and nesting past 8, throw.

### Job 50: carry as a world attachment

1. The `carry` module (section 7): commands `carry/attach`, `carry/detach`; slot `carry/offset`; refusal
   `carry/alreadyCarried`, `carry/notCarriable`, `carry/outOfReach`; the move in step phase 3 by the job-47 contract;
   `carry/dropped` events.
2. `CarryRecord` leaves the client session; `arrived` becomes a field of the attachment.
3. The carry tool submits attach and detach and sets the offset slot each frame; the carried-emitter geodesic rebuild
   keeps working (`rebuildConnectedGeodesicBetweenEmitters` runs from the carry move).
4. Tests: attach, second attach by another participant refused, detach, junction drop event; the existing carry tests
   unchanged; the release-tier scenario of carrying through a portal.

### Job 51: the `geodesicModel` module and its renames

1. **First commit: renames** (section 10): the four kinds, their types, constructors and guards, id families,
   `_docs/MATHEMATICAL_MODEL.md` and the header of `objects.ts`. Done when
   `grep -rn "geodesic-interval\|free-geodesic-end\|\"geodesic-segment\"\|geodesic-intersection" src tests` is empty.
2. `world-objects/geodesic/vertices.ts` (13.1, moved out of `curveShortening.ts`); `curveShortening.ts` rewritten on
   them; behaviour identical, the curve-shortening tests unchanged and green.
3. Delete `motionState`: `isTied` replaces it for display (`segments.ts:301`); `isAimableFreeGeodesic` drops its check,
   since its unshared free end already excludes tied arcs. A kinked closed loop now shows as open, not moving. Rename
   `isGeodesicLocked` to `arcConnectsEmitters` and `collectLockedIncidentGeodesicIdsForEmitter` to match; a merged arc that
   connects emitters takes the place of `"stable"` in `findEquivalentStableInterval`. Done when
   `grep -rn "motionState\|isGeodesicLocked" src tests` is empty.
4. End nodes (13.1): `arcFollowsEmitter`, the four places of its table, whole-curve removal, the `stale` field and
   `isStale`; this also fixes `carryEnd.ts:45-88`, which can regrow a tied arc. Tests on a tied curve: lifting its
   emitter keeps it; carrying moves the end node and keeps each arc's class, through a portal too; a chord into a
   forbidden zone removes the whole curve; a plain shot geodesic is still deleted on lift.
5. `src/modules/geodesicModel/` (`api.ts`, `module.ts`, `index.ts`) over world-objects; in the experience. The naming
   check of section 10 in `docs:check`.
6. Contract test `tests/modules/geodesicModel.contract.test.ts`: moving a vertex keeps each arc's class (the word
   changes exactly by the crossings); length after equals `lengthAfterMeters`; a failed preview changes nothing
   (registry version unchanged); tie then removal round-trips the geometry within tolerance; a taut loop keeps its vertex
   (preview `loopTaut`); a collapsed merge deletes the curve and its vertex; every `queries` function leaves the
   registry version unchanged; `removeVertex` on a blocked vertex is refused and changes nothing.


### Job 52: derived state through the journal

1. Derive tick `geodesicModel/crossings`; delete `requestGeodesicIntersectionUpdate`, `withDeferredGeodesicIntersections`
   and their ~40 call sites; tests that read markers right after a mutation use a helper `runDerivePass(engine)` in
   `tests/support/`.
2. The `geodesicMeasurements` module: kinds renamed `geodesicMeasurements/length` and `geodesicMeasurements/angle`;
   tick `lengths` (subscribes arcs and segments; `wants` = the local participant's cell or position changed, today's
   `measuredLengthsRefreshed` guard); tick `angles` (subscribes arcs and crossings; removes angles whose centre marker
   was removed; writes an angle only when it changed). Both use the pure world-objects refreshers.
3. The render label runtimes sync from the journal. Deleted: `createThreeApp.ts:1261-1284`; the refresh calls in
   `geodesicCannonTools.ts` (five sites); the refresh half of `worldGeometryComputedObjects.ts` (the deformation then
   runs `transformGeometry` and one derive pass, step phase 7); `requestSelectableHitboxDebugSync` after geodesic edits.
4. Done when `grep -n "refreshProtractorAngles\|refreshMeasuredGeodesicLengths" src/render src/runtime` shows only the
   label runtime sync, and the bench check passes.

### Job 53: the `curveShortening` module

1. Move the flow into `src/modules/curveShortening/` (13.2); delete `world-objects/geodesic/curveShortening.ts`; its test
   moves to `tests/modules/curveShortening/` and drives the engine; notices become events with the same messages.
   **Assertions on motion, lengths, merging and notices do not change.** Assertions on the pair object become assertions on
   the curve (`isAtRest`, `blockedVertices`, the vertices left); record each one under `### Deviations`.
2. Delete the kind: `curve-shortening-pair`, `CurveShorteningPairObject`, its `state` and `vertexIds`. Done when
   `grep -rn "curve-shortening-pair\|CurveShorteningPairObject" src tests` is empty.
3. The rule of 13.2 over `forEachTiedVertex`, `quiet` with the `wake` tick, `speedLaw: "constant"` in `policies.ts`.
4. The model's command `tieAndDetach` and event `vertexTied`. Delete the shell's "curve shortening" phase.
   `geodesicCannonTools.ts` submits `geodesicModel/tieAndDetach` instead of calling the function.
5. Tests: each tie refusal returns its code and changes nothing; the flow alone against a scripted fake of
   `GeodesicModelApi` and of `dispatch` (a vertex at rest merges, a blocked one goes quiet and `unresolved` fires once, a stale
   arc is skipped for that step, not blocked); a taut closed loop goes quiet, and `isIdle` is true; dragging its arc wakes it;
   over many flow steps with no carry, every emitter's pose and cell are unchanged; carrying an emitter while its curve
   flows moves the end node and the curve still merges; a curve with five vertices flows (the existing test); an
   experience **without** the flow keeps a tied curve as tied over many steps (frozen curves).
6. Release-tier scenario: `api.geodesicModel.tieAndDetach(...)` on a torus world, then `api.waitFor` until
   `api.curveShortening.isAtRest()`.
7. Update `_docs/MATHEMATICAL_MODEL.md` section 7: no pair, no stable state; the rule of 13.2.

### Job 54: tools from modules

1. `ToolDescriptor`, `ToolContext`, `AimPick`, `ModuleClient` (8.3, 9.1); tool ids by interface merging.
2. One descriptor per existing tool (core tools registered by the shell); every place listed in 8.3 reads `toolsById`.
   The tie tool id renamed `geodesicModel/tie`. Done when `grep -rn "geodesic-cannon-tie-detach" src tests` is empty and
   the frame dispatch chain at `createThreeApp.ts:1184-1221` is one lookup.
3. The tie tool moves to `src/modules/geodesicModel/tieTool.ts`; its picks move from `cannonToolState` to
   `moduleToolState.geodesicModel`; `tieAndDetachEndpointSelections` is deleted.
4. **The tool-level test job 33 lacked**, `tests/modules/geodesicModel/tieTool.test.ts`, with a fake `ToolContext`
   whose `pickTargets` returns scripted picks on a real engine: two picks of roles on connecting arcs tie, and the curve then shortens; a
   duplicate pick is ignored; another emitter's geodesic is refused; an out-of-range pick is refused; a world refusal
   is shown and keeps the tool; success ends the tool and clears its state; ending after one pick clears the highlight.
5. An experience with `geodesicModel({ tieTool: false })` has no tie tool and no emitter-page action, while
   `api.geodesicModel.tieAndDetach` still works.

### Job 55: the "destroy" policy

1. `onBlocked: "destroy"`: a vertex blocked at a forbidden-zone disk removes the curve (`arcsOfCurve`, then dispatched `geodesicModel/removeCurve`) and emits
   `curveShortening/destroyed` with a message.
2. It becomes the default experience's setting (decision of 2026-11-02); `"unresolve"` stays available.
3. Tests: the same blocked scenario under both policies; a manual check in the app (tie two geodesics around a corner;
   the geodesic vanishes; the notice appears in the console).

## 16. After this wave

**Next batch** (agreed 2026-11-05; jobs to be written):

- **time** (012 P8): ticks of length \(h\), an accumulator in the shell, no caps on the flow;
- **`geodesicEmitters`**: the emitter kind (`geodesicEmitters/emitter`), place, shoot, aim, rotate and carry as commands, rotate and
  aim as edit attachments with slots, and a free geodesic's intended length as real state on its arc. Closes issues 88, 89 and 93, and
  ends the carry module's `writesCoreKinds`;
- **`publicApi`** on modules, then job 45 rewritten: emitters can be created through the API, so manual checks become release
  scenarios;
- **measurement tools** and **flags** as modules.

Then, in a likely order:

- **deformation commit inside the step** (phase 7; 012 P8, P9), with job 30;
- **creatures** (simulate ticks replacing `dynamicObjectRuntimes`);
- **locomotion into the engine**: movement control slots (`world/moveIntent`, `world/look`; 012 P1), step phase 3,
  locomotion models (P16); the shell stops moving the body;
- **a more physical curve shortening** (13.2): `speedLaw: "tension"`, then intermediate vertices (`geodesicModel/insertVertex`,
  `refinement`), which also gives merged curves their bends back; a better answer than destroying a blocked curve;
- the geometry tools moved into a P15 manifold layer; `world-objects/geodesic/` under `src/modules/geodesicModel/`;
- **the P7 prototype**: the engine in a worker on a Quest, fed by the journals, measured against the main thread;
- the static cull as an optional accelerator module (012 section 6);
- the tie highlight as a client overlay;
- the corner's glow while a free geodesic is stopped there.

## 17. Open questions

1. Closed: the geometry tools are core layers imported directly, not modules (13.1).
2. Closed: lifting an emitter keeps a tied curve; the emitter drags its end node and the flow never acts on an end node
   (13.1).
3. Closed: in VR, as on desktop, the client does not switch tool until the world confirms. To be measured when a network exists.
4. Closed: section 16 keeps its order. Reordered on 2026-11-05 (maintainer): the emitters come first.
5. **Messages, bubbling and a message bus: deferred to a later design** (maintainer, 2026-11-03); not in this wave, and no
   job depends on them. The notes below are input for that design. The design has commands (one
   handler, before the fact, may refuse) and events (broadcast, after the fact). A message would be addressed to an
   object, handled according to what the object is, and passed up to a container if unhandled or not stopped. 012 P3
   already has the first half: carrying is a stream of displacement messages and the object decides how it reacts.
   Possible uses: a click on a segment reaching its arc, a dependent module intercepting a removal. To settle first:
   - **There is no containment tree.** `geodesicId` takes a segment to one arc, but an arc has two anchors, a crossing
     two geodesics, and a curve is not an object. Each kind would have to declare one parent, or bubbling needs a
     different meaning.
   - **Control flow is harder to follow**: who handled a message depends on data, not on the command's name.
   - **Client or world?** Bubbling a pick to its owner can be a client matter; intercepting a removal is world behaviour.

   Displacement messages (job 50) will be the first real case. A message can be added beside
   `submit` and `dispatch` without changing them.

6. **Open: an angle at a crossing that vanishes.** A protractor angle centred on the crossing of two geodesics is deleted when the crossing
   disappears, even for a moment (job 52 changed this). The code that hides it until the crossing returns remains, reached only by a
   test (`getRememberedGeodesicIntersectionObject`). Which is meant, hide or delete? In the spirit of the corner rule of 2026-11-05, hiding
   is the likely answer, but it is not decided.

## 18. Specified, not built

Removed on 2026-11-05 (maintainer) because nothing used them. Each is small to rebuild when a planned item needs it; the code as it stood
is at commit 41f3606.

| Item | What it was for | What would bring it back |
| --- | --- | --- |
| Module tool gates (`toolGates`) | a module refusing a tool: "You have not found a protractor yet." | the first experience with found tools or roles; the configuration gate and `requiresTool` stay |
| Revocation (`capabilitiesChanged`, `world/toolRevoked`) | a tool taken away while a client holds it: the teacher disables it | the same; a client with the tool selected leaves it and shows the message |
| `onEvents` | a module reacting to another module's events in the derive pass. As built it lost events emitted after a module's slot | a real consumer; deliver from a cursor that survives `endFrame` |
| Participant journal (`participantChanges`) | clients following participant changes | presence, in multiplayer |
| `deviceId` option | a device serving a participant it does not own | multiplayer; the `publishBody` owner check stays, against `localDeviceId` |
| `ctx.stepIndex`, create-context `ids` | a tick reading the step count; minting ids at creation | a tick that needs them; with a varying \(h\), a step count is not time |

## Decision log

| Date | Change |
| --- | --- |
| 2026-11-03 | Document created for issue 84 as the module system. Agreed: piecewise-geodesic geometry and the flow as separate modules, the flow depending on the geometry; flow migrated unchanged, "destroy" later as a policy; performance by a bench `--check` in job acceptance; ordering by phases, dependencies, list order. Recorded: `free-geodesic-end` and `motionState` are core geometry (issue 84 corrected). |
| 2026-11-03 | Agreed: the first module is a geodesic model built on geometry tools such as homotopy; tying belongs to the model; the flow claims tied vertices by event. The tie highlight stays in the registry for now. |
| 2026-11-03 | Agreed: the naming rule `<moduleId>/<noun>`, renaming inside the jobs, types renamed with their strings. |
| 2026-11-03 | Agreed (maintainer): the world/client split and the module system are one design; this document becomes its core ("World engine, clients and modules"). World state is distinct from client state; the menu and the selected tool are client state, tools send commands; lasting relations (carry) are world state (revises 012 P3 of 2026-11-01 for the carry record). A confirmation protocol: the client asks before switching tool, the world may refuse. The engine runs on the main thread, worker-ready; the P7 prototype comes later. Jobs renumbered 48 to 55. |
| 2026-11-03 | Maintainer's point: clients need a realtime view of the state to render efficiently, not only commands. Section 6.5 now states it: `engine.read` by reference, the channel for each need, the frame order; job 49 tests it. Proposed: the same synchronous `read` over a replica for a worker or a network. |
| 2026-11-03 | Agreed (maintainer): behaviour and interaction go through commands unless particularly hot; direct access is strictly specified. Section 5.7 added. Proposed: the order command, slot, listed direct write; the list (only `publishBody`); module `api` split from client `queries`, closing a route by which `engine.query` gave clients operations; `publicApi` reads or submits only; the tie highlight becomes a command. |
| 2026-11-03 | Agreed (maintainer): commands are the preferred interaction between modules too. Proposed: synchronous `ctx.dispatch` inside a step, `moduleOnly` handlers, `setDriver`, `removeVertex` and `removeCurve` as commands, `api` reduced to the hot list M1 and M2. Open: messages and bubbling (section 17). |
| 2026-11-03 | Agreed (maintainer): bubbling and a message bus are for a later design, outside this wave. |
| 2026-11-03 | Agreed (maintainer): the geometry tools are core layers imported directly, not modules. |
| 2026-11-03 | Agreed (maintainer): carrying an emitter drags the end node of a tied curve, and the flow never acts on an end node; the two are independent. Replaces job 51's "skip driven arcs". Proposed: `arcFollowsEmitter`, whole-curve removal, the `stale` field. |
| 2026-11-03 | Agreed (maintainer): no final locked state; the flow stops by a natural condition; a vertex at rest always merges; the simplest algorithm now, extensible to tension and intermediate vertices. Replaces `drivenBy`, `setDriver`, the flow object, claiming and the `started` and `finished` events. Proposed: `quiet`, `SpeedLaw`, the rename to `arcConnectsEmitters`. |
| 2026-11-03 | Agreed (maintainer): no tool switch until confirmed, in VR too; section 16 keeps its order; a chord into a forbidden zone removes the whole tied curve; the `stale` skip; plain shot geodesics are still deleted on lift. Job files 48 to 55 written. |
| 2026-11-05 | Jobs 48 to 60 merged. Text aligned with the code and with 014's section 9 amendments (ring, cursors, `quiet` as a memo, no `reset` or `transformGeometry`). Status of Proposed items unchanged. |
| 2026-11-05 | Agreed (maintainer): `unresolve` deleted; the unused engine hooks deleted and listed in section 18; a free geodesic stops at a corner, remembers its length and extends when clear (issue 93); a corner glow later. |
| 2026-11-05 | Agreed (maintainer): a blocked curve is destroyed for any reason, for now; time as in 012 P8 with \(h = 1/90\) s by default and at most \(1/30\) s; read tracking on by default for measurements; section 16 reordered, the emitters first. |
