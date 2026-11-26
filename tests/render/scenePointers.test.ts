/**
 * Active-pointer priority (`chooseActiveScenePointer` in src/render/three/scenePointers.ts): among the scene
 * palette's per-source pointers (desktop ray or XR controller), picks the one that should drive the palette UI
 * this frame: first a pressed pointer, then a hovering dominant one, then any hovering one, then any dominant one,
 * then the first in the list. Returns `undefined` for an empty list. The pointers tell uikit what they are: the desktop aimer is a
 * mouse (so a scrollbar thumb drags the way the mouse moves) and gets the wheel; an XR ray stays a ray.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { chooseActiveScenePointer, createScenePointers } from "../../src/render/three/scenePointers";

describe("scenePointers", () => {
  it("prefers a selected pointer over hover-only pointers", () => {
    const active = chooseActiveScenePointer([
      {
        id: "desktop-aimer",
        kind: "desktop-aimer",
        hoveredTargetId: "tool:placedFlags/flag",
        selectPressed: false,
        selectStarted: false,
        selectEnded: false,
        dominant: true,
      },
      {
        id: "controller:left",
        kind: "xr-controller",
        selectPressed: true,
        selectStarted: true,
        selectEnded: false,
        dominant: false,
      },
    ]);

    expect(active?.id).toBe("controller:left");
  });

  it("falls back to the dominant hovered pointer", () => {
    const active = chooseActiveScenePointer([
      {
        id: "controller:left",
        kind: "xr-controller",
        hoveredTargetId: "reload-world",
        selectPressed: false,
        selectStarted: false,
        selectEnded: false,
        dominant: false,
      },
      {
        id: "controller:right",
        kind: "xr-controller",
        hoveredTargetId: "debug-overlay-toggle",
        selectPressed: false,
        selectStarted: false,
        selectEnded: false,
        dominant: true,
      },
    ]);

    expect(active?.id).toBe("controller:right");
  });

  it("sends the desktop aimer as a mouse with its wheel, and an XR controller as a ray", () => {
    const scene = new THREE.Scene();
    const target = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    target.position.set(0, 0, -1);
    scene.add(target);
    const seen: { type: string; pointerType: unknown; deltaY?: number }[] = [];
    const record = (type: string) => (event: { nativeEvent: { pointerType?: unknown; deltaY?: number } }) => {
      seen.push({ type, pointerType: event.nativeEvent.pointerType, deltaY: event.nativeEvent.deltaY });
    };
    target.addEventListener("pointerdown" as never, record("down") as never);
    target.addEventListener("wheel" as never, record("wheel") as never);
    const pointers = createScenePointers(() => new THREE.PerspectiveCamera());
    const aimer = new THREE.Object3D();
    const controller = new THREE.Object3D();

    pointers.update(scene, [{ id: "desktop-aimer", kind: "desktop-aimer", object: aimer, selectPressed: false, wheelDeltaPixels: 90 }]);
    pointers.update(scene, [{ id: "desktop-aimer", kind: "desktop-aimer", object: aimer, selectPressed: true }]);
    pointers.update(scene, [{ id: "right", kind: "xr-controller", object: controller, selectPressed: true }]);
    pointers.dispose();

    expect(seen).toEqual([
      { type: "wheel", pointerType: "mouse", deltaY: 90 },
      { type: "down", pointerType: "mouse", deltaY: undefined },
      { type: "down", pointerType: "ray", deltaY: undefined },
    ]);
  });
});
