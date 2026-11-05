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

- New pure file `src/engine/simulationClock.ts`: `createSimulationClock({ tickSeconds, maxTickSeconds })` with
  `advance(elapsedSeconds): { ticks: number; tickSeconds: number; behindSeconds: number }`. It keeps the accumulator.
- Defaults: `tickSeconds` \(1/90\), `maxTickSeconds` \(1/30\). They are options of the experience.
- **Load rule, in the clock only.** At most 3 ticks per frame. When the accumulated time needs more, \(h\) grows to fit, up to
  `maxTickSeconds`. What still does not fit is dropped and reported in `behindSeconds`: no queue of ticks is paid back later.
- `behindSeconds > 0` emits one `world/behindRealTime` notice with a message, at most once per second.
- `maxCurveShorteningDeltaSeconds` is deleted; `constantSpeedLaw` uses `deltaSeconds` as given. `engine.step` rejects a duration above
  `maxTickSeconds` only in the shell's use: tests keep `step(0.1)`, so `step` itself takes any non-negative duration.
- A reset frame still calls `engine.step(0)`.
- **Once per frame, not per tick:** `worldClient.afterStep`, `toolHost.afterStep` and `afterCarryWorldStep` replay every event since
  `endFrame`, so they run once, after the frame's last tick. A frame with no tick still runs them and `endFrame`.
- The local player, creatures and client tools stay on frame time until their modules exist (013 section 16). So
  `maxSimulationStepSeconds` stays for them, and is no longer given to the engine.
- A carried emitter moves in the engine's ticks, as today.

## Steps

1. `simulationClock.ts` with tests: ticks over a steady 60, 72, 90 and 120 Hz sum to real time within one tick; a 1 s hitch gives at most 3
   ticks of at most \(1/30\) s and a non-zero `behindSeconds`; no time is carried past the frame that dropped it.
2. The shell's frame runs `clock.advance`, then that many `engine.step(tickSeconds)` inside the guarded phase.
3. Delete the flow's cap. Update its doc comments.
4. Update `_docs/ARCHITECTURE.md` if it describes the frame.

## Tests and checks

A flow test: the same curve run at frame rates of 5 and 120 Hz through the clock reaches rest within 5 percent of the same simulated time.
Smoke, release tier, bench counters.

## Do not

Do not move the player, creatures or tools onto ticks. Do not change the order of 5.2.

## Done when

`grep -n "engine.step" src/render/three/createThreeApp.ts` shows only the tick loop and the reset. The shell passes no frame time to the engine.
