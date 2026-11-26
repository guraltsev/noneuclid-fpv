/**
 * `tests/render/generatedCreatureMesh.test.ts` — unit tier.
 *
 * The creature bodies generated in code (design 018 section 8.5): one merged vertex-coloured mesh per body, deterministic per seed, within its triangle budget, with unit normals and the intended bounds, and a render footprint that the portal ghosts can be decided by.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GeneratedCreatureKind } from "../../src/cell-complex/specs";
import { buildGeneratedCreatureRoot, generatedCreatureTriangleBudget } from "../../src/render/three/creatures/generatedCreatureMesh";
import { placeSimpleGeoCreatureModel } from "../../src/render/three/creatures/simpleGeoCreatureView";
import { collectRuntimeObjectRenderSourceMeshes, computeRenderSourceFootprint } from "../../src/render/three/runtimeObjectRenderRecords";
import { createGeneratedGeoCreature } from "../../src/world-objects/simpleGeoCreature";

const kinds: readonly GeneratedCreatureKind[] = ["stilt-walker", "drifting-mobile", "rolling-eye"];

function meshOf(kind: GeneratedCreatureKind, seed: number): THREE.Mesh {
  const meshes: THREE.Mesh[] = [];
  buildGeneratedCreatureRoot(kind, seed).traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  expect(meshes).toHaveLength(1);
  return meshes[0];
}

function triangles(mesh: THREE.Mesh): number {
  return mesh.geometry.getAttribute("position").count / 3;
}

describe("generated creature meshes", () => {
  it.each(kinds)("builds %s as one non-indexed coloured mesh with a stock material", (kind) => {
    const mesh = meshOf(kind, 7);
    const material = mesh.material as THREE.MeshLambertMaterial;

    expect(mesh.geometry.index).toBeNull();
    expect(mesh.geometry.getAttribute("color")).toBeDefined();
    expect(material.type).toBe("MeshLambertMaterial");
    expect(material.vertexColors).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
  });

  it.each(kinds)("keeps %s within its triangle budget", (kind) => {
    for (const seed of [1, 2, 3, 99]) {
      expect(triangles(meshOf(kind, seed))).toBeLessThanOrEqual(generatedCreatureTriangleBudget[kind]);
    }
  });

  it.each(kinds)("builds %s the same for the same seed and differently for another", (kind) => {
    const first = Array.from(meshOf(kind, 5).geometry.getAttribute("position").array);
    const again = Array.from(meshOf(kind, 5).geometry.getAttribute("position").array);
    const other = Array.from(meshOf(kind, 6).geometry.getAttribute("position").array);

    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it.each(kinds)("gives %s unit normals", (kind) => {
    const normals = meshOf(kind, 3).geometry.getAttribute("normal");
    for (let index = 0; index < normals.count; index += 1) {
      expect(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index))).toBeCloseTo(1, 4);
    }
  });

  it("puts the stilt-walker's feet on the ground and its body above 2.4 m", () => {
    for (const seed of [1, 2, 3, 4]) {
      const mesh = meshOf("stilt-walker", seed);
      const box = mesh.geometry.boundingBox!;
      const positions = mesh.geometry.getAttribute("position");
      let bodyBottom = Infinity;
      for (let index = 0; index < positions.count; index += 1) {
        // Anything wider than the legs' splay near the middle of the body is the body, not a leg: take the points above 2.4 m and the lowest point of the ellipsoid by x extent.
        if (Math.abs(positions.getX(index)) < 0.31 && Math.abs(positions.getZ(index)) < 0.46 && positions.getY(index) > 2.4) {
          bodyBottom = Math.min(bodyBottom, positions.getY(index));
        }
      }

      expect(box.min.y).toBeGreaterThan(-0.001);
      expect(box.min.y).toBeLessThan(0.03);
      expect(bodyBottom).toBeGreaterThan(2.4);
      expect(box.max.y).toBeGreaterThan(3.0);
      expect(box.max.y).toBeLessThan(4.3);
    }
  });

  it("makes the rolling eye a 0.6 m sphere resting on the ground", () => {
    const box = meshOf("rolling-eye", 1).geometry.boundingBox!;

    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.55);
    expect(box.max.y - box.min.y).toBeLessThan(0.68);
  });

  it("hangs the mobile on a 1.6 m wire about its origin", () => {
    const box = meshOf("drifting-mobile", 1).geometry.boundingBox!;

    expect(box.min.y).toBeCloseTo(-0.8, 2);
    expect(box.max.y).toBeGreaterThan(0.8);
    expect(box.max.y).toBeLessThan(1.2);
  });

  it.each(kinds)("measures a render footprint for %s as the creature view places it", (kind) => {
    const spec = createGeneratedGeoCreature("c", { kind, seed: 1 }, { position: [0, 0, 0] });
    const root = new THREE.Group();
    const scene = buildGeneratedCreatureRoot(kind, 1);
    placeSimpleGeoCreatureModel(scene, spec);
    root.add(scene);
    const footprint = computeRenderSourceFootprint(collectRuntimeObjectRenderSourceMeshes("c", root, "p"));

    expect(footprint).toBeDefined();
    expect(footprint!.radiusMeters).toBeGreaterThan(0.2);
  });
});
