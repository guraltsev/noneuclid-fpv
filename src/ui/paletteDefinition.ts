/**
 * Renderer-neutral definition of the tool/settings palette: createPaletteDefinition turns a RuntimeMenuState plus the app config and input mode into a PaletteDefinition, a plain-data description (header actions plus one page-specific content record) that the desktop DOM menu and the VR panel both render.
 * The content types form a discriminated union keyed by kind (main, settings, debug-settings, place-flag-options, edit-sign, geodesic-cannon-actions, geometry-computer-actions, tutorial, goal, question-help).
 * The module decides what is shown and enabled (config-gated sections, disabled buttons, tutorial text per input device, integer-meter limits for the geometry computer) but performs no rendering and holds no state; any page whose payload is missing falls back to the main page.
 */
import type { ObjectActionEntry } from "../engine/moduleTypes";
import type { TutorialPageSpec } from "../cell-complex/specs";
import { appConfigCatalog, type AppConfig, type ConfigurableToolId } from "../glue/appConfig";
import {
  describeTorusRelation,
  isSameFlatTorus,
  reducedTorusModulus,
  torusShape,
  type TorusLatticeParameters,
} from "../cell-complex/deformations/torusModuli";
import { formatBodyForInputMode } from "./inputModeText";
import { getInputHintGlyph, type InputHintGlyph, type InputIntent } from "./inputIntents";
import { publicAssetUrl } from "../glue/assetUrls";
import { worldCatalog } from "../authoring/worldCatalog";
import { helpHubHomeGuidance } from "../world-objects/helpHubCopy";
import { lostSentence, settingsSections } from "./howToCards";
import {
  actionWithKey,
  beamName,
  disabledReasons,
  discoveryText,
  helpText,
  mainMenuText,
  menuControlText,
  objectActions,
  shapeMachineText,
  surfaceNames,
  verbNames,
} from "../world-objects/vocabulary";
import type { XrLayout } from "../glue/xrLayout";
import { portalPanelModeDefinitions } from "../glue/portalPanelMode";
import type {
  RuntimeMenuConsoleLogLevelId,
  RuntimeMenuPageId,
  RuntimeMenuState,
  RuntimeMouseSensitivity,
  RuntimeTextSize,
  RuntimeTurnSpeed,
} from "../runtime/runtimeMenuState";
import type { RuntimeDebugOverlayItemId, RuntimeToolId } from "../glue/toolIds";
import type { InputMode } from "./inputIntents";
import { placedFlagMaxMessageLength } from "../world-objects/placedFlags";
import { placedFlagTypes, type PlacedFlagType } from "../world-objects/toolObjects";

/** Option of a select-style control: stable id and display label. */
export interface PaletteSelectOption {
  readonly id: string;
  readonly label: string;
}

/** Header button of the palette (left or right slot). */
export interface PaletteHeaderAction {
  /** Which button this is; "none" is an inert, empty placeholder that keeps the layout stable. */
  readonly id: "none" | "settings" | "close" | "back";
  readonly label: string;
  /** Accessible name for the button. */
  readonly ariaLabel: string;
  readonly disabled: boolean;
  /** Why the button is disabled, drawn under it; every disabled button has one except the inert "none" placeholder. */
  readonly disabledReason?: string;
}

/** A text button of an object menu: its label (with its key or button after a dot), and why it is disabled when it is. */
export interface PaletteTextAction {
  readonly label: string;
  readonly disabled: boolean;
  /** Present whenever `disabled` is true; drawn under the button in small text. */
  readonly disabledReason?: string;
  /** The longer explanation shown when the button is pointed at. */
  readonly tooltip?: string;
}

/** One entry of the main menu: Help, Settings, Go home or Start over. */
export interface MainMenuActionEntry {
  readonly id: "help" | "settings" | "go-home" | "start-over";
  readonly label: string;
}

/**
 * Content of the main page, the main menu (design 017 section 7.5): Help, Settings, Go home and Start over as text buttons.
 * The tool tiles belong to the belt now, on desktop and in VR (job 77); `toolOptions` is always empty.
 */
export interface MainPaletteContent {
  readonly kind: "main";
  readonly selectedTool: RuntimeToolId;
  readonly placeFlagType: PlacedFlagType;
  readonly menuActions: readonly MainMenuActionEntry[];
  /** Always empty: tools are taken from the belt (design 017 section 7.4), never from a menu. */
  readonly toolOptions: readonly {
    readonly id: ConfigurableToolId | "none";
    readonly label: string;
  }[];
}

/** Content of the settings page: world and config pickers, debug entry, comfort and reload. */
export interface SettingsPaletteContent {
  readonly kind: "settings";
  readonly selectedWorldId: string;
  readonly worldOptions: readonly PaletteSelectOption[];
  /** Whether the world picker section is shown, as dictated by the app config. */
  readonly worldSelectionSectionEnabled: boolean;
  readonly selectedAppConfigName: string;
  readonly appConfigOptions: readonly PaletteSelectOption[];
  /** Whether the app-config picker section is shown, as dictated by the app config. */
  readonly configSelectionSectionEnabled: boolean;
  /** Whether the debug toggle/entry is shown, as dictated by the app config. */
  readonly debugSectionEnabled: boolean;
  readonly debugEnabled: boolean;
  readonly antiNauseaModeEnabled: boolean;
  /** Whether the hint strip is shown (the "Show hints" switch). */
  readonly showHintsEnabled: boolean;
  /** Whether the glued edges are drawn on the floor (the "Show edges" switch). */
  readonly showEdgesEnabled: boolean;
  /** The "Use one controller" switch (VR). */
  readonly useOneControllerEnabled: boolean;
  /** The "Left-handed" switch (VR). */
  readonly leftHandedEnabled: boolean;
  /** Mouse sensitivity step (Controls). */
  readonly mouseSensitivity: RuntimeMouseSensitivity;
  /** The "Invert Y" switch (Controls). */
  readonly invertYEnabled: boolean;
  /** Turn speed step (Controls). */
  readonly turnSpeed: RuntimeTurnSpeed;
  /** Text size step (Display). */
  readonly textSize: RuntimeTextSize;
  /** The controls reference (Controls): one row per verb, with the name of the control of the current device. */
  readonly controlsReference: readonly { readonly verb: string; readonly glyph: InputHintGlyph }[];
  /** True while a reload awaits its confirming second press. */
  readonly reloadConfirmationActive: boolean;
}

/**
 * Content of the debug-settings page: console log level, overlay items and portal/collision debug switches.
 */
export interface DebugSettingsPaletteContent {
  readonly kind: "debug-settings";
  readonly consoleLogLevel: RuntimeMenuConsoleLogLevelId;
  readonly consoleLogLevelOptions: readonly PaletteSelectOption[];
  readonly debugOverlayEnabled: boolean;
  readonly debugOverlayItems: readonly {
    readonly id: RuntimeDebugOverlayItemId;
    readonly label: string;
    readonly checked: boolean;
  }[];
  /** Selected portal panel mode id (matches an entry of portalPanelModeOptions). */
  readonly portalPanelMode: string;
  readonly portalPanelModeOptions: readonly PaletteSelectOption[];
  readonly portalInspectionEnabled: boolean;
  readonly collisionGeometryWireframesEnabled: boolean;
  readonly aimCollisionOutlinesEnabled: boolean;
}

/** Content of the place-flag options page: choice of sign type. */
export interface PlaceFlagOptionsPaletteContent {
  readonly kind: "place-flag-options";
  readonly selectedFlagType: PlacedFlagType;
  readonly flagTypeOptions: readonly PaletteSelectOption[];
}

/** Content of the edit-sign page for one placed flag. */
export interface EditSignPaletteContent {
  readonly kind: "edit-sign";
  readonly flagId: string;
  readonly message: string;
  /** Maximum number of characters allowed in the sign message. */
  readonly maxLength: number;
  /** The Delete button of the sign's menu. */
  readonly deleteAction: PaletteTextAction;
}

/** Content of the menu of one measurement (a length or an angle): its words and a Delete button, the one way to remove it (design 017 section 8.5). */
export interface MeasurementActionsPaletteContent {
  readonly kind: "measurement-actions";
  readonly measurementId: string;
  readonly measurementKind: "length" | "angle";
  readonly title: string;
  readonly body: string;
  readonly deleteAction: PaletteTextAction;
}

/** Content of the geodesic emitter menu: the add and carry actions, the actions tools contribute, and one row per geodesic. */
export interface GeodesicCannonActionsPaletteContent {
  readonly kind: "geodesic-cannon-actions";
  readonly cannonId: string;
  readonly addAction: PaletteTextAction;
  /** "Pick up · G" on desktop, the layout's button in VR. */
  readonly carryAction: PaletteTextAction;
  /** Deletes the laser; its beams go with it. */
  readonly deleteAction: PaletteTextAction;
  /** The actions the tools contribute to the page (design 013 section 8.3), in order, each with its availability. */
  readonly objectActions: readonly ObjectActionEntry[];
  /**
   * One entry per geodesic of the emitter; connected ones carry a connection label explaining they run between emitters.
   */
  readonly geodesics: readonly {
    readonly id: string;
    readonly label: string;
    readonly connected: boolean;
    readonly connectionSymbolLabel?: string;
    readonly deleteDisabled: boolean;
    readonly deleteDisabledReason?: string;
    /** Linked beams cannot be aimed; the Aim button is drawn disabled, with its reason. */
    readonly aimDisabled: boolean;
    readonly aimDisabledReason?: string;
  }[];
}

/**
 * Content of the world-deformation (geometry computer) page, in whole meters: torus width, current and target (a, b), limits and step buttons.
 */
export interface GeometryComputerActionsPaletteContent {
  readonly kind: "geometry-computer-actions";
  readonly computerId: string;
  readonly available: boolean;
  readonly statusLabel: string;
  /** Shape and relation to the start of the current torus; empty when unavailable. */
  readonly currentModuliLabel: string;
  /** Shape and relation to the start of the target torus; empty when unavailable. */
  readonly targetModuliLabel: string;
  /** The lines of the unfolded "More" row: the width and the modulus of the two shapes (older students). */
  readonly moreLines: readonly string[];
  /** Whether the "More" row is unfolded. */
  readonly moreOpen: boolean;
  readonly widthMeters: number;
  /** Currently committed skew a and depth b, clamped to limits and rounded to integer meters. */
  readonly current: {
    readonly aMeters: number;
    readonly bMeters: number;
  };
  /** Requested skew a and depth b, clamped to limits and rounded; defaults to current. */
  readonly target: {
    readonly aMeters: number;
    readonly bMeters: number;
  };
  /**
   * Allowed ranges: a in [0, 2w], b in [w/2, 2w] where w is widthMeters (matching the torus-skew family's normalization).
   */
  readonly limits: {
    readonly minAMeters: number;
    readonly maxAMeters: number;
    readonly minBMeters: number;
    readonly maxBMeters: number;
  };
  /** The two parameters of the target in the words of the panel: Shift (a) and Height (b), each with its value in meters to one decimal. */
  readonly parameters: readonly {
    readonly axis: "a" | "b";
    readonly name: string;
    readonly valueMeters: number;
    readonly valueLabel: string;
    readonly disabled: boolean;
    readonly disabledReason?: string;
  }[];
  /**
   * Buttons that move the target along one axis by deltaMeters (-1 m and +1 m); disabled when the page is unavailable or the target is at the end of its range.
   */
  readonly stepActions: readonly {
    readonly axis: "a" | "b";
    readonly deltaMeters: number;
    readonly label: string;
    readonly disabled: boolean;
    readonly disabledReason?: string;
  }[];
  /** The keypad, while a value is being typed; absent otherwise. `text` is what was typed so far. */
  readonly entry?: {
    readonly axis: "a" | "b";
    readonly name: string;
    readonly text: string;
    readonly prompt: string;
    readonly maxLength: number;
  };
  /** Generic targets, relative to the world's starting torus: Square, Shift by half, Shift by a whole width, Tall. */
  readonly presets: readonly {
    readonly id: string;
    readonly label: string;
    readonly aMeters: number;
    readonly bMeters: number;
    readonly disabled: boolean;
    readonly disabledReason?: string;
  }[];
  /** True while the target is the same flat torus as the starting one: the panel shows `sameAsStartLabel` as a badge. */
  readonly sameAsStart: boolean;
  readonly sameAsStartLabel: string;
  /**
   * The button that starts deforming toward the target; disabled when unavailable or when target equals current.
   */
  readonly goAction: PaletteTextAction;
}

/** A control row of a tutorial or goal page: the device's input for it and what it does. */
export interface PagedHelpControl {
  readonly hint: InputHintGlyph;
  readonly label: string;
}

/** Picture and control rows of a tutorial or goal page; both are optional on a page, so these may be absent and empty. */
export interface PagedHelpExtras {
  /** URL of the page's picture. */
  readonly imageSrc?: string;
  readonly controls: readonly PagedHelpControl[];
}

/**
 * Content of the tutorial: in the "index" view a button per page (title and `topics`), in the "page" view one page with previous/next paging controls.
 */
export interface TutorialPaletteContent extends PagedHelpExtras {
  readonly kind: "tutorial";
  readonly objectId: string;
  readonly view: "index" | "page";
  /** One entry per page, in order, for the index view: "Start here" on the first card, a tick on a card that was opened, and the reason on a card of a tool the world cannot support. */
  readonly topics: readonly {
    readonly pageIndex: number;
    readonly title: string;
    readonly startHere: boolean;
    readonly read: boolean;
    readonly disabledReason?: string;
  }[];
  /** The page view's card: the tool it is about, the reason that tool is unavailable, and its "Try it" button (only on a card of a tool). */
  readonly toolId?: string;
  readonly disabledReason?: string;
  readonly tryItAction?: PaletteTextAction;
  readonly startHere?: boolean;
  readonly title: string;
  readonly body: string;
  readonly pageLabel: string;
  readonly previousAction: PaletteTextAction;
  readonly nextAction: PaletteTextAction;
}

/** Content of one goal page, with previous/next paging controls. */
export interface GoalPaletteContent extends PagedHelpExtras {
  readonly kind: "goal";
  readonly objectId: string;
  readonly title: string;
  readonly body: string;
  readonly pageLabel: string;
  readonly previousAction: PaletteTextAction;
  readonly nextAction: PaletteTextAction;
}

/** One line of the Discoveries page: a discovery found (its name and question) or a teaser, and the button it offers if any. */
export interface DiscoveryPaletteEntry {
  readonly id: string;
  readonly found: boolean;
  readonly title: string;
  /** The question of a found discovery; empty for a teaser. */
  readonly text: string;
  /** The Show edges button under "Across an edge", with the invitation that goes with it. */
  readonly showEdges?: { readonly invitation: string; readonly action: PaletteTextAction; readonly shown: boolean };
}

/** Content of the Discoveries page (design 017 sections 9.4 and 9.5). */
export interface DiscoveriesPaletteContent {
  readonly kind: "discoveries";
  readonly title: string;
  readonly body: string;
  /** For example "2 of 6 found"; empty when the world has no discoveries. */
  readonly countLabel: string;
  readonly entries: readonly DiscoveryPaletteEntry[];
}

/** Content of the help hub page that offers the tutorial and goal subpages. */
export interface QuestionHelpPaletteContent {
  readonly kind: "question-help";
  readonly objectId: string;
  readonly body: string;
  /** Buttons for the subpages; each is disabled if that subpage has no pages. */
  readonly options: readonly {
    readonly id: "tutorial" | "goal" | "discoveries";
    readonly label: string;
    readonly disabled: boolean;
    readonly disabledReason?: string;
  }[];
}

/** Body text of the help hub page (the shared home guidance). */
export const questionHelpHubBody = helpHubHomeGuidance;

/** Complete renderer-neutral description of the palette for the current menu state. */
export interface PaletteDefinition {
  /**
   * Page actually presented; may be "main" even if state.page asked for a page whose payload or config gate is missing.
   */
  readonly pageId: RuntimeMenuPageId;
  /** Left header button (settings on the main page, otherwise inert). */
  readonly leftAction: PaletteHeaderAction;
  /** Right header button (close or back). */
  readonly rightAction: PaletteHeaderAction;
  readonly reloadConfirmationActive: boolean;
  /** Page-specific content; its kind equals pageId. */
  readonly content:
    | MainPaletteContent
    | SettingsPaletteContent
    | DebugSettingsPaletteContent
    | PlaceFlagOptionsPaletteContent
    | EditSignPaletteContent
    | GeodesicCannonActionsPaletteContent
    | GeometryComputerActionsPaletteContent
    | MeasurementActionsPaletteContent
    | TutorialPaletteContent
    | GoalPaletteContent
    | DiscoveriesPaletteContent
    | QuestionHelpPaletteContent;
}

/**
 * Builds the PaletteDefinition for the menu state: falls back to the main page when the requested page lacks its payload or is gated off (debug-settings needs appConfig.menu.debugSectionEnabled); reload confirmation is evaluated against Date.now(); tutorial text depends on inputMode.
 */
export function createPaletteDefinition(
  state: RuntimeMenuState,
  appConfig: AppConfig,
  inputMode: InputMode,
  nowMs: number,
  xrLayout?: XrLayout,
): PaletteDefinition {
  const reloadConfirmationActive = (state.reloadConfirmUntilMs ?? 0) > nowMs;

  // A "debug-settings" request while the debug section is disabled deliberately falls through to the
  // main page at the end of this function (the same fallback used for pages missing their payload).
  if (state.page === "debug-settings" && appConfig.menu.debugSectionEnabled) {
    return {
      pageId: "debug-settings",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("back"),
      reloadConfirmationActive,
      content: {
        kind: "debug-settings",
        consoleLogLevel: state.consoleLogLevel,
        consoleLogLevelOptions: [
          { id: "basic", label: "Basic" },
          { id: "verbose", label: "Verbose" },
        ],
        debugOverlayEnabled: state.debugOverlayEnabled,
        debugOverlayItems: [
          { id: "fps", label: "FPS", checked: state.debugOverlayItems.includes("fps") },
          { id: "location", label: "Location", checked: state.debugOverlayItems.includes("location") },
          {
            id: "portal-quantities",
            label: "Portal quantities",
            checked: state.debugOverlayItems.includes("portal-quantities"),
          },
        ],
        portalPanelMode: state.portalPanelMode,
        portalPanelModeOptions: portalPanelModeDefinitions.map((mode) => ({
          id: mode.id,
          label: mode.label,
        })),
        portalInspectionEnabled: state.portalInspectionEnabled,
        collisionGeometryWireframesEnabled: state.collisionGeometryWireframesEnabled,
        aimCollisionOutlinesEnabled: state.aimCollisionOutlinesEnabled,
      },
    };
  }

  if (state.page === "settings") {
    return {
      pageId: "settings",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("back"),
      reloadConfirmationActive,
      content: {
        kind: "settings",
        selectedWorldId: state.selectedWorldId,
        worldOptions: worldCatalog.map((entry) => ({
          id: entry.id,
          label: entry.label,
        })),
        worldSelectionSectionEnabled: appConfig.menu.worldSelectionSectionEnabled,
        selectedAppConfigName: state.selectedAppConfigName,
        appConfigOptions: appConfigCatalog.map((entry) => ({
          id: entry.id,
          label: entry.label,
        })),
        configSelectionSectionEnabled: appConfig.menu.configSelectionSectionEnabled,
        debugSectionEnabled: appConfig.menu.debugSectionEnabled,
        debugEnabled: state.debugEnabled,
        antiNauseaModeEnabled: state.antiNauseaModeEnabled,
        showHintsEnabled: state.showHintsEnabled !== false,
        showEdgesEnabled: state.showEdgesEnabled === true,
        useOneControllerEnabled: state.useOneControllerEnabled === true,
        leftHandedEnabled: state.leftHandedEnabled === true,
        mouseSensitivity: state.mouseSensitivity ?? "medium",
        invertYEnabled: state.invertYEnabled === true,
        turnSpeed: state.turnSpeed ?? "medium",
        textSize: state.textSize ?? "medium",
        controlsReference: controlsReferenceIntents.map(({ verb, intent }) => ({ verb, glyph: getInputHintGlyph(inputMode, intent, xrLayout) })),
        reloadConfirmationActive,
      },
    };
  }

  if (state.page === "place-flag-options") {
    return {
      pageId: "place-flag-options",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("back"),
      reloadConfirmationActive,
      content: {
        kind: "place-flag-options",
        selectedFlagType: state.placeFlagOptions.flagType,
        flagTypeOptions: placedFlagTypes.map((id) => ({
          id,
          label: id,
        })),
      },
    };
  }

  if (state.page === "edit-sign" && state.editSignOptions) {
    return {
      pageId: "edit-sign",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("close"),
      reloadConfirmationActive,
      content: {
        kind: "edit-sign",
        flagId: state.editSignOptions.flagId,
        message: state.editSignOptions.message,
        maxLength: placedFlagMaxMessageLength,
        deleteAction: { label: menuControlText.delete, disabled: false, tooltip: menuControlText.deleteSignTooltip },
      },
    };
  }

  if (state.page === "measurement-actions" && state.measurementOptions) {
    return {
      pageId: "measurement-actions",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("close"),
      reloadConfirmationActive,
      content: {
        kind: "measurement-actions",
        measurementId: state.measurementOptions.measurementId,
        measurementKind: state.measurementOptions.measurementKind,
        title: menuControlText.measurementMenu,
        body: menuControlText.measurementMenuBody,
        deleteAction: { label: menuControlText.delete, disabled: false, tooltip: menuControlText.deleteMeasurementTooltip },
      },
    };
  }

  if (state.page === "geodesic-cannon-actions" && state.geodesicCannonOptions) {
    return {
      pageId: "geodesic-cannon-actions",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("close"),
      reloadConfirmationActive,
      content: {
        kind: "geodesic-cannon-actions",
        cannonId: state.geodesicCannonOptions.cannonId,
        addAction: { label: menuControlText.addBeam, disabled: false },
        carryAction: {
          label: actionWithKey(objectActions.pickUp, getInputHintGlyph(inputMode, "carry", xrLayout).label),
          disabled: false,
        },
        deleteAction: { label: menuControlText.deleteLaser, disabled: false, tooltip: menuControlText.deleteLaserTooltip },
        objectActions: state.geodesicCannonOptions.objectActions ?? [],
        geodesics: createGeodesicCannonEntries(
          state.geodesicCannonOptions.geodesicIds,
          state.geodesicCannonOptions.geodesicLabelsById,
          state.geodesicCannonOptions.connectedGeodesicIds,
        ),
      },
    };
  }

  if (state.page === "geometry-computer-actions" && state.geometryComputerOptions) {
    return {
      pageId: "geometry-computer-actions",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("close"),
      reloadConfirmationActive,
      content: createGeometryComputerActionsContent(state.geometryComputerOptions),
    };
  }

  if (state.page === "tutorial" && state.tutorialOptions) {
    return {
      pageId: "tutorial",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("back"),
      reloadConfirmationActive,
      content: createPagedHelpContent("tutorial", state.tutorialOptions, inputMode, xrLayout, {
        readTitles: state.helpCardsRead ?? [],
        toolDisabledReasons: state.questionHelpOptions?.toolDisabledReasons ?? {},
        settingsSentence: helpText.settingsHas(settingsSections(appConfig)),
      }),
    };
  }

  if (state.page === "goal" && state.goalOptions) {
    return {
      pageId: "goal",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("back"),
      reloadConfirmationActive,
      content: createPagedHelpContent("goal", state.goalOptions, inputMode, xrLayout),
    };
  }

  if (state.page === "discoveries" && state.discoveriesOptions) {
    const entries = state.discoveriesOptions.entries;
    const edgesShown = state.showEdgesEnabled === true;
    return {
      pageId: "discoveries",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("back"),
      reloadConfirmationActive,
      content: {
        kind: "discoveries",
        title: surfaceNames.discoveries,
        body: entries.length === 0 ? discoveryText.none : discoveryText.pageIntro,
        countLabel: entries.length === 0 ? "" : discoveryText.foundCount(entries.filter((entry) => entry.found).length, entries.length),
        entries: entries.map((entry): DiscoveryPaletteEntry => ({
          id: entry.id,
          found: entry.found,
          title: entry.title,
          text: entry.text,
          ...(entry.action === "show-edges"
            ? {
                showEdges: {
                  invitation: discoveryText.showEdgesInvite,
                  shown: edgesShown,
                  action: { label: edgesShown ? discoveryText.hideEdges : discoveryText.showEdges, disabled: false },
                },
              }
            : {}),
        })),
      },
    };
  }

  if (state.page === "question-help" && state.questionHelpOptions) {
    return {
      pageId: "question-help",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("close"),
      reloadConfirmationActive,
      content: {
        kind: "question-help",
        objectId: state.questionHelpOptions.objectId,
        body: lostSentence(inputMode, xrLayout),
        options: [
          {
            id: "goal",
            label: surfaceNames.thingsToTry,
            ...disabledWhen(state.questionHelpOptions.goalPages.length === 0, disabledReasons.nothingForThisWorld),
          },
          {
            id: "tutorial",
            label: surfaceNames.howTo,
            ...disabledWhen(state.questionHelpOptions.tutorialPages.length === 0, disabledReasons.nothingForThisWorld),
          },
          { id: "discoveries", label: surfaceNames.discoveries, disabled: false },
        ],
      },
    };
  }

  return {
    pageId: "main",
    leftAction: createHeaderAction("settings"),
    rightAction: createHeaderAction("close"),
    reloadConfirmationActive,
    content: {
      kind: "main",
      selectedTool: state.selectedTool,
      placeFlagType: state.placeFlagOptions.flagType,
      menuActions: mainMenuActions,
      toolOptions: [],
    },
  };
}

/** Caches `createPaletteDefinition` so an unchanged menu state yields the same definition object and version. */
export interface PaletteDefinitionCache {
  /**
   * Returns the cached definition, rebuilding it (version + 1) only when `state` (by reference), `inputMode` or the
   * reload-confirmation flag at `nowMs` differ from the last call.
   */
  get(
    state: RuntimeMenuState,
    inputMode: InputMode,
    nowMs?: number,
    xrLayout?: XrLayout,
  ): { readonly definition: PaletteDefinition; readonly version: number };
}

/**
 * Creates a definition cache for one `appConfig` (fixed for the app's lifetime). The menu state is replaced
 * immutably, so reference equality of `state` is a complete change test; the clock enters only through the
 * reload-confirmation flag, which is part of the key.
 */
export function createPaletteDefinitionCache(appConfig: AppConfig): PaletteDefinitionCache {
  let lastState: RuntimeMenuState | undefined;
  let lastInputMode: InputMode | undefined;
  let lastXrLayout: XrLayout | undefined;
  let lastReloadConfirmationActive = false;
  let definition: PaletteDefinition | undefined;
  let version = 0;
  let result: { readonly definition: PaletteDefinition; readonly version: number } | undefined;

  return {
    get(state, inputMode, nowMs = Date.now(), xrLayout) {
      const reloadConfirmationActive = (state.reloadConfirmUntilMs ?? 0) > nowMs;

      if (
        result === undefined ||
        state !== lastState ||
        inputMode !== lastInputMode ||
        xrLayout !== lastXrLayout ||
        reloadConfirmationActive !== lastReloadConfirmationActive
      ) {
        lastState = state;
        lastInputMode = inputMode;
        lastXrLayout = xrLayout;
        lastReloadConfirmationActive = reloadConfirmationActive;
        definition = createPaletteDefinition(state, appConfig, inputMode, nowMs, xrLayout);
        version += 1;
        result = { definition, version };
      }

      return result;
    },
  };
}

/** What the How to cards need beyond the pages: the titles already opened, and the reasons of the tools the world cannot support. */
interface HowToContext {
  readonly readTitles: readonly string[];
  readonly toolDisabledReasons: Readonly<Record<string, string>>;
  /** What Settings has with this config, generated; added to the card marked "Start here". */
  readonly settingsSentence: string;
}

function createPagedHelpContent(
  kind: "tutorial",
  options: NonNullable<RuntimeMenuState["tutorialOptions"]>,
  inputMode: InputMode,
  xrLayout: XrLayout | undefined,
  howTo: HowToContext,
): TutorialPaletteContent;
function createPagedHelpContent(
  kind: "goal",
  options: NonNullable<RuntimeMenuState["goalOptions"]>,
  inputMode: InputMode,
  xrLayout: XrLayout | undefined,
): GoalPaletteContent;
function createPagedHelpContent(
  kind: "tutorial" | "goal",
  options: NonNullable<RuntimeMenuState["tutorialOptions"]> | NonNullable<RuntimeMenuState["goalOptions"]>,
  inputMode: InputMode,
  xrLayout: XrLayout | undefined,
  howTo?: HowToContext,
): TutorialPaletteContent | GoalPaletteContent {
  const pageCount = options.pages.length;
  const pageIndex = pageCount === 0
    ? 0
    : Math.max(0, Math.min(pageCount - 1, options.pageIndex));
  const page = options.pages[pageIndex] ?? { title: kind === "goal" ? surfaceNames.thingsToTry : surfaceNames.howTo, body: "" };
  const showIndex = kind === "tutorial" && "view" in options && options.view === "index";
  const common = {
    objectId: options.objectId,
    title: showIndex ? surfaceNames.howTo : page.title,
    body: showIndex
      ? helpText.howToIntro
      : [resolveTutorialBodyForInputMode(page, inputMode, xrLayout), page.startHere === true ? howTo?.settingsSentence : undefined].filter(Boolean).join(" "),
    imageSrc: !showIndex && page.imagePath ? publicAssetUrl(page.imagePath) : undefined,
    controls: showIndex
      ? []
      : (page.controls ?? []).map((control) => ({ hint: getInputHintGlyph(inputMode, control.intent, xrLayout), label: control.label })),
  };
  const paging = {
    pageLabel: pageCount === 0 ? "0 / 0" : `${pageIndex + 1} / ${pageCount}`,
    previousAction: { label: menuControlText.previousPage, ...disabledWhen(pageIndex <= 0, disabledReasons.firstPage) },
    nextAction: { label: menuControlText.nextPage, ...disabledWhen(pageIndex >= pageCount - 1, disabledReasons.lastPage) },
  };

  if (kind === "goal") {
    return { kind, ...common, ...paging };
  }

  const reasonOf = (entry: TutorialPageSpec): string | undefined => entry.toolId === undefined ? undefined : howTo?.toolDisabledReasons[entry.toolId];
  const pageReason = reasonOf(page);
  return {
    kind,
    ...common,
    ...paging,
    view: showIndex ? "index" : "page",
    topics: options.pages.map((entry, index) => {
      const reason = reasonOf(entry);
      return {
        pageIndex: index,
        title: entry.title,
        startHere: entry.startHere === true,
        read: howTo?.readTitles.includes(entry.title) === true,
        ...(reason !== undefined ? { disabledReason: reason } : {}),
      };
    }),
    ...(!showIndex && page.toolId !== undefined
      ? {
          toolId: page.toolId,
          tryItAction: { label: helpText.tryIt, ...disabledWhen(pageReason !== undefined, pageReason ?? disabledReasons.notAvailable) },
        }
      : {}),
    ...(!showIndex && pageReason !== undefined ? { disabledReason: pageReason } : {}),
    ...(!showIndex && page.startHere === true ? { startHere: true } : {}),
  };
}

/** The controls Settings lists: the verbs of design 017 section 7 and the intent that performs each. */
const controlsReferenceIntents: readonly { readonly verb: string; readonly intent: InputIntent }[] = [
  { verb: verbNames.look, intent: "look" },
  { verb: verbNames.walk, intent: "move" },
  { verb: verbNames.use, intent: "primary" },
  { verb: verbNames.menu, intent: "context-menu" },
  { verb: verbNames.switchTool, intent: "switch-tool" },
  { verb: verbNames.whatsThis, intent: "help" },
  { verb: verbNames.mainMenu, intent: "main-menu" },
];

/** The page's text for the input device; the sentence for a student who is lost is written for this device's main-menu binding. */
function resolveTutorialBodyForInputMode(
  page: NonNullable<RuntimeMenuState["tutorialOptions"]>["pages"][number],
  inputMode: InputMode,
  xrLayout: XrLayout | undefined,
): string {
  const body = inputMode === "desktop"
    ? page.desktopBody ?? formatBodyForInputMode(page.body, "desktop")
    : page.xrBody ?? formatBodyForInputMode(page.body, "xr");
  return body.replace(helpHubHomeGuidance, lostSentence(inputMode, xrLayout));
}

/** The main menu's entries, in order. */
const mainMenuActions: readonly MainMenuActionEntry[] = [
  { id: "help", label: surfaceNames.help },
  { id: "settings", label: mainMenuText.settings },
  { id: "go-home", label: objectActions.goHome },
  { id: "start-over", label: objectActions.startOver },
];

function createGeometryComputerActionsContent(
  options: NonNullable<RuntimeMenuState["geometryComputerOptions"]>,
): GeometryComputerActionsPaletteContent {
  const available = options.available;
  const widthMeters = roundMeters(options.widthMeters ?? 15);
  const currentA = clampIntegerMeters(options.currentSkewXMeters ?? 0, 0, 2 * widthMeters);
  const currentB = clampIntegerMeters(options.currentDepthMeters ?? widthMeters, 0.5 * widthMeters, 2 * widthMeters);
  const targetA = clampIntegerMeters(options.targetSkewXMeters ?? currentA, 0, 2 * widthMeters);
  const targetB = clampIntegerMeters(options.targetDepthMeters ?? currentB, 0.5 * widthMeters, 2 * widthMeters);
  const shift = shapeMachineText.shift;
  const height = shapeMachineText.height;
  const statusLabel = available
    ? `Now: ${shift} ${shapeMachineText.metres(currentA)}, ${height} ${shapeMachineText.metres(currentB)}. Target: ${shift} ${shapeMachineText.metres(targetA)}, ${height} ${shapeMachineText.metres(targetB)}.`
    : `${disabledReasons.shapeMachineOnlyInTorus}.`;
  const minB = Math.ceil(0.5 * widthMeters);
  const maxMeters = Math.floor(2 * widthMeters);
  const start = {
    widthMeters,
    skewXMeters: options.startSkewXMeters ?? options.currentSkewXMeters ?? currentA,
    depthMeters: options.startDepthMeters ?? options.currentDepthMeters ?? currentB,
  };

  const offTorus = disabledWhen(!available, disabledReasons.shapeMachineOnlyInTorus);
  const limitReason = (blocked: boolean) => disabledWhen(!available || blocked, available ? disabledReasons.atTheLimit : disabledReasons.shapeMachineOnlyInTorus);
  const entryAxis = options.entryAxis;
  const startA = clampIntegerMeters(start.skewXMeters, 0, 2 * widthMeters);
  const startB = clampIntegerMeters(start.depthMeters, 0.5 * widthMeters, 2 * widthMeters);
  // A shift of the start by `delta` metres that stays in range: forward when it fits, otherwise backward.
  const shiftedStart = (delta: number): number => (startA + delta <= maxMeters ? startA + delta : startA - delta);
  const presetTargets: readonly { readonly id: string; readonly label: string; readonly aMeters: number; readonly bMeters: number }[] = [
    { id: "square", label: shapeMachineText.presets.square, aMeters: 0, bMeters: clampIntegerMeters(widthMeters, 0.5 * widthMeters, 2 * widthMeters) },
    { id: "half-shift", label: shapeMachineText.presets.halfShift, aMeters: clampIntegerMeters(shiftedStart(Math.round(widthMeters / 2)), 0, 2 * widthMeters), bMeters: startB },
    { id: "whole-shift", label: shapeMachineText.presets.wholeShift, aMeters: clampIntegerMeters(shiftedStart(widthMeters), 0, 2 * widthMeters), bMeters: startB },
    { id: "tall", label: shapeMachineText.presets.tall, aMeters: startA, bMeters: clampIntegerMeters(2 * startB, 0.5 * widthMeters, 2 * widthMeters) },
  ];
  const parameterName = (axis: "a" | "b"): string => (axis === "a" ? shift : height);
  const currentModuliLabel = available
    ? formatTorusModuliLabel(
        "Current",
        { widthMeters, skewXMeters: options.currentSkewXMeters ?? currentA, depthMeters: options.currentDepthMeters ?? currentB },
        start,
      )
    : "";
  const targetModuliLabel = available
    ? formatTorusModuliLabel("Target", { widthMeters, skewXMeters: targetA, depthMeters: targetB }, start)
    : "";

  return {
    kind: "geometry-computer-actions",
    computerId: options.computerId,
    available,
    statusLabel,
    moreLines: available ? [shapeMachineText.widthLine(shapeMachineText.metres(widthMeters)), currentModuliLabel, targetModuliLabel] : [],
    moreOpen: options.moreOpen === true,
    currentModuliLabel,
    targetModuliLabel,
    widthMeters,
    current: {
      aMeters: currentA,
      bMeters: currentB,
    },
    target: {
      aMeters: targetA,
      bMeters: targetB,
    },
    limits: {
      minAMeters: 0,
      maxAMeters: 2 * widthMeters,
      minBMeters: 0.5 * widthMeters,
      maxBMeters: 2 * widthMeters,
    },
    parameters: [
      { axis: "a", name: shift, valueMeters: targetA, valueLabel: shapeMachineText.metres(targetA), ...offTorus },
      { axis: "b", name: height, valueMeters: targetB, valueLabel: shapeMachineText.metres(targetB), ...offTorus },
    ],
    stepActions: [
      { axis: "a", deltaMeters: -1, label: shapeMachineText.stepDown, ...limitReason(targetA - 1 < 0) },
      { axis: "a", deltaMeters: 1, label: shapeMachineText.stepUp, ...limitReason(targetA + 1 > maxMeters) },
      { axis: "b", deltaMeters: -1, label: shapeMachineText.stepDown, ...limitReason(targetB - 1 < minB) },
      { axis: "b", deltaMeters: 1, label: shapeMachineText.stepUp, ...limitReason(targetB + 1 > maxMeters) },
    ],
    ...(available && entryAxis !== undefined
      ? {
          entry: {
            axis: entryAxis,
            name: parameterName(entryAxis),
            text: options.entryText ?? "",
            prompt: shapeMachineText.entryPrompt(parameterName(entryAxis)),
            maxLength: 2,
          },
        }
      : {}),
    presets: presetTargets.map((preset) => ({ ...preset, ...offTorus })),
    sameAsStart: available && isSameFlatTorus({ widthMeters, skewXMeters: targetA, depthMeters: targetB }, start),
    sameAsStartLabel: shapeMachineText.sameAsStart,
    goAction: {
      label: shapeMachineText.reshape,
      ...disabledWhen(
        !available || (currentA === targetA && currentB === targetB),
        available ? disabledReasons.nothingToChange : disabledReasons.shapeMachineOnlyInTorus,
      ),
    },
  };
}

function formatTorusModuliLabel(prefix: string, state: TorusLatticeParameters, start: TorusLatticeParameters): string {
  const modulus = reducedTorusModulus(state);
  return `${prefix}: ${torusShape(modulus)}, modulus ${modulus.re.toFixed(2)} + ${modulus.im.toFixed(2)}i. ${describeTorusRelation(state, start)}`;
}

function createGeodesicCannonEntries(
  geodesicIds: readonly string[],
  geodesicLabelsById: Readonly<Record<string, string>> | undefined,
  connectedGeodesicIds: readonly string[] | undefined,
): GeodesicCannonActionsPaletteContent["geodesics"] {
  const connectedIds = new Set(connectedGeodesicIds ?? []);
  return geodesicIds.map((geodesicId, index) => ({
    id: geodesicId,
    label: geodesicLabelsById?.[geodesicId] ?? beamName(index + 1),
    connected: connectedIds.has(geodesicId),
    connectionSymbolLabel: connectedIds.has(geodesicId) ? "Linked beam: a beam from one laser to another" : undefined,
    deleteDisabled: false,
    aimDisabled: connectedIds.has(geodesicId),
    ...(connectedIds.has(geodesicId) ? { aimDisabledReason: disabledReasons.linkedBeamsCannotBeAimed } : {}),
  }));
}

/** `{ disabled }` for a control, with `reason` when it is disabled: every disabled control carries its reason. */
function disabledWhen(disabled: boolean, reason: string): { readonly disabled: boolean; readonly disabledReason?: string } {
  return disabled ? { disabled, disabledReason: reason } : { disabled };
}

function clampIntegerMeters(value: number, min: number, max: number): number {
  return Math.max(Math.ceil(min), Math.min(Math.floor(max), Math.round(value)));
}

function roundMeters(value: number): number {
  return Math.max(1, Math.round(value));
}

function createHeaderAction(id: PaletteHeaderAction["id"]): PaletteHeaderAction {
  switch (id) {
    case "settings":
      return {
        id,
        label: "\u2699",
        ariaLabel: "Open settings",
        disabled: false,
      };
    case "close":
      return {
        id,
        label: "X",
        ariaLabel: "Close palette",
        disabled: false,
      };
    case "back":
      return {
        id,
        label: "\u2190",
        ariaLabel: "Back to main menu",
        disabled: false,
      };
    case "none":
      return {
        id,
        label: "",
        ariaLabel: "",
        disabled: true,
      };
  }
}
