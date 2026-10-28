/**
 * Maps the WebXR viewer pose onto the game's `PlayerPose` and back: the XR player rig.
 * The rig is a Three.js group parenting the camera. The logical player (cell id, x/y/z position, yaw) is authoritative;
 * each XR frame the rig is rotated and translated so the tracked head lands on the player's horizontal position,
 * with the head's own height (head z, meters) added to the pose z. Physical head movement is converted into a player-local horizontal displacement
 * that goes through normal collision, so walking in the room moves the player through the cell complex.
 * Frames: XR reference space and Three.js are y-up with -z forward; the game world is cell-local x right, y forward, z up
 * (see worldAxes). Yaw is radians, counter-clockwise seen from above; head vectors named `...LocalMeters` are in game-world axes.
 */
import * as THREE from "three";
import type { MoveResult } from "../../movement/movePlayer";
import { DEFAULT_PLAYER_EYE_HEIGHT_METERS } from "../../movement/playerBody";
import type { PlayerPose } from "../../movement/playerPose";
import { vec3, type Vec3 } from "../../math/vec3";
import type { RuntimeInputFrame } from "./renderState";
import { computePhysicalRoomScaleDisplacement } from "./vrLocomotion";
import { worldPointToThree } from "./worldAxes";
import { defaultVrComfortOptions, type VrComfortOptions } from "./vrComfort";

/**
 * Rig controlling the Three.js camera pose in desktop and XR modes and extracting physical motion from the headset.
 */
export interface XrPlayerRig {
  /** Group that parents the camera; `matrixWorld` is the reference-space-to-world transform used for controllers and hands. Added to the scene by the owner. */
  readonly root: THREE.Group;
  /** Clears accepted head tracking and returns root and camera to identity; call when an XR session ends or the app resets. */
  reset(): void;
  /**
   * Places the camera at the player's eye (pose position plus default eye height) looking along yaw/pitch, with the rig at identity.
   * Used when not presenting in XR.
   */
  syncDesktopCamera(pose: PlayerPose): void;
  /**
   * Positions the rig for XR so the head (given in game-world axes, meters; default straight above the origin at eye height) sits at the player's x/y,
   * with z equal to pose z plus the head height, and rotates the rig by `pose.yawRadians - headLocalYawRadians` so the head's facing matches the player yaw.
   * Call once per XR frame after movement is resolved.
   */
  syncXrRig(pose: PlayerPose, headLocalMeters?: Vec3, headLocalYawRadians?: number): void;
  /**
   * Sets `camera` to the head transform (rig world matrix times viewer pose; a default eye-height pose when `viewerPose` is undefined) for portal culling.
   * Only position/orientation are written; projection is not changed.
   */
  syncXrCullingCamera(camera: THREE.PerspectiveCamera, viewerPose: XRViewerPose | undefined): void;
  /**
   * Configures one culling camera per XR view (up to `cameras.length`) with that view's world transform and projection matrix, and returns the configured cameras.
   * Returns an empty array when `viewerPose` is undefined. The cameras get `matrixAutoUpdate = false`.
   */
  syncXrViewCullingCameras(cameras: readonly THREE.Camera[], viewerPose: XRViewerPose | undefined): readonly THREE.Camera[];
  /** Returns the current world yaw (radians) of the headset: rig yaw plus the head's yaw in the reference space. */
  resolveCameraYawRadians(headLocalYawRadians?: number): number;
  /**
   * Turns head motion since the last accepted position into an input frame.
   * `headLocalMeters` is the current head position in reference-space game axes (undefined yields zero motion); `playerYawRadians` is the logical player yaw;
   * `referenceSpaceYawRadians` (defaults to the rig yaw) rotates the horizontal head delta into world axes before converting it to player-local axes.
   * Head motion larger than `maxPhysicalStepMeters` in one frame is treated as a tracking jump and ignored. Only horizontal motion is used (z is dropped).
   * The returned frame has source "xr", no yaw/pitch, and no action requests.
   */
  consumePhysicalInput(
    headLocalMeters: Vec3 | undefined,
    playerYawRadians: number,
    referenceSpaceYawRadians?: number,
  ): RuntimeInputFrame;
  /**
   * Records `currentHeadLocalMeters` as the new reference for the next `consumePhysicalInput` unless collision blocked the move.
   * Leaving the reference unchanged on a blocked move makes the head keep "pushing" against the obstacle until it returns.
   */
  acceptPhysicalMove(result: MoveResult, currentHeadLocalMeters?: Vec3): void;
  /** Cell id from which both eyes are rendered; currently the player's own cell. */
  getSharedRenderRootCellId(pose: PlayerPose): string;
}

/**
 * Creates the rig and reparents `camera` under a new group (`root`) named "xr-player-rig"; the caller must add `root` to the scene (createThreeApp#shell does).
 * `options` supplies `maxPhysicalStepMeters`. The rig owns no GPU resources; dispose is the caller's removal of `root`.
 */
export function createXrPlayerRig(camera: THREE.PerspectiveCamera, options: Partial<VrComfortOptions> = {}): XrPlayerRig {
  const comfort = { ...defaultVrComfortOptions, ...options };
  const root = new THREE.Group();
  root.name = "xr-player-rig";
  root.add(camera);
  let previousAcceptedHeadLocalMeters: Vec3 | undefined;

  return {
    root,
    reset() {
      previousAcceptedHeadLocalMeters = undefined;
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    },
    syncDesktopCamera(pose) {
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      const eyePosition = {
        x: pose.position.x,
        y: pose.position.y,
        z: pose.position.z + DEFAULT_PLAYER_EYE_HEIGHT_METERS,
      };
      const forward = {
        x: -Math.sin(pose.yawRadians) * Math.cos(pose.pitchRadians),
        y: Math.cos(pose.yawRadians) * Math.cos(pose.pitchRadians),
        z: Math.sin(pose.pitchRadians),
      };
      camera.position.copy(worldPointToThree(eyePosition));
      camera.up.set(0, 1, 0);
      camera.lookAt(worldPointToThree({
        x: eyePosition.x + forward.x,
        y: eyePosition.y + forward.y,
        z: eyePosition.z + forward.z,
      }));
    },
    // Build the rig so that root * headThree == playerEye: rotate first, then solve for the translation.
    syncXrRig(pose, headLocalMeters, headLocalYawRadians = 0) {
      const head = headLocalMeters ?? vec3(0, 0, DEFAULT_PLAYER_EYE_HEIGHT_METERS);
      const headThree = worldPointToThree(head);
      const playerEye = worldPointToThree({
        x: pose.position.x,
        y: pose.position.y,
        z: pose.position.z + head.z,
      });
      root.rotation.set(0, pose.yawRadians - headLocalYawRadians, 0);
      camera.position.copy(headThree);
      camera.rotation.set(0, 0, 0);
      root.updateMatrixWorld(true);
      const rotatedHead = headThree.clone().applyQuaternion(root.quaternion);
      root.position.set(playerEye.x - rotatedHead.x, playerEye.y - rotatedHead.y, playerEye.z - rotatedHead.z);
      root.updateMatrixWorld(true);
    },
    syncXrCullingCamera(cullingCamera, viewerPose) {
      root.updateMatrixWorld(true);
      const localMatrix = viewerPose
        ? viewerPoseLocalMatrix(viewerPose)
        : new THREE.Matrix4().compose(
            new THREE.Vector3(0, DEFAULT_PLAYER_EYE_HEIGHT_METERS, 0),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1),
          );
      const cullingWorldMatrix = root.matrixWorld.clone().multiply(localMatrix);

      cullingWorldMatrix.decompose(cullingCamera.position, cullingCamera.quaternion, cullingCamera.scale);
      cullingCamera.up.set(0, 1, 0);
      cullingCamera.updateMatrixWorld(true);
    },
    syncXrViewCullingCameras(cameras, viewerPose) {
      root.updateMatrixWorld(true);

      if (!viewerPose) {
        return [];
      }

      return viewerPose.views.slice(0, cameras.length).map((view, index) => {
        const cullingCamera = cameras[index];
        const cullingWorldMatrix = root.matrixWorld.clone().multiply(xrRigidTransformLocalMatrix(view.transform));

        cullingCamera.matrixAutoUpdate = false;
        cullingCamera.matrix.copy(cullingWorldMatrix);
        cullingCamera.matrixWorld.copy(cullingWorldMatrix);
        cullingCamera.matrixWorldInverse.copy(cullingWorldMatrix).invert();
        cullingCamera.matrixWorldNeedsUpdate = false;
        cullingWorldMatrix.decompose(cullingCamera.position, cullingCamera.quaternion, cullingCamera.scale);
        cullingCamera.projectionMatrix.fromArray(view.projectionMatrix);
        cullingCamera.projectionMatrixInverse.copy(cullingCamera.projectionMatrix).invert();
        return cullingCamera;
      });
    },
    resolveCameraYawRadians(headLocalYawRadians = 0) {
      return root.rotation.y + headLocalYawRadians;
    },
    consumePhysicalInput(headLocalMeters, playerYawRadians, referenceSpaceYawRadians = root.rotation.y) {
      const physical = computePhysicalRoomScaleDisplacement({
        previousHeadLocalMeters: previousAcceptedHeadLocalMeters,
        currentHeadLocalMeters: headLocalMeters,
        maxPhysicalStepMeters: comfort.maxPhysicalStepMeters,
      });
      const worldDisplacement = rotateHorizontalDelta(physical.localDisplacement, referenceSpaceYawRadians);
      const localDisplacement = globalHorizontalDeltaToPlayerLocal(worldDisplacement, playerYawRadians);

      return {
        localDisplacement,
        yawDeltaRadians: 0,
        pitchDeltaRadians: 0,
        resetRequested: false,
        primaryActionRequested: false,
        interactRequested: false,
        carryActionRequested: false,
        helpRequested: false,
        source: "xr",
      };
    },
    acceptPhysicalMove(result, currentHeadLocalMeters) {
      if (!currentHeadLocalMeters) {
        return;
      }

      if (!result.blocked) {
        previousAcceptedHeadLocalMeters = currentHeadLocalMeters;
      }
    },
    getSharedRenderRootCellId(pose) {
      return resolveSharedXrRenderRootCellId(pose);
    },
  };
}

/**
 * Returns the cell id used as the single render root for both XR eyes (the player's cell).
 */
export function resolveSharedXrRenderRootCellId(pose: PlayerPose): string {
  return pose.cellId;
}

/**
 * Rotates a world-axes displacement by -yaw into the player-local frame (x right, y forward); z passes through. Inverse of `rotateHorizontalDelta`.
 */
export function globalHorizontalDeltaToPlayerLocal(delta: Vec3, yawRadians: number): Vec3 {
  const sinYaw = Math.sin(yawRadians);
  const cosYaw = Math.cos(yawRadians);

  return vec3(
    cosYaw * delta.x + sinYaw * delta.y,
    -sinYaw * delta.x + cosYaw * delta.y,
    delta.z,
  );
}

/**
 * Rotates a displacement counter-clockwise by `yawRadians` about the z axis (radians, meters); z passes through.
 */
export function rotateHorizontalDelta(delta: Vec3, yawRadians: number): Vec3 {
  const sinYaw = Math.sin(yawRadians);
  const cosYaw = Math.cos(yawRadians);

  return vec3(
    cosYaw * delta.x - sinYaw * delta.y,
    sinYaw * delta.x + cosYaw * delta.y,
    delta.z,
  );
}

/**
 * Converts the viewer pose position from XR/Three axes to game-world axes (x, -z, y) in meters; `undefined` if no pose.
 */
export function headLocalMetersFromViewerPose(pose: XRViewerPose | undefined): Vec3 | undefined {
  if (!pose) {
    return undefined;
  }

  const position = pose.transform.position;

  return vec3(position.x, -position.z, position.y);
}

/**
 * Extracts the head's heading about the vertical axis in radians (0 when looking along -z of the reference space; counter-clockwise positive); `undefined` if no pose.
 * Pitch and roll are ignored by projecting the forward vector onto the horizontal plane (undefined behavior when looking straight up or down).
 */
export function headYawRadiansFromViewerPose(pose: XRViewerPose | undefined): number | undefined {
  if (!pose) {
    return undefined;
  }

  const orientation = pose.transform.orientation;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
  );

  return Math.atan2(-forward.x, -forward.z);
}

/**
 * Returns the viewer pose transform as a Three.js matrix in reference-space coordinates (unit scale).
 */
export function viewerPoseLocalMatrix(pose: XRViewerPose): THREE.Matrix4 {
  return xrRigidTransformLocalMatrix(pose.transform);
}

/**
 * Builds a Three.js matrix (unit scale) from an XR rigid transform's position (meters) and orientation quaternion.
 */
export function xrRigidTransformLocalMatrix(transform: Pick<XRRigidTransform, "position" | "orientation">): THREE.Matrix4 {
  const position = transform.position;
  const orientation = transform.orientation;

  return new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
    new THREE.Vector3(1, 1, 1),
  );
}
