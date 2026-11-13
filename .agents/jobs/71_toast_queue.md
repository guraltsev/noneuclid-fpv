# Job 71 - Toasts: a renderer-neutral message queue shown on desktop and in VR

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) section 8.3
("Announce changes"), principle P5.

## Goal

Short messages ("Laser", "Laser L3 placed", "Length 12.4 m", "World reset · U to undo") appear on screen for 2.5 s,
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
4. `showMessage` → toast. Tool-change toast.
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
