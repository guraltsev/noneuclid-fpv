/**
 * Three.js adapter of the renderer-free aim picking (`interaction/aimTarget`): reads the aim ray from a camera's world position and
 * forward (-z) axis, in the root Three.js frame, and hands it over in world axes.
 */
import * as THREE from "three";
import {
  resolveAimTargets as resolveAimTargetsOnRay,
  type AimRay,
  type ResolveAimTargetRequest as RayAimTargetRequest,
} from "../../interaction/aimTarget";
import { threeDirectionToWorld, threePointToWorld } from "./worldAxes";

/** Inputs for {@link resolveAimTargets}: the ray request with the ray replaced by the camera that defines it. */
export type ResolveAimTargetRequest = Omit<RayAimTargetRequest, "ray"> & {
  /** Camera whose world position and forward (-z) axis define the ray, in the root Three.js frame. Its world matrix is updated. */
  readonly camera: THREE.Camera;
};

/** The aim ray of a camera: its world position and forward axis in world axes. */
export function aimRayOfCamera(camera: THREE.Camera): AimRay {
  camera.updateMatrixWorld(true);
  const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())).normalize();

  return { origin: threePointToWorld(origin), direction: threeDirectionToWorld(direction) };
}

/** Returns every aim target along the camera's crosshair ray, best first; see `interaction/aimTarget`. */
export function resolveAimTargets(request: ResolveAimTargetRequest): ReturnType<typeof resolveAimTargetsOnRay> {
  const { camera, ...rest } = request;

  return resolveAimTargetsOnRay({ ...rest, ray: aimRayOfCamera(camera) });
}
