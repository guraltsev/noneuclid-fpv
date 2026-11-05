# 93 - A free geodesic forgets its length when the aim or rotate tool ends

Status: open.

Priority: P2 (correctness). Rule set by the maintainer on 2026-11-05.

Jobs: [64](../.agents/jobs/64_emitter_edits_and_length.md).

## The rule

A free geodesic that is aimed or rotated through a corner is not destroyed. It stops at the corner, it remembers its length, and it
extends again as soon as the corner is cleared. A later job adds a glow on the corner while a geodesic is stopped there.

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
- The same holds for a stop at a wall, unless the maintainer decides otherwise.
