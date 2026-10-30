/**
 * Text-only HUD overlay (a div with class debug-overlay) listing frame timing, WebGL, portal-visibility, location and geometry diagnostics.
 * It owns one DOM element appended to the given container; callers push a full DebugOverlayState each update and the overlay renders only the sections that are present. Formatter functions are pure and exported for reuse and testing.
 * Units: frame times in milliseconds, positions in meters, yaw in radians; values are rounded to three decimals.
 */
import type {
  FramePerformanceRenderState,
  PortalEyeRenderDebugState,
  PortalInstanceRenderState,
  StereoPortalPathRenderState,
  VisiblePortalPathRenderState,
  WebGlRenderInfoState,
  XrDebugRenderState,
} from "./renderState";
import type { LiveGeometryDebugState } from "../../runtime/worldGeometrySession";

/** Content of one overlay update; sections whose field is undefined are omitted from the text. */
export interface DebugOverlayState {
  /** Whether the overlay is shown at all; it is also hidden when no section has content. */
  readonly visible: boolean;
  readonly frameRateFps?: number;
  readonly framePerformance?: FramePerformanceRenderState;
  readonly webGlRenderInfo?: WebGlRenderInfoState;
  readonly visiblePortalPaths?: VisiblePortalPathRenderState;
  /** Per-eye stats; only displayed when there is more than one eye. */
  readonly portalEyes?: readonly PortalEyeRenderDebugState[];
  /** Left/right/union path counts of a stereo frame; shown right after the portal-eyes line. */
  readonly stereoPortalPaths?: StereoPortalPathRenderState;
  readonly portalInstances?: PortalInstanceRenderState;
  /** Player location, XR session and movement-block diagnostics. */
  readonly location?: XrDebugRenderState;
  readonly geometry?: LiveGeometryDebugState;
  /** Pre-formatted line for the path inspected via the console helper. */
  readonly inspectedPathLine?: string;
}

/** Handle to the debug HUD created by {@link createDebugOverlay}; the creator must call dispose(). */
export interface DebugOverlay {
  /** Replaces the overlay text and visibility from the given state. */
  update(state: DebugOverlayState): void;
  /** Removes the overlay element from the DOM. */
  dispose(): void;
}

/** Creates a hidden debug HUD element and appends it to container; style comes from the debug-overlay CSS class. */
export function createDebugOverlay(container: HTMLElement): DebugOverlay {
  const root = document.createElement("div");
  root.className = "debug-overlay";
  root.hidden = true;
  container.append(root);

  return {
    update(state) {
      const hasContent = Boolean(
        state.frameRateFps !== undefined
        || state.framePerformance
        || state.webGlRenderInfo
        || state.visiblePortalPaths
        || state.portalEyes
        || state.stereoPortalPaths
        || state.portalInstances
        || state.location
        || state.geometry
        || state.inspectedPathLine,
      );
      root.hidden = !state.visible || !hasContent;

      if (!hasContent) {
        root.textContent = "";
        return;
      }

      root.textContent = formatDebugOverlayLines(state).join("\n");
    },
    dispose() {
      root.remove();
    },
  };
}

/**
 * Formats the lines of one overlay update, in display order, omitting sections whose field is undefined.
 * Shared by the DOM overlay and the in-headset panel; `state.visible` is deliberately ignored.
 */
export function formatDebugOverlayLines(state: DebugOverlayState): readonly string[] {
  return [
    state.frameRateFps !== undefined ? formatFrameRateLine(state.frameRateFps) : undefined,
    state.framePerformance ? formatFramePerformanceLine(state.framePerformance) : undefined,
    state.webGlRenderInfo ? formatWebGlRenderInfoLine(state.webGlRenderInfo) : undefined,
    state.visiblePortalPaths ? formatVisiblePortalPathLine(state.visiblePortalPaths) : undefined,
    state.portalEyes && state.portalEyes.length > 1 ? formatPortalEyeLine(state.portalEyes) : undefined,
    state.stereoPortalPaths ? formatStereoPortalPathLine(state.stereoPortalPaths) : undefined,
    state.portalInstances ? formatPortalInstanceLine(state.portalInstances) : undefined,
    state.portalInstances ? formatPortalArchetypeLine(state.portalInstances) : undefined,
    state.location ? formatLocationLine(state.location) : undefined,
    state.geometry ? formatGeometryLine(state.geometry) : undefined,
    state.inspectedPathLine,
  ].filter((line): line is string => Boolean(line));
}

/** Formats the smoothed frame rate and the frame time derived from it (frameRateFps must be positive). */
export function formatFrameRateLine(frameRateFps: number): string {
  return `fps: ${roundNumber(frameRateFps)} (${roundNumber(1000 / frameRateFps)} ms)`;
}

/** Formats the per-phase frame timings in milliseconds (total, move, objects, portal, render, ui). */
export function formatFramePerformanceLine(state: FramePerformanceRenderState): string {
  return [
    `frame ms: total ${roundNumber(state.totalMs)}`,
    `move ${roundNumber(state.moveMs)}`,
    `objects ${roundNumber(state.objectsMs)}`,
    `portal ${roundNumber(state.portalMs)}`,
    `render ${roundNumber(state.renderMs)}`,
    `ui ${roundNumber(state.uiMs)}`,
  ].join(" / ");
}

/** Formats draw calls, triangle count, viewport size, megapixels and pixel ratio of the last render. */
export function formatWebGlRenderInfoLine(state: WebGlRenderInfoState): string {
  const megaPixels = (state.viewportPixels.width * state.viewportPixels.height) / 1_000_000;

  return [
    `webgl: ${state.drawCalls} calls`,
    `${formatCount(state.triangles)} tris`,
    `${state.viewportPixels.width}x${state.viewportPixels.height}`,
    `${roundNumber(megaPixels)} MP`,
    `pxr ${roundNumber(state.pixelRatio)}`,
  ].join(" / ");
}

/** Formats visible, kept and maximum visible portal path counts, appending "budget" if the path budget was exhausted. */
export function formatVisiblePortalPathLine(state: VisiblePortalPathRenderState): string {
  const budget = state.budgetExhausted ? " / budget" : "";

  return `visible paths: ${state.visiblePathCount} / kept ${state.keptPathCount} / depth ${state.maxVisibleDepth}${budget}`;
}

/** Formats visible-path count and maximum depth for each portal eye as eyeIndex:count@depth. */
export function formatPortalEyeLine(states: readonly PortalEyeRenderDebugState[]): string {
  const counts = states
    .map((state) => `${state.eyeIndex}:${state.visiblePathCount}@${state.maxVisibleDepth}`)
    .join(" / ");

  return `portal eyes: ${counts}`;
}

/**
 * Formats the stereo path statistics: left/right/union path counts, cell copies seen by one eye only or by both,
 * paths dropped by the union budget per eye, and the eyes' root cells with `split` or `shared`.
 */
export function formatStereoPortalPathLine(state: StereoPortalPathRenderState): string {
  const roots = state.splitRoots
    ? `roots ${state.leftRootCellId}|${state.rightRootCellId} split`
    : `roots ${state.leftRootCellId} shared`;

  return [
    `stereo: L ${state.leftPathCount}`,
    `R ${state.rightPathCount}`,
    `union ${state.unionPathCount}`,
    `L-only ${state.leftOnlyPathCount}`,
    `R-only ${state.rightOnlyPathCount}`,
    `both ${state.bothEyesPathCount}`,
    `dropped ${state.droppedLeftPathCount}|${state.droppedRightPathCount}`,
    roots,
  ].join(" / ");
}

/** Formats rendered portal instance count against total instance capacity. */
export function formatPortalInstanceLine(state: PortalInstanceRenderState): string {
  return `portal instances: ${state.renderedInstanceCount} / ${state.totalCapacity} slots`;
}

/** Formats archetype count, capacity overflow, clip-slot overflow (paths without a slot) and the portal clip mode. */
export function formatPortalArchetypeLine(state: PortalInstanceRenderState): string {
  return `archetypes: ${state.archetypeCount} / overflow ${state.capacityOverflowCount} / clip ${state.visiblePathOverflowCount} / ${state.portalClipMode} clip`;
}

/** Formats the player's cell, position, yaw, XR session status and movement-block state, with optional input mode, visible path count, last crossed portal and XR root cell. */
export function formatLocationLine(state: XrDebugRenderState): string {
  const blocked = state.lastMovementBlocked
    ? `blocked ${state.lastBlockingReason ?? "unknown"}`
    : "not blocked";
  const portal = state.lastCrossedPortalId ? ` / last portal ${state.lastCrossedPortalId}` : "";
  const root = state.sharedRenderRootCellId ? ` / xr root ${state.sharedRenderRootCellId}` : "";
  const inputMode = state.inputMode ? ` / input ${state.inputMode}` : "";
  const visiblePaths = state.visiblePortalPathCount !== undefined ? ` / visible ${state.visiblePortalPathCount}` : "";

  return [
    `location: cell ${state.currentCellId}`,
    `pos ${formatVec3(state.playerPosition)}`,
    `yaw ${roundNumber(state.yawRadians)}`,
    `xr ${state.sessionStatus}`,
    blocked,
  ].join(" / ") + inputMode + visiblePaths + portal + root;
}

/** Formats the live geometry state: version, deformation kind, current and target geometry, build status, last build time and last error. */
export function formatGeometryLine(state: LiveGeometryDebugState): string {
  const target = state.target.kind === "torus-skew"
    ? `target skew ${roundNumber(state.target.skewXMeters)}`
    : `target ${state.target.kind}`;
  const current = state.current.kind === "torus-skew"
    ? `skew ${roundNumber(state.current.skewXMeters)}`
    : state.current.kind;
  const pending = state.buildInFlight ? "building" : "idle";
  const timing = state.lastBuildMs === undefined ? "" : ` / build ${roundNumber(state.lastBuildMs)} ms`;
  const error = state.lastError ? ` / error ${state.lastError}` : "";

  return `geometry: v${state.version} / ${state.deformationKind} / ${current} / ${target} / ${pending}${timing}${error}`;
}

// Local formatter with rounding; differs from appDebugHelpers#formatVec3, which does not round.
function formatVec3(point: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `(${roundNumber(point.x)}, ${roundNumber(point.y)}, ${roundNumber(point.z)})`;
}

// Rounds to three decimal places (appDebugHelpers rounds to six).
function roundNumber(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

// Abbreviates counts as k (thousands) or M (millions).
function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${roundNumber(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${roundNumber(value / 1_000)}k`;
  }

  return String(value);
}
