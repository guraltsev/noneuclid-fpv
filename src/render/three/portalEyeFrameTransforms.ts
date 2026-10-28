/**
 * Utilities for combining the per-eye visibility results of stereo (VR) rendering into one shared render frame.
 *
 * In XR each eye has its own camera and may even lie in a different root cell (an eye can be on the far side of
 * a portal plane). Each eye's `ComputeVisiblePortalPathsResult` is expressed in that eye's own root frame with
 * path ids local to its own path table. To draw both with one set of instanced meshes and one clip texture, results are
 * (1) re-expressed in a shared render frame by left-multiplying `renderFromRoot` (Three.js `Matrix4.multiply`
 * applies the right operand first, so `renderFromRoot * rootFromDestination` is `renderFromDestination`),
 * (2) given globally unique path ids per `(rootCellId, localPathId)` so that identical paths seen by both eyes share an id
 * and different roots never collide, and (3) merged into a union by path id. Polygons stay in each eye's own NDC.
 */
/** Re-expresses per-eye visible-portal results in one shared render frame for stereo (VR) rendering. */
import * as THREE from "three";
import { ComputeVisiblePortalPathsResult, VisiblePortalPath } from "./visiblePortalPaths";

/** One eye's camera and its visibility result, tagged with the eye index and the cell that eye is rooted in. */
export interface PortalEyeRenderState {
  readonly camera: THREE.Camera;
  readonly result: ComputeVisiblePortalPathsResult;
  readonly eyeIndex: number;
  readonly rootCellId: string;
}

/** Merges the paths of all eyes into one map keyed by path id, keeping the first eye's entry when several eyes see the same id. */
export function buildUnionVisiblePathById(
  results: readonly ComputeVisiblePortalPathsResult[],
): ReadonlyMap<number, VisiblePortalPath> {
  const visiblePathById = new Map<number, VisiblePortalPath>();

  for (const result of results) {
    for (const path of result.paths) {
      if (!visiblePathById.has(path.pathId)) {
        visiblePathById.set(path.pathId, path);
      }
    }
  }

  return visiblePathById;
}

/** Returns a copy of `result` whose path matrices are premultiplied by `renderFromRootMatrix`, so they place cells in the shared render frame; polygons and statistics are unchanged. */
export function transformVisiblePortalResultToRenderFrame(
  result: ComputeVisiblePortalPathsResult,
  renderFromRootMatrix: THREE.Matrix4,
): ComputeVisiblePortalPathsResult {
  const paths = result.paths.map((path) => ({
    ...path,
    rootFromDestinationMatrix: renderFromRootMatrix.clone().multiply(path.rootFromDestinationMatrix),
  }));

  return {
    ...result,
    paths,
    visiblePathById: new Map(paths.map((path) => [path.pathId, path])),
  };
}

/** Reassigns path ids consecutively (from 0, in first-seen order) so equal `(rootCellId, pathId)` pairs share an id across eyes and different roots stay distinct; the input is not modified. */
export function remapStereoPortalPathIds(states: readonly PortalEyeRenderState[]): readonly PortalEyeRenderState[] {
  const pathIdByRootPathKey = new Map<string, number>();
  let nextPathId = 0;

  return states.map((state) => {
    const remappedPaths = state.result.paths.map((path) => {
      const key = `${state.rootCellId}:${path.pathId}`;
      let pathId = pathIdByRootPathKey.get(key);

      if (pathId === undefined) {
        pathId = nextPathId;
        nextPathId += 1;
        pathIdByRootPathKey.set(key, pathId);
      }

      return {
        ...path,
        pathId,
      };
    });
    const visiblePathById = new Map(remappedPaths.map((path) => [path.pathId, path]));

    return {
      ...state,
      result: {
        ...state.result,
        paths: remappedPaths,
        visiblePathById,
      },
    };
  });
}
