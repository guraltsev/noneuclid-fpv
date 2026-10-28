import { describe, expect, it } from "vitest";
import {
  applyJoystickDeadZone,
  computeContinuousTurn,
  computeJoystickLocomotion,
  computePhysicalRoomScaleDisplacement,
} from "../../src/render/three/vrLocomotion";
import {
  globalHorizontalDeltaToPlayerLocal,
  createXrPlayerRig,
  headYawRadiansFromViewerPose,
  resolveSharedXrRenderRootCellId,
  rotateHorizontalDelta,
  xrRigidTransformLocalMatrix,
} from "../../src/render/three/xrPlayerRig";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { movePlayer, type MoveResult } from "../../src/movement/movePlayer";
import { resolveXrPortalEyeRenderRoot } from "../../src/render/three/xrPortalEye";
import { worldPointToThree } from "../../src/render/three/worldAxes";

describe("VR locomotion mapping", () => {
  it("dead-zones small stick noise", () => {
    expect(applyJoystickDeadZone({ x: 0.05, y: -0.05 }, 0.18)).toEqual({ x: 0, y: 0 });
    expect(computeJoystickLocomotion({ x: 0.05, y: -0.05 }, 1).localDisplacement).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("uses joystick Y for forward locomotion without strafing", () => {
    const frame = computeJoystickLocomotion({ x: 1, y: -1 }, 1, {
      moveSpeedMetersPerSecond: 1.5,
    });

    expect(frame.localDisplacement.x).toBe(0);
    expect(frame.localDisplacement.y).toBeCloseTo(1.5);
  });

  it("does not drift forward from turn-only joystick input", () => {
    expect(computeJoystickLocomotion({ x: 1, y: 0.1 }, 1, {
      joystickDeadZone: 0.18,
    }).localDisplacement).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("returns zero displacement when axes are missing", () => {
    expect(computeJoystickLocomotion(undefined, 1).localDisplacement).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("maps continuous rotation from a turn axis without changing pitch", () => {
    expect(computeContinuousTurn(0.5, 2, { turnSpeedRadiansPerSecond: 1 })).toBeCloseTo(-1);
  });

  it("dead-zones continuous rotation", () => {
    expect(computeContinuousTurn(0.1, 2, { joystickDeadZone: 0.18 })).toBe(0);
  });

  it("keeps large physical tracking jumps at the previous accepted pose", () => {
    const result = computePhysicalRoomScaleDisplacement({
      previousHeadLocalMeters: { x: 0, y: 0, z: 1.6 },
      currentHeadLocalMeters: { x: 5, y: 0, z: 1.6 },
      maxPhysicalStepMeters: 0.75,
    });

    expect(result.ignoredTrackingJump).toBe(true);
    expect(result.localDisplacement).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.nextAcceptedHeadLocalMeters).toEqual({ x: 0, y: 0, z: 1.6 });
  });

  it("uses one shared first-pass XR render root cell", () => {
    expect(
      resolveSharedXrRenderRootCellId({
        cellId: "room-a",
        position: { x: 0, y: 0, z: 0 },
        yawRadians: 0,
        pitchRadians: 0,
      }),
    ).toBe("room-a");
  });

  it("resolves XR portal render roots independently per eye", async () => {
    const THREE = await import("three");
    const world = compileCellComplex(twoRoomsWithPortal());
    const sourceEye = createCamera(THREE, { x: 0.99, y: 0, z: 1.6 });
    const targetEye = createCamera(THREE, { x: 1.01, y: 0, z: 1.6 });

    expect(
      resolveXrPortalEyeRenderRoot({
        world,
        sourceCellId: "room-a",
        camera: sourceEye,
      }).rootCellId,
    ).toBe("room-a");
    expect(
      resolveXrPortalEyeRenderRoot({
        world,
        sourceCellId: "room-a",
        camera: targetEye,
      }).rootCellId,
    ).toBe("room-b");
  });

  it("converts room-scale world deltas back to player-local movement after artificial yaw", () => {
    const local = globalHorizontalDeltaToPlayerLocal({ x: 1, y: 0, z: 0 }, -Math.PI / 2);

    expect(local.x).toBeCloseTo(0);
    expect(local.y).toBeCloseTo(1);
    expect(local.z).toBe(0);
  });

  it("rotates room-scale headset deltas through artificial yaw", async () => {
    const THREE = await import("three");
    const rig = createXrPlayerRig(new THREE.PerspectiveCamera());
    const accepted: MoveResult = {
      kind: "moved",
      pose: {
        cellId: "room-b",
        position: { x: 0, y: 0, z: 0 },
        yawRadians: Math.PI,
        pitchRadians: 0,
      },
      attemptedDisplacement: { x: 0, y: 0, z: 0 },
      blocked: false,
      crossedPortal: false,
    };

    rig.acceptPhysicalMove(accepted, { x: 0, y: 0, z: 1.6 });
    const physicalFrame = rig.consumePhysicalInput({ x: 0, y: 0.2, z: 1.6 }, Math.PI, Math.PI);
    const moved = movePlayer({
      pose: accepted.pose,
      localDisplacement: physicalFrame.localDisplacement,
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(physicalFrame.localDisplacement.y).toBeCloseTo(0.2);
    expect(moved.pose.position.x).toBeCloseTo(0);
    expect(moved.pose.position.y).toBeCloseTo(-0.2);
  });

  it("uses the current artificial yaw when converting a physical sidestep", async () => {
    const THREE = await import("three");
    const rig = createXrPlayerRig(new THREE.PerspectiveCamera());
    const accepted: MoveResult = {
      kind: "moved",
      pose: {
        cellId: "room-a",
        position: { x: 0, y: 0, z: 0 },
        yawRadians: -Math.PI / 2,
        pitchRadians: 0,
      },
      attemptedDisplacement: { x: 0, y: 0, z: 0 },
      blocked: false,
      crossedPortal: false,
    };

    rig.acceptPhysicalMove(accepted, { x: 0, y: 0, z: 1.6 });
    const physicalFrame = rig.consumePhysicalInput({ x: 0, y: 0.2, z: 1.6 }, -Math.PI / 2, -Math.PI / 2);
    const moved = movePlayer({
      pose: accepted.pose,
      localDisplacement: physicalFrame.localDisplacement,
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      coordinateFrame: "global",
    });

    expect(moved.pose.position.x).toBeCloseTo(0.2);
    expect(moved.pose.position.y).toBeCloseTo(0);
  });

  it("maps tracking-space physical deltas into cell space with the XR reference yaw", () => {
    const worldDelta = rotateHorizontalDelta({ x: 0, y: 0.2, z: 0 }, Math.PI);

    expect(worldDelta.x).toBeCloseTo(0);
    expect(worldDelta.y).toBeCloseTo(-0.2);
  });

  it("builds XR view matrices that survive Three camera matrix updates", async () => {
    const THREE = await import("three");
    const camera = new THREE.Camera();
    const matrix = xrRigidTransformLocalMatrix({
      position: { x: 1, y: 2, z: 3, w: 1 } as DOMPointReadOnly,
      orientation: { x: 0, y: 0, z: 0, w: 1 } as DOMPointReadOnly,
    });

    camera.matrixAutoUpdate = false;
    camera.matrix.copy(matrix);
    camera.matrixWorld.copy(matrix);
    camera.updateMatrixWorld(true);

    expect(camera.matrixWorld.elements).toEqual(matrix.elements);
  });

  it("extracts headset yaw so player movement can follow the viewed direction", async () => {
    const THREE = await import("three");
    const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    const yawRadians = headYawRadiansFromViewerPose(
      viewerPose({
        orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
      }),
    );

    expect(yawRadians).toBeCloseTo(-Math.PI / 2);
  });

  it("keeps the XR rig camera yaw aligned with the player without double-applying headset yaw", async () => {
    const THREE = await import("three");
    const rig = createXrPlayerRig(new THREE.PerspectiveCamera());

    rig.syncXrRig(
      {
        cellId: "room-a",
        position: { x: 0, y: 0, z: 0 },
        yawRadians: -Math.PI / 2,
        pitchRadians: 0,
      },
      { x: 0, y: 0, z: 1.6 },
      -Math.PI / 2,
    );

    expect(rig.root.rotation.y).toBeCloseTo(0);
  });

  it("lets vertical headset motion raise the XR culling camera", async () => {
    const THREE = await import("three");
    const rig = createXrPlayerRig(new THREE.PerspectiveCamera());
    const cullingCamera = new THREE.PerspectiveCamera();

    rig.syncXrRig(
      {
        cellId: "room-a",
        position: { x: 0, y: 0, z: 0 },
        yawRadians: 0,
        pitchRadians: 0,
      },
      { x: 0, y: 0, z: 1.9 },
      0,
    );
    rig.syncXrCullingCamera(cullingCamera, viewerPose({ position: { x: 0, y: 1.9, z: 0 } }));

    expect(cullingCamera.position.y).toBeCloseTo(1.9);
  });
});

function viewerPose(options: {
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly orientation?: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
} = {}): XRViewerPose {
  const position = options.position ?? { x: 0, y: 1.6, z: 0 };
  const orientation = options.orientation ?? { x: 0, y: 0, z: 0, w: 1 };

  return {
    transform: {
      position: { ...position, w: 1 } as DOMPointReadOnly,
      orientation: { ...orientation } as DOMPointReadOnly,
    },
    views: [],
  } as unknown as XRViewerPose;
}

function createCamera(
  THREE: typeof import("three"),
  position: { readonly x: number; readonly y: number; readonly z: number },
): import("three").PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.001, 250);
  camera.position.copy(worldPointToThree(position));
  camera.lookAt(worldPointToThree({ x: position.x + 1, y: position.y, z: position.z }));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function twoRoomsWithPortal() {
  const squareRoomBase = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];

  return {
    cells: [
      {
        id: "room-a",
        heightMeters: 3,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "east",
            sideIndex: 1,
            targetCellId: "room-b",
            targetPortalId: "west",
          },
        ],
      },
      {
        id: "room-b",
        heightMeters: 3,
        baseVertices: squareRoomBase,
        portals: [
          {
            id: "west",
            sideIndex: 3,
            targetCellId: "room-a",
            targetPortalId: "east",
          },
        ],
      },
    ],
  };
}
