/**
 * `tests/render/decorationPalette.test.ts` — unit tier.
 *
 * Recolouring a decoration clones its materials (the shared preloaded asset is untouched), gives each distinct material a palette role in
 * turn, and marks it in userData so the hook survives the clone the instanced copies are made from. The hook replaces the map chunk with
 * the texture followed by the recolouring. The recolouring (ported here) keeps a surface's brightness and moves its hue to the role's, so
 * green leaves take a red face's hue and a dark trunk stays dark with a trace of it.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyDecorationRecolor, decorationTint, recolorDecoration, recoloredSurface } from "../../src/render/three/decorationPalette";
import { buildFacePalette, hexToLinearRgb } from "../../src/world-assets/facePalettes";

const luminance = (color: readonly number[]) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
const palette = buildFacePalette(0, "analogous");

function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);
  return shader;
}

describe("recolorDecoration", () => {
  it("clones shared materials, recolours each distinct one once and keeps the asset's own", () => {
    const shared = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const other = new THREE.MeshStandardMaterial({ color: 0x404040 });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), [other, shared]));

    expect(recolorDecoration(root, palette)).toBe(2);
    expect(shared.userData.decorationRecolor).toBeUndefined();
    const [first, second, third] = root.children as THREE.Mesh[];
    expect(first.material).toBe(second.material);
    expect(first.material).not.toBe(shared);
    expect((third.material as THREE.Material[])[1]).toBe(first.material);
    expect((first.material as THREE.Material).userData.decorationRecolor.tint).toEqual(decorationTint(palette.primary));
  });

  it("survives a clone: the drawn clone gets the hook again from userData", () => {
    const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
    recolorDecoration(root, palette);
    const drawn = applyDecorationRecolor((root.material as THREE.Material).clone());
    const shader = compile(drawn);
    expect(shader.fragmentShader).toContain("decorationRecolorStrength");
    expect(shader.fragmentShader.indexOf("#include <map_fragment>")).toBeLessThan(shader.fragmentShader.indexOf("* mix(vec3(1.0), decorationTint"));
    expect(shader.uniforms.decorationTint).toBeDefined();
    expect(drawn.customProgramCacheKey()).toContain("decoration-recolor:");
    expect(applyDecorationRecolor(new THREE.MeshStandardMaterial()).customProgramCacheKey()).not.toContain("decoration-recolor");
  });

  it("turns green leaves to the face's hue and keeps a dark trunk dark", () => {
    const recolor = { tint: decorationTint(palette.primary), strength: 0.85 };
    const leaves = recoloredSurface(hexToLinearRgb("#3f8f2f"), recolor);
    expect(leaves[0]).toBeGreaterThan(leaves[1]);
    // A strong tint is capped, so the leaves keep most of their brightness, not all of it.
    expect(luminance(leaves)).toBeGreaterThan(0.6 * luminance(hexToLinearRgb("#3f8f2f")));
    const trunk = recoloredSurface(hexToLinearRgb("#3b2a1e"), recolor);
    expect(luminance(trunk)).toBeLessThan(0.05);
    expect(trunk[0]).toBeGreaterThan(trunk[2]);
  });
});
