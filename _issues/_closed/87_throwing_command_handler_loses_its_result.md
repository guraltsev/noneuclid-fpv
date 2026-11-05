# 87 - A throwing command handler loses its result, and the client waits for ever

Status: closed on 2026-11-05.

Priority: P2 (correctness; only reached through a bug in a handler, but then a tool request or an API promise never settles).

Jobs: none; a small fix in the shell's frame.

## Outcome

The shell runs the step and the client's read as separate guarded phases, so a step that rethrows still has its results read before
`endFrame`.

## Closing evidence

- `tests/render/worldClient.test.ts`: "answers a caller and a pending tool request when a handler throws". The test mirrors
  the shell's two phases; the split itself is in `createThreeApp.ts`, which no unit test drives.

## Problem

Design 013 section 5.3 says a thrown exception is contained by the frame error guard and reported as
`{ code: "world/internalError" }`. The engine stores that result, then `step` rethrows the first error
(`src/engine/worldEngine.ts`, `applyQueuedCommands` and `step`). In `src/render/three/createThreeApp.ts` the same guarded
closure runs `engine.step`, then `worldClient.afterStep()`, `toolHost.afterStep()` and `afterCarryWorldStep()`. The rethrow skips
those three, and `engine.endFrame()` then clears the results.

So nobody reads the result:

- `pendingToolRequest` stays set, and the palette waits for an answer that never comes;
- a promise from `api.world.submit` never resolves;
- the tool host's pending commands and the carry follow-up are skipped for that frame.

## Done when

- After a handler throws, the frame guard still reports the error and the client reads `world/internalError` in the same frame.
- A test shows it: a throwing handler settles a pending tool request and an `api.world.submit` promise.
