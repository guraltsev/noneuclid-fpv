# 93 - A free geodesic forgets its length when the aim or rotate tool ends

Status: open; done in code by job 64 (done, needs review). Closes after the desktop check. Re-verified 2026-11-11.

Priority: P2 (correctness). Rule set by the maintainer on 2026-11-05.

Jobs: [64](../.agents/jobs/_done/64_emitter_edits_and_length.md).

## Status update 2026-11-11

Every arc now stores its intended length as real state (job 64). Left: end the rotate tool at a corner, restart it, clear the
corner, and see the full length return; the same at a wall.

## The rule

A free geodesic that is aimed or rotated through a corner is not destroyed. It stops at the corner, it remembers its length, and it
extends again as soon as the corner is cleared. A later job adds a glow on the corner while a geodesic is stopped there.

The same holds at a wall (maintainer, 2026-11-05): a geodesic is a laser with a certain power, and what stands in the way does not change the power.

## What the code does

- Within one rotate or aim session the rule holds: the geodesic stops at the zone and grows back, because each rebuild uses
  `geodesicCannonRotationTargetLengthMeters`. The test "rebuilds a rotated geodesic to its remembered length after clearing a
  forbidden zone" pins this.
- The target length is a closure variable of `geodesicCannonTools.ts`, read from the geodesic's current length when the tool starts and
  cleared when it ends. So a person who ends the tool while the geodesic is stopped at the corner loses the length for good: the
  next session starts from the shortened geodesic.
- It is client state, but by the test of 013 section 4 it is world state: it changes what the world does later, and a replay must
  reproduce it.

The one path that destroyed such a geodesic, `breakOnForbiddenZone` on the carry rebuild, was removed on 2026-11-05.

## Done when

- The intended length is stored on the arc, as real state, and survives the end of the tool.
- A test: end the tool while stopped at a corner, start it again, clear the corner, and the geodesic has its full length.
- The same holds for a stop at a wall.

- Job 64 (2026-11-05): done, needs review; see the Report in [the job](../.agents/jobs/_done/64_emitter_edits_and_length.md). Manual checks are not done, so this stays open.
