# Job 63 - Create the geodesic emitters module: renames, place, shoot, extend, delete

Status: in progress.
Resolves: nothing fully; with job 64, the emitter part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md).

## Goal

Emitters are a module. Everything a person does to create or remove an emitter or its geodesics is a command, so a script can do it too.

## Depends on

Jobs 61 and 62.

## Before you start

- Read 013 sections 5.3, 5.7, 8, 9, 10, 12.2, 13.1 and 16, and job 54's Report. Read `src/render/three/geodesicCannonTools.ts`,
  `src/world-objects/geodesic/cannon.ts` and `src/modules/carry/module.ts`.

## Background

`geodesicCannonTools.ts` writes the registry directly: place, shoot, extend, add, delete. Emitter ids and arc ids come from
`engine.ids`, which exists only for such legacy writers. The string `"geodesic-cannon"` appears about 210 times in 73 files.

## Decisions

- **First commit, names only:** kind `geodesicEmitters/emitter`; `GeodesicCannonObject` becomes `GeodesicEmitterObject`, with its constructors
  and guards; tool ids `geodesicEmitters/<noun>`; the id families `geodesicEmitters/emitter:<n>` and `geodesicModel/arc:<n>`. No alias.
  The word "locked" goes from the identifiers it is left in (`rebuildLocked`, `lockedGeodesicIds`, `removeUnlockedGeodesicsFromCannon`).
- `src/modules/geodesicEmitters/`: `api.ts`, `index.ts`, `module.ts`, `client.ts`, with the world part over `world-objects/geodesic`, which stays
  in place. It requires `geodesicModelToken`. Add it to `onlyVia`'s exceptions in 12.2 only for `cannon.ts` and `carryEnd.ts`; other reads
  go through the model's `queries` (`connectsEmitters`, `isTied`).
- Commands, all with `requiresTool` for the tool that issues them:
  `geodesicEmitters/place { cellId, point, yawRadians }`, `geodesicEmitters/shoot { emitterId, yawRadians, lengthMeters }`,
  `geodesicEmitters/extend { arcId, lengthMeters }`, `geodesicEmitters/deleteGeodesic { emitterId, arcId }`, `geodesicEmitters/remove { emitterId }`.
  Commands carry cell-local data, never rays: the client resolves its aim first (`AimPick.cellId`, `point`).
- Results carry the new ids. Refusals have stable codes: `geodesicEmitters/notAnEmitter`, `/notAttached`, `/blocked`, `/tooShort`.
- The client part holds the tool descriptors; the tools act only through `ToolContext.submit` and read through `ToolContext.read`.
  The core tool `base` stops marking carry, rotate and aim as `main-tool`, and the palette reads `entry.kind` for the main list.
- Hand-written follow-ups after these writes are deleted: `removeProtractorAnglesFor*`, `removeMeasuredGeodesicLengthsForGeodesic` and
  `requestSelectableHitboxDebugSync` go where the derive ticks already do the work. Verify each: an audit called them redundant, not proven.
- `rebuiltGeodesicIds` on carry events and in `worldGeometryComputedObjects` has no production reader: delete it.

## Steps

1. The rename commit. Done when `grep -rn '"geodesic-cannon"' src tests` is empty.
2. The module and commands, moved from the tools, with a contract test: each command's success and each refusal; a refusal changes nothing
   (registry version unchanged).
3. The tools through `ToolContext`. `legacyWorldWriters` shrinks.
4. `_docs/MATHEMATICAL_MODEL.md` where it names the emitter.

## Tests and checks

The existing emitter and shooting tests keep their assertions on geometry. Smoke, release, bench counters.

## Do not

Do not change rotate, aim or carry here (job 64). Do not add `publicApi` (job 65).

## Done when

`geodesicCannonTools.ts` no longer writes for place, shoot, extend or delete, and `grep -n "engine.ids" src/render` shows none of those.

## Report

### Done

Commits: `7db18a1` (names only), `4fc0ff5` (module, commands, tools), `b4116d8` (`rebuiltGeodesicIds`, docs, release check); the commit that adds this report follows them.
Baseline before changes: typecheck clean; `npm test` 172 files, 1513 tests.

- **Rename (`7db18a1`).** The kind and the main tool are `geodesicEmitters/emitter`; tools `geodesicEmitters/carry`, `/rotate`, `/aim`; `GeodesicEmitterObject`, `createGeodesicEmitterObject`, `CreateGeodesicEmitterOptions`, `PlaceGeodesicEmitterResult`; id families `geodesicEmitters/emitter:<n>` and `geodesicModel/arc:<n>`. "locked" became "connected" in identifiers, comments and test names; `removeUnlockedGeodesicsFromCannon` is `removePlainGeodesicsFromCannon`, `rebuildUnlockedGeodesicToLength` is `reshootGeodesicToLength`. `grep -rn '"geodesic-cannon"' src tests` is empty. The commit passed `npm test` (172 files, 1513 tests), docs:check and smoke by itself. I listed every word pair of its diff with `git diff --word-diff`: all are renames, with four small exceptions. The sorted expectation in `toolHost.test.ts` changed order because the names sort differently. One test title says "10 wraps" for "ten wraps", to stay within 90 characters. `carry/module.ts` uses the type `GeodesicEmitterObject` instead of an inline `Extract`, because `docs:check` reads the new namespaced literal in that file as a name carry contributes. Comments and test titles that said "locked" changed with the identifiers.
- **Saved data and URLs.** Nothing saved or in a URL holds these names: no fixture file, no `localStorage` in `src`, and `moduleStepCounters.json` has no emitter key, so its keys and values are unchanged. Names outside the app that did change: the debug helpers (`dump_connected_geodesic_words`, `DumpConnectedGeodesicWords`, `api.debug.dumpConnectedGeodesicWords`), the `connected` field of the debug dumps, and the CSS classes `desktop-tool-palette-connected-segment*`.
- **Module (`src/modules/geodesicEmitters/`).** `api.ts`, `index.ts`, `module.ts`, `client.ts`. It requires `geodesicModelToken`, declares the emitter kind (now in `moduleOwnedCoreKinds`) and handles `place`, `shoot`, `extend`, `deleteGeodesic`, `remove`, all with `requiresTool: geodesicEmitters/emitter`. It has no tick. Results are `{ outcome, emitterId, arcId | arcIds }`. It is in `createDefaultWorldModules` and `createDefaultClientModules`.
- **World code.** `cannon.ts#placeGeodesicEmitterAtPoint` decides from what is at the point: a crossing, a segment, or the floor (1e-6 m, because the client sends the object's own point). `placeGeodesicCannonOnGeodesic` now checks everything before it writes, so a refusal leaves the registry version alone; its add-then-remove branch became unreachable and is deleted. New placement reason `"too-short"`. Model: queries `curveOfArc` and `arcsOnEmitter`, module-only command `geodesicModel/reserveArcId`.
- **Tools.** The emitter tool's descriptor moved from `coreTools.ts` to `client.ts`; its id moved from `CoreToolId` to `ModuleToolIds`. `client.ts` also has `requestNewGeodesic`, `requestGeodesicDeletion` and `requestGeodesicExtension`, which the shell calls with `toolHost.contextOf(...)`. `tryUseGeodesicCannonToolFromAim`, `tryExtendFocusedGeodesicFromAim`, `addGeodesicToCannon` and `deleteGeodesicFromCannon` are gone from `geodesicCannonTools.ts`. Random yaw is chosen by the client. `coreTools.ts`: `base` is split, carry, rotate and aim have `entry: { kind: "sub-mode" }`. The palette's main list is the config's order filtered by `entry.kind === "main-tool"`, labels from the descriptors; `toolLabels` is deleted.
- **`rebuiltGeodesicIds`** is deleted from the carry events and `worldGeometryComputedObjects`, and transitively from `carryEnd.ts`, where only tests still read it.
- **Docs.** `_docs/MATHEMATICAL_MODEL.md`, `_docs/ARCHITECTURE.md`, the header of `objects.ts`, generated references. `scripts/docs/lib.mjs`: the rule shape gains `alsoViaFrom`, which gives the emitters `cannon.ts` and `carryEnd.ts` only.
- **Tests added.** `tests/modules/geodesicEmitters.contract.test.ts` (18: each command's success and each refusal, with the registry version unchanged, the tool gate for all five), `tests/modules/geodesicEmitters/emitterTool.test.ts` (12), 4 in `toolHost.test.ts` (what a pick says, the aim yaw), 2 in `moduleImportRules.test.ts`, 1 in `paletteDefinition.test.ts`, 1 in `worldEngine.release.test.ts` (place, shoot, extend, delete, remove in the built app).

How each deleted follow-up was verified:

| Deleted | Where | How verified |
| --- | --- | --- |
| `removeProtractorAnglesForGeodesic`, `removeMeasuredGeodesicLengthsForGeodesic` | delete path | Test "deletes the arc with its segments and free end; its length and angle go with it" (a length and an angle on the arc, guard on). The records go inside `removeGeodesicIntervalAndDerivedObjects`, not in the derive tick, until issue 94 is settled. |
| The label runtimes those two removed | delete path | By reading only: `syncLabelRuntimesFromJournal` runs each frame after the ticks (`createThreeApp.ts` phase "label runtimes") and drops the runtime of a removed record. No test covers it. |
| `syncSelectableHitboxDebug` | place, shoot, extend, add, delete | By reading plus `tests/render/debugVisualization.test.ts`: the frame calls `syncSelectableHitboxDebugIfChanged` with the registry version after the ticks, and that test shows a new version rebuilds. Each of these commands writes, so the version changes. |
| `syncWorldObjects` of the tool host | after a tool's answer | Same; its one effect was that request. |

`removeProtractorAnglesForMissingVertices` was never in these paths. All three helpers keep their callers in rotate, aim, carry and lift, which this job may not change.

### Deviations

- **Tests changed beyond names, all because the job moved the code they fake:** `geodesicCannonCarry.test.ts` and `geodesicCannonCarryPolicies.test.ts` lose the deps the tools no longer take. `runtimeObjectActions.test.ts`: `extendGeodesic` for the old dep. `toolHost.test.ts`: the removed deps; the emitter tool leaves the expected list of a host built without the emitters' client part; "hands the result ... back" now asserts the palette sync instead of `objectSyncs`. `tieTool.test.ts`: the new context members. `paletteDefinition.test.ts`, `scenePaletteAdapter.test.ts`, `paletteDefinitionCache.test.ts`: the new `toolsById` argument. No assertion on geometry, motion or length changed.
- **`rebuiltGeodesicIds` assertions removed** (the Decision deletes the field): `carryEnd.test.ts` (4; one now expects `{}`, one reads `prunedIntersectionIds`), `tiedCarry.test.ts` (2), `worldGeometryComputedObjects.test.ts` (1). The assertions next to them, on the arcs themselves, stay. `carryEnd.ts` was not named in the Decision; the rule on unreachable code took it.
- **Place does not shoot.** The command places only, so a script gets a bare emitter. On the floor the tool submits `shoot` when `place` answers, and ends on the second answer. So a click is two commands and up to two ticks.
- **Behaviour that differs from the old tool code:** the emitter's page shows a new or deleted geodesic after the world answers, not at once. `extend` is now refused while emitters are disabled by configuration; before it was not gated. A refused `place` or an extension stopped at a wall shows the world's message; before it was silent. After an extension the selection's emitter is the arc's emitter, not the one selected before. The aim cache is dropped when the click is consumed, before the step, so aim feedback may be one frame old after a click.
- `geodesicEmitters/remove` has no button; scripts reach it through `api.world.submit`, and job 65 wraps it. The Decision asks for it.
- A release test was added though the job asks only to run that tier: the public API can now reach these commands, and it is the one check of the wiring in the built app.

### Uncertain

- **Job 64's Done-when conflicts with what this job needed.** `geodesicEmitters` lists `writesCoreKinds: [arc, vertex, segment, crossing]`, because `shootGeodesic` and `extendGeodesic` write in its frame. `geodesicModel` lists the two measurement kinds. Job 64 wants `writesCoreKinds` gone from `src`. Measurements can leave by issue 94's fix; the emitters' four kinds need another route, for example moving those writes behind model commands, and the Decisions of job 64 do not name one. `carry`'s rebuild will meet the same question when it calls `api.moveAlong`.
- **Issue 94, model half: reproduced.** With the guard on, `deleteGeodesic` on a measured arc threw `write guard: module geodesicModel wrote "geodesicMeasurements/length"` through `geodesicModel/removeCurve`. So I listed the two kinds on the model, as carry does, and left the settling to job 64 as the brief says. The contract test above pins it. Issue 94 is not edited.
- **`geodesicModel/reserveArcId`.** The Decision wants `geodesicModel/arc:<n>`, and `ctx.ids` prefixes the caller's module, so the id comes from a module-only command in the model; the `api` list of 5.7 is closed. A better answer may be a family argument on the id source.
- **The main tool's noun.** The Decision gives `geodesicEmitters/<noun>` without the noun; I used `emitter`, the same string as the kind. Kinds and tools are separate name spaces.
- **Additions the design does not list (013 not edited):** `ToolContext.currentPick`, `aimYawRadians`, `selectObject`, `showObjectPage`; `ToolHost.contextOf`; entry kind `sub-mode`; rule field `alsoViaFrom`; queries `curveOfArc`, `arcsOnEmitter`. `AimPick.cellId` and `point` now give the object's own point and cell for a crossing or a segment; the tie tool does not read them. `selectObject` writes `cannonToolState`, which stays client state until job 64.
- **`place` reads the point, not the pick.** The shape `{ cellId, point, yawRadians }` carries no object, so a script that means a segment must send a point within 1e-6 m of it. Better idea: an optional `onArcId`, but the Decision fixes the shape.
- `carryEnd.ts` is in the emitters' exception as the Decision says, but nothing in the module imports it until job 64.
- A geodesic crossing exactly at the midpoint of a geodesic cannot be cut there: `findSegmentsPassingThroughVertex` finds neither half, because each leaves no length on one side. It was so before (a silent no-op); it is now the refusal `blocked`. Not fixed.
- Names left as they are, since the job lists kinds, tools and id families: `geodesic-cannon-actions`, `show-geodesic-cannon-actions`, `geodesic-cannon-action:*`, `select-geodesic-cannon`, `desktop-tool-indicator-geodesic-cannon*`, file names, and functions such as `placeGeodesicCannonAtFloorPoint` (013 section 10: others keep their names unless false). The person-facing text "Locked" (focus message label, "Locked geodesic segment between emitters") also stays, since it is not an identifier.

### Not done

- **`legacyWorldWriters` did not shrink.** Eight files stay: `geodesicCannonTools.ts` still has rotate, aim and lift (2 direct writes, 2 mutator uses). `docs:writers`: 8 files, 24 direct write calls, 9 mutator uses, against 8, 24, 16 from job 62. Only mutator uses fell: the direct calls left are rotate, aim and legacy tools. The count is a lower bound.
- `syncSelectableHitboxDebug`, `removeProtractorAnglesFor*` and `removeMeasuredGeodesicLengthsForGeodesic` stay in rotate, aim, carry and lift, for job 64.
- `bench:ab` was not run: timing only, for the coordinator. The rename changed the bench file (names of scenes' helpers), so compare from `7db18a1` onward.
- **Manual checks, none done.** I cannot use a headset, and the desktop steps below were not run by hand either.
  Desktop (`npm run dev`, a torus world):
  1. Choose the emitter tool, click the floor: an emitter appears with a 2 m geodesic along the aim, and the tool ends.
  2. Choose it again, click that geodesic mid-way: an emitter cuts it in two. Click a crossing of two geodesics: all are cut there.
  3. With the tool, click an emitter in reach: a geodesic leaves in a random direction.
  4. With no tool, click a free geodesic: it grows by 2 m. Click one that connects emitters: nothing happens and no message. Click one that ends at a wall: the console shows the message.
  5. On an emitter's page: "Add geodesic" and a delete button update the list with the page staying open; a length label and an angle on a deleted geodesic vanish in the same frame or the next.
  6. The main list reads Sign, Geodesic emitter, Length, Protractor, and no carry, rotate or aim.
  7. With hitbox debug on, the wireframes follow steps 1 to 5.
  8. A config with emitters off: no emitter tool on the list.
  Quest 2: the same steps 1 to 5 with the trigger and the palette, and the wrist indicator shows the ray icon. Watch that a click on the floor still feels immediate at a low tick rate, since it is two commands, each waiting for a tick. Frame time should not change: nothing per-frame was added.

### Checks

- `npm run typecheck`: clean, before each commit and at the end.
- `npm test`: 174 files, 1548 tests passed.
- `npm run docs:check`: all ok, after `npm run docs:generate`.
- `npm run test:release`: 7 files, 17 tests passed.
- `npm run build`, then `npm run smoke -- --world cube,torus-moduli`: SMOKE OK (2 pages), after each change to `createThreeApp.ts` (rename, module) and at the end.
- `npm run bench -- moduleStep --check`: exit 3 on `7db18a1` (flow+dependents step time) and on `b4116d8` (flow and flow+dependents step time): timing only, right after other runs; no counter rose. flow 25.47, flow+dependents 33.76, many arcs 1677.24, tracked 1822.49, plain 2042.30 us/step; idle allocation 0.0 bytes/step; manyArcs writes 126897. `moduleStep.json` and `moduleStepCounters.json` are unchanged.
- `npm run docs:writers`: 8 files, 24 direct write calls, 9 mutator uses.
- `grep -rn '"geodesic-cannon"' src tests`: empty. `grep -n "engine.ids" src/render`: only `placed-flag`, `measured-geodesic-length`, `protractor-angle`.
