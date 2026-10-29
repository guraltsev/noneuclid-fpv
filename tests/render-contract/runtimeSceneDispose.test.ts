import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeCanvasTextures, disposeObject3D, disposeObject3DWithTextures } from "../../src/render/three/runtimeSceneUtils";

function createTexturedMesh() {
  const texture = new THREE.Texture();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const spies = {
    texture: vi.spyOn(texture, "dispose"),
    geometry: vi.spyOn(geometry, "dispose"),
    material: vi.spyOn(material, "dispose"),
  };
  return { mesh: new THREE.Mesh(geometry, material), spies };
}

describe("runtime scene disposal helpers", () => {
  it("disposeObject3D leaves textures alone", () => {
    const { mesh, spies } = createTexturedMesh();
    disposeObject3D(mesh);
    expect(spies.geometry).toHaveBeenCalledTimes(1);
    expect(spies.material).toHaveBeenCalledTimes(1);
    expect(spies.texture).not.toHaveBeenCalled();
  });

  it("disposeObject3DWithTextures also disposes material maps", () => {
    const { mesh, spies } = createTexturedMesh();
    const root = new THREE.Group();
    root.add(mesh);
    disposeObject3DWithTextures(root);
    expect(spies.geometry).toHaveBeenCalledTimes(1);
    expect(spies.material).toHaveBeenCalledTimes(1);
    expect(spies.texture).toHaveBeenCalledTimes(1);
  });

  it("disposeCanvasTextures frees canvas maps only", () => {
    // No DOM in this environment; any image-like object will do for a texture that is never uploaded.
    const canvasTexture = new THREE.CanvasTexture({ width: 1, height: 1 } as unknown as HTMLCanvasElement);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: canvasTexture }));
    const { mesh: floor, spies } = createTexturedMesh();
    const canvasSpy = vi.spyOn(canvasTexture, "dispose");
    const root = new THREE.Group();
    root.add(label, floor);

    disposeCanvasTextures(root);

    expect(canvasSpy).toHaveBeenCalledTimes(1);
    expect(spies.texture).not.toHaveBeenCalled();
    expect(spies.geometry).not.toHaveBeenCalled();
    expect(spies.material).not.toHaveBeenCalled();
  });
});
