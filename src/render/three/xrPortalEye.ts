/**
 * Decides which cell an XR eye camera should render from when the eye has physically crossed portals away from the player's anchor.
 * In VR the head can move through portal openings while the logical player pose is still in the source cell;
 * this module re-roots rendering in the cell that contains the eye and supplies the matching camera and matrix.
 * The cell is found by walking the straight segment from the player's anchor to the eye through the portals
 * (`locateDevelopedPoint`), so any number of crossings is handled and side order does not matter.
 * Positions are in cell-local world coordinates (meters; x right, y forward, z up); cameras are in the Three.js frame (via worldAxes).
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { locateDevelopedPoint } from "../../cell-complex/segmentWalk";
import type { RigidTransform3 } from "../../math/rigidTransform3";
import type { Vec3 } from "../../math/vec3";
import { rigidTransformToThreeMatrix, threePointToWorld } from "./worldAxes";

/**
 * Result of eye-root resolution: where to start rendering from and how to place content relative to it.
 */
export interface XrPortalEyeRenderRoot {
  /** Cell id to use as the render root (the source cell, or the cell the eye walked into). */
  readonly rootCellId: string;
  /** Camera to render with: the input camera itself when no re-root, otherwise a clone moved into the root cell's frame. */
  readonly camera: THREE.Camera;
  /** Three.js matrix mapping root-cell-frame content into the render frame; identity when no re-root, otherwise the inverse of the walk transform. */
  readonly renderFromRootMatrix: THREE.Matrix4;
}

// Slack in meters for the height test so an eye exactly on the floor or ceiling counts as inside.
const portalPlaneToleranceMeters = 1e-5;
const identityTolerance = 1e-9;

/**
 * Returns the render root for an eye: walks from `anchorPoint` (the player's position in `sourceCellId`) to the eye's
 * horizontal position through the portals. If the walk ends in another cell (or in the same cell with a non-identity
 * transform), the result is re-rooted there with the camera carried through the walk's `cellFromStart`.
 * Falls back to the unchanged source cell and input camera (identity matrix) if the source cell id is unknown, the eye is
 * outside the cell height range, or the walk hits a wall or fails.
 * `camera` must have a valid world matrix (it is updated here); the returned camera is a clone when re-rooted, so the input is never mutated.
 */
export function resolveXrPortalEyeRenderRoot(input: {
  readonly world: CompiledCellComplex;
  readonly sourceCellId: string;
  readonly anchorPoint: Vec3;
  readonly camera: THREE.Camera;
}): XrPortalEyeRenderRoot {
  const unchanged = (): XrPortalEyeRenderRoot => ({
    rootCellId: input.sourceCellId,
    camera: input.camera,
    renderFromRootMatrix: new THREE.Matrix4(),
  });
  const sourceCell = input.world.cellsById.get(input.sourceCellId);

  if (!sourceCell) {
    return unchanged();
  }

  input.camera.updateMatrixWorld(true);
  const eyePoint = threePointToWorld(new THREE.Vector3().setFromMatrixPosition(input.camera.matrixWorld));

  if (eyePoint.z < -portalPlaneToleranceMeters || eyePoint.z > sourceCell.heightMeters + portalPlaneToleranceMeters) {
    return unchanged();
  }

  const located = locateDevelopedPoint(
    input.world,
    input.sourceCellId,
    { x: input.anchorPoint.x, y: input.anchorPoint.y },
    { x: eyePoint.x, y: eyePoint.y },
  );

  if (located.status !== "end") {
    return unchanged();
  }

  const rootFromSource = rigidTransformToThreeMatrix(located.cellFromStart);

  if (located.cellId === input.sourceCellId && isIdentity(rootFromSource)) {
    return unchanged();
  }

  return {
    rootCellId: located.cellId,
    camera: transformCamera(input.camera, located.cellFromStart),
    renderFromRootMatrix: rootFromSource.clone().invert(),
  };
}

function isIdentity(matrix: THREE.Matrix4): boolean {
  const identity = new THREE.Matrix4().elements;
  return matrix.elements.every((value, index) => Math.abs(value - identity[index]) <= identityTolerance);
}

// Clones the camera with a frozen world matrix premultiplied by the transform; projection is copied unchanged.
function transformCamera(camera: THREE.Camera, cellFromStart: RigidTransform3): THREE.Camera {
  const transformedCamera = camera.clone();
  const matrixWorld = rigidTransformToThreeMatrix(cellFromStart).multiply(camera.matrixWorld);

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
