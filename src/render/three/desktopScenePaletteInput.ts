/**
 * Desktop input path for the in-scene palette: turns mouse motion and button state into a single virtual pointer aimed at the palette.
 * The cursor lives in panel-local meters (see scenePaletteLayout.ts) and is accumulated from relative pointer deltas while the palette is open, clamped to the panel outline;
 * the pointer ray then runs from the camera position through that cursor point on the placed panel, producing a ScenePalettePointerSource of kind "desktop-aimer".
 * Frames, units: Three.js world frame, meters; pointer deltas are in screen pixels. Also holds the pure reducer mapping secondary click and Escape to palette toggle actions.
 */
import * as THREE from "three";
import type { DesktopInputFrame } from "./desktopControls";
import type {
  ScenePaletteInputFrame,
  ScenePalettePlacement,
  ScenePalettePointerSource,
} from "./scenePaletteInput";
import {
  clampScenePaletteLocalPoint,
  scenePalettePanelHeightMeters,
  scenePalettePanelWidthMeters,
} from "./scenePaletteLayout";

/**
 * Stateful desktop palette input; call update once per rendered frame and dispose when the app is torn down.
 */
export interface DesktopScenePaletteInput {
  /**
   * Advances the virtual cursor and returns this frame's palette input.
   * While isOpen is false the cursor is recentered and no pointer is emitted;
   * while open one dominant "desktop-aimer" pointer with no visible ray is returned.
   * desktopFrame supplies palettePointerDeltaPixels and paletteSelectPressed; placement must be the pose the palette is drawn at this frame.
   * The returned pointer object is reused across frames.
   */
  update(options: {
    readonly desktopFrame: DesktopInputFrame;
    readonly deltaSeconds: number;
    readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    readonly isOpen: boolean;
    readonly placement: ScenePalettePlacement;
  }): ScenePaletteInputFrame;
  /** Detaches the internal pointer object from any parent; the object owns no GPU resources. */
  dispose(): void;
}

/**
 * Action the desktop runtime should take after a palette toggle event: open the palette, forward to the palette's right action (back or close), close it, or do nothing.
 */
export type DesktopScenePaletteToggleAction = "open" | "right-action" | "close" | "none";

// Cursor gain: fraction of the half-panel extent moved per pixel of pointer delta.
const cursorSpeed = 0.0032;
// Module-level scratch objects reused each frame; update is not reentrant.
const cameraPosition = new THREE.Vector3();
const cameraQuaternion = new THREE.Quaternion();
const cameraScale = new THREE.Vector3();
const targetLocal = new THREE.Vector3();
const targetWorld = new THREE.Vector3();
const pointerDirection = new THREE.Vector3();
const forwardAxis = new THREE.Vector3(0, 0, -1);

/**
 * Creates the desktop palette input with the cursor centered and no pending toggle state.
 * Caller owns the result and must call dispose(); only one instance is expected since it keeps its own cursor state.
 */
export function createDesktopScenePaletteInput(): DesktopScenePaletteInput {
  const pointerObject = new THREE.Object3D();
  pointerObject.name = "desktop-scene-palette-pointer";
  let cursorLocalX = 0;
  let cursorLocalY = 0;
  let previousMenuTogglePressed = false;

  return {
    update({ desktopFrame, deltaSeconds, camera, isOpen, placement }) {
      // Recenter the cursor whenever the palette is closed so it reopens at the middle.
      if (!isOpen) {
        cursorLocalX = 0;
        cursorLocalY = 0;
      } else {
        // Pointer deltas are subtracted: the placement frame has the panel's front along local -Z (flipped by the controller), which mirrors x and y relative to the screen.
        const clampedCursor = clampScenePaletteLocalPoint(
          cursorLocalX - desktopFrame.palettePointerDeltaPixels.x * cursorSpeed * scenePalettePanelWidthMeters * 0.5,
          cursorLocalY - desktopFrame.palettePointerDeltaPixels.y * cursorSpeed * scenePalettePanelHeightMeters * 0.5,
        );
        cursorLocalX = clampedCursor.x;
        cursorLocalY = clampedCursor.y;
      }

      camera.updateMatrixWorld(true);
      camera.matrixWorld.decompose(cameraPosition, cameraQuaternion, cameraScale);
      // Cursor point on the panel in panel-local meters, mapped to world space via the placement scale, rotation and position.
      targetLocal.set(
        cursorLocalX,
        cursorLocalY,
        0,
      );
      targetWorld.copy(targetLocal)
        .multiplyScalar(placement.scale ?? 1)
        .applyQuaternion(placement.quaternion)
        .add(placement.position);

      // Aim the ray from the camera through the cursor point (ray is local -Z).
      pointerObject.position.copy(cameraPosition);
      pointerDirection.copy(targetWorld).sub(cameraPosition).normalize();
      pointerObject.quaternion.setFromUnitVectors(forwardAxis, pointerDirection);
      pointerObject.updateMatrixWorld(true);

      // The desktop path never reports a menu toggle level here (Escape/secondary click go through reduceDesktopScenePaletteToggle), so menuTogglePressed is always false.
      const rawMenuTogglePressed = false;
      const menuTogglePressed = rawMenuTogglePressed && !previousMenuTogglePressed;
      const pointers: ScenePalettePointerSource[] = isOpen ? [{
        id: "desktop-aimer",
        kind: "desktop-aimer",
        object: pointerObject,
        selectPressed: desktopFrame.paletteSelectPressed,
        dominant: true,
        visibleRay: false,
      }] : [];
      previousMenuTogglePressed = rawMenuTogglePressed;

      return {
        deltaSeconds,
        menuTogglePressed,
        pointers,
      };
    },
    dispose() {
      pointerObject.removeFromParent();
    },
  };
}

/**
 * Maps a desktop toggle event to a palette action given whether the palette is open.
 * Secondary click opens a closed palette and triggers the right action (back or close) of an open one; Escape closes an open palette and does nothing when closed.
 * Pure.
 */
export function reduceDesktopScenePaletteToggle(
  isOpen: boolean,
  event: "secondary-click" | "escape-key",
): DesktopScenePaletteToggleAction {
  if (event === "secondary-click") {
    return isOpen ? "right-action" : "open";
  }
  return isOpen ? "close" : "none";
}
