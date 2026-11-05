/**
 * Keeps the floating geodesic-name labels next to nearby emitters in sync with the registry.
 *
 * Each frame, one billboard label ("G<number>") exists per (cannon, geodesic) pair in the runtime registry;
 * labels are shown only for cannons in the player's current cell within the label range (meters, measured
 * in the cell-local xy plane). Labels are created lazily, recreated when their text changes, and
 * removed and disposed when their cannon or geodesic disappears. The label map is owned by the caller.
 */
import { readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import type { ClientSession } from "../../runtime/clientSession";
import * as THREE from "three";
import { type CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { findNearestImageRoute } from "../../cell-complex/portalRoute";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
  type RigidTransform3,
} from "../../math/rigidTransform3";
import { getEmitterGeodesicIds } from "../../world-objects/geodesic/endpoints";
import { resolveGeodesicNumber } from "../../world-objects/geodesic/segments";
import { type RuntimeObjectReader, type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { threePointToWorld, worldPointToThree } from "./worldAxes";
import {
  createGeodesicEmitterLabel,
  geodesicEmitterLabelRangeMeters,
  getGeodesicEmitterLabelKey,
  resolveGeodesicEmitterLabelPosition,
} from "./geodesicEmitterLabels";
import { disposeObject3D } from "./runtimeSceneUtils";

// Most portals a straight line from the player to a labelled cannon may cross; the label range is a few meters.
const geodesicEmitterLabelMaxHops = 2;

/** One live label: the text it was drawn with and its scene object. */
export interface GeodesicEmitterLabel {
  /** Text baked into the label texture; a differing text triggers re-creation. */
  readonly text: string;
  /** Label mesh, a child of the scene while the entry exists. */
  readonly root: THREE.Object3D;
}

/** Dependencies of the label controller, supplied by createThreeApp's shell. */
export interface GeodesicEmitterLabelControllerDeps {
  /** Scene that label objects are added to. */
  readonly scene: THREE.Scene;
  /** Camera whose world orientation labels copy each frame so they face the viewer. */
  readonly camera: THREE.Camera;
  /** Registry scanned for geodesic cannons and used to number geodesics. */
  readonly runtimeObjectRegistry: RuntimeObjectReader;
  /** Mutable label store keyed by `getGeodesicEmitterLabelKey`; shared with the shell, mutated in place by the controller. */
  readonly geodesicEmitterLabelsByKey: Map<string, GeodesicEmitterLabel>;
  /** Getter for the active compiled world, used to find where a cannon on another face appears from the player. */
  getWorld(): CompiledCellComplex;
  /** The shell session: player pose, debug settings and the cannon tool state are read from it. */
  readonly session: ClientSession;
  /** The world engine; the player's pose is read from it. */
  readonly engine: WorldEngine;
  /** Current registry version; the create/remove sweep runs only when it differs from the last sweep's. */
  getRegistryVersion(): number;
}

/**
 * Creates the emitter-label controller and returns its update and naming functions.
 *
 * `updateGeodesicEmitterLabels` is called once per frame; `getGeodesicDisplayName` returns "G<n>" for a geodesic id and
 * `getGeodesicLabelsById` maps many ids to such names. There is no dispose function: remaining labels live in
 * the caller-owned map and scene.
 */
export function createGeodesicEmitterLabelController(deps: GeodesicEmitterLabelControllerDeps) {
  const { scene, camera, runtimeObjectRegistry, geodesicEmitterLabelsByKey } = deps;

  // Reused every frame (cleared / overwritten before use).
  const activeLabelKeys = new Set<string>();
  const cameraQuaternion = new THREE.Quaternion();

  let lastSweepRegistryVersion = -1;

  function updateGeodesicEmitterLabels(): void {
    // Label creation, text updates and removal depend only on registry contents, so that sweep runs once per
    // registry version; visibility and placement of the labels run every frame.
    const registryVersion = deps.getRegistryVersion();
    const sweep = registryVersion !== lastSweepRegistryVersion;
    lastSweepRegistryVersion = registryVersion;
    activeLabelKeys.clear();
    camera.getWorldQuaternion(cameraQuaternion);

    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind !== "geodesic-cannon") {
        continue;
      }

      const appearance = resolveCannonAppearance(object);
      // Labels exist for every geodesic regardless of range; only visibility and placement are gated.
      const visible = appearance !== undefined && appearance.distanceMeters <= geodesicEmitterLabelRangeMeters;
      getEmitterGeodesicIds(runtimeObjectRegistry, object.id).forEach((geodesicId) => {
        const key = getGeodesicEmitterLabelKey(object.id, geodesicId);
        activeLabelKeys.add(key);
        const label = (!sweep && geodesicEmitterLabelsByKey.get(key)) ||
          syncGeodesicEmitterLabelObject(key, getGeodesicDisplayName(geodesicId));
        label.root.visible = visible;
        if (!visible) {
          return;
        }

        const position = resolveGeodesicEmitterLabelPosition(runtimeObjectRegistry, object, geodesicId);
        label.root.position.copy(
          appearance?.playerFrameFromCell
            ? worldPointToThree(transformPoint3(appearance.playerFrameFromCell, threePointToWorld(position)))
            : position,
        );
        label.root.quaternion.copy(cameraQuaternion);
        label.root.updateMatrixWorld(true);
      });
    }

    if (!sweep) {
      return;
    }

    // Sweep labels whose cannon or geodesic no longer exists (deleting the current Map entry while iterating is safe).
    for (const [key, label] of geodesicEmitterLabelsByKey) {
      if (activeLabelKeys.has(key)) {
        continue;
      }

      label.root.removeFromParent();
      disposeObject3D(label.root);
      geodesicEmitterLabelsByKey.delete(key);
    }
  }

  // Where a cannon appears from the player: in the player's cell its own frame is the player's; in another cell it is the image
  // through the portals that a straight line from the player to the cannon crosses (at most two), with the map from the cannon's
  // frame to the player's. Undefined when no such line exists, so a cannon behind a wall gets no label.
  function resolveCannonAppearance(
    cannon: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  ): { readonly distanceMeters: number; readonly playerFrameFromCell?: RigidTransform3 } | undefined {
    const player = readLocalPlayerPose(deps.engine);
    if (cannon.cellId === player.cellId) {
      return {
        distanceMeters: Math.hypot(
          player.position.x - cannon.localPose.translation.x,
          player.position.y - cannon.localPose.translation.y,
        ),
      };
    }

    const route = findNearestImageRoute(
      deps.getWorld(),
      { cellId: player.cellId, point: player.position },
      { cellId: cannon.cellId, point: cannon.localPose.translation },
      geodesicEmitterLabelMaxHops,
    );
    if (!route) {
      return undefined;
    }

    const cellFromPlayerFrame = route.hops.reduce((frame, hop) => composeRigidTransform3(hop.transformToTarget, frame), identityRigidTransform3);
    const playerFrameFromCell = invertRigidTransform3(cellFromPlayerFrame);
    const image = transformPoint3(playerFrameFromCell, cannon.localPose.translation);

    return {
      distanceMeters: Math.hypot(player.position.x - image.x, player.position.y - image.y),
      playerFrameFromCell,
    };
  }

  function syncGeodesicEmitterLabelObject(key: string, text: string): { readonly text: string; readonly root: THREE.Object3D } {
    const existing = geodesicEmitterLabelsByKey.get(key);
    if (existing?.text === text) {
      return existing;
    }

    if (existing) {
      existing.root.removeFromParent();
      disposeObject3D(existing.root);
    }

    const root = createGeodesicEmitterLabel(text);
    root.name = `geodesic-emitter-label:${key}`;
    scene.add(root);
    const next = { text, root };
    geodesicEmitterLabelsByKey.set(key, next);
    return next;
  }

  function getGeodesicDisplayName(geodesicId: string): string {
    return `G${resolveGeodesicNumber(runtimeObjectRegistry, geodesicId)}`;
  }

  function getGeodesicLabelsById(geodesicIds: readonly string[]): Readonly<Record<string, string>> {
    return Object.fromEntries(geodesicIds.map((geodesicId) => [geodesicId, getGeodesicDisplayName(geodesicId)]));
  }

  return { updateGeodesicEmitterLabels, getGeodesicDisplayName, getGeodesicLabelsById };
}
