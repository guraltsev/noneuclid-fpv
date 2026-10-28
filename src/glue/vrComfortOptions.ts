/**
 * Pure (Three-free) VR comfort settings: the `VrComfortOptions` record and its defaults.
 * Shared by launch-option parsing (glue), the runtime menu state and the Three.js comfort vignette/locomotion code, which re-exports these from render/three/vrComfort so render code is unchanged.
 */

/**
 * Tunable VR comfort and locomotion parameters (all fields required; pass `Partial` to factories).
 */
export interface VrComfortOptions {
  /** Forward/back stick locomotion speed at full deflection, meters per second. */
  readonly moveSpeedMetersPerSecond: number;
  /** Stick magnitude (0..1) at or below which input is ignored. */
  readonly joystickDeadZone: number;
  /** Continuous yaw rate at full horizontal stick deflection, radians per second. */
  readonly turnSpeedRadiansPerSecond: number;
  /** Largest horizontal head displacement accepted in one frame; larger jumps are treated as tracking glitches. */
  readonly maxPhysicalStepMeters: number;
  /** Master switch for the vignette. */
  readonly antiNauseaModeEnabled: boolean;
  /** Fraction (clamped to 0.05..1) of the normal field of view left clear inside the vignette. */
  readonly antiNauseaVisibleFovScale: number;
  /** Angular width, in degrees of full FOV, of the soft edge between clear and fully dark. */
  readonly antiNauseaFadeFovDegrees: number;
  /** Seconds for the vignette to fade fully in or out (minimum 0.001). */
  readonly antiNauseaFadeSeconds: number;
  /** Peak darkness (clamped to 0..1) reached outside the outer cone. */
  readonly antiNauseaMaxOpacity: number;
}

/**
 * Default comfort settings; treat as immutable.
 */
export const defaultVrComfortOptions: VrComfortOptions = {
  moveSpeedMetersPerSecond: 1.5,
  joystickDeadZone: 0.18,
  turnSpeedRadiansPerSecond: 1.35,
  maxPhysicalStepMeters: 0.75,
  antiNauseaModeEnabled: true,
  antiNauseaVisibleFovScale: 0.5,
  antiNauseaFadeFovDegrees: 6,
  antiNauseaFadeSeconds: 0.14,
  antiNauseaMaxOpacity: 0.96,
};
