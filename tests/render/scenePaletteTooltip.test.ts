/**
 * Palette tooltip label wrapping (`wrapPaletteTooltipLabel` in src/render/three/scenePaletteController.ts): greedy
 * word-wraps a tooltip label into lines of at most 38 characters by default. Whitespace is collapsed; a single
 * word longer than the limit stays on its own over-long line rather than being split.
 */
import { describe, expect, it } from "vitest";
import { wrapPaletteTooltipLabel } from "../../src/render/three/scenePaletteController";

describe("scene palette tooltip", () => {
  it("keeps short labels compact", () => {
    expect(wrapPaletteTooltipLabel("Reload")).toEqual(["Reload"]);
  });

  it("wraps long action descriptions across readable lines", () => {
    expect(wrapPaletteTooltipLabel("Move emitter while maintaining attached geodesics")).toEqual([
      "Move emitter while maintaining",
      "attached geodesics",
    ]);
    expect(wrapPaletteTooltipLabel(
      "Select two geodesics attached to this emitter, tie them together, and release them from the emitter",
    )).toEqual([
      "Select two geodesics attached to this",
      "emitter, tie them together, and",
      "release them from the emitter",
    ]);
  });
});
