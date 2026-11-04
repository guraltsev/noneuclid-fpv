# Job 49 - Build the world engine and split the client session from it

Status: in progress.
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
