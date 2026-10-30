/**
 * Builds the per-eye visibility states of one stereo (XR) frame, as a pure function of the world, the static path tables,
 * the eyes' render roots and the viewport, so the contract tests run the same code as the app.
 *
 * An eye's root identity is `(rootCellId, renderFromRootMatrix)`: two eyes share a root only when the cell ids are equal
 * and every matrix element agrees within 1e-9. A cell glued to itself (the single torus room) can put the eyes in the
 * same cell at different frames; that is a split, not a shared root. Each distinct identity gets a root group number in
 * eye order (eye 0's is 0); path ids are remapped per group, so the paths of different groups never share an id, and the
 * caller clips each group's root to its own eye (`resolvePortalInstanceClipIndex` with `unclippedRoot = false`).
 * Results are expressed in the render frame (`transformVisiblePortalResultToRenderFrame`).
 */

import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { StaticPortalPathCullResult } from "../../cell-complex/staticPortalPathCull";
import { mergeStaticPathCounts } from "./appDebugHelpers";
import {
  remapStereoPortalPathIds,
  transformVisiblePortalResultToRenderFrame,
  type PortalEyeRenderState,
} from "./portalEyeFrameTransforms";
import { computeVisiblePortalPaths, type VisiblePortalPathOptions } from "./visiblePortalPaths";
import type { XrPortalEyeRenderRoot } from "./xrPortalEye";

/** Largest per-element difference at which two render-from-root matrices count as the same frame. */
const rootFrameToleranceMatrixElement = 1e-9;

/** Per-eye states of a stereo frame plus the root grouping used for clipping and de-duplication. */
export interface StereoPortalFrame {
  /** Per-eye states with remapped ids and render-frame matrices. */
  readonly eyeStates: readonly PortalEyeRenderState[];
  /** True iff some eye's root identity differs from eye 0's. */
  readonly splitRoots: boolean;
  /** Root group per eye (eye 0's group is 0). */
  readonly rootGroupByEye: readonly number[];
  /** Remapped path id -> root group of the eye that produced it. */
  readonly rootGroupByPathId: ReadonlyMap<number, number>;
}

/** True iff the two eyes' render roots have the same cell id and the same frame (within 1e-9 per matrix element). */
export function haveSameRootIdentity(left: XrPortalEyeRenderRoot, right: XrPortalEyeRenderRoot): boolean {
  if (left.rootCellId !== right.rootCellId) {
    return false;
  }

  const leftElements = left.renderFromRootMatrix.elements;
  const rightElements = right.renderFromRootMatrix.elements;

  for (let index = 0; index < 16; index += 1) {
    if (Math.abs(leftElements[index] - rightElements[index]) > rootFrameToleranceMatrixElement) {
      return false;
    }
  }

  return true;
}

/**
 * Computes the visible paths of every eye and groups the eyes by root identity.
 * Returns undefined when some eye's root cell has no static table (the caller clears visibility).
 */
export function buildStereoPortalFrame(input: {
  readonly world: CompiledCellComplex;
  readonly staticCull: StaticPortalPathCullResult;
  readonly renderRoots: readonly XrPortalEyeRenderRoot[];
  readonly viewportPixels: { readonly width: number; readonly height: number };
  readonly options: VisiblePortalPathOptions;
}): StereoPortalFrame | undefined {
  const { world, staticCull, renderRoots } = input;
  const tables = renderRoots.map((renderRoot) => staticCull.tables.tablesByRootCellId.get(renderRoot.rootCellId));

  if (tables.some((table) => table === undefined)) {
    return undefined;
  }

  const groupRepresentatives: XrPortalEyeRenderRoot[] = [];
  const rootGroupByEye = renderRoots.map((renderRoot) => {
    let group = groupRepresentatives.findIndex((representative) => haveSameRootIdentity(representative, renderRoot));

    if (group < 0) {
      group = groupRepresentatives.length;
      groupRepresentatives.push(renderRoot);
    }

    return group;
  });
  const computedStates: PortalEyeRenderState[] = renderRoots.map((renderRoot, eyeIndex) => {
    const computed = computeVisiblePortalPaths({
      world,
      rootCellId: renderRoot.rootCellId,
      pathTable: tables[eyeIndex]!,
      camera: renderRoot.camera,
      viewportPixels: input.viewportPixels,
      options: input.options,
    });
    const rendered = transformVisiblePortalResultToRenderFrame(computed, renderRoot.renderFromRootMatrix);

    return {
      camera: renderRoot.camera,
      eyeIndex,
      rootCellId: renderRoot.rootCellId,
      rootGroup: rootGroupByEye[eyeIndex],
      result: {
        ...rendered,
        summary: mergeStaticPathCounts(rendered.summary, staticCull, renderRoot.rootCellId),
      },
    };
  });
  const eyeStates = remapStereoPortalPathIds(computedStates);
  const rootGroupByPathId = new Map<number, number>();

  for (const state of eyeStates) {
    for (const path of state.result.paths) {
      rootGroupByPathId.set(path.pathId, state.rootGroup ?? 0);
    }
  }

  return {
    eyeStates,
    splitRoots: rootGroupByEye.some((group) => group !== 0),
    rootGroupByEye,
    rootGroupByPathId,
  };
}
