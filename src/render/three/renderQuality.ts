/**
 * Render-resolution policy and the pixel sizes that portal clipping depends on.
 *
 * `resolveRenderPixelRatio` caps the device pixel ratio (default 1.25) to bound fill cost on high-DPI screens; with
 * quality disabled the ratio is 1. Three sizes are distinguished: the CSS canvas size (layout pixels), the drawing
 * buffer size (CSS size x pixel ratio, physical pixels), and the portal viewport size, which is the drawing buffer
 * because the clip shader works with `gl_FragCoord` in physical pixels and visibility areas are measured in them.
 * Clip-edge smoothing is currently compiled off (`portalClipEdgeSmoothingEnabled = false`).
 */

import * as THREE from "three";

/** Whether MSAA antialiasing is requested when creating the WebGL renderer. */
export const renderAntialiasRequested = true;
/** Master switch for dithered anti-aliasing of portal clip edges; false means hard per-fragment clip tests. */
export const portalClipEdgeSmoothingEnabled = false;
/** Upper bound applied to the device pixel ratio when none is supplied (1.25). */
export const defaultMaxDevicePixelRatio = 1.25;

/** A width and height in pixels. */
export interface ViewportPixels {
  readonly width: number;
  readonly height: number;
}

/** Snapshot of the render-quality settings and the canvas/buffer sizes currently in effect. */
export interface RenderQualityState {
  /** Whether quality features (pixel ratio above 1, edge smoothing) are enabled. */
  readonly enabled: boolean;
  /** Echo of `renderAntialiasRequested`. */
  readonly antialiasRequested: boolean;
  /** True only if quality is enabled and clip-edge smoothing is globally on. */
  readonly portalClipEdgeSmoothing: boolean;
  /** Pixel ratio applied to the renderer. */
  readonly pixelRatio: number;
  /** Cap that was used when choosing `pixelRatio`. */
  readonly maxDevicePixelRatio: number;
  /** Renderer size in CSS pixels. */
  readonly cssCanvasSize: ViewportPixels;
  /** Renderer drawing-buffer size in physical pixels. */
  readonly drawingBufferSize: ViewportPixels;
  /** Pixel size used for portal visibility areas and the clip shader; equals `drawingBufferSize`. */
  readonly portalViewportPixels: ViewportPixels;
}

/** Clamps a device pixel ratio to at most `maxDevicePixelRatio`; invalid, missing or non-positive inputs fall back to 1 (and an invalid max to the default). */
export function resolveRenderPixelRatio(
  devicePixelRatio: number | undefined,
  maxDevicePixelRatio = defaultMaxDevicePixelRatio,
): number {
  const fallbackPixelRatio = 1;
  const resolvedDevicePixelRatio =
    devicePixelRatio === undefined || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0
      ? fallbackPixelRatio
      : devicePixelRatio;
  const resolvedMaxDevicePixelRatio =
    Number.isFinite(maxDevicePixelRatio) && maxDevicePixelRatio > 0
      ? maxDevicePixelRatio
      : defaultMaxDevicePixelRatio;

  return Math.min(resolvedDevicePixelRatio, resolvedMaxDevicePixelRatio);
}

/** Returns the capped device pixel ratio when quality is enabled, otherwise exactly 1. */
export function resolveRenderQualityPixelRatio(enabled: boolean, devicePixelRatio: number | undefined): number {
  return enabled ? resolveRenderPixelRatio(devicePixelRatio) : 1;
}

/** Returns the window's inner size in CSS pixels, each dimension at least 1. */
export function getWindowCssCanvasSize(windowLike: Pick<Window, "innerWidth" | "innerHeight">): ViewportPixels {
  return {
    width: Math.max(1, windowLike.innerWidth),
    height: Math.max(1, windowLike.innerHeight),
  };
}

/** Returns the renderer's canvas size in CSS pixels (`renderer.getSize`). */
export function getRendererCssCanvasSize(renderer: THREE.WebGLRenderer): ViewportPixels {
  const size = renderer.getSize(new THREE.Vector2());

  return vectorToViewportPixels(size);
}

/** Returns the renderer's drawing-buffer size in physical pixels (CSS size x pixel ratio, possibly fractional). */
export function getRendererDrawingBufferPixels(renderer: THREE.WebGLRenderer): ViewportPixels {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  return vectorToViewportPixels(size);
}

/** Returns the pixel size to use for portal visibility and clipping, i.e. the drawing-buffer size. */
export function getPortalViewportPixels(renderer: THREE.WebGLRenderer): ViewportPixels {
  return getRendererDrawingBufferPixels(renderer);
}

/** Builds a `RenderQualityState` by reading the renderer's current CSS and drawing-buffer sizes. */
export function createRenderQualityState(
  renderer: THREE.WebGLRenderer,
  pixelRatio: number,
  enabled = true,
  maxDevicePixelRatio = defaultMaxDevicePixelRatio,
): RenderQualityState {
  const cssCanvasSize = getRendererCssCanvasSize(renderer);
  const drawingBufferSize = getRendererDrawingBufferPixels(renderer);

  return {
    enabled,
    antialiasRequested: renderAntialiasRequested,
    portalClipEdgeSmoothing: enabled && portalClipEdgeSmoothingEnabled,
    pixelRatio,
    maxDevicePixelRatio,
    cssCanvasSize,
    drawingBufferSize,
    portalViewportPixels: drawingBufferSize,
  };
}

function vectorToViewportPixels(size: THREE.Vector2): ViewportPixels {
  return {
    width: size.x,
    height: size.y,
  };
}
