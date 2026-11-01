/**
 * Aim interaction (src/render/three/aimInteraction.ts): `createAimInteraction` caches one aim-target resolution per
 * distinct ray, ignored-geodesic set and frame serial, invalidated explicitly or by a new frame. The resolution itself
 * is covered in `tests/interaction/aimTarget.test.ts`; its outcome here is observed directly (a stale result until
 * invalidated) rather than through resolver call counts.
 */
import * as THREE from "three";
import { createTestAppSession } from "../support/appSession";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import { yawRigidTransform3 } from "../../src/math/rigidTransform3";
import { createAimInteraction } from "../../src/render/three/aimInteraction";
import { worldPointToThree } from "../../src/render/three/worldAxes";
import type { GeodesicSegmentObject } from "../../src/world-objects/geodesic/objects";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";

describe("createAimInteraction", () => {
  it("keeps a resolution for the same ray and frame until invalidated or the frame advances", () => {
    const world = compileCellComplex(rayWalkWorld());
    const segment = createGeodesicSegment({ cellId: "room-a", start: { x: 0, y: 0, z: 1.08 } });
    const registry = createRuntimeObjectRegistry([segment]);
    let frameSerial = 1;
    const interaction = createAimInteraction({
      camera: new THREE.PerspectiveCamera(),
      renderer: {} as THREE.WebGLRenderer,
      xrRig: {} as never,
      runtimeObjectRegistry: registry,
      getWorld: () => world,
      session: createTestAppSession({
        playerPose: { cellId: "room-a", position: { x: 0, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 },
      }),
      getFrameSerial: () => frameSerial,
    });
    const camera = cameraLookingAt({ x: 0, y: -0.5, z: 1.08 }, { x: 0, y: 0, z: 1.08 });
    const ray = {
      origin: camera.position.clone(),
      direction: new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
      quaternion: camera.quaternion.clone(),
    };

    expect(interaction.resolveCurrentAimTarget(ray)?.object?.id).toBe("segment-a");

    registry.remove("segment-a");
    expect(interaction.resolveCurrentAimTarget(ray)?.object?.id).toBe("segment-a");

    interaction.invalidateAimCache();
    expect(interaction.resolveCurrentAimTarget(ray)).toBeUndefined();

    registry.add(segment);
    expect(interaction.resolveCurrentAimTarget(ray)).toBeUndefined();

    frameSerial = 2;
    expect(interaction.resolveCurrentAimTarget(ray)?.object?.id).toBe("segment-a");
  });
});

// room-a (north, south, west walls; east portal) glued to room-b (west portal), both 2 m by 2 m; room-b sits at x = 2 in room-a's frame.
function rayWalkWorld(): CellComplexSpec {
  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 2,
        baseVertices: squareBase(),
        portals: [{ id: "east", sideIndex: 1, targetCellId: "room-b", targetPortalId: "west" }],
      },
      {
        id: "room-b",
        heightMeters: 2,
        baseVertices: squareBase(),
        portals: [{ id: "west", sideIndex: 3, targetCellId: "room-a", targetPortalId: "east" }],
      },
    ],
  };
}

function cameraLookingAt(
  position: { readonly x: number; readonly y: number; readonly z: number },
  target: { readonly x: number; readonly y: number; readonly z: number },
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 100);
  camera.position.copy(worldPointToThree(position));
  camera.lookAt(worldPointToThree(target));
  camera.updateMatrixWorld(true);
  return camera;
}

function squareBase(): readonly { readonly x: number; readonly y: number }[] {
  return [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
}

function createGeodesicSegment(overrides: Partial<GeodesicSegmentObject> = {}): GeodesicSegmentObject {
  return {
    id: "segment-a",
    kind: "geodesic-segment",
    cellId: "room",
    localPose: yawRigidTransform3(0, { x: -0.5, y: 0, z: 1.08 }),
    portalRenderable: true,
    tooltip: {
      label: "Geodesic",
      rangeMeters: 6,
    },
    geodesicId: "g-a",
    segmentIndex: 0,
    start: { x: -0.5, y: 0, z: 1.08 },
    direction: { x: 1, y: 0, z: 0 },
    lengthMeters: 1,
    terminal: { kind: "open" },
    ...overrides,
  };
}
