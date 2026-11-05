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
- **Tick cost (maintainer, 2026-11-05).** The shell reports how long the frame's ticks took. The share is measured as an average over the last \(1/2\) s of real time, not per
  frame. When the ticks took more than `tickBudgetShare` of it, default one third (a starting value), \(h\) grows, up to `maxTickSeconds`, before frames are missed; it comes back slowly
  once they fit. A carried object stays smooth while the simulation gets choppier. `maxTickSeconds` stays \(1/30\) unless it becomes an issue.
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

Commit e6d28cc (implementation, tests, documents); the Report is cb1ec69; the repair round after a fresh review is d95c5c0; the share over half a second is 8491694; the second repair round is the commit after that.

Repair round: the medians look at 10 samples, not 9, and take the mean of the two middle ones, so a cadence alternating two periods keeps one \(h\) (frames of \(1/60\) and \(1/30\) s: 25 ms, no change in 7160 frames; before, it flipped in nearly every frame). Tests added
for both cadences. The guards on the options and on `advance`, and their test, are deleted: only tests reached them. The comparator is hoisted, and `sorted` is written by index instead of `length = 0`, so it keeps its storage.

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

Share over half a second (maintainer, 2026-11-05; set after the review, it replaces the tick-cost median): the ticks' share is an average over the last \(1/2\) s of real time, in a preallocated ring with running sums (`createRecentLoad`: amortised \(O(1)\), no allocation per frame).
\(h\) grows to the cost of a tick divided by `tickBudgetShare` when the share goes over `tickBudgetShare`; the median stays for the frame period only. A frame longer than the window stays alone in it, so a hidden tab reads as no load for the next half second. Before half a second has passed, the share is still taken of a
whole half second, so the first frames do not read as a sustained load.

The plain rule chattered, so it has two cures: `loadHoldBand` (\(h\) holds while the share is within 10 percent under `tickBudgetShare`) and `secondsFitting` (\(h\) comes back only after a whole half second under the band). Spread of \(h\), 12000 frames, cost following the frame's parity, after the first 6 s:

| Load | Hz | Plain rule: spread, changes | With the cures: \(h\), spread, changes | From frame 100 with the cures: spread, last change |
| --- | --- | --- | --- | --- |
| below the share, 2 and 3 ms | 90 / 72 / 60 | 0, 0 | base \(h\), 0, 0 | 0, none |
| above the share, 6 and 8 ms | 90 | 5.000 ms, 4078 | 24.000 ms, 0, 0 | 2.500 ms, 1.96 s |
| above the share, 6 and 8 ms | 72 | 0.500 ms, 3540 | 21.250 ms, 0, 0 | 0.250 ms, 3.44 s |
| above the share, 6 and 8 ms | 60 | 0.720 ms, 7534 | 21.360 ms, 0, 0 | 0, none (last at frame 68) |
| at the share, \(\pm 14\) percent by parity | 90 | 0.104 ms, 10576 | 11.146 ms, 0, 0 | 0, none |
| at the share, \(\pm 14\) percent by parity | 72 | 0, 0 | 13.889 ms, 0, 0 | 0, none |
| at the share, \(\pm 14\) percent by parity | 60 | 0.226 ms, 10769 | 16.742 ms, 0, 0 | 0, none |
| 1.05 of the share, random \(\pm 10\) percent | 90 | 0.633 ms, 4337 | 11.908 to 12.006 ms, 0.098 ms, 6 | 0.148 ms, 59.92 s |
| 1.05 of the share, random \(\pm 10\) percent | 72 | 0.895 ms, 4498 | 14.856 to 15.089 ms, 0.233 ms, 7 | 0.301 ms, 16.03 s |
| 1.05 of the share, random \(\pm 10\) percent | 60 | 1.196 ms, 4570 | 17.917 to 18.062 ms, 0.145 ms, 6 | 0.308 ms, 162.07 s |

The median of the review round gave 16 distinct lengths in the same pattern. Corrected in the second repair round: the last column now counts changes from frame 100 too; it used to count them from frame 1. The noise rows are one seed; over 2000 seeds per rate, in frames 3000 to 6000, the worst run has 15 changes, none downward, and a spread of 0.342 ms (2.1 percent). With random noise the remaining changes are rare upward steps to a new peak, not an oscillation.

Second repair round: the frame-period median uses an insertion sort into a preallocated `Float64Array`, so `Array.prototype.sort` and its allocation are gone (`advance` measures about 146 bytes per call now, including its result object; not traced further). The header says what one expensive frame does: it moves the share by what it adds, and the threshold is about 0.17 s at a share of one third (0.15 s does not trip it; 0.17 s does at 72 and 90 Hz, not yet at 60 Hz, with no other load). New test "lengthens the tick for one frame that alone exceeds the share, and comes back"; "does not react to one expensive tick" is now "does not react to one tick that stays under the share of the half second".

### Deviations

- Existing test changed, as Decision "`constantSpeedLaw` uses `deltaSeconds` as given" requires: "is a single frame's worth of motion per step whatever the frame time is" pinned the deleted cap (`step(5)` moves at most \(1.5 \cdot 0.1\) m). It is replaced by
  "takes a step's duration as given: a long step moves a vertex as far as its speed allows". The replacement also changed the input, `stepFlow(engine, 5)` to `stepFlow(engine, 1)`.
- Cost tests reworked for the share over half a second, as the decision allows: "leaves the tick alone while the ticks fit their share of the frame" is now "... of real time", same numbers. "keeps one tick length when the ticks alternate between two costs" no longer reports the old cost on a frame with no tick, which the shell never does, and its
  value is checked to 3 decimals instead of 9, because \(h\) settles at the upper envelope of the cost. New tests: a load going over the share, the first frames, a frame longer than the window, the frame-parity pattern, a load at the share.
- The frame-parity test keeps its strict assertion, one tick length, but looks from 6 s on, not from frame 200 as the first test did: with the cures the pattern still takes up to 3.44 s to settle (72 Hz, one step of 0.25 ms at frame 248; at 90 Hz 9 changes from frame 100, 14 from the first frame, spread 2.5 ms, until 1.96 s). The transient is in the table above.
- The noise half of "does not chatter with a load sitting at the share" asserted one tick length, which held only for its seed (reviewer: about 90 of 200 other seeds failed per rate, with up to 13 lengths). It is now its own test, "only creeps up, a little, with a noisy load at the share", over 20 seeds per rate: at most 30 changes, none downward, spread under 4 percent. The bounds are about twice the worst of 2000 seeds per rate, and the seeds are a plain sequence, not chosen.
- `takeBehindNotice()` and `engine.noticeBehindRealTime` are additions to the interfaces the job names. `advance` keeps the exact return the job gives; the once-per-second limit needs real time, which the engine must not receive, so it sits in the clock, and an
  event of the kind `world/...` can only enter the event list through the engine.
- "`engine.step` rejects a duration above `maxTickSeconds` only in the shell's use": there is no separate check. The clock never returns a longer tick (tested at frame periods up to 2 s), and `step` takes any non-negative duration.

### Uncertain

- **The Goal and the Decisions disagree below 10 frames per second.** The Goal says the flow no longer slows down below 10 fps. But 3 ticks of \(1/30\) s hold exactly 0.1 s per frame, the same limit as the deleted cap. Measured through the clock, the curve of the flow test reaches rest
  after 1.40 s of simulated time at 5 Hz, which is 2.80 s of real time, against 1.34 s at 120 Hz: at 5 Hz the flow runs at half speed. I followed the Decisions (both limits are confirmed by the maintainer). What changed is that the loss is now reported. The flow test compares simulated time, as the job says.
  Keeping up at 5 Hz would need 6 ticks per frame or a longer maximum tick. The maintainer should choose.
- **Rounding to the nearest tick.** The clock rounds the accumulated time to whole ticks instead of flooring it, so the world may run up to half a tick ahead of real time. With a floor, a real display at \(h\) equal to the period would jitter between 0 and 2 ticks per frame. This is my choice; no Decision covers it.
- **Constants I chose:** a median over 10 samples for the frame period (5 odd frames move \(h\) halfway, 6 fully, about 80 ms at 72 Hz), a recovery rate of 0.5 per second (about 2 s from \(1/30\) to \(1/90\) s, after half a second of fitting), and a hold band of 10 percent.
- **What the cures cost:** \(h\) settles at the upper envelope of what the load asks for, so it may stay longer than needed. In the parity pattern at 90 Hz it holds 24.000 ms with the ticks at 0.293 of real time, against about 21 ms at the full third. It also reacts to a load about half a second later than a per-frame rule, and a very short load shows only in part.
- **The flow test's margin is small:** 4.1 percent against the 5 allowed, for the scenario `createSymmetricPairScenario(2, 2)`. The difference is mostly the 0.1 s of simulated time per frame at 5 Hz, since rest is only seen at the end of a frame; a shorter curve would exceed 5 percent (`(2, 1.5)`: 1.10 s against 1.01 s, 8.8 percent).
- **A hidden tab** counts as dropped time: coming back gives one notice with the whole gap. In the software-rendered smoke run the notice appeared with 3.28 s and 0.24 s. It goes to the console and diagnostics only; there is no on-screen message system.
- **Stale design text I may not edit:** 013 section 6.5 ("not built: today the shell runs one step per frame"), 013 section 13.2 (`min(deltaSeconds, maxCurveShorteningDeltaSeconds)`), 012 P8 ("`step` ... validated against the configured bounds") and the notice "to be confirmed" in 012 P8.
- **`engine.noticeBehindRealTime` is a client-to-engine path outside commands, slots and `publishBody`:** it is not on the list in 013 section 5.7. Found in review; the design should either list it or give the notice another way in.
- **`defaultSimulationClockOptions` is a constant nothing can override yet:** "options of the experience" holds in name only until an experience can choose them.
- **`ClockAdvance.behindSeconds` is read only by tests.** The job requires it, but the shell reads `takeBehindNotice` instead.
- **Below 30 fps \(h\) is shorter than the frame period,** because `maxTickSeconds` wins over the rule that \(h\) is never shorter than a frame.
- **Time lost with no report:** frame time is lost without any `behindSeconds` when a frame throws before `advance`, and the remaining ticks are lost when `engine.step` throws.
- **`carry/detach` is resubmitted in frames with no tick** (from the review, not reproduced). It is harmless: the command is idempotent.
- **Jitter still gives frames of 0 and 2 ticks:** with 1 ms Gaussian jitter at 72 Hz, measured with the final clock on 100000 frames, 2.8 percent of frames have 0 ticks and 2.8 percent have 2.
- **`runClockFrame` in `tests/support` is a copy of the shell loop,** so the real loop is covered only by smoke.
- **Stated limits, reviewer's numbers, not rerun by me:**
  - Wider parity costs still wander: 60 Hz with costs of 1 and 12 ms, \(h\) 16.85 to 25.00 ms, 2614 changes over 300 s; 90 Hz with 2 and 10 ms, 19.4 to 20.4 ms, 700 changes. 30 of 32 tried pairs were stable. The 6 s in the parity test is narrow: 90 Hz with 5 and 9 ms last changes at 6.6 s.
  - The even median fixes only a period-2 cadence: short, short, long, long gives 6979 changes in 6980 frames; random double frames at 72 Hz with probability 0.3 give 1966 in 20000.
  - Rounding has two stable cycles on a two-period cadence, 1, 1 and 0, 2 ticks, chosen by the starting phase; `tickSeconds` does not show which. A cold start on \(1/60\), \(1/30\) s settles at 0, 2.
  - 0.1 ms of jitter at 72 Hz changes \(h\) in 63.4 percent of frames, range 13.74 to 14.05 ms.
  - The ring-full branch in `createRecentLoad` needs more than about 1000 Hz; no test or display reaches it.
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
- Second repair round, which does not touch `createThreeApp.ts`: `npm run typecheck` exit 0; `npm test` exit 0 (172 files, 1505 tests); `npm run docs:generate` exit 0; `npm run docs:check` exit 0. Release tier, smoke and bench not rerun in this round, as the coordinator said: it reruns the gate.
- Share over half a second (8491694), which does not touch `createThreeApp.ts`: `npm run typecheck` exit 0; `npm test` exit 0 (172 files, 1501 tests); `npm run docs:generate` exit 0; `npm run docs:check` exit 0. Release tier, smoke and bench not rerun in this round, as the coordinator said: it reruns the gate.
- First repair round (d95c5c0), which does not touch `createThreeApp.ts`: `npm run typecheck` exit 0; `npm test` exit 0 (172 files, 1493 tests); `npm run docs:generate` exit 0; `npm run docs:check` exit 0. Release tier, smoke and bench not rerun in this round, as the coordinator said: it reruns the gate.
