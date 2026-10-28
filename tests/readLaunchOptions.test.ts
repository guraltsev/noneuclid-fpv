import { describe, expect, it } from "vitest";
import {
  normalizeAppConfig,
  normalizeAppConfigName,
  buildAppConfigUrl,
  readAppConfigForwardName,
  readAppConfigName,
} from "../src/glue/appConfig";
import { readLaunchOptions } from "../src/glue/readLaunchOptions";

describe("readLaunchOptions", () => {
  it("disables render quality by default", () => {
    expect(readLaunchOptions(locationWithSearch("")).renderQualityEnabled).toBe(false);
  });

  it("enables anti-nausea comfort mode by default", () => {
    expect(readLaunchOptions(locationWithSearch("")).vrComfortOptions).toMatchObject({
      antiNauseaModeEnabled: true,
      antiNauseaVisibleFovScale: 0.5,
    });
  });

  it("can configure anti-nausea comfort mode from URL arguments", () => {
    expect(readLaunchOptions(locationWithSearch("?antiNausea=off")).vrComfortOptions.antiNauseaModeEnabled)
      .toBe(false);
    expect(readLaunchOptions(locationWithSearch("?antiNauseaFovScale=0.35")).vrComfortOptions.antiNauseaVisibleFovScale)
      .toBe(0.35);
    expect(readLaunchOptions(locationWithSearch("?antiNauseaFovScale=2")).vrComfortOptions.antiNauseaVisibleFovScale)
      .toBe(1);
  });

  it("can enable render quality with a URL argument", () => {
    expect(readLaunchOptions(locationWithSearch("?renderQuality=on")).renderQualityEnabled).toBe(true);
    expect(readLaunchOptions(locationWithSearch("?renderQuality=1")).renderQualityEnabled).toBe(true);
    expect(readLaunchOptions(locationWithSearch("?renderQuality=true")).renderQualityEnabled).toBe(true);
  });

  it("keeps render quality disabled for explicit off values", () => {
    expect(readLaunchOptions(locationWithSearch("?renderQuality=off")).renderQualityEnabled).toBe(false);
    expect(readLaunchOptions(locationWithSearch("?renderQuality=0")).renderQualityEnabled).toBe(false);
    expect(readLaunchOptions(locationWithSearch("?renderQuality=false")).renderQualityEnabled).toBe(false);
  });

  it("enables the debug overlay defaults when no explicit overlay params are present", () => {
    expect(readLaunchOptions(locationWithSearch("")).debugOverlayEnabled).toBe(true);
    expect(readLaunchOptions(locationWithSearch("")).debugOverlayItems).toEqual([
      "fps",
      "location",
      "portal-quantities",
    ]);
  });

  it("uses app config values as launch defaults", () => {
    const options = readLaunchOptions(locationWithSearch(""), normalizeAppConfig({
      startingWorld: "torus",
      optionsMenu: {
        worldSelectionSection: false,
        debugSection: false,
      },
      debug: {
        level: "basic",
        portalPanels: "text-only",
        renderQuality: true,
        overlay: {
          enabled: false,
          items: {
            fps: false,
            location: true,
            "portal-quantities": false,
          },
        },
        options: {
          "runtime-diagnostics": true,
          "portal-path-debug": true,
        },
      },
    }));

    expect(options).toMatchObject({
      selectedWorldId: "torus",
      uiOptions: [],
      renderWorldPicker: false,
      renderDebugButton: false,
      debugLevel: "basic",
      portalPanelMode: "text-only",
      debugOptions: ["runtime-diagnostics", "portal-path-debug"],
      debugOverlayEnabled: false,
      debugOverlayItems: ["location"],
      renderQualityEnabled: true,
    });
  });

  it.each([
    ["001", "001-basic-cube"],
    ["002", "002-basic-tetrahedron"],
    ["003", "torus"],
  ] as const)("supports the starter %s config shape", (configName, startingWorld) => {
    const config = normalizeAppConfig({
      startingWorld,
      optionsMenu: {
        configSelectionSection: false,
        worldSelectionSection: false,
        debugSection: false,
      },
      tools: {
        placeFlags: true,
        geodesicEmitters: true,
        distances: true,
        angles: true,
      },
      debug: {
        level: "off",
        portalPanels: "none",
        renderQuality: false,
        overlay: {
          enabled: false,
          items: {
            fps: false,
            location: false,
            "portal-quantities": false,
          },
        },
        options: {
          "runtime-diagnostics": false,
          "portal-path-debug": false,
        },
      },
    });

    expect(readLaunchOptions(locationWithSearch(""), config, configName)).toMatchObject({
      selectedWorldId: startingWorld,
      uiOptions: [],
      renderWorldPicker: false,
      renderDebugButton: false,
      debugLevel: "off",
      portalPanelMode: "none",
      debugOptions: [],
      debugOverlayEnabled: false,
      debugOverlayItems: [],
      renderQualityEnabled: false,
      appConfigName: configName,
    });
    expect(config.tools).toEqual({
      placeFlags: true,
      geodesicEmitters: true,
      distances: true,
      angles: true,
    });
    expect(config.menu).toMatchObject({
      configSelectionSectionEnabled: false,
      worldSelectionSectionEnabled: false,
      debugSectionEnabled: false,
    });
  });

  it("lets URL params override app config defaults", () => {
    const config = normalizeAppConfig({
      startingWorld: "torus",
      optionsMenu: {
        worldSelectionSection: false,
        debugSection: false,
      },
      debug: {
        level: "basic",
        renderQuality: true,
        options: {
          "runtime-diagnostics": true,
        },
      },
    });

    expect(readLaunchOptions(
      locationWithSearch("?world=cube&ui=DebugButton&debugLevel=off&debugOptions=&renderQuality=false"),
      config,
    )).toMatchObject({
      selectedWorldId: "cube",
      uiOptions: ["DebugButton"],
      renderDebugButton: true,
      debugLevel: "off",
      debugOptions: [],
      renderQualityEnabled: false,
    });
  });

  it("normalizes launch config names safely", () => {
    expect(readAppConfigName(locationWithSearch("?config=classroom"))).toBe("classroom");
    expect(readAppConfigName(locationWithSearch("?configName=classroom"))).toBe("classroom");
    expect(normalizeAppConfigName("classroom.config.js")).toBe("classroom");
    expect(normalizeAppConfigName("../secret")).toBe("default");
    expect(normalizeAppConfigName("")).toBe("default");
    expect(buildAppConfigUrl("classroom")).toBe(`${import.meta.env.BASE_URL}classroom.config.js`);
  });

  it("reads safe app config forward targets", () => {
    expect(readAppConfigForwardName({ forwardTo: "full.config.js" })).toBe("full");
    expect(readAppConfigForwardName({ forwardTo: "../secret" })).toBeUndefined();
    expect(readAppConfigForwardName({})).toBeUndefined();
  });
});

function locationWithSearch(search: string): Location {
  return { search } as Location;
}
