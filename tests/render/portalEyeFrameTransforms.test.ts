import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  countStereoPortalPaths,
  rankStereoUnionPaths,
  remapStereoPortalPathIds,
  transformVisiblePortalResultToRenderFrame,
  type PortalEyeRenderState,
} from "../../src/render/three/portalEyeFrameTransforms";
import { identityRenderFromRootMatrix } from "../../src/render/three/xrPortalEye";
import { createRootVisiblePortalPath } from "../../src/render/three/renderPortalInstances";
import type { ComputeVisiblePortalPathsResult, VisiblePortalPath } from "../../src/render/three/visiblePortalPaths";

function resultWithPaths(): ComputeVisiblePortalPathsResult {
  const paths = [
    createRootVisiblePortalPath("a"),
    { ...createRootVisiblePortalPath("b"), pathId: 3, depth: 1, rootFromDestinationMatrix: new THREE.Matrix4().makeTranslation(0, 0, -4) },
  ];
  return { paths, visiblePathById: new Map(paths.map((path) => [path.pathId, path])) } as unknown as ComputeVisiblePortalPathsResult;
}

describe("transformVisiblePortalResultToRenderFrame", () => {
  it("returns the input itself for the shared identity and for an exactly identity matrix", () => {
    const result = resultWithPaths();

    expect(transformVisiblePortalResultToRenderFrame(result, identityRenderFromRootMatrix)).toBe(result);
    expect(transformVisiblePortalResultToRenderFrame(result, new THREE.Matrix4())).toBe(result);
  });

  it("premultiplies every path matrix by a non-identity matrix", () => {
    const result = resultWithPaths();
    const shift = new THREE.Matrix4().makeTranslation(1, 0, 0);
    const transformed = transformVisiblePortalResultToRenderFrame(result, shift);

    expect(transformed).not.toBe(result);
    transformed.paths.forEach((path, index) => {
      const expected = shift.clone().multiply(result.paths[index].rootFromDestinationMatrix);
      expect(path.rootFromDestinationMatrix.elements).toEqual(expected.elements);
    });
    expect(transformed.visiblePathById.get(3)).toBe(transformed.paths[1]);
  });

  it("makes the shared identity matrix immutable", () => {
    expect(() => identityRenderFromRootMatrix.makeTranslation(1, 0, 0)).toThrow();
  });
});

function createVisiblePath(pathId: number, depth: number, cellId: string, translationX: number): VisiblePortalPath {
  return {
    ...createRootVisiblePortalPath(cellId),
    pathId,
    depth,
    rootFromDestinationMatrix: new THREE.Matrix4().makeTranslation(translationX, 0, 0),
  };
}

function eyeState(eyeIndex: number, rootCellId: string, paths: VisiblePortalPath[], rootGroup?: number): PortalEyeRenderState {
  return {
    camera: new THREE.PerspectiveCamera(),
    eyeIndex,
    rootCellId,
    rootGroup,
    result: { paths, visiblePathById: new Map(paths.map((path) => [path.pathId, path])) } as unknown as ComputeVisiblePortalPathsResult,
  };
}

describe("rankStereoUnionPaths", () => {
  it("alternates between disjoint lists, roots first", () => {
    const eye0 = Array.from({ length: 10 }, (_, id) => createVisiblePath(id, id === 0 ? 0 : 1, "a", id));
    const eye1 = Array.from({ length: 10 }, (_, id) => createVisiblePath(10 + id, id === 0 ? 0 : 1, "b", id));

    expect(rankStereoUnionPaths([eye0, eye1]).map((path) => path.pathId).slice(0, 6)).toEqual([0, 10, 1, 11, 2, 12]);
  });

  it("does not spend a turn on an id that is already taken", () => {
    const eye0 = [0, 1, 2, 3].map((id) => createVisiblePath(id, 1, "a", id));
    const eye1 = [0, 1, 4, 5].map((id) => createVisiblePath(id, 1, "a", id));

    expect(rankStereoUnionPaths([eye0, eye1]).map((path) => path.pathId)).toEqual([0, 1, 2, 4, 3, 5]);
  });
});

describe("countStereoPortalPaths", () => {
  it("counts cell copies by placement, not by id", () => {
    const left = eyeState(0, "a", [createVisiblePath(0, 1, "b", 15), createVisiblePath(1, 1, "a", 0)]);
    const right = eyeState(1, "a", [createVisiblePath(2, 1, "b", 15), createVisiblePath(3, 1, "c", 30)]);
    const counts = countStereoPortalPaths([left, right], new Set([0, 1, 2, 3]), true);

    expect(counts).toMatchObject({
      splitRoots: true,
      leftPathCount: 2,
      rightPathCount: 2,
      unionPathCount: 4,
      bothEyesPathCount: 1,
      leftOnlyPathCount: 1,
      rightOnlyPathCount: 1,
      droppedLeftPathCount: 0,
      droppedRightPathCount: 0,
    });
    expect(countStereoPortalPaths([left], new Set(), false)).toBeUndefined();
  });
});

describe("remapStereoPortalPathIds root groups", () => {
  it("gives eyes of one cell but different groups distinct ids", () => {
    const same = remapStereoPortalPathIds([
      eyeState(0, "a", [createVisiblePath(5, 1, "b", 1)], 0),
      eyeState(1, "a", [createVisiblePath(5, 1, "b", 1)], 1),
    ]);
    const shared = remapStereoPortalPathIds([
      eyeState(0, "a", [createVisiblePath(5, 1, "b", 1)], 0),
      eyeState(1, "a", [createVisiblePath(5, 1, "b", 1)], 0),
    ]);

    expect(same[0].result.paths[0].pathId).not.toBe(same[1].result.paths[0].pathId);
    expect(shared[0].result.paths[0].pathId).toBe(shared[1].result.paths[0].pathId);
  });
});
