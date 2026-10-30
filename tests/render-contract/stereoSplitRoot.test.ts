import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { deriveCellRenderArchetypeCapacities } from "../../src/render/three/cellRenderArchetypes";
import {
  createPortalClipData,
  portalClipEpsilonMeters,
  portalClipPlaneTexelIndex,
  portalClipPlaneTextureWidth,
} from "../../src/render/three/portalClipData";
import { countStereoPortalPaths } from "../../src/render/three/portalEyeFrameTransforms";
import { resolvePortalInstanceClipIndex } from "../../src/render/three/renderPortalInstances";
import { buildStereoPortalFrame } from "../../src/render/three/stereoPortalFrame";
import type { VisiblePortalPathOptions } from "../../src/render/three/visiblePortalPaths";
import { threePointToWorld, worldPointToThree } from "../../src/render/three/worldAxes";
import { resolveXrPortalEyeRenderRoot, type XrPortalEyeRenderRoot } from "../../src/render/three/xrPortalEye";

const world = compileCellComplex(torusModuli);
const staticCull = buildStaticallyCulledPortalPathTables(world, {
  maxDepth: 4,
  skipImmediateReverse: true,
  toleranceMeters: 1e-6,
  maxKeptPathsPerRoot: 50_000,
});
const options: VisiblePortalPathOptions = {
  maxDepth: 4,
  maxVisiblePaths: 2000,
  minPortalScreenAreaPixels: 16,
  includeRootCell: true,
  sortMode: "depth-then-area",
};
const viewportPixels = { width: 1000, height: 1000 };

// Eye roots of a head at `head` with the player anchored at `anchor`; the eyes sit half an IPD to either side along x.
function buildFrame(anchor: { x: number; y: number }, head: { x: number; y: number; z: number }) {
  const eyeX = [head.x - 0.032, head.x + 0.032];
  const roots: XrPortalEyeRenderRoot[] = eyeX.map((x) => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);

    camera.position.copy(worldPointToThree({ x, y: head.y, z: head.z }));
    camera.lookAt(worldPointToThree({ x, y: head.y + 1, z: head.z }));
    camera.updateMatrixWorld(true);

    return resolveXrPortalEyeRenderRoot({
      world,
      sourceCellId: "torus-room",
      anchorPoint: { x: anchor.x, y: anchor.y, z: 0 },
      camera,
    });
  });
  const frame = buildStereoPortalFrame({ world, staticCull, renderRoots: roots, viewportPixels, options })!;
  const clipData = createPortalClipData({ maxVisiblePaths: 2000 });

  clipData.updateStereo(frame.eyeStates.map((state) => state.result.paths));

  return { roots, frame, clipData };
}

// Whether the sample point passes the four planes of (slot, eye), as the shader's inside test does.
function acceptsPoint(
  clipData: ReturnType<typeof createPortalClipData>,
  slot: number,
  eye: number,
  point: THREE.Vector3,
): boolean {
  const data = clipData.texture.image.data as unknown as Float32Array;

  for (let plane = 0; plane < 4; plane += 1) {
    const texel = portalClipPlaneTexelIndex(slot, eye, plane, 2);
    const offset = ((Math.floor(texel / portalClipPlaneTextureWidth)) * portalClipPlaneTextureWidth + (texel % portalClipPlaneTextureWidth)) * 4;

    if (data[offset] * point.x + data[offset + 1] * point.y + data[offset + 2] * point.z + data[offset + 3] < -portalClipEpsilonMeters) {
      return false;
    }
  }

  return true;
}

const samplePoints: THREE.Vector3[] = [];

for (let ix = -2; ix <= 2; ix += 1) {
  for (let iy = -2; iy <= 2; iy += 1) {
    for (let iz = -2; iz <= 2; iz += 1) {
      samplePoints.push(new THREE.Vector3(ix * 3, iy * 3, iz * 3));
    }
  }
}

describe("stereo rendering with split eye roots", () => {
  const { roots, frame, clipData } = buildFrame({ x: 7.3, y: 0 }, { x: 7.5, y: 0, z: 1.6 });

  it("treats the same cell at a different frame as a split root", () => {
    expect(roots.map((root) => root.rootCellId)).toEqual(["torus-room", "torus-room"]);

    const origin = threePointToWorld(new THREE.Vector3().applyMatrix4(roots[1].renderFromRootMatrix));

    expect(origin.x).toBeCloseTo(15, 9);
    expect(origin.y).toBeCloseTo(0, 9);
    expect(origin.z).toBeCloseTo(0, 9);
    expect(frame.splitRoots).toBe(true);
    expect(frame.rootGroupByEye).toEqual([0, 1]);
  });

  it("gives each eye's root its own clip slot instead of the unclipped sentinel", () => {
    for (const state of frame.eyeStates) {
      const root = state.result.paths.find((path) => path.depth === 0)!;
      const index = resolvePortalInstanceClipIndex(root, clipData.clipIndexByPathId, false);

      expect(index).toBe(clipData.clipIndexByPathId.get(root.pathId));
      expect(index).toBeGreaterThanOrEqual(0);
    }
  });

  it("accepts each root only in its own eye", () => {
    const rootIds = frame.eyeStates.map((state) => state.result.paths.find((path) => path.depth === 0)!.pathId);

    expect(rootIds[0]).not.toBe(rootIds[1]);

    for (let owner = 0; owner < 2; owner += 1) {
      const other = 1 - owner;
      const slot = clipData.clipIndexByPathId.get(rootIds[owner])!;

      expect(samplePoints.filter((point) => acceptsPoint(clipData, slot, other, point))).toHaveLength(0);
      expect(samplePoints.filter((point) => acceptsPoint(clipData, slot, owner, point))).toHaveLength(samplePoints.length);
    }
  });

  it("counts left-only, right-only and shared cell copies by placement", () => {
    const counts = countStereoPortalPaths(frame.eyeStates, clipData.acceptedPathIds, frame.splitRoots)!;
    const placements = new Set<string>();

    for (const state of frame.eyeStates) {
      for (const path of state.result.paths) {
        const e = path.rootFromDestinationMatrix.elements;
        const r = (value: number) => Math.round(value * 1e4);

        placements.add(`${path.destinationCellId}|${r(e[12])},${r(e[13])},${r(e[14])}|${r(e[0])},${r(e[1])},${r(e[2])}`);
      }
    }

    expect(counts.splitRoots).toBe(true);
    expect(counts.bothEyesPathCount).toBeGreaterThanOrEqual(1);
    expect(counts.leftOnlyPathCount + counts.rightOnlyPathCount + counts.bothEyesPathCount).toBe(placements.size);
    expect(counts.droppedLeftPathCount).toBe(0);
    expect(counts.droppedRightPathCount).toBe(0);
  });

  it("keeps the accepted paths to every cell within the two-eye archetype capacity", () => {
    const capacities = deriveCellRenderArchetypeCapacities(world, staticCull, 2000, 2);
    const countByCell = new Map<string, number>();

    for (const path of clipData.rankedAcceptedPaths) {
      countByCell.set(path.destinationCellId, (countByCell.get(path.destinationCellId) ?? 0) + 1);
    }

    for (const [cellId, count] of countByCell) {
      expect(count).toBeLessThanOrEqual(capacities.get(cellId)!);
    }
  });

  it("keeps the unclipped root when both eyes share one root", () => {
    const shared = buildFrame({ x: 0, y: 0 }, { x: 0, y: 0, z: 1.6 });

    expect(shared.frame.splitRoots).toBe(false);
    expect(shared.frame.rootGroupByEye).toEqual([0, 0]);

    const root = shared.frame.eyeStates[0].result.paths.find((path) => path.depth === 0)!;

    expect(resolvePortalInstanceClipIndex(root, shared.clipData.clipIndexByPathId, true)).toBe(-2);
  });
});
