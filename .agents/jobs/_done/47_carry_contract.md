# Job 47 - The carry contract: an object that can be carried, and what carrying means

Status: done, needs review on 2026-11-01.
Resolves: nothing fully. It implements the agreed carry policies of design 012, P4 that the current code does not meet yet
(wall in the way; a junction swept by the carry segment), and moves the carry rules out of the tool.

## Goal

An emitter declares that it can be carried (a capability on the object, like `canAttachGeodesics`), and **what carrying means is one
defined contract in `src/world-objects`**, as pure functions with tests, not code inside `geodesicCannonTools.ts`. The tool only asks
the contract where the carried object goes each frame and applies the answer.

## Depends on

Nothing. Job 46 depends on this job.

## Before you start

Own worktree and branch (see job 31, Before you start), read `.agents/knowledge/geodesic-carry.md` first (the invariants and traps), then
design 012 section P4 (carry is an attachment; the agreed policies) and the 2026-10-30 and 2026-11-01 decisions. Run the checks for a
baseline (known failure: `tests/app/appCommands.release.test.ts`). No push.

## Background

Today `src/render/three/geodesicCannonTools.ts` holds the carry rules: `resolveCarriedEmitterPlacement` (walk from the player to the hand),
`carriedEmitterRoute` (which portals the emitter crossed), the forbidden-zone check, and the call to `moveEmitterAlongRoute`
(`world-objects/geodesic/cannon.ts`, the only way to change the cell of an emitter that anchors a locked geodesic). Behaviour today:
a hand behind a wall leaves the emitter where it was on the previous frame; an emitter that touches a forbidden zone is destroyed.
Design 012 agreed instead: the object stops just short of a wall; when the carry segment (not the object) sweeps across a junction, the
emitter is dropped at its last valid position (continuity; no portal word becomes illegal).

## Decisions

- The capability is a marker on the object type (`canBeCarried?: true`, set by the constructor of the emitter), checked by the contract.
- Carrying is defined as **a stream of displacement messages** (maintainer, 2026-11-01): the carrier says "move by this displacement"
  and **the object decides how it reacts**. The emitter's reaction is the contract; the carrier (a hand, a bot, a script) knows nothing
  about walls, portals or geodesics. The same walk that moves the player and dynamic objects (`walkDevelopedSegment`) moves the carried
  object, so the portals crossed are read off the walk, not inferred from positions (this replaces `findNearestImageRoute` for carrying).
- The contract, in a new module `src/world-objects/carry.ts`, is stated in its header comment and consists of:
  - the message: a **displacement step**, a vector in the carried object's current cell frame, at most a stated cap long (the engine is
    correct for any step up to the cap, design 012 P8). Messages are applied in order and are never merged: the sum of displacements is not
    the path, and a merged step can have a different homotopy class than the steps it replaces;
  - the sender's job (the tool's adapter, not the object): turn the hand's target into steps as target minus the object's current place,
    split into several steps when longer than the cap. Computing each step from the current place means drift corrects itself, and a lost
    frame loses nothing;
  - **pickup is smoothed, not a jump** (maintainer, 2026-11-01): picking an object up starts the stream; the object glides to the hand in
    ordinary steps at no more than a stated maximum speed (a named constant, about 20 m/s), so it never teleports and every move obeys the
    same reaction rules. Each frame the direction of the glide is the nearest valid straight development from the object to the hand (a
    short search over a few portals, today's `findNearestImageRoute`, valid only if the straight segment really crosses those portals);
    this is the one place a convention is needed, and it is the only job of that search. If the hand moves faster than the cap the
    object lags behind it. A glide that would pass through a junction's exclusion zone stops at the last valid position (the agreed
    swept-junction policy);
  - input of the reaction: the world, the registry, the object and one step; output a plain value `{ placement, route }` or `{ stay: reason }`;
  - re-homing every call: the pose is valid in the cell that contains it; the route is the crossings of the walk;
  - wall: the object stops just short of the wall (a small stated margin); junction swept by the segment: the object stays at its last
    valid position; a locked geodesic must never end with a word that does not chain (use `moveEmitterAlongRoute`, which refuses such a move);
  - orientation: the object keeps its physical direction, so its yaws turn with the faces crossed;
  - release: detach only; nothing is recomputed except the final geodesic rebuild without the carry-time safety net.
  - result: a plain value `{ placement, route }`, or `{ stay: reason }`; the contract does not touch the registry itself.
- One carrier per object (first come, first served) is stated in the contract; enforcing it is the session's job (job 46).
- An emitter that touches a forbidden zone directly keeps being destroyed (unchanged; the agreed policy is only about the swept segment).
  Note in the Report if you find this inconsistent with the sweep rule.
- **Planned change, not in this job** (maintainer, 2026-11-01): after gravity and dynamics exist, touching a forbidden zone ends the carry
  and kicks the emitter about 50 cm straight away from the junction's centre, and it flies. Make that a one-function change later: the
  reaction's outcome type has `{ detach: { impulse?: Vec3 } }`, used now (with no impulse) for the drop at the last valid position.
  The kick keeps the emitter on its side of the junction, so locked geodesics stay chained (a slide around the vertex would not).

## Steps

1. Write `src/world-objects/carry.ts` with the message type, a pure `reactToDisplacement(...)` (the emitter's reaction), the
   "steps toward a target at no more than the maximum speed" helper that the sender uses (it covers pickup too) and the capability marker; add the header comment that states the contract in words, including the step cap and
   "never merged".
2. Tests first, in `tests/world-objects/carry.test.ts`, for the scenarios design 012 lists: carrier and object in one cell; the object one
   and two portals away; the carrier crosses a portal while carrying; the segment swept across a junction (object dropped at its last
   valid position); the segment against a wall (object stops short); a locked geodesic kept chained through all of it; orientation turned
   with a quarter-turned face. Make them fail for the right reason before implementing.
3. Implement the reaction by moving the logic out of the tool (placement walk, route, yaw turn), keeping `moveEmitterAlongRoute` as the
   mutation point. Add tests that a long target is applied as several steps in order, that a lost frame does not change the final place,
   and that applying one big merged step to a path that winds around a junction is not equivalent (documenting why steps are never merged).
   Add pickup tests: an emitter on another face glides to the hand over several frames without ever jumping (no frame moves it more
   than the cap), its locked geodesic stays chained at every frame, and picking up and releasing at once leaves it where it was.
4. Make `geodesicCannonTools.ts` send the steps: it computes target minus current place each frame, splits by the cap, and applies the
   reaction. Keep `tests/render/geodesicCannonCarry.test.ts` green unchanged (it is the behaviour guard);
   the glow stays at the hand in the player's frame.
5. Regenerate the documents and run all checks.

## Tests and checks

`npm run typecheck`, `npm test`, `npm run docs:check`, `npm run test:release` (known failure: `appCommands.release.test.ts`). No test
weakened; the existing carry tests must keep passing as written.

## Do not

- Do not change the portal-word rules or `moveEmitterAlongRoute`'s all-or-nothing behaviour.
- Do not add state to the tool for the contract's sake: the session holds only the carried object's id and the offset (job 46).
- Do not put Three.js types in `src/world-objects` (the layer rules fail `docs:check`).

## Done when

- `src/world-objects/carry.ts` states the contract and is covered by the tests above; emitters declare `canBeCarried`.
- `geodesicCannonTools.ts` contains no placement or route logic for carrying, only calls and applying the result.
- The two agreed policies (stop just short of a wall; drop at the last valid position on a swept junction) hold and are tested.
- All checks pass (apart from the known timeout) and a `## Report` is appended.

## Report

### Done
- `src/world-objects/carry.ts` states the contract in its header and implements it, with no Three.js and no registry access:
  `canBeCarried` (the marker; `GeodesicCannonObject.canBeCarried?: true`, set by `createGeodesicCannonObject`), `reactToDisplacement`
  (one step in the object's current cell frame, at most `carryStepCapMeters` = 1 m; returns `{ placement, route, stoppedByWall? }`,
  `{ stay: reason }` or `{ detach: { impulse? } }`), `locateCarrierTarget` (where the hand is; a wall stops it just short),
  `displacementToTarget` (the nearest valid straight development: today's `findNearestImageRoute`, 2 portals first, 6 for a pickup) and
  `carryTowardTarget` (the stream: step = target minus current place, cut to the cap and to `carryMaxSpeedMetersPerSecond` = 20 m/s times the
  time passed, each step through the reaction and a caller-supplied `commit`). The portals crossed are read off `walkDevelopedSegment`, and the
  yaw turns with the composed crossings.
- `geodesicCannonTools.ts` no longer holds placement, route or yaw logic for carrying (`resolveCarriedEmitterPlacement`, `carriedEmitterRoute`
  and their constants are gone); `updateCarriedGeodesicCannonPose` asks `locateCarrierTarget`, runs `carryTowardTarget` with a `commit` that
  applies the forbidden-zone rule and `moveEmitterAlongRoute`, rebuilds the geodesic once per frame and draws the glow at the hand. It takes
  an optional `deltaSeconds` (createThreeApp passes the frame time). A `detach` outcome finishes the carry.
- Tests: `tests/world-objects/carry.test.ts` (22: one cell; one portal; two faces; the cap; wall stop; swept junction, a legal portal crossing
  inside the zone, body radius, an end inside a zone; yaw turn on the cube; several steps in order; a lost frame; steps are not merged; refused
  commit; pick up and release at once; hand locating; a locked geodesic whose portal word is checked to chain after every committed move, over a
  glide from another face at the speed cap and over a two-face carry) and `tests/render/geodesicCannonCarryPolicies.test.ts` (3: the tool stops
  short of a wall, drops the emitter at its last valid position on a swept junction, glides at no more than the speed cap).
  `tests/render/geodesicCannonCarry.test.ts` is unchanged and green.

### Deviations
- The reaction takes no registry: it does not need one. The only veto a registry can give, a locked geodesic's word refusing a move, is
  `commit` returning false (`moveEmitterAlongRoute` is still the one mutation point and stays all or nothing).
- Without `deltaSeconds` (the tests of the existing carry guard call the tool without time) the glide is not rate limited, though every
  step is still at most the cap; the app always passes the frame time, so the 20 m/s limit holds there. The per-call limit is 64 steps.
- The hand behind a wall is not "the emitter stays" any more: the hand is clamped just short of the wall and the emitter glides there
  (the agreed wall policy applied to the hand as well as to the object's step).
- Removed the now unused `carriedGeodesicEmitterPoseToleranceMeters` from `carriedGeodesicCannon.ts`.

### Uncertain
- An end inside an exclusion zone is reported as a placement and the tool still destroys the emitter, as the job says. This is inconsistent with
  the sweep rule at one edge: a step that stops at a wall inside a zone (wall near a corner) destroys the emitter, while a step that merely
  passes through the zone drops it. The planned change (a kick away from the junction) removes the case.
- The nearest valid development can pick the way round the other side of a cube corner for a pickup, so a hand straight "below" an emitter may be
  reached through a neighbouring face. That is the existing convention (the job names it), not new behaviour.
- The exclusion test widens the zone by the emitter's body radius (0.3 m for the cannon) so that a swept step and a step's end use the same
  zone; the old code only tested the end. A step passing between 0.15 and 0.45 m from a corner now drops the emitter.
- The speed cap and the glide were exercised by tests with the real tool; no hands-on VR or desktop run was done.

### Not done
- One carrier per object is stated in the contract; enforcing it is the session's job (job 46).
- The planned kick (`detach.impulse`) is not implemented, only the outcome slot.

### Checks
- Baseline (branch `job-31` at `8708a16`): as recorded in job 31.
- After: `npm run typecheck`, `npm test` (1060 tests), `npm run docs:check` green; `npm run test:release` 10 of 11, only `appCommands.release.test.ts`
  ("changeWorld switches to the requested world") failed with the known `Runtime.evaluate` CDP timeout.