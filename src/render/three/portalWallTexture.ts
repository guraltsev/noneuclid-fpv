/**
 * Material factory for the debug portal wall: a repeating checkerboard on a double-sided standard material.
 *
 * The wall map is a generated checkerboard (no image file is loaded). `preloadWorldAssets` registers it under
 * `PORTAL_WALL_TEXTURE_KEY`; a configured (clone with repeat and wrap settings) texture is requested from
 * `PreparedWorldAssets` so identical settings share one texture object.
 */

import * as THREE from "three";
import type { PreparedWorldAssets } from "./preloadWorldAssets";

/** Asset-lookup key of the generated portal wall texture; no file is downloaded for it. */
export const PORTAL_WALL_TEXTURE_KEY = "generated/portal-wall-checker";

/** Width and height in pixels of the generated portal wall texture. */
export const PORTAL_WALL_TEXTURE_SIZE = 64;

const CHECKER_CELL_PIXELS = 8;
const LIGHT_RGB = [0xe6, 0xe6, 0xfa] as const; // lavender
const DARK_RGB = [0x6a, 0x5a, 0xcd] as const; // slate blue

/**
 * Creates the 64 x 64 sRGB checkerboard used as the portal wall map (8-pixel squares, lavender at pixel 0,0).
 * The caller owns the texture and must dispose it; `preloadWorldAssets` does this for the app.
 */
export function createPortalWallDataTexture(): THREE.DataTexture {
  const size = PORTAL_WALL_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = (Math.floor(x / CHECKER_CELL_PIXELS) + Math.floor(y / CHECKER_CELL_PIXELS)) % 2 === 1;
      const rgb = dark ? DARK_RGB : LIGHT_RGB;
      const index = (y * size + x) * 4;
      data[index] = rgb[0];
      data[index + 1] = rgb[1];
      data[index + 2] = rgb[2];
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "portal-wall-checker";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Creates the portal wall material with the texture repeated `repeatX` x `repeatY` times; throws if the texture was not preloaded. */
export function createPortalWallMaterial(
  repeatX: number,
  repeatY: number,
  assets: PreparedWorldAssets,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  material.userData.textureUrl = PORTAL_WALL_TEXTURE_KEY;

  const preparedTexture = assets.getTexture(PORTAL_WALL_TEXTURE_KEY);
  if (!preparedTexture) {
    throw new Error(`Portal wall texture was not preloaded: ${PORTAL_WALL_TEXTURE_KEY}`);
  }

  material.map = configurePortalWallTexture(assets, repeatX, repeatY);
  material.needsUpdate = true;
  return material;
}

function configurePortalWallTexture(
  assets: PreparedWorldAssets,
  repeatX: number,
  repeatY: number,
): THREE.Texture {
  const texture = assets.getConfiguredTexture({
    assetPath: PORTAL_WALL_TEXTURE_KEY,
    colorSpace: THREE.SRGBColorSpace,
    repeatX,
    repeatY,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    name: "portal-wall-texture",
    userData: {
      textureUrl: PORTAL_WALL_TEXTURE_KEY,
      repeatX,
      repeatY,
    },
  });

  if (!texture) {
    throw new Error(`Portal wall texture was not preloaded: ${PORTAL_WALL_TEXTURE_KEY}`);
  }

  return texture;
}
