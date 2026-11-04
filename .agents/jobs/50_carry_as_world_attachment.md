# Job 50 - Make carrying a world attachment

Status: queued.
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
