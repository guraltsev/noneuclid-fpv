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

Commits: `521ee6b` (names only), `2c60244` (measurements: commands, tools, hidden angles, kinds, contract test), `b56c33e` (`placedFlags`, the two files leave the writers' list); `5b1e709` holds this report and makes one assertion in `toolHost.test.ts` mean something again (see Deviations). Repair round: `bb0a2ab`, and the commit holding these corrections.
Baseline before changes: typecheck clean. The full suite was not run before the first edit; the first run after the names-only script had the same 1632 unit tests, its 4 failures all caused by the rename.

- **Names (`521ee6b`).** Kind `placed-flag` is `placedFlags/flag`. Tools `place-flag`, `measure-length`, `protractor` are `placedFlags/flag`, `geodesicMeasurements/length`, `geodesicMeasurements/protractor` (013 sections 8.1 and 10; composition rule 11 needs the module prefix). Action id `measure-length`, icon id `protractor`, Three.js object names, archetype key prefixes and the help topic `protractor-angle` are not tool or object ids and stay.
- **`geodesicMeasurements`.** New `api.ts`, `client.ts`. Commands `createLength { arcId }`, `removeLength { lengthId }`, `createAngle { center, first, second }`, `removeAngle { angleId }`, each with `requiresTool`. Refusals `geodesicMeasurements/notAnArc`, `notALength`, `notACenter`, `notASide`, `sameSide`, `notAnAngle`. Ids `geodesicMeasurements/length:<n>`, `/angle:<n>`. Both kinds `saved`, `trackReads` still on by default. The tools use `commandInFlight`; the protractor's picks moved from `protractorToolState` to `moduleToolState.geodesicMeasurements`, and `set-protractor-tool-state` is gone.
- **Hidden angles.** `ProtractorAngleObject.vanishedSecondsLeft`; `refreshProtractorAngleObject` hides and restores; new simulate tick `geodesicMeasurements/vanishedAngles`; `findGeodesicIntersectionNear` in `intersections.ts`; `crossingsTick` prunes the memory before the update instead of after. A hidden angle has no runtime.
- **`placedFlags`.** New `src/modules/placedFlags/`: kind `placedFlags/flag`, commands `place { cellId, point, eyePoint, flagType }`, `setMessage { flagId, message }`, `remove { flagId }`, refusals `placedFlags/blocked`, `unknownType`, `notAFlag`, `notAMessage`, no ticks, a client part with the sign tool.
- **Shell.** `syncLabelRuntimesFromJournal` is `syncToolObjectRuntimesFromJournal` and covers flags too; the shell's `tryPlaceFlagFromAim`, `tryUseMeasureLengthToolFromAim`, `tryUseProtractorToolFromAim`, `getProtractorToolPrompt`, `removePlacedFlags`, `removeMeasuredGeodesicLengths`, `removeProtractorAngles` are deleted. A world reset submits the removals, applied by the reset frame's `step(0)`. `coreTools.ts` holds only the emitter's sub-modes.
- **The writers.** `runtimeObjectActions.ts` and `toolObjectRuntimes.ts` take `RuntimeObjectReader` and left `legacyWorldWriters` and its committed copy. `npm run docs:writers`: from 7 files, 19 direct write calls, 7 mutator uses to **5 files, 9 direct write calls, 6 mutator uses**. What remains: `createThreeApp.ts` 1549 `releaseOwnership`, 1707 `remove`, 1002 `createPlainWorldObject`; `geodesicMarmotView.ts` 58 and `simpleGeoCreatureView.ts` 77 (creature behaviors); `geometryCommit.ts` 114, 118, 123, 126; `worldGeometryComputedObjects.ts` 122, 139, 158 and mutators 62, 67, 75.
- **Repair round (`bb0a2ab`), after a fresh review; each finding reproduced first.** A hidden angle comes back on either half of an arc (run S5 deleted it). A side's half was only where it lay, so the side keeps its geodesic and its direction along it, towards the same end, and `endRole` becomes the half it lies on now; `resolveAngleSide` in `protractorTool.ts`. Two sides told apart by their halves alone are then one side, and the angle is given up, pinned by a test: `createProtractorAngleObject` would throw on them in a derive tick. `aimFeedback.ts` uses a shared constant in place of `?? {}`. `removeMeasuredGeodesicLengthRuntime` and `removeProtractorAngleRuntime` return at once with no runtime, so a hidden angle's frame no longer copies the render source map; the test fails without this. `placeFlagAtFloorPoint` takes `createId`, called once the place is accepted (S8 gave `flag:0`, then `flag:2`). The measurement commands already took their ids after every refusal. A test covers frames of none, one and several ticks (world time to deletion stays within a few ticks of 3 s).
- **Tests added.** `tests/modules/vanishedAngles.test.ts` (19), `geodesicMeasurements.contract.test.ts`, `geodesicMeasurementTools.test.ts`, `objectKinds.contract.test.ts` (013 section 11), `placedFlags.test.ts`, `tests/render/toolObjectRuntimes.test.ts`; in `toolHost.test.ts` a tool switch with a command in flight for each of the three tools, through the real host; a release scenario in `worldEngine.release.test.ts`.

**What is real and what is derived in a hidden angle.**

- *Real:* the two sides, the centre as far as it is a choice, and `vanishedSecondsLeft`, the world time left. An emitter centre is real by its id. A crossing centre is real as the crossing of those sides' geodesics near a place: `centerObjectId` is then only a reference, rebound when it stops resolving, because a crossing's id is not real state. Earlier wording here called the centre real without that limit, which contradicted the Deviations. That value cannot be recomputed: it records how long the crossing has been missing with nobody aiming, which is history, like an arc's `stale` (014 section 2.1). It sits on the angle, whose kind is `saved`, so nothing else has to survive a load.
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
- **Tests changed because what they name moved.** The rename across the test files. In `toolHost.test.ts` the expected list of the shell's tools lost three ids, `geodesicMeasurements/length`, `geodesicMeasurements/protractor` and `placedFlags/flag`, since that host has no module clients. `tests/world-objects/placedFlags.test.ts` passes `createId` where it passed `id`; no assertion changed. `worldEngine.test.ts` and `worldClient.test.ts` asked a moduleless engine for the length tool and protractor; they now use the core tools `geodesicEmitters/carry` and `/rotate`, for the same gate logic. `toolHost.test.ts`: the "primary action" test uses the probe tool, the "described twice" test uses `geodesicEmitters/carry`, and `promptOf` of a tool with no prompt uses `geodesicEmitters/carry` (the sign is no longer in that host, so it had become vacuous). `runtimeObjectActions.test.ts`: the three placing tests moved to `placedFlags.test.ts`, new tests cover typing and deleting a sign. `applyRuntimeCommand.test.ts` lost the test of the deleted `set-protractor-tool-state`; `runtimeEffects.test.ts` lost that one expected command. Fakes gained `eyePoint` and `chosenFlagType`.
- **Engine vocabulary grew, which the job did not name.** `AimPick` gained `eyePoint` (a flag faces the eye in the hit cell's frame, which `aimYawRadians` does not give through a portal) and `emitterGeodesicId` (the protractor's side at an emitter). `ToolContext` gained `chosenFlagType()`, since the palette's choice is client state a tool could not reach. For that, `engine/moduleTypes.ts` now imports a world-object type, `PlacedFlagType`, a sign-specific word in the engine's vocabulary.
- **`geodesicDisplayName` moved** out of `geodesicEmitterLabelController.ts` into `world-objects/measureLengthTool.ts`, because the world now names a length and the client a side; the controller no longer returns `getGeodesicDisplayName`, and `aimFeedback.ts` and `runtimeObjectActions.ts` no longer take it.
- **`createLength { arcId }` has no clicked segment.** With no segment of the arc within two portals of the participant, the label falls back on the arc's first segment, not the one clicked.
- **A blocked sign now shows a message;** it used to fail silently. A refused protractor pick starts the picks again, as the tie tool does. The verbose click log no longer runs for the length tool and the protractor.
- **The crossing memory is not what brings an angle back.** "Use the remembered-centre code": it is used, to tell a crossing that vanished from a removed emitter. But `crossingsTick` pruned the memory in the same pass, so I moved the prune before the update, which leaves id assignment as it was and keeps a vanished marker for exactly that pass. Bringing the angle back is `findGeodesicIntersectionNear` (cell, both sides' geodesics, last centre point, the same 10 m tolerance): the memory cannot do it, since it is a memo and a marker's id says where it was born, so a load would lose every moved crossing.

### Uncertain

- **A side's geodesic that is gone deletes the angle at the next tick, not after 3 s, and the Decision has no such exception.** Its crossing cannot return, and this keeps issue 94's path. Run S6: `carry/attach` on an emitter with a plain arc deletes the angle in that very step, with the carry held, and it is never hidden. The arc cannot come back, so no person can see a return that did not happen; but the angle does vanish at once rather than 3 s later. The flow's merge of two arcs does the same to the arc it removes. To confirm: the maintainer.
- **A tick that takes the value to 0 or below deletes the angle even if a command of that same step brings the crossing back** (S9): `simulate` runs before `derive`, so the return is seen one pass too late. At most one tick, at the very end of the 3 s.
- **Float residue.** At a tick of 1/60 s the value reaches about 5.7e-15 instead of 0 (S2), so deletion comes one tick later than exact arithmetic. Harmless, and tests allow for it.
- **`findGeodesicIntersectionNear` (`intersections.ts:81`) scans the crossings with `getObjectsOfKind`, outside a cache,** on each wake of a hidden angle: every crossing write, for as long as an edit is held. Small with few crossings; not measured.
- **A write per tick while the 3 s run.** Each hidden, unheld angle writes its record each tick for at most 3 s. That bumps the registry version, so the emitter label sweep runs each tick then. The rebuild of a label is avoided (no runtime). *Better idea, not built:* a world clock in the engine and a stored deadline means two writes in all, but the clock would have to enter the save format of 013 section 11, or a load could not honour the deadline. A Quest 2 measurement would settle it.
- **A live angle is still pinned to its half.** The return path is fixed (Done), but a crossing that moves over an arc's midpoint without vanishing still makes `endRole` unresolvable, and the angle is deleted though the crossing lives. This predates the job and I kept to the return path, so the two cases now differ. Making `resolveAngleSide` apply to every crossing centre would end that; it must not apply to an emitter centre, where the half tells the two ends of a loop apart.
- **"The crossing returned" means the same cell, both sides' geodesics, within 10 m of where it vanished.** One that returns in another cell, through a portal for example, is not recognised.
- **"Either geodesic's emitter" is taken as any anchor of any arc of either side's curve,** so the far emitter of a tied curve counts, and any attachment on it counts, not only `carry` and `geodesicEmitters/edit` (`beginEdit` treats them alike).
- **Section 11 says `saved` is real state; the measurement kinds are `cheap-derived` and `saved`.** As the job decides. A kind with real choices and materialized values has no label of its own. 014 section 2.1 also has no row for `vanishedSecondsLeft`; I may not edit it.
- **The contract test is weak.** It checks that a label and a persistence exist, as section 11 says, so it would not catch `saved` on a derived kind, and it covers only the default experience. `geodesci-marmot`, `geo-mouse`, `geo-butterfly` and `asset` are declared by no module, so they have no persistence at all.
- **A geometry commit can delete a hidden angle early, an indirect effect of moving the prune.** `crossingsTick` runs only on a segment write, so a vanished marker stays remembered until the next such write, not for one pass as I first wrote. In a still scene that can be the whole wait. `worldGeometryComputedObjects.ts:81-85` then counts it as a pruned, missing vertex and deletes the angle, whatever time is left. Run: two connected geodesics, the crossing carried away and the carry held still for 1 s, then the commit policy: `removedProtractorAngleIds: ["angle"]`. Run with the carry ended first: the angle is kept, because the settle writes segments, the next pass forgets the marker and the commit finds nothing. So a deformation during the wait deletes or spares a hidden angle depending on whether a segment was written since it vanished, and `prunedIntersectionIds` can list markers that vanished earlier. Free geodesics are deleted by a commit anyway, so this reaches only connected ones. Left to the deformation job.
- **A length's result clears the module state the protractor shares** (`onResult` in `geodesicMeasurements/client.ts`). If a length's answer lands after the person switched to the protractor and picked, those picks are lost; the window is under one tick.
- **Reopening a sign's page before a tick reloads the old message:** the page takes the record's text, and the keys in flight have not landed.
- The selectable-hitbox debug view still draws a hidden angle's box (debug only).
- `npm run bench -- moduleStep --check` exits 3 on timing, see Checks; I report it and did not touch a baseline.

### Not done

- **The flag branch of `geometryCommit.ts` stays** (lines 111-119: it moves each flag by the deformation and writes or removes it, with `removePlacedFlagRuntime` and `syncPlacedFlagRuntime`), as the Decision says. Owner: the deformation job, "deformation commit inside the step" of 013 section 16 (with job 30), which adds `transformGeometry`. Its emitter branch and `worldGeometryComputedObjects.ts` stay for the same reason. These are the only writes of a measurement or flag left in client code.
- **`runtimeObjectActions.ts` still writes the world through owners, so Done-when is met only for direct registry calls.** `toolObjectRuntimes.ts` writes nothing, and `runtimeObjectActions.ts` makes no registry write call, which is all `docs:writers` sees and why it left the list. But it still reaches writes indirectly: `:252` `objectHost.placeAt` (with the structural type at `:51`), `:259` `runtime.reset`, `:262` `owner.reset`, `:264` `removeGeodesicRuntimeObjects`, which reaches `createThreeApp.ts:1707`. I did not move them: `placeAt` and reset are generic and not this job's. `:259` falls under the creature job, and `:264` lands in a listed file, but **no later job is named for `:252`, `:262` or `:264`**. The earlier sentence here, that the file writes nothing, was wrong.
- **No `publicApi`** on either module, as told.
- **Issue 92 stays open and the job stays in place** for the coordinator; `Status` is unchanged.
- **Manual checks, none done; I cannot run a headset or a desktop session here.** Desktop: place, edit (type quickly, backspace), delete a sign; measure and remove a length; the three protractor picks and their prompts, remove an angle; aim a geodesic off a crossing and back, and let an angle lapse; a world reset with all three present. Quest 2: the same with the hand ray and trigger; the lag of a label behind a carry or aim at low tick rates; a double trigger press during the wait; frame time during the 3 s with a hidden angle; typed sign text lag on the palette keyboard.

### Checks

- `npm run typecheck`: exit 0, before each commit and on the final tree.
- `npm test`: exit 0 on `bb0a2ab`, 1722 tests (unit and process).
- `npm run docs:check`: exit 0 on `bb0a2ab` and on the final tree. `docs:generate` run after doc comment changes.
- `npm run test:release`: exit 0 on `b56c33e`, 8 files, 25 tests.
- `npm run build`, then `npm run smoke -- --world cube,torus-moduli`: exit 0 on `2c60244`, `b56c33e` and `bb0a2ab`.
- Release and bench were not re-run for the repair round, as told; the figures below are from `b56c33e`.
- `npm run bench -- moduleStep --check`: **exit 3, timing only,** on `b56c33e`. Counters: no rise; writes 1557, 1797, 126897 as recorded; scans equal or below the baseline (the `geodesicMeasurements` scans fell in job 64, and the baseline file predates that). Median flow 20.37, flow+dependents 35.68 microseconds per step, below job 65's figures. `moduleStep.bench.ts` is untouched, so no label changed.
- `npm run bench:ab -- e90af2c`: exit 0, `bench:ab: ok`. Base flow 20.21, flow+dependents 36.24; head 21.99, 36.70; the rounds overlap. An earlier `--check` during a parallel test run read 69.55 and 158.98 and is not a measurement.
- No scene of the bench has a hidden angle, so these figures say nothing of the countdown's cost.
