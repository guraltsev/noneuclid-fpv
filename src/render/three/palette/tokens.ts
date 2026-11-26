/**
 * Design tokens of the in-scene palette panel: colors (CSS hex strings), the spacing and size scale, and the text size steps.
 * Every page and widget takes its look from here, so the panel reads as one piece: one surface, one card style, one row height, one button height.
 */

/** Panel background. */
export const surfaceColor = "#0b1220";

/** Background of a card (a group of rows) and of the settings sidebar. */
export const sectionColor = "#131c2e";

/** Background of a row or tile inside a card, a step above the card. */
export const raisedColor = "#1b2538";

/** Hover tint of a neutral control. */
export const raisedHoverColor = "#26324a";

/** Outline of the panel and of cards; also the hairline between rows and under the header. */
export const borderColor = "#24304a";

/** Hairline between the rows of a card. */
export const dividerColor = "#202b40";

/** Background of a primary action button. */
export const actionColor = "#2563eb";

/** Hover tint of a primary action button. */
export const actionHoverColor = "#3b82f6";

/** Background of a selected tile, option, segment or a switch that is on. */
export const activeColor = "#0d9488";

/** Hover tint of a selected control. */
export const activeHoverColor = "#14b8a6";

/** Background of an unselected option, segment or a switch that is off. */
export const inactiveColor = "#334155";

/** Background of a disabled control. */
export const disabledColor = "#1e293b";

/** Background of a destructive action (Delete, Start over) and of a pending confirmation. */
export const dangerColor = "#b91c1c";

/** Hover tint of a destructive action. */
export const dangerHoverColor = "#dc2626";

/** Background of an action that a tool contributed to an object's page. */
export const contributedActionColor = "#b45309";

/** Main text and icon color. */
export const textColor = "#f8fafc";

/** Text color of secondary lines: descriptions, section headings, counters. */
export const mutedTextColor = "#94a3b8";

/** Text color of the small uppercase section headings. */
export const headingTextColor = "#7dd3fc";

/** Background of a key or button name chip (light, so it reads as a keycap). */
export const chipColor = "#e2e8f0";

/** Text color of a key or button name chip. */
export const chipTextColor = "#0f172a";

/** Scrollbar thumb color of the scrolling pages. */
export const scrollbarColor = "#64748b";

/** Scrollbar border color of the scrolling pages. */
export const scrollbarBorderColor = "#0b1220";

/** Width of a scrollbar, in panel pixels: wide enough to grab with the menu cursor. */
export const scrollbarWidth = 14;

/** Minimum height of a settings row. */
export const rowHeight = 56;

/** Height of a standard button. */
export const buttonHeight = 44;

/** Corner radius of buttons and rows. */
export const controlRadius = 10;

/** Corner radius of cards. */
export const cardRadius = 16;

/** Padding of the panel, and the gap between the header and the body. */
export const panelPadding = 24;

/** The text size steps of the display setting and the factor each gives the font sizes of the panel. */
export const paletteTextScales = { small: 0.85, medium: 1, large: 1.25 } as const;

let paletteTextScale: number = paletteTextScales.medium;

/** Sets the factor that `fontPx` applies; the panel is rebuilt afterwards (a new palette definition does that). */
export function setPaletteTextScale(scale: number): void {
  paletteTextScale = Number.isFinite(scale) && scale > 0 ? scale : paletteTextScales.medium;
}

/** A font size of the panel, in pixels, at the chosen text size: the design size times the scale, rounded. */
export function fontPx(designSize: number): number {
  return Math.round(designSize * paletteTextScale);
}

/** The type scale of the panel, in design pixels (pass through `fontPx`). */
export const typeScale = {
  /** Page title in the header. */
  title: 28,
  /** Heading inside a page (a help card's title). */
  heading: 26,
  /** Row labels, list items, body text. */
  body: 19,
  /** Button labels. */
  button: 17,
  /** Descriptions under a row label, counters. */
  caption: 15,
  /** Small uppercase section headings. */
  overline: 14,
} as const;

// The panel's font (uikit's Inter) has ASCII and a few Latin-1 letters only; these characters of the vocabulary would draw as empty boxes.
const panelGlyphReplacements: Readonly<Record<string, string>> = {
  "\u00b7": "|", // middle dot: "Pick up | G", "Beam 1 | 2.0 m | free"
  "\u2022": "|", // bullet
  "\u2013": "-", // en dash: "L1-L3"
  "\u2014": "-", // em dash
  "\u2212": "-", // minus sign
  "\u2026": "...", // ellipsis
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": "\"",
  "\u201d": "\"",
  "\u00d7": "x", // multiplication sign
  "\u2192": "->", // right arrow
  "\u00a0": " ", // no-break space
};
const panelGlyphPattern = new RegExp(`[${Object.keys(panelGlyphReplacements).join("")}]`, "g");

/** Text the panel's font can draw: the vocabulary's typographic punctuation replaced by its ASCII look-alike. */
export function toPanelText(text: string): string {
  return text.replace(panelGlyphPattern, (character) => panelGlyphReplacements[character] ?? character);
}
