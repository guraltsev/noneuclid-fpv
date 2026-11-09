/**
 * `tests/render/worldMessageDisplay.test.ts` — unit tier.
 *
 * The on-screen message display shows one message at a time in front of the camera, for its duration plus a fade,
 * and a new message replaces the old one. Without a DOM nothing is drawn, so these tests check the timing, the
 * placement and the opacity of the plane it adds to the scene.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createWorldMessageDisplay } from "../../src/render/three/worldMessageDisplay";

function setup() {
  let nowMs = 1000;
  const scene = new THREE.Scene();
  const display = createWorldMessageDisplay(scene, { durationMs: 3000, fadeMs: 500, now: () => nowMs });
  const camera = new THREE.PerspectiveCamera();
  const mesh = scene.getObjectByName("world-message") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  return { display, camera, mesh, scene, at: (ms: number) => { nowMs = ms; } };
}

describe("worldMessageDisplay", () => {
  it("shows a message in front of the camera, fades it, then hides it", () => {
    const { display, camera, mesh } = setup();
    expect(mesh.visible).toBe(false);

    display.show("That geodesic cannot go any further.");
    display.update(camera, 1500);
    expect(display.currentMessage()).toBe("That geodesic cannot go any further.");
    expect(mesh.visible).toBe(true);
    expect(mesh.material.opacity).toBe(1);
    expect(mesh.position.z).toBeLessThan(-1);

    display.update(camera, 4250);
    expect(mesh.material.opacity).toBeCloseTo(0.5);

    display.update(camera, 4600);
    expect(mesh.visible).toBe(false);
    expect(display.currentMessage()).toBeUndefined();
  });

  it("replaces the message on screen and restarts its time", () => {
    const { display, camera, at } = setup();
    display.show("First");
    at(3500);
    display.show("Second");
    display.update(camera, 5000);
    expect(display.currentMessage()).toBe("Second");
  });

  it("removes its plane from the scene on dispose", () => {
    const { display, scene } = setup();
    display.dispose();
    expect(scene.getObjectByName("world-message")).toBeUndefined();
  });
});
