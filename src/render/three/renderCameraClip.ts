/** Camera near clip distance in meters (0.03). */
/**
 * Near and far clip distances shared by the render camera and the aim-ray camera, in meters.
 *
 * The near plane (3 cm) is the closest geometry that is drawn and the plane against which portal apertures are
 * clipped during visibility (see `visiblePortalPaths`); the far plane (250 m) bounds how far into glued copies of
 * cells the camera sees. The far/near ratio sets depth-buffer precision, which matters for the small depth bias used to
 * separate portal-clipped instances from their portal wall (`portalClipMaterial`).
 */

export const renderCameraNearMeters = 0.03;
/** Camera far clip distance in meters (250). */
export const renderCameraFarMeters = 250;

/** Returns far / near (about 8333), a rough measure of depth-buffer precision demand. */
export function renderCameraDepthRangeRatio(): number {
  return renderCameraFarMeters / renderCameraNearMeters;
}
