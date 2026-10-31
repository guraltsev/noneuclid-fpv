/**
 * Fake of a `<canvas>` element and its 2D drawing context, for renderer code that draws text or shapes onto a
 * canvas texture (e.g. `placedFlagRenderer.ts`) without a real DOM. Installs `document.createElement("canvas")` as
 * a global stub that always returns the same fake canvas, so the caller's `document.createElement("canvas")` call
 * resolves to a value the test can inspect. Every 2D context method a test does not override is a `vi.fn()` that
 * records its calls; drawing state (`fillStyle`, `font`, `textAlign`, `textBaseline`) is a plain mutable property.
 */
import { vi } from "vitest";

export interface FakeCanvas2dContext {
  readonly clearRect: ReturnType<typeof vi.fn>;
  readonly fillRect: ReturnType<typeof vi.fn>;
  readonly fillText: ReturnType<typeof vi.fn>;
  readonly measureText: (text: string) => { readonly width: number };
  fillStyle: string;
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
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 60 })),
      fillStyle: "",
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
