/**
 * Renderer-neutral definition of the tool/settings palette: createPaletteDefinition turns a RuntimeMenuState plus the app config and input mode into a PaletteDefinition, a plain-data description (header actions plus one page-specific content record) that the desktop DOM menu and the VR panel both render.
 * The content types form a discriminated union keyed by kind (main, settings, debug-settings, place-flag-options, edit-sign, geodesic-cannon-actions, geometry-computer-actions, tutorial, goal, question-help).
 * The module decides what is shown and enabled (config-gated sections, disabled buttons, tutorial text per input device, integer-meter limits for the geometry computer) but performs no rendering and holds no state; any page whose payload is missing falls back to the main page.
 */
import type { ObjectActionEntry } from "../engine/moduleTypes";
import { appConfigCatalog, getEnabledMainTools, type AppConfig, type ConfigurableToolId } from "../glue/appConfig";
import {
  describeTorusRelation,
  reducedTorusModulus,
  torusShape,
  type TorusLatticeParameters,
} from "../cell-complex/deformations/torusModuli";
import { formatBodyForInputMode } from "./inputModeText";
import { getInputHintGlyph, type InputHintGlyph } from "./inputIntents";
import { publicAssetUrl } from "../glue/assetUrls";
import { worldCatalog } from "../authoring/worldCatalog";
import { helpHubHomeGuidance } from "../world-objects/helpHubCopy";
import { beamName, mainMenuText, objectActions, surfaceNames, toolNames } from "../world-objects/vocabulary";
import { portalPanelModeDefinitions } from "../glue/portalPanelMode";
import type { RuntimeMenuConsoleLogLevelId, RuntimeMenuPageId, RuntimeMenuState } from "../runtime/runtimeMenuState";
import type { ToolsById } from "../runtime/toolRegistry";
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
}

/** One entry of the main menu: Help, Settings, Go home or Start over. */
export interface MainMenuActionEntry {
  readonly id: "help" | "settings" | "go-home" | "start-over";
  readonly label: string;
}

/**
 * Content of the main page, the main menu (design 017 section 7.5): Help, Settings, Go home and Start over as text buttons.
 * The tool tiles belong to the belt now; `toolOptions` is empty on desktop and is filled only for VR, until the VR belt of job 77 replaces it.
 */
export interface MainPaletteContent {
  readonly kind: "main";
  readonly selectedTool: RuntimeToolId;
  readonly placeFlagType: PlacedFlagType;
  readonly menuActions: readonly MainMenuActionEntry[];
  /** VR only, until job 77: the tools enabled by the app config, in display order. Empty on desktop. */
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
}

/** Content of the geodesic emitter menu: the add and carry actions, the actions tools contribute, and one row per geodesic. */
export interface GeodesicCannonActionsPaletteContent {
  readonly kind: "geodesic-cannon-actions";
  readonly cannonId: string;
  readonly addAction: {
    readonly label: string;
    readonly disabled: boolean;
  };
  readonly carryAction: {
    readonly label: string;
    readonly disabled: boolean;
  };
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
  /**
   * Buttons that move the target along one axis by deltaMeters (+-1 m and +-w/2); all disabled when the page is unavailable.
   */
  readonly stepActions: readonly {
    readonly axis: "a" | "b";
    readonly deltaMeters: number;
    readonly label: string;
    readonly disabled: boolean;
  }[];
  /**
   * The button that starts deforming toward the target; disabled when unavailable or when target equals current.
   */
  readonly goAction: {
    readonly label: string;
    readonly disabled: boolean;
  };
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
  /** One entry per page, in order, for the index view. */
  readonly topics: readonly { readonly pageIndex: number; readonly title: string }[];
  readonly title: string;
  readonly body: string;
  readonly pageLabel: string;
  readonly previousAction: {
    readonly label: string;
    readonly disabled: boolean;
  };
  readonly nextAction: {
    readonly label: string;
    readonly disabled: boolean;
  };
}

/** Content of one goal page, with previous/next paging controls. */
export interface GoalPaletteContent extends PagedHelpExtras {
  readonly kind: "goal";
  readonly objectId: string;
  readonly title: string;
  readonly body: string;
  readonly pageLabel: string;
  readonly previousAction: {
    readonly label: string;
    readonly disabled: boolean;
  };
  readonly nextAction: {
    readonly label: string;
    readonly disabled: boolean;
  };
}

/** Content of the help hub page that offers the tutorial and goal subpages. */
export interface QuestionHelpPaletteContent {
  readonly kind: "question-help";
  readonly objectId: string;
  readonly body: string;
  /** Buttons for the subpages; each is disabled if that subpage has no pages. */
  readonly options: readonly {
    readonly id: "tutorial" | "goal";
    readonly label: string;
    readonly disabled: boolean;
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
    | TutorialPaletteContent
    | GoalPaletteContent
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
  toolsById: ToolsById,
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
        addAction: { label: objectActions.addBeam, disabled: false },
        carryAction: { label: objectActions.pickUp, disabled: false },
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
      content: createPagedHelpContent("tutorial", state.tutorialOptions, inputMode),
    };
  }

  if (state.page === "goal" && state.goalOptions) {
    return {
      pageId: "goal",
      leftAction: createHeaderAction("none"),
      rightAction: createHeaderAction("back"),
      reloadConfirmationActive,
      content: createPagedHelpContent("goal", state.goalOptions, inputMode),
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
        body: questionHelpHubBody,
        options: [
          {
            id: "tutorial",
            label: surfaceNames.howTo,
            disabled: state.questionHelpOptions.tutorialPages.length === 0,
          },
          {
            id: "goal",
            label: surfaceNames.thingsToTry,
            disabled: state.questionHelpOptions.goalPages.length === 0,
          },
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
      toolOptions: inputMode === "xr" ? createToolOptions(appConfig, toolsById) : [],
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
  ): { readonly definition: PaletteDefinition; readonly version: number };
}

/**
 * Creates a definition cache for one `appConfig` (fixed for the app's lifetime). The menu state is replaced
 * immutably, so reference equality of `state` is a complete change test; the clock enters only through the
 * reload-confirmation flag, which is part of the key.
 */
export function createPaletteDefinitionCache(appConfig: AppConfig, toolsById: ToolsById): PaletteDefinitionCache {
  let lastState: RuntimeMenuState | undefined;
  let lastInputMode: InputMode | undefined;
  let lastReloadConfirmationActive = false;
  let definition: PaletteDefinition | undefined;
  let version = 0;
  let result: { readonly definition: PaletteDefinition; readonly version: number } | undefined;

  return {
    get(state, inputMode, nowMs = Date.now()) {
      const reloadConfirmationActive = (state.reloadConfirmUntilMs ?? 0) > nowMs;

      if (
        result === undefined ||
        state !== lastState ||
        inputMode !== lastInputMode ||
        reloadConfirmationActive !== lastReloadConfirmationActive
      ) {
        lastState = state;
        lastInputMode = inputMode;
        lastReloadConfirmationActive = reloadConfirmationActive;
        definition = createPaletteDefinition(state, appConfig, inputMode, nowMs, toolsById);
        version += 1;
        result = { definition, version };
      }

      return result;
    },
  };
}

function createPagedHelpContent(
  kind: "tutorial",
  options: NonNullable<RuntimeMenuState["tutorialOptions"]>,
  inputMode: InputMode,
): TutorialPaletteContent;
function createPagedHelpContent(
  kind: "goal",
  options: NonNullable<RuntimeMenuState["goalOptions"]>,
  inputMode: InputMode,
): GoalPaletteContent;
function createPagedHelpContent(
  kind: "tutorial" | "goal",
  options: NonNullable<RuntimeMenuState["tutorialOptions"]> | NonNullable<RuntimeMenuState["goalOptions"]>,
  inputMode: InputMode,
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
    body: showIndex ? tutorialIndexBody : resolveTutorialBodyForInputMode(page, inputMode),
    imageSrc: !showIndex && page.imagePath ? publicAssetUrl(page.imagePath) : undefined,
    controls: showIndex
      ? []
      : (page.controls ?? []).map((control) => ({ hint: getInputHintGlyph(inputMode, control.intent), label: control.label })),
  };
  const paging = {
    pageLabel: pageCount === 0 ? "0 / 0" : `${pageIndex + 1} / ${pageCount}`,
    previousAction: {
      label: "<",
      disabled: pageIndex <= 0,
    },
    nextAction: {
      label: ">",
      disabled: pageIndex >= pageCount - 1,
    },
  };

  if (kind === "goal") {
    return { kind, ...common, ...paging };
  }

  return {
    kind,
    ...common,
    ...paging,
    view: showIndex ? "index" : "page",
    topics: options.pages.map((entry, index) => ({ pageIndex: index, title: entry.title })),
  };
}

/** Text above the tutorial's index of pages. */
const tutorialIndexBody = "Choose a topic to see what you can do and how.";

function resolveTutorialBodyForInputMode(
  page: NonNullable<RuntimeMenuState["tutorialOptions"]>["pages"][number],
  inputMode: InputMode,
): string {
  if (inputMode === "desktop") {
    return page.desktopBody ?? formatBodyForInputMode(page.body, "desktop");
  }

  return page.xrBody ?? formatBodyForInputMode(page.body, "xr");
}

/** The main menu's entries, in order. */
const mainMenuActions: readonly MainMenuActionEntry[] = [
  { id: "help", label: surfaceNames.help },
  { id: "settings", label: mainMenuText.settings },
  { id: "go-home", label: objectActions.goHome },
  { id: "start-over", label: objectActions.startOver },
];

// The tools the config enables that have an entry on the main list, in the config's order.
function createToolOptions(appConfig: AppConfig, toolsById: ToolsById): MainPaletteContent["toolOptions"] {
  const tools = getEnabledMainTools(appConfig).flatMap((id) => {
    const tool = toolsById.get(id);
    return tool?.entry.kind === "main-tool" ? [{ id, label: tool.label }] : [];
  });
  // The empty hand comes first: selecting it puts the tool away (design 017 section 8.3; the belt replaces this list on desktop, job 77 in VR).
  return [{ id: "none" as const, label: toolNames.none.name }, ...tools];
}

function createGeometryComputerActionsContent(
  options: NonNullable<RuntimeMenuState["geometryComputerOptions"]>,
): GeometryComputerActionsPaletteContent {
  const available = options.available;
  const widthMeters = roundMeters(options.widthMeters ?? 15);
  const currentA = clampIntegerMeters(options.currentSkewXMeters ?? 0, 0, 2 * widthMeters);
  const currentB = clampIntegerMeters(options.currentDepthMeters ?? widthMeters, 0.5 * widthMeters, 2 * widthMeters);
  const targetA = clampIntegerMeters(options.targetSkewXMeters ?? currentA, 0, 2 * widthMeters);
  const targetB = clampIntegerMeters(options.targetDepthMeters ?? currentB, 0.5 * widthMeters, 2 * widthMeters);
  const statusLabel = available
    ? `Current (${formatMeters(currentA)}, ${formatMeters(currentB)}) / target (${formatMeters(targetA)}, ${formatMeters(targetB)})`
    : "The shape machine only works in the torus world.";
  const halfWidthStep = Math.round(widthMeters / 2);
  const start = {
    widthMeters,
    skewXMeters: options.startSkewXMeters ?? options.currentSkewXMeters ?? currentA,
    depthMeters: options.startDepthMeters ?? options.currentDepthMeters ?? currentB,
  };

  return {
    kind: "geometry-computer-actions",
    computerId: options.computerId,
    available,
    statusLabel,
    currentModuliLabel: available
      ? formatTorusModuliLabel(
          "Current",
          { widthMeters, skewXMeters: options.currentSkewXMeters ?? currentA, depthMeters: options.currentDepthMeters ?? currentB },
          start,
        )
      : "",
    targetModuliLabel: available
      ? formatTorusModuliLabel("Target", { widthMeters, skewXMeters: targetA, depthMeters: targetB }, start)
      : "",
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
    stepActions: [
      { axis: "a", deltaMeters: -halfWidthStep, label: `A -${formatMeters(halfWidthStep)}`, disabled: !available },
      { axis: "a", deltaMeters: -1, label: "A -1 m", disabled: !available },
      { axis: "a", deltaMeters: 1, label: "A +1 m", disabled: !available },
      { axis: "a", deltaMeters: halfWidthStep, label: `A +${formatMeters(halfWidthStep)}`, disabled: !available },
      { axis: "b", deltaMeters: -halfWidthStep, label: `B -${formatMeters(halfWidthStep)}`, disabled: !available },
      { axis: "b", deltaMeters: -1, label: "B -1 m", disabled: !available },
      { axis: "b", deltaMeters: 1, label: "B +1 m", disabled: !available },
      { axis: "b", deltaMeters: halfWidthStep, label: `B +${formatMeters(halfWidthStep)}`, disabled: !available },
    ],
    goAction: {
      label: "GO!",
      disabled: !available || (currentA === targetA && currentB === targetB),
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
  }));
}

function formatMeters(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded} m` : `${rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} m`;
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
