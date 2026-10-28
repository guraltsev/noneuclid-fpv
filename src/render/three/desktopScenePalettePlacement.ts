/**
 * Desktop placement of the in-scene palette: a panel floating 1.05 m in front of the camera, facing it.
 * Positions are in the Three.js world frame in meters. The returned quaternion has its local -Z axis pointing from the panel toward the camera and +Y aligned with the camera's up,
 * so the panel's front (+Z) faces away from the camera in this frame; scenePaletteController.ts compensates by rotating the adapter root half a turn about Y.
 */
import * as THREE from "three";
import type { ScenePalettePlacement } from "./scenePaletteInput";

// Scratch objects reused every call to avoid per-frame allocation; not reentrant.
const forward = new THREE.Vector3(0, 0, -1);
const up = new THREE.Vector3(0, 1, 0);
const cameraPosition = new THREE.Vector3();
const cameraQuaternion = new THREE.Quaternion();
const cameraScale = new THREE.Vector3();

/**
 * Computes the palette pose for the desktop (non-XR) camera: 1.05 m along the camera's view direction, oriented to look back at the camera with the camera's up vector.
 * Pass freeze together with previousPlacement to hold the earlier pose (a cloned copy marked freeze: true); without previousPlacement freeze is ignored and a new pose is computed.
 * Calls camera.updateMatrixWorld(true), so the camera must be fully set up; results are fresh objects, never aliasing the scratch vectors.
 * @param options.camera The active desktop camera (perspective or orthographic).
 * @param options.previousPlacement Pose from the previous frame, used only when freezing.
 * @param options.freeze Hold the previous pose instead of following the camera.
 */
export function resolveDesktopScenePalettePlacement(options: {
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly previousPlacement?: ScenePalettePlacement;
  readonly freeze?: boolean;
}): ScenePalettePlacement {
  if (options.freeze && options.previousPlacement) {
    return {
      position: options.previousPlacement.position.clone(),
      quaternion: options.previousPlacement.quaternion.clone(),
      scale: options.previousPlacement.scale,
      freeze: true,
    };
  }

  options.camera.updateMatrixWorld(true);
  options.camera.matrixWorld.decompose(cameraPosition, cameraQuaternion, cameraScale);
  const position = cameraPosition.clone().add(forward.clone().applyQuaternion(cameraQuaternion).multiplyScalar(1.05));
  const panelUp = up.clone().applyQuaternion(cameraQuaternion).normalize();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, cameraPosition, panelUp),
  );

  return {
    position,
    quaternion,
    scale: 1,
    freeze: options.freeze,
  };
}
