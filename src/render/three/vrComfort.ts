/**
 * Comfort settings for VR locomotion and the anti-nausea vignette.
 * `VrComfortOptions` is the single tunable set (speeds in meters/radians per second, dead zone, vignette shape/timing) shared by stick locomotion,
 * turn, physical-step limits, and the vignette; partial overrides are always merged over `defaultVrComfortOptions`.
 * The vignette is a camera-attached inverted sphere that darkens everything outside a cone around the view direction while artificial locomotion
 * (stick move or turn) is active, which reduces the visual-vestibular mismatch.
 */
import * as THREE from "three";
import type { RuntimeInputFrame } from "./renderState";
import { defaultVrComfortOptions, type VrComfortOptions } from "../../glue/vrComfortOptions";

export { defaultVrComfortOptions, type VrComfortOptions };

/**
 * Handle for the vignette mesh created by `createVrComfortVignette`.
 */
export interface VrComfortVignette {
  /** Inverted sphere (radius 0.5) parented to the camera; hidden while fully transparent. */
  readonly root: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** Merges new comfort options over the current ones; takes effect at the next `update`. */
  setOptions(options: Partial<VrComfortOptions>): void;
  /**
   * Advances the fade and refreshes the shader cones. `active` should be true while artificial locomotion occurs, `deltaSeconds` is the frame time,
   * and `normalFovDegrees` is the camera's full vertical field of view in degrees. Call every frame.
   */
  update(options: {
    readonly active: boolean;
    readonly deltaSeconds: number;
    readonly normalFovDegrees: number;
  }): void;
  /** Detaches the mesh from the camera and frees its geometry and material; the creator must call it. */
  dispose(): void;
}

/**
 * Cone angles describing the vignette's clear and fade regions.
 */
export interface ComfortVignetteAngles {
  /** Half-angle in radians inside which nothing is darkened. */
  readonly innerConeRadians: number;
  /** Half-angle in radians beyond which the vignette is fully dark; never less than the inner angle nor more than half the full FOV. */
  readonly outerConeRadians: number;
  /** Full field of view, in degrees, that remains clear. */
  readonly visibleFovDegrees: number;
}

// Clamp ranges for the vignette math; locomotionEpsilon is the threshold for treating input as motion.
const minVisibleFovScale = 0.05;
const maxVisibleFovScale = 1;
const minFovDegrees = 1;
const maxFovDegrees = 179;
const locomotionEpsilon = 1e-5;

/**
 * Creates the vignette mesh and adds it as a child of `camera` (so it follows the view); initial state is invisible.
 * The cones are measured from the camera's -z (forward) axis. The renderOrder is high, depth test is off, so it draws over the scene.
 * Lifecycle: the caller must call `dispose()` on the returned handle.
 */
export function createVrComfortVignette(
  camera: THREE.Camera,
  options: Partial<VrComfortOptions> = {},
): VrComfortVignette {
  let comfort = { ...defaultVrComfortOptions, ...options };
  let opacity = 0;
  const uniforms = {
    uInnerConeCos: { value: 1 },
    uOuterConeCos: { value: 1 },
    uOpacity: { value: 0 },
  };
  const geometry = new THREE.SphereGeometry(0.5, 48, 24);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vLocalPosition;

      void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vLocalPosition;
      uniform float uInnerConeCos;
      uniform float uOuterConeCos;
      uniform float uOpacity;

      void main() {
        vec3 direction = normalize(vLocalPosition);
        float cosAngle = dot(direction, vec3(0.0, 0.0, -1.0));
        float vignette = 1.0 - smoothstep(uOuterConeCos, uInnerConeCos, cosAngle);
        gl_FragColor = vec4(0.0, 0.0, 0.0, vignette * uOpacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const root = new THREE.Mesh(geometry, material);
  root.name = "vr-comfort-anti-nausea-vignette";
  root.frustumCulled = false;
  root.renderOrder = 2000;
  root.visible = false;
  camera.add(root);

  return {
    root,
    setOptions(nextOptions) {
      comfort = { ...comfort, ...nextOptions };
    },
    update(updateOptions) {
      // Fade toward 1 or 0, then hide the mesh when effectively transparent to skip drawing it.
      const targetActive = updateOptions.active && comfort.antiNauseaModeEnabled;
      opacity = advanceComfortVignetteOpacity(opacity, targetActive, updateOptions.deltaSeconds, comfort);
      uniforms.uOpacity.value = opacity * clamp01(comfort.antiNauseaMaxOpacity);
      root.visible = uniforms.uOpacity.value > 0.001;

      if (!root.visible) {
        return;
      }

      const angles = resolveComfortVignetteAngles(updateOptions.normalFovDegrees, comfort);
      uniforms.uInnerConeCos.value = Math.cos(angles.innerConeRadians);
      uniforms.uOuterConeCos.value = Math.cos(angles.outerConeRadians);
    },
    dispose() {
      root.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Computes inner/outer cone half-angles from the full vertical FOV in degrees (clamped to 1..179) and the options.
 * Inner = half of FOV times visible-scale; outer = inner plus the fade width, capped at half the FOV.
 */
export function resolveComfortVignetteAngles(
  normalFovDegrees: number,
  options: Partial<VrComfortOptions> = {},
): ComfortVignetteAngles {
  const comfort = { ...defaultVrComfortOptions, ...options };
  const normalFov = clampNumber(normalFovDegrees, minFovDegrees, maxFovDegrees);
  const visibleScale = clampNumber(
    comfort.antiNauseaVisibleFovScale,
    minVisibleFovScale,
    maxVisibleFovScale,
  );
  const visibleFovDegrees = normalFov * visibleScale;
  const innerConeRadians = THREE.MathUtils.degToRad(visibleFovDegrees * 0.5);
  const maxConeRadians = THREE.MathUtils.degToRad(normalFov * 0.5);
  const fadeRadians = THREE.MathUtils.degToRad(Math.max(0, comfort.antiNauseaFadeFovDegrees));
  const outerConeRadians = Math.min(maxConeRadians, innerConeRadians + fadeRadians);

  return {
    innerConeRadians,
    outerConeRadians: Math.max(innerConeRadians, outerConeRadians),
    visibleFovDegrees,
  };
}

/**
 * True when the frame's local displacement (meters) or yaw delta (radians) exceeds a small epsilon, i.e. the player is moved or turned artificially.
 * Physical head motion is not part of such a frame, so it does not trigger comfort effects.
 */
export function isArtificialLocomotionActive(
  frame: Pick<RuntimeInputFrame, "localDisplacement" | "yawDeltaRadians">,
): boolean {
  return Math.hypot(frame.localDisplacement.x, frame.localDisplacement.y, frame.localDisplacement.z) > locomotionEpsilon ||
    Math.abs(frame.yawDeltaRadians) > locomotionEpsilon;
}

/**
 * Moves `currentOpacity` toward 1 (if `active`) or 0 at a rate of one full range per `antiNauseaFadeSeconds`; negative `deltaSeconds` is treated as 0. Returns a value in [0, 1] (given an input in range).
 */
export function advanceComfortVignetteOpacity(
  currentOpacity: number,
  active: boolean,
  deltaSeconds: number,
  options: Partial<VrComfortOptions> = {},
): number {
  const comfort = { ...defaultVrComfortOptions, ...options };
  const fadeSeconds = Math.max(0.001, comfort.antiNauseaFadeSeconds);
  const step = Math.max(0, deltaSeconds) / fadeSeconds;
  const target = active ? 1 : 0;

  if (currentOpacity < target) {
    return Math.min(target, currentOpacity + step);
  }

  return Math.max(target, currentOpacity - step);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}
