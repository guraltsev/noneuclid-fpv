/**
 * Colour palettes of faces (design 018 section 9.2): every face gets a key hue and a colour scheme, and every colour on it (its landmarks and
 * a tint of its ground) comes from the palette built from them, so a face is recognised by colour from far away.
 *
 * A palette has named roles that the theme generators use: `primary` (the bulk of the large shapes), `secondary` (a second body colour from the
 * scheme), `accent` (small saturated details), `dark` and `light` (the key hue nearly black and nearly white), `glow` (lamps and eyes) and `ground`
 * (multiplied into the floor). Pure; colours are sRGB hex. Layer rule: imports only sibling modules.
 */

/** How the second and accent hues relate to the key hue. */
export type PaletteScheme = "analogous" | "complementary" | "split" | "triadic";

/** Every scheme, in a fixed order. */
export const paletteSchemes: readonly PaletteScheme[] = ["analogous", "complementary", "split", "triadic"];

/** The colours of one face. */
export interface FacePalette {
  /** Key hue in degrees, 0 to 360. */
  readonly hue: number;
  readonly scheme: PaletteScheme;
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly dark: string;
  readonly light: string;
  readonly glow: string;
  readonly ground: string;
}

/** Hue offsets (degrees) of the secondary and accent colours per scheme. */
const schemeOffsets: Record<PaletteScheme, readonly [number, number]> = {
  analogous: [32, -38],
  complementary: [180, 15],
  split: [150, 210],
  triadic: [120, 240],
};

/** sRGB hex of an HSL colour (hue in degrees, saturation and lightness 0 to 1). */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = ((t % 1) + 1) % 1;
    const value = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`;
}

/** Linear-light RGB (0 to 1) of an sRGB hex colour. */
export function hexToLinearRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const decode = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [decode((value >> 16) & 255), decode((value >> 8) & 255), decode(value & 255)];
}

/**
 * Builds a palette from a key hue, a scheme and a random source (for small variations of saturation and lightness, so two faces of close
 * hue still differ). The key colour is saturated and mid-light; dark and light keep a trace of the key hue.
 */
export function buildFacePalette(hue: number, scheme: PaletteScheme, random: () => number = () => 0.5): FacePalette {
  const [secondOffset, accentOffset] = schemeOffsets[scheme];
  const saturation = 0.58 + 0.2 * random();
  const lightness = 0.46 + 0.1 * random();
  return {
    hue,
    scheme,
    primary: hslToHex(hue, saturation, lightness),
    secondary: hslToHex(hue + secondOffset, saturation * 0.85, Math.min(0.72, lightness + 0.12)),
    accent: hslToHex(hue + accentOffset, 0.85, 0.55),
    dark: hslToHex(hue, 0.35, 0.16 + 0.06 * random()),
    light: hslToHex(hue, 0.4, 0.86),
    glow: hslToHex(hue + 30, 1, 0.8),
    ground: hslToHex(hue, 0.45, 0.55),
  };
}

/** How far the ground texture of a face loses its own colour before it takes the palette's `ground` colour (0 to 1). */
export const groundRecolorStrength = 0.8;
/** Largest multiplier a channel of the ground colour may get, so saturated hues keep some brightness and do not clip the tint image. */
export const groundPaletteMaxChannel = 1.9;

/**
 * The multiplier the ground of a face gets from its palette: the `ground` colour normalised to unit luminance (so the texture keeps its
 * brightness), scaled down where a channel would exceed {@link groundPaletteMaxChannel}.
 */
export function groundPaletteMultiplier(palette: Pick<FacePalette, "ground">): readonly [number, number, number] {
  const [r, g, b] = hexToLinearRgb(palette.ground);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1;
  const channels = [r / luminance, g / luminance, b / luminance] as const;
  const scale = Math.min(1, groundPaletteMaxChannel / Math.max(...channels));
  return [channels[0] * scale, channels[1] * scale, channels[2] * scale];
}
