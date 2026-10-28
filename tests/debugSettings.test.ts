import { describe, expect, it } from "vitest";
import { canApplyDebugSettingsAtRuntime } from "../src/glue/debugSettings";
import { hasActiveDebugOption, parseDebugOptions, serializeDebugOptions } from "../src/glue/debugOptions";

describe("canApplyDebugSettingsAtRuntime", () => {
  it("allows the current runtime-mutable debug settings", () => {
    expect(
      canApplyDebugSettingsAtRuntime({
        debugLevel: "basic",
        portalPanelMode: "panel",
        debugOptions: ["runtime-diagnostics"],
      }),
    ).toBe(true);
  });

  it("allows portal path debug settings to apply at runtime", () => {
    expect(
      canApplyDebugSettingsAtRuntime({
        debugLevel: "verbose",
        portalPanelMode: "text-only",
        debugOptions: ["portal-path-debug", "portal-static-cull-debug", "portal-path-overlays"],
      }),
    ).toBe(true);
  });

  it("still allows updates when no checkbox debug options are selected", () => {
    expect(
      canApplyDebugSettingsAtRuntime({
        debugLevel: "off",
        portalPanelMode: "none",
        debugOptions: [],
      }),
    ).toBe(true);
  });

  it("parses portal path debug options and keeps them inactive at debug level off", () => {
    const parsed = parseDebugOptions(
      "portal-path-debug,portal-static-cull-debug,portal-path-overlays,portal-path-overlay-instances",
    );

    expect(parsed).toEqual([
      "portal-path-debug",
      "portal-static-cull-debug",
      "portal-path-overlays",
      "portal-path-overlay-instances",
    ]);
    expect(hasActiveDebugOption("off", parsed, "portal-path-debug")).toBe(false);
    expect(hasActiveDebugOption("basic", parsed, "portal-path-debug")).toBe(true);
    expect(serializeDebugOptions(parsed)).toBe(
      "portal-path-debug,portal-static-cull-debug,portal-path-overlays,portal-path-overlay-instances",
    );
  });

  it("allows the new instance overlay debug option at runtime", () => {
    expect(
      canApplyDebugSettingsAtRuntime({
        debugLevel: "basic",
        portalPanelMode: "panel",
        debugOptions: ["portal-path-overlay-instances"],
      }),
    ).toBe(true);
  });

  it("allows visible portal quantity debug summaries at runtime", () => {
    expect(
      canApplyDebugSettingsAtRuntime({
        debugLevel: "basic",
        portalPanelMode: "panel",
        debugOptions: ["portal-visible-path-debug"],
      }),
    ).toBe(true);
  });

  it("parses and allows collision and aim debug options at runtime", () => {
    const parsed = parseDebugOptions(
      "forbidden-zone-wireframes,object-collision-wireframes,selectable-hitboxes,aim-collision-outlines",
    );

    expect(parsed).toEqual([
      "forbidden-zone-wireframes",
      "object-collision-wireframes",
      "selectable-hitboxes",
      "aim-collision-outlines",
    ]);
    expect(hasActiveDebugOption("basic", parsed, "forbidden-zone-wireframes")).toBe(true);
    expect(hasActiveDebugOption("basic", parsed, "selectable-hitboxes")).toBe(true);
    expect(hasActiveDebugOption("basic", parsed, "aim-collision-outlines")).toBe(true);
    expect(serializeDebugOptions(parsed)).toBe(
      "forbidden-zone-wireframes,object-collision-wireframes,selectable-hitboxes,aim-collision-outlines",
    );
    expect(
      canApplyDebugSettingsAtRuntime({
        debugLevel: "basic",
        portalPanelMode: "none",
        debugOptions: parsed,
      }),
    ).toBe(true);
  });
});
