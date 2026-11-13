# Job 81 - Spawn framing, a help cube that says "click me", the tool stand and the demo

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) sections 9.1, 9.2,
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

## Report

### Done

Commit: c4e21f3 (branch `dev`).

- Authoring (`src/authoring/worldBuilder.ts`, `compileWorldScript.ts`): `startingPosition(face, { position, faceToward,
  leftOfCenterDegrees })` computes the yaw from the position of an object of the same face, resolved in `build()` so the
  object may be declared later (yaw 0 faces +y, so the yaw is `atan2(-dx, dy)` minus the offset; default offset 8 degrees
  left of the middle; errors for an unknown object or one at the start). New world-script calls `toolStand(face, {
  position, facing })` (a table "toolStand" and items "toolStand-emitter", "-length", "-protractor", "-flag", "-map",
  0.22 m apart along the table, on the 0.6 m top) and `demo(face, { laser: { position, yawDegrees, beamLength }, ruler,
  sign: { position, text } })`; both at most once per world, validated eagerly.
- Specs (`src/cell-complex/specs.ts`, `compileCellComplex.ts`, `validateCellComplexSpec.ts`): `landmark?: boolean` on
  every positioned object (also copied by `createStaticAssetObject` and `createSimpleGeoCreature`), `standsTool?` on an
  asset, `CellComplexSpec.demo` (`WorldDemoSpec`, passed through to `CompiledCellComplex`, validated: cell exists,
  numbers finite, beam length positive).
- Tool stand objects: ordinary static assets (`createToolStandTable`, `createToolStandItem` in
  `src/world-objects/library.ts`). The six models are primitives written by `scripts/assets/make-tool-stand-models.mjs`
  to `public/assets/toolstand/*.glb` (table, laser cylinder, ruler bar with ticks, protractor half disc, sign board, map
  roll); provenance row and `license.txt` added (original, CC0). Items have a small walk-through pick cylinder; the table
  blocks. The registry record of an item (`createRuntimeStaticAssetObject`) is named for its tool ("Laser"), and has the
  interaction `take-tool` ("Take the Laser", range 3.5 m); the table is the "Tool stand". Words are in
  `toolStandText` (`src/world-objects/vocabulary.ts`).
- Use path: `tryUseFocusedObjectPrimaryInteraction` calls `deps.takeStandTool(toolId)`; the shell's `takeStandTool`
  (`createThreeApp.ts`) finds the belt slot of that tool and calls `selectBeltSlot` (the belt's own path), then pushes
  "<Tool> · press <key> next time" (desktop) or "<Tool> · it is on your belt" (in VR). Focus message and hint strip say
  "Take the Laser" / "take the Laser" (`worldInteractionDefinition.ts`, `hintStripDefinition.ts`).
- The shell leaves out an item whose tool the belt cannot take in this world (config off, or the map outside a Platonic
  solid) and the table when no item is left.
- Demo (`src/render/three/worldDemo.ts`): `runWorldDemo` submits, through the world client, `geodesicEmitters/place`,
  `geodesicEmitters/shoot`, `geodesicMeasurements/createLength` (if `ruler`), `placedFlags/place` (the sign faces the
  start) and `placedFlags/setMessage`. They are ordinary objects: Start over removes them, they return on reload. No
  engine change was needed: the existing `submit` path already runs commands from the shell; `createThreeApp.ts` calls
  `runWorldDemo` once, after the objects are built. A part whose tool is off, or that is refused, is skipped.
- Help cube invitation (`src/render/three/helpCubeInvite.ts`): a "? Help" billboard (three times the emitter label
  plate) 1.55 m over the cube, shown within 9 m, and a bob of 3 cm with a period of 2 s applied to the cube record
  through `objectHost.placeAt`, until a `show-question-help` for "startingQuestionCube" goes through the shell's command
  path (the cube is then put back on its authored height). Runs in the "ui" phase of the frame.
- Worlds: the five activity worlds (001, 002, torus, genus-2, torus-moduli) get the same arrangement in their own
  face: the spawn at (0, 5) looking along -y, the help cube moved to (0.46, 1.7), the stand at (-0.58, 2.67) facing -14
  degrees, the demo laser at (1.44, 1.92) firing along yaw 200 degrees for 12 m (it crosses an edge in 001, 002, torus and
  torus-moduli; the genus-2 octagon is too large), the sign "Start" at (-0.4, 0.8). The start is `startingPosition(...,
  { faceToward: "startingQuestionCube" })` (001's explicit pose and turn 225 are gone). Nothing else in those worlds
  moved.
- Landmarks: `landmark: true` on 001's house, tree, butterfly, bench, grass and bicycle, and on 002's house (face-a),
  butterfly (face-b), tree (face-c) and stop sign (face-d).
- Tests added: `tests/authoring/spawnFraming.test.ts` (per activity world: cube in the central third of a 70-degree
  vertical, 4:3 view, stand in view, cube 2 to 3.5 m away, no collision cylinder or wall within 1.5 m along the view ray;
  stand and demo present; a negative case), `tests/authoring/spawnAndStand.test.ts` (faceToward, toolStand, demo,
  validation), `tests/authoring/landmarks.test.ts` (exactly one landmark per face in 001 and 002, all different models),
  `tests/render/worldDemo.test.ts`, `tests/render/helpCubeInvite.test.ts`, `tests/ui/toolStandFocus.test.ts`, and a
  case plus the new dependency in `tests/render/runtimeObjectActions.test.ts` (the existing harness gained
  `takeStandTool`; no assertion was changed).
- Headless Chrome (`.temp/check81.mjs`, gitignored; 1280x960, stubbed pointer lock): on `?config=001`, 002, 005 the first
  frame shows the "? Help" label over the cube, the stand with its items, the "Start" sign, the beam with its "Beam 1
  length = 12 m" label, and open space behind (screenshots read by eye; in torus-moduli the stand has no map item). Aimed
  at the laser item the tooltip is "Laser" and the hint "Left click: take the Laser"; a click puts the Laser in hand
  (belt slot `geodesicEmitters/emitter` active) and toasts "Laser · press 1 next time". On `?config=004` the same data
  was read (the page is slow in software rendering and needs a longer wait).

### Deviations

- The framing test uses a 4:3 canvas with the app's 70-degree vertical field of view (the job says 75 degrees "unless
  the app uses another value"; `createThreeApp.ts` builds the camera at 70). A wider canvas only makes the rule easier.
- `StaticObjectAuthoringParams` and the creature params gained `landmark`; creatures can carry it because 001's back
  face has only the butterfly.
- Added `scripts/assets/make-tool-stand-models.mjs` and `public/assets/toolstand/` (the job says primitives are fine and
  the registry only draws GLB files, so the primitives are generated GLB files).

### Uncertain

- The stand and demo are part of the world scripts, so they also appear when another config opens the same world (for
  example `full` choosing "torus" in its world menu). The job says `full`/`default` configs and the plain Platonic
  worlds get none; the plain Platonic worlds (cube, tetrahedron, ...) are different scripts and have none, but the
  stand shows for whatever tools `full` enables in torus, genus-2 and torus-moduli. A config switch would settle it.
- The bob moves the cube's registry record every frame while it invites (one owner publish per frame, journal entries
  for kind `asset`). It is cheap here, but a purely visual offset in the instance sync would avoid the writes.
- "No static object closer than 1.5 m along the view ray" is tested in plan view against collision cylinders (any
  height) and the cell walls; the house and the cube are not tall enough to block a level view ray, so this is the
  stricter reading.
- The tool taken from the stand also shows the older "Laser" tool-announcement toast next to the new one.
- The `? Help` label disappears when the cube's Help is opened; this was checked by the unit test and the code path, not
  in the browser.
- Torus-moduli's deformation (`torusSkew.applyToSpec`) builds a new spec without `demo`; the demo only runs from the
  first world, so a commit does not lose it, but a "world change" that reloads from a spec built that way would not
  re-run it.

### Not done

- Face names, discoveries, curiosity markers and Show edges (job 82).
- The plain Platonic worlds got no landmarks (the job asks for 001 and 002 only).

### Checks

- Baseline: `npm run typecheck` green, `npx vitest run --project unit` 2015 tests green, `npm run docs:check` green.
- After: `npm run typecheck` green; `npx vitest run --project unit` 220 files, 2051 tests green; `npm run docs:generate`
  then `npm run docs:check` green (layering, module import rules, imports, cycles, generated documents, references);
  `npm run build` then `npm run smoke -- --config 001` OK.
- `npm test` also runs `tests/app/*.release.test.ts`, which fail in this environment with "CDP command ... got no
  response within 6000 ms"; that was not run again here (pre-existing and environmental, seen on the baseline by job 80).
- Git hosting checks (Pages): skipped, `gh` is disabled.
