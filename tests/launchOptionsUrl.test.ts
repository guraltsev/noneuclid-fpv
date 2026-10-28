import { describe, expect, it } from "vitest";
import {
  buildUrlWithLaunchOptions,
  removeLaunchOptionsFromUrl,
} from "../src/glue/launchOptionsUrl";
import { defaultAppConfig, defaultAppConfigName } from "../src/glue/appConfig";
import type { LaunchOptions } from "../src/glue/readLaunchOptions";
import { defaultVrComfortOptions } from "../src/render/three/vrComfort";

describe("launchOptionsUrl", () => {
  it("removes recognized launch options from the visible URL while preserving config", () => {
    expect(
      removeLaunchOptionsFromUrl(
        "https://example.test/play?config=classroom&configName=full&world=cube&ui=DebugButton&debugLevel=verbose&keep=1#here",
      ),
    ).toBe("https://example.test/play?config=classroom&configName=full&keep=1#here");
  });

  it("builds an explicit URL containing the current launch options", () => {
    expect(buildUrlWithLaunchOptions("https://example.test/play?keep=1", exampleLaunchOptions()))
      .toBe(
        "https://example.test/play?keep=1&world=cube&ui=DebugButton&debugLevel=verbose&portalPanels=panel-with-text&debugOptions=runtime-diagnostics%2Cportal-path-debug&debugOverlay=false&debugOverlayItems=location&renderQuality=true&antiNausea=true&antiNauseaFovScale=0.5",
      );
  });

  it("does not keep stale config names in copied launch URLs", () => {
    expect(buildUrlWithLaunchOptions("https://example.test/play?config=classroom&keep=1", exampleLaunchOptions()))
      .not.toContain("config=classroom");
  });

  it("keeps non-default config names in copied launch URLs", () => {
    expect(buildUrlWithLaunchOptions("https://example.test/play?keep=1", {
      ...exampleLaunchOptions(),
      appConfigName: "classroom",
    })).toContain("?keep=1&config=classroom&world=cube");
  });
});

function exampleLaunchOptions(): LaunchOptions {
  return {
    selectedWorldId: "cube",
    uiOptions: ["DebugButton"],
    renderWorldPicker: false,
    renderDebugButton: true,
    debugLevel: "verbose",
    portalPanelMode: "panel-with-text",
    debugOptions: ["runtime-diagnostics", "portal-path-debug"],
    debugOverlayEnabled: false,
    debugOverlayItems: ["location"],
    renderQualityEnabled: true,
    vrComfortOptions: defaultVrComfortOptions,
    appConfig: defaultAppConfig,
    appConfigName: defaultAppConfigName,
  };
}
