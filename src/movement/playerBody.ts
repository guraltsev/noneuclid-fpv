/**
 * Physical dimensions of the player's body used for collision and eye placement.
 * The body is modelled as a vertical cylinder standing on the floor, in meters. The eye height is a separate constant used by the camera, not by collision.
 */
/**
 * Default player collision radius, 0.25 m.
 */
export const DEFAULT_PLAYER_RADIUS_METERS = 0.25;
/**
 * Default player collision height, 1.6 m (floor to top of head).
 */
export const DEFAULT_PLAYER_HEIGHT_METERS = 1.6;
/**
 * Default camera eye height above the player's feet, 1.45 m.
 */
export const DEFAULT_PLAYER_EYE_HEIGHT_METERS = 1.45;

/**
 * Player collision cylinder dimensions in meters.
 */
export interface PlayerBody {
  readonly radiusMeters: number;
  readonly heightMeters: number;
}

/**
 * Returns a body with the default radius and height.
 */
export function createDefaultPlayerBody(): PlayerBody {
  return {
    radiusMeters: DEFAULT_PLAYER_RADIUS_METERS,
    heightMeters: DEFAULT_PLAYER_HEIGHT_METERS,
  };
}
