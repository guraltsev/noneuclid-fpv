/**
 * Placement math for the XR palette: where the panel floats relative to the head and how it faces the viewer.
 * All positions and quaternions are in the Three.js world frame, in meters; the head pose is the XR viewer pose already converted to world space.
 * The panel target is a fixed offset in head-local space (0.12 m below, 0.72 m ahead), smoothed toward over time and optionally frozen.
 * Also provides the auto-close distance check and facing-quaternion helpers reused elsewhere.
 */
import * as THREE from "three";

/**
 * What the palette is anchored to; only "viewer" (the head) is currently supported.
 */
export type VrPaletteAnchorKind = "viewer";

/**
 * A world-space pose sample of the head, in meters.
 */
export interface VrPoseSample {
  readonly position: THREE.Vector3;
  /** Head orientation; when absent the head-local offset is applied unrotated. */
  readonly quaternion?: THREE.Quaternion;
}

/**
 * Inputs for resolveVrPalettePlacement.
 */
export interface ResolveVrPalettePlacementOptions {
  readonly head: VrPoseSample;
  /** Palette position from the previous frame; enables smoothing and freezing. */
  readonly previousPosition?: THREE.Vector3;
  /** Palette orientation from the previous frame; enables smoothing and freezing. */
  readonly previousQuaternion?: THREE.Quaternion;
  /** Per-call interpolation factor in [0, 1] toward the target (clamped); default 0.22. It is per call, not per second, so it is frame-rate dependent. */
  readonly smoothing?: number;
  /** When true and both previous values exist, the previous pose is returned unchanged. */
  readonly freeze?: boolean;
}

/**
 * Resolved palette pose in the Three.js world frame (meters), with the kind of anchor it follows.
 */
export interface VrPalettePlacement {
  readonly anchorKind: VrPaletteAnchorKind;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

/**
 * Default head-to-palette distance in meters beyond which the VR palette should auto-close.
 */
export const VR_PALETTE_AUTO_CLOSE_DISTANCE_METERS = 1;

const upAxis = new THREE.Vector3(0, 1, 0);
const headOffset = new THREE.Vector3(0, -0.12, -0.72);
const lookAtMatrix = new THREE.Matrix4();
const positiveZFacingFlip = new THREE.Quaternion().setFromAxisAngle(upAxis, Math.PI);

/**
 * Computes where the XR palette should sit this frame: a head-relative target, smoothed from the previous pose.
 * The target is the head position plus the offset (0, -0.12, -0.72) m rotated by the head orientation, facing back toward the head via resolveFacingQuaternion.
 * With no previous pose the target is returned directly; with freeze set and a full previous pose, a clone of the previous pose is returned.
 * Never mutates its inputs. Position uses lerp and orientation uses slerp with the same factor.
 */
export function resolveVrPalettePlacement(options: ResolveVrPalettePlacementOptions): VrPalettePlacement {
  const anchorKind: VrPaletteAnchorKind = "viewer";
  const targetPosition = options.head.position.clone().add(applyLocalOffset(headOffset, options.head.quaternion));
  const targetQuaternion = resolveFacingQuaternion(targetPosition, options.head.position);

  if (options.freeze && options.previousPosition && options.previousQuaternion) {
    return {
      anchorKind,
      position: options.previousPosition.clone(),
      quaternion: options.previousQuaternion.clone(),
    };
  }

  const smoothing = THREE.MathUtils.clamp(options.smoothing ?? 0.22, 0, 1);
  const position = options.previousPosition
    ? options.previousPosition.clone().lerp(targetPosition, smoothing)
    : targetPosition;
  const quaternion = options.previousQuaternion
    ? options.previousQuaternion.clone().slerp(targetQuaternion, smoothing)
    : targetQuaternion;

  return {
    anchorKind,
    position,
    quaternion,
  };
}

/**
 * Returns whether the head has moved farther than the allowed distance from the palette, meaning the palette should close.
 * Distance is Euclidean in world meters; the limit defaults to VR_PALETTE_AUTO_CLOSE_DISTANCE_METERS and the comparison is strict.
 */
export function shouldAutoCloseVrPalette(request: {
  readonly headPosition: THREE.Vector3;
  readonly palettePosition: THREE.Vector3;
  readonly maxDistanceMeters?: number;
}): boolean {
  const maxDistanceMeters = request.maxDistanceMeters ?? VR_PALETTE_AUTO_CLOSE_DISTANCE_METERS;

  return request.headPosition.distanceTo(request.palettePosition) > maxDistanceMeters;
}

// Rotate offset into the head frame, or just copy it when the head has no orientation.
function applyLocalOffset(offset: THREE.Vector3, quaternion?: THREE.Quaternion): THREE.Vector3 {
  return quaternion ? offset.clone().applyQuaternion(quaternion) : offset.clone();
}

/**
 * Builds an orientation whose local -Z axis points from position toward targetPosition, with world +Y as up.
 * Returns the identity quaternion when the two points coincide (zero-length direction).
 * Intended for objects that look along -Z (cameras, pointers); for panels whose front is +Z use resolveFrontFacingQuaternion.
 */
export function resolveFacingQuaternion(position: THREE.Vector3, targetPosition: THREE.Vector3): THREE.Quaternion {
  const forward = targetPosition.clone().sub(position).normalize();
  if (forward.lengthSq() <= 1e-6) {
    return new THREE.Quaternion();
  }

  lookAtMatrix.lookAt(position, targetPosition, upAxis);
  return new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix);
}

/**
 * Builds an orientation whose local +Z axis (the front of a plane mesh) faces from position toward targetPosition.
 * Equivalent to resolveFacingQuaternion followed by a half turn about Y.
 */
export function resolveFrontFacingQuaternion(position: THREE.Vector3, targetPosition: THREE.Vector3): THREE.Quaternion {
  return resolveFacingQuaternion(position, targetPosition).multiply(positiveZFacingFlip);
}
