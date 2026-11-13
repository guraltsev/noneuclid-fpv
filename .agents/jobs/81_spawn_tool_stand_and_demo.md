# Job 81 - Spawn framing, a help cube that says "click me", the tool stand and the demo

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) sections 9.1, 9.2,
9.3, 9.6 (F1, F4, F15).

## Goal

In every activity world the first frame shows the help cube, a tool stand holding the tools as objects, and a small
demo (a laser firing a beam with a ruler measurement on it, and a sign "Start"), with open space behind. Use on a tool
on the stand takes that tool.

## Depends on

Jobs 75 (belt selection path), 79 (help). Branch `dev`.

## Before you start

- `src/authoring/worldBuilder.ts` (`WorldBuilder`: `startingQuestionCube`, `startingPosition`, `OnFace`,
  `startingHouse`), `src/authoring/validateAuthoringSpec.ts`, `src/authoring/compileWorldScript.ts`.
- World scripts `src/examples/001-basic-cube.world.js`, `002-basic-tetrahedron.world.js`, `torus.world.js`,
  `genus-2-torus.world.js`, `torus-moduli.world.js` and the configs `public/001.config.js` … `005.config.js` (which
  world each activity loads).
- How objects are registered: `src/world-objects/runtimeObjectRegistry.ts`; the help cube's world object.
- How modules create lasers, beams, measurements and signs (their engine commands), and how a world spawns initial
  objects, if it does.

## Decisions

1. `startingPosition(face, { ..., faceToward: "<objectId>" })` computes the yaw that faces the object. Add it to the
   authoring types and validation.
2. Spawn framing test, `tests/authoring/spawnFraming.test.ts`, over the activity worlds: the help cube's center is in
   the central third of the start view horizontally (field of view 75° unless the app uses another value; read it),
   and no static object lies closer than 1.5 m along the view ray. Fix each activity world's start pose until it passes
   (the torus-moduli spawn fails today; it faces the house wall).
3. Help cube label: a floating "? Help" text over the cube and a slow bob (amplitude 3 cm, period 2 s) until it has been
   opened once in the session.
4. `toolStand(face, { position, facing })`: a new static world object, a low table with one item per enabled tool
   (simple primitives are fine: a small cylinder for the laser, a flat bar for the ruler, a half disc for the
   protractor, a small board for the sign, a rolled cylinder for the map), each a separate focusable part labelled with
   the tool name. Use on an item selects that tool through the same path as the belt, and pushes the toast
   "<Tool> · press <key> next time" (desktop) or "<Tool> · it is on your belt" (VR).
5. `demo(face, { laser: { position, yawDegrees, beamLength }, ruler: true, sign: { position, text } })`: creates
   ordinary objects at world start through the modules' normal commands (not special objects): a laser with one beam,
   a length measurement of that beam, a sign with the given text. They behave like student-made objects (Start over
   removes them and they come back on reload, as world-start objects do). If the engine has no world-start object
   path, add the smallest one that runs the commands once after the world loads, and record it.
6. Activity worlds (the five configs) get a stand and a demo near the spawn, with the demo beam crossing an edge where
   the face is small enough. `full`/`default` configs and the plain Platonic worlds get none.
7. Landmarks: add `landmark: true` to static objects that are a face's landmark, in 001 (already has them) and 002
   (add one per face from the existing asset library). The per-face check is a unit test: every face of 001 and 002 has
   exactly one landmark.

## Steps

1. Baseline.
2. `faceToward` and the spawn framing test; fix the start poses.
3. Help cube label.
4. Tool stand object and its Use path.
5. Demo objects.
6. Landmarks.
7. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP on `?config=001`: the first frame focus candidates include the help cube and the stand; Use on the stand's laser
  selects the Laser (`selectedTool`).

## Do not

- Add discoveries or curiosity markers (job 82).

## Done when

Every activity world passes the framing test and has a stand and a demo, the cube invites a click, checks pass, commit
on `dev`, report appended.
