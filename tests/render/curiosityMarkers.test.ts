/**
 * The curiosity markers (src/render/three/curiosityMarkers.ts): a glowing "?" disc on the floor where an author put one, with the teaser of its discovery floating over it within 3 m, and a tick instead once the discovery is found. These tests drive them with a real engine for the player's pose and read the scene they build.
 *
 * `document.createElement("canvas")` (the textures) is faked by tests/support/fakeCanvas2d.ts.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { compileCellComplex } from "../../src/cell-complex/compileCellComplex";
import { createCuriosityMarkers, curiosityMarkerLabelRangeMeters, wrapText } from "../../src/render/three/curiosityMarkers";
import { createRuntimeObjectRegistry } from "../../src/world-objects/runtimeObjectRegistry";
import { createTestEngine } from "../support/engine";
import { installFakeCanvas2d } from "../support/fakeCanvas2d";

const world = compileCellComplex({
  cells: [{
    id: "room",
    heightMeters: 3,
    baseVertices: [{ x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: 30 }, { x: -30, y: 30 }],
    portals: [],
  }],
});

function harness(playerX: number) {
  installFakeCanvas2d();
  const scene = new THREE.Scene();
  const found = new Set<string>();
  const markers = createCuriosityMarkers({
    scene,
    camera: new THREE.PerspectiveCamera(),
    engine: createTestEngine({
      registry: createRuntimeObjectRegistry(),
      playerPose: { cellId: "room", position: { x: playerX, y: 0, z: 0 }, yawRadians: 0, pitchRadians: 0 },
    }),
    getWorld: () => world,
    entries: [
      { discoveryId: "near", marker: { cellId: "room", position: { x: 2, y: 0, z: 0 } }, teaser: "something is odd near here" },
      { discoveryId: "far", marker: { cellId: "room", position: { x: 20, y: 0, z: 0 } }, teaser: "something is odd far away" },
    ],
    isFound: (id) => found.has(id),
  });
  const disc = (id: string) => scene.getObjectByName(`curiosity-marker:${id}`) as THREE.Mesh;
  const label = (id: string) => scene.getObjectByName(`curiosity-marker-label:${id}`);
  return { markers, scene, found, disc, label };
}

describe("curiosity markers", () => {
  it("lies a disc on the floor at the marker and shows the teaser only within 3 m", () => {
    expect(curiosityMarkerLabelRangeMeters).toBe(3);
    const { markers, disc, label } = harness(0);
    markers.update(0);

    expect(disc("near").visible).toBe(true);
    // On the floor (the scene's y is up), at the marker's x and y (the scene's -z).
    expect(disc("near").position.x).toBeCloseTo(2, 9);
    expect(disc("near").position.y).toBeGreaterThan(0);
    expect(disc("near").position.y).toBeLessThan(0.1);
    expect(label("near")?.visible).toBe(true);
    expect(label("near")!.position.y).toBeGreaterThan(1);

    expect(disc("far").visible).toBe(true);
    expect(label("far")?.visible).toBe(false);
  });

  it("shows the teaser of a marker the player walks up to", () => {
    const { markers, label } = harness(18);
    markers.update(0);
    expect(label("far")?.visible).toBe(true);
    expect(label("near")?.visible).toBe(false);
  });

  it("turns into a tick when the discovery is found and then shows no label", () => {
    const { markers, found, disc, label } = harness(0);
    markers.update(0);
    const questionMaterial = disc("near").material;

    found.add("near");
    markers.update(1);
    expect(disc("near").visible).toBe(true);
    expect(disc("near").material).not.toBe(questionMaterial);
    expect(label("near")?.visible).toBe(false);
    // The tick does not pulse.
    expect(disc("near").scale.x).toBe(1);
  });

  it("is removed from the scene on dispose", () => {
    const { markers, scene, disc } = harness(0);
    markers.update(0);
    markers.dispose();
    expect(disc("near")).toBeUndefined();
    expect(scene.children).toHaveLength(0);
  });
});

describe("wrapText", () => {
  const measure = { measureText: (text: string) => ({ width: text.length * 10 }) };

  it("breaks at spaces so no line is wider than the limit", () => {
    expect(wrapText(measure, "something happens when a beam reaches a corner", 200)).toEqual([
      "something happens",
      "when a beam reaches",
      "a corner",
    ]);
  });

  it("keeps a word longer than the limit on a line of its own and an empty text empty", () => {
    expect(wrapText(measure, "extraordinarily short", 100)).toEqual(["extraordinarily", "short"]);
    expect(wrapText(measure, "", 100)).toEqual([]);
  });
});
