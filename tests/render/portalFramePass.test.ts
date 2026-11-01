/**
 * Contract of the portal pass (src/render/three/portalFramePass.ts) on the one-room torus world: a mono pass publishes a visibility
 * result and a frame snapshot of the player's cell and no per-eye state; a stereo pass from eyes whose roots split at the seam publishes
 * per-eye states and stereo path counts; `reset` and every later pass leave none of the stereo state behind. The renderer is the shared
 * fake, so no GPU is involved.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { torusModuli } from "../../src/authoring/exampleWorlds";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { buildStaticallyCulledPortalPathTables } from "../../src/cell-complex/staticPortalPathCull";
import { createDefaultPlayerPose } from "../../src/movement/playerPose";
import { createPortalClipData } from "../../src/render/three/portalClipData";
import { createPortalClipMaterialState } from "../../src/render/three/portalClipMaterial";
import { createPortalFramePass } from "../../src/render/three/portalFramePass";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import type { VisiblePortalPathOptions } from "../../src/visibility/visiblePortalPaths";
import { createTestAppSession } from "../support/appSession";
import { createFakeRenderer } from "../support/fakeRenderer";

const world = compileCellComplex(torusModuli);
const staticCull = buildStaticallyCulledPortalPathTables(world, {
  maxDepth: 4,
  skipImmediateReverse: true,
  toleranceMeters: 1e-6,
  maxKeptPathsPerRoot: 50_000,
});
const visiblePortalPathOptions: VisiblePortalPathOptions = {
  maxDepth: 4,
  maxVisiblePaths: 2000,
  minPortalScreenAreaPixels: 16,
  includeRootCell: true,
  sortMode: "depth-then-area",
};

function createPass() {
  const session = createTestAppSession({
    playerPose: { ...createDefaultPlayerPose("torus-room"), position: { x: 7.3, y: 0, z: 0 } },
  });
  const portalClipData = createPortalClipData({ maxVisiblePaths: 2000 });
  const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
  camera.position.copy(worldPointToThree({ x: 7.5, y: 0, z: 1.6 }));
  camera.lookAt(worldPointToThree({ x: 7.5, y: 1, z: 1.6 }));
  camera.updateMatrixWorld(true);
  const pass = createPortalFramePass({
    scene: new THREE.Scene(),
    camera,
    renderer: createFakeRenderer() as unknown as THREE.WebGLRenderer,
    session,
    visiblePortalPathOptions,
    getWorld: () => world,
    getStaticCull: () => staticCull,
    portalClipData,
    portalClipMaterialState: createPortalClipMaterialState(portalClipData, { hardwareClipDistances: false }),
    enablePortalClipDistances: vi.fn(),
    disablePortalClipDistances: vi.fn(),
  });
  return { pass, camera };
}

// Two eyes half an IPD to either side of the head, as an XR session reports them.
function eyeCameras(): THREE.PerspectiveCamera[] {
  return [7.5 - 0.032, 7.5 + 0.032].map((x) => {
    const eye = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    eye.position.copy(worldPointToThree({ x, y: 0, z: 1.6 }));
    eye.lookAt(worldPointToThree({ x, y: 1, z: 1.6 }));
    eye.updateMatrixWorld(true);
    return eye;
  });
}

describe("the portal pass", () => {
  it("publishes the player's cell and no eye state after a mono pass", () => {
    const { pass } = createPass();

    pass.syncPlayerCell(3);

    expect(pass.latestVisibleResult()?.paths.length).toBeGreaterThan(0);
    expect(pass.frameSnapshot(3).rootCellId).toBe("torus-room");
    expect(pass.eyeDebugStates()).toBeUndefined();
    expect(pass.stereoPathState()).toBeUndefined();
  });

  it("publishes one state per eye after a stereo pass", () => {
    const { pass } = createPass();

    pass.syncXr(eyeCameras(), 4);

    expect(pass.eyeDebugStates()?.map((state) => state.eyeIndex)).toEqual([0, 1]);
    expect(pass.stereoPathState()).toBeDefined();
    expect(pass.latestVisibleResult()).toBeDefined();
  });

  it("leaves no stereo state after reset", () => {
    const { pass } = createPass();
    pass.syncXr(eyeCameras(), 4);

    pass.reset();

    expect(pass.latestVisibleResult()).toBeUndefined();
    expect(pass.eyeDebugStates()).toBeUndefined();
    expect(pass.stereoPathState()).toBeUndefined();
  });

  it("leaves no stereo state when a mono pass follows a stereo pass", () => {
    const { pass } = createPass();
    pass.syncXr(eyeCameras(), 4);

    pass.syncDesktop(eyeCameras()[0], 5);

    expect(pass.eyeDebugStates()).toBeUndefined();
    expect(pass.stereoPathState()).toBeUndefined();
    expect(pass.frameSnapshot(5).rootCellId).toBe("torus-room");
  });
});
