import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeObject3D, disposeObject3DWithTextures } from "../../src/render/three/runtimeSceneUtils";

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
});
