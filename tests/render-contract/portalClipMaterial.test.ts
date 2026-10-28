import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createPortalClipData } from "../../src/render/three/portalClipData";
import {
  createPortalClipMaterialState,
  patchPortalClipMaterial,
  updatePortalClipMaterialViewport,
  viewportPixelsToNdc,
} from "../../src/render/three/portalClipMaterial";

describe("portal clip material", () => {
  it("uses WebGL bottom-left pixel coordinates when converting viewport pixels to NDC", () => {
    expect(viewportPixelsToNdc({ x: 0, y: 0 }, { width: 800, height: 600 })).toEqual({ x: -1, y: -1 });
    expect(viewportPixelsToNdc({ x: 800, y: 600 }, { width: 800, height: 600 })).toEqual({ x: 1, y: 1 });
    expect(viewportPixelsToNdc({ x: 400, y: 300 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 0 });
    expect(viewportPixelsToNdc({ x: 0, y: 300 }, { width: 800, height: 600 }).x).toBe(-1);
    expect(viewportPixelsToNdc({ x: 800, y: 300 }, { width: 800, height: 600 }).x).toBe(1);
    expect(viewportPixelsToNdc({ x: 400, y: 0 }, { width: 800, height: 600 }).y).toBe(-1);
    expect(viewportPixelsToNdc({ x: 400, y: 600 }, { width: 800, height: 600 }).y).toBe(1);
  });

  it("patches materials with portal clip attributes, uniforms, and smoothed discard shader code", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 16, maxClipVerticesPerPath: 8 });
    const state = createPortalClipMaterialState(clipData, { width: 800, height: 600 });
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

    expect(shader.vertexShader).toContain("attribute float portalPathId;");
    expect(shader.vertexShader).toContain("attribute float portalClipIndex;");
    expect(shader.vertexShader).toContain("if (vPortalClipIndex >= -0.5)");
    expect(shader.vertexShader).toContain("gl_Position.z += min(0.00008 * gl_Position.w, 0.0008);");
    expect(shader.fragmentShader).toContain("portalFragmentClipCoverage(gl_FragCoord.xy, vPortalClipIndex)");
    expect(shader.fragmentShader).toContain("if (clipIndex < -1.5)");
    expect(shader.fragmentShader).toContain("return 1.0;");
    expect(shader.fragmentShader).toContain("smoothstep(-0.5, 0.5, minSignedDistancePixels)");
    expect(shader.fragmentShader).toContain("portalInterleavedGradientNoise(gl_FragCoord.xy)");
    expect(shader.fragmentShader).toContain("if (signedDistancePixels < -0.5)");
    expect(shader.fragmentShader).toContain("for (int index = 0; index < 8; index++)");
    expect(Object.keys(shader.uniforms)).toEqual(
      expect.arrayContaining([
        "portalClipTexture",
        "portalViewportOriginPixels",
        "portalViewportPixels",
        "portalMaxVisiblePaths",
        "portalMaxClipVerticesPerPath",
      ]),
    );

    updatePortalClipMaterialViewport(state, { width: 320, height: 240 }, { x: 12, y: 34 });
    expect(state.uniforms.portalViewportOriginPixels.value).toMatchObject({ x: 12, y: 34 });
    expect(state.uniforms.portalViewportPixels.value).toMatchObject({ x: 320, y: 240 });

    clipData.dispose();
  });

  it("can patch materials with baseline hard portal clipping for performance comparison", () => {
    const clipData = createPortalClipData({ maxVisiblePaths: 16, maxClipVerticesPerPath: 8 });
    const state = createPortalClipMaterialState(clipData, { width: 800, height: 600 }, { smoothClipEdges: false });
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

    expect(shader.fragmentShader).toContain("portalFragmentShouldDiscard(gl_FragCoord.xy, vPortalClipIndex)");
    expect(shader.fragmentShader).toContain("return false;");
    expect(shader.fragmentShader).toContain("if (edgeSide < -0.00001)");
    expect(shader.fragmentShader).not.toContain("portalClipCoverage < 1.0");
    expect(material.customProgramCacheKey()).toContain(":hard");

    clipData.dispose();
  });
});
