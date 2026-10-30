/**
 * Plain-data snapshots of runtime and render diagnostics, shared between the Three.js app, the debug overlay,
 * the XR debug panel and the console debug helpers.
 *
 * Nothing here holds Three.js objects: every type is a JSON-serializable record (meters, radians, milliseconds,
 * pixels as noted) produced once per frame from the visibility pass (`visiblePortalPaths`), instanced rendering
 * (`renderPortalInstances`) and renderer statistics. `RuntimeInputFrame` is the one non-diagnostic type: the
 * per-frame input sample handed to the simulation by either the desktop or the XR controller (`DesktopInputFrame` in desktopControls derives from it).
 */

import type { Vec3 } from "../../math/vec3";

/** One frame of normalized player input from desktop or XR, consumed by movement and tool logic. */
export interface RuntimeInputFrame {
  /** Requested displacement in meters in the player's yaw-relative frame (x right, y forward, z up). */
  readonly localDisplacement: Vec3;
  /** Change of heading this frame, in radians. */
  readonly yawDeltaRadians: number;
  /** Change of look pitch this frame, in radians. */
  readonly pitchDeltaRadians: number;
  /** Pointer movement in screen pixels for the scene palette, when it is active. */
  readonly palettePointerDeltaPixels?: { readonly x: number; readonly y: number };
  /** Whether the palette select control is currently held. */
  readonly paletteSelectPressed?: boolean;
  /** Request to select the highlighted palette entry. */
  readonly paletteSelectRequested?: boolean;
  /** Request to reset the player/scene. */
  readonly resetRequested: boolean;
  /** Request for the primary action (e.g. fire or place) of the active tool. */
  readonly primaryActionRequested: boolean;
  /** Request to interact with the aimed object. */
  readonly interactRequested: boolean;
  /** Request to pick up or drop the aimed carryable object. */
  readonly carryActionRequested: boolean;
  /** Request to show the help overlay. */
  readonly helpRequested: boolean;
  /** Which input device produced the frame. */
  readonly source: "desktop" | "xr";
}

/** Full per-frame debug readout for the XR/desktop debug overlay (session, player pose, performance, portal statistics). */
export interface XrDebugRenderState {
  readonly secureContext: boolean;
  readonly sessionStatus: string;
  readonly activeInputSource: RuntimeInputFrame["source"];
  readonly inputMode?: string;
  readonly frameRateFps?: number;
  readonly framePerformance?: FramePerformanceRenderState;
  readonly webGlRenderInfo?: WebGlRenderInfoState;
  /** Id of the cell the player is currently in (the render root). */
  readonly currentCellId: string;
  /** Player position in the current cell's local frame, meters. */
  readonly playerPosition: Vec3;
  /** Player heading in radians. */
  readonly yawRadians: number;
  readonly lastMovementBlocked: boolean;
  readonly lastBlockingReason?: string;
  readonly lastCrossedPortalId?: string;
  /** Cell whose frame is the shared render frame when the two XR eyes have different root cells. */
  readonly sharedRenderRootCellId?: string;
  readonly visiblePortalPathCount?: number;
  readonly visiblePortalPaths?: VisiblePortalPathRenderState;
  readonly portalInstances?: PortalInstanceRenderState;
  /** Per-eye visibility results for stereo rendering. */
  readonly portalEyes?: readonly PortalEyeRenderDebugState[];
  /** Left/right/union path counts of the stereo frame; undefined on mono frames. */
  readonly stereoPortalPaths?: StereoPortalPathRenderState;
}

/** Minimal render-loop state: a frame counter plus the latest portal statistics. */
export interface RenderState {
  readonly frameCount: number;
  readonly visiblePortalPaths?: VisiblePortalPathRenderState;
  readonly portalInstances?: PortalInstanceRenderState;
}

/** Per-frame CPU timings in milliseconds, split by pipeline stage. */
export interface FramePerformanceRenderState {
  readonly totalMs: number;
  readonly inputMs: number;
  readonly moveMs: number;
  readonly objectsMs: number;
  readonly cameraMs: number;
  readonly portalMs: number;
  readonly uiMs: number;
  readonly renderMs: number;
}

/** Per-frame WebGL counters from `renderer.info` plus the viewport they were taken at. */
export interface WebGlRenderInfoState {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly lines: number;
  readonly points: number;
  readonly viewportPixels: {
    readonly width: number;
    readonly height: number;
  };
  readonly pixelRatio: number;
}

/** Visibility statistics for one eye of a stereo frame. */
export interface PortalEyeRenderDebugState {
  readonly eyeIndex: number;
  readonly rootCellId: string;
  readonly visiblePathCount: number;
  readonly maxVisibleDepth: number;
}

/** Stereo path statistics; eye 0 is labelled left (WebXR lists the left view first on Quest). */
export interface StereoPortalPathRenderState {
  /** True when the eyes have different root identities (cell id or frame), see `stereoPortalFrame`. */
  readonly splitRoots: boolean;
  readonly leftRootCellId: string;
  readonly rightRootCellId: string;
  /** Paths in each eye's own list, before the union budget. */
  readonly leftPathCount: number;
  readonly rightPathCount: number;
  /** Distinct remapped path ids over both eyes, before the union budget. */
  readonly unionPathCount: number;
  /** Cell copies (same destination cell at the same render-frame placement) seen only by eye 0, only by eye 1, or by both. */
  readonly leftOnlyPathCount: number;
  readonly rightOnlyPathCount: number;
  readonly bothEyesPathCount: number;
  /** Paths of each eye's list not accepted by the union budget. */
  readonly droppedLeftPathCount: number;
  readonly droppedRightPathCount: number;
}

/** Serializable copy of `VisiblePortalPathDebugSummary` without the root cell id. */
export interface VisiblePortalPathRenderState {
  readonly candidatePathCount: number;
  readonly keptPathCount: number;
  readonly visiblePathCount: number;
  readonly visiblePathCountByDepth: readonly { readonly depth: number; readonly count: number }[];
  readonly maxVisibleDepth: number;
  readonly clippedByCameraCount: number;
  readonly clippedByFunnelCount: number;
  readonly terminalByAreaCount: number;
  readonly examinedPathCount: number;
  readonly clippedByBudgetCount: number;
  readonly budgetExhausted: boolean;
}

/** Serializable mirror of `PortalInstanceRenderDebugState`: instanced-portal counts, overflow and clip-polygon statistics. */
export interface PortalInstanceRenderState {
  readonly enabled: boolean;
  readonly ShowCellPathRendersInstances: boolean;
  readonly archetypeCount: number;
  readonly totalCapacity: number;
  readonly renderedInstanceCount: number;
  readonly renderedInstanceCountByCell: readonly {
    readonly cellId: string;
    readonly count: number;
  }[];
  readonly capacityOverflowCount: number;
  readonly capacityOverflowArchetypes: readonly string[];
  readonly normalVisiblePathRenderingActive: boolean;
  readonly visiblePathIds: readonly number[];
  readonly visiblePathDestinations: readonly {
    readonly pathId: number;
    readonly destinationCellId: string;
  }[];
  readonly visiblePathOverflowCount: number;
  readonly portalClipMode: "hardware" | "fragment";
}
