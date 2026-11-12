# 016 - Scripted motion (walking and looking for agents and NPCs)

Status: implemented (2026-11-11) for the local player; the NPC side has its adapter but no behavior uses it yet.

## Problem

An agent debugging the game over the DevTools channel could teleport the player (`debug.setPlayerPose`) and take
screenshots, but moving meant faking key presses through `eval`: the distance depended on the frame rate, there was
no way to say "walk to that tree" or "look at the marmot", and nothing reported a collision. NPCs have the same need
in another form: the marmot can only walk straight and bounce off forbidden zones.

## Decision

One plain-data script format, one pure runner, thin glue per walker.

- **Format** (`src/movement/motionScript.ts`): JSON, not a text language (design 007 rules out a custom DSL). A script
  is a list of steps; a step has up to three channels that run *at the same time*: translation (`walk` meters, or
  `to` a target), heading (`turn`, `yaw`, `lookAt`, `face: "motion"`) and `pitch`. "Walk and turn at once" is one step,
  `{walk: 4, turn: 90, duration: 3}`. Targets are an object id, `{cell, x, y, z?}`, or `{forward, right, up}` relative
  to the walker when the step starts. Shorthands (a bare step, a number for `walk`, a string for an object id) are
  normalized; unknown keys are errors that name the field, so a typo does not silently do nothing.
- **Errors are policies on the step** (or the script's `defaults`):
  - `onStuck`: `detour` (default: probe directions 25..150 degrees either side of the goal with trial moves and walk
    the first free one for `detour` meters, keeping to the same side next time), `retry` (back up, pause, try
    again), or straight to `fail` / `skip` / `stop`; `attempts` bounds it, and the count starts again after
    `resetAfter` meters of progress beyond the furthest point reached, so a long wall can take many detours.
    Stuck means *no progress toward the goal* over 0.4 s, not "blocked": sliding along a wall is progress.
  - `onUnreachable` (no straight route through at most `maxHops` portals), `onTargetLost` (also `lastKnown`),
    `onTimeout`.
  - `fail` ends the script with an error, `skip` goes on with the next step, `stop` ends it without error.
- **Runner** (`src/movement/motionRunner.ts`): no renderer, no clock. It is given a *trial move* (pure: where would
  this move end) and uses it both to commit each tick and to probe for detours. It runs fixed 1/60 s ticks, so the end
  pose does not depend on the frame rate. Targets in other cells are seen through their nearest image
  (`findNearestImageRoute`), re-planned when a cell changes; turns are tracked as commanded angles so a portal that
  re-expresses the heading does not disturb them.
- **Player glue** (`src/render/three/scriptedPlayerMotion.ts`): the trial move is `movePlayer` with the player's
  blocking bodies, so scripted walking collides and crosses portals exactly like the keyboard. The frame loop calls
  it instead of applying input movement. A run is cancelled by movement input (unless `userInput: "ignore"`), a pose
  change from elsewhere (reset, `setPlayerPose`), XR, a new run, or app disposal. API namespace `motion`.
- **NPC adapter** (`src/movement/dynamicObjectMotion.ts`): the trial move built on `moveDynamicObject`. A behavior
  converts its `DynamicObjectState` to a pose, calls `runner.advance`, converts back and publishes as today.

## Consequences and limits

- No path planning: `detour` is local avoidance. It walks round trees, benches and houses; a maze or a dead-end
  corridor needs a planner (a later job), and a target behind a wall with no straight route is "unreachable".
- `lookAt` aims at the nearest image and does not test line of sight; something in between hides the target.
- Reports carry what an agent needs to decide the next step: per step status, reason, time, distance walked, stuck
  events, retries, detours, portals crossed, the last thing that blocked (`object <id>` or a reason) and the end pose.
- `moveDynamicObject` / `movePlayer` results gained `blockingObjectId` for body contacts.
