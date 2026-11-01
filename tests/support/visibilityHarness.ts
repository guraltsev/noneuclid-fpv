/**
 * Runs the renderer-free portal visibility pass (`src/visibility/visiblePortalPaths`) on the Three.js cameras of
 * `./cameras`, so visibility tests keep writing their cameras as poses and fields of view.
 *
 * The placement matrix of a returned path is the path's own `RigidTransform3` (`matrixForPath` is the identity map), which is
 * what the tests compare; no Three.js matrix is built.
 */
import type * as THREE from "three";
import type { RigidTransform3 } from "../../src/math/rigidTransform3";
import { threePointToWorld } from "../../src/render/three/worldAxes";
import {
  computeIndependentVisiblePortalPaths as computeIndependent,
  computeVisiblePortalPaths as computeSingle,
  type ComputeIndependentVisiblePortalPathsInput,
  type ComputeVisiblePortalPathsInput,
  type ComputeVisiblePortalPathsResult,
  type VisibilityCamera,
} from "../../src/visibility/visiblePortalPaths";

/** Inputs of {@link computeVisiblePortalPaths}: the pass inputs with a Three.js camera and no `matrixForPath`. */
export type ThreeCameraVisibilityInput = Omit<ComputeVisiblePortalPathsInput<RigidTransform3>, "camera" | "matrixForPath"> & {
  readonly camera: THREE.Camera;
};

/** Refreshes the camera's matrices and reads its eye (world axes) and view and projection matrices. */
export function visibilityCameraOf(camera: THREE.Camera): VisibilityCamera {
  camera.updateMatrixWorld(true);
  const projectable = camera as THREE.Camera & { updateProjectionMatrix?: () => void };
  projectable.updateProjectionMatrix?.();

  const e = camera.matrixWorld.elements;

  return {
    eye: threePointToWorld({ x: e[12], y: e[13], z: e[14] } as THREE.Vector3),
    view: camera.matrixWorldInverse.elements,
    projection: camera.projectionMatrix.elements,
  };
}

/** Runs the visibility pass for one Three.js camera. */
export function computeVisiblePortalPaths(input: ThreeCameraVisibilityInput): ComputeVisiblePortalPathsResult<RigidTransform3> {
  return computeSingle({ ...input, camera: visibilityCameraOf(input.camera), matrixForPath: (transform) => transform });
}

/** Runs the visibility pass once per Three.js camera. */
export function computeIndependentVisiblePortalPaths(
  input: Omit<ComputeIndependentVisiblePortalPathsInput<RigidTransform3>, "cameras" | "matrixForPath"> & {
    readonly cameras: readonly THREE.Camera[];
  },
): readonly ComputeVisiblePortalPathsResult<RigidTransform3>[] {
  return computeIndependent({ ...input, cameras: input.cameras.map(visibilityCameraOf), matrixForPath: (transform) => transform });
}
