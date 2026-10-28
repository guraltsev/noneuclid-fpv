/**
 * Builds the in-scene tool palette panel as a @pmndrs/uikit component tree from a renderer-neutral PaletteDefinition (src/ui/paletteDefinition.ts).
 * The adapter is purely a view: it lays out a header (left action, utility and contextual buttons, right action) and a page body chosen by definition.content.kind,
 * and turns every clickable element into a Container whose userData carries the action callback and an item id. scenePaletteController.ts ray-casts the panel and reads those userData keys;
 * it activates the first ancestor with scenePaletteAction (legacy alias xrPaletteAction) and looks up the tooltip from scenePaletteItemId (legacy alias xrPaletteItemId).
 * Layout units are uikit pixels on a 980x760 panel (scenePaletteLayout.ts); scenePalettePanelPixelSize converts them to meters, so the root Container is a flat panel in its own local frame with +Z as the front.
 * The module name says VR for historical reasons: the same adapter serves the desktop palette, re-exported as createScenePaletteLibraryAdapter and by scenePaletteLibraryAdapter.ts.
 * Content is rebuilt wholesale on each setDefinition (no diffing); disposal of the previous uikit tree is handled by this module.
 */
import { Component, Container, Image, Text } from "@pmndrs/uikit";
import { ArrowLeft, ChevronLeft, ChevronRight, House, RotateCw, Settings, Trash2, X } from "@pmndrs/uikit-lucide";
import { publicAssetUrl } from "../../glue/assetUrls";
import type { PortalPanelModeId } from "../../glue/portalPanelMode";
import type {
  RuntimeDebugOverlayItemId,
  RuntimeMenuConsoleLogLevelId,
  RuntimeToolId,
} from "../../runtime/runtimeMenuState";
import type { PaletteDefinition, PaletteHeaderAction } from "../../ui/paletteDefinition";
import type { PlacedFlagType } from "../../world-objects/placedFlags";
import { resolveVrPaletteHeaderActions } from "./vrPaletteHeaderActions";
import {
  scenePalettePanelHeightPixels,
  scenePalettePanelPixelSize,
  scenePalettePanelWidthPixels,
} from "./scenePaletteLayout";

/**
 * Callbacks the palette panel invokes when the user activates a control; supplied by scenePaletteController.ts, which forwards them from createThreeApp#shell.
 * Only the header, world, config, reload, home, debug, comfort and related toggle callbacks are required; every optional callback is invoked with optional chaining, so a missing one makes that control a silent no-op.
 * Callbacks fire synchronously from the controller's select-pressed edge handling, never from uikit pointer events.
 */
export interface VrPaletteLibraryAdapterOptions {
  /** Header left button; only the "settings" action id is routed here. */
  readonly onLeftAction: (actionId: PaletteDefinition["leftAction"]["id"]) => void;
  /** Header right button (and left slot "back" promoted from the right action); receives "close" or "back". */
  readonly onRightAction: (actionId: PaletteDefinition["rightAction"]["id"]) => void;
  readonly onWorldSelected: (worldId: string) => void;
  readonly onConfigSelected: (configName: string) => void;
  readonly onReloadRequested: () => void;
  readonly onHomeRequested: () => void;
  readonly onDebugEnabledChanged: (enabled: boolean) => void;
  readonly onDebugSettingsRequested: () => void;
  readonly onConsoleLogLevelSelected: (level: RuntimeMenuConsoleLogLevelId) => void;
  readonly onDebugOverlayToggled: (enabled: boolean) => void;
  readonly onDebugOverlayItemToggled: (itemId: RuntimeDebugOverlayItemId, enabled: boolean) => void;
  readonly onAntiNauseaModeToggled: (enabled: boolean) => void;
  readonly onPortalPanelModeSelected: (mode: PortalPanelModeId) => void;
  readonly onPortalInspectionToggled: (enabled: boolean) => void;
  readonly onCollisionGeometryWireframesToggled: (enabled: boolean) => void;
  readonly onAimCollisionOutlinesToggled: (enabled: boolean) => void;
  /** When absent, the "Copy URL with options" button on the debug settings page is not rendered. */
  readonly onCopyUrlWithOptionsRequested?: () => void;
  /** Main page: a tool tile was activated. */
  readonly onToolSelected?: (toolId: RuntimeToolId) => void;
  /** Place-sign tile's "..." options button. */
  readonly onPlaceFlagOptionsRequested?: () => void;
  readonly onPlaceFlagTypeSelected?: (flagType: PlacedFlagType) => void;
  /** Geodesic cannon page callbacks; the cannon id comes from the palette content. Aim and rotate receive the geodesic id; delete requires one. */
  readonly onGeodesicCannonAddRequested?: (cannonId: string) => void;
  readonly onGeodesicCannonCarryRequested?: (cannonId: string) => void;
  readonly onGeodesicCannonTieAndDetachRequested?: (cannonId: string) => void;
  readonly onGeodesicCannonRotateRequested?: (cannonId: string, geodesicId?: string) => void;
  readonly onGeodesicCannonAimRequested?: (cannonId: string, geodesicId?: string) => void;
  readonly onGeodesicCannonDeleteRequested?: (cannonId: string, geodesicId: string) => void;
  /** Geometry computer page callbacks (the set-target callback is part of the contract but not invoked by this adapter). Deltas and targets are in meters. */
  readonly onGeometryComputerSetTargetRequested?: (computerId: string, target: { readonly aMeters: number; readonly bMeters: number }) => void;
  readonly onGeometryComputerStepTargetRequested?: (computerId: string, axis: "a" | "b", deltaMeters: number) => void;
  readonly onGeometryComputerGoRequested?: (computerId: string) => void;
  /** Help hub and paged tutorial/goal navigation. */
  readonly onQuestionHelpTutorialRequested?: () => void;
  readonly onQuestionHelpGoalRequested?: () => void;
  readonly onTutorialPreviousRequested?: () => void;
  readonly onTutorialNextRequested?: () => void;
  readonly onGoalPreviousRequested?: () => void;
  readonly onGoalNextRequested?: () => void;
  /** Sign editor on-panel keyboard: a character (including " " and "\n"), backspace, and delete-sign. */
  readonly onSignKeyboardCharacter?: (character: string) => void;
  readonly onSignKeyboardBackspace?: () => void;
  readonly onSignDeleteRequested?: () => void;
}

/**
 * Handle to a built palette panel: a uikit root plus content, visibility, animation and disposal controls.
 * The owner must call dispose() exactly once when the panel is discarded.
 */
export interface VrPaletteLibraryAdapter {
  /** Panel root; add it to the scene graph. It starts hidden. Its local +Z is the panel front and its size in meters is given by scenePaletteLayout.ts. */
  readonly root: Container;
  /** Disposes the previously rendered header and body and builds new ones from definition. Rebuilds everything, so call it only when the definition changed (the controller compares serialized definitions). */
  setDefinition(definition: PaletteDefinition): void;
  /** Shows or hides the whole panel without disposing it. */
  setVisible(visible: boolean): void;
  /** Advances uikit internal updates (layout, scrolling, animations) by deltaMs milliseconds; call once per frame. */
  update(deltaMs: number): void;
  /** Disposes the rendered tree and the root, detaching the panel from its parent. */
  dispose(): void;
}

/**
 * Renderer-neutral alias of VrPaletteLibraryAdapterOptions used by the desktop and XR palette controller.
 */
export type ScenePaletteLibraryAdapterOptions = VrPaletteLibraryAdapterOptions;
/**
 * Renderer-neutral alias of VrPaletteLibraryAdapter used by the desktop and XR palette controller.
 */
export type ScenePaletteLibraryAdapter = VrPaletteLibraryAdapter;

// Palette color tokens (CSS hex strings) used throughout the panel.
const surfaceColor = "#0f172a";
const sectionColor = "#111827";
const borderColor = "#475569";
const actionColor = "#1d4ed8";
const activeColor = "#0f766e";
const inactiveColor = "#374151";
const textColor = "#f8fafc";
const mutedTextColor = "#e2e8f0";
const scrollbarColor = "#38bdf8";
const scrollbarBorderColor = "#0f172a";
// Asset URLs for icons, resolved through publicAssetUrl.
const signIconSources: Record<PlacedFlagType, string> = {
  WoodenSign1: publicAssetUrl("WoodenSign1/WoodenSign1.png"),
  WoodenSign2: publicAssetUrl("WoodenSign2/WoodenSign2.png"),
};
const aimIconSource = publicAssetUrl("icons/aim-inverted.png");
const carryIconSource = publicAssetUrl("icons/carry-inverted.svg");
const lockIconSource = publicAssetUrl("icons/lock.png");
const unlinkIconSource = publicAssetUrl("icons/unlink-inverted.png");
const rayToolIconSource = publicAssetUrl("flashlight/Lightsaber.png");
const protractorToolIconSource = publicAssetUrl("icons/protractor.png");
const measureLengthToolIconSource = publicAssetUrl("icons/ruler-inverted.svg");
const signTypeLabels: Record<PlacedFlagType, string> = {
  WoodenSign1: "Wooden Sign 1",
  WoodenSign2: "Wooden Sign 2",
};
// Key layout of the on-panel sign editor keyboard; Enter, Space and Backspace are added separately.
const signKeyboardRows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
] as const;

/**
 * Creates the in-scene palette panel: an empty, hidden uikit root at the standard palette size, ready for setDefinition.
 * The root uses depthTest/depthWrite off with a high renderOrder so the panel draws over world geometry, and accepts only "ray" pointer events.
 * The caller owns the adapter and must call dispose(); until setDefinition is called the panel has no content.
 */
export function createVrPaletteLibraryAdapter(options: VrPaletteLibraryAdapterOptions): VrPaletteLibraryAdapter {
  // Header and body currently attached to root; tracked so they can be disposed on the next setDefinition.
  let renderedChildren: Container[] = [];
  const root = new Container({
    width: scenePalettePanelWidthPixels,
    height: scenePalettePanelHeightPixels,
    pixelSize: scenePalettePanelPixelSize,
    flexDirection: "column",
    borderRadius: 28,
    padding: 20,
    gap: 12,
    backgroundColor: surfaceColor,
    color: textColor,
    fill: textColor,
    opacity: 1,
    overflow: "visible",
    pointerEvents: "auto",
    scrollbarColor: "#64748b",
    borderColor,
    borderWidth: 3,
    renderOrder: 999,
    depthTest: false,
    depthWrite: false,
  });
  root.name = "vr-tool-palette";
  root.visible = false;
  root.pointerEventsType = { allow: ["ray"] };

  return {
    root,
    setDefinition(nextDefinition) {
      disposeRenderedChildren(renderedChildren);
      renderedChildren = [
        buildHeader(nextDefinition, options),
        buildContent(nextDefinition, options),
      ];
      root.add(...renderedChildren);
    },
    setVisible(visible) {
      root.visible = visible;
    },
    update(deltaMs) {
      root.update(deltaMs);
    },
    dispose() {
      disposeRenderedChildren(renderedChildren);
      renderedChildren = [];
      root.removeFromParent();
      root.dispose();
    },
  };
}

/**
 * Renderer-neutral name for createVrPaletteLibraryAdapter, used by scenePaletteController.ts.
 */
export const createScenePaletteLibraryAdapter = createVrPaletteLibraryAdapter;

// Header row: left (action, plus home/reload on the main page and a confirm tooltip), center contextual actions, right action. The unused title Text is an empty placeholder.
function buildHeader(
  definition: PaletteDefinition,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const headerActions = resolveVrPaletteHeaderActions(definition);
  // Home and reload buttons are shown only on the main page.
  const showUtilityActions = definition.pageId === "main";
  const header = new Container({
    width: "100%",
    height: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  });

  const leftActions = new Container({
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    positionType: "relative",
  });
  leftActions.add(
    createHeaderButton(headerActions.leftAction, () => {
      dispatchHeaderAction(headerActions.leftAction.id, options);
    }),
  );
  if (showUtilityActions) {
    leftActions.add(
      createHeaderUtilityButton("home", false, options.onHomeRequested),
      createHeaderUtilityButton("reload", definition.reloadConfirmationActive, options.onReloadRequested),
    );
  }
  if (showUtilityActions && definition.reloadConfirmationActive) {
    leftActions.add(createReloadConfirmTooltip());
  }
  header.add(leftActions);

  const contextualActions = createContextualHeaderActions(definition, options);
  if (contextualActions.length > 0) {
    const contextualActionRow = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
    });
    contextualActionRow.add(...contextualActions);
    header.add(contextualActionRow);
  } else {
    header.add(new Text({
      text: "",
      fontSize: 1,
      opacity: 0,
    }));
  }

  header.add(new Text({
    text: "",
    fontSize: 28,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  }));
  header.add(createHeaderButton(headerActions.rightAction, () => {
    dispatchHeaderAction(headerActions.rightAction.id, options);
  }));

  return header;
}

// Page-specific header buttons: cannon add/carry/tie-and-detach, or the sign trash button; empty otherwise.
function createContextualHeaderActions(
  definition: PaletteDefinition,
  options: VrPaletteLibraryAdapterOptions,
): Container[] {
  if (definition.content.kind === "geodesic-cannon-actions") {
    const content = definition.content;
    return [
      createHeaderActionButton(
        "geodesic-cannon-action:add-geodesic",
        "",
        () => options.onGeodesicCannonAddRequested?.(content.cannonId),
        { icon: "add-geodesic", disabled: content.addAction.disabled, width: 52 },
      ),
      createHeaderActionButton(
        "geodesic-cannon-action:carry",
        "",
        () => options.onGeodesicCannonCarryRequested?.(content.cannonId),
        { icon: "carry", disabled: content.carryAction.disabled, width: 52 },
      ),
      createHeaderActionButton(
        "geodesic-cannon-action:tie-and-detach",
        "",
        () => options.onGeodesicCannonTieAndDetachRequested?.(content.cannonId),
        { icon: "tie-and-detach", disabled: content.tieAndDetachAction.disabled, backgroundColor: "#b45309", width: 52 },
      ),
    ];
  }

  if (definition.content.kind === "edit-sign") {
    return [
      createHeaderActionButton(
        "sign-action:trash",
        "",
        () => options.onSignDeleteRequested?.(),
        { icon: "trash", backgroundColor: "#7f1d1d", width: 52 },
      ),
    ];
  }

  return [];
}

// Home or reload button. The reload button turns red while a reload confirmation is pending.
function createHeaderUtilityButton(
  actionId: "home" | "reload",
  active: boolean,
  onClick: () => void,
): Container {
  const button = createInteractiveSurface({
    width: 52,
    height: 44,
    label: "",
    onClick,
    backgroundColor: active ? "#991b1b" : actionColor,
  });
  button.name = actionId === "home"
    ? "Home"
    : active ? "Click again to confirm" : "Reload world";
  button.userData.xrPaletteItemId = actionId === "home" ? "go-home" : "reload-world";
  button.userData.scenePaletteItemId = actionId === "home" ? "go-home" : "reload-world";
  button.add(actionId === "home"
    ? new House({
        width: 24,
        height: 24,
        color: textColor,
        fill: textColor,
      })
    : new RotateCw({
        width: 24,
        height: 24,
        color: textColor,
        fill: textColor,
      }));
  return button;
}

// Small red "Click again to confirm" label positioned above the header's reload button using absolute offsets.
function createReloadConfirmTooltip(): Container {
  const tooltip = new Container({
    width: 162,
    height: 30,
    positionType: "absolute",
    positionTop: -34,
    positionLeft: 128,
    zIndexOffset: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#991b1b",
    borderColor: "#fecaca",
    borderWidth: 1,
    renderOrder: 1005,
    depthTest: false,
    depthWrite: false,
  });
  tooltip.add(new Text({
    text: "Click again to confirm",
    fontSize: 13,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  }));
  return tooltip;
}

// Standard header button. An action with id "none" becomes an invisible, non-interactive spacer of the same width so the layout stays stable.
function createHeaderButton(
  action: PaletteHeaderAction,
  onClick: () => void,
): Container {
  if (action.id === "none") {
    return new Container({
      width: 64,
      height: 44,
      opacity: 0,
      pointerEvents: "none",
    });
  }

  const button = createInteractiveSurface({
    width: 64,
    height: 44,
    label: "",
    onClick,
    disabled: action.disabled,
    backgroundColor: action.disabled ? "#334155" : actionColor,
  });
  button.name = action.ariaLabel || "palette-header-action";
  button.userData.xrPaletteItemId = action.ariaLabel || action.label;
  button.userData.scenePaletteItemId = action.id;
  const icon = createHeaderIcon(action.id);
  if (icon) {
    button.add(icon);
  } else if (action.label) {
    button.add(createButtonText(action.label, 15));
  }
  return button;
}

// Route "settings" to onLeftAction and every other action (close, back) to onRightAction; "none" is ignored.
function dispatchHeaderAction(
  actionId: PaletteHeaderAction["id"],
  options: VrPaletteLibraryAdapterOptions,
): void {
  if (actionId === "none") {
    return;
  }

  if (actionId === "settings") {
    options.onLeftAction(actionId);
    return;
  }

  options.onRightAction(actionId);
}

// Select the page body by content.kind; the final fallthrough builds the settings page (world, config, debug and comfort sections).
function buildContent(
  definition: PaletteDefinition,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  if (definition.content.kind === "main") {
    return buildMainContent(definition.content, options);
  }

  if (definition.content.kind === "place-flag-options") {
    return buildPlaceSignOptionsContent(definition.content, options);
  }

  if (definition.content.kind === "edit-sign") {
    return buildEditSignContent(definition.content, options);
  }

  if (definition.content.kind === "geodesic-cannon-actions") {
    return buildGeodesicCannonActionsContent(definition.content, options);
  }

  if (definition.content.kind === "geometry-computer-actions") {
    return buildGeometryComputerActionsContent(definition.content, options);
  }

  if (definition.content.kind === "tutorial") {
    return buildPagedHelpContent(definition.content, options);
  }

  if (definition.content.kind === "goal") {
    return buildPagedHelpContent(definition.content, options);
  }

  if (definition.content.kind === "question-help") {
    return buildQuestionHelpContent(definition.content, options);
  }

  if (definition.content.kind === "debug-settings") {
    return buildDebugSettingsContent(definition.content, options);
  }

  const settings = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 10,
    height: 400,
    overflow: "scroll",
    paddingRight: 24,
    scrollbarWidth: 14,
    scrollbarColor,
    scrollbarBorderColor,
    scrollbarBorderWidth: 2,
    scrollbarBorderRadius: 7,
    scrollbarZIndex: 1004,
  });

  const worldSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  worldSection.add(createSectionLabel("World"));
  worldSection.add(createOptionGrid(
    definition.content.worldOptions,
    definition.content.selectedWorldId,
    "world",
    options.onWorldSelected,
  ));

  const configSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  configSection.add(createSectionLabel("Config"));
  configSection.add(createOptionGrid(
    definition.content.appConfigOptions,
    definition.content.selectedAppConfigName,
    "config",
    options.onConfigSelected,
  ));

  const debugSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  debugSection.add(createSectionLabel("Debug"));
  debugSection.add(createDebugToolsRow(definition.content.debugEnabled, options));

  const comfortSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
  });
  comfortSection.add(createSectionLabel("Comfort"));
  comfortSection.add(createToggleRow("Anti-nausea vignette", definition.content.antiNauseaModeEnabled, (enabled) => {
    options.onAntiNauseaModeToggled(enabled);
  }, "anti-nausea-vignette-toggle"));

  if (definition.content.worldSelectionSectionEnabled) {
    settings.add(worldSection);
  }

  if (definition.content.configSelectionSectionEnabled) {
    settings.add(configSection);
  }

  if (definition.content.debugSectionEnabled) {
    settings.add(debugSection);
  }

  settings.add(comfortSection);

  return settings;
}

// Main page: a row of tool tiles, with the place-flag tile showing the currently selected sign type.
function buildMainContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "main" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 300,
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });

  const row = new Container({
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  });
  for (const tool of content.toolOptions) {
    row.add(createToolTile(
      tool.id,
      tool.label,
      content.selectedTool,
      options,
      tool.id === "place-flag" ? content.placeFlagType : undefined,
    ));
  }

  panel.add(row);
  return panel;
}

// Geodesic cannon page: a scrollable list with one row per geodesic (label, locked-status icon or Aim button, delete button).
function buildGeodesicCannonActionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "geodesic-cannon-actions" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 522,
    flexDirection: "column",
    gap: 10,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(createSectionLabel("Geodesic emitter"));

  const list = new Container({
    width: "100%",
    height: 316,
    flexDirection: "column",
    gap: 8,
    overflow: "scroll",
    paddingRight: 18,
    scrollbarWidth: 12,
    scrollbarColor,
    scrollbarBorderColor,
    scrollbarBorderWidth: 2,
    scrollbarBorderRadius: 6,
    scrollbarZIndex: 1004,
  });

  for (const geodesic of content.geodesics) {
    const row = new Container({
      width: "100%",
      height: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: 8,
      borderRadius: 14,
      backgroundColor: inactiveColor,
      borderColor,
      borderWidth: 1,
    });
    row.add(createButtonText(geodesic.label, 18));

    const deleteButton = createInteractiveSurface({
      width: 46,
      height: 42,
      label: "",
      disabled: geodesic.deleteDisabled,
      backgroundColor: geodesic.deleteDisabled ? "#334155" : "#7f1d1d",
      onClick: () => options.onGeodesicCannonDeleteRequested?.(content.cannonId, geodesic.id),
    });
    deleteButton.userData.xrPaletteItemId = `geodesic-cannon-action:delete:${geodesic.id}`;
    deleteButton.userData.scenePaletteItemId = `geodesic-cannon-action:delete:${geodesic.id}`;
    deleteButton.add(new Trash2({
      width: 24,
      height: 24,
      color: textColor,
      fill: textColor,
    }));

    if (geodesic.locked) {
      const status = createInteractiveSurface({
        width: 52,
        height: 42,
        label: "",
        labelFontSize: 15,
        disabled: true,
        backgroundColor: "#334155",
        onClick: () => {},
      });
      status.name = geodesic.connectionSymbolLabel ?? "Locked geodesic segment between emitters";
      status.add(createLockedGeodesicSegmentStatus());
      row.add(status);
    }

    if (!geodesic.locked) {
      const aimButton = createInteractiveSurface({
        width: 112,
        height: 42,
        label: "Aim",
        labelFontSize: 16,
        disabled: false,
        backgroundColor: actionColor,
        onClick: () => options.onGeodesicCannonAimRequested?.(content.cannonId, geodesic.id),
      });
      aimButton.userData.xrPaletteItemId = `geodesic-cannon-action:aim:${geodesic.id}`;
      aimButton.userData.scenePaletteItemId = `geodesic-cannon-action:aim:${geodesic.id}`;
      aimButton.add(createGeodesicCannonActionIcon("aim"));

      row.add(aimButton);
    }

    row.add(deleteButton);
    list.add(row);
  }

  panel.add(list);
  return panel;
}

// Geometry computer page: status text, deformation diagram, coordinate readout, a 4-column grid of step buttons and a Go button.
function buildGeometryComputerActionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "geometry-computer-actions" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 600,
    flexDirection: "column",
    gap: 10,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(createSectionLabel("World deformation"));
  panel.add(new Text({
    text: content.statusLabel,
    fontSize: 18,
    fontWeight: "medium",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  }));
  panel.add(createWorldDeformationDiagram(content));

  panel.add(new Text({
    text: `X = ${content.widthMeters} m   current white (${content.current.aMeters}, ${content.current.bMeters})   target green (${content.target.aMeters}, ${content.target.bMeters})`,
    fontSize: 16,
    fontWeight: "medium",
    color: "#bbf7d0",
    fill: "#bbf7d0",
    flexShrink: 1,
    wordBreak: "break-word",
  }));

  const presetGrid = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
  });
  for (let index = 0; index < content.stepActions.length; index += 4) {
    const row = new Container({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
    });
    for (const action of content.stepActions.slice(index, index + 4)) {
      const button = createInteractiveSurface({
        width: "24%",
        height: 44,
        label: action.label,
        labelFontSize: 15,
        disabled: action.disabled,
        backgroundColor: action.disabled ? "#334155" : actionColor,
        onClick: () => options.onGeometryComputerStepTargetRequested?.(content.computerId, action.axis, action.deltaMeters),
      });
      button.userData.xrPaletteItemId = `geometry-computer:step:${action.axis}:${action.deltaMeters}`;
      button.userData.scenePaletteItemId = `geometry-computer:step:${action.axis}:${action.deltaMeters}`;
      row.add(button);
    }
    presetGrid.add(row);
  }

  const goButton = createInteractiveSurface({
    width: "100%",
    height: 56,
    label: content.goAction.label,
    labelFontSize: 20,
    disabled: content.goAction.disabled,
    backgroundColor: content.goAction.disabled ? "#334155" : "#166534",
    onClick: () => options.onGeometryComputerGoRequested?.(content.computerId),
  });
  goButton.userData.xrPaletteItemId = "geometry-computer:go";
  goButton.userData.scenePaletteItemId = "geometry-computer:go";

  panel.add(presetGrid, goButton);
  return panel;
}

// Draw the current (white) and target (green) deformation parallelograms into a 900x280 pixel box. Lines are made of small dot Containers because uikit has no line primitive. Original meter-space lattice points are stored in userData for inspection.
function createWorldDeformationDiagram(
  content: Extract<PaletteDefinition["content"], { readonly kind: "geometry-computer-actions" }>,
): Container {
  const diagramWidthPixels = 900;
  const diagramHeightPixels = 280;
  const fitted = fitParallelogramDiagramPoints(
    diagramWidthPixels,
    diagramHeightPixels,
    [
      createDiagramLatticePoints(content.widthMeters, content.current.aMeters, content.current.bMeters),
      createDiagramLatticePoints(content.widthMeters, content.target.aMeters, content.target.bMeters),
    ],
  );
  const current = fitted[0] ?? [];
  const target = fitted[1] ?? [];
  const diagram = new Container({
    width: "100%",
    height: diagramHeightPixels,
    positionType: "relative",
    borderRadius: 14,
    backgroundColor: "#0a1114",
    borderColor,
    borderWidth: 2,
    overflow: "hidden",
    flexShrink: 0,
    renderOrder: 1002,
  });

  addParallelogramLines(diagram, current, "#f8fafc", "current", 1004, 7);
  addParallelogramLines(diagram, target, "#34d399", "target", 1008, 4);
  diagram.add(createDiagramPoint(current[0], "#f8fafc"));
  diagram.add(createDiagramLabel(`(0,0)`, clampDiagramLabelX(current[0].x - 12, diagramWidthPixels), current[0].y + 10, "#f8fafc"));
  diagram.add(createDiagramLabel(
    `(X,0)=(${content.widthMeters},0)`,
    clampDiagramLabelX(current[1].x - 76, diagramWidthPixels),
    current[1].y + 10,
    "#d9edf1",
  ));
  diagram.add(createDiagramLabel(
    `A+X,B=(${content.target.aMeters + content.widthMeters},${content.target.bMeters})`,
    clampDiagramLabelX(target[2].x + 8, diagramWidthPixels),
    Math.max(70, target[2].y - 24),
    "#34d399",
  ));

  diagram.userData.scenePaletteIconSrc = "world-deformation-parallelogram";
  diagram.userData.xrPaletteItemId = "geometry-computer:diagram";
  diagram.userData.scenePaletteItemId = "geometry-computer:diagram";
  diagram.userData.scenePaletteDiagramWorldPoints = {
    current: createDiagramLatticePoints(content.widthMeters, content.current.aMeters, content.current.bMeters),
    target: createDiagramLatticePoints(content.widthMeters, content.target.aMeters, content.target.bMeters),
  };
  return diagram;
}

// Four corners of the parallelogram in world meters: (0,0), (X,0), (X+a,b), (a,b).
function createDiagramLatticePoints(
  widthMeters: number,
  aMeters: number,
  bMeters: number,
): readonly DiagramPoint[] {
  return [
    { x: 0, y: 0 },
    { x: widthMeters, y: 0 },
    { x: widthMeters + aMeters, y: bMeters },
    { x: aMeters, y: bMeters },
  ];
}

// Uniformly scale and center all shapes into the diagram box minus padding, flipping y (world up becomes pixel down). Degenerate extents are treated as at least 1 m.
function fitParallelogramDiagramPoints(
  diagramWidthPixels: number,
  diagramHeightPixels: number,
  shapes: readonly (readonly DiagramPoint[])[],
): readonly (readonly DiagramPoint[])[] {
  const allPoints = shapes.flat();
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const paddingLeft = 128;
  const paddingRight = 42;
  const paddingTop = 76;
  const paddingBottom = 58;
  const worldWidth = Math.max(maxX - minX, 1);
  const worldHeight = Math.max(maxY - minY, 1);
  const scale = Math.min(
    (diagramWidthPixels - paddingLeft - paddingRight) / worldWidth,
    (diagramHeightPixels - paddingTop - paddingBottom) / worldHeight,
  );
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  const originX = (diagramWidthPixels - drawnWidth) / 2 - minX * scale;
  const originY = (diagramHeightPixels + drawnHeight) / 2 + minY * scale;

  return shapes.map((shape) => shape.map((point) => ({
    x: originX + point.x * scale,
    y: originY - point.y * scale,
  })));
}

// Keep a label's left edge inside the diagram so it does not run off the right side.
function clampDiagramLabelX(x: number, diagramWidthPixels: number): number {
  return Math.max(12, Math.min(diagramWidthPixels - 260, x));
}

// 2D point in diagram pixels (or meters before fitting).
interface DiagramPoint {
  readonly x: number;
  readonly y: number;
}

// Draw the four edges; the first dot of each edge carries an item id and its segment endpoints in userData.
function addParallelogramLines(
  parent: Container,
  points: readonly DiagramPoint[],
  color: string,
  labelPrefix: string,
  renderOrder: number,
  thicknessPixels: number,
): void {
  for (const [index, [start, end]] of [
    [points[0], points[1]],
    [points[1], points[2]],
    [points[2], points[3]],
    [points[3], points[0]],
  ].entries()) {
    const dots = createDiagramSegmentDots(start, end, color, renderOrder, thicknessPixels);
    for (let dotIndex = 0; dotIndex < dots.length; dotIndex += 1) {
      const dot = dots[dotIndex];
      if (dotIndex === 0) {
        dot.userData.scenePaletteItemId = `geometry-computer:diagram:${labelPrefix}:edge:${index}`;
        dot.userData.scenePaletteDiagramSegment = { start, end };
      }
      parent.add(dot);
    }
  }
}

// Sample the segment with dots spaced at about 0.75 of the line thickness, at least 2 pixels apart.
function createDiagramSegmentDots(
  start: DiagramPoint,
  end: DiagramPoint,
  color: string,
  renderOrder: number,
  thicknessPixels: number,
): readonly Container[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const stepCount = Math.max(1, Math.ceil(length / Math.max(2, thicknessPixels * 0.75)));
  const dots: Container[] = [];

  for (let index = 0; index <= stepCount; index += 1) {
    const t = index / stepCount;
    const x = start.x + dx * t;
    const y = start.y + dy * t;
    dots.push(new Container({
      width: thicknessPixels,
      height: thicknessPixels,
      positionType: "absolute",
      positionLeft: x - thicknessPixels / 2,
      positionTop: y - thicknessPixels / 2,
      borderRadius: 999,
      backgroundColor: color,
      zIndexOffset: renderOrder,
      renderOrder,
      depthTest: false,
      depthWrite: false,
    }));
  }

  return dots;
}

// Filled 12 pixel marker centered on point.
function createDiagramPoint(point: DiagramPoint, color: string): Container {
  return new Container({
    width: 12,
    height: 12,
    positionType: "absolute",
    positionLeft: point.x - 6,
    positionTop: point.y - 6,
    borderRadius: 999,
    backgroundColor: color,
    renderOrder: 1005,
    depthTest: false,
    depthWrite: false,
  });
}

// Absolutely positioned text label; left/top are in diagram pixels.
function createDiagramLabel(text: string, x: number, y: number, color: string): Text {
  return new Text({
    text,
    positionType: "absolute",
    positionLeft: x,
    positionTop: y,
    fontSize: 15,
    fontWeight: "bold",
    color,
    fill: color,
    wordBreak: "keep-all",
    renderOrder: 1005,
    depthTest: false,
    depthWrite: false,
  });
}

// Help hub page: title, body text and one button per option, dispatching to the tutorial or goal callback.
function buildQuestionHelpContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "question-help" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 300,
    flexDirection: "column",
    gap: 16,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(new Text({
    text: "Help hub",
    fontSize: 34,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  panel.add(new Text({
    text: content.body,
    fontSize: 20,
    fontWeight: "medium",
    lineHeight: "140%",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));

  const optionRows = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 10,
  });
  for (const entry of content.options) {
    const button = createInteractiveSurface({
      width: "100%",
      height: 58,
      label: entry.label,
      labelFontSize: 20,
      disabled: entry.disabled,
      backgroundColor: entry.disabled ? "#334155" : actionColor,
      onClick: () => {
        if (entry.id === "tutorial") {
          options.onQuestionHelpTutorialRequested?.();
        } else {
          options.onQuestionHelpGoalRequested?.();
        }
      },
    });
    button.userData.xrPaletteItemId = `question-help:${entry.id}`;
    button.userData.scenePaletteItemId = `question-help:${entry.id}`;
    optionRows.add(button);
  }

  panel.add(optionRows);
  return panel;
}

// Tutorial or goal page: title, body, and previous / page label / next controls; disabled arrows are inert.
function buildPagedHelpContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "tutorial" | "goal" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 382,
    flexDirection: "column",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(new Text({
    text: content.title,
    fontSize: 34,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 0,
    wordBreak: "break-word",
  }));
  panel.add(new Text({
    text: content.body,
    fontSize: 22,
    fontWeight: "medium",
    lineHeight: "140%",
    color: textColor,
    fill: textColor,
    flexGrow: 1,
    flexShrink: 1,
    wordBreak: "break-word",
  }));

  const controls = new Container({
    width: "100%",
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  });
  const previousButton = createInteractiveSurface({
    width: 72,
    height: 46,
    label: "",
    disabled: content.previousAction.disabled,
    backgroundColor: content.previousAction.disabled ? "#334155" : actionColor,
    onClick: () => {
      if (content.kind === "tutorial") {
        options.onTutorialPreviousRequested?.();
      } else {
        options.onGoalPreviousRequested?.();
      }
    },
  });
  previousButton.userData.xrPaletteItemId = `${content.kind}:previous`;
  previousButton.userData.scenePaletteItemId = `${content.kind}:previous`;
  previousButton.add(new ChevronLeft({
    width: 28,
    height: 28,
    color: textColor,
    fill: textColor,
  }));

  const pageLabel = new Text({
    text: content.pageLabel,
    fontSize: 18,
    fontWeight: "bold",
    color: mutedTextColor,
    fill: mutedTextColor,
    flexShrink: 0,
  });

  const nextButton = createInteractiveSurface({
    width: 72,
    height: 46,
    label: "",
    disabled: content.nextAction.disabled,
    backgroundColor: content.nextAction.disabled ? "#334155" : actionColor,
    onClick: () => {
      if (content.kind === "tutorial") {
        options.onTutorialNextRequested?.();
      } else {
        options.onGoalNextRequested?.();
      }
    },
  });
  nextButton.userData.xrPaletteItemId = `${content.kind}:next`;
  nextButton.userData.scenePaletteItemId = `${content.kind}:next`;
  nextButton.add(new ChevronRight({
    width: 28,
    height: 28,
    color: textColor,
    fill: textColor,
  }));

  controls.add(previousButton, pageLabel, nextButton);
  panel.add(controls);
  return panel;
}

// Sign type chooser: one tile per flag type option.
function buildPlaceSignOptionsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "place-flag-options" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 300,
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });
  panel.add(createSectionLabel("Sign type"));

  const grid = new Container({
    width: "100%",
    flexDirection: "row",
    gap: 12,
  });
  for (const option of content.flagTypeOptions) {
    const tile = createInteractiveSurface({
      width: "49%",
      height: 150,
      label: "",
      labelFontSize: 17,
      flexDirection: "column",
      backgroundColor: option.id === content.selectedFlagType ? activeColor : inactiveColor,
      onClick: () => options.onPlaceFlagTypeSelected?.(option.id as PlacedFlagType),
    });
    const signType = option.id as PlacedFlagType;
    tile.userData.xrPaletteItemId = `sign-type:${option.id}`;
    tile.userData.scenePaletteItemId = `sign-type:${option.id}`;
    tile.add(createSignImage(signType, 92), createButtonText(signTypeLabels[signType], 15));
    grid.add(tile);
  }

  panel.add(grid);
  return panel;
}

// Sign editor: text preview, four key rows from signKeyboardRows, and an Enter / Space / Backspace row.
function buildEditSignContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "edit-sign" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const panel = new Container({
    width: "100%",
    minHeight: 382,
    flexDirection: "column",
    gap: 10,
    padding: 14,
    borderRadius: 24,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 2,
  });

  const preview = new Container({
    width: "100%",
    height: 96,
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "#020617",
    borderColor,
    borderWidth: 1,
  });
  preview.add(
    createSectionLabel(`Sign text ${content.message.length}/${content.maxLength}`),
    createSignPreviewLines(content.message),
  );
  panel.add(preview);

  for (const row of signKeyboardRows) {
    panel.add(createKeyboardRow(row, options));
  }

  const backspaceRow = new Container({
    width: "100%",
    height: 42,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  });
  const enter = createInteractiveSurface({
    width: 132,
    height: 42,
    label: "Enter",
    labelFontSize: 15,
    backgroundColor: actionColor,
    onClick: () => options.onSignKeyboardCharacter?.("\n"),
  });
  enter.userData.xrPaletteItemId = "sign-key:Enter";
  enter.userData.scenePaletteItemId = "sign-key:Enter";
  const space = createInteractiveSurface({
    width: 156,
    height: 42,
    label: "Space",
    labelFontSize: 15,
    backgroundColor: inactiveColor,
    onClick: () => options.onSignKeyboardCharacter?.(" "),
  });
  space.userData.xrPaletteItemId = "sign-key:Space";
  space.userData.scenePaletteItemId = "sign-key:Space";
  const backspace = createInteractiveSurface({
    width: 156,
    height: 42,
    label: "Backspace",
    labelFontSize: 15,
    backgroundColor: "#991b1b",
    onClick: () => options.onSignKeyboardBackspace?.(),
  });
  backspace.userData.xrPaletteItemId = "sign-key:Backspace";
  backspace.userData.scenePaletteItemId = "sign-key:Backspace";
  backspaceRow.add(enter, space, backspace);
  panel.add(backspaceRow);

  return panel;
}

// Show the last three lines of the message with a "|" caret on the final line; the cursor is always at the end of the text.
function createSignPreviewLines(message: string): Container {
  const allLines = message.split("\n");
  const cursorLineIndex = allLines.length - 1;
  const firstVisibleLine = Math.max(0, cursorLineIndex - 2);
  const lines = allLines.slice(firstVisibleLine, firstVisibleLine + 3);
  while (lines.length < 3) {
    lines.push("");
  }

  const block = new Container({
    width: "100%",
    height: 62,
    flexDirection: "column",
    justifyContent: "center",
    gap: 2,
  });

  for (let index = 0; index < 3; index += 1) {
    const sourceLineIndex = firstVisibleLine + index;
    const line = lines[index] ?? "";
    const displayLine = sourceLineIndex === cursorLineIndex ? `${line}|` : line;
    const text = new Text({
      text: displayLine || " ",
      fontSize: 18,
      fontWeight: "bold",
      color: textColor,
      fill: textColor,
      flexShrink: 1,
      wordBreak: "break-word",
    });
    text.userData.scenePaletteSignPreviewLine = index;
    text.userData.scenePaletteSignPreviewText = displayLine;
    block.add(text);
  }

  return block;
}

// One row of single-character key buttons.
function createKeyboardRow(
  keys: readonly string[],
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const row = new Container({
    width: "100%",
    height: 38,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  });

  for (const key of keys) {
    const button = createInteractiveSurface({
      width: 48,
      height: 38,
      label: key,
      labelFontSize: 16,
      backgroundColor: inactiveColor,
      onClick: () => options.onSignKeyboardCharacter?.(key),
    });
    button.userData.xrPaletteItemId = `sign-key:${key}`;
    button.userData.scenePaletteItemId = `sign-key:${key}`;
    row.add(button);
  }

  return row;
}

// Tool tile button with icon and label; the place-flag tile also gets a small options button.
function createToolTile(
  toolId: RuntimeToolId,
  label: string,
  selectedTool: RuntimeToolId,
  options: VrPaletteLibraryAdapterOptions,
  signType?: PlacedFlagType,
): Container {
  const selected = toolId === selectedTool;
  const button = createInteractiveSurface({
    width: "23%",
    height: 150,
    label: "",
    labelFontSize: 18,
    positionType: "relative",
    flexDirection: "column",
    backgroundColor: selected ? activeColor : inactiveColor,
    onClick: () => options.onToolSelected?.(toolId),
  });
  button.userData.xrPaletteItemId = `tool:${toolId}`;
  button.userData.scenePaletteItemId = `tool:${toolId}`;
  button.add(createToolIcon(toolId, signType), createButtonText(label, 16));
  if (toolId === "place-flag") {
    button.add(createSignOptionsButton(options));
  }
  return button;
}

// Icon for a tool id; unknown ids get an invisible 64x64 placeholder.
function createToolIcon(
  toolId: RuntimeToolId,
  signType: PlacedFlagType | undefined,
): Component<any> {
  if (toolId === "place-flag") {
    return createSignIcon(signType ?? "WoodenSign1");
  }

  if (toolId === "geodesic-cannon") {
    return createRayIcon();
  }

  if (toolId === "protractor") {
    return createProtractorIcon();
  }

  if (toolId === "measure-length") {
    return createMeasureLengthIcon();
  }

  return new Container({ width: 64, height: 64, opacity: 0 });
}

// Icon helpers: each wraps an Image and records its source in userData.scenePaletteIconSrc for inspection.
function createMeasureLengthIcon(): Component<any> {
  const image = new Image({
    src: measureLengthToolIconSource,
    width: 88,
    height: 88,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = measureLengthToolIconSource;
  return image;
}

function createRayIcon(): Component<any> {
  const image = new Image({
    src: rayToolIconSource,
    width: 88,
    height: 88,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = rayToolIconSource;
  return image;
}

function createProtractorIcon(): Component<any> {
  const image = new Image({
    src: protractorToolIconSource,
    width: 88,
    height: 88,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = protractorToolIconSource;
  return image;
}

function createGeodesicCannonActionIcon(actionId: "add-geodesic" | "aim" | "carry"): Component<any> {
  if (actionId === "add-geodesic") {
    return createPlusIcon();
  }

  const source = actionId === "carry"
    ? carryIconSource
    : aimIconSource;
  const image = new Image({
    src: source,
    width: 28,
    height: 28,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = source;
  return image;
}

function createPlusIcon(): Component<any> {
  const text = new Text({
    text: "+",
    fontSize: 34,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
  });
  text.userData.scenePaletteIconSrc = "plus";
  return text;
}

function createUnlinkIcon(): Component<any> {
  const image = new Image({
    src: unlinkIconSource,
    width: 24,
    height: 24,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = unlinkIconSource;
  return image;
}

// Composite emitter-line-lock-line-emitter glyph shown in place of Aim for locked geodesics.
function createLockedGeodesicSegmentStatus(): Container {
  const status = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 168,
    height: 28,
  });

  status.add(
    createLockedGeodesicSegmentEmitter(),
    createLockedGeodesicSegmentLine(),
    createLockIcon(),
    createLockedGeodesicSegmentLine(),
    createLockedGeodesicSegmentEmitter(),
  );
  return status;
}

function createLockedGeodesicSegmentEmitter(): Container {
  return new Container({
    width: 4,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
  });
}

function createLockedGeodesicSegmentLine(): Container {
  return new Container({
    width: 50,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
  });
}

function createLockIcon(): Component<any> {
  const image = new Image({
    src: lockIconSource,
    width: 22,
    height: 22,
    marginLeft: 8,
    marginRight: 8,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = lockIconSource;
  return image;
}

function createSignIcon(signType: PlacedFlagType): Container {
  const icon = new Container({
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
  });
  icon.add(createSignImage(signType, 82));
  return icon;
}

// "..." button pinned to the tile's top right corner (absolute position, above the tile via zIndexOffset).
function createSignOptionsButton(options: VrPaletteLibraryAdapterOptions): Container {
  const optionsButton = createInteractiveSurface({
    width: 34,
    height: 24,
    label: "...",
    labelFontSize: 13,
    positionType: "absolute",
    positionTop: 8,
    positionRight: 8,
    zIndexOffset: 8,
    backgroundColor: "#0f172a",
    onClick: () => options.onPlaceFlagOptionsRequested?.(),
  });
  optionsButton.userData.xrPaletteItemId = "tool-options:place-sign";
  optionsButton.userData.scenePaletteItemId = "tool-options:place-sign";
  return optionsButton;
}

function createSignImage(signType: PlacedFlagType, size: number): Component<any> {
  const image = new Image({
    src: signIconSources[signType],
    width: size,
    height: size,
    objectFit: "fill",
    keepAspectRatio: true,
    depthTest: false,
    depthWrite: false,
    renderOrder: 1002,
  });
  image.userData.scenePaletteIconSrc = signIconSources[signType];
  return image;
}

// Debug settings page: log level, overlay toggles (items only when the overlay is on), portal options, wireframes, aim outlines and an optional copy-URL button.
function buildDebugSettingsContent(
  content: Extract<PaletteDefinition["content"], { readonly kind: "debug-settings" }>,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const settings = createSettingsScrollContainer();

  const debugSection = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: sectionColor,
    borderColor,
    borderWidth: 1,
    flexShrink: 0,
  });
  debugSection.add(createSectionLabel("Debug"));
    debugSection.add(createChoiceSection(
      "Console log level",
      content.consoleLogLevelOptions,
      content.consoleLogLevel,
      (id) => options.onConsoleLogLevelSelected(id as RuntimeMenuConsoleLogLevelId),
      "console-log-level",
    ));
    debugSection.add(createToggleRow("UI overlay", content.debugOverlayEnabled, (enabled) => {
      options.onDebugOverlayToggled(enabled);
    }, "debug-overlay-toggle"));

    if (content.debugOverlayEnabled) {
      for (const item of content.debugOverlayItems) {
        debugSection.add(createToggleRow(item.label, item.checked, (enabled) => {
          options.onDebugOverlayItemToggled(item.id, enabled);
        }, `debug-overlay-item:${item.id}`));
      }
    }

    debugSection.add(createChoiceSection(
      "Portal labels",
      content.portalPanelModeOptions,
      content.portalPanelMode,
      (id) => options.onPortalPanelModeSelected(id as PortalPanelModeId),
      "portal-labels",
    ));
    debugSection.add(createToggleRow("Portal inspection tools", content.portalInspectionEnabled, (enabled) => {
      options.onPortalInspectionToggled(enabled);
    }, "portal-inspection-toggle"));
    debugSection.add(createToggleRow(
      "Collision geometry wireframes",
      content.collisionGeometryWireframesEnabled,
      (enabled) => {
        options.onCollisionGeometryWireframesToggled(enabled);
      },
      "collision-geometry-wireframes-toggle",
    ));
    debugSection.add(createToggleRow(
      "Aim collision outlines",
      content.aimCollisionOutlinesEnabled,
      (enabled) => {
        options.onAimCollisionOutlinesToggled(enabled);
      },
      "aim-collision-outlines-toggle",
    ));
    if (options.onCopyUrlWithOptionsRequested) {
      debugSection.add(createActionButton(
        "Copy URL with options",
        "copy-url-with-options",
        options.onCopyUrlWithOptionsRequested,
      ));
    }

  settings.add(debugSection);
  return settings;
}

// Fixed 400 pixel tall scrolling column with a styled scrollbar.
function createSettingsScrollContainer(): Container {
  return new Container({
    width: "100%",
    flexDirection: "column",
    gap: 10,
    height: 400,
    overflow: "scroll",
    paddingRight: 24,
    scrollbarWidth: 14,
    scrollbarColor,
    scrollbarBorderColor,
    scrollbarBorderWidth: 2,
    scrollbarBorderRadius: 7,
    scrollbarZIndex: 1004,
  });
}

// Debug tools row: label, a "..." button to the debug settings page when enabled, and the on/off toggle.
function createDebugToolsRow(
  debugEnabled: boolean,
  options: VrPaletteLibraryAdapterOptions,
): Container {
  const row = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  });
  row.add(createSectionLabel("Debug tools"));

  const actions = new Container({
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexShrink: 0,
  });
  if (debugEnabled) {
    actions.add(createActionButton("...", "debug-settings", options.onDebugSettingsRequested, { width: 56 }));
  }
  actions.add(createToggleButton(debugEnabled, (enabled) => {
    options.onDebugEnabledChanged(enabled);
  }, "debug-tools-toggle"));

  row.add(actions);
  return row;
}

function createSectionLabel(text: string): Text {
  return new Text({
    text,
    fontSize: 16,
    fontWeight: "medium",
    color: mutedTextColor,
    fill: mutedTextColor,
    flexShrink: 1,
    wordBreak: "break-word",
  });
}

// Labelled single-choice option grid.
function createChoiceSection(
  label: string,
  options: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  onSelected: (id: string) => void,
  itemPrefix: string,
): Container {
  const section = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 8,
  });
  section.add(createSectionLabel(label));
  section.add(createOptionGrid(options, selectedId, itemPrefix, onSelected));
  return section;
}

// Two-column grid of option buttons; the selected one is highlighted. Item ids are "<prefix>:<option id>".
function createOptionGrid(
  options: readonly { readonly id: string; readonly label: string }[],
  selectedId: string,
  itemPrefix: string,
  onSelected: (id: string) => void,
): Container {
  const grid = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 6,
  });

  for (let index = 0; index < options.length; index += 2) {
    const row = new Container({
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
    });

    for (const option of options.slice(index, index + 2)) {
      const button = createInteractiveSurface({
        width: "49%",
        height: 34,
        justifyContent: "flex-start",
        paddingLeft: 12,
        backgroundColor: option.id === selectedId ? activeColor : "#1f2937",
        label: option.label,
        labelFontSize: 15,
        onClick: () => onSelected(option.id),
      });
      button.userData.xrPaletteItemId = `${itemPrefix}:${option.id}`;
      button.userData.scenePaletteItemId = `${itemPrefix}:${option.id}`;
      row.add(button);
    }

    grid.add(row);
  }

  return grid;
}

// Label plus On/Off toggle.
function createToggleRow(
  label: string,
  enabled: boolean,
  onToggled: (enabled: boolean) => void,
  itemId: string,
): Container {
  const row = new Container({
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  });
  row.add(createSectionLabel(label));
  row.add(createToggleButton(enabled, onToggled, itemId));
  return row;
}

// On/Off button; clicking calls onToggled with the inverted value of the state captured at build time (state is not read back).
function createToggleButton(
  enabled: boolean,
  onToggled: (enabled: boolean) => void,
  itemId: string,
): Container {
  const button = createInteractiveSurface({
    width: 96,
    height: 34,
    label: enabled ? "On" : "Off",
    labelFontSize: 15,
    onClick: () => onToggled(!enabled),
    backgroundColor: enabled ? activeColor : inactiveColor,
  });
  button.userData.xrPaletteItemId = itemId;
  button.userData.scenePaletteItemId = itemId;
  return button;
}

// Generic labelled action button with an optional home/reload icon.
function createActionButton(
  label: string,
  itemId: string,
  onClick: () => void,
  options: {
    readonly icon?: "home" | "reload";
    readonly width?: number;
    readonly backgroundColor?: string;
  } = {},
): Container {
  const button = createInteractiveSurface({
    width: options.width ?? 112,
    height: 36,
    backgroundColor: options.backgroundColor ?? actionColor,
    label,
    labelFontSize: 15,
    onClick,
  });
  button.userData.xrPaletteItemId = itemId;
  button.userData.scenePaletteItemId = itemId;
  if (options.icon === "home") {
    button.add(new House({
      width: 20,
      height: 20,
      color: textColor,
      fill: textColor,
    }));
  } else if (options.icon === "reload") {
    button.add(new RotateCw({
      width: 20,
      height: 20,
      color: textColor,
      fill: textColor,
    }));
  }
  return button;
}

// Square icon button for contextual header actions; disabled ones are dimmed and inert.
function createHeaderActionButton(
  itemId: string,
  label: string,
  onClick: () => void,
  options: {
    readonly icon: "add-geodesic" | "carry" | "tie-and-detach" | "trash";
    readonly disabled?: boolean;
    readonly width?: number;
    readonly backgroundColor?: string;
  },
): Container {
  const button = createInteractiveSurface({
    width: options.width ?? 52,
    height: 44,
    label,
    labelFontSize: 13,
    onClick,
    disabled: options.disabled,
    backgroundColor: options.disabled ? "#334155" : (options.backgroundColor ?? actionColor),
  });
  button.userData.xrPaletteItemId = itemId;
  button.userData.scenePaletteItemId = itemId;
  if (options.icon === "trash") {
    button.add(new Trash2({
      width: 22,
      height: 22,
      color: textColor,
      fill: textColor,
    }));
  } else if (options.icon === "tie-and-detach") {
    button.add(createUnlinkIcon());
  } else {
    button.add(createGeodesicCannonActionIcon(options.icon));
  }
  return button;
}

// Base clickable Container. The click callback is stored in userData.scenePaletteAction / xrPaletteAction, not on uikit events; disabled buttons store no action and set pointerEvents "none" so rays pass through them.
function createInteractiveSurface(options: {
  readonly width: number | `${number}%` | `${number}px` | "auto";
  readonly height: number;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly flexDirection?: "row" | "column";
  readonly positionType?: "static" | "relative" | "absolute";
  readonly positionTop?: number;
  readonly positionRight?: number;
  readonly positionBottom?: number;
  readonly zIndexOffset?: number;
  readonly justifyContent?: "center" | "flex-start";
  readonly paddingLeft?: number;
  readonly backgroundColor: string;
  readonly labelFontSize?: number;
}): Container {
  const button = new Container({
    width: options.width,
    height: options.height,
    positionType: options.positionType,
    positionTop: options.positionTop,
    positionRight: options.positionRight,
    positionBottom: options.positionBottom,
    zIndexOffset: options.zIndexOffset,
    borderRadius: 12,
    flexDirection: options.flexDirection ?? "row",
    gap: options.label ? 8 : 10,
    alignItems: "center",
    justifyContent: options.justifyContent ?? "center",
    paddingLeft: options.paddingLeft ?? 0,
    backgroundColor: options.backgroundColor,
    borderColor: "#93c5fd",
    borderWidth: 1,
    opacity: options.disabled ? 0.45 : 1,
    pointerEvents: options.disabled ? "none" : "auto",
    renderOrder: 1001,
    depthTest: false,
    depthWrite: false,
  });
  button.userData.xrPaletteAction = options.disabled ? undefined : options.onClick;
  button.userData.scenePaletteAction = options.disabled ? undefined : options.onClick;
  if (options.label) {
    button.add(createButtonText(options.label, options.labelFontSize ?? 15));
  }
  return button;
}

// Bold label text that wraps and may shrink.
function createButtonText(text: string, fontSize: number): Text {
  return new Text({
    text,
    fontSize,
    fontWeight: "bold",
    color: textColor,
    fill: textColor,
    flexShrink: 1,
    wordBreak: "break-word",
  });
}

// Lucide icon for a header action id; "none" has no icon.
function createHeaderIcon(
  actionId: PaletteDefinition["leftAction"]["id"],
): InstanceType<typeof Settings> | InstanceType<typeof X> | InstanceType<typeof ArrowLeft> | undefined {
  const iconProperties = {
    width: 28,
    height: 28,
    color: textColor,
    fill: textColor,
  };

  switch (actionId) {
    case "settings":
      return new Settings(iconProperties);
    case "close":
      return new X(iconProperties);
    case "back":
      return new ArrowLeft(iconProperties);
    case "none":
      return undefined;
  }
}

// Dispose each top-level child tree.
function disposeRenderedChildren(children: readonly Container[]): void {
  for (const child of children) {
    disposeComponentTree(child);
  }
}

// Dispose children depth-first, then the component itself.
function disposeComponentTree(component: Component<any>): void {
  for (const child of [...component.children]) {
    if (child instanceof Component) {
      disposeComponentTree(child);
    }
  }
  component.dispose();
}
