/**
 * Three.js adapter of the renderer-free portal visibility pass (`visibility/visiblePortalPaths`): it takes `THREE.Camera`s, refreshes
 * their matrices, and returns the visible paths with `rootFromDestinationMatrix` as a `THREE.Matrix4` in Three.js axes, cached per
 * path transform and shared between calls (never mutate).
 */

import * as THREE from "three";
import type { RigidTransform3 } from "../../math/rigidTransform3";
import {
  computeIndependentVisiblePortalPaths as computeIndependentVisibility,
  computeVisiblePortalPaths as computeVisibility,
  type ComputeIndependentVisiblePortalPathsInput as VisibilityIndependentInput,
  type ComputeVisiblePortalPathsInput as VisibilityInput,
  type ComputeVisiblePortalPathsResult as VisibilityResult,
  type VisibilityCamera,
  type VisiblePortalPath as VisibilityPath,
} from "../../visibility/visiblePortalPaths";
import { rigidTransformToThreeMatrix, threePointToWorld } from "./worldAxes";

/** One visible portal path with its placement as a Three.js matrix. */
export type VisiblePortalPath = VisibilityPath<THREE.Matrix4>;

/** Result of a visibility pass with Three.js placement matrices. */
export type ComputeVisiblePortalPathsResult = VisibilityResult<THREE.Matrix4>;

/** Inputs for {@link computeVisiblePortalPaths}: the pure inputs with a Three.js camera. */
export type ComputeVisiblePortalPathsInput = Omit<VisibilityInput<THREE.Matrix4>, "camera" | "matrixForPath"> & {
  /** Camera in the root cell's frame, positioned inside the root cell. Its matrices are refreshed by the call. */
  readonly camera: THREE.Camera;
};

/** Inputs for {@link computeIndependentVisiblePortalPaths}: the pure inputs with Three.js cameras. */
export type ComputeIndependentVisiblePortalPathsInput = Omit<
  VisibilityIndependentInput<THREE.Matrix4>,
  "cameras" | "matrixForPath"
> & {
  readonly cameras: readonly THREE.Camera[];
};

// Cached Three.js matrix per table path transform; shared by every result, never mutated.
const threeMatrixByTransform = new WeakMap<RigidTransform3, THREE.Matrix4>();

function threeMatrixForTransform(transform: RigidTransform3): THREE.Matrix4 {
  let matrix = threeMatrixByTransform.get(transform);

  if (!matrix) {
    matrix = rigidTransformToThreeMatrix(transform);
    threeMatrixByTransform.set(transform, matrix);
  }

  return matrix;
}

/** Refreshes the camera's matrices and reads the eye (in world axes) and the view and projection matrices. */
function visibilityCameraOf(camera: THREE.Camera): VisibilityCamera {
  camera.updateMatrixWorld(true);
  if ("updateProjectionMatrix" in camera && typeof camera.updateProjectionMatrix === "function") {
    camera.updateProjectionMatrix();
  }

  return {
    eye: threePointToWorld(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)),
    view: camera.matrixWorldInverse.elements,
    projection: camera.projectionMatrix.elements,
  };
}

/**
 * Computes the visible portal paths for a root cell from one Three.js camera.
 *
 * Side effects: calls `updateMatrixWorld(true)` and `updateProjectionMatrix()` on the camera. See `visibility/visiblePortalPaths`
 * for the visibility rule. @throws Error if the table has no path with id 0.
 */
export function computeVisiblePortalPaths(input: ComputeVisiblePortalPathsInput): ComputeVisiblePortalPathsResult {
  return computeVisibility({ ...input, camera: visibilityCameraOf(input.camera), matrixForPath: threeMatrixForTransform });
}

/**
 * Computes one visibility result per Three.js camera, each evaluated against that camera alone. The result array parallels
 * `input.cameras`. Side effects: refreshes camera matrices. @throws Error if the table has no path with id 0.
 */
export function computeIndependentVisiblePortalPaths(
  input: ComputeIndependentVisiblePortalPathsInput,
): readonly ComputeVisiblePortalPathsResult[] {
  return computeIndependentVisibility({
    ...input,
    cameras: input.cameras.map(visibilityCameraOf),
    matrixForPath: threeMatrixForTransform,
  });
}
