import { describe, expect, it } from "vitest";
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

describe("render quality policy", () => {
  it("requests renderer antialiasing explicitly", () => {
    expect(renderAntialiasRequested).toBe(true);
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
    const renderer = createRendererSizeStub({
      css: { width: 800, height: 450 },
      drawingBuffer: { width: 1600, height: 900 },
    });

    expect(getRendererCssCanvasSize(renderer)).toEqual({ width: 800, height: 450 });
    expect(getRendererDrawingBufferPixels(renderer)).toEqual({ width: 1600, height: 900 });
  });

  it("uses drawing-buffer pixels for portal viewport uniforms because gl_FragCoord is in framebuffer pixels", () => {
    const renderer = createRendererSizeStub({
      css: { width: 640, height: 360 },
      drawingBuffer: { width: 1280, height: 720 },
    });

    expect(getPortalViewportPixels(renderer)).toEqual({ width: 1280, height: 720 });
    expect(createRenderQualityState(renderer, 2, true)).toMatchObject({
      enabled: true,
      antialiasRequested: true,
      portalClipEdgeSmoothing: false,
      pixelRatio: 2,
      cssCanvasSize: { width: 640, height: 360 },
      drawingBufferSize: { width: 1280, height: 720 },
      portalViewportPixels: { width: 1280, height: 720 },
    });
    expect(createRenderQualityState(renderer, 1, false)).toMatchObject({
      enabled: false,
      portalClipEdgeSmoothing: false,
      pixelRatio: 1,
    });
  });
});

function createRendererSizeStub(sizes: {
  readonly css: { readonly width: number; readonly height: number };
  readonly drawingBuffer: { readonly width: number; readonly height: number };
}): THREE.WebGLRenderer {
  return {
    getSize(target: { x: number; y: number }) {
      target.x = sizes.css.width;
      target.y = sizes.css.height;
      return target;
    },
    getDrawingBufferSize(target: { x: number; y: number }) {
      target.x = sizes.drawingBuffer.width;
      target.y = sizes.drawingBuffer.height;
      return target;
    },
  } as unknown as THREE.WebGLRenderer;
}
