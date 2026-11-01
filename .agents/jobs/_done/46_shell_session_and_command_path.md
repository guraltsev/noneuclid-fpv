# Job 46 - One shell-side state holder and one command path

Status: done, needs review on 2026-11-01.
Resolves: items 1 and 2 of the old job 31 (former issue 77).

## Goal

All mutable state of the rendering shell (`createThreeApp`) lives in one session object, changed in one place by a pure reducer, and
every UI action is a command. The session is **shell-side**, decided by the maintainer on 2026-11-01 (design 012, P3 and the
decision log): the menu state is not split, and the rules of what an object can do (carrying) are contracts in `world-objects`
(job 47), not code in the session.

## Depends on

- Job 31 (palette split and one portal sync), so that the palette callbacks to convert are small and findable.
- Job 47 (the carry contract), so that the carry tool session is a small record handed to a contract, not logic.

## Before you start

Same as job 31: own worktree and branch, read the knowledge index, run the checks for a baseline (the known failure is
`appCommands.release.test.ts`), no push. Read design 012, section P3 and the 2026-11-01 decision, and `docs/coding_style.md`
(plain objects, no events, no framework).

## Background

`src/render/three/createThreeApp.ts` keeps about 35 `let` variables (`playerPose`, `menuState`, tool states, id counters, debug
settings, XR state) and assigns `menuState` in 39 places; it hands about 25 getter/setter pairs and about 45 `on*` callbacks to
factories. `RuntimeCommand` (`src/runtime/runtimeCommands.ts`) has 4 kinds, of which 2 are dispatched. The palette callbacks are about
200 lines of inline handlers, each doing its own state transition.

## Decisions

- New module `src/runtime/appSession.ts`: a plain `AppSessionState` record and `createAppSession(initial)` returning
  `{ get(): AppSessionState; update(fn): void }`. No events, no framework. State is replaced by new values, never edited in place.
- Each field gets a one-line comment saying whether it is real state, cheap derived or expensive derived (design 012, P7 commitment 3).
- `RuntimeMenuState` stays one record (not split). The carry session is a small record in the session (`{ objectId, offset }`) handed
  to the carry contract of job 47.
- `RuntimeCommand` is widened to every UI-originated action (select tool, open page, select world or config, toggle a debug option,
  sign editing, the geodesic-cannon menu actions). `appCommandDispatcher.ts` grows into `applyRuntimeCommand(session, command)`: a pure
  reducer for menu and tool commands, and a list of effects for the rest (reload the world, etc.). It is tested in `tests/runtime/`
  without Three.js.
- Factories take the session (or the part they need), not getter/setter pairs for shell state.
- `AppState` (`src/runtime/appState.ts`) may become the seed of the session; decide when you see the code, record it in the Report.

## Steps

1. Create `appSession.ts` with only `menuState` in it; route the 39 assignments through the reducer in groups (palette callbacks first),
   one group per commit-sized step, running typecheck and the unit tests after each.
2. Add the remaining fields one family at a time (player pose, tool states, debug settings, id counters, XR state), each as its own step.
3. Convert the factories' deps from getter/setter pairs to the session, one factory per step.
4. Widen `RuntimeCommand` and add a reducer test for every variant as you convert its call site.
5. Regenerate the documents and run all checks.

## Tests and checks

- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run test:release` (known failure: `appCommands.release.test.ts`).
- A reducer test for every command variant; no test weakened.
- By hand, once, for the maintainer: open the menu, select every tool, place and edit a sign, change the world, toggle a debug option.

## Do not

- Do not split `RuntimeMenuState`, and do not move state into `src/world-objects` or an "engine" layer.
- Do not change what any tool does; only where its state lives and how it is changed.
- Do not touch the carry rules (job 47) or the portal and palette code (job 31) beyond calling the session.

## Done when

- `grep -c "menuState = " src/render/three/createThreeApp.ts` is 0; menu transitions happen only in the reducer.
- No factory `deps` interface contains a get/set pair for shell state.
- Every palette action is a `RuntimeCommand` variant with a reducer test.
- `createThreeApp.ts` is under 1,500 lines (stretch; report the number if not reached and why).
- All checks pass (apart from the known timeout) and a `## Report` is appended.

## Report

### Done
Four commits on branch `job-46` (from `job-47`): `3b4e2d0` (step 1), `d9262bf` (step 2), `f455f64` (step 3) plus this report.
- **The session.** `src/runtime/appSession.ts`: a plain `AppSessionState` record and `createAppSession(initial)` returning `{ get, update }`; no events.
  Fields (each commented real / cheap derived in the file): `menuState`, `appConfig`, `debugSettings`, `showCellPathRendersInstances`,
  `vrComfortOptions`, `playerPose`, `cannonToolState`, `protractorToolState`, `objectIdSerials`. `takeObjectIdSerial(session, family)` replaces the five
  id counters (three in `createThreeApp`, two inside the cannon tools).
- **The command path.** `RuntimeCommand` (`runtimeCommands.ts`) grew from 4 to 55 variants: every palette callback, every menu transition, the sign
  keyboard, the cannon and geometry computer actions, the debug and comfort toggles, and three state writers (`set-cannon-tool-state`,
  `set-protractor-tool-state`, `set-player-pose`). `src/runtime/applyRuntimeCommand.ts` is the pure reducer `reduceRuntimeCommand(state, command)` returning
  `{ state, effects }` plus `applyRuntimeCommand(session, command)`. Effects (`RuntimeEffect`) are listed in the order the host runs them, including where the
  palette is redrawn (`sync-palette`). `appCommandDispatcher.ts` is deleted; the shell has one `dispatchRuntimeCommand` that applies the reducer and runs the
  effects in `runRuntimeEffect`.
- **Shell.** `createThreeApp.ts` has no `menuState = ` (was 39) and 31 top-level `let`s left (were 43). The palette callbacks are one-line dispatches (about 200
  lines of handlers gone). The factories `aimInteraction`, `geodesicCannonTools`, `geodesicDebugDumps`, `debugVisualization`, `geodesicEmitterLabelController`,
  `runtimeObjectInstanceSync`, `toolObjectRuntimes`, `geometryComputerMenu`, `scenePaletteController` and `portalDebugRuntime` take the session (reads) and
  `dispatch` (writes); no deps interface has a get/set pair for shell state any more.
- **Tests.** `tests/runtime/applyRuntimeCommand.test.ts`: 50 tests, at least one per command variant, including the app-config gating, the effect order, the
  derived debug settings and the id serials. Shared fake: `tests/support/appSession.ts` (`createTestAppSession`).
- Types moved down so the session can name them: `GeodesicCannonToolState` to `world-objects/geodesic/cannonToolState.ts` (re-exported from the tool),
  `ProtractorToolState` added to `world-objects/protractorTool.ts`.

### Deviations
- **`appCommandDispatcher.ts` is replaced, not grown.** Its four tests moved into `applyRuntimeCommand.test.ts` (reload, go home, change world, debug overlay) as effect
  checks, since the dispatcher no longer exists.
- **Harness edits, no assertion changed:** `tests/render/geodesicCannonCarry.test.ts`, `geodesicCannonCarryPolicies.test.ts`, `aimInteraction.test.ts`,
  `debugVisualization.test.ts`, `geodesicEmitterLabelController.test.ts`, `runtimeObjectInstanceSync.test.ts` and `scripts/bench/frameAllocations.bench.ts` build a session
  (or call `dispatch`) instead of passing getter/setter lambdas.
- **Effects run after the state change.** Before, a handler ran its side steps first (clear protractor feedback, then change the menu); now the menu changes first and
  the effects follow. `sync-palette` is placed where `syncDesktopPalette()` was, so the order of redraw and restart is unchanged. No case reads the menu in those steps.
- **The tools keep computing their next state**, and `set-cannon-tool-state` / `set-protractor-tool-state` / `set-player-pose` carry it: the reducer is the one writer, but
  these three are "replace" commands, not decisions. The player pose is dispatched a few times per frame (one small object each).

### Uncertain
- **Not by hand.** The menu, every tool, sign placing and editing, changing the world and toggling a debug option were not driven in a real browser or headset;
  the unit tests, the 50 reducer tests and the release scenarios cover them only through the same code. This is the maintainer's check (see below).
- A palette press now redraws the palette once more than before in a few cannon flows (the cannon tools call `syncDesktopPalette()` after their own `dispatch`, and the
  dispatch redraws too). Harmless but redundant.

### Not done
- **`createThreeApp.ts` is 3,142 non-blank lines (3,361 with blanks; 3,471 before), not under 1,500** (it was 3,244 non-blank lines before job 46). The stretch goal was not reached: the file's size comes from the
  frame loop, XR, geometry commits, the portal pass, the debug helpers and about 30 factory wirings, none of which is session state. Moving them out is job 33's subject.
- **State left outside the session** (each is render or frame state, not something a UI action decides): the XR session and debug state (`xrSessionState`, `xrDebugState`,
  `activeXrSession`), `aimFrameSerial`, `visibleCellId`, the portal pass results (`latestVisibleResult`, `portalEyeRenderStates`, `portalInstanceRenderState`, ...),
  `activeWorldBundle`, `protractorToolFeedback`, `helpLensFocusedObjectId`, `previousDesktopPalettePlacement`, `reloadConfirmationTimeout` (a timer handle) and the
  frame diagnostics. Their getters (`getFrameSerial`, `getVisibleCellId`, `getEyeCount`, `getWorld`) stay in the factories' deps; none is a get/set pair.
- **One carrier per object** (job 47 left it to the session): not enforced. The carry state is still the cannon tool state's `selectedCannonId` / `activeGeodesicId`;
  there is no `{ objectId, offset }` carry record in the session yet, because the carry tool's offset still lives in the tool.
- The detach path of the carry tool calls `finishGeodesicCannonCarry()` itself; it was not turned into a command.

### Checks
- Baseline (job 47 branch head `68e41c2`): typecheck, `docs:check` and `npm test` (1060) green; `test:release` 10 of 11, only `appCommands.release.test.ts` timing out.
- After the changes: `npm run typecheck`, `npm run docs:check` green, `npm test` 1106 tests green, `npm run test:release` 10 of 11 with the same `appCommands` CDP timeout
  ("changeWorld switches to the requested world", `Runtime.evaluate (id 7)`), which also fails at the base commit (see job 31's report).
- Hand check for the maintainer, once: open the menu, select every tool, place and edit a sign, change the world, toggle a debug option, press reload twice (confirm), carry an emitter.
