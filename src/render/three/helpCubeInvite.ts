/**
 * The help cube's invitation (design 017 section 9.1): a floating "? Help" label over the cube and a slow bob, until the cube has been opened once in the session.
 * The label is a billboard in the scene, placed in the player's cell frame the way the emitter labels are (the cube's own cell frame, or its image through at most two portals). The bob moves the cube itself, 3 cm up and down with a period of 2 s, through its owner (`ObjectHost.placeAt`), so it is drawn and picked where it is; when the invitation ends the cube is put back on its authored height.
 * It owns the label object and the last offset it applied; the cube's record is read from the registry.
 */
import * as THREE from "three";
import { readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { findNearestImageRoute } from "../../cell-complex/portalRoute";
import { composeRigidTransform3, identityRigidTransform3, invertRigidTransform3, transformPoint3 } from "../../math/rigidTransform3";
import type { ObjectHost } from "../../world-objects/worldObjectOwner";
import type { RuntimeObjectReader } from "../../world-objects/runtimeObjectRegistry";
import { toolStandText } from "../../ui/vocabulary";
import { createGeodesicEmitterLabel } from "./geodesicEmitterLabels";
import { disposeObject3D } from "./runtimeSceneUtils";
import { worldPointToThree } from "./worldAxes";

/** The height the cube bobs by, in meters (amplitude). */
export const helpCubeBobAmplitudeMeters = 0.03;
/** The period of the bob, in seconds. */
export const helpCubeBobPeriodSeconds = 2;
/** The label's height above the cube's base, in meters. */
export const helpCubeLabelHeightMeters = 1.55;
/** The label is drawn this many times larger than the emitter labels' plate. */
const labelScale = 3;
/** The farthest the label is shown from, in meters. */
const labelRangeMeters = 9;
const maxHops = 2;

/** The bob's offset at `seconds`, in meters: a sine of the given amplitude and period. */
export function helpCubeBobOffset(seconds: number): number {
  return helpCubeBobAmplitudeMeters * Math.sin((2 * Math.PI * seconds) / helpCubeBobPeriodSeconds);
}

/** What the invitation needs from the shell. */
export interface HelpCubeInviteDeps {
  readonly scene: THREE.Scene;
  /** The camera the label turns to face. */
  readonly camera: THREE.Camera;
  readonly engine: WorldEngine;
  readonly registry: RuntimeObjectReader;
  readonly objectHost: Pick<ObjectHost, "placeAt">;
  /** The active compiled world; read on each call because geometry commits replace it. */
  getWorld(): CompiledCellComplex;
  /** The registry id of the help cube. */
  readonly cubeId: string;
}

/** Handle of the invitation. */
export interface HelpCubeInvite {
  /** Moves the bob and the label for the time `seconds` (any steady clock); call once per frame. */
  update(seconds: number): void;
  /** The cube has been opened: the label goes and the cube comes to rest. */
  markOpened(): void;
  /** True while the invitation is showing. */
  isInviting(): boolean;
  /** Removes the label and puts the cube back. */
  dispose(): void;
}

/** Creates the invitation for the cube with `deps.cubeId`. */
export function createHelpCubeInvite(deps: HelpCubeInviteDeps): HelpCubeInvite {
  let opened = false;
  let appliedOffset = 0;
  let label: THREE.Object3D | undefined;
  const cameraQuaternion = new THREE.Quaternion();

  function restCube(): void {
    if (appliedOffset === 0) return;
    const cube = deps.registry.get(deps.cubeId);
    if (cube !== undefined) {
      deps.objectHost.placeAt(cube.id, cube.cellId, {
        rotation: cube.localPose.rotation,
        translation: { ...cube.localPose.translation, z: cube.localPose.translation.z - appliedOffset },
      });
    }
    appliedOffset = 0;
  }

  function hideLabel(): void {
    if (label !== undefined) label.visible = false;
  }

  // The cube's point as the player sees it: in the player's own frame, through up to two portals; undefined when no straight line reaches it.
  function appearance(cellId: string, point: { readonly x: number; readonly y: number; readonly z: number }): { readonly x: number; readonly y: number; readonly z: number } | undefined {
    const player = readLocalPlayerPose(deps.engine);
    if (cellId === player.cellId) return point;
    const route = findNearestImageRoute(deps.getWorld(), { cellId: player.cellId, point: player.position }, { cellId, point }, maxHops);
    if (!route) return undefined;
    const cellFromPlayerFrame = route.hops.reduce((frame, hop) => composeRigidTransform3(hop.transformToTarget, frame), identityRigidTransform3);
    return transformPoint3(invertRigidTransform3(cellFromPlayerFrame), point);
  }

  return {
    update(seconds) {
      const cube = deps.registry.get(deps.cubeId);
      if (opened || cube === undefined) {
        hideLabel();
        return;
      }

      const offset = helpCubeBobOffset(seconds);
      const baseZ = cube.localPose.translation.z - appliedOffset;
      deps.objectHost.placeAt(cube.id, cube.cellId, {
        rotation: cube.localPose.rotation,
        translation: { ...cube.localPose.translation, z: baseZ + offset },
      });
      appliedOffset = offset;

      const labelPoint = appearance(cube.cellId, { x: cube.localPose.translation.x, y: cube.localPose.translation.y, z: baseZ + offset + helpCubeLabelHeightMeters });
      const player = readLocalPlayerPose(deps.engine);
      const near = labelPoint !== undefined && Math.hypot(labelPoint.x - player.position.x, labelPoint.y - player.position.y) <= labelRangeMeters;
      if (!near) {
        hideLabel();
        return;
      }

      if (label === undefined) {
        label = createGeodesicEmitterLabel(toolStandText.helpInvite);
        label.name = "help-cube-invite";
        label.scale.setScalar(labelScale);
        deps.scene.add(label);
      }

      label.visible = true;
      label.position.copy(worldPointToThree(labelPoint));
      deps.camera.getWorldQuaternion(cameraQuaternion);
      label.quaternion.copy(cameraQuaternion);
      label.updateMatrixWorld(true);
    },
    markOpened() {
      if (opened) return;
      opened = true;
      restCube();
      hideLabel();
    },
    isInviting: () => !opened,
    dispose() {
      if (label !== undefined) {
        label.removeFromParent();
        disposeObject3D(label);
        label = undefined;
      }
    },
  };
}
