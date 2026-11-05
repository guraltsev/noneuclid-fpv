# Job 61 - Run the world in ticks owned by the simulation

Status: queued.
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
