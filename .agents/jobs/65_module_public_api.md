# Job 65 - Give modules a public API and write the scenarios that were waiting for it

Status: in progress.
Resolves: the release scenarios left open by jobs 50, 53 and 54.

## Goal

A script can build an emitter scene, shoot, tie and wait for the flow through `window.noneuclid.api`, so manual checks become release scenarios.

## Depends on

Job 63. Job 64 for the carry and aim scenarios.

## Before you start

- Read 013 sections 5.3 and 5.7, `src/runtime/publicApi.ts`, `tests/app/*.release.test.ts`, [job 45](45_api_functions_for_scenarios.md) and
  `.agents/jobs/_reports/test_audit_2026_10_31.md` sections 4 and 5.

## Decisions

- `ModuleInstance.publicApi` as in 9.1: reads, or wrappers that submit a command and resolve with its result. Plain data only. The shell
  installs it as `api.<moduleId>`; composition fails when a `publicApi` name is not a function.
- `api.geodesicEmitters`: `place`, `shoot`, `extend`, `deleteGeodesic`, `remove`. `api.geodesicModel`: `tieAndDetach`, `arcsOfCurve`.
  `api.curveShortening`: `isAtRest`.
- This job does **not** decide job 45's other functions (`player.setPose`, `sim.pause`, and the rest): their names and shapes need the
  maintainer. Update job 45 to say which rows this job covered.

## Steps

1. `publicApi`, with tests, and `npm run docs:generate`.
2. Release scenarios: tie on a torus world until `isAtRest` (job 53, step 6); a world refusal shown when the emitters are disabled (job 54);
   carry through a portal (job 50); a tied curve around a corner is destroyed with its notice (job 55's manual check).
3. The `derived-verify` debug option on for a scenario of carry, shoot, tie and flow: no "differs from compute" error (job 59's manual check).

## Tests and checks

Release tier twice in a row. Known flake: issue 83. Record any failure, do not retry until green.

## Do not

Do not add a test back door (`_docs/tests.md` section 6.3): a function exists because a client could use it.

## Done when

The manual checks of jobs 53, 55 and 59 are gone from the batch report's list, and issue 86 can be closed with evidence.

## Report

### Done

Commits: `9ba7110` (`publicApi`, its unit tests, generated docs), `bafc3c4` (release scenarios, runner, docs, job 45); this report is in the commit after them.
Baseline before changes: typecheck clean; `npm test` 176 files, 1625 tests; `docs:writers` 7 files, 19 direct write calls, 7 mutator uses.

- **`publicApi`.** `ModuleInstance.publicApi` as in 9.1 (`ModulePublicApi`). `api.geodesicEmitters`: `place(cellId, point, yawRadians)`, `shoot(emitterId, yawRadians, lengthMeters)`, `extend(arcId, lengthMeters)`, `deleteGeodesic(emitterId, arcId)`, `remove(emitterId)`. `api.geodesicModel`: `tieAndDetach(emitterId, first, second)`, `arcsOfCurve(vertexId)`. `api.curveShortening`: `isAtRest()`. Each wrapper goes through the client's `submit`, so it gets every check a client's command gets. With the write guard on, a public function runs in a read-only frame, so a write of its own throws.
- **Composition** fails with "module m: the publicApi name n is not a function" (rule 13 in `composeModules.ts`), listed with every other problem. Tested, with a number and with `undefined`.
- **Lifetime.** `installModuleApis(engine.publicApis)` in `createThreeApp.ts`, beside `setApiNamespace("world", ...)`; dispose removes them before `worldClient.dispose()`. `main.ts` disposes the old app before it creates the new one, so an old dispose cannot delete a new namespace. Tested in `tests/runtime/publicApi.test.ts` (also a restart with other modules) and in the built app by the world-change scenario: `api.world` really is absent while the new app loads, and the new world's first emitter is `:0` again.
- **A caller is always answered.** What I found: dispose answered the waiters, but (a) a function kept from before a dispose would queue a command nobody steps, and wait forever; (b) `afterStep` answered last, so a throw in the tool settle or the event sink lost the result to `endFrame`, and the caller waited forever; (c) a hidden page runs no frames, so nothing answered at all. Fixes: (a) after dispose, `submit` answers `world/disposed` at once; (b) `afterStep` answers first; (c) after 30 s with no answer the command is withdrawn (new `engine.withdraw`) and the caller gets `world/noAnswer`, so the refusal is true. All pinned in `tests/render/worldClient.test.ts`. A frame with no tick leaves the promise open and the next tick answers: `tests/modules/modulePublicApi.test.ts`. These fixes also cover `api.world.submit`.
- **Release scenarios,** `tests/app/moduleApi.release.test.ts`, 6, all passing:
  - "ties two geodesics on a torus; the flow rests on the closed geodesic of their class" (job 53, step 6): two arcs of 5.39 m and 10.2 m, tied, `isAtRest` false, then true; one arc from the kept emitter to itself of 15 m, no vertex.
  - "refuses the emitter commands with the world's sentence when the emitters are off" (job 54, in part, see Not done): `place` and `tieAndDetach` answer `world/capabilityMissing` with "This tool is not available in this world.", `world/requestTool` answers `world/toolDisabled`, no emitter exists. The config is `tests/fixtures/scenario-site/emitters-off.config.js`, added by the release server only (`overlayRoot` of `staticServer.mjs`); nothing ships it.
  - "carries an emitter through a portal by walking; its connected geodesic follows" (job 50): **real input.** `debug.setPlayerPose` (existing) sets the player before the emitter, then G and W go through `Input.dispatchKeyEvent` (`ScenarioApp.keyDown`, `keyUp`, `pressKey`). So the hand is the app's aim ray, and the tool, the `carry/offset` slot and the bodies tick are the real ones. The emitter ends in `right`, the arc stays connected, with the word `front:side-1->right:side-3`, and no attachment is left. No `carry.*` or `player.*` function was added.
  - "destroys a curve tied around a corner of the cube, with its notice" (job 55): three emitters around a corner of `cube`, tied at the middle one; the reason in the run was `merge-blocked`. No arc and no vertex left, the emitters stay, exactly one notice line in the console.
  - "runs carry, shoot, tie and flow with every cache verified: no read differs from compute" (job 59), with `debugLevel=basic`, `derived-verify` and `module-write-guard`.
  - "gives a world change its own namespaces and a fresh world".
- **The `derived-verify` scenario is not vacuous.** Nothing could show that verification ran, so `DerivedStats.verifies` is new, read through the existing `debug.derivedStats`, and the scenario asserts it is above 0. I also broke `verify` on purpose (a false mismatch from the fourth comparison), rebuilt and ran the scenario: it failed, with frame errors, through `close()`'s failure rules. Reverted, rebuilt, passing.
- **Runner.** `openApp` takes `debugLevel`, `debugOptions`; `consoleLines()`. The one reconnect-and-retry of `callApiPath` assumed every call is idempotent, which is no longer true: a function that submits a command is not retried after a lost answer.
- **Docs.** `_docs/tests.md` section 8.5, `_docs/interactive-browser-debugging.md`, generated references, job 45 (which rows were covered, which were not; status unchanged), the header of `worldEngine.release.test.ts`.
- **Tests added.** Unit: `modulePublicApi.test.ts` 9, `publicApi.test.ts` 2, `worldClient.test.ts` 5, `composeModules.test.ts` 1, `derived.test.ts` 1. Process: `staticServer.process.test.ts` 1. Release: 6.

**Done when.**
- *The manual checks of jobs 53, 55 and 59 are gone:* each is now a scenario above that passed in both release runs. The batch report is not edited, as asked. The check of job 55 and the check of job 59 reach the tie through `api.geodesicModel.tieAndDetach`, not the tie tool's clicks; those clicks stay in job 54's list.
- *Issue 86 can be closed with evidence:* the one open item is the `derived-verify` session (carry, shoot, tie, flow to the merge, no "differs from compute"). Evidence: the scenario above, passing in two consecutive release runs on `bafc3c4`, with `verifies` above 0, with no frame error, and failing when `verify` is made to mismatch. Limit: verification samples every 64th read, as the option is built; the exact count of comparisons in a run was not recorded. The issue is not closed.

**Per frame.** Nothing was added: the frame still does one length check on the waiters. The deadline timer exists only per API call, never for a tool's command.

### Deviations

- `tests/render/worldClient.test.ts` now runs under fake timers, because `submit` starts a deadline and the unit tier forbids real timers. No assertion changed.
- `afterStep` answers callers before it settles the tool request and runs the event sink. Promises resolve after the frame's task anyway, so a caller sees no difference.
- Two commits, not one per step: step 3 shares its helpers with step 2.
- `tests/app/worldEngine.release.test.ts`: only the header comment changed, which said the API could not build these scenes.

### Uncertain

- **Additions the design does not list (013 not edited):** `ModuleCreateContext.submitPublicCommand` and the engine option of the same name, `WorldEngine.publicApis`, `WorldEngine.withdraw`, `WorldClient.submit`, the refusals `world/noAnswer` and (already there, undocumented in 5.3) `world/disposed`, `DerivedStats.verifies`, composition rule 13. 9.1 gives `publicApi` as an object of functions but no way for a wrapper to submit, and promises must stay out of the engine (6.6 rule 2), so the waiters stay in the client and the engine holds a late-bound function, like `getWorld`. `publicApis` holds functions, so it would not cross a worker; `query` is the same today.
- **The argument shapes** of the emitters' functions are mine: positional, following `tieAndDetach(emitterId, first, second)` of 13.1.
- **The 30 s deadline** is a judgement. A page that draws frames answers within a few of them, so it should fire only with no frames at all; a page frozen for 30 s and then resumed withdraws a command a person might expect to run. Better idea: none that keeps the answer true. The coordinator may prefer no deadline and a documented wait.
- **`debug.setPlayerPose` in the carry scenarios.** It exists and other scenarios use it, but it is job 45's undecided `player.setPose` in another namespace. If the maintainer removes it, the scenario must walk from the start pose.
- **A module id equal to a shell namespace** (`world`, `app`, `view`, ...) would replace it, and its dispose would delete it. No check; no such module exists. A composition rule would need the list of shell names in the engine.
- **`place` still throws inside the handler for a missing `point`** (`world/internalError` and a frame error), through `api.geodesicEmitters.place` as through `api.world.submit`. Not changed; only a wrong script reaches it.
- **Bench timing,** see Checks: `--check` read high on both runs, and `bench:ab` settles it as no regression. The machine had just run the release tier twice.
- **Better idea, not done:** let `world/noAnswer` and other refusals of script commands also reach the same message sink as a tool's, so a person sees what a script was told.

### Not done

- **"A world refusal shown", the part a person sees (job 54).** The scenario proves the world's answer and its sentence reach the caller; it does not prove the message is shown, and its name does not claim it. In the app, the sentence is shown only for a request made through `worldClient.requestTool` or a tool's context. With the emitters disabled, no input reaches either: the palette leaves the tool out, and G needs an emitter, which that config cannot create and no world authors. It would need job 45's `tool.select`, going through `worldClient.requestTool`. So the check of job 54's step 5 stays manual, and it may be unreachable by a person at all, which is itself worth the maintainer's look.
- **Tie tool by clicks** (job 54, steps 2 to 4) is not converted: it needs aimed clicks and pointer lock. Stays manual.
- **Manual checks, none done.** I cannot use a headset and ran no desktop step by hand.
  Desktop: job 54's steps 2 to 5; job 63's steps 1 to 8; job 64's steps 1 to 4 and 6 to 9. Job 64's step 5 (carry through a portal) is now the scenario, for keyboard and desktop aim only; its check that a plain geodesic goes on pickup is not in the scenario.
  Quest 2: job 54's step 6; job 63's sequence; job 64's steps 1, 2 and 5 with frame time while carrying several geodesics, and the delay on entering a mode at a low tick rate. Nothing in this job changes those paths. Running these scenarios on a headset over the server channel (rung 4) was not tried; `pressKey` exists only over DevTools, so the carry would not port.

### Checks

Final, on the code of `bafc3c4`:

- `npx tsc --noEmit`: exit 0, also before the commits.
- `npm test`: exit 0, 178 files, 1644 tests. An earlier run failed one test, hygiene H6, a scenario name over 90 characters; renamed.
- `npm run docs:check`: exit 0, after `npm run docs:generate`.
- `npm run build`, `npm run smoke -- --world cube,torus-moduli`: exit 0, SMOKE OK (2 pages), also after the change to `createThreeApp.ts`, before the scenarios.
- **Release tier twice in a row** (`npm run test:release`, each with its build): run 1 exit 0, 8 files, 23 tests; run 2 exit 0, 8 files, 23 tests. No failure, no retry, issue 83 did not show. During development, single-file runs had one real failure, the restart scenario's own poll, fixed.
- `npm run bench -- moduleStep --check`: **exit 3 on both runs** (first right after the release tier), timing only: flow 21.56 and 21.58, flow+dependents 40.79 and 40.20, many arcs 1882.23 and 1665.84, tracked 2126.77 and 1840.72, plain 2140.11 and 2025.48 us/step; idle allocation 0.4 bytes/step. No counter rose: writes 1557, 1797, 126897. `moduleStep.json` and `moduleStepCounters.json` are unchanged.
- `npm run bench:ab -- 58406eb`: exit 0, "ok". Medians: base flow 22.13, flow+dependents 36.81; head 19.02, 35.10 us/step. The bench file is the same on both sides.
- `npm run docs:writers`: 7 files, 19 direct write calls, 7 mutator uses, unchanged. `publicApi` adds no client write.
