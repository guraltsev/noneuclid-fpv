/**
 * Render model for the player's own rover avatar.
 *
 * Instantiates the rover glTF from prepared assets, exposes its meshes as instancing sources, and
 * produces per-frame render records placing the avatar at the player pose. The pose is expressed in the
 * player's cell-local world frame (x right, y forward, z up, meters, yaw about +z) and converted to a
 * Three.js matrix through `rigidTransformToThreeMatrix`. Records are flagged to be hidden when the
 * camera is within 2 m so the avatar does not obstruct the first-person view.
 */
import * as THREE from "three";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import type { PlayerPose } from "../../movement/playerPose";
import type { PreparedWorldAssets } from "./preloadWorldAssets";
import {
  collectRuntimeObjectRenderSourceMeshes,
  type RuntimeObjectRenderRecord,
  type RuntimeObjectRenderSourceMesh,
} from "./runtimeObjectRenderRecords";
import { rigidTransformToThreeMatrix } from "./worldAxes";
import { standardUserRobotObject } from "../../world-objects/library";

/** Asset path of the rover glTF (taken from the standard user robot object definition). */
export const playerRoverAssetPath = standardUserRobotObject.assetPath;

const playerRoverObjectId = standardUserRobotObject.id;
const playerRoverArchetypePrefix = `player-avatar:${playerRoverObjectId}`;
// Records are hidden when the camera is closer than this distance (meters) to avoid first-person clipping.
const playerRoverCameraSuppressionDistanceMeters = 2;

/** Handle for the player rover avatar: its source scene graph and a per-frame record generator. */
export interface PlayerRoverRenderModel {
  /** Group holding the rover model; its meshes are the instancing sources and must not be shown directly. */
  readonly root: THREE.Object3D;
  readonly objectId: string;
  /** Enumerates the rover's meshes as instancing sources, with archetype keys prefixed `player-avatar:<objectId>`. */
  collectSources(): readonly RuntimeObjectRenderSourceMesh[];
  /**
   * Returns one render record per rover mesh whose archetype key is in `archetypeKeys`, all sharing the pose matrix of `playerPose`.
   */
  collectRecords(
    playerPose: PlayerPose,
    archetypeKeys: Iterable<string>,
  ): readonly RuntimeObjectRenderRecord[];
}

/**
 * Creates the rover render model, or returns `undefined` if the rover glTF was not preloaded.
 *
 * The model is uniformly scaled by the robot definition's scale and turned by pi about Three.js y
 * (a half-turn correction between the asset's authored forward axis and the avatar's forward direction).
 */
export function createPlayerRoverRenderModel(
  assets: PreparedWorldAssets,
): PlayerRoverRenderModel | undefined {
  const prepared = assets.instantiateGltf(playerRoverAssetPath);

  if (!prepared) {
    return undefined;
  }

  const root = new THREE.Group();
  root.name = "player-rover-render-root";

  prepared.scene.name = "player-rover-model";
  prepared.scene.scale.setScalar(standardUserRobotObject.scale);
  prepared.scene.rotation.y = Math.PI;
  root.add(prepared.scene);

  return {
    root,
    objectId: playerRoverObjectId,
    collectSources() {
      return collectRuntimeObjectRenderSourceMeshes(
        playerRoverObjectId,
        root,
        playerRoverArchetypePrefix,
      );
    },
    collectRecords(playerPose, archetypeKeys) {
      // Pose to Three.js matrix: yaw about world +z at the player position, then world-to-Three basis change.
      const localMatrix = rigidTransformToThreeMatrix(
        yawRigidTransform3(playerPose.yawRadians, playerPose.position),
      );
      const matchingArchetypeKeys = [...archetypeKeys]
        .filter((key) => key.startsWith(`${playerRoverArchetypePrefix}:mesh:`));
      const baseRecords = matchingArchetypeKeys.map((archetypeKey) => ({
        objectId: playerRoverObjectId,
        cellId: playerPose.cellId,
        archetypeKey,
        localMatrix,
        // Avatar meshes are rendered via instancing records only; the root's own visibility path is skipped.
        omitRootVisiblePath: true,
        suppressWithinCameraDistanceMeters: playerRoverCameraSuppressionDistanceMeters,
      }));

      return baseRecords;
    },
  };
}
