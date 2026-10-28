import { describe, expect, it } from "vitest";
import { readLaunchOptions } from "../src/glue/readLaunchOptions";

describe("readLaunchOptions", () => {
  it("reads debug launcher visibility and named debug options from URL params", () => {
    const location = new URL(
      "https://example.test/?world=cube&ui=WorldSelector,DebugButton&debugLevel=verbose&portalPanels=panel-with-text&debugOptions=runtime-diagnostics",
    ) as unknown as Location;

    expect(readLaunchOptions(location)).toMatchObject({
      selectedWorldId: "cube",
      uiOptions: ["WorldSelector", "DebugButton"],
      renderWorldPicker: true,
      renderDebugButton: true,
      debugLevel: "verbose",
      portalPanelMode: "panel-with-text",
      debugOptions: ["runtime-diagnostics"],
      debugOverlayEnabled: true,
      debugOverlayItems: ["fps", "location", "portal-quantities"],
    });
  });

  it("ignores unknown debug options", () => {
    const location = new URL(
      "https://example.test/?world=cube&ui=DebugButton&debugLevel=basic&debugOptions=runtime-diagnostics,unknown-option",
    ) as unknown as Location;

    expect(readLaunchOptions(location).debugOptions).toEqual(["runtime-diagnostics"]);
  });

  it("keeps known ui options even when only later options are requested", () => {
    const location = new URL("https://example.test/?world=cube&ui=DebugButton") as unknown as Location;

    expect(readLaunchOptions(location).uiOptions).toEqual(["DebugButton"]);
  });

  it("shows both controls by default when ui is not present", () => {
    const location = new URL("https://example.test/?world=cube") as unknown as Location;

    expect(readLaunchOptions(location)).toMatchObject({
      uiOptions: ["WorldSelector", "DebugButton"],
      renderWorldPicker: true,
      renderDebugButton: true,
      debugLevel: "off",
    });
  });

  it("uses the explicit ui list to disable missing controls", () => {
    const location = new URL("https://example.test/?world=cube&ui=DebugButton") as unknown as Location;

    expect(readLaunchOptions(location)).toMatchObject({
      uiOptions: ["DebugButton"],
      renderWorldPicker: false,
      renderDebugButton: true,
    });
  });

  it("maps legacy portal-panels debug options to panel-with-text mode", () => {
    const location = new URL(
      "https://example.test/?world=cube&debug=true&debugOptions=portal-panels,runtime-diagnostics",
    ) as unknown as Location;

    expect(readLaunchOptions(location)).toMatchObject({
      portalPanelMode: "panel-with-text",
      debugOptions: ["runtime-diagnostics"],
    });
  });

  it("reads debug overlay visibility and item selection from URL params", () => {
    const location = new URL(
      "https://example.test/?world=cube&debugOverlay=false&debugOverlayItems=location,portal-quantities",
    ) as unknown as Location;

    expect(readLaunchOptions(location)).toMatchObject({
      debugOverlayEnabled: false,
      debugOverlayItems: ["location", "portal-quantities"],
    });
  });
});
