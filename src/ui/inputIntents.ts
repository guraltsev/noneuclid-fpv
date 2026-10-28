/**
 * Maps abstract input intents (move, primary action, context menu, help, ...) to the label and optional icon that show the player which physical control performs them in desktop or XR mode.
 * This indirection lets menus, help lenses and focus messages talk about intents instead of keys or buttons. The tables are constants; icon URLs are resolved through publicAssetUrl so they respect the deployment base path.
 */
import { publicAssetUrl } from "../glue/assetUrls";

/** Input device family a hint is written for: keyboard and mouse ("desktop") or VR controllers ("xr"). */
export type InputMode = "desktop" | "xr";

/** Abstract user action that is bound to a different physical control per input mode. */
export type InputIntent =
  | "move"
  | "primary"
  | "context-menu"
  | "keyboard-context-fallback"
  | "help"
  | "next-focus-target"
  | "cancel"
  | "reset";

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
  move: {
    label: "Arrow keys",
    iconSrc: publicAssetUrl("icons/arrowkeys.svg"),
  },
  primary: {
    label: "Left click",
    iconSrc: publicAssetUrl("icons/mouse-button-left.svg"),
  },
  "context-menu": {
    label: "Right click",
    iconSrc: publicAssetUrl("icons/mouse-button-right.svg"),
  },
  "keyboard-context-fallback": {
    label: "F",
    iconSrc: publicAssetUrl("icons/f-alphabet.svg"),
  },
  help: {
    label: "H",
    iconSrc: publicAssetUrl("icons/h-alphabet.svg"),
  },
  "next-focus-target": {
    label: "Tab",
  },
  cancel: {
    label: "Esc",
  },
  reset: {
    label: "R",
  },
};

const xrHints: Readonly<Record<InputIntent, Omit<InputHintGlyph, "intent" | "mode">>> = {
  move: {
    label: "Left stick",
  },
  primary: {
    label: "Trigger",
  },
  "context-menu": {
    label: "Side trigger",
  },
  "keyboard-context-fallback": {
    label: "Context fallback",
  },
  help: {
    label: "B",
    iconSrc: publicAssetUrl("icons/b-alphabet.svg"),
  },
  "next-focus-target": {
    label: "Y",
    iconSrc: publicAssetUrl("icons/y-alphabet.svg"),
  },
  cancel: {
    label: "Side trigger",
  },
  reset: {
    label: "Stick press",
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
