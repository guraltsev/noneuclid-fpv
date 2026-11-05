# Job 54 - Build tools from module descriptors

Status: in progress.
Resolves: part of issue [84](../../_issues/84_behaviors_are_hard_wired_into_the_shell_and_need_a_plugin_system.md) (requirements 1, 6).

## Goal

A tool is a descriptor a module contributes, and the shell has one lookup, not a chain naming each tool. The tie tool moves
into the geodesic model, and it gets the tool-level test job 33 lacked.

## Depends on

Job 53.

## Before you start

- Read design 013: sections 8.3, 9.1, 13.1 (the tie tool), and job 54 in section 15.
- Run `npm run typecheck` and `npm test` for a baseline.

## Background

The frame dispatch at `createThreeApp.ts:1184-1221` (line numbers will have moved) names each tool. Tool ids are one union
in `glue/toolIds.ts`. The emitter page has a hard-coded tie button and `canTieAndDetach`. Two live bugs in job 33's manual
test slipped through because no test drove the tool-level tie sequence.

## Decisions

- Core tools get descriptors registered by the shell. Module tools come from the experience's client parts.
- The tool-id union is core ids plus module ids by interface merging (`ModuleToolIds`).
- The tie tool id is `geodesicModel/tie`.
- A tool changes the world only by `ToolContext.submit`. `ToolContext.query` returns `queries` only.
- The tie highlight goes through the `geodesicModel/highlightEndpoint` command and stays on the segments until a client
  overlay exists.
- The emitter page's action list becomes the object-action contributions for that kind:
  `{ actionId, label, iconId, enabled }`.
- The tie tool is available when the emitter has at least two attachments on arcs that connect emitters. The menu asks this per frame: read
  `getGeodesicEndpointAttachmentsForAnchor` (the arc index), and do not scan.
- `onResult`: success ends the tool; a refusal shows the message and keeps the tool with no picks.
- `geodesicModel({ tieTool: false })`: no tool, no action, no tool id; `requiresTool` is dropped from the command, which stays
  for scripts.
- Carry, rotate and aim keep their per-frame updates in the shell (section 16).

## Steps

1. `ToolDescriptor`, `ToolContext`, `AimPick`, `ModuleClient` (8.3, 9.1); tool ids by interface merging.
2. One descriptor per existing tool. Every place listed in 8.3 reads `toolsById`. Rename the tie tool id.
3. Move the tie tool to `src/modules/geodesicModel/tieTool.ts`. Its picks move from `cannonToolState` to
   `moduleToolState.geodesicModel`. Delete `tieAndDetachEndpointSelections`.
4. Remove the files this empties from `legacyWorldWriters`.

## Tests and checks

- `tests/modules/geodesicModel/tieTool.test.ts`, with a fake `ToolContext` whose `pickTargets` returns scripted picks on a
  real engine: two picks of roles on connecting arcs tie, and the curve then shortens; a duplicate pick is ignored; another
  emitter's geodesic is refused; an out-of-range pick is refused; a world refusal is shown and keeps the tool; success ends
  the tool and clears its state; ending after one pick clears the highlight.
- An experience with `geodesicModel({ tieTool: false })` has no tie tool and no emitter-page action, while
  `api.geodesicModel.tieAndDetach` still works.
- `npm run typecheck`, `npm test`, `npm run docs:check`, `npm run smoke`, `npm run bench -- moduleStep --check`.

## Do not

- Do not give a tool a write path other than `submit`.
- Do not move carry, rotate or aim into modules.

## Done when

- `grep -rn "geodesic-cannon-tie-detach" src tests` is empty, and the frame dispatch chain is one lookup.
- The tie tool works on desktop and in VR, and all checks are green.

## Report

### Done

Commit d3b6aba (code, tests, docs). Baseline before changes: typecheck clean, `npm test` 167 files, 1419 tests.

- **Types** (`src/engine/moduleTypes.ts`): `ToolDescriptor`, `ToolContext`, `AimPick`, `AimPickEndpoint`, `ObjectActionPresentation`, `ObjectActionEntry`, `ModuleClient`.
- **Tool ids by interface merging** (`src/glue/toolIds.ts`): `CoreToolId`, `ModuleToolIds {}` (empty), `RuntimeToolId = CoreToolId | ModuleToolIds[keyof ModuleToolIds]`. The geodesic model merges `geodesicModelTie: "geodesicModel/tie"` in its `api.ts`. `coreIds.ts` is a `Record<CoreToolId, true>`; `geodesic-cannon-tie-detach` is gone from `src` and `tests` (grep empty).
- **One descriptor per tool**: the shell's tools are in `src/runtime/coreTools.ts#createCoreToolDescriptors` (place-flag, geodesic-cannon, measure-length, protractor, carry, rotate, aim; "none" and "aim" have no descriptor); the tie tool is in `src/modules/geodesicModel/tieTool.ts`, its client part in `client.ts#geodesicModelClient`. `src/runtime/toolRegistry.ts` builds `toolsById` (`createToolsById`, throws on a duplicate id) and has `objectActionsFor` and `findObjectActionTool`. `src/runtime/experience.ts#createDefaultClientModules` lists the client parts.
- **`src/render/three/toolHost.ts#createToolHost`**: owns `toolsById`, the `ToolContext` (one cached context per tool, so a command's result goes back to the tool that submitted it), the per-frame dispatch (`dispatchPrimaryAction`), `startObjectAction`, `toolStarted`, `toolEnded`, `afterStep`. `createThreeApp.ts` names no module tool (a grep for `geodesicModel`, `tie` and `Tie` in it is empty); its frame dispatch is `toolHost.setFrame(...)` plus `toolHost.dispatchPrimaryAction(...)` instead of the eight-branch chain.
- **Every place of 8.3 reads `toolsById`**: frame dispatch; desktop indicator (`setTool(descriptor, flagType, prompt)`; classes by `iconId`); VR wrist indicator (`resolveWristToolIndicatorVisual(descriptor, flagType)`); help lens (`createHelpLensDefinition({ toolsById })`); aim cross (`showsAimCross`); emitter page actions (`GeodesicCannonActionsPaletteContent.objectActions`, built from `objectActionsFor`, rendered by `palette/header.ts`, started by the new `start-object-action` command and effect); the ending tool's `ownerModuleId` state is cleared (see Deviations).
- **Tie tool moved**: `tieAndDetachEndpointSelections`, `tieAndDetachGeodesicsFromCannon`, `finishTieAndDetach`, `syncTieAndDetachSelectionHighlights`, `canTieAndDetachGeodesicsFromCannon`, `startGeodesicCannonTieAndDetach`, `trySelectTieAndDetachGeodesicFromAim`, `pendingTieTicket` and the `resolveCurrentAimTargets` dep of `geodesicCannonTools` are deleted. The tool acts only by `ToolContext.submit` (`tieAndDetach`, and `highlightEndpoint` on and off). Picks are in `moduleToolState.geodesicModel`.
- **Geodesic model**: `geodesicModelModule({ tieTool })` (default true): `toolIds: ["geodesicModel/tie"]` and `requiresTool` on `tieAndDetach` only when on. New query `tieableEnds(emitterId)` (reads the arc index through `getGeodesicEndpointAttachmentsForAnchor`, no scan).
- **`worldClient`**: `requestTool(toolId, objectId?)` keeps `objectId` in `pendingToolRequest` and calls `toolStarted(toolId, objectId)` after the world accepted and the tool was selected. The shell then requests pointer lock for a tool started from an object page (the old tie start did).
- **Tests added**: `tests/modules/geodesicModel/tieTool.test.ts` (14 tests: the job's list, plus prompt, first usable pick of a ray, highlight only on the picked half, `tieTool: false`, the default `requiresTool`), `tests/render/toolHost.test.ts` (13 tests), `tests/support/tools.ts` (shared `createTestToolsById`), one test in `worldClient.test.ts`, one in `runtimeEffects.test.ts`.
- **Docs**: `_docs/ARCHITECTURE.md` (tool descriptors, `toolsById`), generated references regenerated.
- **Counters** (`bench moduleStep --check`): none changed. flow writes 1557, flow+dependents 1797, manyArcs 126897, scans identical to the end of job 53; idle allocation 10.6 to 12.7 bytes/step across runs (baseline unchanged; the check passes). `legacyWorldWriters` is unchanged: I tried removing each of `geodesicCannonTools.ts`, `runtimeObjectActions.ts`, `createThreeApp.ts` and `ui/paletteDefinition.ts`, and `docs:check` fails for each; the new files `toolHost.ts`, `coreTools.ts` and `toolRegistry.ts` import no world-objects mutator.
- **Code only tests reach**: none new. Every new export is reached from `createThreeApp` through `toolHost`, except `tests/support/tools.ts` (test support). The pre-existing tool branch of the help lens is dead in the app (see Uncertain).

### Deviations

Changed test assertions (each is about the tie tool's old plumbing or the new signatures; no motion, length or geometry assertion changed):

1. `tests/runtime/applyRuntimeCommand.test.ts`: the `show-geodesic-cannon-actions` payload `canTieAndDetach: true` becomes `objectActions: [{ actionId: "tie-and-detach", label: "Tie & detach", iconId, tooltip, enabled: true }]` (command and `toMatchObject`). "forwards each cannon action": `start-cannon-tie-and-detach` becomes `start-object-action` (same forwarding assertion). "ignores cannon actions when emitters are disabled": the `start-cannon-tie-and-detach` line is removed, because the reducer no longer gates the object action; the world's tool gate refuses `geodesicModel/tie` instead (tested in `tieTool.test.ts` for the command: `world/capabilityMissing`).
2. `tests/runtime/runtimeMenuState.test.ts`: `definition.content.tieAndDetachAction toEqual({ label, disabled: true })` becomes `objectActions toEqual([])`; the enabled case: `canTieAndDetach: true` and `{ disabled: false }` become `objectActions: [entry]` and `toEqual([entry])`; test renamed "lists the actions the tools contribute to the emitter page".
3. `tests/ui/paletteDefinition.test.ts`: "disables tie-and-detach exactly when ... unavailable" becomes "shows each contributed action with the availability the cannon options give it" (`enabled` true and false).
4. `tests/render/scenePaletteAdapter.test.ts`: `canTieAndDetach: true/false` becomes `objectActions: [entry with enabled true/false]`; the item id `geodesic-cannon-action:tie-and-detach` is kept, so the other assertions are unchanged; the test "omits the tie-and-detach action when it is unavailable" is renamed "omits a contributed action when it is unavailable".
5. `tests/ui/paletteTooltips.test.ts`: `resolvePaletteTooltipLabel("geodesic-cannon-action:tie-and-detach")` was the long tie sentence; now `toBeUndefined()`, because the tooltip text comes from the descriptor (`entry.action.tooltip`) and the button carries it (`userData.scenePaletteTooltip`). The sentence is unchanged and lives in `tieTool.ts`.
6. `tests/render/runtimeEffects.test.ts`: the harness drops `session` and `syncTieAndDetachSelectionHighlights`; the "end-tool-session" test no longer expects `syncTieAndDetachSelectionHighlights([])`; `startGeodesicCannonTieAndDetach` becomes `startObjectAction` (new test for the routing).
7. `tests/render/xrControllerHandModels.test.ts`: `resolveWristToolIndicatorVisual("<id>", flag)` becomes `resolveWristToolIndicatorVisual(toolsById.get("<id>"), flag)`; every expected icon, color and label is unchanged.
8. `tests/ui/helpLensDefinition.test.ts`, `aimFeedback.test.ts`, `desktopInputHandlers.test.ts`: only the new `toolsById` argument. `geodesicCannonCarry.test.ts`, `geodesicCannonCarryPolicies.test.ts`, `runtimeObjectActions.test.ts`: the removed deps (`resolveCurrentAimTargets`, `canTieAndDetachGeodesicsFromCannon`) become `objectActionsFor: () => []`. `worldClient.test.ts`: the new `toolStarted` dep.

Differences from the job and the design:

- **Tool state is ended in `dispatchRuntimeCommand`, not in the `switch-tool-session` effect.** That effect is not produced by `clear-selected-tool` (used by `endTool()` and by `world/toolRevoked`) or by every other route that deselects a tool, so a tool state or a highlight could survive. The shell compares the selected tool before and after each command and calls `toolHost.toolEnded(previous)`: it runs the descriptor's `onEnd`, then clears `moduleToolState[ownerModuleId]`. The effect itself no longer touches tie state.
- **Descriptor fields beyond 8.3**: `helpRows` (the help lens rows), `badgeLabel` (the desktop badge name, e.g. "Ray"), `runsEveryFrame` (carry, rotate and aim run `onPrimaryAction` every frame, as the old chain did; this is how they stay per-frame in the shell), `onEnd`, and `entry.action` (`actionId`, `label`, `iconId`, `tooltip`) for the object action. `ModuleClient` has no `initialToolState` (nothing reads it). `AimPick.kind` is `objectKind`, and `objectId` is optional for a floor hit.
- **The palette main-page tool tiles still use the `toolLabels` table** in `paletteDefinition.ts` (Sign, Geodesic emitter, Length, Protractor): they list core tools only and no module tool has a `main-tool` entry yet, so reading `toolsById` there would put `toolsById` into `createPaletteDefinition`'s signature and about 20 test calls for no behavior. The palette tooltip of an object action does come from the descriptor. The `entry: { kind: "main-tool" }` of the core descriptors is therefore read by no code yet.
- **`api.geodesicModel.tieAndDetach` does not exist** (`ModuleInstance.publicApi` is not built; job 53 said the same). The test "has no tool and no page action with tieTool false; the command still works" submits the `geodesicModel/tieAndDetach` command through the engine, which is what `api.world.submit` does.
- **Factory name**: the world factory stays `geodesicModelModule(options)` (not `geodesicModel(options)`) and the client factory is `geodesicModelClient(options)`; the repository's existing name is kept.
- The desktop indicator no longer toggles `desktop-tool-indicator-aim` (it was set only for the `aim` tool, for which the indicator is hidden), and its `aria-label` is now `Selected tool: <label>[, <prompt>]` for every tool.
- The old `startGeodesicCannonTieAndDetach` also set `cannonToolState.selectedCannonId`; the emitter page already sets it when it opens, and the tie tool keeps its emitter in its own state, so it is not set again.

### Uncertain

- **Tool help is dead in the app.** `createHelpLensDefinition`'s tool branch (now reading `helpTitle`, `helpBody`, `helpRows`) runs only when no object is focused, and `aimFeedback` always passes a `focus`. It was dead before this job (only tests reached the old switch); the descriptors keep that text. Whether to show tool help when nothing is focused, or to delete the branch and the `helpRows` fields, is for the maintainer.
- **Availability of the page action is a snapshot** taken when the emitter page is shown (as `canTieAndDetach` was), not asked per frame; the job says "the menu asks this per frame". The query behind it (`tieableEnds`) reads the arc index and does not scan, so asking per frame is possible; it needs the open page to re-read `objectActions` each frame and the palette cache to follow it.
- **A refusal and the highlight**: the tool takes the first pick's highlight off before it asks for the tie, so after a refusal nothing is highlighted and the picks are empty, as specified. A tool restarted while it is running (from another emitter's page while the tie tool is still selected) runs `onEnd` before `onStart`, so the old highlight goes.
- **`ui/worldInteractionDefinition.ts` still lists the action id `"tie-detach-geodesics"`**, which nothing references (grep). Not removed (outside the job).
- The tie tool is available only from the emitter page (its `entry` is an object action); it is not on the main tool list, as before.

### Not done

- **Manual checks in the app on desktop and in VR.** I cannot drive an emitter scene: the public API cannot create emitters or arcs (job 45 is blocked), and I have no headset. Steps:
  1. `npm run dev`, open a torus world, choose the geodesic emitter tool, place two emitters and shoot geodesics so that two geodesics connect the emitters.
  2. Aim at emitter 2 and open its menu (right click): the page shows add, carry and the tie button (orange); with fewer than two connecting ends the tie button is dimmed. Hover the tie button: the tooltip reads "Select two geodesics attached to this emitter, tie them together, and release them from the emitter".
  3. Press the tie button: the menu closes, the pointer locks, the badge reads "Tie" with the prompt "select: geodesic 1". Click one of the two geodesics near emitter 2: its half near the emitter is highlighted and the prompt changes to "select: geodesic 2". Click the same geodesic again: nothing changes. Click a geodesic of the other emitter: nothing changes. Click the second geodesic: the highlight clears, the tool ends (badge gone), and the two geodesics tie at a new vertex and shorten toward the taut curve.
  4. Repeat, but after one pick open the menu and close it (or pick another tool): the highlight is gone and the tool ends.
  5. With the tie tool alone refused by the world, the console shows "This tool is not available in this world."
  6. In VR (Quest): the same sequence with the palette's tie button and the trigger; the wrist indicator shows the ray icon, the label "Tie" and the orange color.
- `bench:ab` (not needed: the bench check passed, once after a timing-only failure on the loaded machine, see Checks).

### Checks

- Baseline: `npm run typecheck` clean; `npm test` 167 files, 1419 tests.
- After: `npm run typecheck` clean; `npm test` 169 files, 1448 tests passed (29 new); `npm run docs:check` all ok (after `docs:generate`); `npm run smoke -- --world cube,torus-moduli` SMOKE OK (2 pages), run right after the `createThreeApp.ts` rewiring compiled and again at the end.
- `npm run test:release`: 7 files, 16 tests passed (twice).
- `npm run bench -- moduleStep --check`: counters pass; the run right after the release tests exited 3 ("flow step time", timing only); after 60 s the rerun was `check: ok`.
- `grep -rn "geodesic-cannon-tie-detach" src tests`: empty.
