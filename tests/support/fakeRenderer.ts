/**
 * Fake of `THREE.WebGLRenderer`: the GPU boundary. Implements only what render tests read: `info`, `xr`,
 * `setRenderTarget`, `render` and `compile`; the CSS/drawing-buffer size and viewport queries `renderQuality` and
 * `portalEyeActivation` read; and the `extensions`/`getContext` pair `portalClipMaterial` probes for the hardware
 * clip-distance extension. Every method is a `vi.fn()`, so a test can assert it was called and inspect its
 * arguments (`fake.getCurrentViewport.mock.calls`) instead of recording them itself; pass `options` to change what
 * a method returns.
 *
 * The result is not cast to `THREE.WebGLRenderer` (callers do that at the point they hand it to renderer-typed
 * code) so its `vi.fn()` methods stay inspectable on the returned value's own type.
 *
 * TODO(job44): contract-test this fake against a real WebGLRenderer in the release tier (_docs/tests.md §8.3).
 */
import * as THREE from "three";
import { vi } from "vitest";

export interface FakeRendererSize {
  readonly width: number;
  readonly height: number;
}

export interface FakeRendererXr {
  readonly isPresenting: boolean;
  getCamera(): { readonly cameras: readonly THREE.PerspectiveCamera[] };
}

export interface FakeRendererOptions {
  /** CSS canvas size reported by `getSize`; defaults to 800x600. */
  readonly cssSize?: FakeRendererSize;
  /** Drawing-buffer pixel size reported by `getDrawingBufferSize`; defaults to `cssSize`. */
  readonly drawingBufferSize?: FakeRendererSize;
  /** Viewport reported by `getCurrentViewport`, as `[x, y, width, height]`; defaults to the full drawing buffer. */
  readonly viewport?: readonly [number, number, number, number];
  /** `renderer.xr`; defaults to not presenting, with no XR camera. */
  readonly xr?: Partial<FakeRendererXr>;
  /** `renderer.extensions`; defaults to reporting every extension present. */
  readonly extensions?: { has(name: string): boolean; get(name: string): unknown };
  /** The WebGL-context-like object `getContext()` returns; defaults to one with no-op `enable`/`disable`. */
  readonly glContext?: unknown;
}

export function createFakeRenderer(options: FakeRendererOptions = {}) {
  const cssSize = options.cssSize ?? { width: 800, height: 600 };
  const drawingBufferSize = options.drawingBufferSize ?? cssSize;
  const viewport = options.viewport ?? [0, 0, drawingBufferSize.width, drawingBufferSize.height];
  const glContext = options.glContext ?? { enable: vi.fn(), disable: vi.fn() };

  return {
    info: {
      render: { calls: 0, triangles: 0, points: 0, lines: 0, frame: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: [] as unknown[],
      autoReset: true,
      reset: vi.fn(),
    },
    xr: {
      isPresenting: false,
      getCamera: () => ({ cameras: [] }),
      ...options.xr,
    },
    extensions: options.extensions ?? { has: () => true, get: () => ({}) },
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    compile: vi.fn(() => new Set<THREE.Material>()),
    getContext: vi.fn(() => glContext),
    getSize: vi.fn((target: THREE.Vector2) => target.set(cssSize.width, cssSize.height)),
    getDrawingBufferSize: vi.fn((target: THREE.Vector2) => target.set(drawingBufferSize.width, drawingBufferSize.height)),
    getCurrentViewport: vi.fn((target: THREE.Vector4) => target.set(viewport[0], viewport[1], viewport[2], viewport[3])),
  };
}

export type FakeRenderer = ReturnType<typeof createFakeRenderer>;
