# Job 77 - VR: hand roles, one-controller layout, the belt on the wrist or the waist, the VR main menu

Status: queued.
Resolves: nothing filed; design [017](../../_docs/design/017-discoverable-ui-and-level-design.md) sections 7.1 (VR
columns), 7.2, 7.3, 7.4, 7.5, 8.1 (VR start card) (F10).

## Goal

In VR, the two controllers get roles (pointer hand and belt hand), and a single controller, left or right, can do every
verb. The tool belt is a strap on the belt-hand wrist with two controllers and at the waist with one. Tools are never
reached through an aim-dependent menu. The main menu opens from a button, not from the aim.

## Depends on

Jobs 73 (XR reset removed), 75 (belt definition, main page), 76 (hint strip definition). Branch `dev`.

## Before you start

- Design 017 sections 7.1 to 7.5: the two VR columns of the verb table and section 7.3 are the specification.
- `src/render/three/xrControls.ts` (whole file). Today it ignores `handedness`, sums the sticks, and each button means
  the same on both hands: 0 trigger (primary), 1 squeeze (context menu and cancel), 3 stick press (reset; removed by job
  73), 4 lower face (carry), 5 upper face (help). Its tests in `tests/render/`.
- `src/interaction/inputFrame.ts` (`RuntimeInputFrame`) and `src/interaction/vrLocomotion.ts`.
- `src/render/three/xrControllerHandModels.ts` (wrist indicator near the right wrist), `src/render/three/xrPlayerRig.ts`.
- `src/render/three/vrPalettePlacement.ts` and `scenePaletteController.ts` (how the VR palette is placed and hit).
- `src/ui/inputIntents.ts` (`InputMode = "desktop" | "xr"`).

## Decisions

1. Layout detection, per frame, from sources with a gamepad: two sources with handedness `left` and `right` →
   `two-controllers`; exactly one source → `one-left`, `one-right`, or `one-right` for handedness `none`. A Settings
   switch "Use one controller" forces the one-controller layout using the pointer hand's controller. "Left-handed"
   (Settings) swaps roles: pointer hand left, belt hand right. Store both in the menu state like the comfort options.
2. `InputMode` stays `"desktop" | "xr"`; add `XrLayout = "two-controllers" | "one-left" | "one-right"` and give
   `getInputHintGlyph` an optional layout parameter. Glyph letters follow the controller: A/B on the right, X/Y on the
   left.
3. Two controllers. Pointer hand: trigger Use, grip Menu (toggle), lower face Pick up, upper face What's this?, stick x
   turn. Belt hand: stick walk and turn, trigger next tool, grip Hand, lower face (X when left) main menu, upper face
   unbound.
4. One controller: stick y walk and x turn; trigger Use; grip Menu (toggle); lower face Pick up; upper face tap
   What's this?, held 1000 ms main menu (the tap fires on release before 1000 ms; the hold fires at 1000 ms and
   suppresses the tap); stick press next tool, counted only when the stick is inside the locomotion dead zone at the
   moment of the press.
5. New `RuntimeInputFrame` request flags as needed: `nextToolRequested`, `handRequested`, `mainMenuRequested`. Keep
   edge detection in `createXrControls`, per source and per role.
6. Belt rendering: one scene object drawing `toolBeltDefinition` slots as a strap of small panels (reuse the palette's
   uikit rendering if a small panel is cheap; otherwise canvas textures like `worldResultBadge.ts`).
   - Two controllers: anchored to the belt-hand grip space, along the forearm; scale 1.0 normally, 1.8 when the angle
     between the head's forward vector and the direction to the strap is under 25°.
   - One controller: anchored to the player rig at waist height (head height − 0.55 m, at least 0.6 m above the floor),
     0.35 m in front, following the head's yaw only, smoothed like the palette.
   - Slots are pointable with the pointer ray; Use on a slot selects it. Point tests reuse the palette's hit path or
     a raycast against the strap.
7. Tool-change toasts (job 71) move: above the belt-hand wrist with two controllers; low in the field of view (0.6 m
   ahead, 0.3 m below eye level, yaw-following) with one. A layout change pushes the toast "One controller: your tools
   are on your belt, look down" (or "Two controllers: your tools are on your left wrist").
8. VR main menu: opens the palette main page (main-menu actions) in front of the player, not tied to the aim. Remove
   any remaining XR path that opens the tool list from empty floor (see job 75 decision 6).
9. VR start card: at session start, a panel in front of the player shows the controllers of the current layout with the
   verb on each button (text list is enough: "Trigger: Use", ...), dismissed by the trigger. Regenerated on a layout
   change.
10. The hint strip in VR shows inside the existing XR focus label (`xrObjectTooltipMesh.ts`) using the XR glyphs.

## Steps

1. Baseline.
2. Layout detection and per-layout button mapping in `xrControls.ts`, test-first in `tests/render/xrControls*.test.ts`:
   - two controllers: belt-hand trigger → next tool; pointer-hand trigger → use; left-handed swaps;
   - one left / one right: trigger → use; stick press centered → next tool; stick press while pushed → nothing; upper
     face held 1000 ms → main menu, tapped → help;
   - removing one of two sources switches the layout.
3. Glyph tables per layout, `tests/ui/inputIntents.test.ts`.
4. Shell wiring of the new request flags (next tool cycles the belt as the wheel does on desktop).
5. Belt strap rendering for both anchors; toasts placement; main menu; start card; hint in the focus label.
6. Finish as the README says.

## Tests and checks

- Unit tests above.
- No headset here. Under `### Uncertain`, list for the maintainer: the button layout with two controllers, each single
  controller, left-handed mode, the waist belt when seated, and readability of the strap. Check that a desktop session
  is unchanged (CDP smoke).

## Do not

- Change desktop input.
- Add teleport locomotion or hand tracking.

## Done when

The XR reader produces the verbs of both layouts (tested), the belt is drawn and usable in both anchors, the main menu
and the start card exist, checks pass, commit on `dev`, report appended with the headset checklist.
