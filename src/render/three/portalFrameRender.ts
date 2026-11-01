/**
 * Render-root list for the mono portal visibility pass.
 * The visibility pass takes one render root per eye; the mono case is a list of one root. This holder owns that one-element list
 * and rewrites its root in place, so a frame builds no new root object, no list and no matrix.
 */
import type * as THREE from "three";
import { identityRenderFromRootMatrix, type XrPortalEyeRenderRoot } from "./xrPortalEye";

/** Reusable one-element render-root list for the mono pass. */
export interface MonoPortalRenderRoots {
  /**
   * Points the single root at `rootCellId` seen by `camera` and returns the list, which is the same array on every call.
   * The root maps into the render frame by `renderFromRootMatrix` (the shared identity by default). The returned list is valid until the next call.
   */
  set(
    rootCellId: string,
    camera: THREE.Camera,
    renderFromRootMatrix?: THREE.Matrix4,
  ): readonly XrPortalEyeRenderRoot[];
}

/** Creates the holder; the list it returns holds one root whose fields `set` overwrites. */
export function createMonoPortalRenderRoots(initialCamera: THREE.Camera): MonoPortalRenderRoots {
  const root = {
    rootCellId: "",
    camera: initialCamera,
    renderFromRootMatrix: identityRenderFromRootMatrix,
  };
  const roots: readonly XrPortalEyeRenderRoot[] = [root];

  return {
    set(rootCellId, camera, renderFromRootMatrix = identityRenderFromRootMatrix) {
      root.rootCellId = rootCellId;
      root.camera = camera;
      root.renderFromRootMatrix = renderFromRootMatrix;
      return roots;
    },
  };
}
