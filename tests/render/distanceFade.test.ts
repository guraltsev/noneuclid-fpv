/**
 * `tests/render/distanceFade.test.ts` — unit tier.
 *
 * The radial fog replaces three.js's view-depth fog with the distance from the eye, and the dithered fade patch declares what it uses in the
 * right shader, keeps the tokens the portal clip patch needs and chains an earlier hook and cache key. The GLSL is not compiled here.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createSceneFog,
  landmarkMaxDrawDistanceMeters,
  patchDistanceFadeMaterial,
  sceneFogFarMeters,
  sceneryFadeEndMeters,
  sceneryFadeStartMeters,
} from "../../src/render/three/distanceFade";

function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);
  return shader;
}

describe("distance fade", () => {
  it("fogs by the distance from the eye and culls landmarks only where the fog is complete", () => {
    const fog = createSceneFog(0xffffff);
    expect(fog.far).toBe(sceneFogFarMeters);
    expect(THREE.ShaderChunk.fog_vertex).toContain("length( mvPosition.xyz )");
    expect(THREE.ShaderChunk.fog_vertex).not.toContain("- mvPosition.z");
    expect(landmarkMaxDrawDistanceMeters).toBeGreaterThanOrEqual(sceneFogFarMeters);
    expect(sceneryFadeStartMeters).toBeLessThan(sceneryFadeEndMeters);
  });

  it("declares what it uses, discards after the clipping planes, keeps the clip tokens", () => {
    const shader = compile(patchDistanceFadeMaterial(new THREE.MeshStandardMaterial(), { startMeters: 10, endMeters: 20 }));
    expect(shader.vertexShader).toContain("varying float vDistanceFadeEye;");
    expect(shader.vertexShader).toContain("vDistanceFadeEye = length( mvPosition.xyz );");
    expect(shader.fragmentShader).toContain("varying float vDistanceFadeEye;");
    expect(shader.fragmentShader).toContain("uniform float distanceFadeStart;");
    expect(shader.fragmentShader).toContain("uniform float distanceFadeEnd;");
    expect(shader.uniforms.distanceFadeStart.value).toBe(10);
    expect(shader.uniforms.distanceFadeEnd.value).toBe(20);
    expect(shader.fragmentShader.indexOf("discard")).toBeGreaterThan(shader.fragmentShader.indexOf("#include <clipping_planes_fragment>"));
    for (const token of ["#include <common>", "#include <begin_vertex>", "#include <project_vertex>", "void main() {"]) {
      expect(shader.vertexShader).toContain(token);
    }
  });

  it("chains an earlier hook and cache key", () => {
    const material = new THREE.MeshStandardMaterial();
    let earlier = 0;
    material.onBeforeCompile = () => {
      earlier += 1;
    };
    material.customProgramCacheKey = () => "earlier:";
    patchDistanceFadeMaterial(material, { startMeters: 1, endMeters: 2 });
    compile(material);
    expect(earlier).toBe(1);
    expect(material.customProgramCacheKey()).toBe("earlier:distance-fade:");
  });
});
