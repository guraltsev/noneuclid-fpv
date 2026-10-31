import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createStylizedSceneLighting,
  disposeStylizedSceneLighting,
  updateStylizedSceneLighting,
} from "../../src/render/three/sceneLighting";

describe("scene lighting", () => {
  it("creates a portal-stable stylized rig without directional lights or shadows", () => {
    const scene = new THREE.Scene();

    const lighting = createStylizedSceneLighting(scene);
    const directionalLights = scene.children.filter((child) => child instanceof THREE.DirectionalLight);

    expect(lighting.hemisphereLight.intensity).toBeLessThanOrEqual(2);
    expect(lighting.ambientLight.intensity).toBeLessThan(0.5);
    expect(lighting.hemisphereLight.castShadow).toBe(false);
    expect(lighting.ambientLight.castShadow).toBe(false);
    expect(directionalLights).toHaveLength(0);
    expect(scene.children).toEqual(
      expect.arrayContaining([lighting.hemisphereLight, lighting.ambientLight]),
    );
  });

  it("keeps the lighting rig stable when updated from camera pose changes", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const lighting = createStylizedSceneLighting(scene);
    const before = lighting.lights.map((light) => ({
      uuid: light.uuid,
      parent: light.parent,
      position: light.position.toArray(),
    }));

    camera.position.set(4, 5, 6);
    camera.lookAt(new THREE.Vector3(1, 2, 3));
    updateStylizedSceneLighting(lighting, camera);

    expect(
      lighting.lights.map((light) => ({
        uuid: light.uuid,
        parent: light.parent,
        position: light.position.toArray(),
      })),
    ).toEqual(before);
  });

  it("disposes cleanly and can be rebuilt without leaking light objects", () => {
    const scene = new THREE.Scene();
    const lighting = createStylizedSceneLighting(scene);

    disposeStylizedSceneLighting(lighting, scene);
    expect(scene.children.filter((child) => child instanceof THREE.Light)).toHaveLength(0);

    const rebuilt = createStylizedSceneLighting(scene);
    expect(scene.children.filter((child) => child instanceof THREE.Light)).toHaveLength(2);
    expect(rebuilt.lights[0]).not.toBe(lighting.lights[0]);
    expect(rebuilt.lights[1]).not.toBe(lighting.lights[1]);
  });
});
