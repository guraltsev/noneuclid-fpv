/**
 * Vertical sky gradient used as `scene.background`.
 *
 * The gradient depends on elevation only, so it has no horizontal direction (design 018 section 2). It is a
 * one-pixel-wide `DataTexture` mapped equirectangularly, so building it needs no canvas or DOM. It is a dusk: glowing gold at the horizon,
 * green and teal above, deep teal-blue overhead and a pale moon exactly at the zenith (design 018 section 8.2).
 */
import * as THREE from "three";
import {
  GROUND_HAZE_COLOR,
  SKY_GREEN_COLOR,
  SKY_HORIZON_COLOR,
  SKY_LOW_GOLD_COLOR,
  SKY_MOON_COLOR,
  SKY_TEAL_COLOR,
  SKY_ZENITH_COLOR,
} from "./sceneColors";

/** Number of rows (elevation samples) of the sky texture; enough for a clean moon edge (0.18 degrees per row). */
export const skyTextureHeightPixels = 1024;
/** Elevation of the low gold band, degrees. */
export const skyLowGoldElevationDegrees = 6;
/** Elevation at which the sky is green, degrees. */
export const skyGreenElevationDegrees = 20;
/** Elevation at which the sky is teal, degrees. */
export const skyTealElevationDegrees = 45;
/** Elevation from which the sky is deep teal-blue, degrees. */
export const skyZenithElevationDegrees = 70;
/** Fraction of the span under the horizon, counted up from the horizon, over which the ground haze blends into the horizon colour. */
export const skyGroundBlendFraction = 0.06;
/** Angular radius of the moon disc around the zenith, degrees. */
export const skyMoonRadiusDegrees = 5;
/** Width of the moon's soft edge, degrees (centred on the radius). */
export const skyMoonEdgeDegrees = 1;
/** Angular radius out to which the moon's faint halo reaches, degrees. */
export const skyMoonHaloRadiusDegrees = 12;
/** Share of the moon colour in the halo right at the disc's edge. */
export const skyMoonHaloStrength = 0.3;

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

// The gradient above the horizon: colour stops by elevation, smoothly blended.
const gradientStops: readonly (readonly [number, number])[] = [
  [0, SKY_HORIZON_COLOR],
  [skyLowGoldElevationDegrees, SKY_LOW_GOLD_COLOR],
  [skyGreenElevationDegrees, SKY_GREEN_COLOR],
  [skyTealElevationDegrees, SKY_TEAL_COLOR],
  [skyZenithElevationDegrees, SKY_ZENITH_COLOR],
];

/**
 * Returns the sky colour (sRGB, 0..1) at an elevation in radians, from -pi/2 (nadir) to pi/2 (zenith).
 *
 * Below the horizon it is the dark warm ground haze, blending into the horizon gold over the last `skyGroundBlendFraction` of the way up.
 * Above it the colour runs through the stops gold (0 degrees), pale gold (6), green (20), teal (45) and deep teal-blue (70 and up). The
 * moon sits exactly at the zenith: a disc of `skyMoonRadiusDegrees` with a `skyMoonEdgeDegrees` soft edge and a faint halo out to
 * `skyMoonHaloRadiusDegrees`. The result depends on elevation only.
 */
export function skyColorAtElevation(elevationRadians: number): SkyRgb {
  const horizon = unpack(SKY_HORIZON_COLOR);
  if (elevationRadians < 0) {
    const fractionUp = 1 + elevationRadians / (Math.PI / 2);
    return mix(unpack(GROUND_HAZE_COLOR), horizon, smoothstep(1 - skyGroundBlendFraction, 1, fractionUp));
  }
  const degrees = (elevationRadians * 180) / Math.PI;
  let color = unpack(gradientStops[gradientStops.length - 1][1]);
  for (let index = 1; index < gradientStops.length; index += 1) {
    const [upperDegrees, upperColor] = gradientStops[index];
    if (degrees <= upperDegrees) {
      const [lowerDegrees, lowerColor] = gradientStops[index - 1];
      color = mix(unpack(lowerColor), unpack(upperColor), smoothstep(lowerDegrees, upperDegrees, degrees));
      break;
    }
  }
  const fromZenith = 90 - degrees;
  const moon = unpack(SKY_MOON_COLOR);
  const halo = skyMoonHaloStrength * (1 - smoothstep(skyMoonRadiusDegrees, skyMoonHaloRadiusDegrees, fromZenith)) ** 2;
  const disc = 1 - smoothstep(skyMoonRadiusDegrees - skyMoonEdgeDegrees / 2, skyMoonRadiusDegrees + skyMoonEdgeDegrees / 2, fromZenith);
  return mix(mix(color, moon, halo), moon, disc);
}

/**
 * Creates the 1 x 1024 sky texture. Row 0 is the nadir and the last row the zenith (a `DataTexture` is not flipped,
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
