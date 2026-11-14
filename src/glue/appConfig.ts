/**
 * Loads and normalizes the app configuration: a per-deployment JavaScript file (<name>.config.js in the public folder, chosen by the ?config= URL parameter) that sets the starting world, which menu sections and tools are enabled, and debug defaults.
 * loadAppConfig dynamically imports the file (cache-busted), follows "forwardTo" redirects up to a fixed depth with loop detection, and passes the raw object through normalizeAppConfig, which accepts only well-typed fields and falls back to defaultAppConfig field by field. Any load failure degrades to the built-in defaults with a console warning rather than throwing.
 * AppConfig values are immutable; launch-option parsing (readLaunchOptions.ts) uses them as defaults beneath explicit URL parameters, and the menu/palette uses them to gate sections and tools.
 */
import { findWorldCatalogEntry, normalizeWorldId, defaultWorldId } from "../authoring/worldCatalog";
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { findPlatonicSolid } from "../cell-complex/platonicSolid";
import { debugOptionDefinitions, type DebugOptionId } from "./debugOptions";
import { parseDebugLevel, type DebugLevelId } from "../diagnostics/debugLevels";
import { parsePortalPanelMode, type PortalPanelModeId } from "./portalPanelMode";
import type { RuntimeDebugOverlayItemId, RuntimeToolId } from "./toolIds";
import { publicUrl } from "./assetUrls";

/** Id of a main-menu tool that an app config can switch on or off. */
export type ConfigurableToolId = "placedFlags/flag" | "geodesicEmitters/emitter" | "geodesicMeasurements/length" | "geodesicMeasurements/protractor" | "worldMap/map";

/** Which optional menu sections the app config enables. */
export interface AppMenuConfig {
  readonly configSelectionSectionEnabled: boolean;
  readonly worldSelectionSectionEnabled: boolean;
  readonly debugSectionEnabled: boolean;
}

/**
 * Which tools the app config enables (placeFlags = signs, geodesicEmitters = rays, distances = length tool, angles = protractor, worldMap = the map of a world that is a Platonic solid).
 */
export interface AppToolConfig {
  readonly placeFlags: boolean;
  readonly geodesicEmitters: boolean;
  readonly distances: boolean;
  readonly angles: boolean;
  readonly worldMap: boolean;
}

/** Default debug settings supplied by the app config; URL parameters can override them. */
export interface AppDebugConfig {
  readonly level: DebugLevelId;
  readonly portalPanelMode: PortalPanelModeId;
  readonly options: readonly DebugOptionId[];
  readonly overlayEnabled: boolean;
  readonly overlayItems: readonly RuntimeDebugOverlayItemId[];
  readonly renderQualityEnabled: boolean;
}

/** Fully normalized app configuration: starting world, menu sections, tools and debug defaults. */
export interface AppConfig {
  /** Catalog id of the world to start in when the URL does not name one; always a known catalog entry. */
  readonly startingWorldId: string;
  readonly menu: AppMenuConfig;
  readonly tools: AppToolConfig;
  readonly debug: AppDebugConfig;
}

/** Untrusted shape of a loaded config module's default export before normalization. */
export type RawAppConfig = Record<string, unknown>;

/** Name of the built-in config used when none (or an invalid one) is requested. */
export const defaultAppConfigName = "default";

/** Selectable app config: file-name id and menu label. */
export interface AppConfigCatalogEntry {
  readonly id: string;
  readonly label: string;
}

/**
 * App configs offered in the settings menu; ids correspond to <id>.config.js files in the public folder.
 */
export const appConfigCatalog: readonly AppConfigCatalogEntry[] = [
  { id: "default", label: "Default" },
  { id: "full", label: "Full sandbox" },
  { id: "001", label: "001 Activity 1" },
  { id: "002", label: "002 Activity 2" },
  { id: "003", label: "003 Activity 3" },
];

const defaultDebugOverlayItems = ["fps", "location", "portal-quantities"] as const;
const debugOptionIds = debugOptionDefinitions.map((option) => option.id);
const maxAppConfigForwardDepth = 8;

/**
 * Built-in configuration used when no config file is available or a field is missing: default world, everything enabled, debug off.
 */
export const defaultAppConfig: AppConfig = {
  startingWorldId: defaultWorldId,
  menu: {
    configSelectionSectionEnabled: true,
    worldSelectionSectionEnabled: true,
    debugSectionEnabled: true,
  },
  tools: {
    placeFlags: true,
    geodesicEmitters: true,
    distances: true,
    angles: true,
    worldMap: true,
  },
  debug: {
    level: "off",
    portalPanelMode: "none",
    options: [],
    overlayEnabled: true,
    overlayItems: [...defaultDebugOverlayItems],
    renderQualityEnabled: false,
  },
};

/**
 * Loads and normalizes the named config (default "default"), following forwardTo redirects; never rejects and returns defaultAppConfig on any failure or forwarding loop.
 */
export async function loadAppConfig(configName = defaultAppConfigName): Promise<AppConfig> {
  return loadAppConfigByName(normalizeAppConfigName(configName), new Set(), 0);
}

async function loadAppConfigByName(configName: string, visitedConfigNames: Set<string>, depth: number): Promise<AppConfig> {
  const configUrl = buildAppConfigUrl(configName);
  try {
    const module = await import(/* @vite-ignore */ `${configUrl}?v=${Date.now()}`);
    const rawConfig = module.default ?? module.noneuclidConfig ?? {};
    const forwardConfigName = readAppConfigForwardName(rawConfig);

    if (forwardConfigName) {
      if (depth >= maxAppConfigForwardDepth || visitedConfigNames.has(forwardConfigName)) {
        console.warn("[noneuclid] using built-in defaults; app config forwarding loop detected", {
          configName,
          forwardConfigName,
        });
        return defaultAppConfig;
      }

      visitedConfigNames.add(configName);
      return loadAppConfigByName(forwardConfigName, visitedConfigNames, depth + 1);
    }

    return normalizeAppConfig(rawConfig);
  } catch (error) {
    console.warn("[noneuclid] using built-in defaults; unable to load app config", error);
    return defaultAppConfig;
  }
}

/** Reads the config name from the ?config= (or ?configName=) URL parameter, normalized. */
export function readAppConfigName(location: Location): string {
  const params = new URLSearchParams(location.search);
  return normalizeAppConfigName(params.get("config") ?? params.get("configName"));
}

/**
 * Strips a ".js"/".config.js" suffix and returns the name only if it is made of letters, digits, "_" or "-"; otherwise returns the default name (guards the dynamic import path).
 */
export function normalizeAppConfigName(rawValue: string | null | undefined): string {
  if (!rawValue) {
    return defaultAppConfigName;
  }

  const withoutExtension = rawValue.replace(/(\.config)?\.js$/, "");
  return /^[a-zA-Z0-9_-]+$/.test(withoutExtension) ? withoutExtension : defaultAppConfigName;
}

/** Returns the URL of the config file for a name under the public base path. */
export function buildAppConfigUrl(configName: string): string {
  return publicUrl(`${normalizeAppConfigName(configName)}.config.js`);
}

/** Returns the validated name in a raw config's forwardTo field, or undefined if absent or invalid. */
export function readAppConfigForwardName(rawConfig: unknown): string | undefined {
  const raw = isRecord(rawConfig) ? rawConfig : {};
  const value = raw.forwardTo;

  if (typeof value !== "string") {
    return undefined;
  }

  const withoutExtension = value.replace(/(\.config)?\.js$/, "");
  return /^[a-zA-Z0-9_-]+$/.test(withoutExtension) ? withoutExtension : undefined;
}

/**
 * Converts an untrusted raw config object into an AppConfig, taking each recognized field only if it has the right type and valid value and otherwise using the default; accepts optionsMenu or menu for the menu block.
 */
export function normalizeAppConfig(rawConfig: unknown): AppConfig {
  const raw = isRecord(rawConfig) ? rawConfig : {};
  const rawMenu = readRecord(raw, "optionsMenu") ?? readRecord(raw, "menu") ?? {};
  const rawTools = readRecord(raw, "tools") ?? {};
  const rawDebug = readRecord(raw, "debug") ?? {};
  const rawOverlay = readRecord(rawDebug, "overlay") ?? {};

  return {
    startingWorldId: readWorldId(raw, "startingWorld") ?? readWorldId(raw, "startingWorldId") ?? defaultAppConfig.startingWorldId,
    menu: {
      configSelectionSectionEnabled: readBoolean(
        rawMenu,
        "configSelectionSection",
        defaultAppConfig.menu.configSelectionSectionEnabled,
      ),
      worldSelectionSectionEnabled: readBoolean(rawMenu, "worldSelectionSection", defaultAppConfig.menu.worldSelectionSectionEnabled),
      debugSectionEnabled: readBoolean(rawMenu, "debugSection", defaultAppConfig.menu.debugSectionEnabled),
    },
    tools: {
      placeFlags: readBoolean(rawTools, "placeFlags", defaultAppConfig.tools.placeFlags),
      geodesicEmitters: readBoolean(rawTools, "geodesicEmitters", defaultAppConfig.tools.geodesicEmitters),
      distances: readBoolean(rawTools, "distances", defaultAppConfig.tools.distances),
      angles: readBoolean(rawTools, "angles", defaultAppConfig.tools.angles),
      worldMap: readBoolean(rawTools, "worldMap", defaultAppConfig.tools.worldMap),
    },
    debug: {
      level: readDebugLevel(rawDebug, "level", defaultAppConfig.debug.level),
      portalPanelMode: readPortalPanelMode(rawDebug, "portalPanels", defaultAppConfig.debug.portalPanelMode),
      options: readDebugOptions(rawDebug),
      overlayEnabled: readBoolean(rawOverlay, "enabled", defaultAppConfig.debug.overlayEnabled),
      overlayItems: readOverlayItems(rawOverlay),
      renderQualityEnabled: readBoolean(rawDebug, "renderQuality", defaultAppConfig.debug.renderQualityEnabled),
    },
  };
}

/**
 * Returns whether the config permits a tool; cannon sub-modes follow geodesicEmitters, and non-configurable tools (none, aim) are always enabled.
 */
export function isRuntimeToolEnabled(config: AppConfig, toolId: RuntimeToolId): boolean {
  switch (toolId) {
    case "placedFlags/flag":
      return config.tools.placeFlags;
    case "geodesicEmitters/emitter":
    case "geodesicEmitters/carry":
    case "geodesicEmitters/rotate":
    case "geodesicEmitters/aim":
    case "geodesicModel/tie":
      return config.tools.geodesicEmitters;
    case "geodesicMeasurements/length":
      return config.tools.distances;
    case "geodesicMeasurements/protractor":
      return config.tools.angles;
    case "worldMap/map":
      return config.tools.worldMap;
    default:
      return true;
  }
}

/**
 * Lists the configurable tools enabled by the config, in main-menu order (sign, emitter, length, protractor, map).
 */
export function getEnabledMainTools(config: AppConfig): readonly ConfigurableToolId[] {
  return [
    ...(config.tools.placeFlags ? (["placedFlags/flag"] as const) : []),
    ...(config.tools.geodesicEmitters ? (["geodesicEmitters/emitter"] as const) : []),
    ...(config.tools.distances ? (["geodesicMeasurements/length"] as const) : []),
    ...(config.tools.angles ? (["geodesicMeasurements/protractor"] as const) : []),
    ...(config.tools.worldMap ? (["worldMap/map"] as const) : []),
  ];
}

/**
 * The config as it applies to `world`: a world that is not a Platonic solid has no map, so the tool is off there, which takes it off the menu and makes the world refuse it.
 * A deformation cannot change the answer: only torus worlds deform, and they stay tori.
 */
export function appConfigForWorld(config: AppConfig, world: CompiledCellComplex): AppConfig {
  if (!config.tools.worldMap || findPlatonicSolid(world) !== undefined) return config;
  return { ...config, tools: { ...config.tools, worldMap: false } };
}

function readWorldId(raw: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = raw[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeWorldId(value);
  return normalized && findWorldCatalogEntry(normalized) ? normalized : undefined;
}

function readDebugLevel(raw: Readonly<Record<string, unknown>>, key: string, fallback: DebugLevelId): DebugLevelId {
  const value = raw[key];
  return typeof value === "string" ? parseDebugLevel(value) ?? fallback : fallback;
}

function readPortalPanelMode(raw: Readonly<Record<string, unknown>>, key: string, fallback: PortalPanelModeId): PortalPanelModeId {
  const value = raw[key];
  return typeof value === "string" ? parsePortalPanelMode(value) ?? fallback : fallback;
}

function readDebugOptions(rawDebug: Readonly<Record<string, unknown>>): readonly DebugOptionId[] {
  const rawOptions = readRecord(rawDebug, "options") ?? rawDebug;
  return debugOptionIds.filter((optionId) => rawOptions[optionId] === true);
}

function readOverlayItems(rawOverlay: Readonly<Record<string, unknown>>): readonly RuntimeDebugOverlayItemId[] {
  const rawItems = readRecord(rawOverlay, "items") ?? {};
  return defaultDebugOverlayItems.filter((itemId) => rawItems[itemId] !== false);
}

function readBoolean(raw: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const value = raw[key];
  return typeof value === "boolean" ? value : fallback;
}

function readRecord(raw: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> | undefined {
  const value = raw[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
