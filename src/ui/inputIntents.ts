/**
 * Maps abstract input intents (move, primary action, context menu, help, ...) to the label and optional icon that show the player which physical control performs them in desktop or XR mode.
 * This indirection lets menus, help lenses and focus messages talk about intents instead of keys or buttons. The tables are constants; icon URLs are resolved through publicAssetUrl so they respect the deployment base path.
 */
import type { TutorialInputIntent } from "../cell-complex/specs";
import { publicAssetUrl } from "../glue/assetUrls";

/** Input device family a hint is written for: keyboard and mouse ("desktop") or VR controllers ("xr"). */
export type InputMode = "desktop" | "xr";

/** Abstract user action that is bound to a different physical control per input mode; the same list that tutorial pages name their controls by. */
export type InputIntent = TutorialInputIntent;

/** Display data for one intent in one mode. */
export interface InputHintGlyph {
  readonly intent: InputIntent;
  readonly mode: InputMode;
  /** Short text name of the control, e.g. "Left click" or "Trigger". */
  readonly label: string;
  /** URL of an SVG icon for the control; absent when only the label should be shown. */
  readonly iconSrc?: string;
}

const desktopHints: Readonly<Record<InputIntent, Omit<InputHintGlyph, "intent" | "mode">>> = {
  look: {
    label: "Mouse",
    iconSrc: publicAssetUrl("icons/mouse-move.svg"),
  },
  move: {
    label: "Arrow keys",
    iconSrc: publicAssetUrl("icons/arrowkeys.svg"),
  },
  primary: {
    label: "Left click",
    iconSrc: publicAssetUrl("icons/mouse-button-left.svg"),
  },
  "context-menu": {
    label: "Right click / F",
    iconSrc: publicAssetUrl("icons/mouse-button-right.svg"),
  },
  "switch-tool": {
    label: "1–5 · wheel",
  },
  "main-menu": {
    label: "Esc",
    iconSrc: publicAssetUrl("icons/esc-key.svg"),
  },
  "keyboard-context-fallback": {
    label: "F",
    iconSrc: publicAssetUrl("icons/f-alphabet.svg"),
  },
  help: {
    label: "H",
    iconSrc: publicAssetUrl("icons/h-alphabet.svg"),
  },
  carry: {
    label: "G",
    iconSrc: publicAssetUrl("icons/g-alphabet.svg"),
  },
  "next-focus-target": {
    label: "Tab",
  },
  cancel: {
    label: "Esc",
    iconSrc: publicAssetUrl("icons/esc-key.svg"),
  },
  reset: {
    label: "Hold R",
  },
  hand: {
    label: "0",
  },
  undo: {
    label: "U",
  },
};

const xrHints: Readonly<Record<InputIntent, Omit<InputHintGlyph, "intent" | "mode">>> = {
  look: {
    label: "Head",
    iconSrc: publicAssetUrl("icons/xr-headset.svg"),
  },
  move: {
    label: "Left stick",
    iconSrc: publicAssetUrl("icons/xr-thumbstick.svg"),
  },
  primary: {
    label: "Trigger",
    iconSrc: publicAssetUrl("icons/xr-trigger.svg"),
  },
  "context-menu": {
    label: "Side trigger",
    iconSrc: publicAssetUrl("icons/xr-grip.svg"),
  },
  "keyboard-context-fallback": {
    label: "Context fallback",
  },
  // The belt-hand trigger and the main-menu button arrive with job 77.
  "switch-tool": {
    label: "Not available yet",
  },
  "main-menu": {
    label: "Not available yet",
  },
  help: {
    label: "B",
    iconSrc: publicAssetUrl("icons/b-alphabet.svg"),
  },
  carry: {
    label: "A / X",
    iconSrc: publicAssetUrl("icons/a-alphabet.svg"),
  },
  // Cycling between overlapping targets has no controller binding yet.
  "next-focus-target": {
    label: "Not available in VR",
  },
  cancel: {
    label: "Side trigger",
    iconSrc: publicAssetUrl("icons/xr-grip.svg"),
  },
  // The stick press no longer resets (job 73); starting over is a menu entry, which the VR main menu adds (job 77).
  reset: {
    label: "Main menu",
  },
  // The belt arrives with the VR hand roles (job 77).
  hand: {
    label: "Not available yet",
  },
  undo: {
    label: "Not available yet",
  },
};

/** Returns the label and optional icon for an intent in a mode; total over all intents. */
export function getInputHintGlyph(mode: InputMode, intent: InputIntent): InputHintGlyph {
  const hint = mode === "desktop" ? desktopHints[intent] : xrHints[intent];
  return {
    intent,
    mode,
    ...hint,
  };
}
