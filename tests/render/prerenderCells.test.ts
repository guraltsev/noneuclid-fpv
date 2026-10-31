/**
 * Render warm-up (src/render/three/prerenderCells.ts): makes every cell mesh visible once so the renderer compiles
 * every shader and uploads every texture before play, then restores only the active cell's visibility and the
 * camera's original position, rotation order and orientation.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { prerenderCells } from "../../src/render/three/prerenderCells";

describe("prerenderCells", () => {
  it("prerenders every cell once and restores the active cell visibility", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const renderer = {
      compile: vi.fn(),
      render: vi.fn(),
    };
    const activeCell = new THREE.Group();
    const inactiveCell = new THREE.Group();
    activeCell.visible = false;
    inactiveCell.visible = false;
    const cellMeshes = new Map<string, THREE.Object3D>([
      ["room-a", activeCell],
      ["room-b", inactiveCell],
    ]);

    prerenderCells({
      renderer,
      scene,
      camera,
      cellMeshes,
      activeCellId: "room-a",
    });

    expect(renderer.compile).toHaveBeenCalledOnce();
    expect(renderer.render).toHaveBeenCalledOnce();
    expect(activeCell.visible).toBe(true);
    expect(inactiveCell.visible).toBe(false);
  });

  it("restores the camera pose after moving it to render warm-up views", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 2, 3);
    camera.lookAt(5, 6, 7);
    camera.updateMatrixWorld(true);
    const originalPosition = camera.position.clone();
    const originalQuaternion = camera.quaternion.clone();
    const originalOrder = camera.rotation.order;

    prerenderCells({
      renderer: { compile: vi.fn(), render: vi.fn() },
      scene,
      camera,
      cellMeshes: new Map([["room-a", new THREE.Group()]]),
      activeCellId: "room-a",
      warmupViewsByCellId: new Map([["room-a", [{ position: { x: 9, y: 9, z: 1.6 }, yawRadians: 1 }]]]),
    });

    expect(camera.position.equals(originalPosition)).toBe(true);
    // A quaternion and its negation represent the same rotation, so compare the angle between them, not components.
    expect(camera.quaternion.angleTo(originalQuaternion)).toBeCloseTo(0, 9);
    expect(camera.rotation.order).toBe(originalOrder);
  });

  it("shows hidden instanced archetypes while compiling and hides them again", () => {
    const scene = new THREE.Scene();
    const archetype = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    archetype.visible = false;
    scene.add(archetype);
    const visibleAtCompile: boolean[] = [];
    const renderer = {
      compile: vi.fn(() => {
        visibleAtCompile.push(archetype.visible);
        return new Set<THREE.Material>();
      }),
      render: vi.fn(),
    };

    prerenderCells({
      renderer,
      scene,
      camera: new THREE.PerspectiveCamera(),
      cellMeshes: new Map([["room-a", new THREE.Group()]]),
      activeCellId: "room-a",
    });

    expect(visibleAtCompile).toEqual([true]);
    expect(archetype.visible).toBe(false);
  });
});
