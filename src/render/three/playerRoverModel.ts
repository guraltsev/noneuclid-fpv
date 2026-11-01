/**
 * Render model for the player's own rover avatar.
 *
 * Instantiates the rover glTF from prepared assets, exposes its meshes as instancing sources, and
 * describes where the avatar stands for the player pose: the object (cell and cell-local pose, x right,
 * y forward, z up, meters, yaw about +z) and the record flags (hidden when the camera is within 2 m, so
 * the avatar does not obstruct the first-person view, and not drawn in the root cell itself). The instance
 * sync turns that into render records through the one portal-ghost mechanism, like every other drawn part,
 * so the avatar is also drawn on the far side of a portal it stands at.
 */
import * as THREE from "three";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import type { PlayerPose } from "../../movement/playerPose";
import type { PreparedWorldAssets } from "./preparedWorldAssets";
import type { PortalGhostRecordFlags, PortalGhostRenderableObject } from "./runtimeObjectGhostRecords";
import {
  collectRuntimeObjectRenderSourceMeshes,
  type RuntimeObjectRenderSourceMesh,
} from "./runtimeObjectRenderRecords";
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
  /** The archetype-key prefix of the rover's meshes (their keys are `<prefix>:mesh:<n>`); names the group a footprint is measured over. */
  readonly archetypeKeyPrefix: string;
  /** The rover as a placed object at `playerPose`: its id, cell and cell-local pose (yaw about +z at the feet position). */
  placement(playerPose: PlayerPose): PortalGhostRenderableObject;
  /** The record flags of every rover record, ghosts included: hidden near a camera, and not drawn in the root cell's own path. */
  readonly recordFlags: PortalGhostRecordFlags;
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
    archetypeKeyPrefix: playerRoverArchetypePrefix,
    placement(playerPose) {
      return {
        id: playerRoverObjectId,
        cellId: playerPose.cellId,
        // Yaw about world +z at the player position; the record matrix adds the world-to-Three basis change.
        localPose: yawRigidTransform3(playerPose.yawRadians, playerPose.position),
      };
    },
    // Avatar meshes are rendered via instancing records only; the root's own visibility path is skipped.
    recordFlags: {
      omitRootVisiblePath: true,
      suppressWithinCameraDistanceMeters: playerRoverCameraSuppressionDistanceMeters,
    },
  };
}
