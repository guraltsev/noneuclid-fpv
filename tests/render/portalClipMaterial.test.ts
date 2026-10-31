import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPortalClipData } from "../../src/render/three/portalClipData";
import {
  createPortalClipDistanceToggle,
  createPortalClipMaterialState,
  patchPortalClipMaterial,
  updatePortalClipMaterialTextureEye,
} from "../../src/render/three/portalClipMaterial";

function compile(hardwareClipDistances: boolean) {
  const clipData = createPortalClipData({ maxVisiblePaths: 16 });
  const state = createPortalClipMaterialState(clipData, { hardwareClipDistances });
  const material = patchPortalClipMaterial(new THREE.MeshBasicMaterial(), state) as THREE.Material;
  const shader = {
    uniforms: {},
    vertexShader: [
      "#include <common>",
      "void main() {",
      "#include <begin_vertex>",
      "#include <project_vertex>",
      "}",
    ].join("\n"),
    fragmentShader: [
      "#include <common>",
      "void main() {",
      "gl_FragColor = vec4(1.0);",
      "}",
    ].join("\n"),
  };

  material.onBeforeCompile(shader as Parameters<THREE.Material["onBeforeCompile"]>[0], {} as THREE.WebGLRenderer);

  return { clipData, state, material, shader };
}

describe("portal clip material", () => {
  it("patches materials with plane fetches in the vertex stage and a single compare in the fragment stage", () => {
    const { clipData, state, material, shader } = compile(false);

    expect(shader.vertexShader).toContain("attribute float portalPathId;");
    expect(shader.vertexShader).toContain("attribute float portalClipIndex;");
    expect(shader.vertexShader).toContain("texelFetch(portalClipPlaneTexture");
    expect(shader.vertexShader).toContain("vPortalClipDistances = portalClipDistances;");
    expect(shader.vertexShader).toContain("if (portalClipIndex >= -0.5)");
    expect(shader.vertexShader).toContain("gl_Position.z += min(0.00008 * gl_Position.w, 0.0008);");
    expect(shader.vertexShader).toContain("modelMatrix * instanceMatrix * vec4(transformed, 1.0)");
    expect(shader.vertexShader).toContain("#define PORTAL_CLIP_EPSILON 0.00001");
    expect(shader.vertexShader).not.toContain("#define PORTAL_CLIP_HARDWARE");
    expect(shader.fragmentShader).toContain("any(lessThan(vPortalClipDistances");
    expect(shader.fragmentShader).toContain("discard;");
    expect(shader.fragmentShader).not.toContain("texture2D(");
    expect(shader.fragmentShader).not.toMatch(/\btexture\(/);
    expect(shader.fragmentShader).not.toContain("for (");
    expect(Object.keys(shader.uniforms)).toEqual(
      expect.arrayContaining(["portalClipPlaneTexture", "portalClipEyeIndex", "portalClipEyeCount"]),
    );
    expect(material.customProgramCacheKey()).toMatch(/:frag$/);
    expect((material as { extensions?: unknown }).extensions).toBeUndefined();

    updatePortalClipMaterialTextureEye(state, 1);
    expect(state.uniforms.portalClipEyeIndex.value).toBe(1);
    updatePortalClipMaterialTextureEye(state, 9);
    expect(state.uniforms.portalClipEyeIndex.value).toBe(1);
    updatePortalClipMaterialTextureEye(state, -3);
    expect(state.uniforms.portalClipEyeIndex.value).toBe(0);
    expect(state.uniforms.portalClipEyeCount.value).toBe(2);

    clipData.dispose();
  });

  it("writes gl_ClipDistance and contains no discard in hardware mode", () => {
    const { clipData, material, shader } = compile(true);

    expect(shader.vertexShader).toContain("#define PORTAL_CLIP_HARDWARE");
    expect(shader.vertexShader).toMatch(/#ifdef PORTAL_CLIP_HARDWARE[\s\S]*gl_ClipDistance\[3\] = portalClipDistances\.w;[\s\S]*#else/);
    expect(shader.fragmentShader).not.toContain("discard");
    expect(shader.fragmentShader).not.toContain("vPortalClipDistances");
    expect((material as unknown as { extensions: { clipCullDistance: boolean } }).extensions.clipCullDistance).toBe(true);
    expect(material.customProgramCacheKey()).toMatch(/:hw$/);

    clipData.dispose();
  });

  it("toggles the four clip distances on the gl context", () => {
    const calls: [string, number][] = [];
    const gl = {
      enable: (value: number) => calls.push(["enable", value]),
      disable: (value: number) => calls.push(["disable", value]),
    };
    const renderer = {
      extensions: { has: () => true, get: () => ({ CLIP_DISTANCE0_WEBGL: 0x3000 }) },
      getContext: () => gl,
    } as unknown as THREE.WebGLRenderer;
    const toggle = createPortalClipDistanceToggle(renderer)!;

    toggle.enable();
    expect(calls).toEqual([0x3000, 0x3001, 0x3002, 0x3003].map((value) => ["enable", value]));
    calls.length = 0;
    toggle.disable();
    expect(calls).toEqual([0x3000, 0x3001, 0x3002, 0x3003].map((value) => ["disable", value]));
  });

  it("returns no toggle without WEBGL_clip_cull_distance", () => {
    const renderer = {
      extensions: { has: () => false, get: () => null },
      getContext: () => ({}),
    } as unknown as THREE.WebGLRenderer;

    expect(createPortalClipDistanceToggle(renderer)).toBeUndefined();
  });
});
