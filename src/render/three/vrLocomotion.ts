/**
 * Pure functions turning XR thumbstick and head-tracking input into player-local motion requests.
 * Output frames are player-local (x right, y forward, z up); distances in meters, angles in radians, rates scaled by frame `deltaSeconds`.
 * Stick conventions follow WebXR gamepads: pushing up gives negative y, so forward motion negates it; pushing right yields a clockwise (negative yaw) turn.
 * Tunables come from `VrComfortOptions` (see vrComfort); callers combine these results into a `RuntimeInputFrame` (xrControls, xrPlayerRig).
 */
import { vec3, type Vec3 } from "../../math/vec3";
import { defaultVrComfortOptions, type VrComfortOptions } from "./vrComfort";

/**
 * A thumbstick position with each axis in [-1, 1] (x right, y down by gamepad convention).
 */
export interface StickAxes {
  readonly x: number;
  readonly y: number;
}

/**
 * Result of stick locomotion.
 */
export interface VrLocomotionRequest {
  /** Displacement for this frame in the player-local frame, meters. */
  readonly localDisplacement: Vec3;
}

/**
 * Zeroes the stick if its magnitude is within `deadZone`, normalizes it to unit length if it exceeds 1, and otherwise returns it unchanged.
 * No rescaling of the live range is applied. Radial (2D) dead zone, unlike the per-axis checks in the compute functions below.
 */
export function applyJoystickDeadZone(
  axes: StickAxes,
  deadZone: number = defaultVrComfortOptions.joystickDeadZone,
): StickAxes {
  const length = Math.hypot(axes.x, axes.y);

  if (length <= deadZone) {
    return { x: 0, y: 0 };
  }

  if (length <= 1) {
    return axes;
  }

  return {
    x: axes.x / length,
    y: axes.y / length,
  };
}

/**
 * Converts a stick position into forward/back displacement for this frame: `moveSpeedMetersPerSecond * deltaSeconds` scaled by the clamped y axis, with the sign flipped
 * (stick up moves along +y forward). Horizontal stick input never strafes. Returns zero when `axes` is undefined or |y| is within the dead zone (per-axis test).
 */
export function computeJoystickLocomotion(
  axes: StickAxes | undefined,
  deltaSeconds: number,
  options: Partial<VrComfortOptions> = {},
): VrLocomotionRequest {
  if (!axes) {
    return { localDisplacement: vec3(0, 0, 0) };
  }

  const comfort = { ...defaultVrComfortOptions, ...options };

  if (Math.abs(axes.y) <= comfort.joystickDeadZone) {
    return { localDisplacement: vec3(0, 0, 0) };
  }

  const scaledY = Math.max(-1, Math.min(1, axes.y));
  const stepMeters = comfort.moveSpeedMetersPerSecond * deltaSeconds;

  return {
    localDisplacement: vec3(0, -scaledY * stepMeters, 0),
  };
}

/**
 * Returns the yaw change in radians for this frame from the stick x axis (stick right gives negative, i.e. clockwise yaw).
 * Returns 0 for a missing or non-finite axis or when |x| is within the dead zone. Rate is `turnSpeedRadiansPerSecond`; the axis is clamped to [-1, 1].
 */
export function computeContinuousTurn(
  axisX: number | undefined,
  deltaSeconds: number,
  options: Partial<VrComfortOptions> = {},
): number {
  if (axisX === undefined || !Number.isFinite(axisX)) {
    return 0;
  }

  const comfort = { ...defaultVrComfortOptions, ...options };

  if (Math.abs(axisX) <= comfort.joystickDeadZone) {
    return 0;
  }

  return -Math.max(-1, Math.min(1, axisX)) * comfort.turnSpeedRadiansPerSecond * deltaSeconds;
}

/**
 * Computes the horizontal displacement (meters, z ignored) between two head positions in game-world axes.
 * Returns zero when either position is missing (accepting the current one as baseline); a step longer than `maxPhysicalStepMeters`
 * (default from comfort options) is reported as `ignoredTrackingJump` with zero displacement and the previous position kept as the accepted one.
 * `nextAcceptedHeadLocalMeters` is the position the caller should treat as accepted; note that xrPlayerRig#consumePhysicalInput does not use it and instead
 * records acceptance through `acceptPhysicalMove` after collision.
 */
export function computePhysicalRoomScaleDisplacement(request: {
  readonly previousHeadLocalMeters?: Vec3;
  readonly currentHeadLocalMeters?: Vec3;
  readonly maxPhysicalStepMeters?: number;
}): {
  readonly localDisplacement: Vec3;
  readonly nextAcceptedHeadLocalMeters?: Vec3;
  readonly ignoredTrackingJump: boolean;
} {
  if (!request.previousHeadLocalMeters || !request.currentHeadLocalMeters) {
    return {
      localDisplacement: vec3(0, 0, 0),
      nextAcceptedHeadLocalMeters: request.currentHeadLocalMeters,
      ignoredTrackingJump: false,
    };
  }

  const delta = vec3(
    request.currentHeadLocalMeters.x - request.previousHeadLocalMeters.x,
    request.currentHeadLocalMeters.y - request.previousHeadLocalMeters.y,
    0,
  );
  const maxStep = request.maxPhysicalStepMeters ?? defaultVrComfortOptions.maxPhysicalStepMeters;

  if (Math.hypot(delta.x, delta.y) > maxStep) {
    return {
      localDisplacement: vec3(0, 0, 0),
      nextAcceptedHeadLocalMeters: request.previousHeadLocalMeters,
      ignoredTrackingJump: true,
    };
  }

  return {
    localDisplacement: delta,
    nextAcceptedHeadLocalMeters: request.currentHeadLocalMeters,
    ignoredTrackingJump: false,
  };
}
