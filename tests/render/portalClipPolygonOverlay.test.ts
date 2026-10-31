/**
 * Debug SVG overlay (src/render/three/portalClipPolygonOverlay.ts) that draws each visible portal path's NDC
 * clip polygon over the canvas, so it shows exactly the region the fragment shader allows for that path.
 */
import { describe, expect, it } from "vitest";
import { ndcPointToViewportPixels } from "../../src/render/three/portalClipPolygonOverlay";

describe("ndcPointToViewportPixels", () => {
  it("maps NDC corners and center into viewport pixel coordinates", () => {
    expect(ndcPointToViewportPixels({ x: -1, y: 1 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 0 });
    expect(ndcPointToViewportPixels({ x: 1, y: -1 }, { width: 800, height: 600 })).toEqual({ x: 800, y: 600 });
    expect(ndcPointToViewportPixels({ x: 0, y: 0 }, { width: 800, height: 600 })).toEqual({ x: 400, y: 300 });
  });
});
