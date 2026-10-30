import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { transformVisiblePortalResultToRenderFrame } from "../../src/render/three/portalEyeFrameTransforms";
import { identityRenderFromRootMatrix } from "../../src/render/three/xrPortalEye";
import { createRootVisiblePortalPath } from "../../src/render/three/renderPortalInstances";
import type { ComputeVisiblePortalPathsResult } from "../../src/render/three/visiblePortalPaths";

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
