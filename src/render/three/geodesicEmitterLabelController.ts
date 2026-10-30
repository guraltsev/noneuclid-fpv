/**
 * Keeps the floating geodesic-name labels next to nearby emitters in sync with the registry.
 *
 * Each frame, one billboard label ("G<number>") exists per (cannon, geodesic) pair in the runtime registry;
 * labels are shown only for cannons in the player's current cell within the label range (meters, measured
 * in the cell-local xy plane). Labels are created lazily, recreated when their text changes, and
 * removed and disposed when their cannon or geodesic disappears. The label map is owned by the caller.
 */
import * as THREE from "three";
import { type PlayerPose } from "../../movement/playerPose";
import { resolveGeodesicNumber } from "../../world-objects/geodesic/segments";
import { type RuntimeObjectRegistry } from "../../world-objects/runtimeObjectRegistry";
import {
  createGeodesicEmitterLabel,
  geodesicEmitterLabelRangeMeters,
  getGeodesicEmitterLabelKey,
  resolveGeodesicEmitterLabelPosition,
} from "./geodesicEmitterLabels";
import { disposeObject3D } from "./runtimeSceneUtils";

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
  readonly runtimeObjectRegistry: RuntimeObjectRegistry;
  /** Mutable label store keyed by `getGeodesicEmitterLabelKey`; shared with the shell, mutated in place by the controller. */
  readonly geodesicEmitterLabelsByKey: Map<string, GeodesicEmitterLabel>;
  /** Getter (not a value) because the shell reassigns the player pose each frame. */
  getPlayerPose(): PlayerPose;
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

  function updateGeodesicEmitterLabels(): void {
    activeLabelKeys.clear();
    camera.getWorldQuaternion(cameraQuaternion);

    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind !== "geodesic-cannon") {
        continue;
      }

      const inCurrentCell = object.cellId === deps.getPlayerPose().cellId;
      const distanceMeters = Math.hypot(
        deps.getPlayerPose().position.x - object.localPose.translation.x,
        deps.getPlayerPose().position.y - object.localPose.translation.y,
      );
      // Labels exist for every geodesic regardless of range; only visibility and placement are gated.
      const visible = inCurrentCell && distanceMeters <= geodesicEmitterLabelRangeMeters;
      object.geodesicIds.forEach((geodesicId) => {
        const key = getGeodesicEmitterLabelKey(object.id, geodesicId);
        activeLabelKeys.add(key);
        const text = getGeodesicDisplayName(geodesicId);
        const label = syncGeodesicEmitterLabelObject(key, text);
        label.root.visible = visible;
        if (!visible) {
          return;
        }

        label.root.position.copy(resolveGeodesicEmitterLabelPosition(object, geodesicId));
        label.root.quaternion.copy(cameraQuaternion);
        label.root.updateMatrixWorld(true);
      });
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
