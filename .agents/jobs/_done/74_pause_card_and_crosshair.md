# Job 74 - Pause card (the desktop main menu) and an always-on crosshair

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) sections 8.1, 8.2
item 1, 7.5 (F1, F2, F3, F5, F9).

## Goal

On desktop, whenever the pointer is not locked (at start and after Esc), a card shows the activity title, a one-line
description, "Click to play", a controls table generated from the input intents, and the main-menu actions Help,
Settings, Go home, Start over. A crosshair is visible at all times while playing.

## Depends on

Jobs 70 (words), 73 (Start over). Branch `dev`.

## Before you start

- `src/render/three/desktopControls.ts`: `requestPointerLock`, `resume`. No code listens to `pointerlockchange` today.
- `src/render/three/createThreeApp.ts:416` (`controls.requestPointerLock()` on click).
- `src/ui/inputIntents.ts` (`getInputHintGlyph`) and `src/ui/inputModeText.ts`.
- How the activity title and goals reach the app: `startingQuestionCube` goal pages in `src/authoring/worldBuilder.ts`
  and the configs in `public/00*.config.js`.
- The existing aim cross (`showsAimCross` on tool descriptors, `src/render/three/aimFeedback.ts`).
- How the palette opens its Help, Settings pages, and how Go home is triggered (`teleportPlayerHome`).

## Decisions

1. `src/ui/pauseCardDefinition.ts` (pure): `{ title, description, controls: { verb, glyphLabel }[], actions:
   ("help" | "settings" | "go-home" | "start-over")[] }`, built from the world, the config and the intents. Controls rows:
   Look, Walk, Use, Menu, Switch tool, What's this? (the verb names from the vocabulary). Until job 75 lands, "Switch
   tool" shows "Right click on the floor"; job 75 changes it to "1–5".
2. Title: the config's display name if it has one, else the world's name. Description: the first sentence of the first
   goal page. If neither exists, omit the line.
3. `src/render/dom/pauseCard.ts`: shown while `document.pointerLockElement !== canvas` on desktop and not in XR; the
   scene behind is dimmed with a 35 % black overlay. "Click to play" (and a click anywhere on the card outside the
   actions) requests pointer lock. Help and Settings open the palette on those pages and keep the pointer unlocked
   until the palette closes, then the card shows again. Go home teleports and resumes. Start over asks "Remove
   everything you placed?" with Yes/No, then calls the reset path of job 73.
4. Opening the card closes any open palette menu (`close-menu`).
5. Crosshair: `src/render/dom/crosshair.ts`, a 6 px white dot with a 1 px dark outline at the screen center, always on
   while the pointer is locked. It becomes a 16 px ring when the aim has a usable target (use the existing focus state)
   and takes the selected tool's `indicatorColor`. The red aim cross stays as it is.
6. Headless browsers cannot lock the pointer; the CDP recipe stubs `document.pointerLockElement`. The card must read
   `document.pointerLockElement` each time (not cache it) so the stub works.

## Steps

1. Baseline.
2. `pauseCardDefinition.ts` and `tests/ui/pauseCardDefinition.test.ts` (rows match the intent table; title fallback).
3. DOM card and its wiring to `pointerlockchange`.
4. Crosshair.
5. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP without the pointer-lock stub: first frame of `?config=001` has "Click to play" and at least four control rows in
  `document.body.innerText`.

## Do not

- Change Esc handling inside open palette menus.
- Change VR (no pointer lock there; the VR start card is job 77).

## Done when

The card shows at start and after the lock is lost, its actions work, the crosshair is always on, checks pass, commit
on `dev`, report appended.

## Report

### Done
- `src/ui/pauseCardDefinition.ts` (pure): `createPauseCardDefinition({ configDisplayName?, worldName, goalPages? })` gives `{ title, description?, controls, actions }`. Controls rows (Look, Walk, Use, Menu, Switch tool, What's this?) take their control names from `getInputHintGlyph("desktop", ...)`; "Switch tool" shows "Right click on the floor" until job 75. Title: the config's display name, else the world name made readable ("001-basic-cube" becomes "Basic cube"). Description: the first sentence of the first goal page; omitted when there is none.
- `src/world-objects/vocabulary.ts`: `verbNames.look`, `verbNames.walk`, and `pauseCardText` (Click to play, Settings, the start-over question, Yes, No, the placeholder control).
- `src/render/dom/pauseCard.ts`: overlay dimming the scene by 35 percent with the card; a click on "Click to play" or anywhere outside the actions requests the pointer lock; Start over asks "Remove everything you placed?" with Yes and No. `src/render/dom/crosshair.ts`: 6 px dot with a dark outline, a 16 px ring when the aim has a target, the selected tool's `indicatorColor`. CSS in `src/style.css`.
- `src/render/three/createThreeApp.ts`: card and crosshair created next to the tool indicator; each frame `document.pointerLockElement === renderer.domElement` is read (not cached) to show the card (desktop only) and the crosshair; `pointerlockchange` to unlocked dispatches `close-menu` when a menu is open. Help opens the menu on the help cube's page (`show-question-help` with the `startingQuestionCube` pages), Settings opens `show-settings`, Go home calls `teleportPlayerHome`, Start over (after Yes) sets the same `startOverRequested` flag as job 73; every action then requests the pointer lock. The config display name is the config catalog label without its number ("001 Basic Cube" gives "Basic Cube").
- Tests: `tests/ui/pauseCardDefinition.test.ts` (5 tests: rows match the intent table, actions, title fallback, description). Commit: 25f3f7e on `dev`.

### Deviations
- Fixed a bug that was not in this job: since job 71 the app failed to start ("Could not load world: Cannot access 'announcedTool' before initialization"), because `let announcedTool` was declared after the first palette sync. I moved that one declaration up next to `toastQueue`. `npm run smoke` did not catch it (it served an old `dist` build and reported OK; see Uncertain).
- Help and Settings keep the pointer locked, not unlocked as decision 3 says: the palette is driven with the pointer locked (look mode "palette"), so the pointer is taken when the palette opens. The card is hidden while the palette is open and shows again when the lock is lost (Esc closes the menu and releases the lock).
- The crosshair is hidden while a palette menu is open (the palette has its own cursor), and "usable target" is the existing focused-object state (`findFocusedRuntimeObject`), not any floor hit.
- No config has a display-name field; I used the config catalog label (numbered configs only) rather than adding a field.

### Uncertain
- `npm run smoke` serves `dist` without building. Run `npm run build` first or it checks an old build; this hid the startup bug above. Worth a note in the smoke docs or a build step.
- The Help action opens the help cube's page; if a world has no help cube, Help opens the main menu page. Job 79 will replace this with the real Help pages.
- The card and the crosshair have no unit tests (no DOM test environment for views); they were checked in headless Chrome (below).
- Not checked: real pointer lock with a mouse, and the Help, Settings, Go home and Start over buttons by clicking.

### Not done
- VR is untouched, as the job says (the VR start card is job 77).

### Checks
- Baseline: typecheck clean, `npm test` 198 files / 1868 tests passed.
- After: `npm run typecheck` clean; `npm run docs:generate` then `npm run docs:check` all ok; `npm test` 199 files / 1873 tests passed (the intermittent `moduleImportRules` timeout did not appear).
- Headless Chrome, `?config=001` on a fresh build, no pointer-lock stub: `document.body.innerText` has "Basic Cube", "Explore the world.", "Click to play", six control rows, and the four actions; the crosshair is hidden. With `document.pointerLockElement` stubbed to the canvas: card hidden, crosshair shown.
- Pages check skipped (`gh` is disabled).
