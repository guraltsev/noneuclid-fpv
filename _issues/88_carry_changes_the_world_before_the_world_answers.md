# 88 - Picking up an emitter changes the world and the tool before the world answers

Status: open.

Priority: P2 (correctness; a refused pickup destroys geodesics). Found 2026-11-05.

Jobs: [64](../.agents/jobs/64_emitter_edits_and_length.md).

## Problem

`startGeodesicCannonCarry` (`src/render/three/geodesicCannonTools.ts`) runs, in this order:

1. `prepareGeodesicCannonForLift`, which deletes the emitter's plain geodesics;
2. `enter-tool-mode`, which switches the client to the carry tool;
3. `engine.submit` of `carry/attach`.

`carry/attach` can be refused (`carry/alreadyCarried`, `carry/notCarriable`, `carry/outOfReach`). By then the geodesics are gone
and the tool has switched. Design 013 section 7 makes pickup a world decision, and section 8.1 says the client does not switch
tool until the world confirms. With one participant a refusal is rare; with two it is ordinary.

The lift is also a direct world write from the shell (section 5.7): it belongs inside the command.

## Done when

- `carry/attach` itself removes the plain geodesics, only on success.
- The client enters the carry tool only on an accepted attach.
- A test: a refused attach leaves the emitter's geodesics and the client's tool unchanged.

- Job 64 (2026-11-05): done, needs review; see the Report in [the job](../.agents/jobs/_done/64_emitter_edits_and_length.md). Manual checks are not done, so this stays open.
