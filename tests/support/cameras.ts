/**
 * Perspective cameras in lattice (x, y, z) coordinates, for render tests that need a camera at a given pose rather
 * than its default (0, 0, 0) looking down -z. Replaces the near-identical camera builders several render test files
 * wrote for themselves (`tests/render/*`: visiblePortalPaths, visiblePortalPaths.property, portalClipPlanes,
 * xrPortalEye, aimTarget, vrLocomotion).
 */
import * as THREE from "three";
import { worldPointToThree } from "../../src/render/three/worldAxes";

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

/** Lens and clip-plane options shared by every builder here; all have the defaults the replaced builders used. */
export interface FakeCameraOptions {
  readonly fovDegrees?: number;
  readonly aspect?: number;
  readonly near?: number;
  readonly far?: number;
}

/** A camera at `position`, looking at `lookAt`, with its world matrix and projection matrix already updated. */
export function createCameraAt(position: Point3, lookAt: Point3, options: FakeCameraOptions = {}): THREE.PerspectiveCamera {
  const { fovDegrees = 70, aspect = 1, near = 0.01, far = 250 } = options;
  const camera = new THREE.PerspectiveCamera(fovDegrees, aspect, near, far);

  camera.position.copy(worldPointToThree(position));
  camera.up.set(0, 1, 0);
  camera.lookAt(worldPointToThree(lookAt));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  return camera;
}

/** A camera at `position`, looking along `yawRadians` in the lattice's horizontal (x, y) plane. */
export function createCameraFacingYaw(position: Point3, yawRadians: number, options: FakeCameraOptions = {}): THREE.PerspectiveCamera {
  return createCameraAt(
    position,
    { x: position.x + Math.cos(yawRadians), y: position.y + Math.sin(yawRadians), z: position.z },
    options,
  );
}

/**
 * A camera at `eye` with a random orientation (yaw, pitch within +/-60 degrees, roll within +/-30 degrees), random
 * field of view (60-160 degrees) and random aspect ratio (0.6-1.8), drawn from `random`. For property tests that
 * must not depend on any one camera pose.
 */
export function createRandomCamera(eye: Point3, random: () => number): THREE.PerspectiveCamera {
  const degrees = (value: number): number => (value * Math.PI) / 180;
  const yaw = random() * 2 * Math.PI;
  const pitch = degrees(-60 + 120 * random());
  const roll = degrees(-30 + 60 * random());
  const halfFov = 30 + 50 * random();
  const aspect = 0.6 + 1.2 * random();
  const camera = new THREE.PerspectiveCamera(2 * halfFov, aspect, 0.01, 250);

  camera.position.copy(worldPointToThree(eye));
  camera.quaternion
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  return camera;
}
