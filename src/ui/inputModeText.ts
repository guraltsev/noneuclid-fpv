/**
 * Shared text rewriter that turns device-neutral help sentences into desktop or XR wording.
 * Both the tutorial/goal pages (paletteDefinition.ts) and the help lens (helpLensDefinition.ts) author some copy with sentences such as "Move with Arrow keys or the left stick."; this module holds the single list of known sentences and their per-input-mode replacements.
 * Matching is by exact English substring (first occurrence of each sentence), so unknown text passes through unchanged. The module is pure and has no state.
 */
import type { InputMode } from "./inputIntents";

interface InputModeSentenceRewrite {
  readonly neutral: string;
  readonly desktop: string;
  readonly xr: string;
}

const sentenceRewrites: readonly InputModeSentenceRewrite[] = [
  {
    neutral: "Move with Arrow keys or the left stick.",
    desktop: "Move with Arrow keys.",
    xr: "Move with the left stick.",
  },
  {
    neutral: "Use primary action or trigger for the selected action.",
    desktop: "Left click uses the selected/default action.",
    xr: "Trigger uses the selected/default action.",
  },
  {
    neutral: "Use primary action or trigger for the selected/default action.",
    desktop: "Left click uses the selected/default action.",
    xr: "Trigger uses the selected/default action.",
  },
  {
    neutral: "Use context action or side trigger for tools and object menus.",
    desktop: "Right click opens tools and object menus.",
    xr: "Side trigger opens tools and object menus.",
  },
  {
    neutral: "Press H or B while aiming at an object for its help.",
    desktop: "Press H while aiming at an object for its help.",
    xr: "Press B while aiming at an object for its help.",
  },
];

/**
 * Rewrites known device-neutral sentences (matched as exact substrings) into desktop or XR wording; other text passes through unchanged.
 */
export function formatBodyForInputMode(body: string, inputMode: InputMode): string {
  const key = inputMode === "desktop" ? "desktop" : "xr";
  return sentenceRewrites.reduce((text, rewrite) => text.replace(rewrite.neutral, rewrite[key]), body);
}
