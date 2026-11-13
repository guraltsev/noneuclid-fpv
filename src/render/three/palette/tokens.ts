/**
 * Color tokens (CSS hex strings) shared by every part of the in-scene palette panel.
 */

/** Panel background. */
export const surfaceColor = "#0f172a";

/** Background of a section or page card on the panel. */
export const sectionColor = "#111827";

/** Outline of the panel, cards and option buttons. */
export const borderColor = "#475569";

/** Background of an enabled action button. */
export const actionColor = "#1d4ed8";

/** Background of a selected tile, option or toggle. */
export const activeColor = "#0f766e";

/** Background of an unselected tile, option or toggle. */
export const inactiveColor = "#374151";

/** Main text and icon color. */
export const textColor = "#f8fafc";

/** Text color of secondary lines. */
export const mutedTextColor = "#e2e8f0";

/** Scrollbar thumb color of the scrolling pages. */
export const scrollbarColor = "#38bdf8";

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

/** Scrollbar border color of the scrolling pages. */
export const scrollbarBorderColor = "#0f172a";
