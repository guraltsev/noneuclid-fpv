/**
 * Shared panel dimensions for the in-scene palette, used by both the canvas rendering and the pointer clamping.
 * The panel is authored in pixels (a 980x760 canvas) and converted to meters through scenePalettePanelPixelSize, so one pixel is 1.44 mm on the panel.
 * Local panel coordinates are meters with origin at the panel center, x right and y up in the panel's own frame, before the placement transform is applied.
 */
/**
 * Meters of panel surface covered by one canvas pixel.
 */
export const scenePalettePanelPixelSize = 0.00144;
/**
 * Width of the palette canvas in pixels.
 */
export const scenePalettePanelWidthPixels = 980;
/**
 * Height of the palette canvas in pixels.
 */
export const scenePalettePanelHeightPixels = 760;
/**
 * Corner radius of the rounded palette panel in pixels.
 */
export const scenePalettePanelBorderRadiusPixels = 28;

/**
 * Physical panel width in meters (pixel width times pixel size).
 */
export const scenePalettePanelWidthMeters = scenePalettePanelWidthPixels * scenePalettePanelPixelSize;
/**
 * Physical panel height in meters (pixel height times pixel size).
 */
export const scenePalettePanelHeightMeters = scenePalettePanelHeightPixels * scenePalettePanelPixelSize;
/**
 * Physical corner radius of the panel in meters.
 */
export const scenePalettePanelBorderRadiusMeters = scenePalettePanelBorderRadiusPixels * scenePalettePanelPixelSize;

const scenePalettePanelHalfWidthMeters = scenePalettePanelWidthMeters * 0.5;
const scenePalettePanelHalfHeightMeters = scenePalettePanelHeightMeters * 0.5;
const scenePaletteCornerCenterX = scenePalettePanelHalfWidthMeters - scenePalettePanelBorderRadiusMeters;
const scenePaletteCornerCenterY = scenePalettePanelHalfHeightMeters - scenePalettePanelBorderRadiusMeters;

/**
 * Clamps a panel-local point (meters, origin at panel center) to the rounded-rectangle outline of the palette panel.
 * Points inside are returned unchanged; points outside are first clamped to the bounding box, then, if they lie beyond a corner arc, pulled radially onto that arc.
 * Used to keep the desktop cursor on the panel. Pure; never throws, and a zero corner radius degrades to a plain rectangle clamp.
 * @param x Panel-local x in meters, positive right.
 * @param y Panel-local y in meters, positive up.
 */
export function clampScenePaletteLocalPoint(
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  const clampedX = clamp(x, -scenePalettePanelHalfWidthMeters, scenePalettePanelHalfWidthMeters);
  const clampedY = clamp(y, -scenePalettePanelHalfHeightMeters, scenePalettePanelHalfHeightMeters);
  const absoluteX = Math.abs(clampedX);
  const absoluteY = Math.abs(clampedY);

  if (
    absoluteX <= scenePaletteCornerCenterX
    || absoluteY <= scenePaletteCornerCenterY
    || scenePalettePanelBorderRadiusMeters <= 0
  ) {
    return { x: clampedX, y: clampedY };
  }

  const offsetX = absoluteX - scenePaletteCornerCenterX;
  const offsetY = absoluteY - scenePaletteCornerCenterY;
  const offsetLength = Math.hypot(offsetX, offsetY);

  if (offsetLength <= scenePalettePanelBorderRadiusMeters || offsetLength <= 1e-9) {
    return { x: clampedX, y: clampedY };
  }

  const scale = scenePalettePanelBorderRadiusMeters / offsetLength;
  return {
    x: Math.sign(clampedX) * (scenePaletteCornerCenterX + offsetX * scale),
    y: Math.sign(clampedY) * (scenePaletteCornerCenterY + offsetY * scale),
  };
}

// Clamp value into [minimum, maximum].
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
