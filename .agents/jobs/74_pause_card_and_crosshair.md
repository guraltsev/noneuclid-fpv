# Job 74 - Pause card (the desktop main menu) and an always-on crosshair

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) sections 8.1, 8.2
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
