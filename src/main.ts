/**
 * Browser entry point: reads launch options from the URL (then strips them from the visible address), loads the app config, and runs the load pipeline world spec -> compileCellComplex -> asset preload -> createThreeApp.
 * It owns the single active ThreeApp and a monotonically increasing run id so that overlapping restarts (world change, config change, reload) dispose superseded apps and ignore stale async results.
 * It also stores runtime launch-option patches reported by the renderer (so a reload keeps them) and implements "copy URL with options" via the clipboard.
 * It exports nothing; it executes on import.
 */
import { compileCellComplex } from "./cell-complex/compileCellComplex";
import { describeGeometrySpec } from "./cell-complex/describeGeometry";
import { createInitialAppState } from "./appState";
import { loadWorldSpec } from "./authoring/worldCatalog";
import type { DebugSettings } from "./glue/debugSettings";
import { hasActiveDebugOption } from "./glue/debugOptions";
import {
  buildUrlWithLaunchOptions,
  replaceVisibleUrlWithoutLaunchOptions,
} from "./glue/launchOptionsUrl";
import { loadAppConfig, readAppConfigName } from "./glue/appConfig";
import { createLoadingStatus } from "./glue/loadingStatus";
import { readLaunchOptions, type LaunchOptions } from "./glue/readLaunchOptions";
import { createThreeApp, type ThreeApp } from "./render/three/createThreeApp";
import { type OwnedPreparedWorldAssets, preloadWorldAssets } from "./render/three/preloadWorldAssets";
import { installRuntimeDiagnostics } from "./render/three/runtimeDiagnostics";
import "./style.css";

const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("Missing #app element.");
}

const initialLaunchLocation = new URL(window.location.href) as unknown as Location;
const initialAppConfigName = readAppConfigName(initialLaunchLocation);
let launchOptions = readLaunchOptions(initialLaunchLocation, undefined, initialAppConfigName);
replaceVisibleUrlWithoutLaunchOptions(window);
let activeApp: ThreeApp | undefined;
// Preloaded assets of the active app; owned here and disposed after the app on every restart.
let activeAssets: OwnedPreparedWorldAssets | undefined;
let activeRunId = 0;

void startApp(appElement, initialLaunchLocation);

/**
 * Loads the app config named in the URL, then starts the first run with launch options resolved against it; shows an error in the loading status on failure.
 */
async function startApp(container: HTMLDivElement, initialLocation: Location): Promise<void> {
  const loadingStatus = createLoadingStatus(container);
  try {
    loadingStatus.setPhase("Loading app config");
    const appConfig = await loadAppConfig(initialAppConfigName);
    loadingStatus.dispose();
    void restartApp(container, readLaunchOptions(initialLocation, appConfig, initialAppConfigName));
  } catch (error) {
    console.error(error);
    loadingStatus.showError(error instanceof Error ? error.message : "Unable to load app config.");
  }
}

/**
 * Disposes the active app and builds a new one for the given launch options, discarding the result if a newer restart began meanwhile (runId check).
 */
async function restartApp(container: HTMLDivElement, nextLaunchOptions: LaunchOptions): Promise<void> {
  launchOptions = nextLaunchOptions;
  activeRunId += 1;
  const runId = activeRunId;

  // The app goes first: it may still reference the assets until its loop stops.
  activeApp?.dispose();
  activeApp = undefined;
  activeAssets?.dispose();
  activeAssets = undefined;

  const loadingStatus = createLoadingStatus(container);
  let assets: OwnedPreparedWorldAssets | undefined;
  try {
    loadingStatus.setPhase("Reading launch options");
    const geometrySpec = await loadingStatus.track("Loading world description", () =>
      loadWorldSpec(launchOptions.selectedWorldId),
    );
    console.info(describeGeometrySpec(geometrySpec));
    const world = await loadingStatus.track("Computing world", () => compileCellComplex(geometrySpec));
    applyRuntimeDiagnostics(world, {
      debugLevel: launchOptions.debugLevel,
      portalPanelMode: launchOptions.portalPanelMode,
      debugOptions: launchOptions.debugOptions,
    });
    const loadedAssets = await loadingStatus.track("Loading objects", () => preloadWorldAssets(world));
    assets = loadedAssets;
    loadingStatus.setPhase("Placing player");
    const appState = createInitialAppState(world);
    const nextApp = await loadingStatus.track("Preparing renderer", () =>
      createThreeApp(container, appState, {
        selectedWorldId: launchOptions.selectedWorldId,
        worldSpec: geometrySpec,
        debugLevel: launchOptions.debugLevel,
        portalPanelMode: launchOptions.portalPanelMode,
        debugOptions: launchOptions.debugOptions,
        debugOverlayEnabled: launchOptions.debugOverlayEnabled,
        debugOverlayItems: launchOptions.debugOverlayItems,
        renderQualityEnabled: launchOptions.renderQualityEnabled,
        vrComfortOptions: launchOptions.vrComfortOptions,
        appConfigName: launchOptions.appConfigName,
        appConfig: launchOptions.appConfig,
        assets: loadedAssets,
        onWorldChangeRequested(worldId) {
          void restartApp(container, {
            ...launchOptions,
            selectedWorldId: worldId,
          });
        },
        onAppConfigChangeRequested(configName) {
          void restartAppWithConfig(container, configName);
        },
        onReloadRequested() {
          void restartApp(container, launchOptions);
        },
        onLaunchOptionsChanged(patch) {
          launchOptions = {
            ...launchOptions,
            ...patch,
          };
        },
        onCopyUrlWithOptionsRequested() {
          void copyUrlWithOptions(launchOptions);
        },
      }),
    );

    if (runId !== activeRunId) {
      nextApp.dispose();
      loadedAssets.dispose();
      loadingStatus.dispose();
      return;
    }

    activeApp = nextApp;
    activeAssets = loadedAssets;
    loadingStatus.dispose();
  } catch (error) {
    assets?.dispose();
    if (runId !== activeRunId) {
      loadingStatus.dispose();
      return;
    }

    console.error(error);
    loadingStatus.showError(error instanceof Error ? error.message : "Unable to start the world.");
  }
}

/**
 * Loads a different app config and restarts with launch options re-read from a synthetic URL containing only config (and world, when the config's menu allows world selection).
 */
async function restartAppWithConfig(container: HTMLDivElement, configName: string): Promise<void> {
  const appConfig = await loadAppConfig(configName);
  const configLocation = new URL(window.location.href) as unknown as Location;
  const params = new URLSearchParams();
  params.set("config", configName);
  if (appConfig.menu.worldSelectionSectionEnabled) {
    params.set("world", launchOptions.selectedWorldId);
  }
  configLocation.search = params.toString();
  void restartApp(container, readLaunchOptions(configLocation, appConfig, configName));
}

/**
 * Installs per-frame runtime diagnostics on the compiled world, enabled only if the "runtime-diagnostics" debug option is active.
 */
function applyRuntimeDiagnostics(world: Parameters<typeof installRuntimeDiagnostics>[0], settings: DebugSettings): void {
  installRuntimeDiagnostics(
    world,
    settings.debugLevel,
    hasActiveDebugOption(settings.debugLevel, settings.debugOptions, "runtime-diagnostics"),
  );
}

/**
 * Copies the current URL with launch options serialized into it to the clipboard; logs a warning instead of throwing if the clipboard is unavailable.
 */
async function copyUrlWithOptions(options: LaunchOptions): Promise<void> {
  const url = buildUrlWithLaunchOptions(window.location.href, options);

  try {
    await navigator.clipboard.writeText(url);
    console.info("[noneuclid] copied URL with options", url);
  } catch (error) {
    console.warn("[noneuclid] unable to copy URL with options", error, url);
  }
}
