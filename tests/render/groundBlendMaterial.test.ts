/**
 * `tests/render/groundBlendMaterial.test.ts` — unit tier.
 *
 * `patchGroundBlendMaterial` declares every attribute, varying and uniform it uses in the right shader, replaces the map chunk so the own
 * texel is applied once, keeps the tokens the portal clip patch needs, chains an earlier hook and cache key, and its share formula (ported
 * here to TypeScript) gives the two cells of a portal complementary shares at the side itself. The GLSL is not compiled here.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { patchGroundBlendMaterial, type GroundBlendOptions } from "../../src/render/three/groundBlendMaterial";
import { createGroundTintTexture } from "../../src/render/three/groundTintMaterial";
import { computeGroundTint } from "../../src/world-assets/groundTint";

const tint = computeGroundTint(
  { id: "c", baseVertices: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], objects: [], floorMaterial: { kind: "floor-color", floorColor: "#fff" } },
  { width: 4, height: 4 },
);

function options(texture: THREE.Texture, enabled = true): GroundBlendOptions {
  return {
    ownTint: { tint, texture },
    neighbourTint: { tint, texture },
    neighbourMap: new THREE.Texture(),
    neighbourColor: new THREE.Color("#ffffff"),
    halfWidthMeters: 1.5,
    noiseAmplitudeMeters: 1.1,
    cornerSlopes: [0.85, 0.85],
    seed: 3,
    enabled,
  };
}

// Compiles the patch against the stock standard-material sources, as three.js would before resolving the includes.
function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);
  return shader;
}

const declared = (source: string, keyword: string) => [...source.matchAll(new RegExp(`${keyword} (?:highp |mediump )?\\w+ (\\w+);`, "g"))].map((match) => match[1]);

describe("ground blend material", () => {
  const texture = createGroundTintTexture(tint);

  it("declares every varying in both shaders and every attribute in the vertex shader", () => {
    const shader = compile(patchGroundBlendMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), options(texture)));
    const vertexVaryings = declared(shader.vertexShader, "varying");
    const fragmentVaryings = declared(shader.fragmentShader, "varying");
    for (const name of ["vGroundTintPoint", "vNeighbourUv", "vNeighbourPoint", "vBlendCoord", "vBlendLength", "vBlendSign"]) {
      expect(vertexVaryings).toContain(name);
      expect(fragmentVaryings).toContain(name);
      expect(shader.vertexShader).toMatch(new RegExp(`${name} = `));
    }
    for (const name of ["neighbourUv", "neighbourPoint", "blendCoord", "blendLength", "blendSign"]) {
      expect(declared(shader.vertexShader, "attribute")).toContain(name);
    }
    const uniforms = declared(shader.fragmentShader, "uniform");
    for (const name of Object.keys(shader.uniforms)) {
      expect(uniforms).toContain(name);
    }
  });

  it("replaces the map chunk and keeps the tokens the portal clip patch needs", () => {
    const shader = compile(patchGroundBlendMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), options(texture)));
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
    expect(shader.fragmentShader).toContain("diffuseColor.rgb = mix(ownGround, neighbourGround, neighbourShare)");
    expect(shader.fragmentShader.match(/texture2D\(map, vMapUv\)/g)).toHaveLength(1);
    for (const token of ["#include <common>", "#include <begin_vertex>", "#include <project_vertex>", "void main() {"]) {
      expect(shader.vertexShader).toContain(token);
    }
    expect(shader.fragmentShader).toContain("#include <common>");
    expect(shader.fragmentShader.indexOf("diffuseColor.rgb = mix(")).toBeGreaterThan(shader.fragmentShader.indexOf("void main() {"));
  });

  it("sets the uniforms from the options and switches the share off on a wall", () => {
    const on = compile(patchGroundBlendMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), options(texture)));
    const off = compile(patchGroundBlendMaterial(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), options(texture, false)));
    expect(on.uniforms.blendStrength.value).toBe(1);
    expect(off.uniforms.blendStrength.value).toBe(0);
    expect(on.uniforms.blendHalfWidth.value).toBe(1.5);
    expect(on.uniforms.blendNoiseAmplitude.value).toBe(1.1);
    expect(on.uniforms.blendSeed.value).toBe(3);
    expect(on.uniforms.groundTintGain.value).toBeGreaterThan(1);
  });

  it("chains an earlier hook and cache key", () => {
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    let earlier = 0;
    material.onBeforeCompile = () => {
      earlier += 1;
    };
    material.customProgramCacheKey = () => "earlier:";
    patchGroundBlendMaterial(material, options(texture));
    compile(material);
    expect(earlier).toBe(1);
    expect(material.customProgramCacheKey()).toBe("earlier:ground-blend:");
  });
});

// TypeScript port of the share in the fragment shader: the neighbour's share for a point at canonical (s) with sign and wander n.
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function neighbourShare(blendSign: number, canonicalS: number, wander: number, halfWidth: number): number {
  return 1 - smoothstep(-halfWidth, halfWidth, blendSign * (canonicalS + wander));
}

describe("neighbour share", () => {
  it("is complementary on the two sides of a portal at the side itself", () => {
    for (const wander of [-1.1, -0.4, 0, 0.3, 1.1]) {
      const canonical = neighbourShare(1, 0, wander, 1.5);
      const other = neighbourShare(-1, 0, wander, 1.5);
      expect(canonical + other).toBeCloseTo(1, 12);
    }
  });

  it("is 0.5 on the side and 0 on the inner edge of the strip whatever the wander", () => {
    expect(neighbourShare(1, 0, 0, 1.5)).toBeCloseTo(0.5, 12);
    // Inner edge: distance into the cell is the strip width 2.6 = h + amplitude, wander at worst -1.1.
    expect(neighbourShare(1, 2.6, -1.1, 1.5)).toBe(0);
    expect(neighbourShare(-1, -2.6, -1.1, 1.5)).toBe(0);
  });
});
