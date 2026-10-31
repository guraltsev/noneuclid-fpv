import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createDesktopScenePaletteInput,
  reduceDesktopScenePaletteToggle,
} from "../../src/render/three/desktopScenePaletteInput";
import {
  scenePalettePanelBorderRadiusMeters,
  scenePalettePanelHeightMeters,
  scenePalettePanelWidthMeters,
} from "../../src/render/three/scenePaletteLayout";

describe("desktopScenePaletteInput", () => {
  it("opens from secondary click and maps open-menu secondary clicks to the right menu action", () => {
    expect(reduceDesktopScenePaletteToggle(false, "secondary-click")).toBe("open");
    expect(reduceDesktopScenePaletteToggle(true, "secondary-click")).toBe("right-action");
    expect(reduceDesktopScenePaletteToggle(true, "escape-key")).toBe("close");
  });

  it("emits a desktop scene pointer while the menu is open", () => {
    const input = createDesktopScenePaletteInput();
    const camera = new THREE.PerspectiveCamera();
    const frame = input.update({
      desktopFrame: {
        localDisplacement: { x: 0, y: 0, z: 0 },
        yawDeltaRadians: 0,
        pitchDeltaRadians: 0,
        palettePointerDeltaPixels: { x: 12, y: -8 },
        paletteSelectPressed: true,
        paletteSelectRequested: true,
        resetRequested: false,
        primaryActionRequested: false,
        interactRequested: false,
        carryActionRequested: false,
        helpRequested: false,
      },
      deltaSeconds: 1 / 60,
      camera,
      isOpen: true,
      placement: {
        position: new THREE.Vector3(0, 0, -1),
        quaternion: new THREE.Quaternion(),
      },
    });

    expect(frame.pointers).toHaveLength(1);
    expect(frame.pointers[0]?.kind).toBe("desktop-aimer");
    expect(frame.pointers[0]?.selectPressed).toBe(true);
    expect(frame.pointers[0]?.dominant).toBe(true);
  });

  it("orients the desktop pointer local -Z ray toward the palette plane", () => {
    const input = createDesktopScenePaletteInput();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);

    const frame = input.update({
      desktopFrame: {
        localDisplacement: { x: 0, y: 0, z: 0 },
        yawDeltaRadians: 0,
        pitchDeltaRadians: 0,
        palettePointerDeltaPixels: { x: 0, y: 0 },
        paletteSelectPressed: false,
        paletteSelectRequested: false,
        resetRequested: false,
        primaryActionRequested: false,
        interactRequested: false,
        carryActionRequested: false,
        helpRequested: false,
      },
      deltaSeconds: 1 / 60,
      camera,
      isOpen: true,
      placement: {
        position: new THREE.Vector3(0, 0, -1),
        quaternion: new THREE.Quaternion(),
      },
    });

    const pointer = frame.pointers[0]?.object;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pointer?.quaternion ?? new THREE.Quaternion());

    expect(direction.z).toBeLessThan(-0.99);
  });

  it("maps positive desktop mouse X toward the rendered panel's right side", () => {
    const input = createDesktopScenePaletteInput();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);

    const frame = input.update({
      desktopFrame: {
        localDisplacement: { x: 0, y: 0, z: 0 },
        yawDeltaRadians: 0,
        pitchDeltaRadians: 0,
        palettePointerDeltaPixels: { x: 40, y: 0 },
        paletteSelectPressed: false,
        paletteSelectRequested: false,
        resetRequested: false,
        primaryActionRequested: false,
        interactRequested: false,
        carryActionRequested: false,
        helpRequested: false,
      },
      deltaSeconds: 1 / 60,
      camera,
      isOpen: true,
      placement: {
        position: new THREE.Vector3(0, 0, -1),
        quaternion: new THREE.Quaternion(),
      },
    });

    const pointer = frame.pointers[0]?.object;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pointer?.quaternion ?? new THREE.Quaternion());

    expect(direction.x).toBeLessThan(0);
  });

  it("reaches the full scene palette width instead of the older inset cursor bounds", () => {
    const input = createDesktopScenePaletteInput();
    const point = resolvePointerPlanePoint(input, {
      x: 100000,
      y: 0,
    });

    expect(point.x).toBeCloseTo(-scenePalettePanelWidthMeters * 0.5, 6);
    expect(point.y).toBeCloseTo(0, 6);
  });

  it("clamps the desktop cursor to the rounded menu corner instead of a square cutout", () => {
    const input = createDesktopScenePaletteInput();
    const point = resolvePointerPlanePoint(input, {
      x: 100000,
      y: 100000,
    });
    const absoluteX = Math.abs(point.x);
    const absoluteY = Math.abs(point.y);
    const cornerCenterX = scenePalettePanelWidthMeters * 0.5 - scenePalettePanelBorderRadiusMeters;
    const cornerCenterY = scenePalettePanelHeightMeters * 0.5 - scenePalettePanelBorderRadiusMeters;

    expect(absoluteX).toBeGreaterThan(cornerCenterX);
    expect(absoluteY).toBeGreaterThan(cornerCenterY);
    expect(
      Math.hypot(absoluteX - cornerCenterX, absoluteY - cornerCenterY),
    ).toBeCloseTo(scenePalettePanelBorderRadiusMeters, 6);
  });
});

function resolvePointerPlanePoint(
  input: ReturnType<typeof createDesktopScenePaletteInput>,
  delta: { readonly x: number; readonly y: number },
): THREE.Vector3 {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);

  const frame = input.update({
    desktopFrame: {
      localDisplacement: { x: 0, y: 0, z: 0 },
      yawDeltaRadians: 0,
      pitchDeltaRadians: 0,
      palettePointerDeltaPixels: delta,
      paletteSelectPressed: false,
      paletteSelectRequested: false,
      resetRequested: false,
      primaryActionRequested: false,
      interactRequested: false,
      carryActionRequested: false,
      helpRequested: false,
    },
    deltaSeconds: 1 / 60,
    camera,
    isOpen: true,
    placement: {
      position: new THREE.Vector3(0, 0, -1),
      quaternion: new THREE.Quaternion(),
    },
  });

  const pointer = frame.pointers[0]?.object;
  if (!pointer) {
    throw new Error("Expected a desktop palette pointer.");
  }

  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pointer.quaternion).normalize();
  const scale = -1 / direction.z;
  return new THREE.Vector3(
    pointer.position.x + direction.x * scale,
    pointer.position.y + direction.y * scale,
    pointer.position.z + direction.z * scale,
  );
}
