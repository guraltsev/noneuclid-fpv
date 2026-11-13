/**
 * Scene palette controller placement scale (src/render/three/scenePaletteController.ts): the hover tooltip and the
 * hover marker are added to the scene, not under the palette root, so they take the placement's uniform `scale`
 * themselves (absent means 1). The VR placement passes scale 2; the desktop placement passes 1 and must look as before.
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSession } from "../../src/runtime/clientSession";
import { createRuntimeMenuState } from "../../src/runtime/runtimeMenuState";
import {
  createScenePaletteController,
  type ScenePaletteControllerOptions,
} from "../../src/render/three/scenePaletteController";
import type { ScenePalettePlacement } from "../../src/render/three/scenePaletteInput";
import { resolveFacingQuaternion } from "../../src/render/three/vrPalettePlacement";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";
import { defaultAppConfig } from "../../src/glue/appConfig";
import { createTestPaletteDefinition } from "../support/tools";

// The uikit panels behind the adapter schedule a timer when they are disposed.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scenePaletteController placement scale", () => {
  it("draws the tooltip and the hover marker at the placement scale", () => {
    const { tooltip, marker } = hoverToolButton(2);

    expect(tooltip.visible).toBe(true);
    expect(tooltip.scale.toArray()).toEqual([2, 2, 2]);
    expect(marker.visible).toBe(true);
    expect(marker.scale.toArray()).toEqual([2, 2, 2]);
  });

  it("draws them at scale 1 when the placement has no scale", () => {
    const { tooltip, marker } = hoverToolButton(undefined);

    expect(tooltip.visible).toBe(true);
    expect(tooltip.scale.toArray()).toEqual([1, 1, 1]);
    expect(marker.visible).toBe(true);
    expect(marker.scale.toArray()).toEqual([1, 1, 1]);
  });
});

// Build the controller with the main page open, aim an XR pointer from the head at a tool button, and return the
// tooltip root and hover marker after the frame.
function hoverToolButton(scale: number | undefined): { tooltip: THREE.Object3D; marker: THREE.Object3D } {
  installFakeCanvas2d();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const controller = createScenePaletteController(createOptions(scene, camera));
  const definition = createTestPaletteDefinition(createRuntimeMenuState({ selectedWorldId: "cube" }), defaultAppConfig, "xr");
  const headPosition = new THREE.Vector3(0, 1.6, 0);
  const palettePosition = new THREE.Vector3(0, 1.36, -1.44);
  const placement: ScenePalettePlacement = {
    position: palettePosition,
    quaternion: resolveFacingQuaternion(palettePosition, headPosition),
    ...(scale === undefined ? {} : { scale }),
  };
  const pointerObject = new THREE.Object3D();
  pointerObject.position.copy(headPosition);
  const frame = (pointerTarget: THREE.Vector3 | undefined) => {
    if (pointerTarget) {
      pointerObject.quaternion.copy(resolveFacingQuaternion(headPosition, pointerTarget));
    }
    pointerObject.updateMatrixWorld(true);
    controller.update({
      input: {
        deltaSeconds: 1 / 60,
        menuTogglePressed: false,
        pointers: [{ id: "right", kind: "xr-controller", object: pointerObject, selectPressed: false, dominant: true }],
      },
      definition,
      definitionVersion: 1,
      placement,
    });
  };

  frame(undefined);
  const toolButton = findToolButton(scene);
  frame(new THREE.Box3().setFromObject(toolButton).getCenter(new THREE.Vector3()));

  const tooltip = scene.getObjectByName("scene-palette-hover-tooltip");
  const marker = scene.getObjectByName("scene-palette-hit-marker");
  if (!tooltip || !marker) {
    throw new Error("tooltip or hover marker missing from the scene");
  }

  const result = { tooltip, marker };
  controller.dispose();
  return result;
}

function findToolButton(scene: THREE.Scene): THREE.Object3D {
  let found: THREE.Object3D | undefined;
  scene.traverse((object) => {
    const itemId = object.userData.scenePaletteItemId;
    if (!found && typeof itemId === "string" && itemId.startsWith("tool:")) {
      found = object;
    }
  });
  if (!found) {
    throw new Error("no tool button in the palette");
  }
  return found;
}

function createOptions(scene: THREE.Scene, camera: THREE.PerspectiveCamera): ScenePaletteControllerOptions {
  const session = { get: () => ({ menuState: { isOpen: true } }) } as unknown as ClientSession;
  const base = { scene, getCamera: () => camera, session };
  // Every callback is a no-op; the test fires no action.
  return new Proxy(base, {
    get(target, property) {
      return property in target ? target[property as keyof typeof target] : () => undefined;
    },
  }) as unknown as ScenePaletteControllerOptions;
}
