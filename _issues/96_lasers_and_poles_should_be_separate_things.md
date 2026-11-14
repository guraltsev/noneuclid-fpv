# 96 - Lasers and poles should be separate things: a laser is carried in the hand and can be tied to a pole

Status: open. Design issue; nothing is implemented.

Reported by the maintainer on 2026-11-13, after the placement preview of the Laser was changed to a translucent copy of the real model.

Priority: P2 (conceptual and a change of the interaction, not a defect).

Related: [84](84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (modules and tools),
[89](89_rotate_aim_and_carry_bypass_the_tool_gates.md) (carry and rotate go around the tool gates today).

## Summary

Today one object, the emitter (`geodesicEmitters/emitter`), is a laser on a pole: the post and the lightsaber head are drawn as
two parts of one object (`collectGeodesicBodyPlacements` in `src/render/three/geodesicCannonRenderer.ts`), the Laser tool
places the pair with one click on the floor and fires the first beam at once, and the object has one pose. The two things are
different in the student's mind and should be different in the world:

- A **pole** is a fixed thing that stands somewhere. It is a place a laser can be fixed to.
- A **laser** is a tool-like object. It is **carried in the hand**, and a student can **tie it to a pole** (and take it off again).

## What the maintainer asked for

1. Separate lasers from poles conceptually: two kinds of object, not one object with two meshes.
2. A laser is carried with the hand (the Laser in the belt is the laser in hand), shown off the cross hair where the hand is and pointing at the aim; in VR it is the controller's laser pointer (see the section on the laser in the hand).
3. A laser can be tied to a pole. Tied, it stands where the pole is and fires from the pole's height; free, it is in the hand.

## The laser in the hand (added 2026-11-13)

A laser is generally carried by hand, so it is drawn where a hand would hold it and it points where the student aims:

- **Desktop:** the laser is not at the cross hair. It sits a little off the centre of the view (lower and to the side, where a
  right hand would be) and is turned to point at what the cross hair aims at, so its beam leaves the laser and meets the aim point.
  The aim itself is unchanged: the cross hair still decides where the beam goes.
- **VR:** the laser is literally a laser pointer in the student's hand: it follows the controller or the tracked hand, and its
  beam is the controller's aim ray.
- The same laser object serves both; only where the hand is differs between the modes (the desktop's hand offset is a fixed
  pose in the camera's frame, VR's comes from the controller pose).
- The beam placed from a laser in the hand starts at the laser's tip, so it is seen to come out of it, not out of the eye.
- The placement ghost of today (a translucent copy of pole and laser at the floor aim point) belongs to the pole alone once
  this lands: a laser in hand needs no ghost, and a laser about to be tied to a pole shows the tie, not a floor copy.

## The pole is a module of its own (decided by the maintainer, 2026-11-13)

Poles are a separate module (a sibling of `geodesicEmitters`, not part of it). It owns the pole kind, its commands and its
client part, and it knows nothing of geodesics. A pole can have **a laser emitter tied to it**, and a tied laser keeps all the
behaviour a laser has today:

- **Free rotation.** A laser tied to a pole turns on it freely about the vertical axis, for example while a geodesic flows
  (the beam follows the laser as it turns; today this is the rotate mode of the Laser, `isEmitterMode` in
  `src/ui/toolBeltDefinition.ts`). The pole does not turn with it: the laser's yaw is its own state, the pole's pose is the pole's.
- **Being carried.** A pole with a laser tied to it can be carried by hand (today carry lifts the whole emitter). The laser goes
  with it and its beams follow, with the same reach and portal handling carry has now. A laser can also be carried alone,
  untied (see the laser in the hand).
- **The tie.** The tie is a relation the pole module and the emitter module share through a declared interface (the way
  modules reach each other through `ModuleToken` APIs and queries, not by reading each other's state), so the poles module
  does not import the emitters and the emitters do not draw poles. Which side owns the relation, and its name (not "tie": that
  word means tying geodesics, see below), is for the design note.
- **Removing.** Removing a pole with a laser tied to it leaves the laser, free (or removes both: see the open questions).
- **The pole alone is useful.** A pole with nothing tied to it is a thing in the world a laser can later be tied to, and is
  where other things could be fixed in the future (signs, the protractor) without touching the laser.

## Where the single object shows today

- `src/modules/geodesicEmitters/`: the emitter kind, `geodesicEmitters/place` (one command makes the stand and the first beam) and
  `geodesicEmitters/shoot`; the emitter has one cell-local pose and an `aimYawRadians`.
- `src/render/three/geodesicCannonRenderer.ts`: the post and the head are body parts of one object; the head is yawed to each
  geodesic's launch tangent, the post at the emitter pose.
- `src/render/three/laserPreview.ts`: the placement ghost is the post and the head together.
- Carry (`carriedGeodesicCannon.ts`, `cannonToolState.ts`) already lifts the whole emitter by hand, so carrying is an
  action on the pair, not a property of a laser alone.
- The word "tie" in the code (`geodesicModel/tie`) means tying geodesics to each other, which is a different idea and must not
  be confused with tying a laser to a pole; the name of the new action needs its own word (see the open questions).

## Open questions (for the maintainer, before a design note)

- Does a pole exist before a laser does (poles standing in the world as scenery or tool-stand items, the laser tied to one when
  the student chooses), or does placing a laser still place a pole for it unless one is already there?
- Can a laser be fired free in the hand (a beam from the laser's tip toward the aim), or only after it is tied to a pole?
- Where exactly does the desktop hand sit (offset and size on screen), and does it follow the head bob and the turning with a little lag?
- Does the beam leaving the hand pass through the portal frame the way the player's own view does when the hand is near a wall?
- Is a pole carried as itself (poles in the hand) or only by being picked up with its laser; and can a pole be placed with nothing on it?
- Can one pole hold more than one laser, and can a laser be moved from one pole to another?
- What becomes of the beams of a laser when it is taken off its pole: do they stay where they were, or go with the laser?
- How do existing worlds, saved states and the Laser tutorial pages change?

## Acceptance for a later job

- A pole and a laser are two registry kinds with their own commands, the pole in its own module; a laser has a state "in the hand" or "tied to pole P".
- A laser tied to a pole turns freely (also while a geodesic flows) and the pole with its laser can be carried; both work through the module interface, with no import between the two modules (the layer check of issue 78 stays green).
- The belt's Laser slot carries a laser; tying, untying and the pole are visible in the focus tooltip and in the help text.
- On the desktop the laser in the hand is drawn off centre and points at the aim point; in VR it follows the controller.
- The geodesic model needs no change: a beam still starts from a point and a direction.
- Tests of the module cover place a pole, carry a laser, tie, untie, remove a pole with a laser tied to it.
