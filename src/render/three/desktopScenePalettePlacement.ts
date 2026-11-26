/**
 * Desktop placement of the in-scene palette: a panel floating in front of the camera, facing it, at the distance that makes it fill the same share of
 * the window whatever its size and shape, and raised a little so its bottom edge clears the tool belt at the bottom of the window.
 * Positions are in the Three.js world frame in meters. The returned quaternion has its local -Z axis pointing from the panel toward the camera and +Y aligned with the camera's up,
 * so the panel's front (+Z) faces away from the camera in this frame; scenePaletteController.ts compensates by rotating the adapter root half a turn about Y.
 */
import * as THREE from "three";
import type { ScenePalettePlacement } from "./scenePaletteInput";
import { scenePalettePanelHeightMeters, scenePalettePanelWidthMeters } from "./scenePaletteLayout";

/** Share of the window height and width the panel may take at most; the smaller fit wins. */
const viewHeightShare = 0.78;
const viewWidthShare = 0.9;
/** How far the panel's center sits above the window's center, as a share of the window height: room for the tool belt below it. */
const viewRaiseShare = 0.05;
/** Distance used for a camera without a field of view (orthographic). */
const fallbackDistanceMeters = 1.05;

// Scratch objects reused every call to avoid per-frame allocation; not reentrant.
const forward = new THREE.Vector3(0, 0, -1);
const up = new THREE.Vector3(0, 1, 0);
const cameraPosition = new THREE.Vector3();
const cameraQuaternion = new THREE.Quaternion();
const cameraScale = new THREE.Vector3();

/**
 * Computes the palette pose for the desktop (non-XR) camera: along the camera's view direction at the distance where the panel fills 78% of the window height
 * (or 90% of its width, if the window is narrow), raised by 5% of the window height, parallel to the image plane with the camera's up vector.
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
  const { distance, raise } = fitDistance(options.camera);
  const panelUp = up.clone().applyQuaternion(cameraQuaternion).normalize();
  const position = cameraPosition.clone()
    .add(forward.clone().applyQuaternion(cameraQuaternion).multiplyScalar(distance))
    .addScaledVector(panelUp, raise);
  // Parallel to the image plane (not turned toward the eye), so the raised panel stays a rectangle on screen.
  const viewDirection = forward.clone().applyQuaternion(cameraQuaternion);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, position.clone().sub(viewDirection), panelUp),
  );

  return {
    position,
    quaternion,
    scale: 1,
    freeze: options.freeze,
  };
}

// The distance at which the panel fills its share of the view, and how far to raise it there (meters).
function fitDistance(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): { readonly distance: number; readonly raise: number } {
  if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    return { distance: fallbackDistanceMeters, raise: 0 };
  }
  const perspective = camera as THREE.PerspectiveCamera;
  const halfHeightPerMeter = Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2) / (perspective.zoom || 1);
  const aspect = perspective.aspect > 0 ? perspective.aspect : 1;
  if (!(halfHeightPerMeter > 0) || !Number.isFinite(halfHeightPerMeter)) {
    return { distance: fallbackDistanceMeters, raise: 0 };
  }
  const distanceForHeight = scenePalettePanelHeightMeters / (2 * halfHeightPerMeter * viewHeightShare);
  const distanceForWidth = scenePalettePanelWidthMeters / (2 * halfHeightPerMeter * aspect * viewWidthShare);
  const distance = Math.max(distanceForHeight, distanceForWidth);
  return { distance, raise: 2 * halfHeightPerMeter * distance * viewRaiseShare };
}
