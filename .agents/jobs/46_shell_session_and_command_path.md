# Job 46 - One shell-side state holder and one command path

Status: queued (blocked until jobs 31 and 47 are done).
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
