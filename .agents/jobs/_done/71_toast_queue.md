# Job 71 - Toasts: a renderer-neutral message queue shown on desktop and in VR

Status: done, needs review on 2026-11-13.
Resolves: nothing filed; design [017](../../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.3
("Announce changes"), principle P5.

## Goal

Short messages ("Laser", "Laser L3 placed", "Length 12.4 m", "World reset Â· U to undo") appear on screen for 2.5 s,
at most two at a time. `ToolContext.showMessage`, which today only logs to the console, shows a toast.

## Depends on

Job 70 (the words). Branch `dev`.

## Before you start

- Read `ToolContext.showMessage` in `src/engine/moduleTypes.ts` and where the shell implements it (search
  `showMessage` in `src/render/three/`).
- Read `src/render/dom/desktopToolIndicator.ts` and `src/render/dom/floatingObjectTooltip.ts` for how DOM overlays
  are built and disposed.
- Read `src/render/three/xrControllerHandModels.ts` (the wrist indicator sprite) for how a small label is drawn near
  the hand in VR, and `src/render/three/worldResultBadge.ts` for a canvas-texture label.

## Decisions

1. `src/ui/toastQueue.ts`: a pure queue. `createToastQueue({ durationMs: 2500, maxVisible: 2 })` with
   `push(text, options?: { action?: { label: string; id: string } })`, `tick(nowMs)`, `visible(): readonly Toast[]`.
   Oldest visible toast goes first when a third arrives. Identical text pushed while visible restarts its timer
   instead of stacking.
2. Desktop: `src/render/dom/toastView.ts`, bottom center, above where the belt will be (about 96 px from the bottom),
   white text on a dark translucent pill, `aria-live="polite"`.
3. VR: one canvas-texture panel parented to the left controller's grip space, above the wrist, like the wrist indicator.
   Job 77 moves it for the one-controller layout; here, put it on whichever controller the wrist indicator uses today.
4. An optional action renders as a small button in the toast on desktop (clickable only when the pointer is unlocked)
   and as text "(U)" for undo; job 73 wires undo. VR shows the action label only.
5. `showMessage` pushes a toast and still logs at debug level.
6. Tool selection changes push the tool's name (from the vocabulary) as a toast: hook the place where
   `desktopToolIndicator.setTool` is called in `createThreeApp.ts` (around line 1736) and compare with the previous tool.
   Selecting no tool pushes "Hand".

## Steps

1. Baseline.
2. `toastQueue.ts` with `tests/ui/toastQueue.test.ts` (expiry, max two, restart on duplicate, action kept).
3. Desktop view and wiring to the shell's frame loop (tick with `performance.now()`).
4. `showMessage` â†’ toast. Tool-change toast.
5. VR panel.
6. Finish as the README says.

## Tests and checks

- Unit tests above.
- CDP check (design 017 appendix): select a tool through the palette; `document.body.innerText` contains its name.

## Do not

- Add new messages beyond the tool-change toast and `showMessage`; later jobs add theirs.

## Done when

Toasts show on desktop and in VR, `showMessage` uses them, a tool change is announced, checks pass, commit on `dev`,
report appended.

## Report

### Done
- `src/ui/toastQueue.ts`: pure queue (`createToastQueue({ durationMs, maxVisible, now? })`, `push(text, { action?, nowMs? })`, `tick`, `visible`). `tests/ui/toastQueue.test.ts`: expiry, max two, restart on duplicate, action kept, default clock.
- `src/render/dom/toastView.ts` and `.toast-view*` rules in `src/style.css`: bottom center, 96 px up, dark pill, `aria-live="polite"`; the action is a button (disabled while the pointer is locked; "(U)" follows an "undo" label).
- VR: `xrControllerHandModels.ts` gets a canvas-texture sprite panel above the right wrist indicator (the controller the indicator uses today), fed by a new `toasts` field of the update frame; `desktopInputHandlers.ts` passes `visibleToasts` through. The panel is built on the first toast.
- `createThreeApp.ts`: `showWorldMessage` (so `ToolContext.showMessage` and world refusals) pushes a toast and still logs; the toast queue ticks and the view renders once per frame; `syncDesktopPalette` pushes the tool's name (from `toolNames`) on a tool change, "Hand" for no tool or the aim tool; the first sync only records the starting tool.
- Generated docs refreshed.

### Deviations
- The old in-world `worldMessageDisplay` (a camera-relative plane) is no longer used by the shell, since the toast replaces it; its module and tests stay.
- `push` takes an optional time (`nowMs`) or the queue's clock, because the job's `push` signature has no time.

### Uncertain
- The CDP check (select a tool through the palette; `document.body.innerText` contains its name) was not run; no browser session was driven. The DOM path is covered only by typecheck and the unit tests.
- The VR panel placement (0.3 m above the wrist, 0.26 m wide) was not seen in a headset.
- `worldMessageDisplay.ts` is now unused by the app; remove it in a later job if wanted.

### Not done
- The toast action button is wired to a no-op; job 73 wires undo.

### Checks
- `npm run typecheck` clean; `npm run docs:check` all ok; `npm test`: 197 files, 1858 tests passed.
