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
    expect(activeCell.userData.prerenderedByDefault).toBe(true);
    expect(activeCell.userData.prerendered).toBe(true);
    expect(inactiveCell.userData.prerenderedByDefault).toBe(true);
    expect(inactiveCell.userData.prerendered).toBe(true);
    expect(inactiveCell.userData.previousVisible).toBe(false);
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
