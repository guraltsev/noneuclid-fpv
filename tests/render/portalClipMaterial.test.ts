/**
 * Portal clip material (src/render/three/portalClipMaterial.ts): patches a material's shader in place so an
 * instanced mesh can be clipped per-instance against the visible portal paths' clip planes.
 *
 * Contract: after patching, the material exposes `portalClipPlaneTexture`, `portalClipEyeIndex` and
 * `portalClipEyeCount` uniforms; its program cache key ends in `:hw` in hardware clip-distance mode and `:frag`
 * otherwise, so the two modes never share a compiled program; and only hardware mode sets
 * `material.extensions.clipCullDistance`. `updatePortalClipMaterialTextureEye` floors and clamps the eye index to
 * `[0, maxClipTextureEyes - 1]`. `createPortalClipDistanceToggle` enables/disables the four
 * `CLIP_DISTANCEi_WEBGL` flags the hardware mode's shader writes, and is `undefined` when the renderer lacks the
 * `WEBGL_clip_cull_distance` extension. The generated GLSL itself is not asserted here (tests.md §2.2): it is an
 * implementation detail of shader generation, not part of this contract.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPortalClipData } from "../../src/render/three/portalClipData";
import {
  createPortalClipDistanceToggle,
  createPortalClipMaterialState,
  patchPortalClipMaterial,
  updatePortalClipMaterialTextureEye,
} from "../../src/render/three/portalClipMaterial";
import { createFakeRenderer } from "../support/fakeRenderer";

function compile(hardwareClipDistances: boolean) {
  const clipData = createPortalClipData({ maxVisiblePaths: 16 });
  const state = createPortalClipMaterialState(clipData, { hardwareClipDistances });
  const material = patchPortalClipMaterial(new THREE.MeshBasicMaterial(), state) as THREE.Material;
  const shader = { uniforms: {}, vertexShader: "void main() {}", fragmentShader: "void main() {}" };

  material.onBeforeCompile(shader as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);

  return { clipData, state, material };
}

describe("portal clip material", () => {
  it.each([
    ["software (fragment discard)", false, ":frag", undefined],
    ["hardware (gl_ClipDistance)", true, ":hw", true],
  ] as const)("exposes the clip uniforms and a cache key naming the mode: %s", (_label, hardwareClipDistances, cacheKeySuffix, clipCullDistance) => {
    const { clipData, material } = compile(hardwareClipDistances);

    expect(material.customProgramCacheKey().endsWith(cacheKeySuffix)).toBe(true);
    expect((material as { extensions?: { clipCullDistance?: boolean } }).extensions?.clipCullDistance).toBe(clipCullDistance);
    clipData.dispose();
  });

  it("clamps the active eye index and reports the eye count", () => {
    const { clipData, state } = compile(false);

    updatePortalClipMaterialTextureEye(state, 1);
    expect(state.uniforms.portalClipEyeIndex.value).toBe(1);
    updatePortalClipMaterialTextureEye(state, 9);
    expect(state.uniforms.portalClipEyeIndex.value).toBe(1);
    updatePortalClipMaterialTextureEye(state, -3);
    expect(state.uniforms.portalClipEyeIndex.value).toBe(0);
    expect(state.uniforms.portalClipEyeCount.value).toBe(2);
    clipData.dispose();
  });

  it("exposes the three uniforms the shader reads after patching", () => {
    const { clipData, material } = compile(false);
    const shader = { uniforms: {}, vertexShader: "void main() {}", fragmentShader: "void main() {}" };

    material.onBeforeCompile(shader as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);

    expect(Object.keys(shader.uniforms)).toEqual(
      expect.arrayContaining(["portalClipPlaneTexture", "portalClipEyeIndex", "portalClipEyeCount"]),
    );
    clipData.dispose();
  });

  it("toggles the four clip distances on the gl context", () => {
    const calls: [string, number][] = [];
    const glContext = {
      enable: (value: number) => calls.push(["enable", value]),
      disable: (value: number) => calls.push(["disable", value]),
    };
    const renderer = createFakeRenderer({
      extensions: { has: () => true, get: () => ({ CLIP_DISTANCE0_WEBGL: 0x3000 }) },
      glContext,
    });
    const toggle = createPortalClipDistanceToggle(renderer as unknown as THREE.WebGLRenderer)!;

    toggle.enable();
    expect(calls).toEqual([0x3000, 0x3001, 0x3002, 0x3003].map((value) => ["enable", value]));
    calls.length = 0;
    toggle.disable();
    expect(calls).toEqual([0x3000, 0x3001, 0x3002, 0x3003].map((value) => ["disable", value]));
  });

  it("returns no toggle without WEBGL_clip_cull_distance", () => {
    const renderer = createFakeRenderer({ extensions: { has: () => false, get: () => null } });

    expect(createPortalClipDistanceToggle(renderer as unknown as THREE.WebGLRenderer)).toBeUndefined();
  });
});
