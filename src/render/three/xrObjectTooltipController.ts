/**
 * Owns the single floating XR object tooltip in the scene and positions it above an aimed object.
 * Anchors are cell-local world coordinates (x right, y forward, z up, meters) converted with `worldPointToThree`.
 * The tooltip is recreated only when its text changes; otherwise only its transform is updated.
 */
/** Shows the floating tooltip above the object a VR controller points at. */
import * as THREE from "three";
import { disposeObject3D } from "./runtimeSceneUtils";
import { resolveFrontFacingQuaternion } from "./vrPalettePlacement";
import { worldPointToThree } from "./worldAxes";
import { createXrObjectTooltip, xrObjectTooltipYOffsetMeters } from "./xrObjectTooltipMesh";

/**
 * Dependencies for `createXrObjectTooltipController`.
 */
export interface XrObjectTooltipControllerDeps {
  /** Scene that receives the tooltip root (createThreeApp#shell passes its main scene, a value). */
  readonly scene: THREE.Scene;
  /** Orientation source used when no head position is given (the shell's main camera, a value whose quaternion is read at each update). */
  readonly camera: THREE.Camera;
}

/**
 * Creates the tooltip controller; returns `updateXrObjectTooltip` (show/move, or hide when passed `undefined`) and `clearXrObjectTooltip`.
 * `updateXrObjectTooltip` takes the label text (up to 3 newline-separated lines are drawn), the `anchor` in world coordinates
 * (the tooltip is lifted by `xrObjectTooltipYOffsetMeters` along z), and an optional Three.js-frame `headWorldPosition`
 * that makes the tooltip face the head; without it the camera's orientation is copied.
 * Lifecycle: no dispose method exists; the owner must call `clearXrObjectTooltip` at teardown to remove the mesh and free its texture.
 */
export function createXrObjectTooltipController(deps: XrObjectTooltipControllerDeps) {
  const { scene, camera } = deps;
  let xrObjectTooltip: { readonly text: string; readonly root: THREE.Object3D } | undefined;

  function updateXrObjectTooltip(options: {
    readonly text: string;
    readonly anchor: { readonly x: number; readonly y: number; readonly z: number };
    readonly headWorldPosition?: THREE.Vector3;
  } | undefined): void {
    // Passing undefined hides the tooltip but keeps it for reuse.
    if (!options) {
      if (xrObjectTooltip) {
        xrObjectTooltip.root.visible = false;
      }
      return;
    }

    const tooltip = syncXrObjectTooltip(options.text);
    tooltip.root.visible = true;
    tooltip.root.position.copy(worldPointToThree({
      x: options.anchor.x,
      y: options.anchor.y,
      z: options.anchor.z + xrObjectTooltipYOffsetMeters,
    }));
    tooltip.root.quaternion.copy(
      options.headWorldPosition
        ? resolveFrontFacingQuaternion(tooltip.root.position, options.headWorldPosition)
        : camera.quaternion,
    );
    tooltip.root.updateMatrixWorld(true);
  }

  // Returns the cached tooltip when the text is unchanged; otherwise rebuilds it (the canvas texture is text-specific).
  function syncXrObjectTooltip(text: string): { readonly text: string; readonly root: THREE.Object3D } {
    if (xrObjectTooltip?.text === text) {
      return xrObjectTooltip;
    }

    clearXrObjectTooltip();
    const root = createXrObjectTooltip(text);
    root.name = "xr-object-tooltip";
    scene.add(root);
    xrObjectTooltip = { text, root };
    return xrObjectTooltip;
  }

  function clearXrObjectTooltip(): void {
    if (!xrObjectTooltip) {
      return;
    }

    xrObjectTooltip.root.removeFromParent();
    disposeObject3D(xrObjectTooltip.root);
    xrObjectTooltip = undefined;
  }

  return { updateXrObjectTooltip, clearXrObjectTooltip };
}
