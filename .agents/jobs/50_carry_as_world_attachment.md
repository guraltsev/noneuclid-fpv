# Job 50 - Make carrying a world attachment

Status: done, needs review on 2026-11-03.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirement 1).

## Goal

Who carries what is world state. A pickup and a release are commands, the carry offset is a control slot, and a second
pickup is refused. `CarryRecord` leaves the client session.

## Depends on

Job 49.

## Before you start

- Own worktree and branch (`git worktree add ../noneuclid-job50 -b job-50 <branch with job 49>`).
- Read design 013: sections 5.4, 7, 14, and job 50 in section 15.
- Read the project note "Carrying an emitter of a locked geodesic" (`know_search`, or
  `.agents/knowledge.d/notes/K-20261104-bb27.md`). It holds the invariants and the test traps of this code.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

The carry rules live in `src/world-objects/carry.ts` (job 47): the carrier sends displacement steps, at most 1 m, never
merged. `geodesicCannonTools.ts` locates the hand, runs `carryTowardTarget` and stores each move through
`moveEmitterAlongRoute`. `src/interaction/handCarry.ts` holds the hand's leash policy. What is rebuilt after a move is the
emitter's rule, in `world-objects/geodesic/carryEnd.ts`.

## Decisions

- The move runs in step phase 3, by the job 47 contract. Its rules do not change.
- The emitter's carry contract, including the rebuild of its arcs, stays in world-objects code in this wave and runs from
  the carry move. Phase 3 comes before the flow in phase 4, so the flow sees arcs already rebuilt.
- `arrived` becomes a field of the attachment, because it changes how the object moves.
- A junction drop ends the attachment in the engine and emits `carry/dropped { participantId, objectId, reason }`; the client
  leaves its carry tool.
- `carry/detach` is only a detach (012 P4). The final rebuild runs as it does today.
- First come, first served: a second attach is refused with `carry/alreadyCarried`.
- The leash stays the hand's policy, in `handCarry.ts`, on the client.

## Steps

1. `src/modules/carry/` (12.1): commands `carry/attach`, `carry/detach`; slot `carry/offset`; refusals
   `carry/alreadyCarried`, `carry/notCarriable`, `carry/outOfReach`; the phase 3 move; `carry/dropped`. Add it to the
   experience.
2. `CarryRecord` leaves the client session; `arrived` moves to the attachment. Everything reading `session.carry` reads
   the participant's attachment.
3. The carry tool submits attach and detach and sets the offset slot each frame. The carried-emitter geodesic rebuild keeps
   working. Remove the files this empties from `legacyWorldWriters`.

## Tests and checks

- Attach; a second attach by another participant refused; detach; the junction drop event.
- The existing carry tests pass unchanged. In `tests/render/geodesicCannonCarry.test.ts` the player must stand somewhere a
  player could, with the hand elsewhere.
- The release-tier scenario of carrying through a portal.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not change `reactToDisplacement`, walls, zones or the leash.
- Do not change the cell of an emitter except through `moveEmitterAlongRoute`.
- Do not add a message bus or bubbling: that is a later design (section 17).

## Done when

- `grep -rn "CarryRecord" src/runtime` is empty, and carrying through a portal works in the app.
- All checks above are green.

## Report

### Done
- `src/modules/carry/` (`api.ts`, `module.ts`, `index.ts`): commands `carry/attach`, `carry/detach` and the module-only `carry/drop`; slot `carry/offset` (`{ x, y, leashMeters }`); refusals `carry/alreadyCarried`, `carry/notCarriable`, `carry/outOfReach`; events `carry/moved`, `carry/released`, `carry/dropped`. The move is a "bodies" tick (step phase 3): `locateCarrierTarget`, `carryTowardTarget` (`maxTravel = 20 m/s * step seconds`), `moveEmitterAlongRoute`, then `rebuildEmitterGeodesics` (safety net on), `arrived` set on the attachment, then the hand's policy from `handCarry.ts` (`decideHandCarry`) with the loose leash taken from the slot. Detach and drop run `releaseCarriedEmitter` (final rebuild) in the engine. `src/runtime/experience.ts` (new) lists the default modules; `createThreeApp` composes them.
- Engine core: `ParticipantRecord.attachments` (`ParticipantAttachment`: kind, objectId, `arrived`, `activeGeodesicId?`, `rotationTargetLengthMeters?`) with `participantAttachment()`; `setAttachments` and `forEachParticipant` on the step/command contexts (the former writes the participant journal); a third tick phase `"bodies"` run between control sampling and the simulate ticks (phase 3, `runBodies`); `ModuleDefinition.writesCoreKinds` for the write guard.
- `CarryRecord`, `session.carry` and the commands `begin-carry`, `end-carry`, `carry-arrived` are gone (`grep -rn CarryRecord src/runtime` is empty). The carry tool (`geodesicCannonTools.ts`) submits `carry/attach` (pending ticket; a refusal leaves the tool) and `carry/detach`, sets the offset slot each frame, detaches when the carry tool was left another way, and has a new `afterWorldStep()` (called by the shell after `worldClient.afterStep()`) that refreshes measured lengths and protractor angles from `carry/moved` and `carry/released` and leaves the tool on `carry/dropped`. `runtimeObjectInstanceSync` reads the carried id from the participant's attachment. `getRuntimeObjectInteractionRangeMeters` moved to `src/world-objects/interactionRange.ts` (re-exported from `rootAimRay.ts`) so the module can check reach.
- Tests: `tests/modules/carry.test.ts` (attach, detach, second attach by another participant refused, notCarriable, outOfReach, full hand, module-only drop, phase 3 before simulate ticks, carrying through a portal with the geodesic kept joined, `arrived`, leash drop event, missing-object drop), additions in `tests/engine/worldEngine.test.ts` and `composeModules.test.ts`, a release scenario in `tests/app/worldEngine.release.test.ts`, the fake `tests/support/carryTools.ts`. Generated docs regenerated.

### Deviations
- Design 013 job 50 speaks of a "junction drop". Job 47 and the maintainer rule of 2026-11-01 made a junction's zone a wall that never ends a carry, so there is no junction-specific drop. `carry/dropped` is emitted when the world ends the carry itself: the hand's leash releases the object (`reason: "leash"`, too far or unreachable) or the object no longer exists (`reason: "missing"`). The leash policy itself is unchanged and still in `handCarry.ts`; the engine module applies it (the client sends the loose leash in the slot).
- Added the module-only command `carry/drop` (the job lists attach/detach only); it is how the tick ends a carry through `ctx.dispatch`.
- Added `ModuleDefinition.writesCoreKinds` and a "bodies" phase to the engine; neither is in design 013 section 9.1. Needed because the carry module moves emitters and rebuilds geodesics (core kinds) before `geodesicModel` exists, and phase 3 had no hook.
- `scripts/docs/lib.mjs`: `modules/carry/` is exempt from the rule that modules reach `world-objects/geodesic/` only through the geodesic model (it runs `moveEmitterAlongRoute` and `carryEnd.ts`, as the job's Decisions require). `legacyWorldWriters` was not shrunk: `geodesicCannonTools.ts` and the other listed files still import other registry mutators.
- Tests, no assertion changed:
  - Removed the `describe("applyRuntimeCommand: carrying")` block of `tests/runtime/applyRuntimeCommand.test.ts` (9 tests of `begin-carry`, `carry-arrived`, `end-carry` and the session record); that behavior moved to the engine and is covered by `tests/modules/carry.test.ts`. Also removed `carry: undefined` from the `stateWith` fixture and from `tests/support/clientSession.ts`.
  - `tests/render/carryHighlight.test.ts`: the three fixtures that passed `createTestClientSession({ carry })` now pass `createTestEngine({ carrying })` (a new option of `tests/support/engine.ts`); assertions untouched.
  - `tests/render/geodesicCannonCarry.test.ts` and `geodesicCannonCarryPolicies.test.ts`: the harness builds its engine with the carry module and the real world, and wraps the tools in `driveCarryTools` (one `engine.step`, `afterWorldStep` and `endFrame` after each start, update and finish; an update with no time argument steps 1000 s, standing in for "no limit"). Set-up the job asked for: the pickup is now refused out of reach, so "keeps the geodesic when an emitter on another face is picked up and let go" has the player at `right (-2.4, -3)` (it was `top (0, 0)`, 19.6 m from the emitter) with hands at `(-2.4, 8)` and `(-2.4, 8.3)` past the wall into top; "keeps the geodesic ending in the emitter's cell ... drag across two faces" has the player at `right (-2.4, -3)` (was `(0, 0)`, 5 m away); the junction-zone policy test has the player at `(4.5, 3.5)` in room a (was `(3.5, 2.5)`, 3.8 m from the lamp, beyond the 3.2 m limit). No `expect` line changed.
  - `tests/engine/worldEngine.test.ts` fixture `ana` gained `attachments: []` (the field is required now).

### Uncertain
- Reach limit of `carry/attach`: the straight-development distance from the body to the object may be at most the object's pickup range plus the hand-leash slack (about 0.67 m). The design does not give the number. The aim system's own check (hit distance within range) still runs first in `tryStartFocusedGeodesicCannonCarry`.
- A participant that already carries something and attaches another object is refused with `carry/alreadyCarried` and the message "You are already carrying something." (not in the design's refusal list); re-attaching the same object is accepted and changes nothing. The old session record let a second pickup replace the first.
- Leaving the carry tool by any other route (another tool, the menu) now detaches in the world on the next `updateCarriedGeodesicCannonPose` and so runs the final rebuild; before, the record was just dropped with no final rebuild. `carry/detach` is idempotent (ok when nothing is carried).
- A carried object that disappears now ends the carry (`carry/dropped`, `missing`); before, the tool stayed selected holding nothing.
- The attachment carries `activeGeodesicId` and `rotationTargetLengthMeters` (what the tool formerly kept in locals) because the emitter's rebuild needs them each step; they are plain ids and numbers sent in the attach command.
- `updateCarriedGeodesicCannonPose` still takes a `deltaSeconds` parameter that it ignores (the world's step duration limits the glide); kept because existing tests call it with a third argument. The shell steps the world after its object loop, so the carried emitter now moves later in the frame than before, and a pickup takes effect one world step after the click (the first offset is applied in the next frame).
- `writesCoreKinds` of the carry module lists five geodesic kinds; with the write guard on, the tests did not need more, but a path not exercised (for example removal of a pair during a rebuild) could throw with the guard on.

### Not done
- The release-tier scenario of carrying an emitter through a portal: the public API cannot place an emitter, move the hand or set a control slot (job 45 is blocked on the maintainer). The release test covers that the module is composed in the built app (refusals and acceptance of its commands); the portal carry itself is covered at the unit tier (`tests/modules/carry.test.ts`, `tests/render/geodesicCannonCarry.test.ts`).
- The manual check in the app ("carrying through a portal works in the app") was not done: no browser session with an emitter and focus emulation was driven. The smoke test of `cube` and `torus-moduli` starts the app with the carry module composed.
- `legacyWorldWriters` could not shrink (see Deviations).

### Checks
- Baseline before changes: not run separately (the worktree is at the job 49 close commit); the first full run was after the changes.
- `npm run typecheck`: ok. `npm test`: 158 files, 1326 tests, all green. `npm run docs:check`: all ok after `npm run docs:generate`. `npm run build` then `npm run smoke -- --world cube,torus-moduli`: SMOKE OK (2 pages). `npm run test:release`: 7 files, 15 tests green. `npm run bench -- moduleStep --check`: ok (idle 0.12 us, flow 16.03 us, flow+dependents 29.51 us, idle allocation 655.5 B/step by the legacy driver, bare engine 0.8 B/step).
- Intermediate unit runs failed on hygiene rules (test names over 90 characters; a job reference in a test comment) and on `docs:check` (module import rule, stale generated docs); all fixed.
