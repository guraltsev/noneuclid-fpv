/**
 * XR controller hand models (src/render/three/xrControllerHandModels.ts): splits one loaded low-poly hand asset
 * into a left and a right template by mesh name prefix, and maps the selected tool to the small wrist indicator
 * icon shown near the right hand (an icon, a label, or nothing for tools with no icon).
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "../../src/glue/assetUrls";
import { createTestToolsById } from "../support/tools";
import {
  createHandModelTemplates,
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
    expect(resolveWristToolIndicatorVisual(toolsById.get("place-flag"), "WoodenSign2")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
      label: "Sign",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicEmitters/emitter"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("flashlight/Lightsaber.png"),
      label: "Geodesic emitter",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("protractor"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/protractor.png"),
      label: "Protractor",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("measure-length"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/ruler.svg"),
      label: "Length",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicEmitters/rotate"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/arrow-circle-inverted.png"),
      label: "Turn",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("geodesicEmitters/carry"), "WoodenSign1")).toMatchObject({
      icon: "image",
      imageSource: publicAssetUrl("icons/carry.svg"),
      label: "Carry",
    });
    expect(resolveWristToolIndicatorVisual(toolsById.get("none"), "WoodenSign1")).toBeUndefined();
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
