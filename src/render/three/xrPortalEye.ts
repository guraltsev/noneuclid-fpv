/**
 * Decides which cell an XR eye camera should render from when the eye has physically crossed a portal plane within the player's cell.
 * In VR the head can move through a portal opening while the logical player pose is still in the source cell;
 * this module re-roots rendering in the target cell and supplies the matching camera and matrix.
 * Positions are in cell-local world coordinates (meters; x right, y forward, z up); cameras are in the Three.js frame (via worldAxes).
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CompiledPortal } from "../../cell-complex/specs";
import { projectPointAlongSide, signedDistanceToSide } from "../../movement/collision";
import { rigidTransformToThreeMatrix, threePointToWorld } from "./worldAxes";

/**
 * Result of eye-root resolution: where to start rendering from and how to place content relative to it.
 */
export interface XrPortalEyeRenderRoot {
  /** Cell id to use as the render root (the source cell, or the portal's target cell). */
  readonly rootCellId: string;
  /** Camera to render with: the input camera itself when no crossing, otherwise a clone moved into the target cell's frame. */
  readonly camera: THREE.Camera;
  /** Three.js matrix mapping root-cell-frame content into the render frame; identity when no crossing, otherwise the inverse portal transform. */
  readonly renderFromRootMatrix: THREE.Matrix4;
}

// Slack in meters for plane/extent tests so a point exactly on the portal counts as inside.
const portalPlaneToleranceMeters = 1e-5;

/**
 * Returns the render root for an eye: if the eye is behind a portal side of `sourceCellId` (signed distance < 0) and within that side's length and the cell height,
 * the result is re-rooted in the portal's target cell with the camera carried through `transformToTarget`.
 * Falls back to the unchanged source cell and input camera (identity matrix) if the source cell id is unknown or no portal is crossed.
 * `camera` must have a valid world matrix (it is updated here); the returned camera is a clone when re-rooted, so the input is never mutated.
 * Only the first crossed portal is used; chained crossings are not resolved in one call.
 */
export function resolveXrPortalEyeRenderRoot(input: {
  readonly world: CompiledCellComplex;
  readonly sourceCellId: string;
  readonly camera: THREE.Camera;
}): XrPortalEyeRenderRoot {
  const sourceCell = input.world.cellsById.get(input.sourceCellId);

  if (!sourceCell) {
    return {
      rootCellId: input.sourceCellId,
      camera: input.camera,
      renderFromRootMatrix: new THREE.Matrix4(),
    };
  }

  input.camera.updateMatrixWorld(true);
  const eyePoint = threePointToWorld(new THREE.Vector3().setFromMatrixPosition(input.camera.matrixWorld));

  for (const side of sourceCell.sides) {
    if (!side.portal || signedDistanceToSide(side, eyePoint) >= -portalPlaneToleranceMeters) {
      continue;
    }

    const sideProjection = projectPointAlongSide(side, eyePoint);

    if (sideProjection < -portalPlaneToleranceMeters || sideProjection > side.lengthMeters + portalPlaneToleranceMeters) {
      continue;
    }

    if (eyePoint.z < -portalPlaneToleranceMeters || eyePoint.z > sourceCell.heightMeters + portalPlaneToleranceMeters) {
      continue;
    }

    return {
      rootCellId: side.portal.targetCellId,
      camera: transformCameraThroughPortal(input.camera, side.portal),
      renderFromRootMatrix: rigidTransformToThreeMatrix(side.portal.transformToTarget).invert(),
    };
  }

  return {
    rootCellId: input.sourceCellId,
    camera: input.camera,
    renderFromRootMatrix: new THREE.Matrix4(),
  };
}

// Clones the camera with a frozen world matrix premultiplied by the portal transform; projection is copied unchanged.
function transformCameraThroughPortal(camera: THREE.Camera, portal: CompiledPortal): THREE.Camera {
  const transformedCamera = camera.clone();
  const portalMatrix = rigidTransformToThreeMatrix(portal.transformToTarget);
  const matrixWorld = portalMatrix.multiply(camera.matrixWorld);

  transformedCamera.matrixAutoUpdate = false;
  transformedCamera.matrix.copy(matrixWorld);
  transformedCamera.matrixWorld.copy(matrixWorld);
  transformedCamera.matrixWorldInverse.copy(matrixWorld).invert();
  transformedCamera.matrixWorldNeedsUpdate = false;
  matrixWorld.decompose(transformedCamera.position, transformedCamera.quaternion, transformedCamera.scale);
  transformedCamera.projectionMatrix.copy(camera.projectionMatrix);
  transformedCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

  return transformedCamera;
}
