/**
 * Shared scene colour constants for the Three.js renderer.
 *
 * Colours are packed 0xRRGGBB integers as consumed by `THREE.Color` and `scene.background`.
 * The sky, haze and ground tones are symmetric under rotation about the vertical (design 018 section 2).
 */
/** Sky-blue colour (0x78b9eb) used for ceiling caps and as the legacy flat background tone. */
export const SCENE_BACKGROUND_COLOR = 0x78b9eb;
/** Deep sky blue straight overhead (elevation 70 degrees and above). */
export const SKY_ZENITH_COLOR = 0x2f6fc4;
/** Mid sky blue at 25 degrees of elevation. */
export const SKY_MID_COLOR = 0x6aa8e6;
/** Pale haze at the horizon; also the fog colour, so distant geometry dissolves into the horizon. */
export const SKY_HORIZON_COLOR = 0xd4e6f3;
/** Muted grey-green seen below the horizon and used for the plane under the cells. */
export const GROUND_HAZE_COLOR = 0x8f9c94;
/**
 * Dark earth colour (0x2c3128) of the plane under the cells. It shows through hairline gaps between neighbouring floors, where a light colour would
 * draw bright lines along every edge; far away the fog turns it into the horizon haze.
 */
export const UNDER_FLOOR_COLOR = 0x2c3128;
