/**
 * Decides which cell an XR eye camera should render from when the eye has physically crossed portals away from the player's anchor.
 * In VR the head can move through portal openings while the logical player pose is still in the source cell;
 * this module re-roots rendering in the cell that contains the eye and supplies the matching camera and matrix.
 * The cell is found by walking the straight segment from the player's anchor to the eye through the portals
 * (`locateDevelopedPoint`), so any number of crossings is handled and side order does not matter.
 * Positions are in cell-local world coordinates (meters; x right, y forward, z up); cameras are in the Three.js frame (via worldAxes).
 * A caller that resolves every frame passes a persistent `XrPortalEyeRenderRootTarget` per eye so the re-rooted camera
 * and matrix are reused instead of reallocated; the no-re-root result is the shared frozen `identityRenderFromRootMatrix`.
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
  /** Camera to render with: the input camera itself when no re-root, otherwise a copy moved into the root cell's frame (the target's camera when a target is given). */
  readonly camera: THREE.Camera;
  /** Three.js matrix mapping root-cell-frame content into the render frame; `identityRenderFromRootMatrix` when no re-root, otherwise the inverse of the walk transform. Never mutate it. */
  readonly renderFromRootMatrix: THREE.Matrix4;
}

/** Persistent storage for one eye's re-rooted camera and matrix, reused across frames. */
export interface XrPortalEyeRenderRootTarget {
  /** Created on the first re-root, then reused. */
  camera: THREE.Camera | undefined;
  readonly renderFromRootMatrix: THREE.Matrix4;
}

/** Creates an empty per-eye target for `resolveXrPortalEyeRenderRoot`. */
export function createXrPortalEyeRenderRootTarget(): XrPortalEyeRenderRootTarget {
  return { camera: undefined, renderFromRootMatrix: new THREE.Matrix4() };
}

/**
 * Shared identity matrix for "no re-root". Its elements are frozen, so a write through any `Matrix4` method throws;
 * it is only ever read (right operand of `multiply`, `applyMatrix4`).
 */
export const identityRenderFromRootMatrix: THREE.Matrix4 = new THREE.Matrix4();
Object.freeze(identityRenderFromRootMatrix.elements);

// Slack in meters for the height test so an eye exactly on the floor or ceiling counts as inside.
const portalPlaneToleranceMeters = 1e-5;
const identityTolerance = 1e-9;
const identityElements: readonly number[] = new THREE.Matrix4().elements.slice();
const eyePositionScratch = new THREE.Vector3();
const rootFromSourceScratch = new THREE.Matrix4();
const walkMatrixScratch = new THREE.Matrix4();

/**
 * Returns the render root for an eye: walks from `anchorPoint` (the player's position in `sourceCellId`) to the eye's
 * horizontal position through the portals. If the walk ends in another cell (or in the same cell with a non-identity
 * transform), the result is re-rooted there with the camera carried through the walk's `cellFromStart`.
 * Falls back to the unchanged source cell and input camera (identity matrix) if the source cell id is unknown, the eye is
 * outside the cell height range, or the walk hits a wall or fails.
 * `camera` must have a valid world matrix (it is updated here). The input is never mutated; the returned camera is a
 * clone when re-rooted, or `target.camera` (overwritten each call) when a `target` is given.
 */
export function resolveXrPortalEyeRenderRoot(input: {
  readonly world: CompiledCellComplex;
  readonly sourceCellId: string;
  readonly anchorPoint: Vec3;
  readonly camera: THREE.Camera;
  readonly target?: XrPortalEyeRenderRootTarget;
}): XrPortalEyeRenderRoot {
  const unchanged = (): XrPortalEyeRenderRoot => ({
    rootCellId: input.sourceCellId,
    camera: input.camera,
    renderFromRootMatrix: identityRenderFromRootMatrix,
  });
  const sourceCell = input.world.cellsById.get(input.sourceCellId);

  if (!sourceCell) {
    return unchanged();
  }

  input.camera.updateMatrixWorld(true);
  const eyePoint = threePointToWorld(eyePositionScratch.setFromMatrixPosition(input.camera.matrixWorld));

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

  const rootFromSource = rigidTransformToThreeMatrix(located.cellFromStart, rootFromSourceScratch);

  if (located.cellId === input.sourceCellId && isIdentity(rootFromSource)) {
    return unchanged();
  }

  const target = input.target;

  if (!target) {
    return {
      rootCellId: located.cellId,
      camera: transformCamera(input.camera, located.cellFromStart, undefined),
      renderFromRootMatrix: rootFromSource.clone().invert(),
    };
  }

  target.renderFromRootMatrix.copy(rootFromSource).invert();

  return {
    rootCellId: located.cellId,
    camera: transformCamera(input.camera, located.cellFromStart, target),
    renderFromRootMatrix: target.renderFromRootMatrix,
  };
}

function isIdentity(matrix: THREE.Matrix4): boolean {
  const elements = matrix.elements;

  for (let index = 0; index < 16; index += 1) {
    if (Math.abs(elements[index] - identityElements[index]) > identityTolerance) {
      return false;
    }
  }

  return true;
}

// Copies the camera with a frozen world matrix premultiplied by the transform; projection is copied unchanged.
function transformCamera(
  camera: THREE.Camera,
  cellFromStart: RigidTransform3,
  target: XrPortalEyeRenderRootTarget | undefined,
): THREE.Camera {
  let transformedCamera: THREE.Camera;

  if (!target) {
    transformedCamera = camera.clone();
  } else {
    if (!target.camera || target.camera.type !== camera.type) {
      target.camera = camera.clone(false);
    } else {
      target.camera.copy(camera, false);
    }

    transformedCamera = target.camera;
  }

  const matrixWorld = rigidTransformToThreeMatrix(cellFromStart, walkMatrixScratch).multiply(camera.matrixWorld);

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
