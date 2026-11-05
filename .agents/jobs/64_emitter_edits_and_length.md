# Job 64 - Rotate, aim and carry through the world; a free geodesic keeps its length

Status: in progress.
Resolves: issues [88](../../_issues/88_carry_changes_the_world_before_the_world_answers.md),
[89](../../_issues/89_rotate_aim_and_carry_bypass_the_tool_gates.md) and
[93](../../_issues/93_a_free_geodesic_forgets_its_length_when_the_tool_ends.md).

## Goal

Rotate, aim and carry ask the world first and change it only through it. A free geodesic stops at a corner, keeps its length, and extends as
soon as the corner is cleared, even across tool sessions.

## Depends on

Job 63.

## Before you start

- Read the three issues, issue 94, and 013 sections 5.4 (the fast channel), 5.7, 7, 8.1 and 13.1. Read `updateActiveGeodesicCannonRotation`, `updateActiveGeodesicCannonAim`,
  `startGeodesicCannonCarry` and `src/modules/carry/module.ts`.

## Decisions

- **Length.** A geodesic is a laser with a certain power (maintainer, 2026-11-05). New real field on the arc, `intendedLengthMeters`, set by `shoot` and `extend`. Every rebuild of a free geodesic traces to it. It
  applies at a wall as at a corner: the trace stops at whatever is in the way and the arc keeps its intention. It replaces the closure
  variable `geodesicCannonRotationTargetLengthMeters` and `rotationTargetLengthMeters` on the carry attachment. `extend` raises it; a measured length
  still reports the real path. Declared `saved`.
- **Edit attachment.** Rotate and aim are one relation, "this participant is editing this emitter", as in section 7: commands
  `geodesicEmitters/beginEdit { emitterId, arcId? }` and `/endEdit`, with control slot `geodesicEmitters/yaw`, an absolute yaw. The client computes
  the yaw from its aim or its turn input; rays never reach the world. Each frame, in a `bodies` tick (the fast channel, 013 section 5.4), the emitter
  takes the slot's yaw and its free geodesic is re-traced, so aiming stays as immediate as it is today, in frames with no tick too. `endEdit` applies the connection and snap of today's `finishActiveGeodesicCannonEdit`.
- `beginEdit` is refused with `geodesicEmitters/alreadyEdited` for an emitter someone else edits or carries, and `carry/attach` for one being edited.
- **Carry.** `carry/attach` removes the plain geodesics itself, on success only. `prepareGeodesicCannonForLift` is deleted from the shell.
  Lifting still deletes a plain shot geodesic (agreed 2026-11-03). The carry module requires the emitters' token and moves the emitter by
  calling the emitters' `api.moveAlong` from its `bodies` tick, not by a command (maintainer, 2026-11-05: carrying uses the fast channel). So
  `writesCoreKinds` and its docs rule exemption are deleted; issue 94 says what must happen to the two measurement kinds on that list.
- **No ticks on this path.** Fast interactions do not go through the simulation unless they must (013 section 5.4): nothing per-frame of rotate, aim or carry
  runs in a simulate tick or waits for one.
- **Gates.** `enter-tool-mode` is deleted. All three start through `world/requestTool`, and enter on `ok`. `carry/attach`, `beginEdit` and their
  siblings declare `requiresTool`.

## Steps

1. `intendedLengthMeters` and the rebuild, with the test of issue 93: end the tool while stopped at a corner, start again, clear the corner,
   and the geodesic has its full length. Also at a wall.
2. The edit attachment and slot; rotate and aim tools become the client's yaw sources. A test: the yaw set in a frame with no tick is applied in that frame.
3. Carry: attach does the lift. A refused attach leaves geodesics and tool unchanged.
4. The tool protocol. With emitters disabled by configuration, each of the three is refused with its message.

## Tests and checks

The carry tests' assertions on motion stay. Tests that assert the old order (lift, then attach) change, and each is recorded under
`### Deviations`. A manual check in the app: aim a free geodesic through a corner and back; carry through a portal. In VR, on a Quest 2: the same, watching frame time while carrying an emitter with several geodesics, since the rebuild runs in every frame there. List this check for the maintainer in the Report.

## Do not

Do not add the corner glow. Do not change what the flow does at a corner: its blocked curves are destroyed.

## Done when

`grep -rn "enter-tool-mode\|prepareGeodesicCannonForLift\|writesCoreKinds\|geodesicCannonRotationTargetLengthMeters" src tests` is empty.

## Report

### Done

Commits: `ef5b78e` (all of the code, docs and tests), `697c360` (one more test, "regrows a plain geodesic shot during the carry to its intended length"; its message says "report", but the report is in the commit after it).
Baseline before changes: typecheck clean; `npm test` 174 files, 1559 tests.

- **Length.** New field `intendedLengthMeters` on the arc, on a kind already declared `saved`. `shootGeodesic` sets it, `extendGeodesic` raises it, a cut gives the continuation what is left of it. Every rebuild of a free geodesic traces to it. A measured length still sums the segments. The closure variable and `rotationTargetLengthMeters` are gone.
- **Edit attachment.** Commands `geodesicEmitters/beginEdit { emitterId, arcId? }` and `/endEdit`, slot `geodesicEmitters/yaw` (absolute), attachment kind `geodesicEmitters/edit`, refusal `geodesicEmitters/alreadyEdited`. The `bodies` tick `geodesicEmitters/edit` takes the slot's yaw and re-traces. `endEdit` applies the snap and the connection. `carry/attach` is refused with the same code for an edited emitter.
- **Carry.** `carry/attach` lifts on success only, through the new module-only `geodesicEmitters/lift`. The carry requires `geodesicEmittersToken` and moves the emitter with `api.moveAlong`, then `api.rebuildGeodesics`; `carry/detach` uses `api.settleGeodesics`. `prepareGeodesicCannonForLift` is deleted.
- **`writesCoreKinds` is gone, with no replacement list.** The guard itself did not change, apart from losing the list: it already ran an owner's `api` in the owner's frame. The route: a module writes only what it declares. The emitters write the emitter. Every arc write is the model's, by a module-only command at command rate (`shootArc`, `extendArc`, `cutAtSegment`, `cutAtVertex`, `removePlainArcs`; `reserveArcId` is deleted) or by its `api` on the fast channel (`retraceArc`, `followAnchorRoute`, `rebuildArcsOfEmitter`). For this, `shootGeodesic`, `rebuildGeodesicToLength` and `rebuildEmitterGeodesics` no longer write the emitter, and the functions that do both take the arc half as a parameter (`followRoute`, `cuts`). The carry module's docs rule exemption is deleted, and the emitters' `alsoViaFrom` lost `carryEnd.ts`.
- **Issue 94.** `removeGeodesicIntervalAndDerivedObjects` no longer touches measurement kinds; the measurement ticks remove them. New tests: a flow that collapses a measured curve with the guard on; `deleteGeodesic` on a measured arc; a record outliving an arc removed outside a tick. Readers checked by reading: `measureLengthRenderer.ts`, `protractorAngleRenderer.ts`, `debugHitboxMeshes.ts`, `aimTarget.ts` and `worldInteractionDefinition.ts` use the record's own fields and never look up its arc; `worldGeometryComputedObjects.ts` removes a record whose arc is gone. So a frame with no tick shows the old label for at most one more frame and nothing breaks. The issue is left open for the coordinator.
- **Tool protocol.** `enter-tool-mode` is deleted. Rotate, aim and carry go `world/requestTool`, then `beginEdit` or `carry/attach`, then `select-tool` on the second `ok`, all through `ToolContext.submit`; answers arrive at `settleEmitterMode` through each descriptor's `onResult`. A press while any of the three has a command in flight does nothing. The client stays in the tool until `endEdit` or `carry/detach` is answered and leaves the slot alone meanwhile. A person who chose another tool wins: a late `ok` of the relation is undone with an end. `requiresTool`: `carry/attach`, `carry/detach`, `beginEdit`, `endEdit`. The reducer no longer gates the three starts, so the world gives the refusal and its message.
- **Shell.** `geodesicCannonTools.ts` writes nothing and left `legacyWorldWriters`. Deleted as unreachable: `removeMeasuredGeodesicLengthsForGeodesic`, `removeProtractorAnglesForGeodesic`, `removeProtractorAnglesForMissingVertices` (shell), `releaseCarriedEmitter`, `prunedIntersectionIds` on `carry/released`, the options `snapToEmitter` and `rebuildConnected`, and the zero-length branch of the rebuild.
- **Tests added.** `tests/modules/geodesicEmitters/edit.test.ts`, `tests/render/emitterModes.test.ts`, a "lifting an emitter" block in `tests/modules/carry.test.ts`, 2 in `geodesicEmitters.contract.test.ts`, 1 in `curveShortening.test.ts`. The named test "the yaw set in a frame with no tick is applied in that frame" uses `applyControls` with no `step` and asserts `stepIndex` did not move.

**What runs per frame.** With no edit and no carry: one participant lookup and two scans of an empty attachment list in the tools, and the two `bodies` ticks each walk the participants. During an edit with an unchanged yaw: one slot read and one comparison, no write (tested by the registry version). With a changed yaw: one emitter write and one `retraceArc`, the same trace as before this job. During a carry: as before, `moveAlong` per step, then one rebuild. The new hops are two direct calls. With the guard off the `api` is unwrapped, so production pays no frame push.

### Deviations

- **Old-order tests.** No test asserted lift-then-attach as an order. The one test of the old sequence is "leaves the tool when the world refuses the pickup", renamed "does not enter the tool when the world refuses the pickup"; its assertions are unchanged. No assertion on motion changed: over `git diff ef056e2 -- tests/`, in the carry, measurement and world-object tests the only `expect` lines changed are the `release.*` ones in the next item.
- **Tests changed because the job moved the code.** `carryEnd.test.ts`, `tiedCarry.test.ts`: `releaseCarriedEmitter` became `rebuildEmitterGeodesics`, and two `prunedIntersectionIds` assertions went. `cannon.test.ts`, `moveEmitter.test.ts`, `carry.test.ts` (world-objects): the bare-registry helpers `bareRegistryCuts` and `moveEmitterWithItsArcs` in the fixture. Module lists gained the emitters. `geodesicCannonCarry*.test.ts`: the harness runs a real tool host, `startAiming` became the real start, and a start takes two frames in `driveCarryTools`. `composeModules.test.ts`: the `writesCoreKinds` test is deleted. `worldEngine.test.ts`: reduced to its refusal half and renamed. `applyRuntimeCommand.test.ts`: the `enter-tool-mode` test is deleted, and the three starts now pass the reducer with emitters disabled. `moduleImportRules.test.ts`: `carryEnd.ts` and the carry are now refused.
- **A mode left without a press now connects and snaps.** Out of reach, another tool, the menu: the world runs `endEdit`, the one way to end. Before, those paths did not connect. The Decision gives `endEdit` no option to skip it.
- **Holding one thing refuses the next on the same emitter.** Rotate then the carry key on that emitter is refused, with the message "Being edited by local."; before, it switched. Likewise carry then rotate on the same emitter, and a second emitter while editing one. Rotate to aim on the same emitter works. Carrying A and rotating B works and puts A down (by reading; not tested).
- **`beginEdit` refuses a tied arc** with `blocked`, as well as a connected one. Before, a tied arc passed the start and, by reading, the first turn threw in `shootGeodesic`. The tied case has no test of its own.
- **Small changes:** a refused rotate or aim of a connected geodesic now shows a message, where it was silent. Entering uses `select-tool`, so it also clears the protractor's tool state. Rotate no longer asks for pointer lock in XR. `leaveMode` uses `endTool`, so it also closes an open menu. `ParticipantAttachment.arrived` is optional, because an edit has no glide.
- **One code commit,** not one per step: the write route ties the four steps together, and no step had a green tree alone.

### Uncertain

- **The design needs rows I may not write.** 013 section 5.7 calls the `api` list closed (M1, M2). The fast-channel functions here are new rows: `retraceArc`, `followAnchorRoute`, `rebuildArcsOfEmitter`, and the emitters' `moveAlong`, `rebuildGeodesics`, `settleGeodesics`. Section 5.4 allows the route; the table does not list it. `settleGeodesics` is command rate and could be a command. Section 7 still says the shell lifts the emitter. To be settled by the maintainer.
- **`ctx.dispatch` in carry's `bodies` tick stays for `carry/drop`** (lines 162 and 213 of `carry/module.ts`): the leash or a missing object, at most once per carry, the frame the carry ends, because only commands can close a slot. No frame of a running carry or edit dispatches. If the gate is read as "no dispatch in the tick at all", a `closeControl` on `StepContext` would remove it and the command; two tests assert `world/moduleOnly` for `carry/drop`.
- **`beginEdit` and `endEdit` name `geodesicEmitters/rotate` as `requiresTool`,** though aim uses them too. `requiresTool` takes one tool and the Decision fixes the command's shape. It is right today because the configuration gates the modes together; a gate on aim alone would need a list or a `toolId` field.
- **A start takes two ticks,** the gate and then the relation, following section 8.1 literally. Submitting both at once would take one, but the relation would run even if a later module gate refused the tool. On a Quest 2 with slow ticks this delay at the start of a mode is worth watching.
- **A stale intention.** Nothing clears `intendedLengthMeters` when an arc connects. If an arc later becomes free again (one arc of a tied curve deleted), it would re-trace to its old intention. Not tested.
- **`extend` stays refused at a stop.** A stopped tail still answers `blocked`, as job 63's contract says, so the intention cannot be raised at a wall.
- **Not new, found by a test:** when an emitter has a following arc, `rebuildEmitterGeodesics` rebuilds only following arcs, so a plain arc shot during a carry stays behind. Only a script can do that. Left as it is.
- **Better idea, not done:** the rotate, aim and carry tools could move to the modules' client parts, with the aim yaw as a shell service; then `emitterModeResult` would go.

### Not done

- `npm run bench:ab` was not run: no counter rose, and the last check passed.
- **Manual checks, none done.** I cannot use a headset, and I did not run the desktop steps by hand. Smoke loads the two worlds and does not use these tools, so the wiring in `createThreeApp.ts` is covered only by typecheck, by smoke loading the page, and by tests with the same tool host and a real engine.
  Desktop (`npm run dev`):
  1. Aim a free geodesic through a corner and back: it stops and grows back. The same at a wall.
  2. Stop it at a corner, finish, start the tool again, clear the corner: full length.
  3. Rotate the same way with the mouse. Both feel as immediate as before.
  4. Finish aimed at an emitter: it snaps and connects.
  5. Carry an emitter through a portal; put it down; its connected geodesics stay. A plain geodesic goes on pickup.
  6. With a length and an angle on a geodesic, delete it, and carry an emitter onto the far end of its own geodesic: the labels vanish within a frame or so.
  7. A config with emitters off: the three starts, if reachable, show "This tool is not available in this world." and the tool stays.
  8. Double-press the carry key and the finish press: nothing happens twice. Choose another tool right after a start.
  9. Pointer lock is taken after the world's answer, not in the click: check that it still locks on the desktop browsers in use.
  Quest 2: steps 1, 2 and 5, watching frame time while carrying an emitter with several geodesics, since the rebuild runs in every frame there. Also the delay between the press and entering a mode at a low tick rate.

### Checks

Final, on the code of `697c360`:

- `npx tsc --noEmit`: exit 0, also before each commit.
- `npm test`: exit 0, 176 files, 1614 tests.
- `npm run docs:check`: exit 0, after `npm run docs:generate`.
- `npm run build`, then `npm run smoke -- --world cube,torus-moduli`: exit 0, SMOKE OK (2 pages). Also run after the change to `createThreeApp.ts`, before the first commit.
- Release tier (`vitest run --project release` on the fresh build): exit 0, 7 files, 17 tests.
- `npm run bench -- moduleStep --check`: exit 0, check ok. flow 17.09, flow+dependents 29.18, many arcs 1309.56, tracked 1435.36, plain 1536.70 us/step; idle allocation 0.0 bytes/step.
  The first of three runs printed `check: FAILED (flow+dependents step time)` at 32.89 us/step, right after other work; its exit code was lost to a pipe. It named only timing. The second and third passed with exit 0; the first two showed idle allocation 0.4 bytes/step, the third 0.0.
  Counters: writes unchanged (1557, 1797, 126897); `geodesicMeasurements/angle` and `/length` scans fell (flow 1 to 0 each; flow+dependents angle 121 to 120; manyArcs 1 to 0 each). None rose. `moduleStep.json` and `moduleStepCounters.json` are unchanged.
- `npm run docs:writers`: 7 files, 19 direct write calls, 7 mutator uses, from 8, 24, 9.
- `grep -rn "enter-tool-mode\|prepareGeodesicCannonForLift\|writesCoreKinds\|geodesicCannonRotationTargetLengthMeters" src tests`: empty.
