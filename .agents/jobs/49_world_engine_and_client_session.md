# Job 49 - Build the world engine and split the client session from it

Status: done, needs review on 2026-11-03.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 1, 2, 3, 5).

## Goal

The world has an engine and the shell becomes a client of it. The engine holds participants, ids, commands, control slots,
events and the step order, with an empty module list. The shell session keeps only client state. Selecting a tool asks the
world first, and the world may refuse.

## Depends on

Job 48.

## Before you start

- Own worktree and branch (`git worktree add ../noneuclid-job49 -b job-49 <branch with job 48>`).
- Read design 013: sections 3 to 6, 8.1, 8.2, 9, and job 49 in section 15.
- Call `know_search` for "createThreeApp factories" and read it: the shell's factories are `const`s built in order, and
  using one before its line is a runtime error `tsc` does not report. Pass early needs as `() => handle.x()` wrappers.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

`src/runtime/appSession.ts` mixes client state (menu, selected tool) with world state (`playerPose`, `carry`,
`objectIdSerials`). `createThreeApp.ts` moves the player and runs the frame.

## Decisions

- The engine runs on the main thread. Everything crossing `WorldEngine` is plain data (6.6).
- `engine.read` hands out the engine's own records by reference: no copy, no message (6.5).
- The order in a frame (6.5): sample input, `submit`, `setControl`, `publishBody`; `engine.step(dt)`; render; label runtimes
  and UI read; `engine.endFrame()`.
- `publishBody` is the only direct client write (D1, 5.7). It is refused for a non-owner.
- `engine.query` and `ToolContext.query` return a module's `queries`, never its `api`. Only `ModuleCreateContext.require`
  returns `api`.
- `ctx.dispatch` runs a handler now, inside the step, with actor `"world"`, and returns the `CommandResult`. `requiresTool`
  is not checked. Nesting deeper than 8 throws. A module may dispatch only its own commands and those of the modules in
  its `requires`. Dispatched commands are not recorded for replay.
- A handler marked `moduleOnly` is refused to clients with `world/moduleOnly`.
- The write guard is on in tests and when the debug setting enables it (9.6). Writes during `dispatch` or a dependency's
  `api` count as the providing module's.
- **VR tool switch: no switch until the world confirms** (agreed, section 17). The client stays on the old tool while the
  request is pending.
- `carry` stays in the client session until job 50.
- Phases 3 and 7 of the step are empty hooks in this job.

## Steps

1. `src/engine/` per 12.1: `createWorldEngine`, participants and the participant journal, control slots (none yet), ids,
   the command queue and results, the step order of 5.2, events, `endFrame`, `composeModules` with an empty list, the
   derive pass, `dispatch`, the write guard, `world/requestTool` with the configuration gate and revocation. Test each as
   it lands.
2. The split (section 4): `appSession.ts` becomes `clientSession.ts` (`ClientSessionState`), without `playerPose` and
   `objectIdSerials`. The local player is participant `"local"`. The shell's movement code calls `publishBody`. Everything
   that read `session.get().playerPose` reads `engine.read.participant("local")`. `takeObjectIdSerial` callers use engine ids.
3. The shell creates the engine, calls `engine.step(dt)` after the creature loop and `engine.endFrame()` at the end of the
   frame. This `endFrame` replaces job 48's end-of-frame journal clear. Add `api.world` (`submit`, `participants`),
   `moduleToolState` with `set-module-tool-state`, and the generic event sink.
4. Tool selection in the palette and in VR submits `world/requestTool` and switches on `ok`; a refusal shows the message.
5. Switch the bench's **idle** scene to "legacy sequence plus an empty engine step".

## Tests and checks

- Every composition error of 9.2; topological order; derive wake rules and cursors.
- Command results, refusal, zero-second steps; `endFrame` resets journals, events and results.
- Tool request accepted and refused; a configuration that disables a tool.
- The realtime view: `engine.read.objects.get(id)` is the very record the registry holds (`toBe`); a body published before
  `engine.step` is what `engine.read.participant("local")` returns after it, in the same frame.
- The access rule: `publishBody` refused for a non-owner; the write guard fails a write made during a `queries` call;
  `engine.query` returns `queries`, not `api` (fake module exposing both); `dispatch` returns synchronously and its writes
  are in the journal for the same step; a client's `moduleOnly` command is refused; dispatching outside `requires` and
  nesting past 8 throw.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not move locomotion into the engine: the shell keeps moving the body until after this wave.
- Do not record the selected tool in the world (rejected, section 8).
- Do not re-record the bench baseline.

## Done when

- `grep -rn "playerPose\|objectIdSerials" src/runtime src/render` finds no session field.
- A disabled tool is refused with its message in the app and in tests.
- All checks above are green.

## Report

### Done
- `src/engine/` (commit 9bb697b): `moduleTypes.ts` (section 9.1 types, `WorldEngine`, `WorldRequestToolCommand`, `WorldToolRevokedEvent`), `worldEngine.ts` (`createWorldEngine`, `readLocalPlayerPose`, `publishLocalPlayerPose`), `composeModules.ts` (all twelve rules of 9.2, topological order, one `ModuleCompositionError` listing every problem), `moduleTicks.ts` (simulate and derive passes, cursors, `wants`/`subscribes` wake rules, `onEvents`), `participants.ts` (participant table, participant journal, control slots), `toolGates.ts` (configuration gate, module gates, revocation), `ids.ts`, `writeGuard.ts` (frame stack, guarded registry, `queries` and `api` frames), `coreIds.ts` (typed tables of core kinds and tool ids).
- The split (commit b3c83d2): `appSession.ts` is now `clientSession.ts` (`ClientSessionState`, `ClientSession`, `createClientSession`); it lost `playerPose`, `objectIdSerials`, `ObjectIdFamily`, `takeObjectIdSerial`, and gained `moduleToolState` and `pendingToolRequest`. Commands `set-player-pose` removed; `set-module-tool-state` and `set-pending-tool-request` added. The shell creates the engine right after the session, reads the pose with `readLocalPlayerPose(engine)`, writes it with `publishLocalPlayerPose` (D1), takes ids from `engine.ids`, calls `engine.step` after the creature loop (own error-guarded phase) and `engine.endFrame()` at the end of `renderFrame` (replacing job 48's journal clear). New `src/render/three/worldClient.ts`: the tool-request protocol (`requestTool`, settle after the step, message on refusal, revoked tool ends the selected tool), the generic event sink (every event with a `message` goes to the console and `recordDebugEvent`), and `api.world` (`submit`, `participants`). The palette (desktop and VR share it) asks `world/requestTool` instead of dispatching `select-tool`. Debug option `module-write-guard` switches the write guard on in the app.
- Bench: the idle scene now runs the legacy sequence plus `engine.step` and `engine.endFrame` on an empty-module engine. Baseline file untouched.
- Tests added: `tests/engine/composeModules.test.ts` (16), `tests/engine/worldEngine.test.ts` (26), `tests/render/worldClient.test.ts` (6), `tests/app/worldEngine.release.test.ts` (1), `tests/support/engine.ts` (shared fake). Docs: `_docs/ARCHITECTURE.md` updated, generated references regenerated.

### Deviations
- `publishBody(participantId, body)` has no caller parameter and returns a boolean. Ownership is the engine's `deviceId` option: the engine publishes only for participants whose `ownerId` equals its device (default `"local-device"`), and returns `false` for any other. The design left "the owner" unspecified.
- Interfaces beyond 5.1: `WorldEngine.ids` (legacy writers still create objects and need ids), `WorldReadView.participants()`. `ParticipantRecord` is `{ id, kind, ownerId, body }`; `attachments` and `capabilities` are not there yet (no user). `ModuleInstance` has no `publicApi`, `transformGeometry` or `reset`, and `ModuleDefinition` no hook for them: nothing uses them until later jobs, and the repository rule is to delete unreachable code.
- Object ids no longer contain `Date.now()`: they are `<family>:<serial>` from the engine (a taken id is skipped). The families keep their old names (`placed-flag`, `geodesic`, `geodesic-cannon`, `curve-shortening`, `free-end`, ...).
- Existing tests changed: `tests/runtime/applyRuntimeCommand.test.ts` (the `set-player-pose` and serial-number tests are replaced by tests for `set-module-tool-state` and `set-pending-tool-request`; ids are tested in the engine tests), `tests/render/scenePaletteCommands.test.ts` (a tool selection is now a tool request, not a `select-tool` dispatch), `tests/render/runtimeObjectActions.test.ts` (reset and teleport are asserted on the engine's pose instead of a `set-player-pose` command), `tests/render/geometryCommit.test.ts` (the pose is read from and published to an engine; the deps lost `session` and `dispatch`). All other render tests only pass an engine from `createTestEngine` where the pose used to come from the session; `createTestAppSession` is now `createTestClientSession` (`tests/support/clientSession.ts`).
- `GeometryCommitDeps` lost `session` and `dispatch` (nothing else used them).

- Review round: `WorldReadView` has no `geometryVersion` (design 5.1/6.1); the engine does not track it yet. Phases 3 and 7 of the step are only mentioned in the header comment of `worldEngine.ts`, not hooks in code. The debug option is `module-write-guard` (design: `moduleWriteGuard`), following the kebab-case of the other options. `WorldEngine.ids` and `forEachEvent` are function members beyond the design's list.
- Review round fix: `createPairId` and `createFreeEndId` use the families `curve-shortening` and `free-end` again (my first edit had collapsed them into `geodesic`), so the `includes("free-end")` fallback in `intervals.ts` is live again; no other consumer matches id text of these families. The teleport test again checks that the menu is cancelled before the pose is published.

### Uncertain
- The refusal message is shown by the shell's message hook, which today logs to the console and `runtimeDiagnostics`; there is no on-screen message system (same as the existing curve-shortening notices). The "pending" state is stored in the session, but the palette shows no spinner. Confirm that a console message is enough until a UI exists.
- Only the palette's tool buttons go through `world/requestTool`. The object-page actions (`start-cannon-carry`, `-tie-and-detach`, `-rotation`, `-aim`) and `enter-tool-mode` still enter their tools directly, as before; the job names the palette and VR (which share the palette). A later job (54, tools from modules) should route them.
- `moduleToolState` is cleared only through `set-module-tool-state`; clearing it when a tool ends needs `ownerModuleId` (job 54).
- The step is placed right after the creature loop and before the legacy curve-shortening phase; the event sink assumes one `step` per frame (events are cleared by `endFrame`).
- A throwing command handler is stored as `world/internalError` and rethrown after the step completes, so the shell's phase guard reports it; ticks propagate immediately. Design 5.3 only says "reported as internalError".
- `module-write-guard` is not in the runtime-mutable debug options, so toggling it needs a reload.
- The app was checked with the smoke run (`cube`, `torus-moduli`), the whole release tier (including the new `api.world` scenario) and the engine/client unit tests; I did not click a tool in a headset or a desktop browser by hand.
- Bench: the idle allocation line prints about 640-676 bytes/step (the legacy driver's own). The bench now also measures the bare engine (`step` + `endFrame`, no modules): 0.3 bytes/step, checked against the 16-byte limit by `--check`.
- Review round: `api.world.submit` validates only that `kind` is a string. A throwing handler skips `worldClient.afterStep` for that frame (it runs inside the same phase), so a pending tool request stays unsettled until the next frame. `frameErrorGuard.runPhase("world engine", ...)` allocates a closure per frame, and in XR a body publish makes two participant records per frame (two `publishBody` calls). The object-page tool entries (`enter-tool-mode` in `geodesicCannonTools.ts` at lines 430, 457, 480, 585) still bypass `world/requestTool`.

### Not done
- Nothing from the job's steps. Not touched, as instructed: moving the job to `_done/`, the queue table and the batch report.

### Checks
- Baseline before changes: `npm run typecheck` ok, `npm test` 154 files / 1274 tests passed.
- After: `npm run typecheck` ok; `npm test` 157 files / 1322 tests passed; `npm run docs:check` all ok (after `npm run docs:generate`); `npm run build` then `npm run smoke -- --world cube,torus-moduli` SMOKE OK (2 pages); `npm run bench -- moduleStep --check` check: ok (idle 0.10 us, flow about 16 us, flow+dependents about 30 us); `npm run test:release` 6 files / 13 tests passed, plus the new `worldEngine.release.test.ts` (1 test) passed.
- `grep -rn "playerPose\|objectIdSerials" src/runtime src/render` finds only unrelated names (debug dump callbacks, `appState.playerPose` as the initial pose, local variables), no session field.
