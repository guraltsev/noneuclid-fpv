/**
 * The VR controller layout and the two hand options that choose it (design 017 sections 7.2 and 7.3).
 * Pure data: the layout name is read by the XR input reader, the belt, the toasts and the glyph tables; the options live in the menu state like the comfort options.
 */

/**
 * How many VR controllers the player holds: two, or one in the left or the right hand (a controller with handedness "none" counts as the right one).
 * With two controllers the glyphs assume the default hands (pointer hand right, belt hand left); "Left-handed" swaps them.
 */
export type XrLayout = "two-controllers" | "one-left" | "one-right";

/** The "Controllers" switches of Settings. */
export interface XrHandOptions {
  /** Use only the pointer hand's controller, even when two are present. */
  readonly useOneController: boolean;
  /** Pointer hand left, belt hand right. */
  readonly leftHanded: boolean;
}

/** Both switches off: two controllers, pointer hand right, belt hand left. */
export const defaultXrHandOptions: XrHandOptions = { useOneController: false, leftHanded: false };
