/**
 * `tests/ui/inputIntents.test.ts` — unit tier.
 *
 * `getInputHintGlyph` maps an input intent (primary, context-menu, help, move, ...) and the current input mode to
 * the label and icon a help row or tooltip shows: desktop intents to mouse/keyboard glyphs, XR intents to
 * controller glyphs, independently of each other. These tests check the desktop glyph set and that XR intents do
 * not fall back to the mouse icons.
 */
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
      label: "Right click / F",
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

  it("gives XR primary, context and move their own controller glyphs, not the mouse icons", () => {
    expect(getInputHintGlyph("xr", "primary")).toEqual({
      intent: "primary",
      mode: "xr",
      label: "Trigger",
      iconSrc: publicAssetUrl("icons/xr-trigger.svg"),
    });
    expect(getInputHintGlyph("xr", "context-menu")).toEqual({
      intent: "context-menu",
      mode: "xr",
      label: "Side trigger",
      iconSrc: publicAssetUrl("icons/xr-grip.svg"),
    });
    expect(getInputHintGlyph("xr", "move")).toEqual({
      intent: "move",
      mode: "xr",
      label: "Left stick",
      iconSrc: publicAssetUrl("icons/xr-thumbstick.svg"),
    });
  });

  it("maps look and carry for both devices", () => {
    expect(getInputHintGlyph("desktop", "look")).toMatchObject({ label: "Mouse", iconSrc: publicAssetUrl("icons/mouse-move.svg") });
    expect(getInputHintGlyph("xr", "look")).toMatchObject({ label: "Head", iconSrc: publicAssetUrl("icons/xr-headset.svg") });
    expect(getInputHintGlyph("desktop", "carry")).toMatchObject({ label: "G", iconSrc: publicAssetUrl("icons/g-alphabet.svg") });
    expect(getInputHintGlyph("xr", "carry")).toMatchObject({ label: "A / X", iconSrc: publicAssetUrl("icons/a-alphabet.svg") });
  });

  it("returns stable text for XR hints without dedicated icons", () => {
    const glyph = getInputHintGlyph("xr", "keyboard-context-fallback");
    expect(glyph.label).toBe("Context fallback");
    expect(glyph).not.toHaveProperty("iconSrc");
  });

  it("names the controls of two controllers: grip, A, B, left trigger, X", () => {
    const label = (intent: Parameters<typeof getInputHintGlyph>[1]) => getInputHintGlyph("xr", intent, "two-controllers").label;

    expect(label("primary")).toBe("Trigger");
    expect(label("context-menu")).toBe("Grip");
    expect(label("carry")).toBe("A");
    expect(label("help")).toBe("B");
    expect(label("switch-tool")).toBe("Left trigger");
    expect(label("hand")).toBe("Left grip");
    expect(label("main-menu")).toBe("X");
  });

  it("names one controller by its letters, with the stick press and the hold", () => {
    const right = (intent: Parameters<typeof getInputHintGlyph>[1]) => getInputHintGlyph("xr", intent, "one-right").label;
    const left = (intent: Parameters<typeof getInputHintGlyph>[1]) => getInputHintGlyph("xr", intent, "one-left").label;

    expect([right("carry"), right("help"), right("main-menu")]).toEqual(["A", "B", "Hold B"]);
    expect([left("carry"), left("help"), left("main-menu")]).toEqual(["X", "Y", "Hold Y"]);
    expect(right("switch-tool")).toBe("Stick press");
    expect(left("switch-tool")).toBe("Stick press");
    expect(left("primary")).toBe("Trigger");
    expect(left("context-menu")).toBe("Grip");
  });

  it("keeps desktop labels independent of the layout and the old XR labels without one", () => {
    expect(getInputHintGlyph("desktop", "carry", "one-left").label).toBe("G");
    expect(getInputHintGlyph("xr", "carry").label).toBe("A / X");
  });
});
