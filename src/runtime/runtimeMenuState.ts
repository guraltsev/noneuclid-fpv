/**
 * Renderer-neutral state machine for the in-game menu, shared by the desktop overlay and the VR palette.
 * RuntimeMenuState is a single immutable record holding which page is showing, per-page payloads (sign editing, cannon actions, geometry computer, tutorial, goal, question help), and the user's settings (debug level and options, portal panel mode, selected tool, anti-nausea mode).
 * Every transition is a pure function (state, args) -> new state that spreads the old state and never mutates it; functions that do not apply to the current page return the same state object unchanged. The renderer owns the current value and replaces it after each transition.
 * Page-scoped payloads (editSignOptions, geodesicCannonOptions, ...) are cleared by closeRuntimeMenu and showRuntimeMenuMainPage so stale data never leaks to a later page; "show..." transitions for object-driven pages also force isOpen to true.
 * The debug-related fields round-trip with DebugSettings via createRuntimeMenuState and createDebugSettingsFromRuntimeMenuState.
 */
import type { DebugOptionId } from "../glue/debugOptions";
import type { DebugSettings } from "../glue/debugSettings";
import type { DebugLevelId } from "../glue/debugLevels";
import type { PortalPanelModeId } from "../glue/portalPanelMode";
import type { VrComfortOptions } from "../glue/vrComfortOptions";
import type { PlacedFlagType } from "../world-objects/placedFlags";
import type { TutorialPageSpec } from "../cell-complex/specs";
import { defaultAppConfigName } from "../glue/appConfig";

/** Identifier of a menu page; "main" is the tool palette and the default. */
export type RuntimeMenuPageId =
  | "main"
  | "settings"
  | "debug-settings"
  | "place-flag-options"
  | "edit-sign"
  | "geodesic-cannon-actions"
  | "geometry-computer-actions"
  | "question-help"
  | "tutorial"
  | "goal";
/**
 * Console log levels selectable in the menu (every debug level except "off", which is the debug toggle).
 */
export type RuntimeMenuConsoleLogLevelId = Exclude<DebugLevelId, "off">;
/** Item that can be shown in the on-screen debug overlay. */
export type RuntimeDebugOverlayItemId = "fps" | "location" | "portal-quantities";
/** Tool the player can have active, including the geodesic-cannon sub-modes. */
export type RuntimeToolId =
  | "none"
  | "aim"
  | "place-flag"
  | "geodesic-cannon"
  | "measure-length"
  | "protractor"
  | "geodesic-cannon-carry"
  | "geodesic-cannon-rotate"
  | "geodesic-cannon-aim"
  | "geodesic-cannon-tie-detach";

const defaultRuntimeDebugOverlayItems = ["fps", "location", "portal-quantities"] as const;
const portalInspectionDebugOptions = [
  "portal-path-debug",
  "portal-static-cull-debug",
  "portal-path-overlays",
  "portal-path-overlay-instances",
] as const satisfies readonly DebugOptionId[];
const collisionGeometryDebugOptions = [
  "forbidden-zone-wireframes",
  "object-collision-wireframes",
] as const satisfies readonly DebugOptionId[];
const aimCollisionDebugOptions = [
  "aim-collision-outlines",
] as const satisfies readonly DebugOptionId[];

/**
 * Complete immutable menu state: visibility, current page, page payloads and user-adjustable settings.
 */
export interface RuntimeMenuState {
  /** Whether the menu is visible. */
  readonly isOpen: boolean;
  /** Page currently displayed; payload fields for that page are expected to be set. */
  readonly page: RuntimeMenuPageId;
  /**
   * Catalog id of the world that the world picker has selected (not necessarily the running one until applied).
   */
  readonly selectedWorldId: string;
  /** Name of the app config chosen in the menu. */
  readonly selectedAppConfigName: string;
  /**
   * Master debug switch; when false, createDebugSettingsFromRuntimeMenuState yields level "off", no options and no portal panel.
   */
  readonly debugEnabled: boolean;
  /** Console log level used while debug is enabled. */
  readonly consoleLogLevel: RuntimeMenuConsoleLogLevelId;
  /** Whether the debug overlay is shown. */
  readonly debugOverlayEnabled: boolean;
  /** Overlay items shown, kept in canonical order (fps, location, portal-quantities) without duplicates. */
  readonly debugOverlayItems: readonly RuntimeDebugOverlayItemId[];
  /** How portal walls, placards and text are drawn. */
  readonly portalPanelMode: PortalPanelModeId;
  /** Enables the group of portal path/cull debug options. */
  readonly portalInspectionEnabled: boolean;
  /** Enables wireframes for forbidden zones and object collision shapes. */
  readonly collisionGeometryWireframesEnabled: boolean;
  /** Enables outlines of what the aim ray collides with. */
  readonly aimCollisionOutlinesEnabled: boolean;
  /** VR comfort setting; defaults to true. */
  readonly antiNauseaModeEnabled: boolean;
  /** Currently active tool. */
  readonly selectedTool: RuntimeToolId;
  /**
   * Deadline (ms, caller's clock) until which a pending reload is awaiting confirmation; undefined when none.
   */
  readonly reloadConfirmUntilMs?: number;
  /** Options for the place-flag tool. */
  readonly placeFlagOptions: {
    readonly flagType: PlacedFlagType;
  };
  /** Sign being edited on the edit-sign page: flag id and its current message text. */
  readonly editSignOptions?: {
    readonly flagId: string;
    readonly message: string;
  };
  /**
   * Payload of the geodesic-cannon-actions page: cannon id, its geodesics with optional display labels, which are locked, and whether tie/detach is possible.
   */
  readonly geodesicCannonOptions?: {
    readonly cannonId: string;
    readonly geodesicIds: readonly string[];
    readonly geodesicLabelsById?: Readonly<Record<string, string>>;
    readonly lockedGeodesicIds?: readonly string[];
    readonly canTieAndDetach?: boolean;
  };
  /**
   * Payload of the geometry-computer-actions page: computer id, availability, torus width and current/target skew a and depth b in meters.
   */
  readonly geometryComputerOptions?: {
    readonly computerId: string;
    readonly available: boolean;
    readonly widthMeters?: number;
    readonly currentSkewXMeters?: number;
    readonly currentDepthMeters?: number;
    readonly targetSkewXMeters?: number;
    readonly targetDepthMeters?: number;
  };
  /** Payload of the tutorial page; pageIndex is always within pages. */
  readonly tutorialOptions?: {
    readonly objectId: string;
    readonly pages: readonly TutorialPageSpec[];
    readonly pageIndex: number;
  };
  /** Payload of the goal page; pageIndex is always within pages. */
  readonly goalOptions?: {
    readonly objectId: string;
    readonly pages: readonly TutorialPageSpec[];
    readonly pageIndex: number;
  };
  /**
   * Tutorial and goal pages offered by a help object on the question-help page, retained across tutorial/goal subpages.
   */
  readonly questionHelpOptions?: {
    readonly objectId: string;
    readonly tutorialPages: readonly TutorialPageSpec[];
    readonly goalPages: readonly TutorialPageSpec[];
  };
  /** Id of the placed flag whose sign is being edited, if any. */
  readonly editingFlagId?: string;
}

/** Launch-time values used to seed the initial menu state. */
export interface CreateRuntimeMenuStateOptions {
  readonly selectedWorldId: string;
  readonly selectedAppConfigName?: string;
  readonly debugSettings?: DebugSettings;
  readonly debugOverlayEnabled?: boolean;
  readonly debugOverlayItems?: readonly RuntimeDebugOverlayItemId[];
  readonly vrComfortOptions?: Pick<VrComfortOptions, "antiNauseaModeEnabled">;
}

/**
 * Creates a closed menu on the main page seeded from launch settings: debug flags are derived from the given DebugSettings, the overlay defaults to enabled with all items, anti-nausea defaults to true, no tool is selected and the flag type is "WoodenSign1".
 */
export function createRuntimeMenuState(options: CreateRuntimeMenuStateOptions): RuntimeMenuState {
  const debugSettings = options.debugSettings;

  return {
    isOpen: false,
    page: "main",
    selectedWorldId: options.selectedWorldId,
    selectedAppConfigName: options.selectedAppConfigName ?? defaultAppConfigName,
    debugEnabled: debugSettings?.debugLevel !== "off",
    consoleLogLevel: debugSettings?.debugLevel === "verbose" ? "verbose" : "basic",
    debugOverlayEnabled: options.debugOverlayEnabled ?? true,
    debugOverlayItems: options.debugOverlayItems ?? [...defaultRuntimeDebugOverlayItems],
    portalPanelMode: debugSettings?.portalPanelMode ?? "none",
    portalInspectionEnabled: hasAnyDebugOption(debugSettings?.debugOptions, portalInspectionDebugOptions),
    collisionGeometryWireframesEnabled: hasAnyDebugOption(
      debugSettings?.debugOptions,
      collisionGeometryDebugOptions,
    ),
    aimCollisionOutlinesEnabled: hasAnyDebugOption(debugSettings?.debugOptions, aimCollisionDebugOptions),
    antiNauseaModeEnabled: options.vrComfortOptions?.antiNauseaModeEnabled ?? true,
    selectedTool: "none",
    placeFlagOptions: {
      flagType: "WoodenSign1",
    },
  };
}

/** Opens the menu on the main page. */
export function openRuntimeMenu(state: RuntimeMenuState): RuntimeMenuState {
  return {
    ...state,
    isOpen: true,
    page: "main",
  };
}

/**
 * Closes the menu, returns to the main page and clears all page payloads and editingFlagId (the selected tool is kept).
 */
export function closeRuntimeMenu(state: RuntimeMenuState): RuntimeMenuState {
  return {
    ...state,
    isOpen: false,
    page: "main",
    editSignOptions: undefined,
    geodesicCannonOptions: undefined,
    geometryComputerOptions: undefined,
    tutorialOptions: undefined,
    goalOptions: undefined,
    questionHelpOptions: undefined,
    editingFlagId: undefined,
  };
}

/** Switches to the settings page without changing visibility. */
export function showRuntimeMenuSettings(state: RuntimeMenuState): RuntimeMenuState {
  return {
    ...state,
    page: "settings",
  };
}

/** Switches to the debug-settings page without changing visibility. */
export function showRuntimeMenuDebugSettings(state: RuntimeMenuState): RuntimeMenuState {
  return {
    ...state,
    page: "debug-settings",
  };
}

/** Switches to the place-flag options page without changing visibility. */
export function showRuntimeMenuPlaceFlagOptions(state: RuntimeMenuState): RuntimeMenuState {
  return {
    ...state,
    page: "place-flag-options",
  };
}

/**
 * Returns to the main page, resets the selected tool to "none" and clears all page payloads and editingFlagId.
 */
export function showRuntimeMenuMainPage(state: RuntimeMenuState): RuntimeMenuState {
  return {
    ...state,
    page: "main",
    selectedTool: "none",
    editSignOptions: undefined,
    geodesicCannonOptions: undefined,
    geometryComputerOptions: undefined,
    tutorialOptions: undefined,
    goalOptions: undefined,
    questionHelpOptions: undefined,
    editingFlagId: undefined,
  };
}

/** Opens the menu on the edit-sign page for the given flag and message. */
export function showRuntimeMenuEditSign(
  state: RuntimeMenuState,
  options: {
    readonly flagId: string;
    readonly message: string;
  },
): RuntimeMenuState {
  return {
    ...state,
    isOpen: true,
    page: "edit-sign",
    editingFlagId: options.flagId,
    editSignOptions: {
      flagId: options.flagId,
      message: options.message,
    },
  };
}

/** Opens the menu on the cannon actions page for the given cannon; geodesicIds defaults to empty. */
export function showRuntimeMenuGeodesicCannonActions(
  state: RuntimeMenuState,
  options: {
    readonly cannonId: string;
    readonly geodesicIds?: readonly string[];
    readonly geodesicLabelsById?: Readonly<Record<string, string>>;
    readonly lockedGeodesicIds?: readonly string[];
    readonly canTieAndDetach?: boolean;
  },
): RuntimeMenuState {
  return {
    ...state,
    isOpen: true,
    page: "geodesic-cannon-actions",
    geodesicCannonOptions: {
      cannonId: options.cannonId,
      geodesicIds: options.geodesicIds ?? [],
      geodesicLabelsById: options.geodesicLabelsById,
      lockedGeodesicIds: options.lockedGeodesicIds,
      canTieAndDetach: options.canTieAndDetach,
    },
  };
}

/**
 * Opens the menu on the geometry-computer page with the computer's availability and the torus measurements (all optional numbers in meters).
 */
export function showRuntimeMenuGeometryComputerActions(
  state: RuntimeMenuState,
  options: {
    readonly computerId: string;
    readonly available: boolean;
    readonly widthMeters?: number;
    readonly currentSkewXMeters?: number;
    readonly currentDepthMeters?: number;
    readonly targetSkewXMeters?: number;
    readonly targetDepthMeters?: number;
  },
): RuntimeMenuState {
  return {
    ...state,
    isOpen: true,
    page: "geometry-computer-actions",
    geometryComputerOptions: {
      computerId: options.computerId,
      available: options.available,
      widthMeters: options.widthMeters,
      currentSkewXMeters: options.currentSkewXMeters,
      currentDepthMeters: options.currentDepthMeters,
      targetSkewXMeters: options.targetSkewXMeters,
      targetDepthMeters: options.targetDepthMeters,
    },
  };
}

/**
 * Opens the tutorial page for an object's pages, with pageIndex clamped to the valid range (default 0).
 */
export function showRuntimeMenuTutorial(
  state: RuntimeMenuState,
  options: {
    readonly objectId: string;
    readonly pages: readonly TutorialPageSpec[];
    readonly pageIndex?: number;
  },
): RuntimeMenuState {
  return {
    ...state,
    isOpen: true,
    page: "tutorial",
    tutorialOptions: {
      objectId: options.objectId,
      pages: options.pages,
      pageIndex: clampTutorialPageIndex(options.pageIndex ?? 0, options.pages),
    },
  };
}

/**
 * Opens the question-help page, using the given options or else the stored questionHelpOptions; returns the state unchanged if neither exists. Clears tutorial and goal payloads.
 */
export function showRuntimeMenuQuestionHelp(
  state: RuntimeMenuState,
  options?: {
    readonly objectId: string;
    readonly tutorialPages?: readonly TutorialPageSpec[];
    readonly goalPages?: readonly TutorialPageSpec[];
  },
): RuntimeMenuState {
  const questionHelpOptions = options
    ? {
        objectId: options.objectId,
        tutorialPages: options.tutorialPages ?? [],
        goalPages: options.goalPages ?? [],
      }
    : state.questionHelpOptions;
  if (!questionHelpOptions) {
    return state;
  }

  return {
    ...state,
    isOpen: true,
    page: "question-help",
    questionHelpOptions,
    tutorialOptions: undefined,
    goalOptions: undefined,
  };
}

/**
 * Opens the tutorial subpage from stored question-help options; unchanged if they are missing or have no tutorial pages.
 */
export function showRuntimeMenuQuestionTutorial(state: RuntimeMenuState): RuntimeMenuState {
  const options = state.questionHelpOptions;
  if (!options || options.tutorialPages.length === 0) {
    return state;
  }

  return showRuntimeMenuTutorial(state, {
    objectId: options.objectId,
    pages: options.tutorialPages,
  });
}

/**
 * Opens the goal page from the given options or the stored question-help goal pages; unchanged if there are no pages.
 */
export function showRuntimeMenuGoal(
  state: RuntimeMenuState,
  options?: {
    readonly objectId: string;
    readonly pages: readonly TutorialPageSpec[];
    readonly pageIndex?: number;
  },
): RuntimeMenuState {
  const resolvedOptions = options ?? (state.questionHelpOptions
    ? {
        objectId: state.questionHelpOptions.objectId,
        pages: state.questionHelpOptions.goalPages,
      }
    : undefined);
  if (!resolvedOptions || resolvedOptions.pages.length === 0) {
    return state;
  }

  return {
    ...state,
    isOpen: true,
    page: "goal",
    goalOptions: {
      objectId: resolvedOptions.objectId,
      pages: resolvedOptions.pages,
      pageIndex: clampTutorialPageIndex(resolvedOptions.pageIndex ?? 0, resolvedOptions.pages),
    },
  };
}

/** Sets the tutorial page index, clamped to range; unchanged if no tutorial is showing. */
export function setRuntimeMenuTutorialPageIndex(
  state: RuntimeMenuState,
  pageIndex: number,
): RuntimeMenuState {
  if (!state.tutorialOptions) {
    return state;
  }

  return {
    ...state,
    tutorialOptions: {
      ...state.tutorialOptions,
      pageIndex: clampTutorialPageIndex(pageIndex, state.tutorialOptions.pages),
    },
  };
}

/** Sets the goal page index, clamped to range; unchanged if no goal is showing. */
export function setRuntimeMenuGoalPageIndex(
  state: RuntimeMenuState,
  pageIndex: number,
): RuntimeMenuState {
  if (!state.goalOptions) {
    return state;
  }

  return {
    ...state,
    goalOptions: {
      ...state.goalOptions,
      pageIndex: clampTutorialPageIndex(pageIndex, state.goalOptions.pages),
    },
  };
}

/** Replaces the sign text being edited; unchanged if no sign is being edited. */
export function setRuntimeMenuEditingSignMessage(state: RuntimeMenuState, message: string): RuntimeMenuState {
  if (!state.editSignOptions) {
    return state;
  }

  return {
    ...state,
    editSignOptions: {
      ...state.editSignOptions,
      message,
    },
  };
}

/** Records the world id chosen in the world picker. */
export function setRuntimeMenuSelectedWorldId(state: RuntimeMenuState, worldId: string): RuntimeMenuState {
  return {
    ...state,
    selectedWorldId: worldId,
  };
}

/** Records the app config name chosen in the menu. */
export function setRuntimeMenuSelectedAppConfigName(state: RuntimeMenuState, configName: string): RuntimeMenuState {
  return {
    ...state,
    selectedAppConfigName: configName,
  };
}

/** Sets the master debug switch. */
export function setRuntimeMenuDebugEnabled(state: RuntimeMenuState, enabled: boolean): RuntimeMenuState {
  return {
    ...state,
    debugEnabled: enabled,
  };
}

/** Sets the console log level used when debug is enabled. */
export function setRuntimeMenuConsoleLogLevel(
  state: RuntimeMenuState,
  level: RuntimeMenuConsoleLogLevelId,
): RuntimeMenuState {
  return {
    ...state,
    consoleLogLevel: level,
  };
}

/** Shows or hides the debug overlay. */
export function setRuntimeMenuDebugOverlayEnabled(state: RuntimeMenuState, enabled: boolean): RuntimeMenuState {
  return {
    ...state,
    debugOverlayEnabled: enabled,
  };
}

/**
 * Adds (enabled = true) or removes an overlay item, keeping items deduplicated and in canonical order.
 */
export function toggleRuntimeMenuDebugOverlayItem(
  state: RuntimeMenuState,
  itemId: RuntimeDebugOverlayItemId,
  enabled: boolean,
): RuntimeMenuState {
  const nextItems = enabled
    ? state.debugOverlayItems.includes(itemId)
      ? state.debugOverlayItems
      : [...state.debugOverlayItems, itemId]
    : state.debugOverlayItems.filter((entry) => entry !== itemId);

  return {
    ...state,
    debugOverlayItems: orderRuntimeDebugOverlayItems(nextItems),
  };
}

/** Sets the portal panel rendering mode. */
export function setRuntimeMenuPortalPanelMode(
  state: RuntimeMenuState,
  portalPanelMode: PortalPanelModeId,
): RuntimeMenuState {
  return {
    ...state,
    portalPanelMode,
  };
}

/** Enables or disables the portal inspection debug option group. */
export function setRuntimeMenuPortalInspectionEnabled(state: RuntimeMenuState, enabled: boolean): RuntimeMenuState {
  return {
    ...state,
    portalInspectionEnabled: enabled,
  };
}

/** Enables or disables collision-geometry wireframes. */
export function setRuntimeMenuCollisionGeometryWireframesEnabled(
  state: RuntimeMenuState,
  enabled: boolean,
): RuntimeMenuState {
  return {
    ...state,
    collisionGeometryWireframesEnabled: enabled,
  };
}

/** Enables or disables aim-collision outlines. */
export function setRuntimeMenuAimCollisionOutlinesEnabled(
  state: RuntimeMenuState,
  enabled: boolean,
): RuntimeMenuState {
  return {
    ...state,
    aimCollisionOutlinesEnabled: enabled,
  };
}

/** Enables or disables VR anti-nausea mode. */
export function setRuntimeMenuAntiNauseaModeEnabled(
  state: RuntimeMenuState,
  enabled: boolean,
): RuntimeMenuState {
  return {
    ...state,
    antiNauseaModeEnabled: enabled,
  };
}

/** Selects the active tool without changing the page. */
export function setRuntimeMenuSelectedTool(state: RuntimeMenuState, selectedTool: RuntimeToolId): RuntimeMenuState {
  return {
    ...state,
    selectedTool,
  };
}

/** Sets or clears (undefined) the reload-confirmation deadline. */
export function setRuntimeMenuReloadConfirmUntilMs(
  state: RuntimeMenuState,
  reloadConfirmUntilMs: number | undefined,
): RuntimeMenuState {
  return {
    ...state,
    reloadConfirmUntilMs,
  };
}

/** Sets the flag type the place-flag tool will place. */
export function setRuntimeMenuPlaceFlagType(state: RuntimeMenuState, flagType: PlacedFlagType): RuntimeMenuState {
  return {
    ...state,
    placeFlagOptions: {
      ...state.placeFlagOptions,
      flagType,
    },
  };
}

/** Chooses a flag type and activates the place-flag tool in one step. */
export function selectRuntimeMenuPlaceFlagToolType(state: RuntimeMenuState, flagType: PlacedFlagType): RuntimeMenuState {
  return setRuntimeMenuSelectedTool(setRuntimeMenuPlaceFlagType(state, flagType), "place-flag");
}

/** Sets or clears the id of the flag being edited. */
export function setRuntimeMenuEditingFlagId(state: RuntimeMenuState, editingFlagId: string | undefined): RuntimeMenuState {
  return {
    ...state,
    editingFlagId,
  };
}

/**
 * Converts the menu's debug fields into launch-style DebugSettings: when debug is off it yields level "off", portal panel "none" and no options; otherwise it adds "runtime-diagnostics", the enabled option groups, and "portal-visible-path-debug" when the overlay shows portal-quantities.
 */
export function createDebugSettingsFromRuntimeMenuState(state: RuntimeMenuState): DebugSettings {
  const debugOptions: DebugOptionId[] = [];

  if (state.debugEnabled) {
    debugOptions.push("runtime-diagnostics");

    if (state.portalInspectionEnabled) {
      debugOptions.push(...portalInspectionDebugOptions);
    }

    if (state.collisionGeometryWireframesEnabled) {
      debugOptions.push(...collisionGeometryDebugOptions);
    }

    if (state.aimCollisionOutlinesEnabled) {
      debugOptions.push(...aimCollisionDebugOptions);
    }

    if (state.debugOverlayEnabled && state.debugOverlayItems.includes("portal-quantities")) {
      debugOptions.push("portal-visible-path-debug");
    }
  }

  return {
    debugLevel: state.debugEnabled ? state.consoleLogLevel : "off",
    portalPanelMode: state.debugEnabled ? state.portalPanelMode : "none",
    debugOptions,
  };
}

/**
 * Parses a comma-separated list of overlay item ids (null means all defaults), dropping unknown entries and returning canonical order.
 */
export function parseRuntimeDebugOverlayItems(rawValue: string | null): readonly RuntimeDebugOverlayItemId[] {
  if (rawValue === null) {
    return [...defaultRuntimeDebugOverlayItems];
  }

  const knownItems = new Set<RuntimeDebugOverlayItemId>(defaultRuntimeDebugOverlayItems);
  const requestedItems = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is RuntimeDebugOverlayItemId => knownItems.has(value as RuntimeDebugOverlayItemId));

  return orderRuntimeDebugOverlayItems(requestedItems);
}

/** Serializes overlay items to a canonical comma-separated string. */
export function serializeRuntimeDebugOverlayItems(
  items: readonly RuntimeDebugOverlayItemId[],
): string {
  return orderRuntimeDebugOverlayItems(items).join(",");
}

function hasAnyDebugOption(
  debugOptions: readonly DebugOptionId[] | undefined,
  optionIds: readonly DebugOptionId[],
): boolean {
  return optionIds.some((optionId) => debugOptions?.includes(optionId));
}

function orderRuntimeDebugOverlayItems(
  items: readonly RuntimeDebugOverlayItemId[],
): readonly RuntimeDebugOverlayItemId[] {
  const requestedItems = new Set(items);
  return defaultRuntimeDebugOverlayItems.filter((itemId) => requestedItems.has(itemId));
}

function clampTutorialPageIndex(pageIndex: number, pages: readonly TutorialPageSpec[]): number {
  if (pages.length === 0) {
    return 0;
  }

  return Math.max(0, Math.min(pages.length - 1, Math.trunc(pageIndex)));
}
