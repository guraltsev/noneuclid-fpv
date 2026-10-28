/**
 * Converts between launch options and URL query parameters: strips them from the visible address after startup (so reloads and shared links are clean) and builds a shareable URL that reproduces the current options.
 * The stripped parameter set covers world, ui, debug flags, overlay, render quality and anti-nausea options but not config; the shareable URL additionally rewrites config/configName. Only the query string is modified; the path and hash are preserved.
 */
import type { LaunchOptions } from "./readLaunchOptions";
import { serializeDebugOptions } from "./debugOptions";
import { serializeUiOptions } from "./uiOptions";
import { defaultAppConfigName } from "./appConfig";
import { serializeRuntimeDebugOverlayItems } from "../runtime/runtimeMenuState";

const launchOptionSearchParams = [
  "world",
  "ui",
  "debug",
  "debugLevel",
  "portalPanels",
  "debugOptions",
  "debugOverlay",
  "debugOverlayItems",
  "renderQuality",
  "antiNausea",
  "antiNauseaFovScale",
  "worldPicker",
] as const;

const copiedUrlLaunchOptionSearchParams = [
  "config",
  "configName",
  ...launchOptionSearchParams,
] as const;

/** Returns the URL with all launch-option query parameters (but not config) removed. */
export function removeLaunchOptionsFromUrl(href: string): string {
  return removeSearchParamsFromUrl(href, launchOptionSearchParams);
}

function removeCopiedUrlLaunchOptionsFromUrl(href: string): string {
  return removeSearchParamsFromUrl(href, copiedUrlLaunchOptionSearchParams);
}

function removeSearchParamsFromUrl(href: string, paramsToRemove: readonly string[]): string {
  const url = new URL(href);

  for (const param of paramsToRemove) {
    url.searchParams.delete(param);
  }

  return url.toString();
}

/**
 * Rewrites the browser address bar via history.replaceState without launch-option parameters; does nothing when none are present.
 */
export function replaceVisibleUrlWithoutLaunchOptions(window: Window): void {
  const cleanUrl = removeLaunchOptionsFromUrl(window.location.href);

  if (cleanUrl !== window.location.href) {
    window.history.replaceState({}, "", cleanUrl);
  }
}

/**
 * Returns the URL with the given options encoded as query parameters (config only when non-default, debugOptions only when non-empty), replacing any previous launch parameters; reading it back with readLaunchOptions reproduces the options.
 */
export function buildUrlWithLaunchOptions(href: string, options: LaunchOptions): string {
  const url = new URL(removeCopiedUrlLaunchOptionsFromUrl(href));

  if (options.appConfigName !== defaultAppConfigName) {
    url.searchParams.set("config", options.appConfigName);
  }

  url.searchParams.set("world", options.selectedWorldId);
  url.searchParams.set("ui", serializeUiOptions(options.uiOptions));
  url.searchParams.set("debugLevel", options.debugLevel);
  url.searchParams.set("portalPanels", options.portalPanelMode);

  const debugOptions = serializeDebugOptions(options.debugOptions);
  if (debugOptions) {
    url.searchParams.set("debugOptions", debugOptions);
  }

  url.searchParams.set("debugOverlay", options.debugOverlayEnabled ? "true" : "false");
  url.searchParams.set("debugOverlayItems", serializeRuntimeDebugOverlayItems(options.debugOverlayItems));
  url.searchParams.set("renderQuality", options.renderQualityEnabled ? "true" : "false");
  url.searchParams.set("antiNausea", options.vrComfortOptions.antiNauseaModeEnabled ? "true" : "false");
  url.searchParams.set(
    "antiNauseaFovScale",
    String(options.vrComfortOptions.antiNauseaVisibleFovScale),
  );

  return url.toString();
}
