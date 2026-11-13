# Job 79 - Help that teaches: three pages, generated How to, "Try it", first-use tips, Settings

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) sections 8.6, 8.7
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
