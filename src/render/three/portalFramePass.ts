/**
 * The portal pass of a frame: which portal paths are visible from the render roots (one per eye), the instance transforms and clip
 * data written for them, and the results the rest of the app reads afterwards.
 *
 * `createPortalFramePass` owns the portal pass state: the latest visibility result, the per-eye results and active eye index
 * (stereo XR), the split-root flags, the instance and stereo debug states, the frame snapshot built for the runtime-object sync, and
 * the per-cell render archetypes with their debug renderer. The shell and other modules read them through the handle. The
 * visibility computation itself is `computeVisiblePortalPaths` (mono) and `buildStereoPortalFrame` (stereo); the mono root list,
 * the eye activator and the instance writer are the existing helpers `portalFrameRender`, `portalEyeActivation` and
 * `renderPortalInstances`. Ghost rules for objects are not decided here (see `runtimeObjectGhostRecords.ts`).
 *
 * Every sync takes the frame `serial` of the shell, which stamps the frame snapshot; the pass does not store it.
 */
import { readLocalPlayerPose, type WorldEngine } from "../../engine/worldEngine";
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { StaticPortalPathCullResult } from "../../cell-complex/staticPortalPathCull";
import type { VisiblePortalPathOptions } from "../../visibility/visiblePortalPaths";
import type { ClientSession } from "../../runtime/clientSession";
import { mergeStaticPathCounts } from "./appDebugHelpers";
import {
  type BuildCellRenderArchetypesOptions,
  type CellRenderArchetype,
  buildCellRenderArchetypes,
  disposeCellRenderArchetypes,
} from "./cellRenderArchetypes";
import {
  type FrameRenderSnapshot,
  createEmptyFrameRenderSnapshot,
  createFrameRenderSnapshot,
} from "./frameRenderSnapshot";
import type { PortalClipData } from "./portalClipData";
import { type PortalClipMaterialState, updatePortalClipMaterialTextureEye } from "./portalClipMaterial";
import { createPortalEyeActivator } from "./portalEyeActivation";
import {
  type PortalEyeRenderState,
  countStereoPortalPaths,
  transformVisiblePortalResultToRenderFrame,
} from "./portalEyeFrameTransforms";
import { createMonoPortalRenderRoots } from "./portalFrameRender";
import { type PortalInstanceDebugRenderer, createPortalInstanceDebugRenderer } from "./portalInstanceDebug";
import {
  type PortalInstanceRenderDebugState,
  buildVisiblePathsByDestinationCell,
  createPortalInstanceDiagnostics,
  createPortalInstanceRenderDebugState,
  groupVisiblePortalPathsByDestinationCell,
  omitPathsWithoutClipSlot,
  updateCellRenderArchetypeInstances,
} from "./renderPortalInstances";
import { getPortalViewportPixels } from "./renderQuality";
import type { PortalEyeRenderDebugState, StereoPortalPathRenderState } from "./renderState";
import { buildStereoPortalFrame } from "./stereoPortalFrame";
import {
  type ComputeVisiblePortalPathsResult,
  type VisiblePortalPath,
  computeVisiblePortalPaths,
} from "./visiblePortalPaths";
import {
  type XrPortalEyeRenderRoot,
  type XrPortalEyeRenderRootTarget,
  createXrPortalEyeRenderRootTarget,
  resolveXrPortalEyeRenderRoot,
} from "./xrPortalEye";

/** Dependencies of {@link createPortalFramePass}. */
export interface PortalFramePassDeps {
  readonly scene: THREE.Scene;
  /** The main (desktop) camera; also the initial camera of the mono root list. */
  readonly camera: THREE.Camera;
  readonly renderer: THREE.WebGLRenderer;
  readonly session: ClientSession;
  /** The world engine; the player's pose is read from it. */
  readonly engine: WorldEngine;
  /** Options of every visibility call (mono, shared-root stereo, split-root stereo). */
  readonly visiblePortalPathOptions: VisiblePortalPathOptions;
  /** The world of the active geometry; read on every sync because a geometry commit replaces it. */
  readonly getWorld: () => CompiledCellComplex;
  /** Static cull of the active geometry, read on every sync. */
  readonly getStaticCull: () => StaticPortalPathCullResult;
  readonly portalClipData: PortalClipData;
  readonly portalClipMaterialState: PortalClipMaterialState;
  /** Turns hardware clip distances on while a patched mesh draws (no-op without the extension). */
  readonly enablePortalClipDistances: () => void;
  /** Turns hardware clip distances off after a patched mesh drew. */
  readonly disablePortalClipDistances: () => void;
}

/** Handle of the portal pass; see the module comment. */
export interface PortalFramePass {
  /** Mono pass from the player's cell with the main camera. */
  syncPlayerCell(serial: number): void;
  /** Mono pass from the player's cell with `cullingCamera` (desktop). */
  syncDesktop(cullingCamera: THREE.Camera, serial: number): void;
  /** XR pass: stereo when there are several culling cameras (one root per eye), else mono from the eye's re-rooted cell. */
  syncXr(cullingCameras: readonly THREE.Camera[], serial: number): void;
  /** Drops the visibility results (they refer to path ids of a replaced geometry); the next sync rebuilds them. */
  reset(): void;
  /** The frame snapshot of the last pass, or an empty one for the player's cell before any pass ran. */
  frameSnapshot(serial: number): FrameRenderSnapshot;
  /** Visibility result of the last pass (eye 0 in stereo); `undefined` after `reset` or when the root has no cull table. */
  latestVisibleResult(): ComputeVisiblePortalPathsResult | undefined;
  /** Instance render state of the last pass, for the debug overlay and API. */
  instanceRenderState(): PortalInstanceRenderDebugState;
  /** Stereo path counts of the last stereo pass; `undefined` otherwise. */
  stereoPathState(): StereoPortalPathRenderState | undefined;
  /** Per-eye debug states of the last stereo pass; `undefined` on desktop. */
  eyeDebugStates(): readonly PortalEyeRenderDebugState[] | undefined;
  /** Per-cell render archetypes of the active world. */
  cellRenderArchetypes(): readonly CellRenderArchetype[];
  /** Debug renderer of the archetypes' instances, when built. */
  instanceDebugRenderer(): PortalInstanceDebugRenderer | undefined;
  /** Removes and disposes the archetypes and their debug renderer (before the cell groups of a world are rebuilt). */
  disposeArchetypes(): void;
  /** Builds the archetypes of `world`, hooks their eye activation and adds them to the scene. */
  buildArchetypes(world: CompiledCellComplex, options: Omit<BuildCellRenderArchetypesOptions, "portalClipMaterialState">): void;
  /** `onBeforeRender` hook of every patched mesh: activates the eye of the camera and enables clip distances. */
  beforeMeshRender(renderer: THREE.WebGLRenderer, renderCamera: THREE.Camera): void;
  /** `onAfterRender` hook of every patched mesh. */
  afterMeshRender(): void;
  /** Disposes the archetypes and the debug renderer. */
  dispose(): void;
}

/** Creates the portal pass over `deps`. */
export function createPortalFramePass(deps: PortalFramePassDeps): PortalFramePass {
  const { scene, camera, renderer, session, engine, portalClipData, portalClipMaterialState } = deps;
  const portalInstanceDiagnostics = createPortalInstanceDiagnostics();
  let portalClipOverflowWarned = false;
  let latestFrameSnapshot: FrameRenderSnapshot | undefined;
  let latestVisibleResult: ComputeVisiblePortalPathsResult | undefined;
  // Per-eye results in stereo XR (empty on desktop); activePortalEyeIndex is set while rendering each eye.
  let portalEyeRenderStates: readonly PortalEyeRenderState[] = [];
  let activePortalEyeIndex = 0;
  // Split-root stereo (eyes with different root cell or frame) clips each eye's root to its own eye; otherwise the
  // root is drawn unclipped. Set by every portal pass; the root-group map is only present in split-root stereo.
  let portalRootsUnclipped = true;
  let portalRootGroupByPathId: ReadonlyMap<number, number> | undefined;
  let stereoPortalPathState: StereoPortalPathRenderState | undefined;
  let portalInstanceRenderState: PortalInstanceRenderDebugState = {
    enabled: true,
    ShowCellPathRendersInstances: session.get().showCellPathRendersInstances,
    archetypeCount: 0,
    totalCapacity: 0,
    renderedInstanceCount: 0,
    renderedInstanceCountByCell: [],
    capacityOverflowCount: 0,
    capacityOverflowArchetypes: [],
    normalVisiblePathRenderingActive: false,
    visiblePathIds: [],
    visiblePathDestinations: [],
    visiblePathOverflowCount: 0,
    portalClipMode: portalClipMaterialState.hardwareClipDistances ? "hardware" : "fragment",
  };
  let cellRenderArchetypes: readonly CellRenderArchetype[] = [];
  let portalInstanceDebugRenderer: PortalInstanceDebugRenderer | undefined;

  const portalEyeActivator = createPortalEyeActivator({
    getEyeCount: () => portalEyeRenderStates.length,
    applyEye: (eyeIndex) => {
      activePortalEyeIndex = eyeIndex;
      updatePortalClipMaterialTextureEye(portalClipMaterialState, eyeIndex);
    },
  });
  scene.onBeforeRender = () => portalEyeActivator.beginRender();
  // One persistent camera and matrix per XR eye for re-rooted eyes (see resolveXrPortalEyeRenderRoot).
  const portalEyeRootTargets: XrPortalEyeRenderRootTarget[] = [];
  // The one-element render-root list of the mono portal pass, rewritten in place each frame.
  const monoPortalRoots = createMonoPortalRenderRoots(camera);
  // Scratch positions per eye for the frame snapshot; alias scratch, valid until the next portal pass.
  const runtimeObjectCameraPositionScratch: THREE.Vector3[] = [];
  const frameCameraPositions: THREE.Vector3[] = [];

  function resolvePortalEyeRenderRoot(cullingCamera: THREE.Camera, eyeIndex: number): XrPortalEyeRenderRoot {
    return resolveXrPortalEyeRenderRoot({
      world: deps.getWorld(),
      sourceCellId: readLocalPlayerPose(engine).cellId,
      anchorPoint: readLocalPlayerPose(engine).position,
      camera: cullingCamera,
      target: (portalEyeRootTargets[eyeIndex] ??= createXrPortalEyeRenderRootTarget()),
    });
  }

  // The one visibility pass. `renderRoots` holds one root per eye: a single root is the mono pass, several are the
  // stereo (XR) pass. If any root cell has no static cull table, visibility is cleared and nothing is instanced.
  function syncPortalInstances(renderRoots: readonly XrPortalEyeRenderRoot[], serial: number): void {
    portalInstanceDiagnostics.reset();
    portalEyeRenderStates = [];
    resetStereoPortalState();
    activePortalEyeIndex = 0;
    updatePortalClipMaterialTextureEye(portalClipMaterialState, activePortalEyeIndex);
    const hasTables = renderRoots.every((renderRoot) =>
      deps.getStaticCull().tables.tablesByRootCellId.has(renderRoot.rootCellId)
    );

    if (!hasTables) {
      clearPortalInstances(renderRoots[0]?.rootCellId ?? readLocalPlayerPose(engine).cellId, serial);
    } else if (renderRoots.length === 1) {
      syncMonoPortalFrame(renderRoots[0], serial);
    } else {
      syncStereoPortalFrame(renderRoots, serial);
    }
  }

  // Empty visibility result: no visible paths, no clip data, no instances.
  function clearPortalInstances(rootCellId: string, serial: number): void {
    latestVisibleResult = undefined;
    latestFrameSnapshot = createEmptyFrameRenderSnapshot(serial, rootCellId);
    portalClipData.update([]);
    updateCellRenderArchetypeInstances(cellRenderArchetypes, new Map(), portalInstanceDiagnostics);
    portalInstanceRenderState = createPortalInstanceRenderDebugState(
      cellRenderArchetypes,
      new Map(),
      portalInstanceDiagnostics,
      {
        enabled: false,
        showCellPathRendersInstances: session.get().showCellPathRendersInstances,
        normalVisiblePathRenderingActive: false,
      },
    );
  }

  // Mono pass body: computes visible portal paths from `renderRoot` (its cell has a static cull table).
  function syncMonoPortalFrame(renderRoot: XrPortalEyeRenderRoot, serial: number): void {
    const staticCull = deps.getStaticCull();
    const table = staticCull.tables.tablesByRootCellId.get(renderRoot.rootCellId)!;
    const computed = computeVisiblePortalPaths({
      world: deps.getWorld(),
      rootCellId: renderRoot.rootCellId,
      pathTable: table,
      camera: renderRoot.camera,
      viewportPixels: getPortalViewportPixels(renderer),
      options: deps.visiblePortalPathOptions,
    });
    const renderedComputed = transformVisiblePortalResultToRenderFrame(computed, renderRoot.renderFromRootMatrix);
    const summary = mergeStaticPathCounts(renderedComputed.summary, staticCull, renderRoot.rootCellId);
    latestVisibleResult = {
      ...renderedComputed,
      summary,
    };
    portalClipData.update(latestVisibleResult.paths);
    const visiblePathsByDestinationCell = omitPathsWithoutClipSlot(
      buildVisiblePathsByDestinationCell(table.pathsByDestinationCellId, latestVisibleResult.visiblePathById),
      portalClipData.clipIndexByPathId,
    );
    updatePortalVisiblePathInstances(visiblePathsByDestinationCell, true);
    latestFrameSnapshot = createFrameRenderSnapshot({
      serial,
      rootCellId: renderRoot.rootCellId,
      visiblePathsByDestinationCell,
      clipIndexByPathId: portalClipData.clipIndexByPathId,
      cameraPositions: monoCameraPositions(renderRoot),
    });
    portalInstanceRenderState = createPortalInstanceRenderStateFromVisibleResult(
      latestFrameSnapshot.visiblePathsByDestinationCell,
      latestVisibleResult,
      true,
    );
  }

  // Stereo pass body: each eye has its own root and result; the union of paths is instanced once and per-eye
  // clip data selects the eye in onBeforeRender. latestVisibleResult holds eye 0 only.
  function syncStereoPortalFrame(renderRoots: readonly XrPortalEyeRenderRoot[], serial: number): void {
    const frame = buildStereoPortalFrame({
      world: deps.getWorld(),
      staticCull: deps.getStaticCull(),
      renderRoots,
      viewportPixels: getPortalViewportPixels(renderer),
      options: deps.visiblePortalPathOptions,
    })!;
    portalEyeRenderStates = frame.eyeStates;
    portalRootsUnclipped = !frame.splitRoots;
    portalRootGroupByPathId = frame.splitRoots ? frame.rootGroupByPathId : undefined;

    latestVisibleResult = portalEyeRenderStates[0]?.result;
    activePortalEyeIndex = 0;
    updatePortalClipMaterialTextureEye(portalClipMaterialState, activePortalEyeIndex);
    if (latestVisibleResult) {
      frameCameraPositions.length = renderRoots.length;
      renderRoots.forEach((renderRoot, eyeIndex) => {
        frameCameraPositions[eyeIndex] = runtimeObjectCameraPosition(
          renderRoot.camera,
          renderRoot.renderFromRootMatrix,
          eyeIndex,
        );
      });
      const cameraPositions = frameCameraPositions;
      portalClipData.updateStereo(portalEyeRenderStates.map((state) => state.result.paths));
      stereoPortalPathState = countStereoPortalPaths(
        portalEyeRenderStates,
        portalClipData.acceptedPathIds,
        frame.splitRoots,
      );
      // Only paths that won a clip slot are instanced, in rank order (per-cell capacity cuts follow the rank).
      const visiblePathsByDestinationCell = omitPathsWithoutClipSlot(
        groupVisiblePortalPathsByDestinationCell(portalClipData.rankedAcceptedPaths),
        portalClipData.clipIndexByPathId,
      );
      updatePortalVisiblePathInstances(visiblePathsByDestinationCell, portalRootsUnclipped);
      latestFrameSnapshot = createFrameRenderSnapshot({
        serial,
        rootCellId: portalEyeRenderStates[0]?.rootCellId ?? readLocalPlayerPose(engine).cellId,
        visiblePathsByDestinationCell,
        clipIndexByPathId: portalClipData.clipIndexByPathId,
        cameraPositions,
        unclippedRoot: portalRootsUnclipped,
        rootGroupByPathId: portalRootGroupByPathId,
      });
      portalInstanceRenderState = createPortalInstanceRenderStateFromVisibleResult(
        latestFrameSnapshot.visiblePathsByDestinationCell,
        latestVisibleResult,
        true,
      );
    } else {
      clearPortalInstances(renderRoots[0]?.rootCellId ?? readLocalPlayerPose(engine).cellId, serial);
    }
  }

  function resetStereoPortalState(): void {
    portalRootsUnclipped = true;
    portalRootGroupByPathId = undefined;
    stereoPortalPathState = undefined;
  }

  // `separateRoot`: draw the depth-0 path with each archetype's unpatched root mesh and no clip test (valid when all
  // eyes share one root identity); false clips each depth-0 instance to the eye that owns it (split roots).
  function updatePortalVisiblePathInstances(
    visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
    separateRoot: boolean,
  ): void {
    if (portalClipData.visiblePathOverflowCount > 0 && !portalClipOverflowWarned) {
      portalClipOverflowWarned = true;
      console.warn(
        `Portal clip slots exhausted: ${portalClipData.visiblePathOverflowCount} visible paths are not drawn.`,
      );
    }

    updateCellRenderArchetypeInstances(
      cellRenderArchetypes,
      visiblePathsByDestinationCell,
      portalInstanceDiagnostics,
      portalClipData.clipIndexByPathId,
      { separateRoot, unclippedRoot: separateRoot },
    );
  }

  function createPortalInstanceRenderStateFromVisibleResult(
    visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
    result: ComputeVisiblePortalPathsResult,
    normalVisiblePathRenderingActive: boolean,
  ): PortalInstanceRenderDebugState {
    return createPortalInstanceRenderDebugState(
      cellRenderArchetypes,
      visiblePathsByDestinationCell,
      portalInstanceDiagnostics,
      {
        enabled: true,
        showCellPathRendersInstances: session.get().showCellPathRendersInstances,
        normalVisiblePathRenderingActive,
        visiblePaths: result.paths,
        visiblePathOverflowCount: portalClipData.visiblePathOverflowCount,
        portalClipMode: portalClipMaterialState.hardwareClipDistances ? "hardware" : "fragment",
      },
    );
  }

  /**
   * Viewer position in the render frame for eye `eyeIndex`. Aliases per-eye scratch: valid until the next portal pass.
   */
  function runtimeObjectCameraPosition(
    renderCamera: THREE.Camera,
    renderFromRootMatrix: THREE.Matrix4 | undefined,
    eyeIndex: number,
  ): THREE.Vector3 {
    renderCamera.updateMatrixWorld(true);
    const position = (runtimeObjectCameraPositionScratch[eyeIndex] ??= new THREE.Vector3());
    position.setFromMatrixPosition(renderCamera.matrixWorld);
    return renderFromRootMatrix ? position.applyMatrix4(renderFromRootMatrix) : position;
  }

  function monoCameraPositions(renderRoot: XrPortalEyeRenderRoot): readonly THREE.Vector3[] {
    frameCameraPositions.length = 1;
    frameCameraPositions[0] = runtimeObjectCameraPosition(renderRoot.camera, renderRoot.renderFromRootMatrix, 0);
    return frameCameraPositions;
  }

  function disposeArchetypes(): void {
    portalInstanceDebugRenderer?.dispose();
    portalInstanceDebugRenderer = undefined;
    for (const archetype of cellRenderArchetypes) {
      scene.remove(archetype.mesh);
      scene.remove(archetype.rootMesh);
    }
    disposeCellRenderArchetypes(cellRenderArchetypes);
    cellRenderArchetypes = [];
  }

  return {
    syncPlayerCell(serial) {
      syncPortalInstances(monoPortalRoots.set(readLocalPlayerPose(engine).cellId, camera), serial);
    },
    syncDesktop(cullingCamera, serial) {
      syncPortalInstances(monoPortalRoots.set(readLocalPlayerPose(engine).cellId, cullingCamera), serial);
    },
    syncXr(cullingCameras, serial) {
      if (cullingCameras.length > 1) {
        syncPortalInstances(cullingCameras.map(resolvePortalEyeRenderRoot), serial);
        return;
      }
      const eyeRoot = resolvePortalEyeRenderRoot(cullingCameras[0] ?? camera, 0);
      syncPortalInstances(monoPortalRoots.set(eyeRoot.rootCellId, eyeRoot.camera, eyeRoot.renderFromRootMatrix), serial);
    },
    reset() {
      latestVisibleResult = undefined;
      portalEyeRenderStates = [];
      resetStereoPortalState();
      activePortalEyeIndex = 0;
    },
    frameSnapshot(serial) {
      return latestFrameSnapshot ?? createEmptyFrameRenderSnapshot(serial, readLocalPlayerPose(engine).cellId);
    },
    latestVisibleResult: () => latestVisibleResult,
    instanceRenderState: () => portalInstanceRenderState,
    stereoPathState: () => stereoPortalPathState,
    eyeDebugStates() {
      if (portalEyeRenderStates.length === 0) {
        return undefined;
      }
      return portalEyeRenderStates.map((state) => ({
        eyeIndex: state.eyeIndex,
        rootCellId: state.rootCellId,
        visiblePathCount: state.result.paths.length,
        maxVisibleDepth: state.result.summary.maxVisibleDepth,
      }));
    },
    cellRenderArchetypes: () => cellRenderArchetypes,
    instanceDebugRenderer: () => portalInstanceDebugRenderer,
    disposeArchetypes,
    buildArchetypes(world, options) {
      cellRenderArchetypes = buildCellRenderArchetypes(world, { ...options, portalClipMaterialState });
      for (const archetype of cellRenderArchetypes) {
        archetype.mesh.onBeforeRender = (meshRenderer, _scene, renderCamera) => {
          portalEyeActivator.beforeMesh(meshRenderer, renderCamera);
          deps.enablePortalClipDistances();
        };
        archetype.mesh.onAfterRender = deps.disablePortalClipDistances;
        scene.add(archetype.mesh);
        scene.add(archetype.rootMesh);
      }
      portalInstanceDebugRenderer = createPortalInstanceDebugRenderer(scene, cellRenderArchetypes);
    },
    beforeMeshRender(meshRenderer, renderCamera) {
      portalEyeActivator.beforeMesh(meshRenderer, renderCamera);
      deps.enablePortalClipDistances();
    },
    afterMeshRender: deps.disablePortalClipDistances,
    dispose: disposeArchetypes,
  };
}
