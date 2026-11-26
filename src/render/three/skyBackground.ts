/**
 * Vertical sky gradient used as `scene.background`.
 *
 * The gradient depends on elevation only, so it has no horizontal direction (design 018 section 2). It is a
 * one-pixel-wide `DataTexture` mapped equirectangularly, so building it needs no canvas or DOM.
 */
import * as THREE from "three";
import { GROUND_HAZE_COLOR, SKY_HORIZON_COLOR, SKY_MID_COLOR, SKY_ZENITH_COLOR } from "./sceneColors";

/** Number of rows (elevation samples) of the sky texture. */
export const skyTextureHeightPixels = 256;
/** Elevation at which the sky reaches SKY_MID_COLOR, degrees. */
export const skyMidElevationDegrees = 25;
/** Elevation from which the sky is SKY_ZENITH_COLOR, degrees. */
export const skyZenithElevationDegrees = 70;
/** Fraction of the span under the horizon, counted up from the horizon, over which the ground haze blends into the horizon colour. */
export const skyGroundBlendFraction = 0.06;

/** An sRGB colour with channels in 0..1. */
export interface SkyRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function unpack(hex: number): SkyRgb {
  return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a: SkyRgb, b: SkyRgb, t: number): SkyRgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * Returns the sky colour (sRGB, 0..1) at an elevation in radians, from -pi/2 (nadir) to pi/2 (zenith).
 *
 * Below the horizon it is the ground haze, blending into the horizon colour over the last `skyGroundBlendFraction`
 * of the way up; at the horizon it is the horizon colour, then it blends to the mid blue at 25 degrees and to the
 * zenith blue at 70 degrees.
 */
export function skyColorAtElevation(elevationRadians: number): SkyRgb {
  const ground = unpack(GROUND_HAZE_COLOR);
  const horizon = unpack(SKY_HORIZON_COLOR);
  if (elevationRadians < 0) {
    const fractionUp = 1 + elevationRadians / (Math.PI / 2);
    return mix(ground, horizon, smoothstep(1 - skyGroundBlendFraction, 1, fractionUp));
  }
  const degrees = (elevationRadians * 180) / Math.PI;
  if (degrees <= skyMidElevationDegrees) {
    return mix(horizon, unpack(SKY_MID_COLOR), smoothstep(0, skyMidElevationDegrees, degrees));
  }
  return mix(
    unpack(SKY_MID_COLOR),
    unpack(SKY_ZENITH_COLOR),
    smoothstep(skyMidElevationDegrees, skyZenithElevationDegrees, degrees),
  );
}

/**
 * Creates the 1 x 256 sky texture. Row 0 is the nadir and the last row the zenith (a `DataTexture` is not flipped,
 * and three.js samples an equirectangular background at v = elevation / pi + 0.5). The caller owns the texture.
 */
export function createSkyBackgroundTexture(): THREE.DataTexture {
  const data = new Uint8Array(skyTextureHeightPixels * 4);
  for (let row = 0; row < skyTextureHeightPixels; row += 1) {
    const elevation = ((row + 0.5) / skyTextureHeightPixels - 0.5) * Math.PI;
    const color = skyColorAtElevation(elevation);
    data[row * 4] = Math.round(color.r * 255);
    data[row * 4 + 1] = Math.round(color.g * 255);
    data[row * 4 + 2] = Math.round(color.b * 255);
    data[row * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 1, skyTextureHeightPixels, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
