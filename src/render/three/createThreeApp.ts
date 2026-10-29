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
 *    committed first (`commitReadyWorldGeometrySnapshot` -> `commitWorldGeometrySnapshot`), so the rest of the
 *    frame sees one consistent world.
 * 1. Input: `getXrInputFrame` or `getDesktopInputFrame` consume one `RuntimeInputFrame` (XR is used only when
 *    `renderer.xr.isPresenting` and the session state is `active`).
 * 2. Movement: `movePlayer` against `activeWorld()` (global coordinate frame), then
 *    `bodiesInCell`; in XR a second `movePlayer` applies physical head motion
 *    (room-scale walking). The result replaces `playerPose` and may change `playerPose.cellId` by crossing a
 *    portal. Then the camera/XR rig is synced to the pose, the aim ray is resolved, and the selected tool
 *    handles the primary/carry/interact actions. Creatures, flags and curve-shortening geodesics advance.
 * 3. Portal visibility: `updateVisibleCell` shows only the player's cell mesh, the culling cameras are placed
 *    (one per eye in stereo XR), and `computeVisiblePortalPaths` (inside `syncPortalInstanceRender` /
 *    `syncStereoPortalInstanceRender`) selects visible portal paths from the static per-root cull tables.
 * 4. Instance sync: visible paths become per-cell instanced-mesh transforms and clip-plane data
 *    (`updateCellRenderArchetypeInstances`, `portalClipData`); runtime objects (and their portal ghosts) are
 *    synced the same way by `syncRuntimeObjectPortalInstances`. UI overlays, labels, tooltips, the scene
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
 * setter callbacks it hands to the factories above). `playerPose`, `menuState`, `activeWorldBundle`,
 * `latestVisibleResult` and the tool states are replaced immutably (never edited in place). `appState`
 * supplies the initial pose, world and player body; after startup the shell's `playerPose` is authoritative
 * and `appState.playerPose` is not written back. `cellMeshes`, the render archetypes and the runtime object
 * registry are owned here and disposed by `dispose()`.
 *
 * ## XR session lifecycle
 * `enterVr` (button in `xrEntryUi`) moves `xrSessionState` available/ended/failed -> entering ->
 * active, or -> failed on error. The session's `end` event moves it to `ended` and resets the rig, palette
 * input and controller models. `requestAppRestart` ends a presenting session first via
 * `xrSessionRestartCoordinator` before invoking the host restart callback.
 *
 * ## Units and frames
 * Distances are meters and angles radians. Cell-local coordinates are x right, y forward, z up; the Three.js
 * scene uses its own axes, converted by `worldAxes` helpers (for example `rigidTransformToThreeMatrix`).
 */
import * as THREE from "three";
import { reversePainterSortStable } from "@pmndrs/uikit";
import { type AppState } from "../../appState";
import { type CellComplexSpec } from "../../cell-complex/specs";
import { buildStaticallyCulledPortalPathTables } from "../../cell-complex/staticPortalPathCull";
import { type AppConfig, defaultAppConfig, isRuntimeToolEnabled } from "../../glue/appConfig";
import { type DebugLevelId } from "../../glue/debugLevels";
import { type DebugOptionId, hasActiveDebugOption } from "../../glue/debugOptions";
import { type DebugSettings } from "../../glue/debugSettings";
import { type PortalPanelModeId } from "../../glue/portalPanelMode";
import { type LaunchOptions } from "../../glue/readLaunchOptions";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { simpleCollisionCylinder } from "../../movement/dynamicObject";
import { movePlayer } from "../../movement/movePlayer";
import { DEFAULT_PLAYER_EYE_HEIGHT_METERS } from "../../movement/playerBody";
import { type PlayerPose, playerPoseFromDynamicObject, playerPoseToDynamicObject } from "../../movement/playerPose";
import { depenetrateDynamicObject } from "../../movement/depenetrateDynamicObject";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { createAppCommandDispatcher } from "../../runtime/appCommandDispatcher";
import { type RuntimeCommand } from "../../runtime/runtimeCommands";
import {
  type RuntimeDebugOverlayItemId,
  closeRuntimeMenu,
  createDebugSettingsFromRuntimeMenuState,
  createRuntimeMenuState,
  openRuntimeMenu,
  selectRuntimeMenuPlaceFlagToolType,
  setRuntimeMenuAimCollisionOutlinesEnabled,
  setRuntimeMenuAntiNauseaModeEnabled,
  setRuntimeMenuCollisionGeometryWireframesEnabled,
  setRuntimeMenuConsoleLogLevel,
  setRuntimeMenuDebugEnabled,
  setRuntimeMenuDebugOverlayEnabled,
  setRuntimeMenuEditingFlagId,
  setRuntimeMenuEditingSignMessage,
  setRuntimeMenuGoalPageIndex,
  setRuntimeMenuPortalInspectionEnabled,
  setRuntimeMenuPortalPanelMode,
  setRuntimeMenuReloadConfirmUntilMs,
  setRuntimeMenuSelectedAppConfigName,
  setRuntimeMenuSelectedTool,
  setRuntimeMenuSelectedWorldId,
  setRuntimeMenuTutorialPageIndex,
  showRuntimeMenuDebugSettings,
  showRuntimeMenuEditSign,
  showRuntimeMenuGeodesicCannonActions,
  showRuntimeMenuGeometryComputerActions,
  showRuntimeMenuGoal,
  showRuntimeMenuMainPage,
  showRuntimeMenuPlaceFlagOptions,
  showRuntimeMenuQuestionHelp,
  showRuntimeMenuQuestionTutorial,
  showRuntimeMenuSettings,
  toggleRuntimeMenuDebugOverlayItem,
} from "../../runtime/runtimeMenuState";
import { applyGeometryCommitComputedObjectPolicy } from "../../runtime/worldGeometryComputedObjects";
import {
  createDefaultWorldDeformationFamilyRegistry,
  createInitialWorldDeformationState,
  getWorldDeformationFamilyOrThrow,
} from "../../runtime/worldGeometryDeformationFamilies";
import { type CellDeformationMap, transformPoseWithCellMaps } from "../../runtime/worldGeometryDeformations";
import { type WorldGeometrySnapshot, createWorldGeometrySession } from "../../runtime/worldGeometrySession";
import { createHelpLensDefinition } from "../../ui/helpLensDefinition";
import { createPaletteDefinition } from "../../ui/paletteDefinition";
import {
  type GeodesicCarryPortalTransition,
  advanceCurveShorteningPairs,
} from "../../world-objects/geodesicCannon";
import {
  type GeodesicMarmotRuntime,
  createGeodesicMarmotRuntime,
  isGeodesicMarmotObjectSpec,
} from "../../world-objects/geodesicMarmot";
import { createMeasuredGeodesicLengthObject } from "../../world-objects/measureLengthTool";
import {
  placeFlagAtFloorPoint,
  updatePlacedFlagFontColor,
  updatePlacedFlagMessage,
} from "../../world-objects/placedFlags";
import {
  type ProtractorCenterSelection,
  type ProtractorDirectedGeodesic,
  createProtractorAngleObject,
  protractorSelectionsUseDifferentGeodesics,
  resolveProtractorCenterSelection,
  resolveProtractorDirectedGeodesicSelection,
  resolveProtractorEmitterGeodesicSelection,
} from "../../world-objects/protractorTool";
import {
  type RuntimeWorldObject,
  createRuntimeObjectRegistry,
  createRuntimeStaticAssetObject,
  runtimeObjectToDynamicObjectState,
} from "../../world-objects/runtimeObjectRegistry";
import {
  type SimpleGeoCreatureRuntime,
  createSimpleGeoCreatureRuntime,
  isSimpleGeoCreatureObjectSpec,
} from "../../world-objects/simpleGeoCreature";
import { createDesktopFlagEditor } from "../dom/desktopFlagEditor";
import { createDesktopToolIndicator } from "../dom/desktopToolIndicator";
import { createFloatingObjectTooltip } from "../dom/floatingObjectTooltip";
import { createAimCrossMarker } from "./aimCrossMarker";
import { createAimInteraction } from "./aimInteraction";
import {
  GeometryDebugHelpers,
  WindowWithGeometryDebugHelpers,
  installGeneralDebugHelpers,
  matricesNearlyEqual,
  mergeStaticPathCounts,
  uninstallGeneralDebugHelpers,
  uninstallGeometryDebugHelpers,
  visibleSummaryToRenderState,
} from "./appDebugHelpers";
import { logDebugStartupGuide } from "./appDebugLogging";
import { XrHeadWorldPose } from "./carriedGeodesicCannon";
import {
  CellRenderArchetype,
  buildCellRenderArchetypes,
  deriveCellRenderArchetypeCapacities,
  disposeCellRenderArchetypes,
} from "./cellRenderArchetypes";
import { createDebugOverlay } from "./debugOverlay";
import { createDebugVisualization } from "./debugVisualization";
import { createDesktopControls } from "./desktopControls";
import {
  createDesktopScenePaletteInput,
  reduceDesktopScenePaletteToggle,
} from "./desktopScenePaletteInput";
import { resolveDesktopScenePalettePlacement } from "./desktopScenePalettePlacement";
import {
  captureWebGlRenderInfo,
  createInitialXrDebugState,
  smoothFramePerformance,
} from "./frameDiagnostics";
import {
  collectGeodesicRuntimeRenderRecords,
  createGeodesicRuntimeRenderSources,
} from "./geodesicCannonRenderer";
import { GeodesicCannonToolState, createGeodesicCannonTools } from "./geodesicCannonTools";
import { resolveGeodesicCarryPortalTransitionsFromCrossings } from "./geodesicCarryPortalTransition";
import { createGeodesicDebugDumps } from "./geodesicDebugDumps";
import { createGeodesicEmitterLabelController } from "./geodesicEmitterLabelController";
import { createGeometryComputerMenu } from "./geometryComputerMenu";
import { createHelpLensRenderer } from "./helpLensRenderer";
import { MeasuredGeodesicLengthRuntime } from "./measureLengthRenderer";
import { PlacedFlagRuntime } from "./placedFlagRenderer";
import { createPlayerRoverRenderModel } from "./playerRoverModel";
import { createPortalClipData } from "./portalClipData";
import {
  createPortalClipMaterialState,
  updatePortalClipMaterialTextureEye,
  updatePortalClipMaterialViewport,
  updatePortalClipMaterialViewportFromRenderer,
} from "./portalClipMaterial";
import { createPortalClipPolygonOverlay } from "./portalClipPolygonOverlay";
import { PortalDebugRuntimeDeps, createPortalDebugRuntime } from "./portalDebugRuntime";
import {
  PortalEyeRenderState,
  buildUnionVisiblePathById,
  remapStereoPortalPathIds,
  transformVisiblePortalResultToRenderFrame,
} from "./portalEyeFrameTransforms";
import {
  PortalInstanceDebugRenderer,
  createPortalInstanceDebugRenderer,
} from "./portalInstanceDebug";
import { PreparedWorldAssets } from "./preloadWorldAssets";
import { prerenderCells } from "./prerenderCells";
import { ProtractorAngleRuntime } from "./protractorAngleRenderer";
import { createProtractorToolFeedback } from "./protractorToolFeedback";
import { renderCameraFarMeters, renderCameraNearMeters } from "./renderCameraClip";
import {
  PortalInstanceRenderDebugState,
  buildVisiblePathsByDestinationCell,
  createPortalInstanceDiagnostics,
  createPortalInstanceRenderDebugState,
  flattenVisiblePortalPathGroups,
  groupVisiblePortalPathsByDestinationCell,
  updateCellRenderArchetypeInstances,
  updateRuntimeObjectRenderArchetypeInstances,
} from "./renderPortalInstances";
import {
  getPortalViewportPixels,
  getWindowCssCanvasSize,
  portalClipEdgeSmoothingEnabled,
  renderAntialiasRequested,
  resolveRenderQualityPixelRatio,
} from "./renderQuality";
import {
  FramePerformanceRenderState,
  PortalEyeRenderDebugState,
  RuntimeInputFrame,
  WebGlRenderInfoState,
  XrDebugRenderState,
} from "./renderState";
import { RootAimRay } from "./rootAimRay";
import { createFrameErrorGuard } from "./frameErrorGuard";
import { installRuntimeDiagnostics, runtimeDiagnostics } from "./runtimeDiagnostics";
import { collectPortalGhostRuntimeObjectRenderRecords } from "./runtimeObjectGhostRecords";
import {
  RuntimeObjectRenderArchetype,
  buildRuntimeObjectRenderArchetype,
  createRuntimeObjectRenderArchetypeDiagnostics,
  deriveRuntimeObjectRenderArchetypeCapacity,
  disposeRuntimeObjectRenderArchetypes,
  groupRuntimeObjectRenderRecordsByArchetype,
} from "./runtimeObjectRenderArchetypes";
import {
  RuntimeObjectRenderRecord,
  RuntimeObjectRenderSourceMesh,
  collectRuntimeObjectRenderSourceMeshes,
} from "./runtimeObjectRenderRecords";
import {
  buildCurrentCellForbiddenZoneWireframes,
  createCellWarmupViews,
  disableFrustumCulling,
  disableShadows,
  disposeCanvasTextures,
  disposeObject3D,
  isGeodesicRuntimeRenderObject,
  runtimeObjectArchetypeKeyPrefix,
  transformYawWithMap,
  yawFromPose,
} from "./runtimeSceneUtils";
import { SCENE_BACKGROUND_COLOR } from "./sceneColors";
import {
  createStylizedSceneLighting,
  disposeStylizedSceneLighting,
  updateStylizedSceneLighting,
} from "./sceneLighting";
import { createScenePaletteController } from "./scenePaletteController";
import { createToolObjectRuntimes } from "./toolObjectRuntimes";
import { createUnderCellInfinityFloor } from "./underCellFloor";
import {
  ComputeVisiblePortalPathsResult,
  VisiblePortalPath,
  computeIndependentVisiblePortalPaths,
  computeVisiblePortalPaths,
} from "./visiblePortalPaths";
import {
  VrComfortOptions,
  createVrComfortVignette,
  isArtificialLocomotionActive,
} from "./vrComfort";
import { resolveVrPalettePlacement } from "./vrPalettePlacement";
import { rigidTransformToThreeMatrix } from "./worldAxes";
import { createXrControllerHandModels } from "./xrControllerHandModels";
import { createXrControls } from "./xrControls";
import { createXrEntryUi } from "./xrEntryUi";
import { createXrObjectTooltipController } from "./xrObjectTooltipController";
import {
  createXrPlayerRig,
  headLocalMetersFromViewerPose,
  headYawRadiansFromViewerPose,
  xrRigidTransformLocalMatrix,
} from "./xrPlayerRig";
import { XrPortalEyeRenderRoot, resolveXrPortalEyeRenderRoot } from "./xrPortalEye";
import { createXrScenePaletteInput } from "./xrScenePaletteInput";
import { createXrSessionRestartCoordinator } from "./xrSessionRestart";
import {
  XrSessionState,
  createXrSessionState,
  detectXrSessionState,
  transitionXrSessionState,
} from "./xrSessionState";

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

// Per-geometry-snapshot data derived once in createActiveWorldBundle and replaced as a whole on each commit.
interface ActiveWorldBundle {
  readonly snapshot: WorldGeometrySnapshot;
  readonly archetypeCapacitiesByCellId: ReadonlyMap<string, number>;
  readonly warmupViewsByCellId: ReadonlyMap<string, ReturnType<typeof createCellWarmupViews>>;
}

// Time (milliseconds) within which a second reload request counts as confirmation.
const reloadConfirmationWindowMs = 2000;
// Consecutive failed frames (about half a second at 60-90 Hz) before an immersive session is ended.
const MAX_CONSECUTIVE_FAILED_FRAMES = 30;
// Module-level scratch objects for resolveXrHeadWorldPose; the returned pose aliases them, so it is valid
// only until the next call and must not be stored.
const xrHeadWorldMatrix = new THREE.Matrix4();
const xrHeadWorldPosition = new THREE.Vector3();
const xrHeadWorldQuaternion = new THREE.Quaternion();
const xrHeadWorldScale = new THREE.Vector3();

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
  let vrComfortOptions = options.vrComfortOptions;
  const xrControls = createXrControls(vrComfortOptions);
  const xrRig = createXrPlayerRig(camera, vrComfortOptions);
  scene.add(xrRig.root);
  const vrComfortVignette = createVrComfortVignette(camera, vrComfortOptions);
  const clock = new THREE.Clock();
  /** Longest simulation step per frame, in seconds; longer wall-clock gaps (hidden tab, debugger pause) are treated as this long. */
  const maxSimulationStepSeconds = 0.1;
  // Authoritative player pose (cell id, cell-local position in meters, yaw in radians). Written only in
  // renderFrame (movement), transformPlayerForGeometryCommit and the reset/teleport helpers; factories read it
  // through getPlayerPose getters.
  let playerPose = appState.playerPose;
  // Incremented once per rendered frame; keys the per-frame aim-ray cache.
  let aimFrameSerial = 0;
  // XR availability/session status. Written by the async detect call, enterVr, the session "end" listener
  // and requestAppRestart failure handling; read by renderFrame to choose the XR or desktop path.
  let xrSessionState: XrSessionState = createXrSessionState("unknown", {
    secureContext: window.isSecureContext,
  });
  let xrDebugState: XrDebugRenderState = createInitialXrDebugState(xrSessionState, playerPose);
  // Debug settings mirror: seeded from options, replaced by applyDebugSettings (menu or updateDebugSettings).
  let debugLevel = options.debugLevel;
  let portalPanelMode = options.portalPanelMode;
  let debugOptions = options.debugOptions;
  let smoothedFrameRateFps: number | undefined;
  let smoothedFramePerformance: FramePerformanceRenderState | undefined;
  let latestWebGlRenderInfo: WebGlRenderInfoState | undefined;
  let showCellPathRendersInstances = hasActiveDebugOption(
    debugLevel,
    debugOptions,
    "portal-path-overlay-instances",
  );
  // Runtime menu state (page, selected tool, debug toggles). Replaced immutably by menu callbacks and
  // frame-loop code in this closure; shared with factories via getMenuState/setMenuState.
  let menuState = createRuntimeMenuState({
    selectedWorldId: options.selectedWorldId,
    selectedAppConfigName: options.appConfigName,
    debugSettings: {
      debugLevel: options.debugLevel,
      portalPanelMode: options.portalPanelMode,
      debugOptions: options.debugOptions,
    },
    debugOverlayEnabled: options.debugOverlayEnabled,
    debugOverlayItems: options.debugOverlayItems,
    vrComfortOptions,
  });
  let previousDesktopPalettePlacement: ReturnType<typeof resolveDesktopScenePalettePlacement> | undefined;
  let reloadConfirmationTimeout: number | undefined;
  // Disposal bookkeeping: `disposed` neutralises late XR 'end' events; the session/cleanup pair is set by enterVr.
  let disposed = false;
  // Frame error containment (see the module header). `frameDrawn` tells recovery whether the failed frame
  // already reached `renderer.render`.
  const frameErrorGuard = createFrameErrorGuard({
    maxConsecutiveFailures: MAX_CONSECUTIVE_FAILED_FRAMES,
    report: reportFrameError,
    onPersistentFailure: endXrSessionAfterPersistentFrameFailure,
  });
  let frameDrawn = false;
  let activeXrSession: XRSession | undefined;
  let xrSessionEndHandlerCleanup: (() => void) | undefined;
  const xrSessionRestartCoordinator = createXrSessionRestartCoordinator();
  const debugOverlay = createDebugOverlay(container);
  const commandDispatcher = createAppCommandDispatcher({
    reloadWorld() {
      requestAppRestart(() => options.onReloadRequested?.());
    },
    goHome() {
      teleportPlayerHome();
    },
    changeWorld(worldId) {
      requestAppRestart(() => options.onWorldChangeRequested?.(worldId));
    },
    setDebugOverlayEnabled(enabled) {
      applyMenuDebugState(setRuntimeMenuDebugOverlayEnabled(menuState, enabled));
    },
  });
  const desktopToolIndicator = createDesktopToolIndicator(document.body);
  const desktopScenePaletteInput = createDesktopScenePaletteInput();
  const xrScenePaletteInput = createXrScenePaletteInput();
  const xrControllerHandModels = createXrControllerHandModels(scene);
  const runtimeObjectRegistry = createRuntimeObjectRegistry();
  const desktopFlagEditor = createDesktopFlagEditor(document.body, {
    onMessageChanged(flagId, message) {
      const flag = runtimeObjectRegistry.get(flagId);
      if (flag?.kind !== "placed-flag") {
        return;
      }

      const nextFlag = updatePlacedFlagMessage(flag, message);
      runtimeObjectRegistry.update(nextFlag);
      syncPlacedFlagRuntime(nextFlag);
    },
    onFontColorChanged(flagId, fontColor) {
      const flag = runtimeObjectRegistry.get(flagId);
      if (flag?.kind !== "placed-flag") {
        return;
      }

      const nextFlag = updatePlacedFlagFontColor(flag, fontColor);
      runtimeObjectRegistry.update(nextFlag);
      syncPlacedFlagRuntime(nextFlag);
    },
    onDeleteRequested(flagId) {
      const flag = runtimeObjectRegistry.get(flagId);
      if (flag?.kind !== "placed-flag") {
        return;
      }

      runtimeObjectRegistry.remove(flagId);
      removePlacedFlagRuntime(flagId);
      syncRuntimeObjectPortalInstances();
    },
    onClosed() {
      menuState = setRuntimeMenuEditingFlagId(menuState, undefined);
      syncDesktopPalette();
      void controls.requestPointerLock();
    },
  });
  const aimCrossMarker = createAimCrossMarker(scene);
  const aimControllerRayPositions = new Float32Array(6);
  const aimControllerRayGeometry = new THREE.BufferGeometry();
  aimControllerRayGeometry.setAttribute("position", new THREE.BufferAttribute(aimControllerRayPositions, 3));
  const aimControllerRayMaterial = new THREE.LineBasicMaterial({
    color: 0xef1b1b,
    transparent: true,
    opacity: 0.74,
    depthTest: false,
    depthWrite: false,
  });
  const aimControllerRay = new THREE.Line(aimControllerRayGeometry, aimControllerRayMaterial);
  aimControllerRay.name = "aim-controller-ray";
  aimControllerRay.renderOrder = 49;
  aimControllerRay.frustumCulled = false;
  aimControllerRay.visible = false;
  scene.add(aimControllerRay);
  const floatingObjectTooltip = createFloatingObjectTooltip(document.body);
  const helpLensRenderer = createHelpLensRenderer(document.body, scene);
  const xrEntryUi = createXrEntryUi(container, enterVr);
  const clipPolygonOverlay = createPortalClipPolygonOverlay(container);
  const sceneLighting = createStylizedSceneLighting(scene);
  const scenePaletteController = createScenePaletteController({
    scene,
    getCamera: () => camera,
    getIsOpen: () => menuState.isOpen,
    onOpenRequested() {
      menuState = openRuntimeMenu(menuState);
      syncDesktopPalette();
    },
    onCloseRequested() {
      cancelRuntimeMenuAndSelectedTool();
    },
    onShowSettingsRequested() {
      menuState = showRuntimeMenuSettings(menuState);
      syncDesktopPalette();
    },
    onShowMainRequested() {
      menuState = menuState.page === "debug-settings"
        ? showRuntimeMenuSettings(menuState)
        : menuState.page === "tutorial" || menuState.page === "goal"
          ? showRuntimeMenuQuestionHelp(menuState)
          : showRuntimeMenuMainPage(menuState);
      syncDesktopPalette();
    },
    onWorldSelected(worldId) {
      if (!appConfig.menu.worldSelectionSectionEnabled) {
        return;
      }
      menuState = setRuntimeMenuSelectedWorldId(menuState, worldId);
      syncDesktopPalette();
      requestAppRestart(() => options.onWorldChangeRequested?.(worldId));
    },
    onConfigSelected(configName) {
      if (!appConfig.menu.configSelectionSectionEnabled) {
        return;
      }
      menuState = setRuntimeMenuSelectedAppConfigName(menuState, configName);
      syncDesktopPalette();
      requestAppRestart(() => options.onAppConfigChangeRequested?.(configName));
    },
    onReloadRequested() {
      requestConfirmedReload();
    },
    onHomeRequested() {
      dispatchRuntimeCommand({ kind: "go-home" });
    },
    onDebugEnabledChanged(enabled) {
      if (!appConfig.menu.debugSectionEnabled) {
        return;
      }
      applyMenuDebugState(setRuntimeMenuDebugEnabled(menuState, enabled));
    },
    onDebugSettingsRequested() {
      if (!appConfig.menu.debugSectionEnabled) {
        return;
      }
      menuState = showRuntimeMenuDebugSettings(menuState);
      syncDesktopPalette();
    },
    onConsoleLogLevelSelected(level) {
      applyMenuDebugState(setRuntimeMenuConsoleLogLevel(menuState, level));
    },
    onDebugOverlayToggled(enabled) {
      applyMenuDebugState(setRuntimeMenuDebugOverlayEnabled(menuState, enabled));
    },
    onDebugOverlayItemToggled(itemId, enabled) {
      applyMenuDebugState(toggleRuntimeMenuDebugOverlayItem(menuState, itemId, enabled));
    },
    onAntiNauseaModeToggled(enabled) {
      applyMenuComfortState(setRuntimeMenuAntiNauseaModeEnabled(menuState, enabled));
    },
    onPortalPanelModeSelected(mode) {
      applyMenuDebugState(setRuntimeMenuPortalPanelMode(menuState, mode));
    },
    onPortalInspectionToggled(enabled) {
      applyMenuDebugState(setRuntimeMenuPortalInspectionEnabled(menuState, enabled));
    },
    onCollisionGeometryWireframesToggled(enabled) {
      applyMenuDebugState(setRuntimeMenuCollisionGeometryWireframesEnabled(menuState, enabled));
    },
    onAimCollisionOutlinesToggled(enabled) {
      applyMenuDebugState(setRuntimeMenuAimCollisionOutlinesEnabled(menuState, enabled));
    },
    onCopyUrlWithOptionsRequested() {
      options.onCopyUrlWithOptionsRequested?.();
    },
    onToolSelected(toolId) {
      if (!isRuntimeToolEnabled(appConfig, toolId)) {
        return;
      }
      if (toolId !== "protractor") {
        activeProtractorToolState = {};
        clearProtractorToolFeedback();
      }
      if (toolId !== "geodesic-cannon-tie-detach") {
        syncTieAndDetachSelectionHighlights([]);
        syncRuntimeObjectPortalInstances();
        activeGeodesicCannonToolState = {
          ...activeGeodesicCannonToolState,
          tieAndDetachEndpointSelections: undefined,
        };
      }
      menuState = closeRuntimeMenu(setRuntimeMenuSelectedTool(menuState, toolId));
      syncDesktopPalette();
    },
    onPlaceFlagOptionsRequested() {
      if (!isRuntimeToolEnabled(appConfig, "place-flag")) {
        return;
      }
      menuState = showRuntimeMenuPlaceFlagOptions(menuState);
      syncDesktopPalette();
    },
    onPlaceFlagTypeSelected(flagType) {
      if (!isRuntimeToolEnabled(appConfig, "place-flag")) {
        return;
      }
      menuState = closeRuntimeMenu(selectRuntimeMenuPlaceFlagToolType(menuState, flagType));
      syncDesktopPalette();
    },
    onGeodesicCannonAddRequested(cannonId) {
      if (!isRuntimeToolEnabled(appConfig, "geodesic-cannon")) {
        return;
      }
      addGeodesicToCannon(cannonId);
    },
    onGeodesicCannonCarryRequested(cannonId) {
      if (!isRuntimeToolEnabled(appConfig, "geodesic-cannon-carry")) {
        return;
      }
      startGeodesicCannonCarry(cannonId);
    },
    onGeodesicCannonTieAndDetachRequested(cannonId) {
      if (!isRuntimeToolEnabled(appConfig, "geodesic-cannon-tie-detach")) {
        return;
      }
      startGeodesicCannonTieAndDetach(cannonId);
    },
    onGeodesicCannonRotateRequested(cannonId, geodesicId) {
      if (!isRuntimeToolEnabled(appConfig, "geodesic-cannon-rotate")) {
        return;
      }
      startGeodesicCannonRotation(cannonId, geodesicId);
    },
    onGeodesicCannonAimRequested(cannonId, geodesicId) {
      if (!isRuntimeToolEnabled(appConfig, "geodesic-cannon-aim")) {
        return;
      }
      startGeodesicCannonAim(cannonId, geodesicId);
    },
    onGeodesicCannonDeleteRequested(cannonId, geodesicId) {
      deleteGeodesicFromCannon(cannonId, geodesicId);
    },
    onGeometryComputerSetTargetRequested(computerId, target) {
      setGeometryComputerPendingTarget(computerId, target);
    },
    onGeometryComputerStepTargetRequested(computerId, axis, deltaMeters) {
      stepGeometryComputerPendingTarget(computerId, axis, deltaMeters);
    },
    onGeometryComputerGoRequested(computerId) {
      startGeometryComputerDeformation(computerId);
    },
    onQuestionHelpTutorialRequested() {
      menuState = showRuntimeMenuQuestionTutorial(menuState);
      syncDesktopPalette();
    },
    onQuestionHelpGoalRequested() {
      menuState = showRuntimeMenuGoal(menuState);
      syncDesktopPalette();
    },
    onTutorialPreviousRequested() {
      stepOpenTutorialPage(-1);
    },
    onTutorialNextRequested() {
      stepOpenTutorialPage(1);
    },
    onGoalPreviousRequested() {
      stepOpenGoalPage(-1);
    },
    onGoalNextRequested() {
      stepOpenGoalPage(1);
    },
    onSignKeyboardCharacter(character) {
      appendEditingSignCharacter(character);
    },
    onSignKeyboardBackspace() {
      backspaceEditingSignMessage();
    },
    onSignDeleteRequested() {
      deleteEditingSign();
    },
  });

  // One Three.js group per cell id (cell-local frame), rebuilt by rebuildCellMeshes. Only the group of the
  // player's cell is visible; runtime objects are parented into these groups via syncParent(cellMeshes).
  const cellMeshes = new Map<string, THREE.Object3D>();
  // Portal path search limits: depth in portal hops, counts of paths, tolerance in meters.
  const rootRenderPathMaxDepth = 10;
  const maxVisiblePaths = 2_000;
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
  // Current world snapshot plus derived render data. Replaced only by commitWorldGeometrySnapshot (at the
  // start of a frame); every other reader goes through activeWorld()/activeStaticCull().
  let activeWorldBundle = createActiveWorldBundle(initialWorldSnapshot);
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
  const activeWorld = () => activeWorldBundle.snapshot.world;
  const activeStaticCull = () => activeWorldBundle.snapshot.staticCull;

  function createActiveWorldBundle(snapshot: WorldGeometrySnapshot): ActiveWorldBundle {
    return {
      snapshot,
      archetypeCapacitiesByCellId: deriveCellRenderArchetypeCapacities(
        snapshot.world,
        snapshot.staticCull,
        maxVisiblePaths,
      ),
      warmupViewsByCellId: new Map(
        snapshot.world.cells.map((cell) => [cell.id, createCellWarmupViews(cell)] as const),
      ),
    };
  }

  const dynamicObjectRuntimes: Array<GeodesicMarmotRuntime | SimpleGeoCreatureRuntime> = [];
  const placedFlagRuntimes = new Map<string, PlacedFlagRuntime>();
  const measuredGeodesicLengthRuntimes = new Map<string, MeasuredGeodesicLengthRuntime>();
  const protractorAngleRuntimes = new Map<string, ProtractorAngleRuntime>();
  let placedFlagIdCounter = 0;
  let measuredGeodesicLengthIdCounter = 0;
  let protractorAngleIdCounter = 0;
  let activeGeodesicCannonToolState: GeodesicCannonToolState = {};
  let activeProtractorToolState: {
    readonly center?: ProtractorCenterSelection;
    readonly first?: ProtractorDirectedGeodesic;
  } = {};
  let protractorToolFeedback: {
    readonly signature: string;
    readonly cellId: string;
    readonly root: THREE.Group;
  } | undefined;
  let helpLensFocusedObjectId: string | undefined;
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
  const portalInstanceDiagnostics = createPortalInstanceDiagnostics();
  const portalClipData = createPortalClipData({ maxVisiblePaths });
  const portalClipMaterialState = createPortalClipMaterialState(
    portalClipData,
    getPortalViewportPixels(renderer),
    { smoothClipEdges: options.renderQualityEnabled && portalClipEdgeSmoothingEnabled },
  );
  // Portal visibility results for the current frame. Written by syncPortalInstanceRender /
  // syncStereoPortalInstanceRender (and cleared on geometry commit); read by debug and tooltip code.
  let latestVisibleResult: ComputeVisiblePortalPathsResult | undefined;
  // Per-eye results in stereo XR (empty on desktop); activePortalEyeIndex is set while rendering each eye in
  // onBeforeRender via activatePortalRenderStateForCamera.
  let portalEyeRenderStates: readonly PortalEyeRenderState[] = [];
  let activePortalEyeIndex = 0;
  // Append-only log of the player's portal crossings, newest last, at most 64 entries. Serials increase by 1 per
  // crossing and are never reused, so consumers (geodesic cannon carry) can fold every crossing they have not seen.
  let playerPortalTransitionLog: { readonly serial: number; readonly transition: GeodesicCarryPortalTransition }[] = [];
  let latestPlayerPortalTransitionSerial = 0;
  function recordPlayerPortalTransitionInLog(transition: GeodesicCarryPortalTransition): void {
    latestPlayerPortalTransitionSerial += 1;
    playerPortalTransitionLog.push({ serial: latestPlayerPortalTransitionSerial, transition });
    if (playerPortalTransitionLog.length > 64) {
      playerPortalTransitionLog = playerPortalTransitionLog.slice(-64);
    }
  }
  function latestPlayerPortalTransition(): GeodesicCarryPortalTransition | undefined {
    return playerPortalTransitionLog.at(-1)?.transition;
  }
  let portalInstanceRenderState: PortalInstanceRenderDebugState = {
    enabled: true,
    ShowCellPathRendersInstances: showCellPathRendersInstances,
    archetypeCount: 0,
    totalCapacity: 0,
    renderedInstanceCount: 0,
    renderedInstanceCountByCell: [],
    capacityOverflowCount: 0,
    capacityOverflowArchetypes: [],
    normalVisiblePathRenderingActive: false,
    visiblePathIds: [],
    visiblePathDestinations: [],
    clipPolygonVertexCountsByPath: [],
    clipPolygonOverflowPathIds: [],
    visiblePathOverflowCount: 0,
  };
  let cellRenderArchetypes: readonly CellRenderArchetype[] = [];
  let portalInstanceDebugRenderer: PortalInstanceDebugRenderer | undefined;
  // Id of the cell whose group in cellMeshes is currently visible; updated by updateVisibleCell.
  let visibleCellId: string | undefined = playerPose.cellId;

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
    getDebugLevel: () => debugLevel,
    getMenuState: () => menuState,
    getVisibleCellId: () => visibleCellId,
    getCannonToolState: () => activeGeodesicCannonToolState,
    getLatestPlayerPortalTransition: latestPlayerPortalTransition,
    resolveCameraAimTarget: () => resolveCurrentAimTarget(resolveCameraRootRay()),
  });

  const {
    createGeometryComputerMenuOptions,
    refreshOpenGeometryComputerMenu,
    setGeometryComputerPendingTarget,
    stepGeometryComputerPendingTarget,
    startGeometryComputerDeformation,
  } = createGeometryComputerMenu({
    geometrySession,
    getMenuState: () => menuState,
    setMenuState: (next) => {
      menuState = next;
    },
    syncDesktopPalette,
  });

  const { syncDynamicObjectDebugWireframes, syncStaticObjectCollisionWireframes, syncSelectableHitboxDebug } =
    createDebugVisualization({
      runtimeObjectRegistry,
      dynamicObjectRuntimes,
      cellMeshes,
      staticObjectCollisionWireframeGroupsByCellId,
      selectableHitboxDebugGroupsByCellId,
      aimCollisionOutlineDebugGroupsByCellId,
      getWorld: activeWorld,
      getDebugLevel: () => debugLevel,
      getDebugOptions: () => debugOptions,
    });

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
    getPlayerPose: () => playerPose,
    resetProtractorToolState: () => {
      activeProtractorToolState = {};
    },
    clearProtractorToolFeedback,
    syncRuntimeObjectPortalInstances,
    syncSelectableHitboxDebug,
  });

  const { updateGeodesicEmitterLabels, getGeodesicDisplayName, getGeodesicLabelsById } =
    createGeodesicEmitterLabelController({
      scene,
      camera,
      runtimeObjectRegistry,
      geodesicEmitterLabelsByKey,
      getPlayerPose: () => playerPose,
    });

  const { updateXrObjectTooltip, clearXrObjectTooltip } = createXrObjectTooltipController({ scene, camera });

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
    camera,
    renderer,
    xrRig,
    runtimeObjectRegistry,
    getWorld: activeWorld,
    getDebugLevel: () => debugLevel,
    getMenuState: () => menuState,
    getCannonToolState: () => activeGeodesicCannonToolState,
    getPlayerPose: () => playerPose,
    getFrameSerial: () => aimFrameSerial,
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
    clearCarriedGeodesicCannonGlow,
    updateActiveGeodesicCannonRotation,
    updateActiveGeodesicCannonAim,
    getLockedGeodesicIds,
    freezeXrHeadHeightDuringGeodesicCannonRotation,
    resetGeodesicCannonRotationTracking,
  } = createGeodesicCannonTools({
    scene,
    renderer,
    controls,
    runtimeObjectRegistry,
    getWorld: activeWorld,
    getMenuState: () => menuState,
    setMenuState: (next) => {
      menuState = next;
    },
    getCannonToolState: () => activeGeodesicCannonToolState,
    setCannonToolState: (next) => {
      activeGeodesicCannonToolState = next;
    },
    getPlayerPose: () => playerPose,
    getDebugLevel: () => debugLevel,
    getLatestPlayerPortalTransition: latestPlayerPortalTransition,
    getLatestPlayerPortalTransitionSerial: () => latestPlayerPortalTransitionSerial,
    getPlayerPortalTransitionsSince: (serial) =>
      playerPortalTransitionLog.filter((entry) => entry.serial > serial),
    recordPlayerPortalTransition: recordPlayerPortalTransitionInLog,
    resolveCurrentAimTarget,
    resolveCurrentAimTargets,
    targetIsWithinInteractionRange,
    logVerboseAimClick,
    findFocusedRuntimeObject,
    getGeodesicLabelsById,
    syncDesktopPalette,
    syncRuntimeObjectPortalInstances,
    syncSelectableHitboxDebug,
    refreshMeasuredGeodesicLengthsForGeodesic,
    removeMeasuredGeodesicLengthsForGeodesic,
    removeProtractorAnglesForGeodesic,
    removeProtractorAnglesForMissingVertices,
    refreshProtractorAnglesForGeodesic,
    refreshProtractorAnglesForGeodesics,
  });

  // Initial build: cell groups and archetypes, camera pose, first visibility pass (before any frame runs).
  rebuildCellMeshes();
  applyDesktopCameraPose();
  syncPortalInstanceRender();
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
    createPortalEyeDebugStates,
    live: () => ({
      debugLevel,
      debugOptions,
      playerPose,
      latestVisibleResult,
      portalInstanceDebugRenderer,
      portalInstanceRenderState,
      showCellPathRendersInstances,
      menuState,
      smoothedFrameRateFps,
      smoothedFramePerformance,
      latestWebGlRenderInfo,
      xrDebugState,
    }),
    setShowCellPathRendersInstances: (value) => {
      showCellPathRendersInstances = value;
    },
  };

  let portalDebugRuntime = createPortalDebugRuntime(portalDebugRuntimeDeps);
  logDebugStartupGuide(debugLevel, debugOptions);
  installGeneralDebugHelpers({
    debugHelp: () => logDebugStartupGuide(debugLevel, debugOptions),
    dumpGeodesicCreatures: dumpGeodesicCreatures,
    dumpAllGeodesics: dumpAllGeodesics,
    dumpGeodesicPath: dumpGeodesicPath,
    dumpLockedGeodesicWords: dumpLockedGeodesicWords,
  });
  installGeometryDebugHelpersIfAvailable();
  syncDesktopPalette();

  // Instantiate the world's authored objects: creatures become per-frame updated runtimes, collidable assets
  // become static registry objects.
  for (const cell of activeWorld().cells) {
    for (const objectSpec of cell.objects) {
      if (isGeodesicMarmotObjectSpec(objectSpec)) {
        const runtime = createGeodesicMarmotRuntime(objectSpec, cell.id, options.assets, runtimeObjectRegistry);
        runtime.syncParent(cellMeshes);
        dynamicObjectRuntimes.push(runtime);
        runtimeObjectRootsById.set(runtime.objectId, runtime.root);
        syncDynamicObjectDebugWireframes();
        continue;
      }

      if (isSimpleGeoCreatureObjectSpec(objectSpec)) {
        const runtime = createSimpleGeoCreatureRuntime(objectSpec, cell.id, options.assets, runtimeObjectRegistry);
        runtime.syncParent(cellMeshes);
        dynamicObjectRuntimes.push(runtime);
        runtimeObjectRootsById.set(runtime.objectId, runtime.root);
        syncDynamicObjectDebugWireframes();
        continue;
      }

      if (objectSpec.kind === "asset" && objectSpec.collision) {
        runtimeObjectRegistry.add(createRuntimeStaticAssetObject(objectSpec, cell.id));
      }
    }
  }
  syncStaticObjectCollisionWireframes();
  syncRuntimeObjectPortalInstances();
  disableFrustumCulling(scene);
  disableShadows(scene);

  // Places the camera from playerPose (desktop mode) and updates the scene lighting to follow it.
  function applyDesktopCameraPose(): void {
    xrRig.syncDesktopCamera(playerPose);
    updateStylizedSceneLighting(sceneLighting, camera);
  }

  // Asynchronous WebXR capability probe; it may resolve after the first frames, updating the entry button.
  void detectXrSessionState(navigator, window.isSecureContext).then((state) => {
    xrSessionState = state;
    xrEntryUi.update(xrSessionState);
    syncXrDebugState("desktop");
  });
  xrEntryUi.update(xrSessionState);

  // Startup shader/cell warmup render so the first visible frames do not stall on compilation.
  const warmupStartMs = performance.now();
  prerenderCells({
    renderer,
    scene,
    camera,
    cellMeshes,
    activeCellId: playerPose.cellId,
    warmupViewsByCellId: activeWorldBundle.warmupViewsByCellId,
  });
  runtimeDiagnostics().recordWarmup("startup", performance.now() - warmupStartMs);

  // Shows only the mesh group of the player's current cell; cheap no-op when the cell did not change.
  function updateVisibleCell(): void {
    if (visibleCellId === playerPose.cellId) {
      return;
    }

    for (const [cellId, cellMesh] of cellMeshes) {
      cellMesh.visible = cellId === playerPose.cellId;
    }

    visibleCellId = playerPose.cellId;
  }

  // Window resize handler: updates camera aspect, renderer size and the portal clip viewport (pixels).
  function onResize(): void {
    const canvasSize = getWindowCssCanvasSize(window);
    camera.aspect = canvasSize.width / canvasSize.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(canvasSize.width, canvasSize.height);
    updatePortalClipMaterialViewport(
      portalClipMaterialState,
      getPortalViewportPixels(renderer),
    );
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
    commitReadyWorldGeometrySnapshot();
    // Phase 1: input. Head pose is in the XR local-floor reference space (meters / radians), not cell frame.
    const xrActive = renderer.xr.isPresenting && xrSessionState.status === "active";
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
    const rotatingGeodesicCannon = menuState.selectedTool === "geodesic-cannon-rotate";
    const aimingGeodesicCannon = menuState.selectedTool === "geodesic-cannon-aim";
    const effectiveHeadLocalMeters = rotatingGeodesicCannon && xrActive
      ? freezeXrHeadHeightDuringGeodesicCannonRotation(headLocalMeters)
      : headLocalMeters;
    resetGeodesicCannonRotationTracking({ rotating: rotatingGeodesicCannon, aiming: aimingGeodesicCannon });
    const frameAfterInputMs = performance.now();
    const frameBeforeMoveMs = frameAfterInputMs;
    const previousCellId = playerPose.cellId;
    let moveResult: ReturnType<typeof movePlayer> | undefined;

    // Phase 2: movement. A reset request skips movement entirely (moveResult stays undefined).
    if (frame.resetRequested) {
      teleportPlayerHome();
      resetRuntimeWorld();
    } else {
      const yawDeltaRadians = xrActive
        ? xrRig.resolveCameraYawRadians(headLocalYawRadians) - playerPose.yawRadians + frame.yawDeltaRadians
        : frame.yawDeltaRadians;
      const playerYawDeltaRadians = rotatingGeodesicCannon ? 0 : yawDeltaRadians;
      moveResult = movePlayer({
        world: activeWorld(),
        pose: playerPose,
        body: appState.playerBody,
        localDisplacement: rotatingGeodesicCannon ? { x: 0, y: 0, z: 0 } : frame.localDisplacement,
        yawDeltaRadians: playerYawDeltaRadians,
        pitchDeltaRadians: rotatingGeodesicCannon ? 0 : frame.pitchDeltaRadians,
        coordinateFrame: "global",
        bodiesInCell: playerBlockingBodiesInCell,
      });
      playerPose = moveResult.pose;
      recordCellTransition(previousCellId, moveResult);

      // XR only: apply the player's physical (room-scale) head displacement as a second move, so walking in
      // the room also crosses portals and collides; the rig then accepts or rejects that physical move.
      if (xrActive && !rotatingGeodesicCannon) {
        const beforePhysicalCellId = playerPose.cellId;
        const physicalReferenceSpaceYawRadians = playerPose.yawRadians - (headLocalYawRadians ?? 0);
        const physicalFrame = xrRig.consumePhysicalInput(
          effectiveHeadLocalMeters,
          playerPose.yawRadians,
          physicalReferenceSpaceYawRadians,
        );
        const physicalMoveResult = movePlayer({
          world: activeWorld(),
          pose: playerPose,
          body: appState.playerBody,
          localDisplacement: physicalFrame.localDisplacement,
          yawDeltaRadians: 0,
          pitchDeltaRadians: 0,
          coordinateFrame: "global",
          bodiesInCell: playerBlockingBodiesInCell,
        });
        const runtimeCollisionPhysicalMoveResult = physicalMoveResult;
        playerPose = runtimeCollisionPhysicalMoveResult.pose;
        xrRig.acceptPhysicalMove(runtimeCollisionPhysicalMoveResult, effectiveHeadLocalMeters);
        moveResult = runtimeCollisionPhysicalMoveResult.blocked || runtimeCollisionPhysicalMoveResult.crossedPortal
          ? runtimeCollisionPhysicalMoveResult
          : moveResult;
        recordCellTransition(beforePhysicalCellId, runtimeCollisionPhysicalMoveResult);
      }
    }

    // Pose the camera/rig from the new playerPose first, so aim rays and carried objects use this frame's view.
    if (xrActive) {
      xrRig.syncXrRig(playerPose, effectiveHeadLocalMeters, headLocalYawRadians);
    } else {
      applyDesktopCameraPose();
    }
    const xrHeadWorldPose = xrActive ? resolveXrHeadWorldPose(xrViewerPose) : undefined;
    const activeAimRay = resolveActiveRootAimRay(xrActive, xrFrame, xrReferenceSpace);
    updateCarriedGeodesicCannonPose(xrActive, activeAimRay);
    if (frame.helpRequested && !desktopFlagEditor.isOpen()) {
      requestHelpLensForFocusedObject(activeAimRay);
    }
    const worldPrimaryActionRequested = frame.primaryActionRequested && !menuState.isOpen && !desktopFlagEditor.isOpen();
    // Tool dispatch: modal cannon tools consume the primary action themselves; world tools act only when
    // no menu or flag editor is open. primaryActionConsumed stops the generic focused-object interaction.
    let primaryActionConsumed = false;
    if (frame.carryActionRequested && !menuState.isOpen && !desktopFlagEditor.isOpen()) {
      primaryActionConsumed = menuState.selectedTool === "geodesic-cannon-carry"
        ? finishGeodesicCannonCarry()
        : tryStartFocusedGeodesicCannonCarry(activeAimRay);
    }

    if (menuState.selectedTool === "geodesic-cannon-carry") {
      if (frame.primaryActionRequested) {
        finishGeodesicCannonCarry();
        primaryActionConsumed = true;
      }
    } else if (menuState.selectedTool === "geodesic-cannon-rotate") {
      updateActiveGeodesicCannonRotation(frame.yawDeltaRadians, frame.primaryActionRequested);
      primaryActionConsumed = frame.primaryActionRequested;
    } else if (menuState.selectedTool === "geodesic-cannon-aim") {
      updateActiveGeodesicCannonAim(frame.primaryActionRequested, activeAimRay);
      primaryActionConsumed = frame.primaryActionRequested;
    } else if (worldPrimaryActionRequested && menuState.selectedTool === "geodesic-cannon-tie-detach") {
      primaryActionConsumed = trySelectTieAndDetachGeodesicFromAim(activeAimRay);
    } else if (worldPrimaryActionRequested && menuState.selectedTool === "place-flag") {
      tryPlaceFlagFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (worldPrimaryActionRequested && menuState.selectedTool === "geodesic-cannon") {
      tryUseGeodesicCannonToolFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (worldPrimaryActionRequested && menuState.selectedTool === "measure-length") {
      tryUseMeasureLengthToolFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (worldPrimaryActionRequested && menuState.selectedTool === "protractor") {
      tryUseProtractorToolFromAim(activeAimRay);
      primaryActionConsumed = true;
    } else if (
      worldPrimaryActionRequested &&
      !primaryActionConsumed &&
      (menuState.selectedTool === "none" || menuState.selectedTool === "aim")
    ) {
      primaryActionConsumed = tryUseFocusedObjectPrimaryInteraction(activeAimRay);
    }

    if (primaryActionConsumed) {
      // A consumed action may have changed the registry; drop the per-frame aim cache.
      invalidateAimCache();
    }

    if (frame.interactRequested && !desktopFlagEditor.isOpen()) {
      openContextMenuFromAim(activeAimRay);
    }
    const frameAfterMoveMs = performance.now();
    const frameBeforeObjectsMs = frameAfterMoveMs;
    // Simulation of non-player objects (timed separately as objectsMs): creatures treat the player as an
    // obstacle; geodesics under curve shortening advance and dependent measurements are refreshed.
    const playerObstacle = createPlayerCollisionState(playerPose);

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
    let straightenedGeodesicIds: readonly string[] = [];
    frameErrorGuard.runPhase("curve shortening", () => {
      straightenedGeodesicIds = advanceCurveShorteningPairs({
        world: activeWorld(),
        registry: runtimeObjectRegistry,
        deltaSeconds: frame.resetRequested ? 0 : deltaSeconds,
        onDebugMessage: menuState.debugEnabled
          ? (message, detail) => {
              const diagnostics = runtimeDiagnostics();
              diagnostics.recordDebugEvent(message, detail);
              if (!diagnostics.enabled) {
                console.info(`[noneuclid] ${message}`, detail);
              }
            }
          : undefined,
      });
    });
    for (const geodesicId of straightenedGeodesicIds) {
      refreshProtractorAnglesForGeodesic(geodesicId);
      refreshMeasuredGeodesicLengthsForGeodesic(geodesicId);
    }
    if (straightenedGeodesicIds.length > 0) {
      syncSelectableHitboxDebug();
    }
    refreshMeasuredGeodesicLengths();
    const frameAfterObjectsMs = performance.now();
    const frameBeforeCameraMs = frameAfterObjectsMs;

    // Phase 3: portal visibility. The culling cameras mirror the render cameras (per eye in stereo XR).
    updateVisibleCell();
    let portalCullingCameras: readonly THREE.Camera[] = [camera];
    if (xrActive) {
      // The rig is synced a second time (also done after movement) so the culling cameras below derive from
      // the pose as it stands after the tool phase.
      xrRig.syncXrRig(playerPose, effectiveHeadLocalMeters, headLocalYawRadians);
      portalCullingCamera.copy(camera, false);
      xrRig.syncXrCullingCamera(portalCullingCamera, xrViewerPose);
      const xrEyeCameras = xrRig.syncXrViewCullingCameras(portalCullingEyeCameras, xrViewerPose);
      portalCullingCameras = xrEyeCameras.length > 0 ? xrEyeCameras : [portalCullingCamera];
      updateStylizedSceneLighting(sceneLighting, camera);
    } else {
      applyDesktopCameraPose();
    }
    frameErrorGuard.runPhase("tooltips", () => {
      updateFloatingObjectTooltip(xrActive, activeAimRay, xrHeadWorldPose);
      updateHelpLens(xrActive, activeAimRay);
    });
    const frameAfterCameraMs = performance.now();
    const frameBeforePortalMs = frameAfterCameraMs;

    // Phase 3/4: compute visible portal paths (stereo: one result per eye, unioned) and write the instance
    // transforms and clip data consumed by onBeforeRender during renderer.render.
    if (xrActive && portalCullingCameras.length > 1) {
      syncStereoPortalInstanceRender(portalCullingCameras.map(resolvePortalEyeRenderRoot));
    } else {
      const cullingCamera = portalCullingCameras[0] ?? camera;
      syncPortalInstanceRender(xrActive ? resolvePortalEyeRenderRoot(cullingCamera) : {
        rootCellId: playerPose.cellId,
        camera: cullingCamera,
        renderFromRootMatrix: new THREE.Matrix4(),
      });
    }
    // Phase 4 (objects): runtime-object instances for every visible portal path.
    syncRuntimeObjectPortalInstances();
    const frameAfterPortalMs = performance.now();
    const frameBeforeUiMs = frameAfterPortalMs;

    // UI/debug refresh; none of this changes simulation state, so it runs as one contained phase.
    frameErrorGuard.runPhase("ui", () => {
      updateAimCrossMarker(xrActive, activeAimRay);
      updateProtractorToolFeedback(activeAimRay);
      updateGeodesicEmitterLabels();
      syncXrDebugState(frame.source, moveResult);
      updateScenePalette(xrActive, xrFrame, xrReferenceSpace, xrHeadWorldPose, deltaSeconds, frame);
      portalDebugRuntime.updateVisiblePortalPaths();
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
    runtimeDiagnostics().recordFrame(playerPose.cellId, {
      totalMs: framePerformance.totalMs,
      moveMs: framePerformance.moveMs,
      renderMs: framePerformance.renderMs,
    });
  }

  // Polls the geometry session once and, if a deformed world is ready, commits it. Called at frame start.
  function commitReadyWorldGeometrySnapshot(): void {
    const snapshot = geometrySession.pollReadySnapshot();
    if (!snapshot) {
      return;
    }

    commitWorldGeometrySnapshot(snapshot);
  }

  /**
   * Replaces the active world with a newly deformed snapshot and carries all live state across.
   *
   * Computes per-cell deformation maps from the previous to the new snapshot, then moves the player (reset to
   * home if the pose cannot be mapped), creatures, flags and cannons through them (objects that cannot be
   * mapped are removed, collidable assets are rebuilt from the new spec), swaps `activeWorldBundle`, drops
   * visibility caches and tool selections, rebuilds cell meshes and portal instances, and recreates the portal
   * debug runtime. Positions are cell-local meters and yaw is in radians. Throws if the deformation family is
   * not registered. Runs on the frame loop only, before input is read.
   */
  function commitWorldGeometrySnapshot(snapshot: WorldGeometrySnapshot): void {
    const previousSnapshot = activeWorldBundle.snapshot;
    const family = getWorldDeformationFamilyOrThrow(deformationFamilyRegistry, snapshot.deformation.kind);
    const mapByCellId = family.createDynamicObjectMaps(
      previousSnapshot.deformation as never,
      snapshot.deformation as never,
      previousSnapshot.world,
      snapshot.world,
    );

    // Order matters: the player and objects are mapped using the previous world's cell ids, then the bundle
    // is swapped so later helpers (activeWorld()) see the new world.
    transformPlayerForGeometryCommit(mapByCellId, snapshot.world);
    transformRuntimeObjectsForGeometryCommit(mapByCellId, snapshot);
    activeWorldBundle = createActiveWorldBundle(snapshot);
    // Visibility results refer to old path ids; drop them until the next sync.
    latestVisibleResult = undefined;
    portalEyeRenderStates = [];
    activePortalEyeIndex = 0;
    clearGeometryToolStateAfterCommit();
    rebuildCellMeshes();
    for (const runtime of dynamicObjectRuntimes) {
      runtime.syncParent(cellMeshes);
    }
    for (const runtime of placedFlagRuntimes.values()) {
      runtime.syncParent(cellMeshes);
    }
    syncPortalInstanceRender();
    syncRuntimeObjectPortalInstances();
    syncDynamicObjectDebugWireframes();
    syncStaticObjectCollisionWireframes();
    syncSelectableHitboxDebug();
    applyDesktopCameraPose();
    portalDebugRuntime.dispose();
    portalDebugRuntime = createPortalDebugRuntime(portalDebugRuntimeDeps);
    installRuntimeDiagnostics(
      activeWorld(),
      debugLevel,
      hasActiveDebugOption(debugLevel, debugOptions, "runtime-diagnostics"),
    );
  }

  function transformPlayerForGeometryCommit(
    mapByCellId: ReadonlyMap<string, CellDeformationMap>,
    nextWorld: CompiledCellComplex,
  ): void {
    const transformed = transformPoseWithCellMaps(
      {
        cellId: playerPose.cellId,
        localPose: yawRigidTransform3(playerPose.yawRadians, playerPose.position),
      },
      mapByCellId,
    );

    if (!transformed || !nextWorld.cellsById.has(transformed.cellId)) {
      resetPlayerToHome();
      return;
    }

    const mappedPose: PlayerPose = {
      ...playerPose,
      cellId: transformed.cellId,
      position: transformed.localPose.translation,
      yawRadians: yawFromPose(transformed.localPose),
    };
    const result = depenetrateDynamicObject(nextWorld, createPlayerCollisionState(mappedPose));
    if (result.kind === "failed") {
      console.warn("Deformation commit: no legal player pose found; keeping the mapped pose.");
      playerPose = mappedPose;
      return;
    }
    playerPose = playerPoseFromDynamicObject(result.object, mappedPose.pitchRadians);
  }

  function transformRuntimeObjectsForGeometryCommit(
    mapByCellId: ReadonlyMap<string, CellDeformationMap>,
    snapshot: WorldGeometrySnapshot,
  ): void {
    for (const runtime of dynamicObjectRuntimes) {
      runtime.transformGeometry(mapByCellId, snapshot.world);
    }

    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "asset") {
        runtimeObjectRegistry.remove(object.id);
      }
    }

    for (const object of runtimeObjectRegistry.getAll()) {
      if (object.kind === "placed-flag") {
        const transformed = transformPoseWithCellMaps(object, mapByCellId);
        if (!transformed) {
          runtimeObjectRegistry.remove(object.id);
          removePlacedFlagRuntime(object.id);
          continue;
        }

        const depenetrated = depenetrateDynamicObject(
          snapshot.world,
          runtimeObjectToDynamicObjectState({ ...object, cellId: transformed.cellId, localPose: transformed.localPose }),
        );
        const nextObject = {
          ...object,
          cellId: depenetrated.object.cellId,
          localPose: depenetrated.object.localPose,
        };
        runtimeObjectRegistry.update(nextObject);
        syncPlacedFlagRuntime(nextObject);
      } else if (object.kind === "geodesic-cannon") {
        const transformed = transformGeodesicCannonForGeometryCommit(object, mapByCellId);
        if (!transformed) {
          runtimeObjectRegistry.remove(object.id);
          continue;
        }

        runtimeObjectRegistry.update(transformed);
      }
    }

    rebuildStaticAssetRegistryObjects(snapshot);
    rebuildGeometryDependentRuntimeObjectsAfterCommit(snapshot);
  }

  function transformGeodesicCannonForGeometryCommit(
    object: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
    mapByCellId: ReadonlyMap<string, CellDeformationMap>,
  ): Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }> | undefined {
    const map = mapByCellId.get(object.cellId);
    if (!map) {
      return undefined;
    }

    const position = map.mapPoint(object.localPose.translation);
    const aimYawRadians = transformYawWithMap(object.aimYawRadians, object.localPose.translation, map);
    const geodesicEmitterYawRadiansById = object.geodesicEmitterYawRadiansById
      ? Object.fromEntries(
          Object.entries(object.geodesicEmitterYawRadiansById).map(([geodesicId, yawRadians]) => [
            geodesicId,
            transformYawWithMap(yawRadians, object.localPose.translation, map),
          ]),
        )
      : undefined;

    return {
      ...object,
      cellId: map.cellId,
      localPose: yawRigidTransform3(aimYawRadians, position),
      aimYawRadians,
      geodesicEmitterYawRadiansById,
    };
  }

  function rebuildStaticAssetRegistryObjects(snapshot: WorldGeometrySnapshot): void {
    for (const cell of snapshot.world.cells) {
      for (const objectSpec of cell.objects) {
        if (objectSpec.kind === "asset" && objectSpec.collision) {
          runtimeObjectRegistry.add(createRuntimeStaticAssetObject(objectSpec, cell.id));
        }
      }
    }
  }

  function rebuildGeometryDependentRuntimeObjectsAfterCommit(snapshot: WorldGeometrySnapshot): void {
    applyGeometryCommitComputedObjectPolicy({
      world: snapshot.world,
      registry: runtimeObjectRegistry,
      playerCellId: playerPose.cellId,
      playerPoint: playerPose.position,
      callbacks: {
        removeMeasuredGeodesicLength: removeMeasuredGeodesicLengthRuntime,
        syncMeasuredGeodesicLength: syncMeasuredGeodesicLengthRuntime,
        removeProtractorAngle: removeProtractorAngleRuntime,
        syncProtractorAngle: syncProtractorAngleRuntime,
      },
    });
  }

  function clearGeometryToolStateAfterCommit(): void {
    activeGeodesicCannonToolState = {};
    activeProtractorToolState = {};
    clearCarriedGeodesicCannonGlow();
    clearProtractorToolFeedback();
    refreshOpenGeometryComputerMenu();
    syncDesktopPalette();
  }

  function installGeometryDebugHelpersIfAvailable(): void {
    if (geometrySession.state.current.kind !== "torus-skew" && debugLevel === "off") {
      uninstallGeometryDebugHelpers();
      return;
    }

    const helpers: GeometryDebugHelpers = {
      SetTorusSkew(skewXMeters) {
        const current = geometrySession.state.current;
        if (current.kind !== "torus-skew") {
          throw new Error("World deformation is not available for the active world.");
        }

        geometrySession.setTarget({
          ...current,
          skewXMeters,
        });
      },
      StepTorusSkew(deltaXMeters) {
        const state = geometrySession.state;
        const base = state.target.kind === "torus-skew"
          ? state.target
          : state.current.kind === "torus-skew"
            ? state.current
            : undefined;
        if (!base) {
          throw new Error("World deformation is not available for the active world.");
        }

        geometrySession.setTarget({
          ...base,
          skewXMeters: base.skewXMeters + deltaXMeters,
        });
      },
      Cancel() {
        geometrySession.cancel();
      },
      get state() {
        return geometrySession.state;
      },
    };

    (window as WindowWithGeometryDebugHelpers).noneuclidGeometry = helpers;
  }

  function applyMenuDebugState(nextMenuState: typeof menuState): void {
    menuState = nextMenuState;
    syncLaunchOptionsState();
    applyDebugSettings(createDebugSettingsFromRuntimeMenuState(menuState));
    syncDesktopPalette();
  }

  function applyMenuComfortState(nextMenuState: typeof menuState): void {
    menuState = nextMenuState;
    vrComfortOptions = {
      ...vrComfortOptions,
      antiNauseaModeEnabled: menuState.antiNauseaModeEnabled,
    };
    vrComfortVignette.setOptions(vrComfortOptions);
    syncLaunchOptionsState();
    syncDesktopPalette();
  }

  function applyDebugSettings(settings: DebugSettings): void {
    debugLevel = settings.debugLevel;
    portalPanelMode = settings.portalPanelMode;
    debugOptions = settings.debugOptions;
    showCellPathRendersInstances = hasActiveDebugOption(
      debugLevel,
      debugOptions,
      "portal-path-overlay-instances",
    );
    installRuntimeDiagnostics(
      activeWorld(),
      settings.debugLevel,
      hasActiveDebugOption(settings.debugLevel, settings.debugOptions, "runtime-diagnostics"),
    );
    rebuildCellMeshes();
    syncPortalInstanceRender();
    portalDebugRuntime.dispose();
    portalDebugRuntime = createPortalDebugRuntime(portalDebugRuntimeDeps);
    logDebugStartupGuide(debugLevel, debugOptions);
    installGeneralDebugHelpers({
      debugHelp: () => logDebugStartupGuide(debugLevel, debugOptions),
      dumpGeodesicCreatures: dumpGeodesicCreatures,
      dumpAllGeodesics: dumpAllGeodesics,
      dumpGeodesicPath: dumpGeodesicPath,
      dumpLockedGeodesicWords: dumpLockedGeodesicWords,
    });
    installGeometryDebugHelpersIfAvailable();
    for (const runtime of dynamicObjectRuntimes) {
      runtime.syncParent(cellMeshes);
    }
    syncDynamicObjectDebugWireframes();
    syncStaticObjectCollisionWireframes();
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
    applyDesktopCameraPose();
    renderer.render(scene, camera);
  }

  function syncLaunchOptionsState(): void {
    const settings = createDebugSettingsFromRuntimeMenuState(menuState);
    options.onLaunchOptionsChanged?.({
      debugLevel: settings.debugLevel,
      portalPanelMode: settings.portalPanelMode,
      debugOptions: settings.debugOptions,
      debugOverlayEnabled: menuState.debugOverlayEnabled,
      debugOverlayItems: menuState.debugOverlayItems,
      vrComfortOptions,
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
      applyDebugSettings(settings);
      const seeded = createRuntimeMenuState({
        selectedWorldId: menuState.selectedWorldId,
        debugSettings: settings,
        debugOverlayEnabled: menuState.debugOverlayEnabled,
        debugOverlayItems: menuState.debugOverlayItems,
      });
      menuState = {
        ...menuState,
        debugEnabled: seeded.debugEnabled,
        consoleLogLevel: seeded.consoleLogLevel,
        portalPanelMode: seeded.portalPanelMode,
        portalInspectionEnabled: seeded.portalInspectionEnabled,
        collisionGeometryWireframesEnabled: seeded.collisionGeometryWireframesEnabled,
        aimCollisionOutlinesEnabled: seeded.aimCollisionOutlinesEnabled,
      };
      syncDesktopPalette();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      // Disposal order: timers and loop first (no more frames), then listeners, UI/controllers, scene content
      // and GPU resources, debug runtime and helpers, geometry session, and last the renderer and its canvas.
      if (reloadConfirmationTimeout !== undefined) {
        window.clearTimeout(reloadConfirmationTimeout);
        reloadConfirmationTimeout = undefined;
      }
      xrSessionRestartCoordinator.cancel();
      renderer.setAnimationLoop(null);
      endActiveXrSessionOnDispose();
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("contextmenu", onDesktopContextMenu);
      window.removeEventListener("mousedown", onDesktopMouseDown);
      window.removeEventListener("wheel", onDesktopWheel);
      window.removeEventListener("keydown", onDesktopPaletteKeyDown);
      scenePaletteController.dispose();
      xrControllerHandModels.dispose();
      desktopScenePaletteInput.dispose();
      desktopToolIndicator.dispose();
      desktopFlagEditor.dispose();
      aimCrossMarker.dispose();
      aimControllerRay.removeFromParent();
      aimControllerRayGeometry.dispose();
      aimControllerRayMaterial.dispose();
      floatingObjectTooltip.dispose();
      helpLensRenderer.dispose();
      vrComfortVignette.dispose();
      clearXrObjectTooltip();
      controls.dispose();
      clearProtractorToolFeedback();
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
        runtime.root.removeFromParent();
        disposeObject3D(runtime.root);
      }
      dynamicObjectRuntimes.length = 0;
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
      for (const archetype of cellRenderArchetypes) {
        scene.remove(archetype.mesh);
      }
      disposeCellRenderArchetypes(cellRenderArchetypes);
      portalInstanceDebugRenderer?.dispose();
      portalClipData.dispose();
      for (const archetype of runtimeObjectRenderArchetypesByKey.values()) {
        runtimeObjectRenderRoot.remove(archetype.mesh);
      }
      disposeRuntimeObjectRenderArchetypes(runtimeObjectRenderArchetypesByKey.values());
      runtimeObjectRenderArchetypesByKey.clear();
      runtimeObjectRenderRoot.removeFromParent();
      portalDebugRuntime.dispose();
      uninstallGeneralDebugHelpers();
      uninstallGeometryDebugHelpers();
      geometrySession.dispose();
      debugOverlay.dispose();
      xrEntryUi.dispose();
      clipPolygonOverlay.dispose();
      disposeStylizedSceneLighting(sceneLighting, scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  // Runs `restart` (reload / world change / config change) after leaving immersive VR. When a session is
  // presenting, the coordinator ends it first and calls `restart` afterwards; if ending fails, the error is
  // logged, xrSessionState becomes "failed" and `restart` is not invoked by this path.
  function requestAppRestart(restart: () => void): void {
    const session = renderer.xr.isPresenting ? renderer.xr.getSession() : undefined;

    xrSessionRestartCoordinator.requestRestart(session, restart, (error) => {
      const message = error instanceof Error ? error.message : "Unable to leave immersive VR before restarting.";
      console.warn("[noneuclid] unable to end XR session before restart", error);
      xrSessionState = transitionXrSessionState(xrSessionState, "failed", message);
      xrEntryUi.update(xrSessionState);
      syncXrDebugState("desktop");
    });
  }

  /**
   * Requests an immersive-vr session and makes it the renderer's XR session.
   *
   * Does nothing unless WebXR is available, immersive VR is supported and the state is available, ended or
   * failed. Optional features: local-floor, bounded-floor, hand-tracking. Never rejects: errors set
   * `xrSessionState` to "failed" with the message. The session's `end` listener (added once per session)
   * marks the state ended and resets rig, palette input and controller models so the next entry starts clean.
   */
  // Best-effort teardown of an active immersive session: detaches the 'end' listener first (so the handler
  // cannot touch disposed state), then asks the browser to end the session. Called only from dispose().
  function endActiveXrSessionOnDispose(): void {
    xrSessionEndHandlerCleanup?.();
    xrSessionEndHandlerCleanup = undefined;
    const session = activeXrSession ?? renderer.xr.getSession?.() ?? undefined;
    activeXrSession = undefined;
    if (session) {
      try {
        void Promise.resolve(session.end()).catch(() => undefined);
      } catch {
        // Session already ended or ending; nothing more to do.
      }
    }
    for (const owned of [xrRig, xrControls] as Array<{ dispose?: () => void }>) {
      try {
        owned.dispose?.();
      } catch {
        // Optional dispose must not block the rest of teardown.
      }
    }
  }

  async function enterVr(): Promise<void> {
    const xr = navigator.xr;

    if (
      !xr?.requestSession ||
      !xrSessionState.immersiveVrSupported ||
      (xrSessionState.status !== "available" && xrSessionState.status !== "ended" && xrSessionState.status !== "failed")
    ) {
      return;
    }

    xrSessionState = transitionXrSessionState(xrSessionState, "entering");
    xrEntryUi.update(xrSessionState);
    syncXrDebugState("desktop");

    try {
      const session = await xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });
      activeXrSession = session;
      session.addEventListener("end", onXrSessionEnd);
      xrSessionEndHandlerCleanup = () => session.removeEventListener("end", onXrSessionEnd);
      function onXrSessionEnd(): void {
        if (disposed) {
          return;
        }
        activeXrSession = undefined;
        xrSessionState = transitionXrSessionState(xrSessionState, "ended");
        xrRig.reset();
        xrScenePaletteInput.reset();
        xrControllerHandModels.reset();
        scenePaletteController.setVisible(false);
        xrEntryUi.update(xrSessionState);
        syncXrDebugState("desktop");
      }
      await renderer.xr.setSession(session);
      xrSessionState = transitionXrSessionState(xrSessionState, "active");
      xrEntryUi.update(xrSessionState);
      syncXrDebugState("xr");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start immersive VR.";
      xrSessionState = transitionXrSessionState(xrSessionState, "failed", message);
      xrEntryUi.update(xrSessionState);
      syncXrDebugState("desktop");
    }
  }

  // Feeds the scene palette (menu) from XR controllers or desktop pointer input and positions it; in XR also
  // updates the controller hand models. Called once per frame in the UI phase.
  function updateScenePalette(
    xrActive: boolean,
    xrFrame: XRFrame | undefined,
    xrReferenceSpace: XRReferenceSpace | null,
    xrHeadWorldPose: XrHeadWorldPose | undefined,
    deltaSeconds: number,
    frame: RuntimeInputFrame,
  ): void {
    if (xrActive && xrFrame && xrReferenceSpace) {
      const inputSources = [...(renderer.xr.getSession()?.inputSources ?? [])];
      const headPosition = xrHeadWorldPose?.position ?? camera.getWorldPosition(new THREE.Vector3());
      const headQuaternion = xrHeadWorldPose?.quaternion ?? camera.getWorldQuaternion(new THREE.Quaternion());

      const placement = resolveVrPalettePlacement({
        head: {
          position: headPosition,
          quaternion: headQuaternion,
        },
      });
      scenePaletteController.update({
        input: xrScenePaletteInput.update({
          deltaSeconds,
          xrFrame,
          referenceSpace: xrReferenceSpace,
          referenceSpaceToWorldMatrix: xrRig.root.matrixWorld,
          inputSources,
        }),
        definition: createPaletteDefinition(menuState, appConfig, "xr"),
        placement,
      });
      xrControllerHandModels.update({
        inputSources,
        xrFrame,
        referenceSpace: xrReferenceSpace,
        referenceSpaceToWorldMatrix: xrRig.root.matrixWorld,
        selectedTool: menuState.selectedTool,
        placeFlagType: menuState.placeFlagOptions.flagType,
      });
      return;
    }

    const placement = resolveDesktopScenePalettePlacement({
      camera,
      previousPlacement: previousDesktopPalettePlacement,
    });
    previousDesktopPalettePlacement = placement;
    scenePaletteController.update({
      input: desktopScenePaletteInput.update({
        desktopFrame: {
          ...frame,
          palettePointerDeltaPixels: frame.palettePointerDeltaPixels ?? { x: 0, y: 0 },
          paletteSelectPressed: frame.paletteSelectPressed ?? false,
          paletteSelectRequested: frame.paletteSelectRequested ?? false,
        },
        deltaSeconds,
        camera,
        isOpen: menuState.isOpen,
        placement,
      }),
      definition: createPaletteDefinition(menuState, appConfig, "desktop"),
      placement,
    });
  }

  // Head pose in Three.js world space (rig root matrix times the viewer pose). The result aliases the
  // module-level scratch vectors and is overwritten on the next call.
  function resolveXrHeadWorldPose(xrViewerPose: XRViewerPose | undefined): XrHeadWorldPose | undefined {
    if (!xrViewerPose) {
      return undefined;
    }

    xrHeadWorldMatrix.copy(xrRig.root.matrixWorld).multiply(xrRigidTransformLocalMatrix(xrViewerPose.transform));
    xrHeadWorldMatrix.decompose(xrHeadWorldPosition, xrHeadWorldQuaternion, xrHeadWorldScale);
    return {
      position: xrHeadWorldPosition,
      quaternion: xrHeadWorldQuaternion,
    };
  }

  function onDesktopContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  function onDesktopMouseDown(event: MouseEvent): void {
    if (event.button !== 2 || renderer.xr.isPresenting) {
      return;
    }

    if (event.target !== renderer.domElement && !controls.isPointerLocked()) {
      return;
    }

    event.preventDefault();
    openContextMenuFromAim(resolveActiveRootAimRay(false));
  }

  function onDesktopPaletteKeyDown(event: KeyboardEvent): void {
    if (renderer.xr.isPresenting) {
      return;
    }

    if (event.code === "Escape") {
      const action = reduceDesktopScenePaletteToggle(menuState.isOpen, "escape-key");
      if (action !== "none") {
        event.preventDefault();
        applyDesktopScenePaletteToggle(action);
      } else if (helpLensFocusedObjectId) {
        event.preventDefault();
        helpLensFocusedObjectId = undefined;
      }
      return;
    }

    if (event.code === "Tab" && !menuState.isOpen && !desktopFlagEditor.isOpen()) {
      if (cycleFocusedAimTarget(resolveActiveRootAimRay(false))) {
        event.preventDefault();
      }
    }
  }

  function onDesktopWheel(event: WheelEvent): void {
    if (renderer.xr.isPresenting || menuState.isOpen || desktopFlagEditor.isOpen()) {
      return;
    }

    if (event.target !== renderer.domElement && !controls.isPointerLocked()) {
      return;
    }

    if (cycleFocusedAimTarget(resolveActiveRootAimRay(false))) {
      event.preventDefault();
    }
  }

  function applyDesktopScenePaletteToggle(action: "open" | "right-action" | "close" | "none"): void {
    if (action === "open" && !menuState.isOpen) {
      menuState = openRuntimeMenu(menuState);
      syncDesktopPalette();
    } else if (action === "right-action" && menuState.isOpen) {
      applyRuntimeMenuRightAction();
    } else if (action === "close" && menuState.isOpen) {
      cancelRuntimeMenuAndSelectedTool();
    }
  }

  function applyRuntimeMenuRightAction(): void {
    if (
      menuState.page === "main" ||
      menuState.page === "edit-sign" ||
      menuState.page === "geodesic-cannon-actions" ||
      menuState.page === "geometry-computer-actions" ||
      menuState.page === "question-help"
    ) {
      cancelRuntimeMenuAndSelectedTool();
      return;
    } else if (menuState.page === "tutorial" || menuState.page === "goal") {
      menuState = showRuntimeMenuQuestionHelp(menuState);
    } else if (menuState.page === "debug-settings") {
      menuState = showRuntimeMenuSettings(menuState);
    } else {
      menuState = showRuntimeMenuMainPage(menuState);
    }
    syncDesktopPalette();
  }

  function cancelRuntimeMenuAndSelectedTool(): void {
    activeProtractorToolState = {};
    activeGeodesicCannonToolState = {};
    syncTieAndDetachSelectionHighlights([]);
    clearProtractorToolFeedback();
    menuState = closeRuntimeMenu(setRuntimeMenuSelectedTool(menuState, "none"));
    syncRuntimeObjectPortalInstances();
    syncDesktopPalette();
  }

  // Consumes accumulated keyboard/mouse input; the palette look mode is used while the menu is open.
  function getDesktopInputFrame(deltaSeconds: number): RuntimeInputFrame {
    controls.setLookMode(menuState.isOpen ? "palette" : "camera");
    const frame = controls.consumeFrame(deltaSeconds);

    return {
      ...frame,
      source: "desktop",
    };
  }

  // Consumes controller input from the active session's input sources; an all-zero frame if no session.
  function getXrInputFrame(deltaSeconds: number): RuntimeInputFrame {
    const session = renderer.xr.getSession();

    if (!session) {
      return {
        localDisplacement: { x: 0, y: 0, z: 0 },
        yawDeltaRadians: 0,
        pitchDeltaRadians: 0,
        resetRequested: false,
        primaryActionRequested: false,
        interactRequested: false,
        carryActionRequested: false,
        helpRequested: false,
        source: "xr",
      };
    }

    return {
      ...xrControls.consumeFrame(session.inputSources, deltaSeconds),
    };
  }

  function recordCellTransition(previousCellId: string, moveResult: ReturnType<typeof movePlayer>): void {
    for (const transition of resolveGeodesicCarryPortalTransitionsFromCrossings(moveResult.crossings)) {
      recordPlayerPortalTransitionInLog(transition);
    }

    if (playerPose.cellId !== previousCellId) {
        runtimeDiagnostics().recordCellEntered(
          previousCellId,
          playerPose.cellId,
          moveResult.crossings.at(-1)?.portalId ?? moveResult.crossedPortalId ?? "unknown-portal",
        );
      portalDebugRuntime.syncRootCell();
    }
  }

  function syncXrDebugState(
    source: RuntimeInputFrame["source"],
    moveResult?: ReturnType<typeof movePlayer>,
  ): void {
    xrDebugState = {
      secureContext: xrSessionState.secureContext,
      sessionStatus: xrSessionState.status,
      activeInputSource: source,
      framePerformance: smoothedFramePerformance,
      webGlRenderInfo: latestWebGlRenderInfo,
      currentCellId: playerPose.cellId,
      playerPosition: playerPose.position,
      yawRadians: playerPose.yawRadians,
      lastMovementBlocked: moveResult?.blocked ?? xrDebugState.lastMovementBlocked,
      lastBlockingReason: moveResult?.blockingReason ?? xrDebugState.lastBlockingReason,
      lastCrossedPortalId: moveResult?.crossedPortalId ?? xrDebugState.lastCrossedPortalId,
      sharedRenderRootCellId: renderer.xr.isPresenting ? xrRig.getSharedRenderRootCellId(playerPose) : undefined,
      visiblePortalPathCount: latestVisibleResult?.paths.length,
      visiblePortalPaths: latestVisibleResult ? visibleSummaryToRenderState(latestVisibleResult.summary) : undefined,
      portalInstances: portalInstanceRenderState,
      portalEyes: createPortalEyeDebugStates(),
    };
  }

  function createPortalEyeDebugStates(): readonly PortalEyeRenderDebugState[] | undefined {
    if (portalEyeRenderStates.length === 0) {
      return undefined;
    }

    return portalEyeRenderStates.map((state) => ({
      eyeIndex: state.eyeIndex,
      rootCellId: state.rootCellId,
      visiblePathCount: state.result.paths.length,
      maxVisibleDepth: state.result.summary.maxVisibleDepth,
    }));
  }

  // Tears down and recreates the per-cell groups and instanced render archetypes for the active world,
  // preserving which cell is visible. Called at startup, on geometry commit and on debug-setting changes.
  function rebuildCellMeshes(): void {
    const currentlyVisibleCellId = visibleCellId ?? playerPose.cellId;

    portalInstanceDebugRenderer?.dispose();
    portalInstanceDebugRenderer = undefined;
    for (const archetype of cellRenderArchetypes) {
      scene.remove(archetype.mesh);
    }
    disposeCellRenderArchetypes(cellRenderArchetypes);
    cellRenderArchetypes = [];
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
      debugLevel,
      debugOptions,
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

    const deformation = activeWorldBundle.snapshot.deformation;
    const floorUvFramesByCellId = deformationFamilyRegistry
      .get(deformation.kind)
      ?.floorUvFrames?.(options.worldSpec, deformation as never);

    cellRenderArchetypes = buildCellRenderArchetypes(activeWorld(), {
      floorUvFramesByCellId,
      debugLevel,
      portalPanelMode,
      eyeHeightMeters: DEFAULT_PLAYER_EYE_HEIGHT_METERS,
      assets: options.assets,
      capacitiesByCellId: activeWorldBundle.archetypeCapacitiesByCellId,
      portalClipMaterialState,
      showForbiddenZoneWireframes: false,
    });
    for (const archetype of cellRenderArchetypes) {
      archetype.mesh.onBeforeRender = (renderer, _scene, renderCamera) => {
        activatePortalRenderStateForCamera(renderCamera, renderer);
        updatePortalClipMaterialViewportFromRenderer(portalClipMaterialState, renderer);
      };
      scene.add(archetype.mesh);
    }
    portalInstanceDebugRenderer = createPortalInstanceDebugRenderer(scene, cellRenderArchetypes);
    for (const runtime of placedFlagRuntimes.values()) {
      runtime.syncParent(cellMeshes);
    }
    syncStaticObjectCollisionWireframes();
    visibleCellId = currentlyVisibleCellId;
  }

  function resolvePortalEyeRenderRoot(cullingCamera: THREE.Camera): XrPortalEyeRenderRoot {
    return resolveXrPortalEyeRenderRoot({
      world: activeWorld(),
      sourceCellId: playerPose.cellId,
      camera: cullingCamera,
    });
  }

  // Mono visibility pass: computes visible portal paths from `renderRoot` and writes instance/clip data.
  // Defaults to the player's cell and the main camera. If the root cell has no static cull table, visibility
  // is cleared and nothing is instanced.
  function syncPortalInstanceRender(
    renderRoot: XrPortalEyeRenderRoot = {
      rootCellId: playerPose.cellId,
      camera,
      renderFromRootMatrix: new THREE.Matrix4(),
    },
  ): void {
    portalInstanceDiagnostics.reset();
    portalEyeRenderStates = [];
    activePortalEyeIndex = 0;
    updatePortalClipMaterialTextureEye(portalClipMaterialState, activePortalEyeIndex);
    updatePortalClipMaterialViewport(
      portalClipMaterialState,
      getPortalViewportPixels(renderer),
    );
    const table = activeStaticCull().tables.tablesByRootCellId.get(renderRoot.rootCellId);

    if (!table) {
      latestVisibleResult = undefined;
      portalClipData.update([]);
      updateCellRenderArchetypeInstances(cellRenderArchetypes, new Map(), portalInstanceDiagnostics);
      portalInstanceRenderState = createPortalInstanceRenderDebugState(
        cellRenderArchetypes,
        new Map(),
        portalInstanceDiagnostics,
        {
          enabled: false,
          showCellPathRendersInstances,
          normalVisiblePathRenderingActive: false,
        },
      );
      return;
    }

    const computed = computeVisiblePortalPaths({
      world: activeWorld(),
      rootCellId: renderRoot.rootCellId,
      pathTable: table,
      camera: renderRoot.camera,
      viewportPixels: getPortalViewportPixels(renderer),
      options: {
        maxDepth: rootRenderPathMaxDepth,
        maxVisiblePaths,
        minPortalScreenAreaPixels: 16,
        includeRootCell: true,
        sortMode: "depth-then-area",
      },
    });
    const renderedComputed = transformVisiblePortalResultToRenderFrame(computed, renderRoot.renderFromRootMatrix);
    const summary = mergeStaticPathCounts(renderedComputed.summary, activeStaticCull(), renderRoot.rootCellId);
    latestVisibleResult = {
      ...renderedComputed,
      summary,
    };
    applyPortalVisibleResult(
      renderRoot.rootCellId,
      latestVisibleResult.paths,
      latestVisibleResult.visiblePathById,
      true,
      [runtimeObjectCameraPosition(renderRoot.camera, renderRoot.renderFromRootMatrix)],
    );
    portalInstanceRenderState = createPortalInstanceRenderStateFromVisibleResult(
      renderRoot.rootCellId,
      latestVisibleResult,
      true,
    );
  }

  // Stereo (per-eye) visibility pass for XR: each eye has its own root and result; the union of paths is
  // instanced once and per-eye clip data selects the eye in onBeforeRender. latestVisibleResult holds eye 0
  // only. If any eye's root cell lacks a cull table, visibility is cleared as in the mono pass.
  function syncStereoPortalInstanceRender(renderRoots: readonly XrPortalEyeRenderRoot[]): void {
    portalInstanceDiagnostics.reset();
    updatePortalClipMaterialViewport(
      portalClipMaterialState,
      getPortalViewportPixels(renderer),
    );
    const hasTables = renderRoots.every((renderRoot) =>
      activeStaticCull().tables.tablesByRootCellId.has(renderRoot.rootCellId)
    );

    if (!hasTables) {
      latestVisibleResult = undefined;
      portalEyeRenderStates = [];
      activePortalEyeIndex = 0;
      updatePortalClipMaterialTextureEye(portalClipMaterialState, activePortalEyeIndex);
      portalClipData.update([]);
      updateCellRenderArchetypeInstances(cellRenderArchetypes, new Map(), portalInstanceDiagnostics);
      portalInstanceRenderState = createPortalInstanceRenderDebugState(
        cellRenderArchetypes,
        new Map(),
        portalInstanceDiagnostics,
        {
          enabled: false,
          showCellPathRendersInstances,
          normalVisiblePathRenderingActive: false,
        },
      );
      return;
    }

    const sharedRootCellId = renderRoots.every((renderRoot) => renderRoot.rootCellId === renderRoots[0]?.rootCellId)
      ? renderRoots[0]?.rootCellId
      : undefined;
    const computedEyeStates = sharedRootCellId
      ? computeIndependentVisiblePortalPaths({
          world: activeWorld(),
          rootCellId: sharedRootCellId,
          pathTable: activeStaticCull().tables.tablesByRootCellId.get(sharedRootCellId)!,
          cameras: renderRoots.map((renderRoot) => renderRoot.camera),
          viewportPixels: getPortalViewportPixels(renderer),
          options: {
            maxDepth: rootRenderPathMaxDepth,
            maxVisiblePaths,
            minPortalScreenAreaPixels: 16,
            includeRootCell: true,
            sortMode: "depth-then-area",
          },
        }).map((computed, eyeIndex) => {
          const renderRoot = renderRoots[eyeIndex];
          const renderedComputed = transformVisiblePortalResultToRenderFrame(computed, renderRoot.renderFromRootMatrix);

          return {
            camera: renderRoot.camera,
            eyeIndex,
            rootCellId: renderRoot.rootCellId,
            result: {
              ...renderedComputed,
              summary: mergeStaticPathCounts(renderedComputed.summary, activeStaticCull(), renderRoot.rootCellId),
            },
          };
        })
      : renderRoots.map((renderRoot, eyeIndex) => {
        const table = activeStaticCull().tables.tablesByRootCellId.get(renderRoot.rootCellId)!;
        const computed = computeVisiblePortalPaths({
        world: activeWorld(),
        rootCellId: renderRoot.rootCellId,
        pathTable: table,
        camera: renderRoot.camera,
        viewportPixels: getPortalViewportPixels(renderer),
        options: {
          maxDepth: rootRenderPathMaxDepth,
          maxVisiblePaths,
          minPortalScreenAreaPixels: 16,
          includeRootCell: true,
          sortMode: "depth-then-area",
        },
      });
      const renderedComputed = transformVisiblePortalResultToRenderFrame(computed, renderRoot.renderFromRootMatrix);

      return {
        camera: renderRoot.camera,
        eyeIndex,
        rootCellId: renderRoot.rootCellId,
        result: {
          ...renderedComputed,
          summary: mergeStaticPathCounts(renderedComputed.summary, activeStaticCull(), renderRoot.rootCellId),
        },
      };
      });
    portalEyeRenderStates = remapStereoPortalPathIds(computedEyeStates);

    latestVisibleResult = portalEyeRenderStates[0]?.result;
    activePortalEyeIndex = 0;
    updatePortalClipMaterialTextureEye(portalClipMaterialState, activePortalEyeIndex);
    if (latestVisibleResult) {
      const unionVisiblePathById = buildUnionVisiblePathById(portalEyeRenderStates.map((state) => state.result));
      const unionVisiblePaths = [...unionVisiblePathById.values()].sort((left, right) => left.pathId - right.pathId);
      const cameraPositions = renderRoots.map((renderRoot) =>
        runtimeObjectCameraPosition(renderRoot.camera, renderRoot.renderFromRootMatrix)
      );
      portalClipData.updateStereo(portalEyeRenderStates.map((state) => state.result.paths));
      applyPortalVisiblePaths(unionVisiblePaths, false, cameraPositions);
      portalInstanceRenderState = createPortalInstanceRenderStateFromVisibleResult(
        portalEyeRenderStates[0]?.rootCellId ?? playerPose.cellId,
        latestVisibleResult,
        true,
      );
    } else {
      portalClipData.update([]);
      updateCellRenderArchetypeInstances(cellRenderArchetypes, new Map(), portalInstanceDiagnostics);
      portalInstanceRenderState = createPortalInstanceRenderDebugState(
        cellRenderArchetypes,
        new Map(),
        portalInstanceDiagnostics,
        {
          enabled: false,
          showCellPathRendersInstances,
          normalVisiblePathRenderingActive: false,
        },
      );
    }
  }

  function activatePortalRenderStateForCamera(renderCamera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    if (portalEyeRenderStates.length <= 1) {
      updatePortalClipMaterialTextureEye(portalClipMaterialState, 0);
      return;
    }

    const state = findPortalEyeRenderState(renderCamera, renderer);

    if (!state || state.eyeIndex === activePortalEyeIndex) {
      return;
    }

    activePortalEyeIndex = state.eyeIndex;
    updatePortalClipMaterialTextureEye(portalClipMaterialState, state.eyeIndex);
  }

  function applyPortalVisibleResult(
    rootCellId: string,
    visiblePaths: readonly VisiblePortalPath[],
    visiblePathById: ReadonlyMap<number, VisiblePortalPath>,
    updateClipData = true,
    cameraPositions: readonly THREE.Vector3[] = [runtimeObjectCameraPosition()],
  ): void {
    if (updateClipData) {
      portalClipData.update(visiblePaths);
    }
    const visiblePathsByDestinationCell = buildVisiblePathsByDestinationCell(
      activeStaticCull().tables.tablesByRootCellId.get(rootCellId)?.pathsByDestinationCellId ?? new Map(),
      visiblePathById,
    );
    updatePortalVisiblePathInstances(visiblePathsByDestinationCell);
    syncRuntimeObjectPortalInstances(flattenVisiblePortalPathGroups(visiblePathsByDestinationCell), cameraPositions);
  }

  function applyPortalVisiblePaths(
    visiblePaths: readonly VisiblePortalPath[],
    updateClipData = true,
    cameraPositions: readonly THREE.Vector3[] = [runtimeObjectCameraPosition()],
  ): void {
    if (updateClipData) {
      portalClipData.update(visiblePaths);
    }
    updatePortalVisiblePathInstances(groupVisiblePortalPathsByDestinationCell(visiblePaths));
    syncRuntimeObjectPortalInstances(visiblePaths, cameraPositions);
  }

  function updatePortalVisiblePathInstances(
    visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
  ): void {
    updateCellRenderArchetypeInstances(
      cellRenderArchetypes,
      visiblePathsByDestinationCell,
      portalInstanceDiagnostics,
      portalClipData.clipIndexByPathId,
    );
  }

  function createPortalInstanceRenderStateFromVisibleResult(
    rootCellId: string,
    result: ComputeVisiblePortalPathsResult,
    normalVisiblePathRenderingActive: boolean,
  ): PortalInstanceRenderDebugState {
    const visiblePathsByDestinationCell = buildVisiblePathsByDestinationCell(
      activeStaticCull().tables.tablesByRootCellId.get(rootCellId)?.pathsByDestinationCellId ?? new Map(),
      result.visiblePathById,
    );

    return createPortalInstanceRenderDebugState(
      cellRenderArchetypes,
      visiblePathsByDestinationCell,
      portalInstanceDiagnostics,
      {
        enabled: true,
        showCellPathRendersInstances,
        normalVisiblePathRenderingActive,
        visiblePaths: result.paths,
        clipPolygonVertexCountsByPathId: portalClipData.polygonVertexCountsByPathId,
        clipPolygonOverflowPathIds: portalClipData.polygonVertexOverflowPathIds,
        visiblePathOverflowCount: portalClipData.visiblePathOverflowCount,
      },
    );
  }

  function findPortalEyeRenderState(
    renderCamera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
  ): PortalEyeRenderState | undefined {
    const matrixMatched = portalEyeRenderStates.find((state) =>
      matricesNearlyEqual(state.camera.matrixWorld, renderCamera.matrixWorld) &&
      matricesNearlyEqual(state.camera.projectionMatrix, renderCamera.projectionMatrix)
    );

    if (matrixMatched) {
      return matrixMatched;
    }

    const viewport = renderer.getCurrentViewport(new THREE.Vector4());
    const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());

    if (drawingBuffer.x > 0 && viewport.z > 0) {
      const viewportCenterX = viewport.x + viewport.z / 2;
      const index = Math.min(
        portalEyeRenderStates.length - 1,
        Math.max(0, Math.floor((viewportCenterX / drawingBuffer.x) * portalEyeRenderStates.length)),
      );

      return portalEyeRenderStates[index];
    }

    return portalEyeRenderStates[0];
  }

  function syncRuntimeObjectPortalInstances(
    visiblePaths: readonly VisiblePortalPath[] = getRuntimeObjectVisiblePaths(),
    cameraPositions: readonly THREE.Vector3[] = [runtimeObjectCameraPosition()],
  ): void {
    syncRuntimeObjectRenderSources();
    const records = collectRuntimeObjectRenderRecords();
    const recordsByArchetypeKey = groupRuntimeObjectRenderRecordsByArchetype(records);
    const visiblePathsByDestinationCell = groupVisiblePortalPathsByDestinationCell(visiblePaths);
    runtimeObjectRenderDiagnostics.reset();
    updateRuntimeObjectRenderArchetypeInstances(
      [...runtimeObjectRenderArchetypesByKey.values()],
      recordsByArchetypeKey,
      visiblePathsByDestinationCell,
      runtimeObjectRenderDiagnostics,
      portalClipData.clipIndexByPathId,
      { cameraPositions },
    );
    syncSelectableHitboxDebug();
  }

  function runtimeObjectCameraPosition(
    renderCamera: THREE.Camera = camera,
    renderFromRootMatrix?: THREE.Matrix4,
  ): THREE.Vector3 {
    renderCamera.updateMatrixWorld(true);
    const position = new THREE.Vector3().setFromMatrixPosition(renderCamera.matrixWorld);
    return renderFromRootMatrix ? position.applyMatrix4(renderFromRootMatrix) : position;
  }

  function syncRuntimeObjectRenderSources(): void {
    const activeKeys = new Set<string>();
    const hasGeodesicRuntimeObjects = runtimeObjectRegistry.getAll().some(
      (object) => object.portalRenderable && isGeodesicRuntimeRenderObject(object),
    );

    if (hasGeodesicRuntimeObjects) {
      for (const source of geodesicRuntimeRenderSources) {
        activeKeys.add(source.archetypeKey);
        if (!runtimeObjectRenderSourcesByKey.has(source.archetypeKey)) {
          runtimeObjectRenderSourcesByKey.set(source.archetypeKey, source);
        }
      }
    }

    if (playerRoverRenderModel) {
      for (const source of playerRoverRenderModel.collectSources()) {
        activeKeys.add(source.archetypeKey);
        if (!runtimeObjectRenderSourcesByKey.has(source.archetypeKey)) {
          runtimeObjectRenderSourcesByKey.set(source.archetypeKey, source);
        }
      }
    }

    for (const object of runtimeObjectRegistry.getAll()) {
      if (!object.portalRenderable) {
        continue;
      }

      if (isGeodesicRuntimeRenderObject(object)) {
        continue;
      }

      const root = runtimeObjectRootsById.get(object.id);
      if (!root) {
        continue;
      }

      const prefix = runtimeObjectArchetypeKeyPrefix(object);
      for (const source of collectRuntimeObjectRenderSourceMeshes(object.id, root, prefix)) {
        activeKeys.add(source.archetypeKey);
        if (!runtimeObjectRenderSourcesByKey.has(source.archetypeKey)) {
          runtimeObjectRenderSourcesByKey.set(source.archetypeKey, source);
        }
      }
    }

    for (const [key, archetype] of [...runtimeObjectRenderArchetypesByKey]) {
      if (activeKeys.has(key)) {
        continue;
      }

      runtimeObjectRenderRoot.remove(archetype.mesh);
      disposeRuntimeObjectRenderArchetypes([archetype]);
      runtimeObjectRenderArchetypesByKey.delete(key);
      runtimeObjectRenderSourcesByKey.delete(key);
    }

    const recordsByArchetypeKey = groupRuntimeObjectRenderRecordsByArchetype(collectRuntimeObjectRenderRecords());
    for (const key of activeKeys) {
      const capacity = deriveRuntimeObjectRenderArchetypeCapacity(
        recordsByArchetypeKey.get(key)?.length ?? 1,
        maxVisiblePaths,
      );
      const existing = runtimeObjectRenderArchetypesByKey.get(key);
      if (existing && existing.capacity >= capacity) {
        continue;
      }

      const source = runtimeObjectRenderSourcesByKey.get(key);
      if (!source) {
        continue;
      }

      if (existing) {
        runtimeObjectRenderRoot.remove(existing.mesh);
        disposeRuntimeObjectRenderArchetypes([existing]);
        runtimeObjectRenderArchetypesByKey.delete(key);
      }

      const archetype = buildRuntimeObjectRenderArchetype(source, capacity, portalClipMaterialState);
      archetype.mesh.onBeforeRender = (renderer, _scene, renderCamera) => {
        activatePortalRenderStateForCamera(renderCamera, renderer);
        updatePortalClipMaterialViewportFromRenderer(portalClipMaterialState, renderer);
      };
      runtimeObjectRenderArchetypesByKey.set(key, archetype);
      runtimeObjectRenderRoot.add(archetype.mesh);
    }
  }

  function collectRuntimeObjectRenderRecords(): readonly RuntimeObjectRenderRecord[] {
    const records = runtimeObjectRegistry.getAll().flatMap((object) => {
      if (object.portalRenderable && isGeodesicRuntimeRenderObject(object)) {
        return collectGeodesicRuntimeRenderRecords(object, geodesicRuntimeArchetypeKeys);
      }

      if (!object.portalRenderable || !runtimeObjectRootsById.has(object.id)) {
        return [];
      }

      const localMatrix = rigidTransformToThreeMatrix(object.localPose);
      const prefix = runtimeObjectArchetypeKeyPrefix(object);
      const archetypeKeys = [...runtimeObjectRenderSourcesByKey.keys()]
        .filter((key) => key.startsWith(`${prefix}:mesh:`));
      const baseRecords = archetypeKeys.map((archetypeKey) => ({
        objectId: object.id,
        cellId: object.cellId,
        archetypeKey,
        localMatrix,
      }));

      return [
        ...baseRecords,
        ...collectPortalGhostRuntimeObjectRenderRecords({
          world: activeWorld(),
          object,
          archetypeKeys,
        }),
      ];
    });

    return playerRoverRenderModel
      ? [
          ...records,
          ...playerRoverRenderModel.collectRecords(playerPose, runtimeObjectRenderSourcesByKey.keys(), {
            ghostWorld: activeWorld(),
            collision: createPlayerCollisionState(playerPose).collision,
          }),
        ]
      : records;
  }

  function getRuntimeObjectVisiblePaths(): readonly VisiblePortalPath[] {
    if (portalEyeRenderStates.length <= 1) {
      if (!latestVisibleResult) {
        return [];
      }

      return flattenVisiblePortalPathGroups(buildVisiblePathsByDestinationCell(
        activeStaticCull().tables.tablesByRootCellId.get(playerPose.cellId)?.pathsByDestinationCellId ?? new Map(),
        latestVisibleResult.visiblePathById,
      ));
    }

    const visiblePathsById = new Map<number, VisiblePortalPath>();

    for (const state of portalEyeRenderStates) {
      for (const path of state.result.paths) {
        visiblePathsById.set(path.pathId, path);
      }
    }

    return [...visiblePathsById.values()].sort((left, right) => left.pathId - right.pathId);
  }

  function syncDesktopPalette(): void {
    controls.setLookMode(menuState.isOpen ? "palette" : "camera");
    desktopToolIndicator.setTool(menuState.selectedTool, menuState.placeFlagOptions.flagType, {
      protractorPrompt: getProtractorToolPrompt(),
      tieAndDetachPrompt: getTieAndDetachToolPrompt(),
    });
  }

  function getProtractorToolPrompt(): string {
    if (!activeProtractorToolState.center) {
      return "select: vertex";
    }

    if (!activeProtractorToolState.first) {
      return "select: side1";
    }

    return "select: side2";
  }

  function getTieAndDetachToolPrompt(): string {
    const selectedCount = activeGeodesicCannonToolState.tieAndDetachEndpointSelections?.length ?? 0;
    return selectedCount === 0 ? "select: geodesic 1" : "select: geodesic 2";
  }

  function appendEditingSignCharacter(character: string): void {
    if (!/^[A-Z0-9]$/.test(character) && character !== "\n" && character !== " ") {
      return;
    }

    const editState = menuState.editSignOptions;
    if (!editState) {
      return;
    }

    setEditingSignMessage(editState.flagId, `${editState.message}${character}`);
  }

  function backspaceEditingSignMessage(): void {
    const editState = menuState.editSignOptions;
    if (!editState) {
      return;
    }

    setEditingSignMessage(editState.flagId, [...editState.message].slice(0, -1).join(""));
  }

  function deleteEditingSign(): void {
    const editState = menuState.editSignOptions;
    if (!editState) {
      return;
    }

    const flag = runtimeObjectRegistry.get(editState.flagId);
    if (flag?.kind === "placed-flag") {
      runtimeObjectRegistry.remove(editState.flagId);
      removePlacedFlagRuntime(editState.flagId);
      syncRuntimeObjectPortalInstances();
    }
    menuState = closeRuntimeMenu(menuState);
    syncDesktopPalette();
  }

  function setEditingSignMessage(flagId: string, message: string): void {
    const flag = runtimeObjectRegistry.get(flagId);
    if (flag?.kind !== "placed-flag") {
      menuState = closeRuntimeMenu(menuState);
      syncDesktopPalette();
      return;
    }

    const nextFlag = updatePlacedFlagMessage(flag, message);
    runtimeObjectRegistry.update(nextFlag);
    syncPlacedFlagRuntime(nextFlag);
    menuState = setRuntimeMenuEditingSignMessage(menuState, nextFlag.message);
    syncDesktopPalette();
  }

  function tryPlaceFlagFromAim(ray?: RootAimRay): void {
    if (!ray) {
      return;
    }

    const target = resolveCurrentAimTarget(ray);
    if (target?.kind !== "floor") {
      return;
    }

    const result = placeFlagAtFloorPoint({
      world: activeWorld(),
      registry: runtimeObjectRegistry,
      cellId: target.cellId,
      eyePosition: target.localEyePosition,
      floorPoint: target.localPoint,
      flagType: menuState.placeFlagOptions.flagType,
      id: `placed-flag:${Date.now()}:${placedFlagIdCounter++}`,
    });

    if (result.placed && result.object) {
      syncPlacedFlagRuntime(result.object);
      menuState = setRuntimeMenuSelectedTool(menuState, "none");
      syncDesktopPalette();
      syncSelectableHitboxDebug();
    }
  }

  function tryUseMeasureLengthToolFromAim(ray?: RootAimRay): void {
    if (!ray) {
      return;
    }

    const target = resolveCurrentAimTarget(ray);
    logVerboseAimClick(target);
    if (!targetIsWithinInteractionRange(target) || target?.object?.kind !== "geodesic-segment") {
      return;
    }

    const geodesicId = target.object.geodesicId;
    const existing = runtimeObjectRegistry.getAll().find((object) =>
      object.kind === "measured-geodesic-length" && object.geodesicId === geodesicId
    );
    const measurement = createMeasuredGeodesicLengthObject({
      id: existing?.id ?? `measured-geodesic-length:${Date.now()}:${measuredGeodesicLengthIdCounter++}`,
      registry: runtimeObjectRegistry,
      geodesicId,
      playerCellId: playerPose.cellId,
      playerPoint: playerPose.position,
      label: getGeodesicDisplayName(geodesicId),
      fallbackSegment: target.object,
    });
    if (!measurement) {
      return;
    }

    if (existing) {
      runtimeObjectRegistry.update(measurement);
    } else {
      runtimeObjectRegistry.add(measurement);
    }
    syncMeasuredGeodesicLengthRuntime(measurement);
    menuState = setRuntimeMenuSelectedTool(menuState, "none");
    syncDesktopPalette();
    syncSelectableHitboxDebug();
  }

  function requestConfirmedReload(): void {
    const now = Date.now();
    if ((menuState.reloadConfirmUntilMs ?? 0) > now) {
      menuState = setRuntimeMenuReloadConfirmUntilMs(menuState, undefined);
      syncDesktopPalette();
      dispatchRuntimeCommand({ kind: "reload-world" });
      return;
    }

    const confirmUntilMs = now + reloadConfirmationWindowMs;
    menuState = setRuntimeMenuReloadConfirmUntilMs(menuState, confirmUntilMs);
    syncDesktopPalette();

    if (reloadConfirmationTimeout !== undefined) {
      window.clearTimeout(reloadConfirmationTimeout);
    }

    reloadConfirmationTimeout = window.setTimeout(() => {
      if ((menuState.reloadConfirmUntilMs ?? 0) <= Date.now()) {
        menuState = setRuntimeMenuReloadConfirmUntilMs(menuState, undefined);
        syncDesktopPalette();
      }
      reloadConfirmationTimeout = undefined;
    }, reloadConfirmationWindowMs);
  }

  function resetPlayerToHome(): void {
    const startingPosition = activeWorld().startingPosition;
    const fallbackCell = activeWorld().cells[0];
    playerPose = startingPosition
      ? {
          cellId: startingPosition.cellId,
          position: startingPosition.position,
          yawRadians: startingPosition.yawRadians ?? 0,
          pitchRadians: startingPosition.pitchRadians ?? 0,
        }
      : {
          ...appState.playerPose,
          cellId: fallbackCell?.id ?? appState.playerPose.cellId,
        };
    xrRig.reset();
  }

  function teleportPlayerHome(): void {
    closeMenusForHomeTeleport();
    resetPlayerToHome();
  }

  function closeMenusForHomeTeleport(): void {
    if (desktopFlagEditor.isOpen()) {
      desktopFlagEditor.close();
    }
    if (menuState.isOpen || menuState.selectedTool !== "none") {
      cancelRuntimeMenuAndSelectedTool();
    }
  }

  function resetRuntimeWorld(): void {
    for (const runtime of dynamicObjectRuntimes) {
      runtime.reset(cellMeshes);
    }
    removePlacedFlags();
    removeGeodesicRuntimeObjects();
    removeMeasuredGeodesicLengths();
    removeProtractorAngles();
  }

  function tryUseProtractorToolFromAim(ray?: RootAimRay): void {
    if (!ray) {
      return;
    }

    const target = resolveCurrentAimTarget(ray);
    logVerboseAimClick(target);
    if (!targetIsWithinInteractionRange(target)) {
      return;
    }

    if (!activeProtractorToolState.center) {
      if (target?.object?.kind !== "geodesic-cannon" && target?.object?.kind !== "geodesic-intersection") {
        return;
      }

      activeProtractorToolState = {
        center: resolveProtractorCenterSelection(target.object),
      };
      syncDesktopPalette();
      return;
    }

    const selected = resolveProtractorDirectedSelectionFromAimTarget(target, activeProtractorToolState.center);
    if (!selected) {
      return;
    }

    if (!activeProtractorToolState.first) {
      activeProtractorToolState = {
        center: activeProtractorToolState.center,
        first: selected,
      };
      syncDesktopPalette();
      return;
    }

    if (!protractorSelectionsUseDifferentGeodesics(activeProtractorToolState.first, selected)) {
      return;
    }

    const angle = createProtractorAngleObject({
      id: `protractor-angle:${Date.now()}:${protractorAngleIdCounter++}`,
      center: activeProtractorToolState.center,
      first: activeProtractorToolState.first,
      second: selected,
    });
    runtimeObjectRegistry.add(angle);
    syncProtractorAngleRuntime(angle);
    activeProtractorToolState = {};
    clearProtractorToolFeedback();
    menuState = setRuntimeMenuSelectedTool(menuState, "none");
    syncDesktopPalette();
    syncSelectableHitboxDebug();
  }

  function tryRemoveFocusedProtractorAngle(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (focused?.object.kind !== "protractor-angle") {
      return false;
    }

    runtimeObjectRegistry.remove(focused.object.id);
    removeProtractorAngleRuntime(focused.object.id);
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
    return true;
  }

  function tryRemoveFocusedMeasuredGeodesicLength(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (focused?.object.kind !== "measured-geodesic-length") {
      return false;
    }

    runtimeObjectRegistry.remove(focused.object.id);
    removeMeasuredGeodesicLengthRuntime(focused.object.id);
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
    return true;
  }

  function tryUseFocusedObjectPrimaryInteraction(ray?: RootAimRay): boolean {
    if (!ray) {
      return false;
    }

    const target = resolveCurrentAimTarget(ray);
    if (!targetIsWithinInteractionRange(target)) {
      return false;
    }

    switch (target?.object?.kind) {
      case "asset":
        return tryOpenFocusedQuestionHelp(target.object);
      case "geodesic-segment":
        return tryExtendFocusedGeodesicFromAim(ray);
      case "measured-geodesic-length":
        return tryRemoveFocusedMeasuredGeodesicLength(ray);
      case "protractor-angle":
        return tryRemoveFocusedProtractorAngle(ray);
      default:
        return false;
    }
  }

  function openContextMenuFromAim(ray?: RootAimRay): void {
    if (menuState.isOpen) {
      applyDesktopScenePaletteToggle(reduceDesktopScenePaletteToggle(true, "secondary-click"));
      return;
    }

    if (tryOpenFocusedObjectMenu(ray)) {
      return;
    }

    menuState = openRuntimeMenu(menuState);
    syncDesktopPalette();
  }

  function tryOpenFocusedObjectMenu(ray?: RootAimRay): boolean {
    const focused = findFocusedRuntimeObject(ray);
    if (!focused) {
      return false;
    }

    if (
      focused.object.kind === "placed-flag" &&
      focused.object.interactable?.action === "edit-flag" &&
      isRuntimeToolEnabled(appConfig, "place-flag")
    ) {
      menuState = showRuntimeMenuEditSign(menuState, {
        flagId: focused.object.id,
        message: focused.object.message,
      });
      syncDesktopPalette();
      return true;
    }

    if (focused.object.kind === "geodesic-cannon" && isRuntimeToolEnabled(appConfig, "geodesic-cannon")) {
      activeGeodesicCannonToolState = {
        selectedCannonId: focused.object.id,
        activeGeodesicId: focused.object.activeGeodesicId,
      };
      menuState = showRuntimeMenuGeodesicCannonActions(menuState, {
        cannonId: focused.object.id,
        geodesicIds: focused.object.geodesicIds,
        geodesicLabelsById: getGeodesicLabelsById(focused.object.geodesicIds),
        lockedGeodesicIds: getLockedGeodesicIds(focused.object.geodesicIds),
        canTieAndDetach: canTieAndDetachGeodesicsFromCannon(focused.object.id),
      });
      syncDesktopPalette();
      return true;
    }

    if (focused.object.kind === "asset" && focused.object.interactable?.action === "open-geometry-computer") {
      menuState = showRuntimeMenuGeometryComputerActions(
        menuState,
        createGeometryComputerMenuOptions(focused.object.id),
      );
      syncDesktopPalette();
      return true;
    }

    if (focused.object.kind === "asset" && tryOpenFocusedQuestionHelp(focused.object)) {
      return true;
    }

    return false;
  }

  function tryOpenFocusedQuestionHelp(object: RuntimeWorldObject): boolean {
    if (object.kind !== "asset" || object.interactable?.action !== "open-tutorial") {
      return false;
    }

    const tutorialPages = object.tutorialPages ?? [];
    const goalPages = object.goalPages ?? [];
    if (tutorialPages.length === 0 && goalPages.length === 0) {
      return false;
    }

    menuState = showRuntimeMenuQuestionHelp(menuState, {
      objectId: object.id,
      tutorialPages,
      goalPages,
    });
    syncDesktopPalette();
    return true;
  }

  function stepOpenTutorialPage(delta: -1 | 1): void {
    const options = menuState.tutorialOptions;
    if (menuState.page !== "tutorial" || !options) {
      return;
    }

    menuState = setRuntimeMenuTutorialPageIndex(menuState, options.pageIndex + delta);
    syncDesktopPalette();
  }

  function stepOpenGoalPage(delta: -1 | 1): void {
    const options = menuState.goalOptions;
    if (menuState.page !== "goal" || !options) {
      return;
    }

    menuState = setRuntimeMenuGoalPageIndex(menuState, options.pageIndex + delta);
    syncDesktopPalette();
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

  function updateFloatingObjectTooltip(
    xrActive: boolean,
    activeAimRay: RootAimRay | undefined,
    xrHeadWorldPose: XrHeadWorldPose | undefined,
  ): void {
    if (menuState.isOpen || desktopFlagEditor.isOpen()) {
      floatingObjectTooltip.update({ visible: false });
      updateXrObjectTooltip(undefined);
      return;
    }

    const focused = findFocusedRuntimeObject(activeAimRay);
    const text = focused ? getRuntimeObjectTooltipText(focused.object, xrActive ? "xr" : "desktop") : undefined;
    if (xrActive) {
      floatingObjectTooltip.update({ visible: false });
      updateXrObjectTooltip(text && focused ? {
        text,
        anchor: focused.tooltipAnchor,
        headWorldPosition: xrHeadWorldPose?.position,
      } : undefined);
      return;
    }

    updateXrObjectTooltip(undefined);
    const screenPosition = focused ? resolveDesktopTooltipScreenPosition() : undefined;

    floatingObjectTooltip.update({
      visible: Boolean(text && screenPosition),
      text,
      xPixels: screenPosition?.x,
      yPixels: screenPosition?.y,
    });
  }

  function updateAimCrossMarker(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    if (
      (
        menuState.selectedTool !== "none" &&
        menuState.selectedTool !== "aim" &&
        menuState.selectedTool !== "place-flag" &&
        menuState.selectedTool !== "geodesic-cannon" &&
        menuState.selectedTool !== "geodesic-cannon-aim" &&
        menuState.selectedTool !== "geodesic-cannon-tie-detach" &&
        menuState.selectedTool !== "measure-length" &&
        menuState.selectedTool !== "protractor"
      ) ||
      menuState.isOpen ||
      desktopFlagEditor.isOpen()
    ) {
      aimCrossMarker.update(undefined);
      updateAimControllerRay(false);
      return;
    }

    const target = activeAimRay ? resolveCurrentAimTarget(activeAimRay) : undefined;
    aimCrossMarker.update(target, activeAimRay);
    updateAimControllerRay(xrActive && Boolean(target), activeAimRay, aimCrossMarker.root.position);
  }

  function updateAimControllerRay(
    visible: boolean,
    activeAimRay?: RootAimRay,
    targetPosition?: THREE.Vector3,
  ): void {
    if (!visible || !activeAimRay || !targetPosition) {
      aimControllerRay.visible = false;
      return;
    }

    aimControllerRayPositions[0] = activeAimRay.origin.x;
    aimControllerRayPositions[1] = activeAimRay.origin.y;
    aimControllerRayPositions[2] = activeAimRay.origin.z;
    aimControllerRayPositions[3] = targetPosition.x;
    aimControllerRayPositions[4] = targetPosition.y;
    aimControllerRayPositions[5] = targetPosition.z;
    aimControllerRayGeometry.attributes.position.needsUpdate = true;
    aimControllerRay.visible = true;
  }

  function updateProtractorToolFeedback(activeAimRay: RootAimRay | undefined): void {
    if (menuState.selectedTool !== "protractor" || menuState.isOpen || desktopFlagEditor.isOpen()) {
      clearProtractorToolFeedback();
      return;
    }

    const target = activeAimRay ? resolveCurrentAimTarget(activeAimRay) : undefined;
    const usableTarget = targetIsWithinInteractionRange(target) ? target : undefined;
    const center = activeProtractorToolState.center ??
      (usableTarget?.object?.kind === "geodesic-cannon" || usableTarget?.object?.kind === "geodesic-intersection"
        ? resolveProtractorCenterSelection(usableTarget.object)
        : undefined);
    if (!center) {
      clearProtractorToolFeedback();
      return;
    }

    const hoverSelection = activeProtractorToolState.center
      ? resolveProtractorDirectedSelectionFromAimTarget(usableTarget, activeProtractorToolState.center)
      : undefined;
    const validHoverSelection = hoverSelection && activeProtractorToolState.first &&
        !protractorSelectionsUseDifferentGeodesics(activeProtractorToolState.first, hoverSelection)
      ? undefined
      : hoverSelection;
    const feedback = createProtractorToolFeedback({
      center,
      centerLocked: Boolean(activeProtractorToolState.center),
      first: activeProtractorToolState.first,
      hover: validHoverSelection,
    });
    if (!feedback) {
      clearProtractorToolFeedback();
      return;
    }

    syncProtractorToolFeedback(feedback);
  }

  function resolveProtractorDirectedSelectionFromAimTarget(
    target: ReturnType<typeof resolveCurrentAimTarget>,
    center: ProtractorCenterSelection,
  ): ProtractorDirectedGeodesic | undefined {
    if (target?.object?.kind === "geodesic-segment") {
      const selected = resolveProtractorDirectedGeodesicSelection({
        center,
        segment: target.object,
        hitPoint: target.localPoint,
      });
      return selected ? withProtractorGeodesicLabel(selected) : undefined;
    }

    if (target?.object?.kind === "geodesic-cannon") {
      const selected = resolveProtractorEmitterGeodesicSelection({
        center,
        emitter: target.object,
        registry: runtimeObjectRegistry,
        geodesicId: target.geodesicEmitterGeodesicId,
      });
      return selected ? withProtractorGeodesicLabel(selected) : undefined;
    }

    return undefined;
  }

  function withProtractorGeodesicLabel(selection: ProtractorDirectedGeodesic): ProtractorDirectedGeodesic {
    return {
      ...selection,
      label: getGeodesicDisplayName(selection.geodesicId),
    };
  }

  function syncProtractorToolFeedback(feedback: {
    readonly signature: string;
    readonly cellId: string;
    readonly root: THREE.Group;
  }): void {
    if (protractorToolFeedback?.signature === feedback.signature) {
      disposeObject3D(feedback.root);
      return;
    }

    clearProtractorToolFeedback();
    const cellRoot = cellMeshes.get(feedback.cellId);
    if (!cellRoot) {
      disposeObject3D(feedback.root);
      return;
    }

    cellRoot.add(feedback.root);
    protractorToolFeedback = feedback;
  }

  function clearProtractorToolFeedback(): void {
    if (!protractorToolFeedback) {
      return;
    }

    protractorToolFeedback.root.removeFromParent();
    disposeObject3D(protractorToolFeedback.root);
    protractorToolFeedback = undefined;
  }

  function updateHelpLens(xrActive: boolean, activeAimRay: RootAimRay | undefined): void {
    if (menuState.isOpen || desktopFlagEditor.isOpen()) {
      helpLensRenderer.update({ visible: false, xrActive, camera });
      return;
    }

    const focused = findFocusedRuntimeObject(activeAimRay);
    if (helpLensFocusedObjectId) {
      if (focused?.object.id !== helpLensFocusedObjectId) {
        helpLensFocusedObjectId = undefined;
      } else {
        const definition = createHelpDefinitionForObject(focused.object, xrActive);
        helpLensRenderer.update({ visible: definition !== undefined, xrActive, camera, definition });
        return;
      }
    }

    const automaticObject = findAutomaticHelpObject();
    const definition = automaticObject ? createHelpDefinitionForObject(automaticObject, xrActive) : undefined;
    helpLensRenderer.update({
      visible: definition !== undefined,
      xrActive,
      camera,
      definition,
    });
  }

  function requestHelpLensForFocusedObject(activeAimRay: RootAimRay | undefined): void {
    const focused = findFocusedRuntimeObject(activeAimRay);
    const focusedObjectId = focused?.object.id;
    helpLensFocusedObjectId = focusedObjectId === helpLensFocusedObjectId ? undefined : focusedObjectId;
  }

  function createHelpDefinitionForObject(
    object: RuntimeWorldObject,
    xrActive: boolean,
  ): ReturnType<typeof createHelpLensDefinition> | undefined {
    const focus = getWorldFocusMessageDefinition(object);
    if (!focus) {
      return undefined;
    }

    return createHelpLensDefinition({
      focus,
      selectedTool: menuState.selectedTool,
      inputMode: xrActive ? "xr" : "desktop",
    });
  }

  function findAutomaticHelpObject(): RuntimeWorldObject | undefined {
    let best: { readonly object: RuntimeWorldObject; readonly distanceSquared: number } | undefined;
    for (const object of runtimeObjectRegistry.getObjectsInCell(playerPose.cellId)) {
      const rangeMeters = object.autoDisplayHelpRangeMeters;
      if (!object.displayHelpMessage || rangeMeters === undefined) {
        continue;
      }

      const dx = object.localPose.translation.x - playerPose.position.x;
      const dy = object.localPose.translation.y - playerPose.position.y;
      const dz = object.localPose.translation.z - playerPose.position.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared > rangeMeters * rangeMeters) {
        continue;
      }

      if (!best || distanceSquared < best.distanceSquared) {
        best = { object, distanceSquared };
      }
    }

    return best?.object;
  }

  function removeGeodesicRuntimeObjects(): void {
    for (const object of runtimeObjectRegistry.getAll()) {
      if (isGeodesicRuntimeRenderObject(object)) {
        runtimeObjectRegistry.remove(object.id);
      }
    }
    activeGeodesicCannonToolState = {};
    syncRuntimeObjectPortalInstances();
    syncSelectableHitboxDebug();
  }

  function dispatchRuntimeCommand(command: RuntimeCommand): void {
    commandDispatcher.dispatch(command);
  }
}
