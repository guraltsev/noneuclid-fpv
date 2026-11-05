# Job 64 - Rotate, aim and carry through the world; a free geodesic keeps its length

Status: queued.
Resolves: issues [88](../../_issues/88_carry_changes_the_world_before_the_world_answers.md),
[89](../../_issues/89_rotate_aim_and_carry_bypass_the_tool_gates.md) and
[93](../../_issues/93_a_free_geodesic_forgets_its_length_when_the_tool_ends.md).

## Goal

Rotate, aim and carry ask the world first and change it only through it. A free geodesic stops at a corner, keeps its length, and extends as
soon as the corner is cleared, even across tool sessions.

## Depends on

Job 63.

## Before you start

- Read the three issues and 013 sections 5.4, 5.7, 7, 8.1 and 13.1. Read `updateActiveGeodesicCannonRotation`, `updateActiveGeodesicCannonAim`,
  `startGeodesicCannonCarry` and `src/modules/carry/module.ts`.

## Decisions

- **Length.** New real field on the arc, `intendedLengthMeters`, set by `shoot` and `extend`. Every rebuild of a free geodesic traces to it. It
  applies at a wall as at a corner: the trace stops at whatever is in the way and the arc keeps its intention. It replaces the closure
  variable `geodesicCannonRotationTargetLengthMeters` and `rotationTargetLengthMeters` on the carry attachment. `extend` raises it; a measured length
  still reports the real path. Declared `saved`.
- **Edit attachment.** Rotate and aim are one relation, "this participant is editing this emitter", as in section 7: commands
  `geodesicEmitters/beginEdit { emitterId, arcId? }` and `/endEdit`, with control slot `geodesicEmitters/yaw`, an absolute yaw. The client computes
  the yaw from its aim or its turn input; rays never reach the world. Each step, phase 3, the emitter takes the slot's yaw and its free geodesic
  is re-traced. `endEdit` applies the connection and snap of today's `finishActiveGeodesicCannonEdit`.
- `beginEdit` is refused with `geodesicEmitters/alreadyEdited` for an emitter someone else edits or carries, and `carry/attach` for one being edited.
- **Carry.** `carry/attach` removes the plain geodesics itself, on success only. `prepareGeodesicCannonForLift` is deleted from the shell.
  Lifting still deletes a plain shot geodesic (agreed 2026-11-03). The carry module requires the emitters' token and moves the emitter by
  dispatching `geodesicEmitters/moveAlong` (`moduleOnly`), so `writesCoreKinds` and its docs rule exemption are deleted.
  If the bench shows that dispatch is too slow for this path, add a row to the list in 5.7 with the measurement, and say so in the Report.
- **Gates.** `enter-tool-mode` is deleted. All three start through `world/requestTool`, and enter on `ok`. `carry/attach`, `beginEdit` and their
  siblings declare `requiresTool`.

## Steps

1. `intendedLengthMeters` and the rebuild, with the test of issue 93: end the tool while stopped at a corner, start again, clear the corner,
   and the geodesic has its full length. Also at a wall.
2. The edit attachment and slot; rotate and aim tools become the client's yaw sources.
3. Carry: attach does the lift. A refused attach leaves geodesics and tool unchanged.
4. The tool protocol. With emitters disabled by configuration, each of the three is refused with its message.

## Tests and checks

The carry tests' assertions on motion stay. Tests that assert the old order (lift, then attach) change, and each is recorded under
`### Deviations`. A manual check in the app: aim a free geodesic through a corner and back; carry through a portal. In VR: the same.

## Do not

Do not add the corner glow. Do not change what the flow does at a corner: its blocked curves are destroyed.

## Done when

`grep -rn "enter-tool-mode\|prepareGeodesicCannonForLift\|writesCoreKinds\|geodesicCannonRotationTargetLengthMeters" src tests` is empty.
