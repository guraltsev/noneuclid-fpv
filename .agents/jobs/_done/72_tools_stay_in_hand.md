# Job 72 - Tools stay in hand until put away

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.3 (F11, F13).

## Goal

After placing a laser, a sign, or a measurement, the tool stays selected, so the next click does the same thing. The
student puts a tool away explicitly: key 0 on desktop, or (until the belt exists) a "Hand" entry on the tool menu.

## Depends on

Job 71 (toasts announce the tool change). Branch `dev`.

## Before you start

- Note K-20261112-0eb0: after placing one emitter, `selectedTool` returned to `none`.
- `ToolContext.endTool()` in `src/render/three/toolHost.ts` (around line 177) closes the menu and dispatches
  `clear-selected-tool`. Its callers: `src/modules/geodesicEmitters/client.ts` (two calls),
  `src/modules/geodesicMeasurements/client.ts`, `src/modules/geodesicModel/tieTool.ts`,
  `src/modules/placedFlags/client.ts` (after `outcome === "placed"`), `src/modules/worldMap/client.ts`, and
  `src/render/three/geodesicCannonTools.ts:213`.
- `showRuntimeMenuMainPage` in `src/runtime/runtimeMenuState.ts` also resets `selectedTool` to `"none"`.
- Read `src/render/three/desktopControls.ts` for key handling (KeyR, KeyF, KeyG, KeyH).

## Decisions

1. Main tools (`entry.kind === "main-tool"`: Laser, Ruler, Protractor, Sign) stay selected after a successful use.
   Remove their `endTool()` calls that run after a successful placement or measurement. Keep `endTool()` where the
   tool ends because it cannot continue (an error outcome) and record each kept call with its reason in the report.
2. Object-action and sub-mode tools (aim, rotate, carry, Join/tie) keep ending after their one action: they are modes
   started from an object's menu, not belt tools. The Map keeps its current behavior (Use closes it).
3. Opening the main page of the menu no longer clears the tool: remove `selectedTool: "none"` from
   `showRuntimeMenuMainPage`. Fix tests that relied on it and record them under `### Deviations`.
4. Desktop key `Digit0` (and `Numpad0`) dispatches `clear-selected-tool` when no menu is open. Add it to the keys
   `desktopControls.ts` claims. Add a `hand` intent to `src/ui/inputIntents.ts` (desktop "0"; XR "Not available yet"
   until job 77) and to the `TutorialInputIntent` union it reuses.
5. Add a "Hand" tile first on the main tool list of the palette (`src/render/three/palette/pages/main.ts`,
   `paletteDefinition.ts`), using the vocabulary's Hand name; selecting it clears the tool. Job 75 replaces the tool
   list with the belt; this tile is the bridge.
6. A toast "Hand" appears through job 71's tool-change toast; nothing extra is needed.

## Steps

1. Baseline.
2. Change the module clients (decision 1) one module at a time, running `npx vitest run tests/modules/<module>` after
   each.
3. Menu state change (decision 3); `npx vitest run tests/runtime tests/ui`.
4. Key 0 and the intent (decision 4); tests in `tests/render` for desktop controls if they exist.
5. Hand tile (decision 5).
6. Finish as the README says.

## Tests and checks

- A test (module or render level, whichever exists for tool flow) that places two signs in a row without reselecting.
- CDP check: select the Laser, click the floor twice; two lasers exist and `selectedTool` is still the laser tool
  (`noneuclid.api.debug.dumpAllGeodesics()`).

## Do not

- Change what the tools do on use.
- Touch the right-click behavior (job 75).

## Done when

Main tools stay selected, 0 and the Hand tile put them away, checks pass, commit on `dev`, report appended.

## Report

### Done
- Main tools stay selected: removed `endTool()` after a placed laser (floor and on a beam), a shot with no page, a placed sign, and a created length or angle (`src/modules/geodesicEmitters/client.ts`, `placedFlags/client.ts`, `geodesicMeasurements/client.ts`).
- Kept `endTool()` calls: `worldMap/client.ts` (Use closes the Map, decision 2), `geodesicModel/tieTool.ts` (Join is a sub-mode), `geodesicCannonTools.ts` `leaveMode` (aim, rotate, carry modes). The emitter client's error path never called `endTool()` (it shows the refusal and stays), so no error-path call needed keeping.
- `showRuntimeMenuMainPage` no longer resets `selectedTool`.
- Key `Digit0`/`Numpad0`: `desktopControls.ts` claims it and reports `handRequested` (new optional field of `InputFrame`); `createThreeApp.ts` dispatches `clear-selected-tool` when no menu is open. New `hand` intent in `TutorialInputIntent` and `src/ui/inputIntents.ts` (desktop "0", XR "Not available yet").
- Hand tile: `createToolOptions` in `src/ui/paletteDefinition.ts` puts `{ id: "none", label: "Hand" }` first (name from `toolNames.none`); `onToolSelected("none")` in `scenePaletteCommands.ts` closes the menu and clears the tool; tooltip for it in `paletteTooltips.ts`. The toast comes from job 71's tool-change toast unchanged.
- Tests: two signs in a row without reselecting (`tests/modules/placedFlags.test.ts`); key 0 edge (`tests/render/desktopControls.test.ts`).
- `npm run docs:generate` was run.
- Commit: 097993a.

### Deviations
- Existing tests changed because they asserted the old ending: `emitterTool.test.ts` (5 expectations of `ended`, 2 titles; one title shortened for the 90-character rule), `geodesicMeasurementTools.test.ts` (4 expectations, 2 titles), `placedFlags.test.ts` (4 expectations, 1 title), `tests/render/toolHost.test.ts` (2 tests now expect the tool to stay selected; one title changed), `tests/runtime/runtimeMenuState.test.ts` (main page keeps the tool; title changed), `tests/ui/paletteDefinition.test.ts` (Hand first in the list).
- Key 0 is ignored while the selected tool is one of the emitter's modes (`geodesicEmitters/...`), so it cannot drop a carried beam; the job did not say this.
- `handRequested` is optional on `InputFrame` to avoid editing every frame constructor.

### Uncertain
- Emitter `shot` with no object page now keeps the laser tool (it is only reached from the main-tool laser); confirm no sub-mode relies on the old end.

### Not done
- The CDP check (select the Laser, click the floor twice, read `dumpAllGeodesics()`) was not run: no browser session was available. Module-level tests cover two placements in a row for signs.
- Pages check skipped (`gh` is disabled).

### Checks
- `npm run typecheck`: clean. `npm test`: 197 files, 1860 tests passed. `npm run docs:check`: ok. No intermittent timeout appeared.
