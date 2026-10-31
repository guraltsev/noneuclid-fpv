/**
 * Render quality policy: device pixel ratio capping, the camera's near/far clip planes, and the CSS versus
 * drawing-buffer canvas sizes the renderer and the portal-clip shader read (see _docs/ARCHITECTURE.md, "Testing
 * strategy").
 *
 * The renderer is faked by `tests/support/fakeRenderer.ts`; only `getSize`/`getDrawingBufferSize` are read here.
 */
import { describe, expect, it } from "vitest";
import {
  renderCameraDepthRangeRatio,
  renderCameraFarMeters,
  renderCameraNearMeters,
} from "../../src/render/three/renderCameraClip";
import {
  createRenderQualityState,
  getPortalViewportPixels,
  getRendererCssCanvasSize,
  getRendererDrawingBufferPixels,
  getWindowCssCanvasSize,
  renderAntialiasRequested,
  resolveRenderQualityPixelRatio,
  resolveRenderPixelRatio,
} from "../../src/render/three/renderQuality";
import type * as THREE from "three";
import { createFakeRenderer } from "../support/fakeRenderer";

describe("render quality policy", () => {
  it("requests renderer antialiasing explicitly", () => {
    expect(renderAntialiasRequested).toBe(true);
  });

  it("keeps the near plane close but not so tiny that far static objects lose depth precision", () => {
    expect(renderCameraNearMeters).toBeGreaterThanOrEqual(0.03);
    expect(renderCameraNearMeters).toBeLessThanOrEqual(0.05);
    expect(renderCameraFarMeters).toBe(250);
    expect(renderCameraDepthRangeRatio()).toBeLessThanOrEqual(10_000);
  });

  it("caps device pixel ratio to the configured maximum", () => {
    expect(resolveRenderPixelRatio(1)).toBe(1);
    expect(resolveRenderPixelRatio(1.2)).toBe(1.2);
    expect(resolveRenderPixelRatio(1.5)).toBe(1.25);
    expect(resolveRenderPixelRatio(3)).toBe(1.25);
    expect(resolveRenderPixelRatio(3, 1.25)).toBe(1.25);
    expect(resolveRenderPixelRatio(undefined)).toBe(1);
    expect(resolveRenderPixelRatio(0)).toBe(1);
    expect(resolveRenderPixelRatio(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("resolves to baseline pixel ratio when render quality is disabled", () => {
    expect(resolveRenderQualityPixelRatio(true, 2)).toBe(1.25);
    expect(resolveRenderQualityPixelRatio(false, 2)).toBe(1);
  });

  it("normalizes CSS canvas dimensions from the window", () => {
    expect(getWindowCssCanvasSize({ innerWidth: 1280, innerHeight: 720 })).toEqual({
      width: 1280,
      height: 720,
    });
    expect(getWindowCssCanvasSize({ innerWidth: 0, innerHeight: -10 })).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("keeps CSS and drawing-buffer renderer sizes distinct", () => {
    const renderer = createFakeRenderer({
      cssSize: { width: 800, height: 450 },
      drawingBufferSize: { width: 1600, height: 900 },
    }) as unknown as THREE.WebGLRenderer;

    expect(getRendererCssCanvasSize(renderer)).toEqual({ width: 800, height: 450 });
    expect(getRendererDrawingBufferPixels(renderer)).toEqual({ width: 1600, height: 900 });
  });

  it("reads portal viewport uniforms in drawing-buffer pixels, matching gl_FragCoord", () => {
    const renderer = createFakeRenderer({
      cssSize: { width: 640, height: 360 },
      drawingBufferSize: { width: 1280, height: 720 },
    }) as unknown as THREE.WebGLRenderer;

    expect(getPortalViewportPixels(renderer)).toEqual({ width: 1280, height: 720 });
    expect(createRenderQualityState(renderer, 2, true)).toMatchObject({
      enabled: true,
      antialiasRequested: true,
      pixelRatio: 2,
      cssCanvasSize: { width: 640, height: 360 },
      drawingBufferSize: { width: 1280, height: 720 },
      portalViewportPixels: { width: 1280, height: 720 },
    });
    expect(createRenderQualityState(renderer, 1, false)).toMatchObject({
      enabled: false,
      pixelRatio: 1,
    });
  });
});
