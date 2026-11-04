/**
 * Application shell: builds the Three.js scene, owns the shared mutable state (player pose, menu state,
 * visible-portal results, tool state) and runs the frame loop.
 *
 * Behavior that does not need to live in that shared closure is split into sibling modules:
 * - `create*(deps)` factories (`aimInteraction`, `geodesicCannonTools`, `toolObjectRuntimes`,
 *   `geometryComputerMenu`, `debugVisualization`, `geodesicDebugDumps`, `portalDebugRuntime`, ...) receive
 *   their inputs through an explicit `deps` object. Mutable shell state is exposed as getters/setters, so a
 *   factory never captures a stale value.
 * - Plain modules (`runtimeSceneUtils`, `frameDiagnostics`, `rootAimRay`, `appDebugHelpers`, ...) hold pure
 *   helpers and types.
 *
 * Factories are created once, before the first `rebuildCellMeshes()` call, in dependency order.
 *
 * ## Frame loop (`renderFrame`, driven by `renderer.setAnimationLoop`)
 * One call per animation frame, on the main thread, with no re-entrancy. In order:
 * 0. Bookkeeping: `clock.getDelta()` gives `deltaSeconds`; a finished background geometry deformation is
 *    committed first (`geometryCommit.commitReady` -> `geometryCommit.commit`), so the rest of the
 *    frame sees one consistent world.
 * 1. Input: `getXrInputFrame` or `getDesktopInputFrame` consume one `RuntimeInputFrame` (XR is used only when
 *    `renderer.xr.isPresenting` and the session state is `active`).
 * 2. Movement: `movePlayer` against `activeWorld()` (global coordinate frame), then
 *    `bodiesInCell`; in XR a second `movePlayer` applies physical head motion
 *    (room-scale walking). The result replaces `playerPose` and may change `playerPose.cellId` by crossing a
 *    portal. Then the camera/XR rig is synced to the pose, the aim ray is resolved, and the selected tool
 *    handles the primary/carry/interact actions. Creatures, flags and curve-shortening geodesics advance.
 * 3. Portal visibility: `updateVisibleCell` shows only the player's cell mesh, the culling cameras are placed
 *    (one per eye in stereo XR), and `computeVisiblePortalPaths` (inside `syncPortalInstances`)
 *    selects visible portal paths from the static per-root cull tables.
 *    The portal pass builds one `FrameRenderSnapshot` (rendered root cell, visible paths, clip rows, viewer
 *    positions) and stores it as `latestFrameSnapshot`.
 * 4. Instance sync: visible paths become per-cell instanced-mesh transforms and clip-plane data
 *    (`updateCellRenderArchetypeInstances`, `portalClipData`); runtime objects (and their portal ghosts) are
 *    written exactly once per frame from that snapshot by `runtimeObjectInstanceSync.sync` (also once at setup
 *    and once in `applyDebugSettings`). Tools and menus only request a sync. The selectable-hitbox debug meshes
 *    are rebuilt by `syncSelectableHitboxDebugIfChanged`. UI overlays, labels, tooltips, the scene
 *    palette and debug state are refreshed here too.
 * 5. Render: a single `renderer.render(scene, camera)`; per-frame phase timings are then recorded.
 *
 * Errors: `renderFrame` runs the frame through a `FrameErrorGuard` (`frameErrorGuard.ts`). A throw is reported
 * once per distinct message, the frame is still drawn if it failed before the draw (so a headset keeps a live,
 * head-tracked image), and the loop keeps running. Per-object updates, curve shortening and the UI refresh run as
 * contained phases, so one failing object or tooltip cannot block movement or rendering. After
 * `MAX_CONSECUTIVE_FAILED_FRAMES` failed frames in a row an immersive session is ended.
 *
 * ## State ownership
 * All mutable state lives in the `createThreeApp` closure and is mutated only by it (or through the
 * setter callbacks it hands to the factories above). `playerPose`, `currentMenuState()`, `activeWorldBundle`,
 * `latestVisibleResult`, `latestFrameSnapshot` and the tool states are replaced immutably (never edited in place). `appState`
 * supplies the initial pose, world and player body; after startup the shell's `playerPose` is authoritative
 * and `appState.playerPose` is not written back. `cellMeshes`, the render archetypes and the runtime object
 * registry are owned here and disposed by `dispose()`.
 *
 * ## XR session lifecycle
 * `xrSession.enterVr` (button in its entry overlay) moves the session state available/ended/failed -> entering ->
 * active, or -> failed on error. The session's `end` event moves it to `ended` and resets the rig, palette
 * input and controller models. `requestAppRestart` ends a presenting session first via
 * `xrSession` before invoking the host restart callback.
 *
 * ## Units and frames
 * Distances are meters and angles radians. Cell-local coordinates are x right, y forward, z up; the Three.js
 * scene uses its own axes, converted by `worldAxes` helpers (for example `rigidTransformToThreeMatrix`).
 */
import { createWorldClient } from "./worldClient";
import { createDefaultWorldModules } from "../../runtime/experience";
import { createLocalPlayerParticipant, createWorldEngine, publishLocalPlayerPose, readLocalPlayerPose } from "../../engine/worldEngine";
import * as THREE from "three";
import { reversePainterSortStable } from "@pmndrs/uikit";
import { type AppState } from "../../runtime/appState";
import { type CellComplexSpec } from "../../cell-complex/specs";
import { buildStaticallyCulledPortalPathTables } from "../../cell-complex/staticPortalPathCull";
import { type AppConfig, defaultAppConfig, isRuntimeToolEnabled } from "../../glue/appConfig";
import { type DebugLevelId } from "../../diagnostics/debugLevels";
import { type DebugOptionId, hasActiveDebugOption } from "../../glue/debugOptions";
import { type DebugSettings } from "../../glue/debugSettings";
import { type PortalPanelModeId } from "../../glue/portalPanelMode";
import { type LaunchOptions } from "../../glue/readLaunchOptions";
import { buildStaticAssetRenderRoot } from "./staticAssetRenderRoot";
import { simpleCollisionCylinder } from "../../movement/dynamicObject";
import { movePlayer } from "../../movement/movePlayer";
import { DEFAULT_PLAYER_EYE_HEIGHT_METERS } from "../../movement/playerBody";
import { type PlayerPose, playerPoseToDynamicObject } from "../../movement/playerPose";
import { createClientSession } from "../../runtime/clientSession";
import { applyRuntimeCommand } from "../../runtime/applyRuntimeCommand";
import { type RuntimeCommand } from "../../runtime/runtimeCommands";
import { createDebugSettingsFromRuntimeMenuState, createRuntimeMenuState } from "../../runtime/runtimeMenuState";
import { type RuntimeDebugOverlayItemId } from "../../glue/toolIds";
import {
  createDefaultWorldDeformationFamilyRegistry,
  createInitialWorldDeformationState,
} from "../../runtime/worldGeometryDeformationFamilies";
import { type WorldGeometrySnapshot, createWorldGeometrySession } from "../../runtime/worldGeometrySession";
import { advanceCurveShorteningPairs } from "../../world-objects/geodesic/curveShortening";
import { pruneMissingGeodesicIntersectionObjects } from "../../world-objects/geodesic/intersections";
import { isGeodesicMarmotObjectSpec } from "../../world-objects/geodesicMarmot";
import { type GeodesicMarmotRuntime, createGeodesicMarmotRuntime } from "./creatures/geodesicMarmotView";
import { createRuntimeObjectRegistry, createRuntimeStaticAssetObject } from "../../world-objects/runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState } from "../../world-objects/runtimeObjectBase";
import { isSimpleGeoCreatureObjectSpec } from "../../world-objects/simpleGeoCreature";
import { type SimpleGeoCreatureRuntime, createSimpleGeoCreatureRuntime } from "./creatures/simpleGeoCreatureView";
import { createObjectHost, createPlainWorldObject, type PlainWorldObject } from "../../world-objects/worldObjectOwner";
import { setApiNamespace } from "../../runtime/publicApi";
import { createDesktopToolIndicator } from "../dom/desktopToolIndicator";
import { createFloatingObjectTooltip } from "../dom/floatingObjectTooltip";
import { createAimCrossMarker } from "./aimCrossMarker";
import { createAimFeedback } from "./aimFeedback";
import { createAimInteraction } from "./aimInteraction";
import {
  installGeneralDebugHelpers,
  uninstallGeneralDebugHelpers,
  uninstallGeometryDebugHelpers,
  visibleSummaryToRenderState,
} from "./appDebugHelpers";
import { logDebugStartupGuide } from "./appDebugLogging";
import { installRenderInspectionApi, uninstallRenderInspectionApi } from "./renderInspection";
import { createGeometryCommit } from "./geometryCommit";
import { createDebugOverlay } from "./debugOverlay";
import { createDebugVisualization } from "./debugVisualization";
import { createDesktopControls } from "./desktopControls";
import { createGeometryDebugHelpers } from "./geometryDebugHelpers";
import { createRuntimeEffects } from "./runtimeEffects";
import { createDesktopInputHandlers } from "./desktopInputHandlers";
import { createDesktopScenePaletteInput } from "./desktopScenePaletteInput";
import {
  captureWebGlRenderInfo,
  smoothFramePerformance,
} from "./frameDiagnostics";
import { type FrameRenderSnapshot } from "./frameRenderSnapshot";
import { createGeodesicRuntimeRenderSources } from "./geodesicCannonRenderer";
import { createGeodesicCannonTools } from "./geodesicCannonTools";
import { createPortalFramePass } from "./portalFramePass";
import { createGeodesicDebugDumps } from "./geodesicDebugDumps";
import { createGeodesicEmitterLabelController } from "./geodesicEmitterLabelController";
import { createGeometryComputerMenu } from "./geometryComputerMenu";
import { createRuntimeObjectActions } from "./runtimeObjectActions";
import { createHelpLensRenderer } from "./helpLensRenderer";
import { MeasuredGeodesicLengthRuntime } from "./measureLengthRenderer";
import { PlacedFlagRuntime } from "./placedFlagRenderer";
import { createPlayerRoverRenderModel } from "./playerRoverModel";
import { createPortalClipData } from "./portalClipData";
import {
  createPortalClipDistanceToggle,
  createPortalClipMaterialState,
} from "./portalClipMaterial";
import { createPortalClipPolygonOverlay } from "./portalClipPolygonOverlay";
import { PortalDebugRuntimeDeps, createPortalDebugRuntime } from "./portalDebugRuntime";
import { PreparedWorldAssets } from "./preparedWorldAssets";
import { prerenderCells } from "./prerenderCells";
import { ProtractorAngleRuntime } from "./protractorAngleRenderer";
import { renderCameraFarMeters, renderCameraNearMeters } from "./renderCameraClip";
import {
  getWindowCssCanvasSize,
  renderAntialiasRequested,
  resolveRenderQualityPixelRatio,
} from "./renderQuality";
import {
  FramePerformanceRenderState,
  WebGlRenderInfoState,
} from "./renderState";
import { createFrameErrorGuard } from "./frameErrorGuard";
import { installRuntimeDiagnostics, runtimeDiagnostics } from "../../diagnostics/runtimeDiagnostics";
import { createRuntimeObjectInstanceSync } from "./runtimeObjectInstanceSync";
import {
  RuntimeObjectRenderArchetype,
  buildRuntimeObjectRenderArchetype,
  createRuntimeObjectRenderArchetypeDiagnostics,
  disposeRuntimeObjectRenderArchetypes,
} from "./runtimeObjectRenderArchetypes";
import { RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";
import {
  buildCurrentCellForbiddenZoneWireframes,
  disableFrustumCulling,
  disableShadows,
  disposeCanvasTextures,
  disposeObject3D,
  isGeodesicRuntimeRenderObject,
} from "./runtimeSceneUtils";
import { SCENE_BACKGROUND_COLOR } from "./sceneColors";
import {
  createStylizedSceneLighting,
  disposeStylizedSceneLighting,
  updateStylizedSceneLighting,
} from "./sceneLighting";
import { createScenePaletteController } from "./scenePaletteController";
import { createScenePaletteCommands } from "./scenePaletteCommands";
import { createToolObjectRuntimes } from "./toolObjectRuntimes";
import { createUnderCellInfinityFloor } from "./underCellFloor";
import { VisiblePortalPathOptions, defaultMinPortalScreenAreaPixels } from "../../visibility/visiblePortalPaths";
import {
  VrComfortOptions,
  createVrComfortVignette,
  isArtificialLocomotionActive,
} from "./vrComfort";
import { createXrControllerHandModels } from "./xrControllerHandModels";
import { createXrControls } from "./xrControls";
import { createXrEntryUi } from "./xrEntryUi";
import { createXrSessionController } from "./xrSessionController";
import { createXrObjectTooltipController } from "./xrObjectTooltipController";
import { createXrDebugPanel, isXrDebugPanelVisible } from "./xrDebugPanel";
import {
  createXrPlayerRig,
  headLocalMetersFromViewerPose,
  headYawRadiansFromViewerPose,
} from "./xrPlayerRig";
import { createXrScenePaletteInput } from "./xrScenePaletteInput";

/**
 * Handle returned by {@link createThreeApp} for the running application shell.
 *
 * The animation loop is already running when the handle is returned. The caller must call `dispose()` exactly
 * once when finished; the handle must not be used afterwards.
 */
export interface ThreeApp {
  /** The Three.js scene owned by the shell (Three.js axes; cell content is parented under per-cell groups). */
  readonly scene: THREE.Scene;
  /** The WebGL renderer owned by the shell; its canvas is appended to the container passed to `createThreeApp`. */
  readonly renderer: THREE.WebGLRenderer;
  /**
   * Applies new debug settings without restarting: rebuilds cell meshes and portal debug state, reinstalls
   * debug helpers and renders one extra frame immediately.
   */
  updateDebugSettings(settings: DebugSettings): void;
  /**
   * Stops the animation loop, removes window/canvas listeners, cancels pending restart and reload timers,
   * and disposes scene objects, GPU resources, DOM overlays and the renderer, removing its canvas.
   * It does not end an active XR session itself (the session `end` listener is not removed either).
   */
  dispose(): void;
}

/**
 * Inputs for {@link createThreeApp}: the selected world, launch/debug settings and host callbacks.
 *
 * Fields are read once at construction (debug and comfort values seed mutable shell state); later changes go
 * through `ThreeApp.updateDebugSettings` or the runtime menu. Callbacks are optional and invoked from input
 * handlers or the frame loop; the host typically responds by disposing and recreating the app.
 */
export interface ThreeAppOptions {
  /** Id of the world chosen in the menu, used for display and debug dumps. */
  readonly selectedWorldId: string;
  /** Declarative cell-complex description; the base for geometry deformations. Should match `appState.world`. */
  readonly worldSpec: CellComplexSpec;
  readonly debugLevel: DebugLevelId;
  readonly portalPanelMode: PortalPanelModeId;
  readonly debugOptions: readonly DebugOptionId[];
  readonly debugOverlayEnabled: boolean;
  readonly debugOverlayItems: readonly RuntimeDebugOverlayItemId[];
  /** When true the renderer uses the quality-limited device pixel ratio and smooths portal clip edges. */
  readonly renderQualityEnabled: boolean;
  readonly vrComfortOptions: VrComfortOptions;
  readonly appConfigName: string;
  /** Feature toggles for menu sections and tools; defaults to `defaultAppConfig`. */
  readonly appConfig?: AppConfig;
  /** Preloaded models and textures; must already be loaded (the shell does not fetch). */
  readonly assets: PreparedWorldAssets;
  /** Called with a world id after any active XR session has ended. */
  readonly onWorldChangeRequested?: (worldId: string) => void;
  /** Called with a config name after any active XR session has ended. */
  readonly onAppConfigChangeRequested?: (configName: string) => void;
  /** Called to reload the world after any active XR session has ended. */
  readonly onReloadRequested?: () => void;
  /** Called with the changed launch options whenever menu debug or comfort settings change. */
  readonly onLaunchOptionsChanged?: (patch: Partial<LaunchOptions>) => void;
  readonly onCopyUrlWithOptionsRequested?: () => void;
}

// Time (milliseconds) within which a second reload request counts as confirmation.
const reloadConfirmationWindowMs = 2000;
// Consecutive failed frames (about half a second at 60-90 Hz) before an immersive session is ended.
const MAX_CONSECUTIVE_FAILED_FRAMES = 30;

/**
 * Creates the Three.js application shell inside `container` and starts its animation loop.
 *
 * Side effects: appends a WebGL canvas and several DOM overlays to `container`/`document.body`, registers
 * window listeners, installs debug helpers on `window`, warms up cell shaders with a prerender, and calls
 * `renderer.setAnimationLoop`. Requires a browser with WebGL and a `window`; failures from those APIs
 * propagate as exceptions and no cleanup is performed in that case. `appState.playerPose` is the initial
 * pose (cell-local meters, yaw in radians); the shell keeps its own copy afterwards. WebXR is optional and
 * detected asynchronously. The caller owns the returned handle and must call `dispose()` once.
 */
export function createThreeApp(container: HTMLElement, appState: AppState, options: ThreeAppOptions): ThreeApp {
  const appConfig = options.appConfig ?? defaultAppConfig;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BACKGROUND_COLOR);
  scene.environment = null;
  scene.fog = new THREE.Fog(SCENE_BACKGROUND_COLOR, 12, 85);
  const underCellInfinityFloor = createUnderCellInfinityFloor();
  scene.add(underCellInfinityFloor);

  const initialCanvasSize = getWindowCssCanvasSize(window);
  const camera = new THREE.PerspectiveCamera(
    70,
    initialCanvasSize.width / initialCanvasSize.height,
    renderCameraNearMeters,
    renderCameraFarMeters,
  );
  const portalCullingCamera = camera.clone();
  const portalCullingEyeCameras = [new THREE.Camera(), new THREE.Camera()];

  const pixelRatio = resolveRenderQualityPixelRatio(options.renderQualityEnabled, window.devicePixelRatio);
  const renderer = new THREE.WebGLRenderer({ antialias: renderAntialiasRequested });
  renderer.shadowMap.enabled = false;
  renderer.localClippingEnabled = true;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  renderer.setTransparentSort(reversePainterSortStable);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(initialCanvasSize.width, initialCanvasSize.height);
  container.append(renderer.domElement);
  const controls = createDesktopControls(renderer.domElement);
  const xrControls = createXrControls(options.vrComfortOptions);
  const xrRig = createXrPlayerRig(camera, options.vrComfortOptions);
  scene.add(xrRig.root);
  const vrComfortVignette = createVrComfortVignette(camera, options.vrComfortOptions);
  const clock = new THREE.Clock();
  /** Longest simulation step per frame, in seconds; longer wall-clock gaps (hidden tab, debugger pause) are treated as this long. */
  const maxSimulationStepSeconds = 0.1;
  // The authoritative player pose (cell id, cell-local position in meters, yaw in radians) is the body of the engine's
  // "local" participant. Written only in renderFrame (movement), geometryCommit and the reset/teleport helpers,
  // through publishLocalPlayerPose (direct write D1); factories read it with readLocalPlayerPose(engine).
  // Incremented once per rendered frame; keys the per-frame aim-ray cache.
  let aimFrameSerial = 0;
  // Debug settings mirror: seeded from options, replaced by applyDebugSettings (menu or updateDebugSettings).
  let smoothedFrameRateFps: number | undefined;
  let smoothedFramePerformance: FramePerformanceRenderState | undefined;
  let latestWebGlRenderInfo: WebGlRenderInfoState | undefined;
  // The session: the one record of shell state that commands change (clientSession.ts). The menu state (page,
  // selected tool, debug toggles) is replaced only by applyRuntimeCommand; read it with currentMenuState().
  const session = createClientSession({
    menuState: createRuntimeMenuState({
      selectedWorldId: options.selectedWorldId,
      selectedAppConfigName: options.appConfigName,
      debugSettings: {
        debugLevel: options.debugLevel,
        portalPanelMode: options.portalPanelMode,
        debugOptions: options.debugOptions,
      },
      debugOverlayEnabled: options.debugOverlayEnabled,
      debugOverlayItems: options.debugOverlayItems,
      vrComfortOptions: options.vrComfortOptions,
    }),
    appConfig,
    debugSettings: {
      debugLevel: options.debugLevel,
      portalPanelMode: options.portalPanelMode,
      debugOptions: options.debugOptions,
    },
    vrComfortOptions: options.vrComfortOptions,
    showCellPathRendersInstances: hasActiveDebugOption(
      options.debugLevel,
      options.debugOptions,
      "portal-path-overlay-instances",
    ),
    cannonToolState: {},
    protractorToolState: {},
    moduleToolState: {},
    pendingToolRequest: undefined,
  });
  // The world: the registry of world objects and the engine that owns it (design 013). The shell is a client of the
  // engine: it publishes the player's body, submits commands, steps the world once per frame and reads it back.
  const runtimeObjectRegistry = createRuntimeObjectRegistry();
  const engine = createWorldEngine({
    registry: runtimeObjectRegistry,
    // The active world is replaced by a geometry commit; `activeWorld` exists only after the geometry-commit factory below.
    getWorld: () => activeWorld(),
    participants: [createLocalPlayerParticipant(appState.playerPose)],
    modules: createDefaultWorldModules(),
    isToolEnabled: (toolId) => isRuntimeToolEnabled(appConfig, toolId),
    writeGuard: hasActiveDebugOption(options.debugLevel, options.debugOptions, "module-write-guard"),
  });
  // The tool-switch protocol, the generic event sink and api.world. There is no on-screen message system yet, so
  // the world's sentences go to the console and the diagnostics, always (not only in debug mode).
  const worldClient = createWorldClient({
    engine,
    session,
    dispatch: (command) => dispatchRuntimeCommand(command),
    showMessage(message, detail) {
      console.info(`[noneuclid] ${message}`);
      runtimeDiagnostics().recordDebugEvent(message, detail);
    },
  });
  // Disposal bookkeeping: `disposed` makes dispose() idempotent.
  let disposed = false;
  // Frame error containment (see the module header). `frameDrawn` tells recovery whether the failed frame
  // already reached `renderer.render`.
  const frameErrorGuard = createFrameErrorGuard({
    maxConsecutiveFailures: MAX_CONSECUTIVE_FAILED_FRAMES,
    report: reportFrameError,
    onPersistentFailure: endXrSessionAfterPersistentFrameFailure,
  });
  let frameDrawn = false;
  const debugOverlay = createDebugOverlay(container);
  const desktopToolIndicator = createDesktopToolIndicator(document.body);
  const desktopScenePaletteInput = createDesktopScenePaletteInput();
  const xrScenePaletteInput = createXrScenePaletteInput();
  const xrControllerHandModels = createXrControllerHandModels(scene);
  const objectHost = createObjectHost();
  const aimCrossMarker = createAimCrossMarker(scene);
  const floatingObjectTooltip = createFloatingObjectTooltip(document.body);
  const helpLensRenderer = createHelpLensRenderer(document.body, scene);
  const xrEntryUi = createXrEntryUi(container, () => void xrSession.enterVr());
  const xrSession = createXrSessionController({
    engine,
    entryUi: xrEntryUi,
    navigator,
    secureContext: window.isSecureContext,
    session,
    initialPlayerPose: appState.playerPose,
    xr: renderer.xr,
    xrRig,
    resetAfterSessionEnd() {
      xrRig.reset();
      xrScenePaletteInput.reset();
      xrControllerHandModels.reset();
      scenePaletteController.setVisible(false);
    },
    disposeOnTeardown: [xrRig, xrControls],
    readRenderDebugFields: () => ({
      framePerformance: smoothedFramePerformance,
      webGlRenderInfo: latestWebGlRenderInfo,
      visiblePortalPathCount: portalFrame.latestVisibleResult()?.paths.length,
      visiblePortalPaths: portalFrame.latestVisibleResult()
        ? visibleSummaryToRenderState(portalFrame.latestVisibleResult()!.summary)
        : undefined,
      portalInstances: portalFrame.instanceRenderState(),
      portalEyes: portalFrame.eyeDebugStates(),
      stereoPortalPaths: portalFrame.stereoPathState(),
    }),
  });
  const clipPolygonOverlay = createPortalClipPolygonOverlay(container);
  const sceneLighting = createStylizedSceneLighting(scene);
  const scenePaletteController = createScenePaletteController({
    scene,
    getCamera: () => camera,
    session,
    ...createScenePaletteCommands({ dispatch: dispatchRuntimeCommand, requestTool: (toolId) => worldClient.requestTool(toolId), reloadConfirmationWindowMs }),
  });

  // One Three.js group per cell id (cell-local frame), rebuilt by rebuildCellMeshes. Only the group of the
  // player's cell is visible; runtime objects are parented into these groups via syncParent(cellMeshes).
  const cellMeshes = new Map<string, THREE.Object3D>();
  // Portal path search limits: depth in portal hops, counts of paths, tolerance in meters.
  const rootRenderPathMaxDepth = 10;
  const maxVisiblePaths = 2_000;
  // The one options object of every per-frame visibility call (mono, shared-root stereo, split-root stereo).
  const visiblePortalPathOptions: VisiblePortalPathOptions = {
    maxDepth: rootRenderPathMaxDepth,
    maxVisiblePaths,
    minPortalScreenAreaPixels: defaultMinPortalScreenAreaPixels,
    includeRootCell: true,
    sortMode: "depth-then-area",
  };
  const portalPathOptions = {
    maxDepth: rootRenderPathMaxDepth,
    skipImmediateReverse: true,
    toleranceMeters: 1e-6,
    maxKeptPathsPerRoot: 50_000,
  } as const;
  const deformationFamilyRegistry = createDefaultWorldDeformationFamilyRegistry();
  const initialWorldSnapshot: WorldGeometrySnapshot = {
    version: 0,
    deformation: createInitialWorldDeformationState(options.worldSpec),
    spec: options.worldSpec,
    world: appState.world,
    staticCull: buildStaticallyCulledPortalPathTables(appState.world, portalPathOptions),
    buildStats: {
      requestedAtMs: performance.now(),
      completedAtMs: performance.now(),
      worker: false,
    },
  };
  // Owns background geometry deformation; renderFrame polls it for finished snapshots.
  const geometrySession = createWorldGeometrySession({
    baseSpec: options.worldSpec,
    initialSnapshot: initialWorldSnapshot,
    familyRegistry: deformationFamilyRegistry,
    portalPathOptions,
    stepOptions: {
      maxStepMeters: 0.04,
      snapToleranceMeters: 1e-6,
    },
  });
  // The active world (snapshot plus derived render data) is owned by geometryCommit and replaced only by its commit, at the
  // start of a frame; every other reader goes through activeWorld()/activeStaticCull().
  const geometryCommit = createGeometryCommit({
    initialSnapshot: initialWorldSnapshot,
    maxVisiblePaths,
    familyRegistry: deformationFamilyRegistry,
    geometrySession,
    engine,
    runtimeObjectRegistry,
    objectHost,
    createPlayerCollisionState,
    resetPlayerToHome: () => resetPlayerToHome(),
    removePlacedFlagRuntime: (flagId) => removePlacedFlagRuntime(flagId),
    syncPlacedFlagRuntime: (flag) => syncPlacedFlagRuntime(flag),
    computedObjectCallbacks: {
      removeMeasuredGeodesicLength: (objectId) => removeMeasuredGeodesicLengthRuntime(objectId),
      syncMeasuredGeodesicLength: (object) => syncMeasuredGeodesicLengthRuntime(object),
      removeProtractorAngle: (objectId) => removeProtractorAngleRuntime(objectId),
      syncProtractorAngle: (object) => syncProtractorAngleRuntime(object),
    },
    afterSwap: () => finishGeometryCommit(),
  });
  const activeWorld = () => geometryCommit.active().snapshot.world;
  const activeStaticCull = () => geometryCommit.active().snapshot.staticCull;

  const dynamicObjectRuntimes: Array<GeodesicMarmotRuntime | SimpleGeoCreatureRuntime> = [];
  const staticAssetOwners: PlainWorldObject[] = [];
  const placedFlagRuntimes = new Map<string, PlacedFlagRuntime>();
  const measuredGeodesicLengthRuntimes = new Map<string, MeasuredGeodesicLengthRuntime>();
  const protractorAngleRuntimes = new Map<string, ProtractorAngleRuntime>();
  const runtimeObjectRenderRoot = new THREE.Group();
  runtimeObjectRenderRoot.name = "runtime-object-archetype-renders";
  scene.add(runtimeObjectRenderRoot);
  const runtimeObjectRootsById = new Map<string, THREE.Object3D>();
  const runtimeObjectRenderSourcesByKey = new Map<string, RuntimeObjectRenderSourceMesh>();
  const runtimeObjectRenderArchetypesByKey = new Map<string, RuntimeObjectRenderArchetype>();
  const staticObjectCollisionWireframeGroupsByCellId = new Map<string, THREE.Group>();
  const selectableHitboxDebugGroupsByCellId = new Map<string, THREE.Group>();
  const aimCollisionOutlineDebugGroupsByCellId = new Map<string, THREE.Group>();
  const geodesicEmitterLabelsByKey = new Map<string, {
    readonly text: string;
    readonly root: THREE.Object3D;
  }>();
  const geodesicRuntimeRenderSources = createGeodesicRuntimeRenderSources(options.assets);
  const geodesicRuntimeArchetypeKeys = geodesicRuntimeRenderSources.map((source) => source.archetypeKey);
  const runtimeObjectRenderDiagnostics = createRuntimeObjectRenderArchetypeDiagnostics();
  const playerRoverRenderModel = createPlayerRoverRenderModel(options.assets);
  const portalClipData = createPortalClipData({ maxVisiblePaths });
  // Hardware clip distances (WEBGL_clip_cull_distance) when available, otherwise a fragment compare and discard.
  const portalClipDistanceToggle = createPortalClipDistanceToggle(renderer);
  const portalClipMaterialState = createPortalClipMaterialState(portalClipData, {
    hardwareClipDistances: portalClipDistanceToggle !== undefined,
  });
  console.info(
    portalClipDistanceToggle ? "Portal clip mode: hardware clip distances" : "Portal clip mode: fragment discard",
  );
  // Clip distances may only be enabled while patched programs draw: onBeforeRender / onAfterRender of patched meshes.
  const enablePortalClipDistances = (): void => portalClipDistanceToggle?.enable();
  const disablePortalClipDistances = (): void => portalClipDistanceToggle?.disable();
  // Everything declared here, before the setup calls below, is safe to use from setup code: a const or let declared
  // further down is still in its temporal dead zone when setup calls the functions that use it.
  // Brings runtime-object instances up to date from the frame snapshot; called once per frame, at setup and from
  // applyDebugSettings only. Everything else requests a sync (the flags below).
  const runtimeObjectInstanceSync = createRuntimeObjectInstanceSync({
    engine,
    registry: runtimeObjectRegistry,
    runtimeObjectRootsById,
    renderSourcesByKey: runtimeObjectRenderSourcesByKey,
    renderArchetypesByKey: runtimeObjectRenderArchetypesByKey,
    renderRoot: runtimeObjectRenderRoot,
    geodesicRenderSources: geodesicRuntimeRenderSources,
    geodesicArchetypeKeys: geodesicRuntimeArchetypeKeys,
    playerRoverRenderModel,
    maxVisiblePaths,
    diagnostics: runtimeObjectRenderDiagnostics,
    getWorld: activeWorld,
    session,
    buildArchetype: (source, capacity) => {
      const archetype = buildRuntimeObjectRenderArchetype(source, capacity, portalClipMaterialState);
      archetype.mesh.onBeforeRender = (renderer, _scene, renderCamera) => portalFrame.beforeMeshRender(renderer, renderCamera);
      archetype.mesh.onAfterRender = portalFrame.afterMeshRender;
      return archetype;
    },
  });
  // Portal-render values of the current frame, built once by the portal pass (see frameRenderSnapshot.ts).
  // Event-driven requests; the frame performs the sync and clears the flags. Tools call these through their
  // `syncRuntimeObjectPortalInstances` / `syncSelectableHitboxDebug` deps.
  let runtimeObjectInstanceSyncRequested = false;
  let selectableHitboxDebugSyncRequested = false;
  // Incremented whenever the cell root groups are rebuilt (the hitbox debug groups hang under them).
  let cellRootsGeneration = 0;
  function requestRuntimeObjectInstanceSync(): void {
    runtimeObjectInstanceSyncRequested = true;
  }
  function requestSelectableHitboxDebugSync(): void {
    selectableHitboxDebugSyncRequested = true;
  }
  function currentFrameSnapshot(): FrameRenderSnapshot {
    return portalFrame.frameSnapshot(aimFrameSerial);
  }
  const portalFrame = createPortalFramePass({
    engine,
    scene,
    camera,
    renderer,
    session,
    visiblePortalPathOptions,
    getWorld: activeWorld,
    getStaticCull: activeStaticCull,
    portalClipData,
    portalClipMaterialState,
    enablePortalClipDistances,
    disablePortalClipDistances,
  });
  // Inputs of the last per-frame refreshMeasuredGeodesicLengths run (version -1: never run).
  const measuredLengthsRefreshed = { version: -1, cellId: "", x: Number.NaN, y: Number.NaN, z: Number.NaN };
  // Id of the cell whose group in cellMeshes is currently visible; updated by updateVisibleCell.
  let visibleCellId: string | undefined = readLocalPlayerPose(engine).cellId;

  const {
    dumpGeodesicCreatures,
    dumpGeodesicPath,
    dumpLockedGeodesicWords,
    dumpAllGeodesics,
    updateGeodesicCreatureDebug,
  } = createGeodesicDebugDumps({
    worldId: options.selectedWorldId,
    runtimeObjectRegistry,
    dynamicObjectRuntimes,
    cellMeshes,
    getWorld: activeWorld,
    session,
    getVisibleCellId: () => visibleCellId,
    resolveCameraAimTarget: () => resolveCurrentAimTarget(resolveCameraRootRay()),
  });

  const {
    createGeometryComputerMenuOptions,
    refreshOpenGeometryComputerMenu,
    stepGeometryComputerPendingTarget,
    startGeometryComputerDeformation,
  } = createGeometryComputerMenu({
    geometrySession,
    session,
    dispatch: dispatchRuntimeCommand,
    syncDesktopPalette,
  });

  const {
    syncDynamicObjectDebugWireframes,
    syncStaticObjectCollisionWireframes,
    syncSelectableHitboxDebug,
    syncSelectableHitboxDebugIfChanged,
  } =
    createDebugVisualization({
      runtimeObjectRegistry,
      dynamicObjectRuntimes,
      cellMeshes,
      staticObjectCollisionWireframeGroupsByCellId,
      selectableHitboxDebugGroupsByCellId,
      aimCollisionOutlineDebugGroupsByCellId,
      getWorld: activeWorld,
      session,
    });

  const { updateGeodesicEmitterLabels, getGeodesicDisplayName, getGeodesicLabelsById } =
    createGeodesicEmitterLabelController({
      engine,
      scene,
      camera,
      runtimeObjectRegistry,
      geodesicEmitterLabelsByKey,
      getWorld: activeWorld,
      session,
      getRegistryVersion: () => runtimeObjectRegistry.getVersion(),
    });

  const { updateXrObjectTooltip, clearXrObjectTooltip } = createXrObjectTooltipController({ scene, camera });
  const xrDebugPanel = createXrDebugPanel();
  scene.add(xrDebugPanel.object);

  const {
    resolveCurrentAimTarget,
    resolveCurrentAimTargets,
    cycleFocusedAimTarget,
    findFocusedRuntimeObject,
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    resolveActiveRootAimRay,
    resolveCameraRootRay,
    resolveDesktopTooltipScreenPosition,
    getRuntimeObjectTooltipText,
    getWorldFocusMessageDefinition,
    invalidateAimCache,
  } = createAimInteraction({
    engine,
    camera,
    renderer,
    xrRig,
    runtimeObjectRegistry,
    getWorld: activeWorld,
    session,
    getFrameSerial: () => aimFrameSerial,
  });


  const aimFeedback = createAimFeedback({
    engine,
    scene,
    camera,
    session,
    runtimeObjectRegistry,
    cellMeshes,
    floatingObjectTooltip,
    aimCrossMarker,
    helpLensRenderer,
    updateXrObjectTooltip,
    resolveCurrentAimTarget,
    targetIsWithinInteractionRange,
    findFocusedRuntimeObject,
    resolveDesktopTooltipScreenPosition,
    getRuntimeObjectTooltipText,
    getWorldFocusMessageDefinition,
    getGeodesicDisplayName,
  });
  const { clearProtractorToolFeedback, resolveProtractorDirectedSelectionFromAimTarget } = aimFeedback;

  const {
    syncPlacedFlagRuntime,
    removePlacedFlagRuntime,
    syncMeasuredGeodesicLengthRuntime,
    removeMeasuredGeodesicLengthRuntime,
    syncProtractorAngleRuntime,
    removeProtractorAngleRuntime,
    removePlacedFlags,
    removeMeasuredGeodesicLengths,
    removeMeasuredGeodesicLengthsForGeodesic,
    refreshMeasuredGeodesicLengths,
    refreshMeasuredGeodesicLengthsForGeodesic,
    removeProtractorAngles,
    removeProtractorAnglesForGeodesic,
    removeProtractorAnglesForMissingVertices,
    refreshProtractorAnglesForGeodesic,
    refreshProtractorAnglesForGeodesics,
  } = createToolObjectRuntimes({
    engine,
    assets: options.assets,
    runtimeObjectRegistry,
    cellMeshes,
    placedFlagRuntimes,
    measuredGeodesicLengthRuntimes,
    protractorAngleRuntimes,
    runtimeObjectRootsById,
    runtimeObjectRenderSourcesByKey,
    runtimeObjectRenderArchetypesByKey,
    runtimeObjectRenderRoot,
    getWorld: activeWorld,
    session,
    dispatch: dispatchRuntimeCommand,
    clearProtractorToolFeedback,
    syncRuntimeObjectPortalInstances: requestRuntimeObjectInstanceSync,
    syncSelectableHitboxDebug: requestSelectableHitboxDebugSync,
  });

  const {
    tryUseGeodesicCannonToolFromAim,
    tryExtendFocusedGeodesicFromAim,
    addGeodesicToCannon,
    startGeodesicCannonRotation,
    startGeodesicCannonAim,
    startGeodesicCannonCarry,
    tryStartFocusedGeodesicCannonCarry,
    finishGeodesicCannonCarry,
    deleteGeodesicFromCannon,
    canTieAndDetachGeodesicsFromCannon,
    startGeodesicCannonTieAndDetach,
    trySelectTieAndDetachGeodesicFromAim,
    syncTieAndDetachSelectionHighlights,
    updateCarriedGeodesicCannonPose,
    afterWorldStep: afterCarryWorldStep,
    updateActiveGeodesicCannonRotation,
    updateActiveGeodesicCannonAim,
    getLockedGeodesicIds,
    freezeXrHeadHeightDuringGeodesicCannonRotation,
    resetGeodesicCannonRotationTracking,
  } = createGeodesicCannonTools({
    engine,
    renderer,
    controls,
    runtimeObjectRegistry,
    getWorld: activeWorld,
    session,
    dispatch: dispatchRuntimeCommand,
    resolveCurrentAimTarget,
    resolveCurrentAimTargets,
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    findFocusedRuntimeObject,
    getGeodesicLabelsById,
    syncDesktopPalette,
    syncRuntimeObjectPortalInstances: requestRuntimeObjectInstanceSync,
    syncSelectableHitboxDebug: requestSelectableHitboxDebugSync,
    refreshMeasuredGeodesicLengthsForGeodesic,
    removeMeasuredGeodesicLengthsForGeodesic,
    removeProtractorAnglesForGeodesic,
    removeProtractorAnglesForMissingVertices,
    refreshProtractorAnglesForGeodesic,
    refreshProtractorAnglesForGeodesics,
  });

  const {
    appendEditingSignCharacter,
    backspaceEditingSignMessage,
    deleteEditingSign,
    tryPlaceFlagFromAim,
    tryUseMeasureLengthToolFromAim,
    tryUseProtractorToolFromAim,
    tryUseFocusedObjectPrimaryInteraction,
    openContextMenuFromAim,
    applyDesktopScenePaletteToggle,
    resetPlayerToHome,
    teleportPlayerHome,
    resetRuntimeWorld,
    debugPlayerPose,
    debugSetPlayerPose,
    debugPlaceObjectAt,
  } = createRuntimeObjectActions({
    engine,
    session,
    dispatch: dispatchRuntimeCommand,
    runtimeObjectRegistry,
    getWorld: activeWorld,
    appConfig,
    initialPlayerPose: appState.playerPose,
    xrRig,
    objectHost,
    dynamicObjectRuntimes,
    cellMeshes,
    staticAssetOwners,
    resolveCurrentAimTarget,
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    findFocusedRuntimeObject,
    tryExtendFocusedGeodesicFromAim,
    getGeodesicDisplayName,
    getGeodesicLabelsById,
    getLockedGeodesicIds,
    canTieAndDetachGeodesicsFromCannon,
    createGeometryComputerMenuOptions,
    syncPlacedFlagRuntime,
    removePlacedFlagRuntime,
    syncMeasuredGeodesicLengthRuntime,
    removeMeasuredGeodesicLengthRuntime,
    syncProtractorAngleRuntime,
    removeProtractorAngleRuntime,
    removePlacedFlags,
    removeMeasuredGeodesicLengths,
    removeProtractorAngles,
    removeGeodesicRuntimeObjects,
    syncRuntimeObjectPortalInstances: requestRuntimeObjectInstanceSync,
    syncSelectableHitboxDebug: requestSelectableHitboxDebugSync,
    syncDesktopPalette,
    clearProtractorToolFeedback,
    resolveProtractorDirectedSelectionFromAimTarget,
  });

  const {
    onDesktopContextMenu,
    onDesktopMouseDown,
    onDesktopPaletteKeyDown,
    onDesktopWheel,
    getDesktopInputFrame,
    getXrInputFrame,
    updateScenePalette,
  } = createDesktopInputHandlers({
    session,
    appConfig,
    camera,
    renderer,
    xrRig,
    controls,
    xrControls,
    scenePaletteController,
    desktopScenePaletteInput,
    xrScenePaletteInput,
    xrControllerHandModels,
    resolveActiveRootAimRay,
    cycleFocusedAimTarget,
    openContextMenuFromAim,
    applyDesktopScenePaletteToggle,
    dismissHelpLensFocus: aimFeedback.dismissHelpLensFocus,
  });

  const geometryDebugHelpers = createGeometryDebugHelpers({ session, geometrySession });

  const runtimeEffects = createRuntimeEffects({
    session,
    dispatch: dispatchRuntimeCommand,
    host: options,
    syncDesktopPalette,
    syncTieAndDetachSelectionHighlights,
    clearProtractorToolFeedback,
    requestRuntimeObjectInstanceSync,
    applyMenuDebugState,
    applyMenuComfortState,
    requestAppRestart: xrSession.requestAppRestart,
    teleportPlayerHome,
    addGeodesicToCannon,
    startGeodesicCannonCarry,
    startGeodesicCannonTieAndDetach,
    startGeodesicCannonRotation,
    startGeodesicCannonAim,
    deleteGeodesicFromCannon,
    stepGeometryComputerPendingTarget,
    startGeometryComputerDeformation,
    appendEditingSignCharacter,
    backspaceEditingSignMessage,
    deleteEditingSign,
  });

  // Initial build: cell groups and archetypes, camera pose, first visibility pass (before any frame runs).
  rebuildCellMeshes();
  applyDesktopCameraPose();
  portalFrame.syncPlayerCell(aimFrameSerial);
  // Dependencies for the portal debug runtime; `live` reads current shell state on demand. The runtime is
  // recreated (not mutated) when the world or debug settings change.
  const portalDebugRuntimeDeps: PortalDebugRuntimeDeps = {
    rootRenderPathMaxDepth,
    scene,
    camera,
    renderer,
    pixelRatio,
    options,
    clipPolygonOverlay,
    debugOverlay,
    geometrySession,
    activeWorld,
    activeStaticCull,
    createPortalEyeDebugStates: portalFrame.eyeDebugStates,
    live: () => ({
      debugLevel: session.get().debugSettings.debugLevel,
      debugOptions: session.get().debugSettings.debugOptions,
      playerPose: readLocalPlayerPose(engine),
      latestVisibleResult: portalFrame.latestVisibleResult(),
      portalInstanceDebugRenderer: portalFrame.instanceDebugRenderer(),
      portalInstanceRenderState: portalFrame.instanceRenderState(),
      showCellPathRendersInstances: session.get().showCellPathRendersInstances,
      menuState: currentMenuState(),
      smoothedFrameRateFps,
      smoothedFramePerformance,
      latestWebGlRenderInfo,
      xrDebugState: xrSession.debugState(),
    }),
    dispatch: dispatchRuntimeCommand,
  };

  let portalDebugRuntime = createPortalDebugRuntime(portalDebugRuntimeDeps);
  logDebugStartupGuide(session.get().debugSettings.debugLevel, session.get().debugSettings.debugOptions);
  installGeneralDebugHelpers({
    debugHelp: () => logDebugStartupGuide(session.get().debugSettings.debugLevel, session.get().debugSettings.debugOptions),
    dumpGeodesicCreatures: dumpGeodesicCreatures,
    dumpAllGeodesics: dumpAllGeodesics,
    dumpGeodesicPath: dumpGeodesicPath,
    dumpLockedGeodesicWords: dumpLockedGeodesicWords,
    placeObjectAt: debugPlaceObjectAt,
    playerPose: debugPlayerPose,
    kindScans: () => runtimeObjectRegistry.getKindScanCounts(),
    setPlayerPose: debugSetPlayerPose,
  });
  installRenderInspectionApi(runtimeObjectInstanceSync.inspection);
  geometryDebugHelpers.installIfAvailable();
  setApiNamespace("world", worldClient.api);
  setApiNamespace("view", {
    screenshot() {
      if (renderer.xr.isPresenting) {
        throw new Error("screenshot is not available while presenting in XR");
      }
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/jpeg", 0.85);
    },
  });
  syncDesktopPalette();

  // Instantiate the world's authored objects: creatures become per-frame updated runtimes, collidable assets
  // become static registry objects.
  for (const cell of activeWorld().cells) {
    for (const objectSpec of cell.objects) {
      if (isGeodesicMarmotObjectSpec(objectSpec)) {
        const runtime = createGeodesicMarmotRuntime(objectSpec, cell.id, options.assets, runtimeObjectRegistry);
        runtime.syncParent(cellMeshes);
        dynamicObjectRuntimes.push(runtime);
        objectHost.register(runtime);
        runtimeObjectRootsById.set(runtime.objectId, runtime.root);
        syncDynamicObjectDebugWireframes();
        continue;
      }

      if (isSimpleGeoCreatureObjectSpec(objectSpec)) {
        const runtime = createSimpleGeoCreatureRuntime(objectSpec, cell.id, options.assets, runtimeObjectRegistry);
        runtime.syncParent(cellMeshes);
        dynamicObjectRuntimes.push(runtime);
        objectHost.register(runtime);
        runtimeObjectRootsById.set(runtime.objectId, runtime.root);
        syncDynamicObjectDebugWireframes();
        continue;
      }

      if (objectSpec.kind === "asset") {
        const owner = createPlainWorldObject(runtimeObjectRegistry, createRuntimeStaticAssetObject(objectSpec, cell.id));
        objectHost.register(owner);
        staticAssetOwners.push(owner);
        // The model is drawn from the registry record through this root; it is a template and stays out of the scene.
        const record = runtimeObjectRegistry.get(objectSpec.id);
        if (record) {
          runtimeObjectRootsById.set(
            objectSpec.id,
            buildStaticAssetRenderRoot(cell.id, objectSpec, record.localPose, options.assets),
          );
        }
      }
    }
  }
  syncStaticObjectCollisionWireframes();
  runtimeObjectInstanceSync.sync(currentFrameSnapshot());
  syncSelectableHitboxDebugIfChanged({
    registryVersion: runtimeObjectRegistry.getVersion(),
    cellRootsGeneration,
    forced: true,
  });
  runtimeObjectInstanceSyncRequested = false;
  selectableHitboxDebugSyncRequested = false;
  disableFrustumCulling(scene);
  disableShadows(scene);

  // Places the camera from playerPose (desktop mode) and updates the scene lighting to follow it.
  function applyDesktopCameraPose(): void {
    xrRig.syncDesktopCamera(readLocalPlayerPose(engine));
    updateStylizedSceneLighting(sceneLighting, camera);
  }

  // Asynchronous WebXR capability probe; it may resolve after the first frames, updating the entry button.
  xrSession.detectAvailability();

  // Startup shader/cell warmup render so the first visible frames do not stall on compilation.
  const warmupStartMs = performance.now();
  prerenderCells({
    renderer,
    scene,
    camera,
    cellMeshes,
    activeCellId: readLocalPlayerPose(engine).cellId,
    warmupViewsByCellId: geometryCommit.active().warmupViewsByCellId,
  });
  runtimeDiagnostics().recordWarmup("startup", performance.now() - warmupStartMs);

  // Shows only the mesh group of the player's current cell; cheap no-op when the cell did not change.
  function updateVisibleCell(): void {
    if (visibleCellId === readLocalPlayerPose(engine).cellId) {
      return;
    }

    for (const [cellId, cellMesh] of cellMeshes) {
      cellMesh.visible = cellId === readLocalPlayerPose(engine).cellId;
    }

    visibleCellId = readLocalPlayerPose(engine).cellId;
  }

  // Window resize handler: updates camera aspect and renderer size.
  function onResize(): void {
    const canvasSize = getWindowCssCanvasSize(window);
    camera.aspect = canvasSize.width / canvasSize.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(canvasSize.width, canvasSize.height);
  }

  /**
   * Animation-loop callback: runs {@link renderFrameUnguarded} inside the frame error guard and never throws.
   *
   * Called by `renderer.setAnimationLoop`; `xrFrame` is provided only while an XR session is presenting. If the
   * frame throws before drawing, the scene is still rendered once so the loop and the headset image stay live.
   */
  function renderFrame(time?: DOMHighResTimeStamp, xrFrame?: XRFrame): void {
    frameDrawn = false;
    aimFrameSerial += 1;
    frameErrorGuard.runFrame(
      () => renderFrameUnguarded(time, xrFrame),
      () => {
        if (!frameDrawn && !disposed) {
          renderer.render(scene, camera);
        }
      },
    );
    // Journals, events and command results have been read by now (label runtimes and the UI ran inside the frame).
    engine.endFrame();
  }

  // Reports a contained frame or phase error once per distinct message, to the console and runtime diagnostics.
  function reportFrameError(phase: string, error: unknown): void {
    console.error(`[noneuclid] frame error in ${phase}; the loop continues.`, error);
    runtimeDiagnostics().recordDebugEvent("frame-error", {
      phase,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Frames keep failing: end an immersive session so the user is not left in a frozen or broken world.
  function endXrSessionAfterPersistentFrameFailure(error: unknown): void {
    console.error(
      `[noneuclid] ${MAX_CONSECUTIVE_FAILED_FRAMES} frames in a row failed; ending any immersive session.`,
      error,
    );
    const session = renderer.xr.getSession?.();
    if (session) {
      void Promise.resolve(session.end()).catch(() => undefined);
    }
  }

  /**
   * Runs one animation frame (input, movement, portal visibility, instance sync, render; see the module header).
   *
   * Called only through {@link renderFrame}. Reads and replaces `playerPose`, may swap the world via a geometry
   * commit, and renders exactly once (setting `frameDrawn`). Must not be called re-entrantly.
   */
  function renderFrameUnguarded(_time?: DOMHighResTimeStamp, xrFrame?: XRFrame): void {
    const frameStartMs = performance.now();
    // Phase 0: timing. deltaSeconds is the wall-clock time since the previous frame, capped so that a frame after the
    // tab was in the background does not fling creatures and the player far outside their cells in a single step.
    const wallClockDeltaSeconds = clock.getDelta();
    const deltaSeconds = Math.min(wallClockDeltaSeconds, maxSimulationStepSeconds);
    const frameRateFps = wallClockDeltaSeconds > 0 ? 1 / wallClockDeltaSeconds : undefined;
    smoothedFrameRateFps = frameRateFps === undefined
      ? smoothedFrameRateFps
      : smoothedFrameRateFps === undefined
        ? frameRateFps
        : THREE.MathUtils.lerp(smoothedFrameRateFps, frameRateFps, 0.15);
    // Swap in a finished background geometry deformation before anything reads the world this frame.
    geometryCommit.commitReady();
    // Phase 1: input. Head pose is in the XR local-floor reference space (meters / radians), not cell frame.
    const xrActive = renderer.xr.isPresenting && xrSession.sessionState().status === "active";
    const xrReferenceSpace = xrActive ? renderer.xr.getReferenceSpace() : null;
    const xrViewerPose = xrActive && xrFrame && xrReferenceSpace
      ? xrFrame.getViewerPose(xrReferenceSpace)
      : undefined;
    const headLocalMeters = xrActive
      ? headLocalMetersFromViewerPose(xrViewerPose)
      : undefined;
    const headLocalYawRadians = xrActive
      ? headYawRadiansFromViewerPose(xrViewerPose)
      : undefined;
    const frameBeforeInputMs = performance.now();
    const frame = xrActive ? getXrInputFrame(deltaSeconds) : getDesktopInputFrame(deltaSeconds);
    vrComfortVignette.update({
      active: xrActive && isArtificialLocomotionActive(frame),
      deltaSeconds,
      normalFovDegrees: camera.fov,
    });
    const rotatingGeodesicCannon = currentMenuState().selectedTool === "geodesic-cannon-rotate";
    const aimingGeodesicCannon = currentMenuState().selectedTool === "geodesic-cannon-aim";
    const effectiveHeadLocalMeters = rotatingGeodesicCannon && xrActive
      ? freezeXrHeadHeightDuringGeodesicCannonRotation(headLocalMeters)
      : headLocalMeters;
    resetGeodesicCannonRotationTracking({ rotating: rotatingGeodesicCannon, aiming: aimingGeodesicCannon });
    const frameAfterInputMs = performance.now();
    const frameBeforeMoveMs = frameAfterInputMs;
    const previousCellId = readLocalPlayerPose(engine).cellId;
    let moveResult: ReturnType<typeof movePlayer> | undefined;

    // Phase 2: movement. A reset request skips movement entirely (moveResult stays undefined).
    if (frame.resetRequested) {
      teleportPlayerHome();
      resetRuntimeWorld();
    } else {
      const yawDeltaRadians = xrActive
        ? xrRig.resolveCameraYawRadians(headLocalYawRadians) - readLocalPlayerPose(engine).yawRadians + frame.yawDeltaRadians
        : frame.yawDeltaRadians;
      const playerYawDeltaRadians = rotatingGeodesicCannon ? 0 : yawDeltaRadians;
      moveResult = movePlayer({
        world: activeWorld(),
        pose: readLocalPlayerPose(engine),
        body: appState.playerBody,
        localDisplacement: rotatingGeodesicCannon ? { x: 0, y: 0, z: 0 } : frame.localDisplacement,
        yawDeltaRadians: playerYawDeltaRadians,
        pitchDeltaRadians: rotatingGeodesicCannon ? 0 : frame.pitchDeltaRadians,
        coordinateFrame: "global",
        bodiesInCell: playerBlockingBodiesInCell,
      });
      publishLocalPlayerPose(engine, moveResult.pose);
      recordCellTransition(previousCellId, moveResult);

      // XR only: apply the player's physical (room-scale) head displacement as a second move, so walking in
      // the room also crosses portals and collides; the rig then accepts or rejects that physical move.
      if (xrActive && !rotatingGeodesicCannon) {
        const beforePhysicalCellId = readLocalPlayerPose(engine).cellId;
        const physicalReferenceSpaceYawRadians = readLocalPlayerPose(engine).yawRadians - (headLocalYawRadians ?? 0);
        const physicalFrame = xrRig.consumePhysicalInput(
          effectiveHeadLocalMeters,
          readLocalPlayerPose(engine).yawRadians,
          physicalReferenceSpaceYawRadians,
        );
        const physicalMoveResult = movePlayer({
          world: activeWorld(),
          pose: readLocalPlayerPose(engine),
          body: appState.playerBody,
          localDisplacement: physicalFrame.localDisplacement,
          yawDeltaRadians: 0,
          pitchDeltaRadians: 0,
          coordinateFrame: "global",
          bodiesInCell: playerBlockingBodiesInCell,
        });
        const runtimeCollisionPhysicalMoveResult = physicalMoveResult;
        publishLocalPlayerPose(engine, runtimeCollisionPhysicalMoveResult.pose);
        xrRig.acceptPhysicalMove(runtimeCollisionPhysicalMoveResult, effectiveHeadLocalMeters);
        moveResult = runtimeCollisionPhysicalMoveResult.blocked || runtimeCollisionPhysicalMoveResult.crossedPortal
          ? runtimeCollisionPhysicalMoveResult
          : moveResult;
        recordCellTransition(beforePhysicalCellId, runtimeCollisionPhysicalMoveResult);
      }
    }

    // Pose the camera/rig from the new playerPose first, so aim rays and carried objects use this frame's view.
    if (xrActive) {
      xrRig.syncXrRig(readLocalPlayerPose(engine), effectiveHeadLocalMeters, headLocalYawRadians);
    } else {
      applyDesktopCameraPose();
    }
    const xrHeadWorldPose = xrActive ? xrSession.resolveXrHeadWorldPose(xrViewerPose) : undefined;
    const activeAimRay = resolveActiveRootAimRay(xrActive, xrFrame, xrReferenceSpace);
    updateCarriedGeodesicCannonPose(xrActive, activeAimRay, deltaSeconds);
    if (frame.helpRequested) {
      aimFeedback.requestHelpLensForFocusedObject(activeAimRay);
    }
    const worldPrimaryActionRequested = frame.primaryActionRequested && !currentMenuState().isOpen;
    // Tool dispatch: modal cannon tools consume the primary action themselves; world tools act only when
    // no menu is open. primaryActionConsumed stops the generic focused-object interaction.
    let primaryActionConsumed = false;
    if (frame.carryActionRequested && !currentMenuState().isOpen) {
      primaryActionConsumed = currentMenuState().selectedTool === "geodesic-cannon-carry"
        ? finishGeodesicCannonCarry()
        : tryStartFocusedGeodesicCannonCarry(activeAimRay);
    }

    if (currentMenuState().selectedTool === "geodesic-cannon-carry") {
      if (frame.primaryActionRequested) {
        finishGeodesicCannonCarry();
        primaryActionConsumed = true;
      }
    } else if (currentMenuState().selectedTool === "geodesic-cannon-rotate") {
      updateActiveGeodesicCannonRotation(frame.yawDeltaRadians, frame.primaryActionRequested);
      primaryActionConsumed = frame.primaryActionRequested;
    } else if (currentMenuState().selectedTool === "geodesic-cannon-aim") {
      updateActiveGeodesicCannonAim(frame.primaryActionRequested, activeAimRay);
      primaryActionConsumed = frame.primaryActionRequested;
    } else if (worldPrimaryActionRequested && currentMenuState().selectedTool === "geodesic-cannon-tie-detach") {
      primaryActionConsumed = trySelectTieAndDetachGeodesicFromAim(activeAimRay);
    } else if (worldPrimaryActionRequested && currentMenuState().selectedTool === "place-flag") {
      tryPlaceFlagFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (worldPrimaryActionRequested && currentMenuState().selectedTool === "geodesic-cannon") {
      tryUseGeodesicCannonToolFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (worldPrimaryActionRequested && currentMenuState().selectedTool === "measure-length") {
      tryUseMeasureLengthToolFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (worldPrimaryActionRequested && currentMenuState().selectedTool === "protractor") {
      tryUseProtractorToolFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (
      worldPrimaryActionRequested &&
      !primaryActionConsumed &&
      (currentMenuState().selectedTool === "none" || currentMenuState().selectedTool === "aim")
    ) {
      primaryActionConsumed = tryUseFocusedObjectPrimaryInteraction(activeAimRay);
    }

    if (primaryActionConsumed) {
      // A consumed action may have changed the registry; drop the per-frame aim cache.
      invalidateAimCache();
    }

    if (frame.interactRequested) {
      openContextMenuFromAim(activeAimRay);
    }
    const frameAfterMoveMs = performance.now();
    const frameBeforeObjectsMs = frameAfterMoveMs;
    // Simulation of non-player objects (timed separately as objectsMs): creatures treat the player as an
    // obstacle; geodesics under curve shortening advance and dependent measurements are refreshed.
    const playerObstacle = createPlayerCollisionState(readLocalPlayerPose(engine));

    // Each object is its own contained phase: one failing creature must not stop the others or the frame.
    for (const runtime of dynamicObjectRuntimes) {
      frameErrorGuard.runPhase(`object ${runtime.objectId}`, () => {
        runtime.update(activeWorld(), frame.resetRequested ? 0 : deltaSeconds, [playerObstacle]);
        runtime.syncParent(cellMeshes);
      });
    }
    updateGeodesicCreatureDebug(deltaSeconds);
    for (const runtime of placedFlagRuntimes.values()) {
      runtime.syncParent(cellMeshes);
    }
    // The world engine's step: queued commands, then (as modules arrive) their ticks. Contained like any phase.
    frameErrorGuard.runPhase("world engine", () => {
      engine.step(frame.resetRequested ? 0 : deltaSeconds);
      worldClient.afterStep();
      afterCarryWorldStep();
    });
    let straightenedGeodesicIds: readonly string[] = [];
    frameErrorGuard.runPhase("curve shortening", () => {
      straightenedGeodesicIds = advanceCurveShorteningPairs({
        world: activeWorld(),
        registry: runtimeObjectRegistry,
        deltaSeconds: frame.resetRequested ? 0 : deltaSeconds,
        // There is no on-screen message system yet: notices go to the console and the diagnostics, always (not only in debug mode).
        onNotice: (notice) => {
          console.info(`[noneuclid] ${notice.message}`);
          runtimeDiagnostics().recordDebugEvent(notice.message, notice);
        },
      });
    });
    for (const geodesicId of straightenedGeodesicIds) {
      refreshProtractorAnglesForGeodesic(geodesicId);
      refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    }
    if (straightenedGeodesicIds.length > 0) {
      removeProtractorAnglesForMissingVertices(pruneMissingGeodesicIntersectionObjects(runtimeObjectRegistry));
      requestSelectableHitboxDebugSync();
    }
    // Skipped while nothing it reads changed: registry contents, the player's cell and exact position.
    if (
      runtimeObjectRegistry.getVersion() !== measuredLengthsRefreshed.version ||
      readLocalPlayerPose(engine).cellId !== measuredLengthsRefreshed.cellId ||
      readLocalPlayerPose(engine).position.x !== measuredLengthsRefreshed.x ||
      readLocalPlayerPose(engine).position.y !== measuredLengthsRefreshed.y ||
      readLocalPlayerPose(engine).position.z !== measuredLengthsRefreshed.z
    ) {
      refreshMeasuredGeodesicLengths();
      // Stored after the run: the refresh itself may update the registry.
      measuredLengthsRefreshed.version = runtimeObjectRegistry.getVersion();
      measuredLengthsRefreshed.cellId = readLocalPlayerPose(engine).cellId;
      measuredLengthsRefreshed.x = readLocalPlayerPose(engine).position.x;
      measuredLengthsRefreshed.y = readLocalPlayerPose(engine).position.y;
      measuredLengthsRefreshed.z = readLocalPlayerPose(engine).position.z;
    }
    const frameAfterObjectsMs = performance.now();
    const frameBeforeCameraMs = frameAfterObjectsMs;

    // Phase 3: portal visibility. The culling cameras mirror the render cameras (per eye in stereo XR).
    updateVisibleCell();
    let portalCullingCameras: readonly THREE.Camera[] = [camera];
    if (xrActive) {
      // The rig is synced a second time (also done after movement) so the culling cameras below derive from
      // the pose as it stands after the tool phase.
      xrRig.syncXrRig(readLocalPlayerPose(engine), effectiveHeadLocalMeters, headLocalYawRadians);
      portalCullingCamera.copy(camera, false);
      xrRig.syncXrCullingCamera(portalCullingCamera, xrViewerPose);
      const xrEyeCameras = xrRig.syncXrViewCullingCameras(portalCullingEyeCameras, xrViewerPose);
      portalCullingCameras = xrEyeCameras.length > 0 ? xrEyeCameras : [portalCullingCamera];
      updateStylizedSceneLighting(sceneLighting, camera);
    } else {
      applyDesktopCameraPose();
    }
    frameErrorGuard.runPhase("tooltips", () => {
      aimFeedback.updateTooltips(xrActive, activeAimRay, xrHeadWorldPose);
    });
    const frameAfterCameraMs = performance.now();
    const frameBeforePortalMs = frameAfterCameraMs;

    // Phase 3/4: compute visible portal paths (stereo: one result per eye, unioned) and write the instance
    // transforms and clip data consumed by onBeforeRender during renderer.render.
    if (xrActive) {
      portalFrame.syncXr(portalCullingCameras, aimFrameSerial);
    } else {
      portalFrame.syncDesktop(portalCullingCameras[0] ?? camera, aimFrameSerial);
    }
    // Phase 4 (objects): the only runtime-object instance write of the frame, from the snapshot the portal pass built.
    runtimeObjectInstanceSync.sync(currentFrameSnapshot());
    syncSelectableHitboxDebugIfChanged({
      registryVersion: runtimeObjectRegistry.getVersion(),
      cellRootsGeneration,
      forced: selectableHitboxDebugSyncRequested,
    });
    // The instance sync runs every frame; the request flag is kept (and only cleared) so a later job can skip
    // frames in which nothing asked for a sync.
    void runtimeObjectInstanceSyncRequested;
    runtimeObjectInstanceSyncRequested = false;
    selectableHitboxDebugSyncRequested = false;
    const frameAfterPortalMs = performance.now();
    const frameBeforeUiMs = frameAfterPortalMs;

    // UI/debug refresh; none of this changes simulation state, so it runs as one contained phase.
    frameErrorGuard.runPhase("ui", () => {
      aimFeedback.updateAim(xrActive, activeAimRay);
      updateGeodesicEmitterLabels();
      xrSession.syncDebugState(frame.source, moveResult);
      updateScenePalette(xrActive, xrFrame, xrReferenceSpace, xrHeadWorldPose, deltaSeconds, frame);
      const overlayState = portalDebugRuntime.updateVisiblePortalPaths();
      // Resolve the head pose again: the rig was synced a second time after the first pose was computed, and a stale
      // pose would make the head-locked panel shake while walking. The pose aliases scratch vectors; use it at once.
      xrDebugPanel.update({
        visible: isXrDebugPanelVisible({
          xrActive,
          debugEnabled: currentMenuState().debugEnabled,
          debugOverlayEnabled: currentMenuState().debugOverlayEnabled,
        }),
        state: overlayState,
        head: xrActive ? xrSession.resolveXrHeadWorldPose(xrViewerPose) : undefined,
        nowMs: performance.now(),
      });
    });
    const frameAfterUiMs = performance.now();
    // Phase 5: draw. In XR the renderer renders each eye from `camera` as updated by the WebXR manager.
    const frameBeforeRenderMs = performance.now();
    renderer.render(scene, camera);
    frameDrawn = true;
    const frameAfterRenderMs = performance.now();
    // Per-phase timings in milliseconds (cameraMs also covers tooltips/help lens; moveMs includes tools).
    const framePerformance: FramePerformanceRenderState = {
      totalMs: frameAfterRenderMs - frameStartMs,
      inputMs: frameAfterInputMs - frameBeforeInputMs,
      moveMs: frameAfterMoveMs - frameBeforeMoveMs,
      objectsMs: frameAfterObjectsMs - frameBeforeObjectsMs,
      cameraMs: frameAfterCameraMs - frameBeforeCameraMs,
      portalMs: frameAfterPortalMs - frameBeforePortalMs,
      uiMs: frameAfterUiMs - frameBeforeUiMs,
      renderMs: frameAfterRenderMs - frameBeforeRenderMs,
    };
    smoothedFramePerformance = smoothFramePerformance(smoothedFramePerformance, framePerformance);
    latestWebGlRenderInfo = captureWebGlRenderInfo(renderer);
    runtimeDiagnostics().recordFrame(readLocalPlayerPose(engine).cellId, {
      totalMs: framePerformance.totalMs,
      moveMs: framePerformance.moveMs,
      renderMs: framePerformance.renderMs,
    });
  }

  // What the shell redraws after the geometry commit swapped the active world: visibility caches, tool state, meshes,
  // portal instances, debug runtime and diagnostics. Runs inside geometryCommit.commit, after the swap.
  function finishGeometryCommit(): void {
    // Visibility results refer to old path ids; drop them until the next sync.
    portalFrame.reset();
    clearGeometryToolStateAfterCommit();
    rebuildCellMeshes();
    for (const runtime of dynamicObjectRuntimes) {
      runtime.syncParent(cellMeshes);
    }
    for (const runtime of placedFlagRuntimes.values()) {
      runtime.syncParent(cellMeshes);
    }
    // Cell instances of the new world are written now; the objects and the hitbox debug are synced later in this
    // same frame (the commit runs at frame start), so this does not write them.
    portalFrame.syncPlayerCell(aimFrameSerial);
    syncDynamicObjectDebugWireframes();
    syncStaticObjectCollisionWireframes();
    applyDesktopCameraPose();
    portalDebugRuntime.dispose();
    portalDebugRuntime = createPortalDebugRuntime(portalDebugRuntimeDeps);
    installRuntimeDiagnostics(
      activeWorld(),
      session.get().debugSettings.debugLevel,
      hasActiveDebugOption(
        session.get().debugSettings.debugLevel,
        session.get().debugSettings.debugOptions,
        "runtime-diagnostics",
      ),
    );
  }

  function clearGeometryToolStateAfterCommit(): void {
    dispatchRuntimeCommand({ kind: "set-cannon-tool-state", state: {} });
    dispatchRuntimeCommand({ kind: "set-protractor-tool-state", state: {} });
    clearProtractorToolFeedback();
    refreshOpenGeometryComputerMenu();
    syncDesktopPalette();
  }

  // Effect "apply-debug-state": the menu's debug fields changed.
  function applyMenuDebugState(): void {
    syncLaunchOptionsState();
    applyDebugSettings();
    syncDesktopPalette();
  }

  // Effect "apply-comfort-state": the menu's comfort fields changed.
  function applyMenuComfortState(): void {
    vrComfortVignette.setOptions(session.get().vrComfortOptions);
    syncLaunchOptionsState();
    syncDesktopPalette();
  }

  // Rebuilds everything that depends on the debug settings in force (session.debugSettings, set by the reducer).
  function applyDebugSettings(): void {
    const settings = session.get().debugSettings;
    installRuntimeDiagnostics(
      activeWorld(),
      settings.debugLevel,
      hasActiveDebugOption(settings.debugLevel, settings.debugOptions, "runtime-diagnostics"),
    );
    rebuildCellMeshes();
    portalFrame.syncPlayerCell(aimFrameSerial);
    portalDebugRuntime.dispose();
    portalDebugRuntime = createPortalDebugRuntime(portalDebugRuntimeDeps);
    logDebugStartupGuide(session.get().debugSettings.debugLevel, session.get().debugSettings.debugOptions);
    installGeneralDebugHelpers({
      debugHelp: () => logDebugStartupGuide(session.get().debugSettings.debugLevel, session.get().debugSettings.debugOptions),
      dumpGeodesicCreatures: dumpGeodesicCreatures,
      dumpAllGeodesics: dumpAllGeodesics,
      dumpGeodesicPath: dumpGeodesicPath,
      dumpLockedGeodesicWords: dumpLockedGeodesicWords,
      placeObjectAt: debugPlaceObjectAt,
      playerPose: debugPlayerPose,
      kindScans: () => runtimeObjectRegistry.getKindScanCounts(),
      setPlayerPose: debugSetPlayerPose,
    });
    geometryDebugHelpers.installIfAvailable();
    for (const runtime of dynamicObjectRuntimes) {
      runtime.syncParent(cellMeshes);
    }
    syncDynamicObjectDebugWireframes();
    syncStaticObjectCollisionWireframes();
    runtimeObjectInstanceSync.sync(currentFrameSnapshot());
    syncSelectableHitboxDebug();
    runtimeObjectInstanceSyncRequested = false;
    selectableHitboxDebugSyncRequested = false;
    applyDesktopCameraPose();
    renderer.render(scene, camera);
  }

  function syncLaunchOptionsState(): void {
    const settings = createDebugSettingsFromRuntimeMenuState(currentMenuState());
    options.onLaunchOptionsChanged?.({
      debugLevel: settings.debugLevel,
      portalPanelMode: settings.portalPanelMode,
      debugOptions: settings.debugOptions,
      debugOverlayEnabled: currentMenuState().debugOverlayEnabled,
      debugOverlayItems: currentMenuState().debugOverlayItems,
      vrComfortOptions: session.get().vrComfortOptions,
    });
  }

  // Listeners are removed symmetrically in dispose(). Everything below `return` is hoisted function
  // declarations, so they are usable by the code above.
  window.addEventListener("resize", onResize);
  renderer.domElement.addEventListener("contextmenu", onDesktopContextMenu);
  window.addEventListener("mousedown", onDesktopMouseDown);
  window.addEventListener("wheel", onDesktopWheel, { passive: false });
  window.addEventListener("keydown", onDesktopPaletteKeyDown);
  applyDesktopCameraPose();
  // Start the loop (desktop requestAnimationFrame, or the XR session's frame callback while presenting).
  renderer.setAnimationLoop(renderFrame);

  // Public handle. See the ThreeApp interface for the caller-facing contract.
  return {
    scene,
    renderer,
    updateDebugSettings(settings) {
      // External update: rebuild from the given settings, then mirror the debug-derived menu fields so the
      // menu shows the live values. Deliberately does not call syncLaunchOptionsState (that would echo the
      // change back to the caller) nor applyMenuDebugState (that would rebuild twice).
      dispatchRuntimeCommand({ kind: "adopt-debug-settings", settings });
      applyDebugSettings();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      // Disposal order: timers and loop first (no more frames), then listeners, UI/controllers, scene content
      // and GPU resources, debug runtime and helpers, geometry session, and last the renderer and its canvas.
      runtimeEffects.dispose();
      renderer.setAnimationLoop(null);
      xrSession.endActiveXrSessionOnDispose();
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("contextmenu", onDesktopContextMenu);
      window.removeEventListener("mousedown", onDesktopMouseDown);
      window.removeEventListener("wheel", onDesktopWheel);
      window.removeEventListener("keydown", onDesktopPaletteKeyDown);
      xrEntryUi.dispose();
      scenePaletteController.dispose();
      xrControllerHandModels.dispose();
      desktopScenePaletteInput.dispose();
      desktopToolIndicator.dispose();
      aimCrossMarker.dispose();
      aimFeedback.dispose();
      floatingObjectTooltip.dispose();
      helpLensRenderer.dispose();
      vrComfortVignette.dispose();
      clearXrObjectTooltip();
      controls.dispose();
      for (const runtime of placedFlagRuntimes.values()) {
        runtime.dispose();
      }
      placedFlagRuntimes.clear();
      for (const group of selectableHitboxDebugGroupsByCellId.values()) {
        group.removeFromParent();
        disposeObject3D(group);
      }
      selectableHitboxDebugGroupsByCellId.clear();
      for (const label of geodesicEmitterLabelsByKey.values()) {
        label.root.removeFromParent();
        disposeObject3D(label.root);
      }
      geodesicEmitterLabelsByKey.clear();
      // Runtime objects are detached before their cell meshes are freed. Their textures belong to the preloaded
      // assets, which the caller disposes.
      for (const runtime of dynamicObjectRuntimes) {
        objectHost.unregister(runtime.id);
        runtimeObjectRegistry.releaseOwnership(runtime.id);
        runtime.root.removeFromParent();
        disposeObject3D(runtime.root);
      }
      dynamicObjectRuntimes.length = 0;
      for (const owner of staticAssetOwners) {
        objectHost.unregister(owner.id);
        owner.dispose();
        const assetRoot = runtimeObjectRootsById.get(owner.id);
        if (assetRoot) {
          runtimeObjectRootsById.delete(owner.id);
          disposeObject3D(assetRoot);
        }
      }
      staticAssetOwners.length = 0;
      for (const runtime of measuredGeodesicLengthRuntimes.values()) {
        runtime.dispose();
      }
      measuredGeodesicLengthRuntimes.clear();
      for (const runtime of protractorAngleRuntimes.values()) {
        runtime.dispose();
      }
      protractorAngleRuntimes.clear();
      if (playerRoverRenderModel) {
        playerRoverRenderModel.root.removeFromParent();
        disposeObject3D(playerRoverRenderModel.root);
      }
      for (const source of geodesicRuntimeRenderSources) {
        disposeObject3D(source.root);
      }
      for (const cellMesh of cellMeshes.values()) {
        disposeCanvasTextures(cellMesh);
        disposeObject3D(cellMesh);
      }
      scene.remove(underCellInfinityFloor);
      disposeObject3D(underCellInfinityFloor);
      portalFrame.dispose();
      portalClipData.dispose();
      for (const archetype of runtimeObjectRenderArchetypesByKey.values()) {
        runtimeObjectRenderRoot.remove(archetype.mesh);
      }
      disposeRuntimeObjectRenderArchetypes(runtimeObjectRenderArchetypesByKey.values());
      runtimeObjectRenderArchetypesByKey.clear();
      runtimeObjectRenderRoot.removeFromParent();
      portalDebugRuntime.dispose();
      uninstallGeneralDebugHelpers();
      uninstallRenderInspectionApi();
      uninstallGeometryDebugHelpers();
      setApiNamespace("view", undefined);
      setApiNamespace("world", undefined);
      worldClient.dispose();
      geometrySession.dispose();
      debugOverlay.dispose();
      scene.remove(xrDebugPanel.object);
      xrDebugPanel.dispose();
      clipPolygonOverlay.dispose();
      disposeStylizedSceneLighting(sceneLighting, scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  function recordCellTransition(previousCellId: string, moveResult: ReturnType<typeof movePlayer>): void {
    if (readLocalPlayerPose(engine).cellId !== previousCellId) {
        runtimeDiagnostics().recordCellEntered(
          previousCellId,
          readLocalPlayerPose(engine).cellId,
          moveResult.crossings.at(-1)?.portalId ?? moveResult.crossedPortalId ?? "unknown-portal",
        );
      portalDebugRuntime.syncRootCell();
    }
  }

  // Tears down and recreates the per-cell groups and instanced render archetypes for the active world,
  // preserving which cell is visible. Called at startup, on geometry commit and on debug-setting changes.
  function rebuildCellMeshes(): void {
    // The hitbox debug groups hang under the cell roots disposed below, so the gated hitbox sync must rebuild.
    cellRootsGeneration += 1;
    const currentlyVisibleCellId = visibleCellId ?? readLocalPlayerPose(engine).cellId;

    portalFrame.disposeArchetypes();
    for (const runtime of dynamicObjectRuntimes) {
      runtime.root.removeFromParent();
    }
    for (const runtime of placedFlagRuntimes.values()) {
      runtime.root.removeFromParent();
    }

    for (const [cellId, cellMesh] of cellMeshes) {
      scene.remove(cellMesh);
      disposeCanvasTextures(cellMesh);
      disposeObject3D(cellMesh);
      cellMeshes.delete(cellId);
    }

    const showForbiddenZoneWireframes = hasActiveDebugOption(
      session.get().debugSettings.debugLevel,
      session.get().debugSettings.debugOptions,
      "forbidden-zone-wireframes",
    );

    for (const cell of activeWorld().cells) {
      const cellMesh = new THREE.Group();
      cellMesh.name = `cell-root:${cell.id}`;
      cellMesh.visible = cell.id === currentlyVisibleCellId;
      if (showForbiddenZoneWireframes) {
        cellMesh.add(buildCurrentCellForbiddenZoneWireframes(cell));
      }
      cellMeshes.set(cell.id, cellMesh);
      scene.add(cellMesh);
    }

    const deformation = geometryCommit.active().snapshot.deformation;
    const floorUvFramesByCellId = deformationFamilyRegistry
      .get(deformation.kind)
      ?.floorUvFrames?.(options.worldSpec, deformation as never);

    portalFrame.buildArchetypes(activeWorld(), {
      floorUvFramesByCellId,
      debugLevel: session.get().debugSettings.debugLevel,
      portalPanelMode: session.get().debugSettings.portalPanelMode,
      eyeHeightMeters: DEFAULT_PLAYER_EYE_HEIGHT_METERS,
      assets: options.assets,
      capacitiesByCellId: geometryCommit.active().archetypeCapacitiesByCellId,
      showForbiddenZoneWireframes: false,
    });
    for (const runtime of placedFlagRuntimes.values()) {
      runtime.syncParent(cellMeshes);
    }
    syncStaticObjectCollisionWireframes();
    visibleCellId = currentlyVisibleCellId;
  }

  function syncDesktopPalette(): void {
    controls.setLookMode(currentMenuState().isOpen ? "palette" : "camera");
    desktopToolIndicator.setTool(currentMenuState().selectedTool, currentMenuState().placeFlagOptions.flagType, {
      protractorPrompt: getProtractorToolPrompt(),
      tieAndDetachPrompt: getTieAndDetachToolPrompt(),
    });
  }

  function getProtractorToolPrompt(): string {
    if (!session.get().protractorToolState.center) {
      return "select: vertex";
    }

    if (!session.get().protractorToolState.first) {
      return "select: side1";
    }

    return "select: side2";
  }

  function getTieAndDetachToolPrompt(): string {
    const selectedCount = session.get().cannonToolState.tieAndDetachEndpointSelections?.length ?? 0;
    return selectedCount === 0 ? "select: geodesic 1" : "select: geodesic 2";
  }

  function playerBlockingBodiesInCell(cellId: string) {
    return runtimeObjectRegistry.getPlayerBlockingObjectsInCell(cellId).map((object) => ({ ...runtimeObjectToDynamicObjectState(object), id: object.id }));
  }

  function createPlayerCollisionState(pose: PlayerPose) {
    return playerPoseToDynamicObject(
      pose,
      simpleCollisionCylinder(appState.playerBody.radiusMeters, appState.playerBody.heightMeters, {
        x: 0,
        y: 0,
        z: appState.playerBody.heightMeters / 2,
      }),
    );
  }

  function removeGeodesicRuntimeObjects(): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (isGeodesicRuntimeRenderObject(object)) {
        runtimeObjectRegistry.remove(object.id);
      }
    }
    dispatchRuntimeCommand({ kind: "set-cannon-tool-state", state: {} });
    requestRuntimeObjectInstanceSync();
    requestSelectableHitboxDebugSync();
  }

  // The one command path: the reducer changes the session, then the effects run in the order it listed them.
  function dispatchRuntimeCommand(command: RuntimeCommand): void {
    for (const effect of applyRuntimeCommand(session, command)) {
      runtimeEffects.run(effect);
    }
  }

  function currentMenuState() {
    return session.get().menuState;
  }
}
