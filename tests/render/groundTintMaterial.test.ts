/**
 * `tests/render/groundTintMaterial.test.ts` — unit tier.
 *
 * `patchGroundTintMaterial` adds the tint uniforms and varying, inserts the multiply before the colour chunk (so it
 * works whether or not the floor patch replaced the map chunk), chains an earlier hook and cache key, and leaves the
 * tokens the portal clip patch needs. The generated GLSL is not compiled here.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createGroundTintTexture, groundTintGain, patchGroundTintMaterial } from "../../src/render/three/groundTintMaterial";
import { computeGroundTint } from "../../src/world-assets/groundTint";

const tint = computeGroundTint(
  {
    id: "c",
    baseVertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
    objects: [],
    floorMaterial: { kind: "floor-color", floorColor: "#fff" },
  },
  { width: 4, height: 4 },
);

function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: "#include <common>\n#include <begin_vertex>\n#include <project_vertex>\nvoid main() {",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <color_fragment>\nvoid main() {",
  };
  material.onBeforeCompile(shader as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);
  return shader;
}

describe("ground tint material", () => {
  it("creates a linear, clamped, non-colour-managed texture", () => {
    const texture = createGroundTintTexture(tint);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    texture.dispose();
  });

  it("patches the shader before the colour chunk and keeps the other chunks", () => {
    const texture = createGroundTintTexture(tint);
    const shader = compile(patchGroundTintMaterial(new THREE.MeshStandardMaterial(), texture, tint, 1.5));
    expect(Object.keys(shader.uniforms).sort()).toEqual(["groundTintGain", "groundTintMap", "groundTintOrigin", "groundTintSize"]);
    expect(shader.uniforms.groundTintGain.value).toBe(1.5);
    expect(shader.fragmentShader).toContain("#include <map_fragment>");
    expect(shader.fragmentShader.indexOf("groundTintMap, (")).toBeLessThan(shader.fragmentShader.indexOf("#include <color_fragment>"));
    expect(shader.vertexShader).toContain("#include <begin_vertex>");
    expect(shader.vertexShader).toContain("#include <project_vertex>");
    expect(groundTintGain).toBeGreaterThan(1);
    texture.dispose();
  });

  it("chains an earlier hook and cache key", () => {
    const texture = createGroundTintTexture(tint);
    const material = new THREE.MeshStandardMaterial();
    let earlier = 0;
    material.onBeforeCompile = () => {
      earlier += 1;
    };
    material.customProgramCacheKey = () => "earlier:";
    patchGroundTintMaterial(material, texture, tint);
    compile(material);
    expect(earlier).toBe(1);
    expect(material.customProgramCacheKey()).toBe("earlier:ground-tint:");
    texture.dispose();
  });
});
