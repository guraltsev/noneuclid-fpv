/**
 * `tests/glue/debugSettings.test.ts` — unit tier.
 *
 * `canApplyDebugSettingsAtRuntime` says whether a change to the debug level, portal panel mode and enabled options
 * can be applied to a running world without a reload: true exactly when every enabled option is declared
 * runtime-mutable by the given support (by default, every known option is). `parseDebugOptions` and
 * `serializeDebugOptions` read and write the comma-separated option list the URL and app config use;
 * `hasActiveDebugOption` reports whether an option is both enabled and allowed at the current debug level. These
 * tests check each outcome class of `canApplyDebugSettingsAtRuntime` (allowed when every option is mutable,
 * allowed with none enabled, rejected when support excludes an enabled option) and the parse/serialize/active
 * round trip.
 */
import { describe, expect, it } from "vitest";
import { canApplyDebugSettingsAtRuntime } from "../../src/glue/debugSettings";
import { hasActiveDebugOption, parseDebugOptions, serializeDebugOptions } from "../../src/glue/debugOptions";

describe("canApplyDebugSettingsAtRuntime", () => {
  it("allows settings when every enabled option is runtime-mutable by default", () => {
    expect(
      canApplyDebugSettingsAtRuntime({
        debugLevel: "verbose",
        portalPanelMode: "panel-with-text",
        debugOptions: ["runtime-diagnostics", "portal-path-debug", "portal-path-overlay-instances", "aim-collision-outlines"],
      }),
    ).toBe(true);
  });

  it("allows settings with no enabled options regardless of support", () => {
    expect(
      canApplyDebugSettingsAtRuntime(
        { debugLevel: "off", portalPanelMode: "none", debugOptions: [] },
        { runtimeMutableOptions: [] },
      ),
    ).toBe(true);
  });

  it("rejects an enabled option that support does not declare runtime-mutable", () => {
    expect(
      canApplyDebugSettingsAtRuntime(
        { debugLevel: "basic", portalPanelMode: "panel", debugOptions: ["forbidden-zone-wireframes"] },
        { runtimeMutableOptions: ["runtime-diagnostics"] },
      ),
    ).toBe(false);
  });

  it("allows an enabled option that support declares runtime-mutable", () => {
    expect(
      canApplyDebugSettingsAtRuntime(
        { debugLevel: "basic", portalPanelMode: "panel", debugOptions: ["forbidden-zone-wireframes"] },
        { runtimeMutableOptions: ["forbidden-zone-wireframes"] },
      ),
    ).toBe(true);
  });
});

describe("parsing and serializing debug options", () => {
  it("parses a comma list, reports active options by level, and round-trips through serialize", () => {
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
});
