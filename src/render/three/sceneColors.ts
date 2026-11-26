/**
 * Shared scene colour constants for the Three.js renderer.
 *
 * Colours are packed 0xRRGGBB integers as consumed by `THREE.Color` and `scene.background`.
 * The sky, haze and ground tones are symmetric under rotation about the vertical (design 018 section 2).
 */
/** Sky-blue colour (0x78b9eb) used for ceiling caps and as the legacy flat background tone. */
export const SCENE_BACKGROUND_COLOR = 0x78b9eb;
/** Deep teal-blue overhead (elevation 70 degrees and above, outside the moon and its halo). */
export const SKY_ZENITH_COLOR = 0x0f3f52;
/** Teal at 45 degrees of elevation. */
export const SKY_TEAL_COLOR = 0x2f7f84;
/** Green at 20 degrees of elevation. */
export const SKY_GREEN_COLOR = 0x8fbf9a;
/** Pale gold at 6 degrees of elevation, just above the glowing horizon. */
export const SKY_LOW_GOLD_COLOR = 0xe9c98a;
/** Glowing gold at the horizon (design 018 section 8.2). */
export const SKY_HORIZON_COLOR = 0xf3d489;
/** Pale moon disc and halo, exactly at the zenith (a disc there has no horizontal direction). */
export const SKY_MOON_COLOR = 0xf6f1dc;
/** Fog colour: the horizon gold, slightly desaturated, so distant geometry dissolves into the horizon. */
export const SCENE_FOG_COLOR = 0xe8cf95;
/** Sky colour of the hemisphere light, a touch warmer than white. */
export const HEMISPHERE_SKY_COLOR = 0xfff0d6;
/** Dark warm haze seen below the horizon. */
export const GROUND_HAZE_COLOR = 0x4a3b2d;
/**
 * Dark earth colour (0x2c3128) of the plane under the cells. It shows through hairline gaps between neighbouring floors, where a light colour would
 * draw bright lines along every edge; far away the fog turns it into the horizon haze.
 */
export const UNDER_FLOOR_COLOR = 0x2c3128;
