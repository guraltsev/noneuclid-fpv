/**
 * Placement maths of the VR tool belt (design 017 sections 7.3 and 7.4), renderer-free and in the Three.js frame (meters, y up, -z forward): the strap's slot layout, the waist anchor of the one-controller belt, the enlarge-when-looked-at rule of the wrist belt and the low anchor of the one-controller toast panel.
 * Vectors are plain `{ x, y, z }` records so the functions are tested without Three.js; `render/three/xrToolBelt.ts` applies the results to scene objects.
 */
import type { Vec3 } from "../math/vec3";

/** The strap's slot pitch along its long axis, meters at scale 1. */
export const beltSlotPitchMeters = 0.06;
/** The strap's slot height across the long axis, meters at scale 1. */
export const beltSlotHeightMeters = 0.075;
/** Scale of the wrist belt while the head looks at it. */
export const beltEnlargedScale = 1.8;
/** The wrist belt grows when the angle between the head forward vector and the direction to the strap is under this many degrees. */
export const beltEnlargeAngleDegrees = 25;
/** The waist belt hangs this far below the head, meters. */
export const waistBeltDropMeters = 0.55;
/** ... but at least this far above the floor, meters. */
export const waistBeltMinimumHeightMeters = 0.6;
/** The waist belt stands this far in front of the player, along the head yaw, meters. */
export const waistBeltForwardMeters = 0.35;
/** Smoothing factor per call for the waist belt and the low toast panel (the palette uses 0.22). */
export const waistBeltSmoothing = 0.22;
/** How far ahead of the head the low toast panel stands with one controller, meters. */
export const lowToastForwardMeters = 0.6;
/** How far below eye level the low toast panel stands, meters. */
export const lowToastDropMeters = 0.3;

/** Total length of a strap of `slotCount` slots, meters at scale 1. */
export function beltStrapLengthMeters(slotCount: number): number {
  return slotCount * beltSlotPitchMeters;
}

/**
 * The slot under a point on the strap, given in the strap plane coordinates (meters at scale 1; x along the strap from its center, y across it from its center).
 * Returns undefined for a point outside the strap or a strap with no slots.
 */
export function beltSlotAtLocalPoint(localX: number, localY: number, slotCount: number): number | undefined {
  if (slotCount <= 0 || !Number.isFinite(localX) || !Number.isFinite(localY)) return undefined;
  const halfLength = beltStrapLengthMeters(slotCount) / 2;
  if (Math.abs(localX) > halfLength || Math.abs(localY) > beltSlotHeightMeters / 2) return undefined;
  return Math.min(slotCount - 1, Math.floor((localX + halfLength) / beltSlotPitchMeters));
}

/** The center of slot `index` along the strap, meters at scale 1 (x of the strap plane coordinates). */
export function beltSlotCenterX(index: number, slotCount: number): number {
  return (index - (slotCount - 1) / 2) * beltSlotPitchMeters;
}

/** The angle in degrees between `forward` and the direction from `from` to `to`; 180 when the points coincide or `forward` has no length. */
export function angleBetweenForwardAndTargetDegrees(forward: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const targetLength = Math.hypot(dx, dy, dz);
  const forwardLength = Math.hypot(forward.x, forward.y, forward.z);
  if (targetLength < 1e-9 || forwardLength < 1e-9) return 180;
  const cosine = (forward.x * dx + forward.y * dy + forward.z * dz) / (targetLength * forwardLength);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

/** The wrist belt scale: 1.8 while the head looks at the strap (the angle is under 25 degrees), else 1. */
export function wristBeltScale(headForward: Vec3, headPosition: Vec3, strapPosition: Vec3): number {
  return angleBetweenForwardAndTargetDegrees(headForward, headPosition, strapPosition) < beltEnlargeAngleDegrees ? beltEnlargedScale : 1;
}

/** The height of the waist belt: the head height minus 0.55 m, at least 0.6 m above the floor. */
export function waistBeltHeight(headY: number, floorY: number): number {
  return Math.max(headY - waistBeltDropMeters, floorY + waistBeltMinimumHeightMeters);
}

/** The yaw (radians about +y, 0 facing -z) of the horizontal part of a forward vector; `fallback` when the vector is nearly vertical (looking straight down or up). */
export function yawOfForward(forward: Vec3, fallback: number): number {
  if (Math.hypot(forward.x, forward.z) < 1e-3) return fallback;
  return Math.atan2(-forward.x, -forward.z);
}

/** Moves the angle `from` toward `to` by the fraction `factor` of the shortest way around. */
export function lerpAngle(from: number, to: number, factor: number): number {
  const twoPi = Math.PI * 2;
  let difference = (to - from) % twoPi;
  if (difference > Math.PI) difference -= twoPi;
  if (difference < -Math.PI) difference += twoPi;
  return from + difference * factor;
}

/** A pose that follows the head yaw: its center and the yaw. */
export interface YawFollowingPose {
  readonly position: Vec3;
  readonly yawRadians: number;
}

/** The pose `forwardMeters` ahead of the head along its yaw (not its pitch) at height `y`, moved toward from `previous` by `smoothing` per call when there is one. The start card and the toast panel of one controller use it too. */
export function followHeadYaw(
  headPosition: Vec3,
  headForward: Vec3,
  forwardMeters: number,
  y: number,
  previous: YawFollowingPose | undefined,
  smoothing: number | undefined,
): YawFollowingPose {
  const yaw = yawOfForward(headForward, previous?.yawRadians ?? 0);
  const target: YawFollowingPose = {
    position: {
      x: headPosition.x - Math.sin(yaw) * forwardMeters,
      y,
      z: headPosition.z - Math.cos(yaw) * forwardMeters,
    },
    yawRadians: yaw,
  };
  if (previous === undefined) return target;
  const factor = Math.max(0, Math.min(1, smoothing ?? waistBeltSmoothing));
  return {
    position: {
      x: previous.position.x + (target.position.x - previous.position.x) * factor,
      y: previous.position.y + (target.position.y - previous.position.y) * factor,
      z: previous.position.z + (target.position.z - previous.position.z) * factor,
    },
    yawRadians: lerpAngle(previous.yawRadians, target.yawRadians, factor),
  };
}

/**
 * Where the one-controller belt stands: 0.35 m in front of the head along the head yaw (not its pitch), at waist height. With a `previous` pose the result moves toward the target by `smoothing` per call (the yaw along the shortest way).
 * `floorY` is the floor height in the Three.js frame.
 */
export function resolveWaistBeltPose(options: {
  readonly headPosition: Vec3;
  readonly headForward: Vec3;
  readonly floorY: number;
  readonly previous?: YawFollowingPose;
  readonly smoothing?: number;
}): YawFollowingPose {
  return followHeadYaw(options.headPosition, options.headForward, waistBeltForwardMeters, waistBeltHeight(options.headPosition.y, options.floorY), options.previous, options.smoothing);
}

/** The low toast panel with one controller: 0.6 m ahead along the head yaw, 0.3 m below eye level. Smoothed like the waist belt when `previous` is given. */
export function resolveLowToastPose(options: {
  readonly headPosition: Vec3;
  readonly headForward: Vec3;
  readonly previous?: YawFollowingPose;
  readonly smoothing?: number;
}): YawFollowingPose {
  return followHeadYaw(options.headPosition, options.headForward, lowToastForwardMeters, options.headPosition.y - lowToastDropMeters, options.previous, options.smoothing);
}
