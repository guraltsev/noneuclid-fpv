/**
 * Lighting rig for the stylized (non-physical) look of the scene.
 *
 * Uses one hemisphere light plus one ambient light, with no shadows and no directional component.
 * Since neither light has a position-dependent effect on shading, the rig is portal-invariant:
 * the same lights illuminate every cell and nothing needs re-posing when the camera crosses a portal.
 * Lights are added directly to the scene root (Three.js frame, y up).
 */
import * as THREE from "three";
import { HEMISPHERE_SKY_COLOR } from "./sceneColors";

/** Handle to the lights created by {@link createStylizedSceneLighting}. */
export interface StylizedSceneLighting {
  readonly hemisphereLight: THREE.HemisphereLight;
  readonly ambientLight: THREE.AmbientLight;
  /** Both lights as a tuple, for iteration during disposal. */
  readonly lights: readonly [THREE.HemisphereLight, THREE.AmbientLight];
}

/**
 * Creates the hemisphere + ambient lights and adds them to `scene`.
 *
 * The caller owns the returned handle and should release it with {@link disposeStylizedSceneLighting}.
 */
export function createStylizedSceneLighting(scene: THREE.Scene): StylizedSceneLighting {
  const hemisphereLight = new THREE.HemisphereLight(HEMISPHERE_SKY_COLOR, 0x55604f, 1.9);
  hemisphereLight.castShadow = false;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
  ambientLight.castShadow = false;

  scene.add(hemisphereLight);
  scene.add(ambientLight);

  return {
    hemisphereLight,
    ambientLight,
    lights: [hemisphereLight, ambientLight],
  };
}

/**
 * Per-frame lighting hook; currently a deliberate no-op because the rig does not depend on the camera.
 *
 * Kept so callers have a stable seam if camera- or portal-dependent lighting is introduced.
 */
export function updateStylizedSceneLighting(
  _lighting: StylizedSceneLighting,
  _camera: THREE.Camera,
): void {
  // The stylized ambient + hemisphere rig is intentionally portal-invariant.
}

/**
 * Detaches the lights from `scene` (or from whatever parent they currently have when `scene` is omitted).
 *
 * Lights hold no GPU resources, so there is nothing else to free. Safe to call more than once.
 */
export function disposeStylizedSceneLighting(
  lighting: StylizedSceneLighting,
  scene?: THREE.Scene,
): void {
  for (const light of lighting.lights) {
    if (scene) {
      scene.remove(light);
    } else {
      light.removeFromParent();
    }
  }
}
