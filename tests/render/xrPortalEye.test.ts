/**
 * XR portal-eye re-rooting (src/render/three/xrPortalEye.ts): decides which cell an XR eye camera should render
 * from when the eye has physically crossed a portal away from the player's anchor, by walking the straight segment
 * from the anchor to the eye through the portals. Re-rooting is independent of portal side order and handles any
 * number of crossings; an eye that stays in its own cell (or behind a wall) is not re-rooted, and reusing a
 * persistent `XrPortalEyeRenderRootTarget` across calls gives the same result without reallocating the camera or
 * matrix.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { locateDevelopedPoint } from "../../src/cell-complex/segmentWalk";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import {
  createXrPortalEyeRenderRootTarget,
  identityRenderFromRootMatrix,
  resolveXrPortalEyeRenderRoot,
} from "../../src/render/three/xrPortalEye";
import { rigidTransformToThreeMatrix } from "../../src/render/three/worldAxes";
import { createCameraAt } from "../support/cameras";

const baseVertices = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

interface PortalDef {
  readonly side: number;
  readonly id: string;
  readonly target: string;
  readonly targetPortal: string;
}

// Square cell whose base vertex list is rotated by `rotation` places; `side` in the portal defs is the unrotated side index.
function cell(id: string, rotation: number, portals: readonly PortalDef[]) {
  return {
    id,
    heightMeters: 3,
    baseVertices: baseVertices.map((_, i) => baseVertices[(i + rotation) % 4]),
    portals: portals.map((p) => ({
      id: p.id,
      sideIndex: (p.side - rotation + 8) % 4,
      targetCellId: p.target,
      targetPortalId: p.targetPortal,
    })),
  };
}

// c has portals east (to e) and north (to n); e continues north to en.
function chainWorld(rotation: number): CellComplexSpec {
  return {
    cells: [
      cell("c", rotation, [
        { side: 1, id: "east", target: "e", targetPortal: "west" },
        { side: 2, id: "north", target: "n", targetPortal: "south" },
      ]),
      cell("e", rotation, [
        { side: 3, id: "west", target: "c", targetPortal: "east" },
        { side: 2, id: "north", target: "en", targetPortal: "south" },
      ]),
      cell("n", rotation, [{ side: 0, id: "south", target: "c", targetPortal: "north" }]),
      cell("en", rotation, [{ side: 0, id: "south", target: "e", targetPortal: "north" }]),
    ],
  };
}

function camera(x: number, y: number, z = 1.6): THREE.PerspectiveCamera {
  return createCameraAt({ x, y, z }, { x: x + 1, y, z }, { fovDegrees: 70, aspect: 1, near: 0.001, far: 250 });
}

describe("resolveXrPortalEyeRenderRoot", () => {
  it("re-roots by walking from the anchor, independent of side order", () => {
    const anchor = { x: 0.8, y: 0.8, z: 0 };
    const results = [0, 1].map((rotation) => {
      const world = compileCellComplex(chainWorld(rotation));
      const eye = camera(1.1, 1.05);
      const result = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "c", anchorPoint: anchor, camera: eye });
      const located = locateDevelopedPoint(world, "c", { x: 0.8, y: 0.8 }, { x: 1.1, y: 1.05 });

      expect(located.status).toBe("end");
      expect(result.rootCellId).toBe(located.cellId);
      expectMatricesClose(result.renderFromRootMatrix, rigidTransformToThreeMatrix(located.cellFromStart).invert());
      return result;
    });

    expect(results[0].rootCellId).toBe("en");
    expect(results[1].rootCellId).toBe("en");
    expectMatricesClose(results[0].renderFromRootMatrix, results[1].renderFromRootMatrix);
  });

  it("does not re-root an eye inside the cell", () => {
    const world = compileCellComplex(chainWorld(0));
    const eye = camera(0.5, 0.5);
    const result = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "c", anchorPoint: { x: 0.8, y: 0.8, z: 0 }, camera: eye });

    expect(result.rootCellId).toBe("c");
    expect(result.camera).toBe(eye);
    expectMatricesClose(result.renderFromRootMatrix, new THREE.Matrix4());
    expect(result.renderFromRootMatrix).toBe(identityRenderFromRootMatrix);
  });

  it("reuses a persistent target's camera and matrix, matching the result without one", () => {
    const world = compileCellComplex(chainWorld(0));
    const anchorPoint = { x: 0.8, y: 0.8, z: 0 };
    const eye = camera(1.1, 1.05);
    const target = createXrPortalEyeRenderRootTarget();
    const plain = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "c", anchorPoint, camera: eye });
    const first = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "c", anchorPoint, camera: eye, target });
    const second = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "c", anchorPoint, camera: eye, target });

    expect(first.rootCellId).toBe("en");
    expect(second.camera).toBe(target.camera);
    expect(second.camera).toBe(first.camera);
    expect(second.camera).not.toBe(eye);
    expect(second.renderFromRootMatrix).toBe(target.renderFromRootMatrix);
    expectMatricesClose(second.renderFromRootMatrix, plain.renderFromRootMatrix);
    expectMatricesClose(second.camera.matrixWorld, plain.camera.matrixWorld);
    expectMatricesClose(second.camera.projectionMatrix, plain.camera.projectionMatrix);
  });

  it("does not re-root an eye behind a wall", () => {
    const world = compileCellComplex(chainWorld(0));
    const eye = camera(0.5, -1.4);
    const result = resolveXrPortalEyeRenderRoot({ world, sourceCellId: "c", anchorPoint: { x: 0.5, y: 0.5, z: 0 }, camera: eye });

    expect(result.rootCellId).toBe("c");
    expect(result.camera).toBe(eye);
  });
});

function expectMatricesClose(a: THREE.Matrix4, b: THREE.Matrix4): void {
  a.elements.forEach((value, index) => expect(Math.abs(value - b.elements[index])).toBeLessThan(1e-9));
}
