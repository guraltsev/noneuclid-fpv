import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "../../src/glue/assetUrls";
import { getInputHintGlyph } from "../../src/ui/inputIntents";

describe("inputIntents", () => {
  it("maps desktop primary, context, and help to desktop glyph assets", () => {
    expect(getInputHintGlyph("desktop", "primary")).toMatchObject({
      label: "Left click",
      iconSrc: publicAssetUrl("icons/mouse-button-left.svg"),
    });
    expect(getInputHintGlyph("desktop", "context-menu")).toMatchObject({
      label: "Right click",
      iconSrc: publicAssetUrl("icons/mouse-button-right.svg"),
    });
    expect(getInputHintGlyph("desktop", "help")).toMatchObject({
      label: "H",
      iconSrc: publicAssetUrl("icons/h-alphabet.svg"),
    });
    expect(getInputHintGlyph("desktop", "move")).toMatchObject({
      label: "Arrow keys",
      iconSrc: publicAssetUrl("icons/arrowkeys.svg"),
    });
  });

  it("keeps XR primary and context independent from mouse icons", () => {
    expect(getInputHintGlyph("xr", "primary")).toEqual({
      intent: "primary",
      mode: "xr",
      label: "Trigger",
    });
    expect(getInputHintGlyph("xr", "context-menu")).toEqual({
      intent: "context-menu",
      mode: "xr",
      label: "Side trigger",
    });
    expect(getInputHintGlyph("xr", "move")).toEqual({
      intent: "move",
      mode: "xr",
      label: "Left stick",
    });
  });

  it("returns stable text for XR hints without dedicated icons", () => {
    const glyph = getInputHintGlyph("xr", "reset");
    expect(glyph.label).toBe("Stick press");
    expect(glyph).not.toHaveProperty("iconSrc");
  });
});
