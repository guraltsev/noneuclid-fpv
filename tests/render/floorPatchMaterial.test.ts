/**
 * `tests/render/floorPatchMaterial.test.ts` — unit tier.
 *
 * `patchFloorPatchMaterial` installs the rigid floor patch shader hook on a material that carries `userData.floorPatchField`. Contract: a material without a
 * field is untouched; with a field the eight uniforms exist and the map chunk is replaced; the tokens that the portal clip patch needs stay in place; and the field
 * survives `Material.clone()` through `userData`, while the hook and key do not (so each clone must be patched). The generated GLSL is not compiled here.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { FloorPatchField } from "../../src/cell-complex/floorUv";
import { patchFloorPatchMaterial } from "../../src/render/three/floorPatchMaterial";

const field: FloorPatchField = {
  origin: { x: -7.5, y: -7.5 },
  step1: { x: 1.25, y: 0 },
  step2: { x: 0, y: 2.5 },
  inverseRow1: { x: 0.8, y: 0 },
  inverseRow2: { x: 0, y: 0.4 },
  metersToUvRow1: { x: 0.4, y: 0 },
  metersToUvRow2: { x: 0, y: 0.4 },
  inverseRadiusSquared: 0.33,
};

function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: "#include <common>\n#include <begin_vertex>\n#include <project_vertex>\nvoid main() {",
    fragmentShader: "#include <common>\n#include <map_fragment>\nvoid main() {",
  };
  material.onBeforeCompile(shader as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);
  return shader;
}

function patched() {
  const material = new THREE.MeshStandardMaterial();
  material.userData.floorPatchField = field;
  return patchFloorPatchMaterial(material);
}

describe("floor patch material", () => {
  it("leaves a material without a field alone", () => {
    const fresh = new THREE.MeshStandardMaterial();
    const material = patchFloorPatchMaterial(new THREE.MeshStandardMaterial());
    expect(material.onBeforeCompile).toBe(fresh.onBeforeCompile);
    expect(material.customProgramCacheKey()).toBe(fresh.customProgramCacheKey());
  });

  it("installs uniforms and replaces the map chunk", () => {
    const shader = compile(patched());
    expect(Object.keys(shader.uniforms).sort()).toEqual(
      [
        "floorPatchInverseRadiusSquared",
        "floorPatchInverseRow1",
        "floorPatchInverseRow2",
        "floorPatchMetersToUvRow1",
        "floorPatchMetersToUvRow2",
        "floorPatchOrigin",
        "floorPatchStep1",
        "floorPatchStep2",
      ].sort(),
    );
    expect((shader.uniforms.floorPatchOrigin.value as THREE.Vector2).toArray()).toEqual([-7.5, -7.5]);
    expect((shader.uniforms.floorPatchStep2.value as THREE.Vector2).toArray()).toEqual([0, 2.5]);
    expect(shader.uniforms.floorPatchInverseRadiusSquared.value).toBe(0.33);
    expect(shader.fragmentShader).toContain("textureGrad");
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
  });

  it("keeps the tokens that the clip patch needs", () => {
    const shader = compile(patched());
    for (const token of ["#include <common>", "#include <begin_vertex>", "#include <project_vertex>", "void main() {"]) {
      expect(shader.vertexShader).toContain(token);
    }
    expect(shader.fragmentShader).toContain("#include <common>");
    expect(shader.fragmentShader).toContain("void main() {");
  });

  it("survives clone through userData", () => {
    const original = patched();
    const clone = original.clone();
    expect(clone.customProgramCacheKey()).toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
    const repatched = patchFloorPatchMaterial(clone);
    expect(repatched.customProgramCacheKey()).toContain("floor-rigid-patches");
    expect((compile(repatched).uniforms.floorPatchStep1.value as THREE.Vector2).toArray()).toEqual([1.25, 0]);
  });
});
