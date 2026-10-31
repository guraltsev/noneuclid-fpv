/**
 * Fake of a `<canvas>` element and its 2D drawing context, for renderer code that draws text or shapes onto a
 * canvas texture (e.g. `placedFlagRenderer.ts`, `geodesicEmitterLabelController.ts`) without a real DOM. Installs
 * `document.createElement("canvas")` as a global stub that always returns the same fake canvas, so the caller's
 * `document.createElement("canvas")` call resolves to a value the test can inspect. Every 2D context drawing
 * method a test does not override is a `vi.fn()` no-op that records its calls; drawing state (`fillStyle`,
 * `font`, `textAlign`, ...) is a plain mutable property.
 */
import { vi } from "vitest";

export interface FakeCanvas2dContext {
  readonly beginPath: ReturnType<typeof vi.fn>;
  readonly closePath: ReturnType<typeof vi.fn>;
  readonly moveTo: ReturnType<typeof vi.fn>;
  readonly lineTo: ReturnType<typeof vi.fn>;
  readonly arc: ReturnType<typeof vi.fn>;
  readonly quadraticCurveTo: ReturnType<typeof vi.fn>;
  readonly fill: ReturnType<typeof vi.fn>;
  readonly stroke: ReturnType<typeof vi.fn>;
  readonly save: ReturnType<typeof vi.fn>;
  readonly restore: ReturnType<typeof vi.fn>;
  readonly translate: ReturnType<typeof vi.fn>;
  readonly rotate: ReturnType<typeof vi.fn>;
  readonly scale: ReturnType<typeof vi.fn>;
  readonly drawImage: ReturnType<typeof vi.fn>;
  readonly clearRect: ReturnType<typeof vi.fn>;
  readonly fillRect: ReturnType<typeof vi.fn>;
  readonly strokeRect: ReturnType<typeof vi.fn>;
  readonly fillText: ReturnType<typeof vi.fn>;
  readonly strokeText: ReturnType<typeof vi.fn>;
  readonly measureText: (text: string) => { readonly width: number };
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
}

export interface FakeCanvas2d {
  readonly context: FakeCanvas2dContext;
  width: number;
  height: number;
  getContext(): FakeCanvas2dContext;
}

/** Installs the `document` global and returns the fake canvas every `createElement("canvas")` call returns. */
export function installFakeCanvas2d(): FakeCanvas2d {
  const canvas: FakeCanvas2d = {
    width: 0,
    height: 0,
    context: {
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      quadraticCurveTo: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 60 })),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      font: "",
      textAlign: "",
      textBaseline: "",
    },
    getContext() {
      return this.context;
    },
  };

  vi.stubGlobal("document", {
    createElement(tagName: string) {
      if (tagName !== "canvas") {
        throw new Error(`Unexpected element: ${tagName}`);
      }

      return canvas;
    },
  });

  return canvas;
}
