/**
 * Tests of the pure hint strip definition: every row of the design 017 section 8.2 table for desktop, the three-entry cap, and the VR glyphs for the same situations.
 */
import { describe, expect, it } from "vitest";
import { createHintStripDefinition, formatHintStripLine, type HintStripFocus, type HintStripSource } from "../../src/ui/hintStripDefinition";
import { createWorldFocusMessageDefinition } from "../../src/ui/worldInteractionDefinition";
import type { RuntimeWorldObject } from "../../src/world-objects/runtimeObjectRegistry";

function focusOf(object: Partial<RuntimeWorldObject> & { kind: RuntimeWorldObject["kind"] }, selectedTool: string, canExtend = false): HintStripFocus {
  const definition = createWorldFocusMessageDefinition({
    object: { tooltip: { label: "Thing" }, ...object } as RuntimeWorldObject,
    selectedTool: selectedTool as never,
    canExtendGeodesic: canExtend,
  });
  return { objectKind: object.kind, actions: definition?.actions ?? [] };
}

function strip(overrides: Partial<HintStripSource>): string {
  return formatHintStripLine(createHintStripDefinition({
    inputMode: "desktop",
    selectedTool: "none",
    carrying: false,
    menuOpen: false,
    ...overrides,
  }));
}

describe("hint strip definition (desktop rows of the design table)", () => {
  it("names the tools and the help key with the Hand aimed at the floor", () => {
    expect(strip({})).toBe("1–5 · wheel: tools · H: what's this?");
  });

  it("offers Help when the Hand aims at the help cube", () => {
    const focus = focusOf({ kind: "asset", interactable: { action: "open-tutorial" } } as never, "none");
    expect(strip({ focus })).toBe("Left click: open Help");
  });

  it("names both clicks and the pick up key when the Hand aims at a laser", () => {
    const focus = focusOf({ kind: "geodesicEmitters/emitter" } as never, "none");
    expect(strip({ focus })).toBe("Left click / Right click / F: Laser menu · G: pick up");
  });

  it("offers placing a laser and putting it away with the Laser aimed at the floor", () => {
    expect(strip({ selectedTool: "geodesicEmitters/emitter" })).toBe("Left click: place a laser · 0: put the Laser away");
  });

  it("offers extending a free beam with the Laser in hand", () => {
    const focus = focusOf({ kind: "geodesicModel/segment" } as never, "geodesicEmitters/emitter", true);
    expect(strip({ selectedTool: "geodesicEmitters/emitter", focus, extendLengthMeters: 2 })).toBe("Left click: extend 2 m");
  });

  it("offers measuring a beam with the Ruler", () => {
    const focus = focusOf({ kind: "geodesicModel/segment" } as never, "geodesicMeasurements/length");
    expect(strip({ selectedTool: "geodesicMeasurements/length", focus })).toBe("Left click: measure this beam");
  });

  it("offers picking a beam and a meeting point with the Protractor", () => {
    const beam = focusOf({ kind: "geodesicModel/segment" } as never, "geodesicMeasurements/protractor");
    const crossing = focusOf({ kind: "geodesicModel/crossing" } as never, "geodesicMeasurements/protractor");
    expect(strip({ selectedTool: "geodesicMeasurements/protractor", focus: beam })).toBe("Left click: pick this beam");
    expect(strip({ selectedTool: "geodesicMeasurements/protractor", focus: crossing })).toBe("Left click: pick this meeting point");
  });

  it("offers only putting down while carrying", () => {
    expect(strip({ carrying: true, selectedTool: "geodesicEmitters/carry" })).toBe("G: put down");
  });

  it("offers choosing and closing while a menu is open", () => {
    const focus = focusOf({ kind: "geodesicEmitters/emitter" } as never, "none");
    expect(strip({ menuOpen: true, focus })).toBe("Left click: choose · Right click / F: close");
  });

  it("falls back to the help key for a useless object and never shows over three entries", () => {
    const focus = focusOf({ kind: "geodesicModel/crossing" } as never, "none");
    expect(strip({ focus })).toBe("H: what's this?");
    const many = createHintStripDefinition({
      inputMode: "desktop",
      selectedTool: "none",
      carrying: false,
      menuOpen: false,
      focus: { objectKind: "geodesicEmitters/emitter", actions: [
        { id: "extend-geodesic", label: "A", intent: "primary", available: true },
        { id: "open-object-menu", label: "B", intent: "context-menu", available: true },
      ] },
    });
    expect(many.length).toBeLessThanOrEqual(3);
  });

  it("uses the VR glyphs in VR", () => {
    const entries = createHintStripDefinition({ inputMode: "xr", selectedTool: "geodesicEmitters/emitter", carrying: false, menuOpen: false });
    expect(entries[0]).toEqual({ glyphLabel: "Trigger", text: "place a laser" });
  });
});
