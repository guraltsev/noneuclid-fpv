/**
 * Material factory for the debug portal wall: a repeating abstract texture on a double-sided standard material.
 *
 * The texture file must already be loaded through `preloadWorldAssets`; a configured (clone with repeat and wrap
 * settings) texture is requested from `PreparedWorldAssets` so identical settings share one texture object.
 */

import * as THREE from "three";
import { legacyPublicAssetUrl } from "../../glue/assetUrls";
import type { PreparedWorldAssets } from "./preloadWorldAssets";

/** Asset-store path of the portal wall texture. */
export const PORTAL_WALL_TEXTURE_FILE = "_legacy/abstract-fractal-geometric-figure-background-with-texture.jpg";
/** Public URL of the portal wall texture, recorded in material user data for debugging. */
export const PORTAL_WALL_TEXTURE_URL = legacyPublicAssetUrl("abstract-fractal-geometric-figure-background-with-texture.jpg");

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
  material.userData.textureUrl = PORTAL_WALL_TEXTURE_URL;

  const preparedTexture = assets.getTexture(PORTAL_WALL_TEXTURE_FILE);
  if (!preparedTexture) {
    throw new Error(`Portal wall texture was not preloaded: ${PORTAL_WALL_TEXTURE_FILE}`);
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
    assetPath: PORTAL_WALL_TEXTURE_FILE,
    colorSpace: THREE.SRGBColorSpace,
    repeatX,
    repeatY,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    name: "portal-wall-texture",
    userData: {
      textureUrl: PORTAL_WALL_TEXTURE_URL,
      repeatX,
      repeatY,
    },
  });

  if (!texture) {
    throw new Error(`Portal wall texture was not preloaded: ${PORTAL_WALL_TEXTURE_FILE}`);
  }

  return texture;
}
