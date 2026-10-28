/**
 * XR input path for the in-scene palette: converts XR controller target-ray poses and gamepad state into palette pointer sources.
 * Poses come from XRFrame.getPose in the reference space and are lifted into the Three.js world frame (meters) with the reference-space-to-world matrix of the player rig.
 * Only gamepad controllers with left or right handedness are used; hand-tracking sources are skipped. The side-trigger menu toggle is computed but not forwarded (see createXrScenePaletteInput).
 */
import * as THREE from "three";
import { isInteractPressed, isPrimaryActionPressed } from "./xrControls";
import { xrRigidTransformLocalMatrix } from "./xrPlayerRig";
import type { ScenePaletteInputFrame, ScenePalettePointerSource } from "./scenePaletteInput";

/**
 * Per-frame XR palette input adapter; created by createXrScenePaletteInput.
 */
export interface XrScenePaletteInput {
  /**
   * Builds the palette input frame from the current XR input sources.
   * referenceSpaceToWorldMatrix maps reference-space poses into the Three.js world (createThreeApp passes xrRig.root.matrixWorld).
   * Sources without a target-ray pose this frame are omitted.
   */
  update(options: {
    readonly deltaSeconds: number;
    readonly inputSources: readonly XRInputSource[];
    readonly xrFrame: XRFrame;
    readonly referenceSpace: XRReferenceSpace;
    readonly referenceSpaceToWorldMatrix: THREE.Matrix4;
  }): ScenePaletteInputFrame;
  /** Forgets cached controller objects, e.g. when the XR session ends. */
  reset(): void;
}

// Module-level cache of pointer Object3Ds keyed by controller id so pointer identity is stable across frames; shared by all instances and cleared by reset().
const controllerObjects = new Map<string, THREE.Object3D>();

/**
 * Creates the XR palette input adapter; it holds no resources beyond the shared controller cache, which reset() clears.
 */
export function createXrScenePaletteInput(): XrScenePaletteInput {
  return {
    update(options) {
      const sources = createControllerSources(
        options.inputSources,
        options.xrFrame,
        options.referenceSpace,
        options.referenceSpaceToWorldMatrix,
      );

      return {
        deltaSeconds: options.deltaSeconds,
        // XR side-trigger menu actions are handled by the main runtime input
        // path so object menus and the global tool palette share one flow.
        menuTogglePressed: false,
        pointers: sources.pointerSources,
      };
    },
    reset() {
      controllerObjects.clear();
    },
  };
}

/**
 * Derives palette pointer sources from XR input sources for one frame and also reports whether any controller's menu button is down.
 * Skips sources that are hands, have no left/right handedness, or have no target-ray pose in referenceSpace. Each source gets id "controller:left" or "controller:right", kind "xr-controller", a visible ray, and the right hand is dominant.
 * The cached Object3D per id is updated in place with the world-frame target-ray pose.
 */
export function createControllerSources(
  inputSources: readonly XRInputSource[],
  frame: XRFrame,
  referenceSpace: XRReferenceSpace,
  referenceSpaceToWorldMatrix: THREE.Matrix4,
): {
  readonly pointerSources: readonly ScenePalettePointerSource[];
  readonly menuTogglePressed: boolean;
} {
  const pointerSources: ScenePalettePointerSource[] = [];
  let menuTogglePressed = false;

  for (const source of inputSources) {
    // Only left/right gamepad controllers are handled; tracked hands are ignored here.
    const handedness = source.handedness === "left" || source.handedness === "right" ? source.handedness : undefined;
    if (!handedness || source.hand) {
      continue;
    }

    const targetRayPose = frame.getPose(source.targetRaySpace, referenceSpace);
    if (!targetRayPose) {
      continue;
    }

    const id = `controller:${handedness}`;
    const object = controllerObjects.get(id) ?? new THREE.Object3D();
    applyXrPoseToObject(object, targetRayPose.transform, referenceSpaceToWorldMatrix);
    object.updateMatrixWorld(true);
    controllerObjects.set(id, object);

    menuTogglePressed ||= isMenuTogglePressed(source.gamepad);

    pointerSources.push({
      id,
      kind: "xr-controller",
      object,
      selectPressed: isSelectPressed(source.gamepad),
      dominant: handedness === "right",
      visibleRay: true,
    });
  }

  return {
    pointerSources,
    menuTogglePressed,
  };
}

// Write the world-frame decomposition of (referenceSpaceToWorld * pose) into object's position, quaternion and scale.
function applyXrPoseToObject(
  object: THREE.Object3D,
  transform: Pick<XRRigidTransform, "position" | "orientation">,
  referenceSpaceToWorldMatrix: THREE.Matrix4,
): void {
  const worldMatrix = referenceSpaceToWorldMatrix.clone().multiply(xrRigidTransformLocalMatrix(transform));
  worldMatrix.decompose(object.position, object.quaternion, object.scale);
}

/**
 * Returns whether the controller's primary action button is pressed (select); false for a missing gamepad.
 */
export function isSelectPressed(gamepad: XRInputSource["gamepad"] | undefined): boolean {
  return isPrimaryActionPressed(gamepad);
}

/**
 * Returns whether the controller's interact button is pressed, which is the menu toggle level; false for a missing gamepad.
 */
export function isMenuTogglePressed(gamepad: XRInputSource["gamepad"] | undefined): boolean {
  return isInteractPressed(gamepad);
}
