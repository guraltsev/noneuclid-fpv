/**
 * XR controller hand models (src/render/three/xrControllerHandModels.ts): splits one loaded low-poly hand asset
 * into a left and a right template by mesh name prefix, and maps the selected tool to the small wrist indicator
 * icon shown near the right hand (an icon, a label, or nothing for tools with no icon).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "../../src/glue/assetUrls";
import { createFakeXrFrame, createFakeXrInputSource } from "../support/fakeXr";
import { createTestToolsById } from "../support/tools";
import {
  createHandModelTemplates,
  createXrControllerHandModels,
  resolveWristToolIndicatorVisual,
} from "../../src/render/three/xrControllerHandModels";

const toolsById = createTestToolsById();

describe("xrControllerHandModels", () => {
  it("keeps all meshes for each side of a split low-poly hand asset", () => {
    const source = new THREE.Group();
    source.add(
      createNamedBox("right-palm", -0.28),
      createNamedBox("right-finger", -0.12),
      createNamedBox("left-palm", 0.14),
      createNamedBox("left-finger", 0.31),
    );

    const templates = createHandModelTemplates(source);

    expect(collectMeshNames(templates.left)).toEqual(["left-palm", "left-finger"]);
    expect(collectMeshNames(templates.right)).toEqual(["right-palm", "right-finger"]);
  });

  it("maps runtime tool state to a right-wrist indicator visual", () => {
    expect(resolveWristToolIndicatorVisual(toolsById.get("aim"), "WoodenSign1")).toBeUndefined();
    expect(resolveWristToolIndicatorVisual(toolsById.get("placedFlags/flag"), "WoodenSign2")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
      label: "Sign",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicEmitters/emitter"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("flashlight/Lightsaber.png"),
      label: "Laser",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicMeasurements/protractor"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/protractor.png"),
      label: "Protractor",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicMeasurements/length"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/ruler.svg"),
      label: "Ruler",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicEmitters/rotate"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/arrow-circle-inverted.png"),
      label: "Turn",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicEmitters/carry"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/carry.svg"),
      label: "Pick up",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("worldMap/map"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/world-map.svg"),
      label: "Map",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("none"), "WoodenSign1")).toBeUndefined();
  });

  it("reports the right hand only while it is tracked", () => {
    const hands = createXrControllerHandModels(new THREE.Scene());
    const frame = {
      xrFrame: createFakeXrFrame({ position: { x: 0.2, y: 1.1, z: -0.3 } }),
      referenceSpace: {} as XRReferenceSpace,
      referenceSpaceToWorldMatrix: new THREE.Matrix4().makeTranslation(1, 0, 0),
      tool: undefined,
    };
    expect(hands.rightHand()).toBeUndefined();

    hands.update({ ...frame, inputSources: [createFakeXrInputSource({ handedness: "left" })] });
    expect(hands.rightHand()).toBeUndefined();

    hands.update({ ...frame, inputSources: [createFakeXrInputSource({ handedness: "right" })] });
    expect(hands.rightHand()?.position.toArray()).toEqual([1.2, 1.1, -0.3]);

    hands.update({ ...frame, inputSources: [] });
    expect(hands.rightHand()).toBeUndefined();
    hands.dispose();
  });

  it("reports either hand by its handedness", () => {
    const hands = createXrControllerHandModels(new THREE.Scene());
    const frame = {
      xrFrame: createFakeXrFrame({ position: { x: 0, y: 1, z: 0 } }),
      referenceSpace: {} as XRReferenceSpace,
      referenceSpaceToWorldMatrix: new THREE.Matrix4(),
      tool: undefined,
    };

    hands.update({ ...frame, inputSources: [createFakeXrInputSource({ handedness: "left" })], pointerHandedness: "left" });
    expect(hands.hand("left")?.position.toArray()).toEqual([0, 1, 0]);
    expect(hands.hand("right")).toBeUndefined();
    hands.update({ ...frame, inputSources: [], pointerHandedness: "left" });
    expect(hands.hand("left")).toBeUndefined();
    hands.dispose();
  });
});

function createNamedBox(name: string, x: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.04),
    new THREE.MeshBasicMaterial(),
  );
  mesh.name = name;
  mesh.position.x = x;
  return mesh;
}

function collectMeshNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      names.push(mesh.name);
    }
  });
  return names;
}
