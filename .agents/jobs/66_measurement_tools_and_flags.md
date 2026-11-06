# Job 66 - Move the measurement tools and the flags into modules

Status: in progress.
Resolves: issue [92](../../_issues/92_measurement_kinds_are_declared_transient.md).

## Goal

The length tool, the protractor and the flags reach the world through commands, as the emitters do.

## Depends on

Job 64.

## Before you start

- Read 013 sections 8.3, 9, 11 and 16, and 014 section 2.1. Read `src/render/three/runtimeObjectActions.ts` and `toolObjectRuntimes.ts`.

## Decisions

- `geodesicMeasurements` gains commands `createLength { arcId }`, `removeLength`, `createAngle { center, first, second }`, `removeAngle`, and a client
  part with the two tools. Ids move to `geodesicMeasurements/length:<n>` and `/angle:<n>`.
- Kinds stay materialized records, and are declared `saved`: their choices (geodesic, sides) are real, per 014 section 2.1, and their values
  are refreshed after a load. The contract test of 013 section 11 is written here.
- New module `placedFlags`: kind `placedFlags/flag`, commands `place`, `setMessage`, `remove`, a client part with the tool. It needs no ticks.
- `trackReads` stays on by default (014 D14).
- **An angle whose crossing vanishes is hidden, not deleted** (013 section 17, item 6). It returns with the crossing, and is deleted 3 s of world time after
  the aiming stops if the crossing has not returned. "The aiming stops" means the last edit or carry of either geodesic's emitter ended; with no such edit, the 3 s run from the moment the crossing vanished. Use the remembered-centre code. Test both ways: the crossing returns in time; it does not.
- The flag branch of `geometryCommit.ts` stays until the deformation job.

## Steps

1. Measurement commands and tools; each command's refusal; the kinds' declarations; the contract test.
2. `placedFlags`.
3. The list of direct client writes falls; record it in the Report.

## Tests and checks

Existing measurement assertions on values stay. Smoke, release, bench counters.

## Do not

Do not touch the deformation or creatures. Do not decide what happens to an angle whose crossing vanishes: see the open question in 013.

## Done when

`runtimeObjectActions.ts` and `toolObjectRuntimes.ts` no longer write the registry, except what a named later job owns.

## Report

### Done

Commits: `521ee6b` (names only), `2c60244` (measurements: commands, tools, hidden angles, kinds, contract test), `b56c33e` (`placedFlags`, the two files leave the writers' list); the commit holding this report also makes one assertion in `toolHost.test.ts` mean something again (see Deviations).
Baseline before changes: typecheck clean. The full suite was not run before the first edit; the first run after the names-only script had the same 1632 unit tests, its 4 failures all caused by the rename.

- **Names (`521ee6b`).** Kind `placed-flag` is `placedFlags/flag`. Tools `place-flag`, `measure-length`, `protractor` are `placedFlags/flag`, `geodesicMeasurements/length`, `geodesicMeasurements/protractor` (013 sections 8.1 and 10; composition rule 11 needs the module prefix). Action id `measure-length`, icon id `protractor`, Three.js object names, archetype key prefixes and the help topic `protractor-angle` are not tool or object ids and stay.
- **`geodesicMeasurements`.** New `api.ts`, `client.ts`. Commands `createLength { arcId }`, `removeLength { lengthId }`, `createAngle { center, first, second }`, `removeAngle { angleId }`, each with `requiresTool`. Refusals `geodesicMeasurements/notAnArc`, `notALength`, `notACenter`, `notASide`, `sameSide`, `notAnAngle`. Ids `geodesicMeasurements/length:<n>`, `/angle:<n>`. Both kinds `saved`, `trackReads` still on by default. The tools use `commandInFlight`; the protractor's picks moved from `protractorToolState` to `moduleToolState.geodesicMeasurements`, and `set-protractor-tool-state` is gone.
- **Hidden angles.** `ProtractorAngleObject.vanishedSecondsLeft`; `refreshProtractorAngleObject` hides and restores; new simulate tick `geodesicMeasurements/vanishedAngles`; `findGeodesicIntersectionNear` in `intersections.ts`; `crossingsTick` prunes the memory before the update instead of after. A hidden angle has no runtime.
- **`placedFlags`.** New `src/modules/placedFlags/`: kind `placedFlags/flag`, commands `place { cellId, point, eyePoint, flagType }`, `setMessage { flagId, message }`, `remove { flagId }`, refusals `placedFlags/blocked`, `unknownType`, `notAFlag`, `notAMessage`, no ticks, a client part with the sign tool.
- **Shell.** `syncLabelRuntimesFromJournal` is `syncToolObjectRuntimesFromJournal` and covers flags too; the shell's `tryPlaceFlagFromAim`, `tryUseMeasureLengthToolFromAim`, `tryUseProtractorToolFromAim`, `getProtractorToolPrompt`, `removePlacedFlags`, `removeMeasuredGeodesicLengths`, `removeProtractorAngles` are deleted. A world reset submits the removals, applied by the reset frame's `step(0)`. `coreTools.ts` holds only the emitter's sub-modes.
- **The writers.** `runtimeObjectActions.ts` and `toolObjectRuntimes.ts` take `RuntimeObjectReader` and left `legacyWorldWriters` and its committed copy. `npm run docs:writers`: from 7 files, 19 direct write calls, 7 mutator uses to **5 files, 9 direct write calls, 6 mutator uses**. What remains: `createThreeApp.ts` 1549 `releaseOwnership`, 1707 `remove`, 1002 `createPlainWorldObject`; `geodesicMarmotView.ts` 58 and `simpleGeoCreatureView.ts` 77 (creature behaviors); `geometryCommit.ts` 114, 118, 123, 126; `worldGeometryComputedObjects.ts` 122, 139, 158 and mutators 62, 67, 75.
- **Tests added.** `tests/modules/vanishedAngles.test.ts` (16), `geodesicMeasurements.contract.test.ts`, `geodesicMeasurementTools.test.ts`, `objectKinds.contract.test.ts` (013 section 11), `placedFlags.test.ts`, `tests/render/toolObjectRuntimes.test.ts`; in `toolHost.test.ts` a tool switch with a command in flight for each of the three tools, through the real host; a release scenario in `worldEngine.release.test.ts`.

**What is real and what is derived in a hidden angle.**

- *Real:* the choices (centre, two sides) and `vanishedSecondsLeft`, the world time left. That value cannot be recomputed: it records how long the crossing has been missing with nobody aiming, which is history, like an arc's `stale` (014 section 2.1). It sits on the angle, whose kind is `saved`, so nothing else has to survive a load.
- *Derived, not stored:* whether anyone is aiming. It is read in the tick from the participants' attachments, which are real, by asking if an attachment's object is an anchor of an arc of either side's curve. So "the last edit or carry ended" needs no timestamp and no stored "moving" state: the value stands at its full 3 s while held, and starts falling on the first tick after the last hold ended. With no hold it falls from the moment the crossing vanished. A hold that starts during the 3 s fills it again.
- *Materialized:* `portalRenderable: false`, on a record that is itself materialized (014 D9), so D1 is kept. It is a function of the real field.
- *Memos:* the set of waiting angles (filled by the `angles` tick from the records, so a load refills it) and the crossing memory. Neither is needed to survive a load.
- The value is spent by a `simulate` tick, so derive stays a function of real state; the `angles` tick only sets it on vanishing and drops it on return.
- In a frame with no tick nothing advances. The value counts `deltaSeconds`, so it is world time; tested with one long step and with frames of no tick.

**Ids, saved data, URLs.** Nothing parses `measured-geodesic-length`, `protractor-angle` or `placed-flag` as an id: those strings survive only as Three.js object names and render key prefixes, built from the record, never read back. Nothing is saved yet (013 section 11), so no old data exists. Config files name tool groups (`placeFlags`, `distances`, `angles`), not tool ids, and no launch option or URL carries a tool id. `"place-flag"` was indeed a tool id, renamed too.

**Fast channel.** Nothing here is on the `bodies` path. Values, the hiding and the 3 s are all in ticks and lag a carry or an aim until the next tick; a stale or removed label can last until then, several frames on a Quest 2.

**The contract test** finds no kind wrong as section 11 is written. Two things its text does not catch: see Uncertain.

### Deviations

- **The job contradicted itself.** Its Decision builds the hidden angle; its `## Do not` says not to decide that, pointing at the open question in 013. 013 section 17 item 6 is closed with the Decision's answer, so the Do-not line is stale. I followed the Decision, as the coordinator said.
- **One existing assertion on behaviour changed, as the Decision requires:** `tests/modules/geodesicMeasurements.test.ts` expected the angle gone when its crossing vanished; it now expects it hidden. Checked with `git diff e90af2c -- tests/`: no measurement value assertion changed.
- **Tests changed because what they name moved.** The rename across the test files. `worldEngine.test.ts` and `worldClient.test.ts` asked a moduleless engine for the length tool and protractor; they now use the core tools `geodesicEmitters/carry` and `/rotate`, for the same gate logic. `toolHost.test.ts`: the "primary action" test uses the probe tool, the "described twice" test uses `geodesicEmitters/carry`, and `promptOf` of a tool with no prompt uses `geodesicEmitters/carry` (the sign is no longer in that host, so it had become vacuous). `runtimeObjectActions.test.ts`: the three placing tests moved to `placedFlags.test.ts`, new tests cover typing and deleting a sign. `applyRuntimeCommand.test.ts` lost the test of the deleted `set-protractor-tool-state`; `runtimeEffects.test.ts` lost that one expected command. Fakes gained `eyePoint` and `chosenFlagType`.
- **Engine vocabulary grew, which the job did not name.** `AimPick` gained `eyePoint` (a flag faces the eye in the hit cell's frame, which `aimYawRadians` does not give through a portal) and `emitterGeodesicId` (the protractor's side at an emitter). `ToolContext` gained `chosenFlagType()`, since the palette's choice is client state a tool could not reach.
- **`createLength { arcId }` has no clicked segment.** With no segment of the arc within two portals of the participant, the label falls back on the arc's first segment, not the one clicked.
- **A blocked sign now shows a message;** it used to fail silently. A refused protractor pick starts the picks again, as the tie tool does. The verbose click log no longer runs for the length tool and the protractor.
- **The crossing memory is not what brings an angle back.** "Use the remembered-centre code": it is used, to tell a crossing that vanished from a removed emitter. But `crossingsTick` pruned the memory in the same pass, so I moved the prune before the update, which leaves id assignment as it was and keeps a vanished marker for exactly that pass. Bringing the angle back is `findGeodesicIntersectionNear` (cell, both sides' geodesics, last centre point, the same 10 m tolerance): the memory cannot do it, since it is a memo and a marker's id says where it was born, so a load would lose every moved crossing.

### Uncertain

- **A side's geodesic that is gone deletes the hidden angle at the next tick, not after 3 s.** Its crossing cannot return, and this keeps issue 94's path. Lifting an emitter deletes its plain arcs, so such an angle goes at once despite the carry. The flow's merge of two arcs does the same to the arc it removes; the person sees no difference, the angle being hidden either way. To confirm: the maintainer.
- **A write per tick while the 3 s run.** Each hidden, unheld angle writes its record each tick for at most 3 s. That bumps the registry version, so the emitter label sweep runs each tick then. The rebuild of a label is avoided (no runtime). *Better idea, not built:* a world clock in the engine and a stored deadline means two writes in all, but the clock would have to enter the save format of 013 section 11, or a load could not honour the deadline. A Quest 2 measurement would settle it.
- **A side is pinned to its half of the arc.** A crossing that moves over an arc's midpoint makes `endRole` unresolvable, and the angle is deleted though the crossing lives; likewise a crossing that returns on the other half. This predates the job (seen while writing the carry test), but it now cuts "returns with the crossing" short. I did not change it.
- **"The crossing returned" means the same cell, both sides' geodesics, within 10 m of where it vanished.** One that returns in another cell, through a portal for example, is not recognised.
- **"Either geodesic's emitter" is taken as any anchor of any arc of either side's curve,** so the far emitter of a tied curve counts, and any attachment on it counts, not only `carry` and `geodesicEmitters/edit` (`beginEdit` treats them alike).
- **Section 11 says `saved` is real state; the measurement kinds are `cheap-derived` and `saved`.** As the job decides. The contract test passes, but a future rule "saved implies real" would flag them. A kind with real choices and materialized values has no label of its own.
- **The test covers declared kinds only.** `geodesci-marmot`, `geo-mouse`, `geo-butterfly` and `asset` are declared by no module, so they have no persistence at all.
- **`placedFlags/place` allocates its id before it can be refused,** because `placeFlagAtFloorPoint` takes an `id`, so a refusal leaves a gap in the serials. The registry version stays. Changing it means changing four existing test calls.
- **A geometry commit prunes the memory too,** so a hidden angle whose crossing vanished in the very last pass counts as a missing vertex and is deleted. Left to the deformation job.
- The selectable-hitbox debug view still draws a hidden angle's box (debug only).
- `npm run bench -- moduleStep --check` exits 3 on timing, see Checks; I report it and did not touch a baseline.

### Not done

- **The flag branch of `geometryCommit.ts` stays** (lines 111-119: it moves each flag by the deformation and writes or removes it, with `removePlacedFlagRuntime` and `syncPlacedFlagRuntime`), as the Decision says. Owner: the deformation job, "deformation commit inside the step" of 013 section 16 (with job 30), which adds `transformGeometry`. Its emitter branch and `worldGeometryComputedObjects.ts` stay for the same reason. These are the only writes of a measurement or flag left in client code; `runtimeObjectActions.ts` and `toolObjectRuntimes.ts` write nothing.
- **No `publicApi`** on either module, as told.
- **Issue 92 stays open and the job stays in place** for the coordinator; `Status` is unchanged.
- **Manual checks, none done; I cannot run a headset or a desktop session here.** Desktop: place, edit (type quickly, backspace), delete a sign; measure and remove a length; the three protractor picks and their prompts, remove an angle; aim a geodesic off a crossing and back, and let an angle lapse; a world reset with all three present. Quest 2: the same with the hand ray and trigger; the lag of a label behind a carry or aim at low tick rates; a double trigger press during the wait; frame time during the 3 s with a hidden angle; typed sign text lag on the palette keyboard.

### Checks

- `npm run typecheck`: exit 0, before each commit and on the final tree.
- `npm test`: exit 0 on the final tree, 1718 tests (unit and process).
- `npm run docs:check`: exit 0 on the final tree. `docs:generate` run after doc comment changes.
- `npm run test:release`: exit 0 on `b56c33e`, 8 files, 25 tests.
- `npm run build`, then `npm run smoke -- --world cube,torus-moduli`: exit 0 on `2c60244` and on `b56c33e`.
- `npm run bench -- moduleStep --check`: **exit 3, timing only,** on `b56c33e`. Counters: no rise; writes 1557, 1797, 126897 as recorded; scans equal or below the baseline (the `geodesicMeasurements` scans fell in job 64, and the baseline file predates that). Median flow 20.37, flow+dependents 35.68 microseconds per step, below job 65's figures. `moduleStep.bench.ts` is untouched, so no label changed.
- `npm run bench:ab -- e90af2c`: exit 0, `bench:ab: ok`. Base flow 20.21, flow+dependents 36.24; head 21.99, 36.70; the rounds overlap. An earlier `--check` during a parallel test run read 69.55 and 158.98 and is not a measurement.
- No scene of the bench has a hidden angle, so these figures say nothing of the countdown's cost.
