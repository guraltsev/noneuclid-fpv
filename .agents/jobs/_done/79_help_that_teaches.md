# Job 79 - Help that teaches: three pages, generated How to, "Try it", first-use tips, Settings

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) sections 8.6, 8.7
(F14, F22, F23).

## Goal

The help cube opens Help with three pages: Things to try (the world's goal prose), How to (Basics plus one card per
tool, in belt order) and Discoveries (empty placeholder until job 82). Each tool card has "Try it". The first time a
tool is taken in a session, a tip shows its first step. Settings gains the comfort and display options.

## Depends on

Jobs 75 (belt order), 77 (XR glyphs, Left-handed and one-controller settings), 78. Branch `dev`.

## Before you start

- `src/authoring/worldBuilder.ts`: the 11 default tutorial pages and `startingQuestionCube`; `TutorialPageSpec` in
  `src/cell-complex/specs.ts`.
- `src/ui/paletteDefinition.ts`: `TutorialPaletteContent`, `GoalPaletteContent`, `QuestionHelpPaletteContent`,
  `PagedHelpControl`, `questionHelpHubBody`; `src/world-objects/helpHubCopy.ts`; `src/render/three/palette/pages/help.ts`.
- The settings page (`SettingsPaletteContent`) and `src/render/three/palette/tokens.ts` (font tokens).

## Decisions

1. `TutorialPageSpec` gets optional `toolId`. The default pages are regrouped into: "Basics" (Look and walk; the tool
   belt; menus; What's this?) marked "Start here", then one card per tool merging today's pages: Laser (Straight rays,
   Aim a ray, Linked beams, Move a laser, Join), Ruler, Protractor (from Measure), Sign, Map. Text uses the vocabulary
   and glyphs of the current input mode and layout.
2. How to is generated: cards in belt order; a card whose tool the config disables is left out; a card whose tool the
   world cannot support stays, with its disabled reason at the top. Config-dependent sentences (what Settings contains)
   are generated.
3. "Try it" on a tool card selects the tool, closes Help, and shows the card's first step as a tip.
4. First-use tips: `src/ui/firstUseTips.ts` (pure): per tool, an ordered list of `{ text, advanceOn }` where
   `advanceOn` names an event ("laser-placed", "beam-extended", "measurement-placed", "sign-placed"). The first time a
   tool is selected in a session, the tip pinned beside the belt (desktop) or above the belt (VR) shows step 1 with
   "Next" and "Got it"; it advances on the event. "Reset tips" in Settings clears the seen set (stored in
   `localStorage`, try/catch).
5. Pages read get a tick (best effort, `localStorage`).
6. Pictures on How to cards go above the text at full panel width.
7. Help hub sentence generated from the main-menu binding: "Lost? Press Esc and choose Go home"; VR two controllers
   "Press X and choose Go home"; one controller "Hold B (or Y) and choose Go home".
8. Settings: Controls (generated reference, mouse sensitivity, invert Y, turn speed, Left-handed, Use one controller),
   Display (text size small/medium/large scaling DOM HUD and palette font tokens, Show hints, Show edges placeholder
   hidden until job 82, Reset tips), Comfort (existing vignette). World selection and debug stay gated by config.

## Steps

1. Baseline.
2. Spec change and regrouped default pages; update `tests/authoring` expectations (record deviations).
3. Help pages and generation, with unit tests: torus How to shows Map with "No map for this world"; Basics first.
4. Try it; first-use tips with `tests/ui/firstUseTips.test.ts`.
5. Settings additions.
6. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP: on `?config=005`, open the help cube, How to, Laser, Try it: the Laser is selected and the palette closed.

## Do not

- Add discoveries (job 82) or new goal checking.

## Done when

Help has the three pages, How to is generated, Try it and tips work, Settings has the new options, checks pass, commit
on `dev`, report appended.

## Report

### Done

Commit: `2492064` on `dev`.

- Spec and default pages: `TutorialPageSpec` gets `toolId` and `startHere`. The default pages are regrouped into Basics (Look and walk, the tool belt, menus, What's this?, marked Start here), Laser (the five old laser pages merged), Ruler, Protractor, Sign and Map (`src/authoring/worldBuilder.ts`).
- Generation (`src/ui/howToCards.ts`, pure): `selectHowToPages` puts pages without a tool first, then the tool cards in belt order, drops the card of a tool the config switches off and keeps the card of a tool the world cannot support with its reason; `settingsSections` and `lostSentence` generate "Settings has Controls, Display, Comfort and ..." and "Lost? Press Esc / Press X / Hold B / Hold Y and choose Go home" from the main-menu binding of the layout. `createThreeApp.dispatchRuntimeCommand` applies the selection to every `show-question-help` (the pause card's Help and the help cube both), and `show-question-help` carries `toolDisabledReasons`.
- Help pages (`src/ui/paletteDefinition.ts`, `palette/pages/help.ts`): the hub offers Things to try, How to and Discoveries (disabled, "Nothing to discover yet"); the How to index shows "Start here" on Basics and a tick (`Check` icon) on opened cards, with the reason under a card of an unsupported tool; a card has its picture above the text at full panel width inside one scrolling column, the reason at the top, a "Try it" button (disabled with the reason when the tool is unsupported) and Previous/Next. Opened cards are remembered (`helpCardsRead`).
- Try it: command `try-tool` (same reducer path as `select-tool`, closes Help); the shell then shows the tool's tip regardless of the seen set.
- First-use tips: `src/ui/firstUseTips.ts` (pure: steps with `advanceOn`, transitions, placeholders `{use}` `{menu}` `{hand}` filled from the device's glyphs, the seen set and its stored form), `src/render/three/firstUseTipController.ts` (state, storage, per-frame event detection from the registry change journal: laser added, sign added, measurement added, a beam's intended length grew; one step per frame), `src/render/dom/tipCard.ts` and CSS (card beside the belt, above it on a narrow window; "Next" and "Got it"). In VR the step is shown as a toast.
- Settings (`palette/pages/debugSettings.ts`, `settingsStorage.ts`, `desktopControls.setLookTuning`): Controls (generated reference of the verbs and their controls on the current device, Mouse sensitivity Low/Medium/High, Invert Y, Turn speed Slow/Medium/Fast, Use one controller, Left-handed), Display (Text size Small/Medium/Large, Show hints, Reset tips), Comfort (vignette), then World, Config and Debug as the config allows. Text size scales the palette font sizes (`tokens.ts` `fontPx`, `setPaletteTextScale`) and the page's root font size (the DOM HUD is in rem). The new values and the opened cards are remembered in `localStorage` (try/catch).
- Vocabulary: `helpText`, `firstUseTipText`, `settingsText`, `lostGuidanceFor`, `disabledReasons.noDiscoveriesYet`; tooltips for the new item ids.
- Tests: `tests/ui/firstUseTips.test.ts`, `tests/ui/helpPages.test.ts` (Basics first and marked, Map kept with "No map for this world" when the world has none, config-off cards left out, Try it, generated sentences, VR sentence), `tests/runtime/helpSettingsCommands.test.ts`, `tests/render/firstUseTipController.test.ts` (with a real change journal), `tests/render/helpSettingsPalette.test.ts`, `tests/render/settingsStorage.test.ts`, `tests/render/desktopLookTuning.test.ts`.

### Deviations

- Existing tests updated: `tests/runtime/runtimeMenuState.test.ts` (the hub now lists Things to try, How to, Discoveries in that order) and `tests/ui/paletteTooltips.test.ts` (new test added; a `tutorial-topic:` id now has a tooltip). `tests/authoring` needed no change (the world test still finds the lost sentence in a page body; the default pages are checked there only by reference).
- Discoveries is a disabled hub button with a reason, not an empty page: the page arrives with job 82, and a page kind would have to be added to the menu state and cleared in several places for nothing to show.
- The reducer keeps its `requiresTools` filter, but not for a page that has a `toolId` (the shell already chose those against the belt, which is built from the config as loaded and so can keep the Map card in a world the narrowed config has no map for).
- Basics' generated "Settings has ..." sentence is appended after the lost sentence.
- The mouse sensitivity, turn speed and text size are three-step choices (factors 0.5/1/2, 0.6/1/1.6, 0.85/1/1.25 for text); the design gave no numbers.
- Show edges is not shown (job 82).

### Uncertain

- The tip's "Next" and "Got it" are DOM buttons, clickable only while the pointer is unlocked (as the belt slots are); while playing the tip moves on by itself on the event and ends when the tool is put away. There is no key for "Got it". In VR the tip is a toast, with no buttons, not a card above the belt.
- "Beam extended" is detected as an Updated beam whose `intendedLengthMeters` grew; a curve-shortening or deformation change cannot grow it, but a future writer that raises the length for another reason would advance the laser tip.
- The card layout (picture 150 px high, scrolling column, panel height 600) was checked in a headless desktop screenshot only, not in a headset. Tool cards with long text scroll.
- The desktop glyph label "1-5 and wheel" renders with a missing-glyph box in the uikit font (an existing glyph label, now also shown in the controls reference).
- Text size does not change fixed-height rows (buttons stay 34 to 58 px), so Large text on the longest labels may clip.

### Not done

- Show edges (job 82) and the Discoveries page (job 82).
- No VR (headset) check; the VR tip, the lost sentence per layout and the one-controller glyphs are covered by unit tests only.

### Checks

- Baseline before changes: typecheck, docs:check, npm test green.
- After: `npm run typecheck` clean; `npm run docs:check` all ok (after `docs:generate`); `npm test` 215 files, 2014 tests passed (a first run failed `tests/project/testHygiene.test.ts` H6 on two test names over 90 characters; renamed); `npm run build` then `npm run smoke -- --config 001`: SMOKE OK cube.
- Headless Chrome (`.temp/check79.mjs`) on `?config=005`: Help from the pause card shows the hub with the lost sentence and three buttons (Discoveries greyed with its reason); How to shows Basics with "Start here", Laser, Ruler, Protractor, Sign and Map with "No map for this world" under it (this config has no map); the Laser card shows the picture across the panel above the text with Try it; pressing Try it closes the palette, the belt's active slot is `geodesicEmitters/emitter` and the tip card reads "Aim at the floor and use Left click to place a laser" with Next and Got it. The Settings page shows the controls reference, the step rows, Invert Y, Reset tips and Comfort. GitHub Pages checks skipped (`gh` is disabled).
