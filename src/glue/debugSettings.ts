/**
 * Value types describing a complete debug configuration (level, portal panel mode and enabled options) and a predicate telling whether a change to it can be applied to a running world without a reload.
 * DebugSettingsSupport lists the options the renderer can toggle live; by default all current options are runtime-mutable.
 */
import type { DebugOptionId } from "./debugOptions";
import type { DebugLevelId } from "./debugLevels";
import type { PortalPanelModeId } from "./portalPanelMode";

/** Debug configuration: console level, portal panel mode and enabled debug options. */
export interface DebugSettings {
  readonly debugLevel: DebugLevelId;
  readonly portalPanelMode: PortalPanelModeId;
  readonly debugOptions: readonly DebugOptionId[];
}

/** Declares which debug options the running renderer can switch without restarting. */
export interface DebugSettingsSupport {
  readonly runtimeMutableOptions: readonly DebugOptionId[];
}

const defaultDebugSettingsSupport: DebugSettingsSupport = {
  runtimeMutableOptions: [
    "runtime-diagnostics",
    "portal-path-debug",
    "portal-static-cull-debug",
    "portal-visible-path-debug",
    "portal-path-overlays",
    "portal-path-overlay-instances",
    "forbidden-zone-wireframes",
    "object-collision-wireframes",
    "selectable-hitboxes",
    "aim-collision-outlines",
  ],
};

/**
 * Returns true when every enabled option is runtime-mutable according to support (default: all known options), i.e. no reload is needed.
 */
export function canApplyDebugSettingsAtRuntime(
  settings: DebugSettings,
  support: DebugSettingsSupport = defaultDebugSettingsSupport,
): boolean {
  const runtimeMutableOptions = new Set<DebugOptionId>(support.runtimeMutableOptions);
  return settings.debugOptions.every((optionId) => runtimeMutableOptions.has(optionId));
}
