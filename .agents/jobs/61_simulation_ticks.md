# Job 61 - Run the world in ticks owned by the simulation

Status: in progress.
Resolves: nothing filed; implements 012 P8 of 2026-11-05.

## Goal

The world advances in ticks of length \(h\). The shell converts elapsed real time into ticks and never passes frame time to the engine.
The flow no longer slows down below 10 frames per second.

## Depends on

Nothing.

## Before you start

- Read 012 P8 and 013 sections 5.2, 5.3 and 6.5. Run `npm run typecheck` and `npm test` for a baseline.

## Background

`createThreeApp.ts` computes `deltaSeconds = min(wallClockDeltaSeconds, maxSimulationStepSeconds)` and calls `engine.step` once per frame.
The flow caps again in `policies.ts` (`maxCurveShorteningDeltaSeconds`). Creatures, movement and tools use the same frame delta.

## Decisions

- New pure file `src/engine/simulationClock.ts`: `createSimulationClock({ tickSeconds, maxTickSeconds, tickBudgetShare })` with
  `advance(elapsedSeconds, lastTicksCostSeconds): { ticks: number; tickSeconds: number; behindSeconds: number }`. It keeps the accumulator.
- Defaults: `tickSeconds` \(1/90\), `maxTickSeconds` \(1/30\). They are options of the experience.
- **Never faster than the display (maintainer, 2026-11-05).** \(h\) is never shorter than the steady frame period: a 72 Hz display runs \(h = 1/72\) s, and a
  120 Hz display keeps the default \(1/90\) s, its frames with no tick being served by the fast channel. Take the period from a smoothed frame time inside the
  clock, so one odd frame does not move \(h\).
- **Tick cost (maintainer, 2026-11-05).** The shell reports how long the frame's ticks took. When they exceed a share of the frame, `tickBudgetShare`, default one
  third (a starting value), \(h\) grows, up to `maxTickSeconds`, before frames are missed; it comes back slowly once they fit. A carried object stays smooth
  while the simulation gets choppier. `maxTickSeconds` stays \(1/30\) unless it becomes an issue.
- **Load rule, in the clock only.** At most 3 ticks per frame. When the accumulated time needs more, \(h\) grows to fit, up to
  `maxTickSeconds`. What still does not fit is dropped and reported in `behindSeconds`: no queue of ticks is paid back later.
- `behindSeconds > 0` emits one `world/behindRealTime` notice with a message, at most once per second.
- `maxCurveShorteningDeltaSeconds` is deleted; `constantSpeedLaw` uses `deltaSeconds` as given. `engine.step` rejects a duration above
  `maxTickSeconds` only in the shell's use: tests keep `step(0.1)`, so `step` itself takes any non-negative duration.
- A reset frame still calls `engine.step(0)`.
- **A frame with no tick runs `applyControls` and no step** (013 section 5.4): commands and derived values wait for the next tick.
- **`engine.applyControls(frameSeconds)` already exists and stays, once per frame, before the ticks.** It takes frame time on purpose: what follows a
  participant shares the body's clock. It is the one frame time the engine takes, capped by `maxSimulationStepSeconds` as today.
- **Once per frame, not per tick:** `worldClient.afterStep`, `toolHost.afterStep` and `afterCarryWorldStep` replay every event since
  `endFrame`, so they run once, after the frame's last tick. A frame with no tick still runs them and `endFrame`.
- The local player, creatures and client tools stay on frame time until their modules exist (013 section 16). So
  `maxSimulationStepSeconds` stays for them, and is no longer given to the engine.
- A carried emitter moves in `applyControls`, once per frame, not in the ticks.
- The limit of 3 ticks per frame and the growth of \(h\) are confirmed by the maintainer (2026-11-05).

## Steps

1. `simulationClock.ts` with tests: at 60 and 72 Hz a frame normally has one tick and \(h\) is the frame period; at 120 Hz \(h\) stays \(1/90\); one slow frame does not move \(h\); ticks costing more than the share raise \(h\) up to the maximum and it recovers; ticks over a steady 60, 72, 90 and 120 Hz sum to real time within one tick; a 1 s hitch gives at most 3
   ticks of at most \(1/30\) s and a non-zero `behindSeconds`; no time is carried past the frame that dropped it.
2. The shell's frame runs `clock.advance`, then that many `engine.step(tickSeconds)` inside the guarded phase.
3. Delete the flow's cap. Update its doc comments.
4. Update `_docs/ARCHITECTURE.md` if it describes the frame.

## Tests and checks

A test at 120 Hz: a carried emitter moves in every frame, including frames with no tick. A flow test: the same curve run at frame rates of 5 and 120 Hz through the clock reaches rest within 5 percent of the same simulated time.
Smoke, release tier, bench counters. The bench machine is much faster than a Quest 2: say so in the Report, and list a Quest 2 check of frame time and ticks per second for the maintainer.

## Do not

Do not move the player, creatures or tools onto ticks. Do not change the order of 5.2.

## Done when

`grep -n "engine.step" src/render/three/createThreeApp.ts` shows only the tick loop and the reset. The shell passes no frame time to the engine, except to `applyControls`.

## Report

### Done

Commit e6d28cc (implementation, tests, documents); this Report is the commit after it.

- `src/engine/simulationClock.ts` (new, pure): `createSimulationClock({ tickSeconds, maxTickSeconds, tickBudgetShare })` with `advance(elapsedSeconds, lastTicksCostSeconds)` returning `{ ticks, tickSeconds, behindSeconds }`, and
  `takeBehindNotice()`. Re-exported from `worldEngine.ts`, because render and runtime may import only the engine's public face.
- `src/runtime/experience.ts`: `defaultSimulationClockOptions` (\(1/90\), \(1/30\), one third).
- `createThreeApp.ts`: `applyControls(deltaSeconds)`, `clock.advance` with the uncapped elapsed time, then that many `engine.step(tickSeconds)` in the guarded phase; the ticks are timed and the cost reported on the next frame. A reset frame runs
  `applyControls(0)` and `step(0)`. `afterStep` hooks stay in their own phase after the loop, so they run once per frame, also with no tick, and `endFrame` runs in every frame. `maxSimulationStepSeconds` stays for frame time.
- `engine.noticeBehindRealTime(seconds)` (new on `WorldEngine`) and the type `WorldBehindRealTimeEvent`: the event `world/behindRealTime` with a message, shown by the existing event sink of `worldClient`.
- `policies.ts`: `maxCurveShorteningDeltaSeconds` deleted; `constantSpeedLaw` uses `deltaSeconds` as given.
- Doc comments of `worldClient.afterStep`, `toolHost.afterStep`, `afterWorldStep`, the `createThreeApp.ts` header and `_docs/ARCHITECTURE.md` step 5 updated; generated documents regenerated.
- Tests: `tests/engine/simulationClock.test.ts` (new, all the cases of step 1 and more); "moves the carried emitter in every frame at 120 Hz, also in frames with no tick" in `tests/modules/carry.test.ts`;
  "reaches rest in the same simulated time through the clock at 5 Hz and at 120 Hz" in `curveShortening.test.ts`; the notice in `worldEngine.test.ts`; helper `runClockFrame` in `tests/support/engine.ts`.
- Read every `resultOf` site in `src` (`worldClient`, `toolHost`, `geodesicCannonTools`): each keeps a command pending while its result is undefined, so a frame with no tick loses no answer.

Done when: `grep -n "engine.step" src/render/three/createThreeApp.ts` shows line 1298 (reset), line 1306 (tick loop) and one mention in the header comment (line 27), no other call. The shell gives the engine frame time only in `applyControls`.

### Deviations

- Existing test changed, as Decision "`constantSpeedLaw` uses `deltaSeconds` as given" requires: "is a single frame's worth of motion per step whatever the frame time is" pinned the deleted cap (`step(5)` moves at most \(1.5 \cdot 0.1\) m). It is replaced by
  "takes a step's duration as given: a long step moves a vertex as far as its speed allows".
- `takeBehindNotice()` and `engine.noticeBehindRealTime` are additions to the interfaces the job names. `advance` keeps the exact return the job gives; the once-per-second limit needs real time, which the engine must not receive, so it sits in the clock, and an
  event of the kind `world/...` can only enter the event list through the engine.
- "`engine.step` rejects a duration above `maxTickSeconds` only in the shell's use": there is no separate check. The clock never returns a longer tick (tested at frame periods up to 2 s), and `step` takes any non-negative duration.

### Uncertain

- **The Goal and the Decisions disagree below 10 frames per second.** The Goal says the flow no longer slows down below 10 fps. But 3 ticks of \(1/30\) s hold exactly 0.1 s per frame, the same limit as the deleted cap. Measured through the clock, the curve of the flow test reaches rest
  after 1.40 s of simulated time at 5 Hz, which is 2.80 s of real time, against 1.34 s at 120 Hz: at 5 Hz the flow runs at half speed. I followed the Decisions (both limits are confirmed by the maintainer). What changed is that the loss is now reported. The flow test compares simulated time, as the job says.
  Keeping up at 5 Hz would need 6 ticks per frame or a longer maximum tick. The maintainer should choose.
- **Tick cost, how I read "a share of the frame".** \(h\) is at least the median cost of one tick divided by `tickBudgetShare`, so the ticks take that share of real time on average. Read literally per frame, a frame with a tick would exceed the share whenever one tick costs more than
  the share of a frame, and \(h\) would park at the maximum even with most frames free. A single tick costing more than a frame still misses that frame at any \(h\). A Quest 2 run would show whether this is the right reading.
- **Rounding to the nearest tick.** The clock rounds the accumulated time to whole ticks instead of flooring it, so the world may run up to half a tick ahead of real time. With a floor, a real display at \(h\) equal to the period would jitter between 0 and 2 ticks per frame. This is my choice; no Decision covers it.
- **Constants I chose:** a median over 9 samples (it takes 5 frames to move \(h\), about 70 ms at 72 Hz) and a recovery rate of 0.5 per second (about 2 s from \(1/30\) to \(1/90\) s). "One odd frame does not move \(h\)" also holds for one expensive tick, by the same median.
- **The flow test's margin is small:** 4.1 percent against the 5 allowed, for the scenario `createSymmetricPairScenario(2, 2)`. The difference is mostly the 0.1 s of simulated time per frame at 5 Hz, since rest is only seen at the end of a frame; a shorter curve would exceed 5 percent (`(2, 1.5)`: 1.10 s against 1.01 s, 8.8 percent).
- **A hidden tab** counts as dropped time: coming back gives one notice with the whole gap. In the software-rendered smoke run the notice appeared with 3.28 s and 0.24 s. It goes to the console and diagnostics only; there is no on-screen message system.
- **Stale design text I may not edit:** 013 section 6.5 ("not built: today the shell runs one step per frame"), 013 section 13.2 (`min(deltaSeconds, maxCurveShorteningDeltaSeconds)`), 012 P8 ("`step` ... validated against the configured bounds") and the notice "to be confirmed" in 012 P8.
- One `npm run typecheck` during the work crashed inside node with a native stack trace; the same command run again right away, and every later run, passed. Not investigated; it did not look related to the code.

### Not done

Manual checks, none of them run (I cannot run a headset or a real display here):

- Quest 2 at 72 Hz: frame time and ticks per second, idle and with a flow running; whether \(h\) stays at \(1/72\) s or grows, and whether `tickBudgetShare` of one third is a good value.
- Quest 2: carrying an emitter while a flow runs: the emitter stays smooth while the simulation gets choppier.
- Quest 2: a heavy scene, with the `world/behindRealTime` notice in the diagnostics.
- Desktop at 60 Hz and on a 120 Hz or faster display: flow and carrying look right, no stutter in the frames with no tick.
- Desktop: hide the tab for some seconds and come back: one notice, no jump of creatures or curves.
- Desktop: the reset key during a flow.

The bench figures come from this machine, which is much faster than a Quest 2; they do not transfer.

### Checks

- Baseline before any change: `npm run typecheck` exit 0; `npm test` exit 0 (171 files, 1462 tests).
- Final, on the code of e6d28cc: `npm run typecheck` exit 0; `npm test` exit 0 (172 files, 1491 tests); `npm run docs:generate` exit 0; `npm run docs:check` exit 0; `npm run build` exit 0; `npm run smoke` exit 0 (SMOKE OK, 1 page);
  `npm run test:release` exit 0 (7 files, 16 tests); `npm run bench -- moduleStep --check` exit 0, "check: ok".
- Bench counters unchanged: `flow` steps 120, writes 1557; `flow+dependents` steps 120, writes 1797; `manyArcs` writes 126897. Timing: flow 16.57, flow+dependents 28.27 us/step. `moduleStepCounters.json` and the baseline were not written.
- Smoke was run once, after all the changes to `createThreeApp.ts`, which were made in one pass, not after each edit.
