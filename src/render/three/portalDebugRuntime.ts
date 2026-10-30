/**
 * Portal-path debug runtime: installs window.noneuclidPortalDebug, manages cell-path overlays and clip-polygon overlays, and feeds the on-screen debug overlay each frame.
 * It is created by createThreeApp#shell at startup and re-created (after dispose) whenever the world is rebuilt, because it captures the active world and its static-cull tables at creation time. Options are also read once at creation: changing debug options requires re-creation.
 * Portal paths are named by space-separated portal indices relative to the player's current root cell. Overlay geometry is built in the root cell frame (meters; world x right, y forward, z up) and converted to Three.js through worldAxes.
 * Lifecycle: the owner must call dispose() before discarding the runtime; it removes overlays, hides the debug overlay, and uninstalls the window helpers.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { checkPortalPathString, createPortalPathDebugState } from "../../cell-complex/portalPathDebug";
import { buildStaticallyCulledPortalPathTables, type StaticPortalPathCullResult } from "../../cell-complex/staticPortalPathCull";
import { type DebugLevelId } from "../../glue/debugLevels";
import { type DebugOptionId, hasActiveDebugOption } from "../../glue/debugOptions";
import { transformPoint3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import { type PlayerPose } from "../../movement/playerPose";
import { type RuntimeMenuState } from "../../runtime/runtimeMenuState";
import { createWorldGeometrySession } from "../../runtime/worldGeometrySession";
import {
  PortalDebugHelpers,
  PortalPathCheckResultWithVisibility,
  clipPolygonColorForIndex,
  dumpCameraPose,
  formatInspectedPathLine,
  installPortalDebugHelpers,
  liveVisibilityFields,
  mergeStaticPathCounts,
  pathToThreeMatrix,
  uninstallPortalDebugHelpers,
  visibleSummaryToRenderState,
} from "./appDebugHelpers";
import { logPortalDebugInstall, logPortalOverlayGuide } from "./appDebugLogging";
import { createDebugOverlay, type DebugOverlayState } from "./debugOverlay";
import {
  createPathTraceOverlay,
  hideCellPathOverlays,
  triangleFanIndices,
} from "./pathTraceOverlay";
import { PortalClipPolygonOverlayEntry, createPortalClipPolygonOverlay } from "./portalClipPolygonOverlay";
import { PortalInstanceDebugRenderer } from "./portalInstanceDebug";
import { PortalInstanceRenderDebugState } from "./renderPortalInstances";
import { createRenderQualityState, getRendererCssCanvasSize } from "./renderQuality";
import {
  FramePerformanceRenderState,
  PortalEyeRenderDebugState,
  WebGlRenderInfoState,
  XrDebugRenderState,
} from "./renderState";
import { disposeObject3D } from "./runtimeSceneUtils";
import { ComputeVisiblePortalPathsResult } from "./visiblePortalPaths";
import { worldPointToThree } from "./worldAxes";

/** Mutable app state the portal debug runtime reads each time it is used. */
export interface PortalDebugRuntimeLiveState {
  readonly debugLevel: DebugLevelId;
  readonly debugOptions: readonly DebugOptionId[];
  readonly playerPose: PlayerPose;
  readonly latestVisibleResult: ComputeVisiblePortalPathsResult | undefined;
  readonly portalInstanceDebugRenderer: PortalInstanceDebugRenderer | undefined;
  readonly portalInstanceRenderState: PortalInstanceRenderDebugState;
  readonly showCellPathRendersInstances: boolean;
  readonly menuState: RuntimeMenuState;
  readonly smoothedFrameRateFps: number | undefined;
  readonly smoothedFramePerformance: FramePerformanceRenderState | undefined;
  readonly latestWebGlRenderInfo: WebGlRenderInfoState | undefined;
  readonly xrDebugState: XrDebugRenderState;
}

/** Dependencies for {@link createPortalDebugRuntime}; createThreeApp#shell builds one object up front and reuses it for each re-creation, so values below are the shell's long-lived instances and functions are getters or callbacks into its mutable state. */
export interface PortalDebugRuntimeDeps {
  /** Maximum portal-path depth used when building debug static-cull tables. */
  readonly rootRenderPathMaxDepth: number;
  /** Scene that receives path overlays and the path-trace overlay. */
  readonly scene: THREE.Scene;
  /** Culling camera reported by DumpCameraPose. */
  readonly camera: THREE.PerspectiveCamera;
  /** Used for CSS canvas size (clip polygon overlay) and render-quality snapshots. */
  readonly renderer: THREE.WebGLRenderer;
  /** Pixel ratio the renderer was configured with, reported in the render-quality state. */
  readonly pixelRatio: number;
  /** App options subset: whether render-quality reporting is enabled. */
  readonly options: { readonly renderQualityEnabled: boolean };
  /** DOM overlay drawing tracked clip polygons; cleared on dispose. */
  readonly clipPolygonOverlay: ReturnType<typeof createPortalClipPolygonOverlay>;
  /** Text overlay updated each frame; hidden on dispose. */
  readonly debugOverlay: ReturnType<typeof createDebugOverlay>;
  /** Geometry session whose state is shown in the location block of the overlay. */
  readonly geometrySession: ReturnType<typeof createWorldGeometrySession>;
  /** Getter: the currently active compiled world. */
  activeWorld(): CompiledCellComplex;
  /** Getter: the shell's static-cull result, reused unless the static-cull-debug option requests a fresh one with rejected-path details. */
  activeStaticCull(): StaticPortalPathCullResult;
  /** Returns per-eye visible-path stats (XR), or undefined when not applicable. */
  createPortalEyeDebugStates(): readonly PortalEyeRenderDebugState[] | undefined;
  /** Getter returning the shell's current mutable state; call it each time rather than caching the result. */
  live(): PortalDebugRuntimeLiveState;
  /** Callback writing back the shell's flag toggled via the console helper. */
  setShowCellPathRendersInstances(value: boolean): void;
}

/** Handle returned by {@link createPortalDebugRuntime}. */
export interface PortalDebugRuntime {
  /** Per-frame update: refreshes the debug overlay text and the tracked clip polygons from the latest visibility result. Returns the overlay state it pushed, for the in-headset panel. */
  updateVisiblePortalPaths(): DebugOverlayState;
  /** Re-applies the active ShowCellPath overlay after the player's root cell changed, clearing it if the path is no longer valid. */
  syncRootCell(): void;
  /** Removes all overlays, hides the debug overlay, clears tracked clip polygons, and uninstalls the window.noneuclidPortalDebug helpers. */
  dispose(): void;
}

/**
 * Creates the portal debug runtime and installs window.noneuclidPortalDebug.
 * Side effects at creation: logs to the console and, when the static-cull-debug option is active, synchronously builds a fresh statically culled path table with rejected-path details (up to 50,000 kept paths per root), which can be slow. Console guides are printed depending on the active portal debug options. The helpers are installed regardless of which portal debug options are active.
 * The caller must call dispose() on the result before creating another runtime.
 */
export function createPortalDebugRuntime(deps: PortalDebugRuntimeDeps): PortalDebugRuntime {
  const {
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
  } = deps;

  // Option flags are sampled once, at creation.
  const portalPathDebugActive = hasActiveDebugOption(deps.live().debugLevel, deps.live().debugOptions, "portal-path-debug");
  const visiblePathDebugActive = hasActiveDebugOption(deps.live().debugLevel, deps.live().debugOptions, "portal-visible-path-debug");
  const overlayActive = hasActiveDebugOption(deps.live().debugLevel, deps.live().debugOptions, "portal-path-overlays");

  const staticCullDebugActive = hasActiveDebugOption(deps.live().debugLevel, deps.live().debugOptions, "portal-static-cull-debug");
  if (portalPathDebugActive || visiblePathDebugActive || staticCullDebugActive) {
    console.info(`Portal path debug is building contextually culled path tables to depth ${rootRenderPathMaxDepth}.`);
  }
  // A dedicated table with rejected-path details is built only for static-cull debugging; otherwise reuse the shell's table.
  const staticCull = staticCullDebugActive
    ? buildStaticallyCulledPortalPathTables(activeWorld(), {
        maxDepth: rootRenderPathMaxDepth,
        skipImmediateReverse: true,
        toleranceMeters: 1e-6,
        maxKeptPathsPerRoot: 50_000,
        keepRejectedPathDetails: true,
        onRootComplete(status) {
          if (!portalPathDebugActive) {
            return;
          }

          console.info(
            [
              "Portal path debug root complete:",
              `root=${status.rootCellId}`,
              `kept=${status.keptPathCount}`,
              `rejected=${status.rejectedPathCount}`,
              `keptByDepth=${status.keptPathCountByDepth.join(",")}`,
              `budgetExhausted=${status.budgetExhausted}`,
            ].join(" "),
          );
        },
      })
    : activeStaticCull();
  const candidateTables = staticCull.tables;
  // Standalone floor-overlay meshes created by ShowCellPath (not used when instances are rendered).
  const overlays: THREE.Object3D[] = [];
  // Path currently shown via ShowCellPath, remembered so it can be re-applied when the root cell changes.
  let activeOverlayPathText: string | undefined;
  let activeOverlayPathCheck: PortalPathCheckResultWithVisibility | undefined;
  let activePathTraceOverlay: THREE.Object3D | undefined;
  // Tracked clip-polygon paths in insertion order, each with a stable palette color.
  const selectedClipPolygonPaths = new Map<string, { readonly color: string; readonly order: number }>();
  let nextClipPolygonOrder = 0;
  function removeActivePathTraceOverlay(): void {
    if (!activePathTraceOverlay) {
      return;
    }

    scene.remove(activePathTraceOverlay);
    disposeObject3D(activePathTraceOverlay);
    activePathTraceOverlay = undefined;
  }

  // Resolves a path string against the player's current root cell and attaches live visibility data.
  const checkPath = (pathText: string): PortalPathCheckResultWithVisibility => {
    const check = checkPortalPathString(pathText, {
      world: activeWorld(),
      rootCellId: deps.live().playerPose.cellId,
      candidateTables,
      keptTables: staticCull.tables,
      cullSummariesByRootCellId: staticCull.summariesByRootCellId,
    });

    return {
      ...check,
      ...liveVisibilityFields(check.matchedPathId, deps.live().latestVisibleResult),
    };
  };

  // Redraws the tracked polygons for paths that survived static culling and are visible this frame.
  const updateSelectedClipPolygonOverlay = (): void => {
    const latestVisibleResult = deps.live().latestVisibleResult;
    if (!latestVisibleResult) {
      clipPolygonOverlay.clear();
      return;
    }

    const entries: PortalClipPolygonOverlayEntry[] = [];

    for (const [pathText, selection] of [...selectedClipPolygonPaths.entries()].sort(
      (left, right) => left[1].order - right[1].order,
    )) {
      const check = checkPath(pathText);
      if (!check.valid || !check.survivedStaticCull || check.matchedPathId === undefined) {
        continue;
      }

      const visiblePath = latestVisibleResult.visiblePathById.get(check.matchedPathId);
      if (!visiblePath) {
        continue;
      }

      entries.push({
        pathText,
        color: selection.color,
        clipPolygonNdc: visiblePath.clipPolygonNdc,
      });
    }

    clipPolygonOverlay.update(
      entries,
      getRendererCssCanvasSize(renderer),
    );
  };

  installPortalDebugHelpers({
    CheckCellPath: checkPath,
    // Replaces any previous overlay. Draws either the destination cell's instances or a translucent floor polygon, plus a path trace.
    ShowCellPath(pathText: string) {
      const check = checkPath(pathText);

      if (!check.valid || !check.survivedStaticCull || check.matchedPathId === undefined) {
        hideCellPathOverlays(overlays, scene);
        deps.live().portalInstanceDebugRenderer?.clear();
        activeOverlayPathText = undefined;
        activeOverlayPathCheck = undefined;
        removeActivePathTraceOverlay();
        return {
          ok: false,
          reason: check.rejectionReason ?? check.errors[0] ?? "path is not available in the kept table",
          check,
          pathId: check.matchedPathId,
          destinationCellId: check.destinationCellId,
          survivedStaticCull: check.survivedStaticCull,
          ...liveVisibilityFields(check.matchedPathId, deps.live().latestVisibleResult),
          objectCount: 0,
        };
      }

      hideCellPathOverlays(overlays, scene);
      removeActivePathTraceOverlay();
      const table = staticCull.tables.tablesByRootCellId.get(deps.live().playerPose.cellId);
      const path = table?.pathsById.get(check.matchedPathId);
      const destinationCell = check.destinationCellId ? activeWorld().cellsById.get(check.destinationCellId) : undefined;

      if (!path || !destinationCell) {
        return {
          ok: false,
          reason: "matched path or destination cell was not found",
          check,
          pathId: check.matchedPathId,
          destinationCellId: check.destinationCellId,
          survivedStaticCull: check.survivedStaticCull,
          ...liveVisibilityFields(check.matchedPathId, deps.live().latestVisibleResult),
          objectCount: 0,
        };
      }

      let objectCount = 0;

      if (deps.live().showCellPathRendersInstances) {
        objectCount = deps.live().portalInstanceDebugRenderer?.renderCellInstances(
          path.destinationCellId,
          pathToThreeMatrix(path),
        ).objectCount ?? 0;
      } else {
        const geometry = new THREE.BufferGeometry();
        // Floor outline lifted 0.03 m above the floor, mapped from destination-cell into root-cell coordinates.
        const vertices = destinationCell.baseVertices.map((vertex) =>
          transformPoint3(path.rootFromDestination, vec3(vertex.x, vertex.y, 0.03)),
        );
        geometry.setFromPoints(vertices.map((vertex) => worldPointToThree(vertex)));
        geometry.setIndex(triangleFanIndices(vertices.length));
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(destinationCell.floorColor),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `debug-cell-path-overlay:${path.id}`;
        scene.add(mesh);
        overlays.push(mesh);
        objectCount = 1;
      }

      activePathTraceOverlay = createPathTraceOverlay(activeWorld(), path);
      scene.add(activePathTraceOverlay);
      activeOverlayPathText = pathText;
      activeOverlayPathCheck = check;

      return {
        ok: true,
        check,
        pathId: path.id,
        destinationCellId: path.destinationCellId,
        survivedStaticCull: true,
        ...liveVisibilityFields(path.id, deps.live().latestVisibleResult),
        objectCount,
      };
    },
    HideCellPaths() {
      hideCellPathOverlays(overlays, scene);
      deps.live().portalInstanceDebugRenderer?.clear();
      removeActivePathTraceOverlay();
      activeOverlayPathText = undefined;
      activeOverlayPathCheck = undefined;
    },
    // Starts tracking the path; assigns the next palette color the first time it is seen.
    ShowCellPathClipPolygon(pathText: string) {
      const check = checkPath(pathText);
      if (!check.valid || !check.survivedStaticCull || check.matchedPathId === undefined) {
        return {
          ok: false,
          reason: check.rejectionReason ?? check.errors[0] ?? "path is not available in the kept table",
          trackedPathTexts: [...selectedClipPolygonPaths.keys()],
          currentlyVisible: false,
          clipPolygonNdc: undefined,
        };
      }

      if (!selectedClipPolygonPaths.has(pathText)) {
        selectedClipPolygonPaths.set(pathText, {
          color: clipPolygonColorForIndex(nextClipPolygonOrder),
          order: nextClipPolygonOrder,
        });
        nextClipPolygonOrder += 1;
      }

      updateSelectedClipPolygonOverlay();
      const visiblePath = deps.live().latestVisibleResult?.visiblePathById.get(check.matchedPathId);

      return {
        ok: true,
        pathId: check.matchedPathId,
        destinationCellId: check.destinationCellId,
        trackedPathTexts: [...selectedClipPolygonPaths.keys()],
        currentlyVisible: visiblePath !== undefined,
        clipPolygonNdc: visiblePath?.clipPolygonNdc,
      };
    },
    HideCellPathClipPolygon(pathText?: string) {
      if (pathText === undefined) {
        selectedClipPolygonPaths.clear();
      } else {
        selectedClipPolygonPaths.delete(pathText);
      }

      updateSelectedClipPolygonOverlay();
      return {
        trackedPathTexts: [...selectedClipPolygonPaths.keys()],
      };
    },
    HideClipPolygons() {
      selectedClipPolygonPaths.clear();
      updateSelectedClipPolygonOverlay();
      return {
        trackedPathTexts: [...selectedClipPolygonPaths.keys()],
      };
    },
    DumpCameraPose() {
      return dumpCameraPose(deps.live().playerPose, camera, renderer, options.renderQualityEnabled);
    },
    get state() {
      return {
        ...createPortalPathDebugState(deps.live().playerPose.cellId, candidateTables, staticCull),
        visiblePortalPaths: deps.live().latestVisibleResult?.summary,
        portalInstances: deps.live().portalInstanceRenderState,
        stereoPortalPaths: deps.live().xrDebugState.stereoPortalPaths,
        renderQuality: createRenderQualityState(renderer, pixelRatio, options.renderQualityEnabled),
        ShowCellPathRendersInstances: deps.live().showCellPathRendersInstances,
      };
    },
    // Exposed as a live property so console assignments update the shell's flag.
    get ShowCellPathRendersInstances() {
      return deps.live().showCellPathRendersInstances;
    },
    set ShowCellPathRendersInstances(value: boolean) {
      deps.setShowCellPathRendersInstances(Boolean(value));
    },
    candidateTables,
    staticCull,
  });
  if (portalPathDebugActive) {
    logPortalDebugInstall(candidateTables, staticCull, staticCullDebugActive, overlayActive);
  }
  if (overlayActive) {
    logPortalOverlayGuide(true);
  }

  return {
    // Overlay sections are gated by the debug menu state: overall visibility, plus the fps, location and portal-quantities items.
    updateVisiblePortalPaths() {
      const latestVisibleResult = deps.live().latestVisibleResult;
      const visibleSummary = visiblePathDebugActive && latestVisibleResult
        ? visibleSummaryToRenderState(mergeStaticPathCounts(latestVisibleResult.summary, staticCull, deps.live().playerPose.cellId))
        : undefined;
      const showDebugOverlay = deps.live().menuState.debugEnabled && deps.live().menuState.debugOverlayEnabled;
      const showFps = deps.live().menuState.debugOverlayItems.includes("fps");
      const showLocation = deps.live().menuState.debugOverlayItems.includes("location");
      const showPortalQuantities = deps.live().menuState.debugOverlayItems.includes("portal-quantities");

      const overlayState: DebugOverlayState = {
        visible: showDebugOverlay,
        frameRateFps: showFps ? deps.live().smoothedFrameRateFps : undefined,
        framePerformance: showFps ? deps.live().smoothedFramePerformance : undefined,
        webGlRenderInfo: showFps ? deps.live().latestWebGlRenderInfo : undefined,
        visiblePortalPaths: showPortalQuantities ? visibleSummary : undefined,
        portalEyes: showPortalQuantities ? createPortalEyeDebugStates() : undefined,
        stereoPortalPaths: showPortalQuantities ? deps.live().xrDebugState.stereoPortalPaths : undefined,
        portalInstances: showPortalQuantities ? deps.live().portalInstanceRenderState : undefined,
        location: showLocation ? deps.live().xrDebugState : undefined,
        geometry: showLocation ? geometrySession.state : undefined,
        inspectedPathLine: showPortalQuantities
          ? formatInspectedPathLine(activeOverlayPathText, activeOverlayPathCheck, deps.live().latestVisibleResult)
          : undefined,
      };
      debugOverlay.update(overlayState);
      updateSelectedClipPolygonOverlay();
      return overlayState;
    },
    syncRootCell() {
      if (activeOverlayPathText === undefined) {
        return;
      }

      // Re-run ShowCellPath through the installed helper; drop the overlay if it no longer resolves in the new root cell.
      const refreshResult = (window as typeof window & { noneuclidPortalDebug?: PortalDebugHelpers })
        .noneuclidPortalDebug?.ShowCellPath(activeOverlayPathText);

      if (!refreshResult?.ok) {
        hideCellPathOverlays(overlays, scene);
        deps.live().portalInstanceDebugRenderer?.clear();
        removeActivePathTraceOverlay();
        activeOverlayPathText = undefined;
        activeOverlayPathCheck = undefined;
      }
    },
    dispose() {
      hideCellPathOverlays(overlays, scene);
      deps.live().portalInstanceDebugRenderer?.clear();
      removeActivePathTraceOverlay();
      activeOverlayPathText = undefined;
      activeOverlayPathCheck = undefined;
      debugOverlay.update({ visible: false });
      selectedClipPolygonPaths.clear();
      clipPolygonOverlay.clear();
      uninstallPortalDebugHelpers();
    },
  };
}
