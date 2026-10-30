/**
 * Browser-console debug surface for the app: window-level helper installation, the shapes of the JSON dumps they return, and small number/portal-word formatters.
 * Helpers are attached to window (noneuclidPortalDebug, noneuclidDebug, noneuclidGeometry and the snake_case globals); the shell installs them at startup or when the relevant debug options are active and must uninstall them on teardown.
 * Dump objects use meters and radians, world-frame coordinates (x right, y forward, z up) unless a field is named three*, which is in the Three.js frame (y up, -z forward). Numeric values in dumps are rounded to 1e-6 for readability.
 */
import * as THREE from "three";
import { checkPortalPathString, createPortalPathDebugState } from "../../cell-complex/portalPathDebug";
import { type PortalPathTablesByRootCell, type PortalRenderPath } from "../../cell-complex/portalPaths";
import { type StaticPortalPathCullResult } from "../../cell-complex/staticPortalPathCull";
import { type Vec3 } from "../../math/vec3";
import { DEFAULT_PLAYER_EYE_HEIGHT_METERS } from "../../movement/playerBody";
import { type PlayerPose } from "../../movement/playerPose";
import { type RuntimeToolId } from "../../runtime/runtimeMenuState";
import { type LiveGeometryDebugState } from "../../runtime/worldGeometrySession";
import {
  type GeodesicCarryPortalTransition,
  type GeodesicPortalTraversal,
  geodesicRayBeamHeightMeters,
} from "../../world-objects/geodesic/objects";
import { getGeodesicConnection } from "../../world-objects/geodesic/lifecycle";
import { type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { type GeodesicCreatureDebugDump } from "./geodesicCreatureDebug";
import { type PortalInstanceRenderDebugState } from "./renderPortalInstances";
import { type RenderQualityState, createRenderQualityState } from "./renderQuality";
import { type VisiblePortalPathRenderState } from "./renderState";
import {
  type ComputeVisiblePortalPathsResult,
  type VisiblePortalPath,
  type VisiblePortalPathDebugSummary,
  type VisiblePortalPathLookupResult,
  describeVisiblePortalPath,
} from "./visiblePortalPaths";
import { rigidTransformToThreeMatrix } from "./worldAxes";

/** Console API installed as window.noneuclidPortalDebug (by createPortalDebugRuntime) for inspecting portal paths, visibility, and clip polygons. Paths are resolved relative to the player's current root cell. */
export interface PortalDebugHelpers {
  /** Looks up a portal path written as space-separated portal indices (for example "0 2 3") and reports its static-cull and live visibility status. */
  CheckCellPath(pathText: string): PortalPathCheckResultWithVisibility;
  /** Draws a destination-cell overlay for the path (requires the portal-path-overlays option); ok is false with a reason when the path is unknown or overlays are disabled. */
  ShowCellPath(pathText: string): {
    readonly ok: boolean;
    readonly reason?: string;
    readonly check: ReturnType<typeof checkPortalPathString>;
    readonly pathId?: number;
    readonly destinationCellId?: string;
    readonly survivedStaticCull: boolean;
    readonly currentlyVisible: boolean;
    readonly screenAreaPixels?: number;
    readonly clipRectNdc?: VisiblePortalPath["clipRectNdc"];
    readonly objectCount: number;
  };
  /** Removes all path overlays created by ShowCellPath. */
  HideCellPaths(): void;
  /** Starts tracking a live screen-space clip polygon (normalized device coordinates) for the path; requires portal-visible-path-debug. */
  ShowCellPathClipPolygon(pathText: string): {
    readonly ok: boolean;
    readonly reason?: string;
    readonly pathId?: number;
    readonly destinationCellId?: string;
    readonly trackedPathTexts: readonly string[];
    readonly currentlyVisible: boolean;
    readonly clipPolygonNdc?: readonly { readonly x: number; readonly y: number }[];
  };
  /** Stops tracking the clip polygon of one path, or of all paths when no text is given. */
  HideCellPathClipPolygon(pathText?: string): {
    readonly trackedPathTexts: readonly string[];
  };
  /** Stops tracking every clip polygon. */
  HideClipPolygons(): {
    readonly trackedPathTexts: readonly string[];
  };
  /** Logs and returns the current culling camera pose. */
  DumpCameraPose(): CameraPoseDebugDump;
  /** When true, ShowCellPath renders the destination cell's actual instances through the portal-instance debug renderer instead of a flat floor-colored polygon; writable from the console. */
  ShowCellPathRendersInstances: boolean;
  /** Getter returning a fresh snapshot of path-debug state on every access. */
  readonly state: ReturnType<typeof createPortalPathDebugState> & {
    readonly visiblePortalPaths?: VisiblePortalPathDebugSummary;
    readonly portalInstances: PortalInstanceRenderDebugState;
    readonly renderQuality: RenderQualityState;
    readonly ShowCellPathRendersInstances: boolean;
  };
  /** All candidate portal paths per root cell, before static culling. */
  readonly candidateTables: PortalPathTablesByRootCell;
  /** Result of static path culling, including per-root summaries and rejected paths. */
  readonly staticCull: StaticPortalPathCullResult;
}

/** Console API installed as window.noneuclidDebug; each function exists under a snake_case and a PascalCase name. */
export interface GeneralDebugHelpers {
  debug_help(): void;
  dump_geodesic_creatures(): GeodesicCreatureDebugDump;
  DumpGeodesicCreatures(): GeodesicCreatureDebugDump;
  dump_all_geodesics(): AllGeodesicsDebugDump;
  DumpAllGeodesics(): AllGeodesicsDebugDump;
  dump_geodesic_path(geodesicId?: string): GeodesicPathDebugDump | undefined;
  DumpGeodesicPath(geodesicId?: string): GeodesicPathDebugDump | undefined;
  dump_locked_geodesic_words(): readonly GeodesicWordDebugDump[];
  DumpLockedGeodesicWords(): readonly GeodesicWordDebugDump[];
}

/** Implementations supplied by createThreeApp#shell to {@link installGeneralDebugHelpers}; each callback is stored as given. */
export interface GeneralDebugHelperCallbacks {
  readonly debugHelp: () => void;
  readonly dumpGeodesicCreatures: () => GeodesicCreatureDebugDump;
  readonly dumpAllGeodesics: () => AllGeodesicsDebugDump;
  readonly dumpGeodesicPath: (geodesicId?: string) => GeodesicPathDebugDump | undefined;
  readonly dumpLockedGeodesicWords: () => readonly GeodesicWordDebugDump[];
}

/** The window object augmented with the optional general debug globals. */
export type WindowWithGeneralDebugHelpers = typeof window & {
  debug_help?: () => void;
  dump_geodesic_creatures?: () => GeodesicCreatureDebugDump;
  dump_all_geodesics?: () => AllGeodesicsDebugDump;
  dump_geodesic_path?: (geodesicId?: string) => GeodesicPathDebugDump | undefined;
  dump_locked_geodesic_words?: () => readonly GeodesicWordDebugDump[];
  noneuclidDebug?: GeneralDebugHelpers;
};

/** Console API installed as window.noneuclidGeometry (by createThreeApp#shell) for driving the torus-skew geometry deformation. */
export interface GeometryDebugHelpers {
  /** Sets the target x skew in meters on the geodesic session; throws if the active world is not torus-skew. */
  SetTorusSkew(skewXMeters: number): void;
  /** Adds the delta (meters) to the pending target x skew (or the current one if none); throws if the active world is not torus-skew. */
  StepTorusSkew(deltaXMeters: number): void;
  /** Cancels the pending or running deformation via the geometry session. */
  Cancel(): void;
  /** Live view of the geometry session state. */
  readonly state: LiveGeometryDebugState;
}

/** The window object augmented with the optional geometry debug global. */
export type WindowWithGeometryDebugHelpers = typeof window & {
  noneuclidGeometry?: GeometryDebugHelpers;
};

/** Result of checking a portal path string, extended with the lookup result against the latest visible-path computation. */
export type PortalPathCheckResultWithVisibility = ReturnType<typeof checkPortalPathString> & VisiblePortalPathLookupResult;

/** Snapshot of the player/camera pose returned by dumpCameraPose; angles in both radians and degrees, matrices as 16-element column-major arrays (Three.js order). */
export interface CameraPoseDebugDump {
  /** Cell id of the player's current (root) cell. */
  readonly rootCellId: string;
  /** Player feet position in root-cell coordinates, meters (z up). */
  readonly playerPosition: { readonly x: number; readonly y: number; readonly z: number };
  /** Feet position raised by the default eye height, meters. */
  readonly eyePosition: { readonly x: number; readonly y: number; readonly z: number };
  /** Unit view direction in root-cell coordinates derived from yaw and pitch (yaw 0 looks along +y). */
  readonly forward: { readonly x: number; readonly y: number; readonly z: number };
  /** eyePosition plus one meter along forward. */
  readonly lookAtWorld: { readonly x: number; readonly y: number; readonly z: number };
  readonly yawRadians: number;
  readonly yawDegrees: number;
  readonly pitchRadians: number;
  readonly pitchDegrees: number;
  readonly threeCameraPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly threeCameraQuaternion: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  readonly threeCameraEulerRadians: { readonly x: number; readonly y: number; readonly z: number; readonly order: string };
  readonly projection: {
    readonly type: string;
    readonly near?: number;
    readonly far?: number;
    readonly fovDegrees?: number;
    readonly aspect?: number;
    readonly zoom?: number;
  };
  /** Portal visibility viewport size in pixels, taken from the render quality state. */
  readonly viewportPixels: { readonly width: number; readonly height: number };
  readonly renderQuality: RenderQualityState;
  readonly matrixWorld: readonly number[];
  readonly matrixWorldInverse: readonly number[];
  readonly projectionMatrix: readonly number[];
}

/** Description of one geodesic's lock state, portal word, and segments. */
export interface GeodesicPathDebugDump {
  readonly geodesicId: string;
  readonly locked: boolean;
  readonly connection: ReturnType<typeof getGeodesicConnection>;
  readonly startCellId?: string;
  readonly start?: string;
  /** Portal traversals from the start cell to the end, in order. */
  readonly word: readonly GeodesicPortalTraversal[];
  readonly wordText: string;
  /** Portal word accumulated during the current carry session, if any. */
  readonly carrySessionWord?: readonly GeodesicPortalTraversal[];
  readonly carrySessionWordText?: string;
  /** Text of the word read backwards with each traversal reversed. */
  readonly reverseWordText: string;
  readonly latestPlayerPortalTransition?: GeodesicCarryPortalTransition;
  readonly segments: readonly {
    readonly id: string;
    readonly cellId: string;
    readonly index: number;
    readonly lengthMeters: number;
    readonly start: string;
    readonly direction: string;
    readonly terminal: string;
    readonly connectionState: string;
  }[];
}

/** Portal word of one locked geodesic with its individual transitions. */
export interface GeodesicWordDebugDump {
  readonly geodesicId: string;
  readonly locked: boolean;
  readonly connection: ReturnType<typeof getGeodesicConnection>;
  readonly startCellId?: string;
  readonly start?: string;
  readonly word: readonly GeodesicPortalTraversal[];
  readonly wordText: string;
  readonly transitions: readonly {
    readonly index: number;
    readonly sourceCellId: string;
    readonly sourcePortalId: string;
    readonly targetCellId: string;
    readonly targetPortalId: string;
  }[];
}

/** Whole-world geodesic inventory: intervals, segments, anchors and curve-shortening pairs. */
export interface AllGeodesicsDebugDump {
  readonly worldId: string;
  readonly visibleCellId?: string;
  readonly selectedTool: RuntimeToolId;
  /** Raw cannon tool state, unprocessed. */
  readonly activeGeodesicCannonToolState: unknown;
  readonly geodesicIds: readonly string[];
  /** One entry per geodesic interval (a chain of segments between two endpoints). */
  readonly intervals: readonly {
    readonly id: string;
    readonly cellId: string;
    readonly startCellId: string;
    readonly motionState: string;
    readonly start: EndpointDebugDump;
    readonly end: EndpointDebugDump;
    readonly portalWordText: string;
    readonly portalWord: readonly GeodesicPortalTraversal[];
    readonly connection: ReturnType<typeof getGeodesicConnection>;
    readonly locked: boolean;
    readonly segmentCount: number;
    /** Sum of the interval's segment lengths in meters. */
    readonly totalSegmentLengthMeters: number;
    readonly segmentCells: readonly string[];
  }[];
  readonly segments: readonly {
    readonly id: string;
    readonly geodesicId: string;
    readonly cellId: string;
    readonly index: number;
    readonly halfRole?: string;
    readonly lengthMeters: number;
    readonly start: string;
    readonly end: string;
    readonly direction: string;
    readonly terminal: string;
    readonly connectionState: string;
    readonly highlightState?: string;
  }[];
  /** Anchor objects that geodesic endpoints attach to; point is a formatted position string. */
  readonly anchors: readonly {
    readonly id: string;
    readonly kind: string;
    readonly cellId: string;
    readonly point: string;
    readonly attachedEndpoints: readonly string[];
  }[];
  /** State of the curve-shortening pairs; the last-good fields record the most recent valid free-end position. */
  readonly curveShorteningPairs: readonly {
    readonly id: string;
    readonly state: string;
    readonly freeEndAnchorId: string;
    readonly first: string;
    readonly second: string;
    readonly previousTotalLengthMeters?: number;
    readonly lastGoodFreeEndCellId: string;
    readonly lastGoodFreeEndPoint: string;
  }[];
}

/** Identifies one geodesic endpoint and the anchor object it is attached to. */
export interface EndpointDebugDump {
  readonly geodesicId: string;
  readonly role: string;
  readonly anchorObjectId: string;
  readonly anchorKind?: string;
  readonly anchorCellId?: string;
  readonly anchorPoint?: string;
}

/** Publishes the helpers as window.noneuclidPortalDebug, replacing any previous object; pair with uninstallPortalDebugHelpers on teardown. */
export function installPortalDebugHelpers(helpers: PortalDebugHelpers): void {
  (window as typeof window & { noneuclidPortalDebug?: PortalDebugHelpers }).noneuclidPortalDebug = helpers;
}

/** Removes window.noneuclidPortalDebug. */
export function uninstallPortalDebugHelpers(): void {
  delete (window as typeof window & { noneuclidPortalDebug?: PortalDebugHelpers }).noneuclidPortalDebug;
}

/** Publishes the callbacks as window.noneuclidDebug and as the snake_case window globals (only snake_case names are global; PascalCase names are on the object only). */
export function installGeneralDebugHelpers(callbacks: GeneralDebugHelperCallbacks): void {
  const target = window as WindowWithGeneralDebugHelpers;
  const helpers: GeneralDebugHelpers = {
    debug_help: callbacks.debugHelp,
    dump_geodesic_creatures: callbacks.dumpGeodesicCreatures,
    DumpGeodesicCreatures: callbacks.dumpGeodesicCreatures,
    dump_all_geodesics: callbacks.dumpAllGeodesics,
    DumpAllGeodesics: callbacks.dumpAllGeodesics,
    dump_geodesic_path: callbacks.dumpGeodesicPath,
    DumpGeodesicPath: callbacks.dumpGeodesicPath,
    dump_locked_geodesic_words: callbacks.dumpLockedGeodesicWords,
    DumpLockedGeodesicWords: callbacks.dumpLockedGeodesicWords,
  };

  target.debug_help = helpers.debug_help;
  target.dump_geodesic_creatures = helpers.dump_geodesic_creatures;
  target.dump_all_geodesics = helpers.dump_all_geodesics;
  target.dump_geodesic_path = helpers.dump_geodesic_path;
  target.dump_locked_geodesic_words = helpers.dump_locked_geodesic_words;
  target.noneuclidDebug = helpers;
}

/** Removes window.noneuclidDebug and the snake_case globals. */
export function uninstallGeneralDebugHelpers(): void {
  const target = window as WindowWithGeneralDebugHelpers;

  delete target.debug_help;
  delete target.dump_geodesic_creatures;
  delete target.dump_all_geodesics;
  delete target.dump_geodesic_path;
  delete target.dump_locked_geodesic_words;
  delete target.noneuclidDebug;
}

/** Removes window.noneuclidGeometry; installation happens in createThreeApp. */
export function uninstallGeometryDebugHelpers(): void {
  delete (window as WindowWithGeometryDebugHelpers).noneuclidGeometry;
}

/** Returns the live visibility fields (visible flag, screen area in pixels, clip rectangle in normalized device coordinates) for a portal path id, using the latest visible-path computation; delegates to describeVisiblePortalPath. */
export function liveVisibilityFields(
  pathId: number | undefined,
  latestVisibleResult: ComputeVisiblePortalPathsResult | undefined,
): {
  readonly currentlyVisible: boolean;
  readonly screenAreaPixels?: number;
  readonly clipRectNdc?: VisiblePortalPath["clipRectNdc"];
} {
  return describeVisiblePortalPath(pathId, latestVisibleResult);
}

/** Returns the Three.js-frame matrix mapping destination-cell coordinates into the root cell for a render path. */
export function pathToThreeMatrix(path: PortalRenderPath): THREE.Matrix4 {
  return rigidTransformToThreeMatrix(path.rootFromDestination);
}

/**
 * Logs the camera pose to the console (info and table) and returns it as a rounded dump.
 * Side effects: updates the camera's world and projection matrices. The eye position is derived from playerPose plus the default eye height, not read from the camera, so it can differ from threeCameraPosition (for example in XR). renderQualityEnabled is passed through to the render-quality snapshot.
 */
export function dumpCameraPose(
  playerPose: PlayerPose,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  renderQualityEnabled: boolean,
): CameraPoseDebugDump {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const eyePosition = {
    x: playerPose.position.x,
    y: playerPose.position.y,
    z: playerPose.position.z + DEFAULT_PLAYER_EYE_HEIGHT_METERS,
  };
  const forward = {
    x: -Math.sin(playerPose.yawRadians) * Math.cos(playerPose.pitchRadians),
    y: Math.cos(playerPose.yawRadians) * Math.cos(playerPose.pitchRadians),
    z: Math.sin(playerPose.pitchRadians),
  };
  const lookAtWorld = {
    x: eyePosition.x + forward.x,
    y: eyePosition.y + forward.y,
    z: eyePosition.z + forward.z,
  };
  const renderQuality = createRenderQualityState(renderer, renderer.getPixelRatio(), renderQualityEnabled);
  const dump: CameraPoseDebugDump = {
    rootCellId: playerPose.cellId,
    playerPosition: roundVec3(playerPose.position),
    eyePosition: roundVec3(eyePosition),
    forward: roundVec3(forward),
    lookAtWorld: roundVec3(lookAtWorld),
    yawRadians: roundNumber(playerPose.yawRadians),
    yawDegrees: roundNumber(THREE.MathUtils.radToDeg(playerPose.yawRadians)),
    pitchRadians: roundNumber(playerPose.pitchRadians),
    pitchDegrees: roundNumber(THREE.MathUtils.radToDeg(playerPose.pitchRadians)),
    threeCameraPosition: roundThreeVector3(camera.position),
    threeCameraQuaternion: roundQuaternion(camera.quaternion),
    threeCameraEulerRadians: {
      x: roundNumber(camera.rotation.x),
      y: roundNumber(camera.rotation.y),
      z: roundNumber(camera.rotation.z),
      order: camera.rotation.order,
    },
    projection: {
      type: camera.type,
      near: roundNumber(camera.near),
      far: roundNumber(camera.far),
      fovDegrees: roundNumber(camera.fov),
      aspect: roundNumber(camera.aspect),
      zoom: roundNumber(camera.zoom),
    },
    viewportPixels: {
      width: renderQuality.portalViewportPixels.width,
      height: renderQuality.portalViewportPixels.height,
    },
    renderQuality,
    matrixWorld: roundMatrix(camera.matrixWorld),
    matrixWorldInverse: roundMatrix(camera.matrixWorldInverse),
    projectionMatrix: roundMatrix(camera.projectionMatrix),
  };

  console.info("Current portal visibility camera pose:", dump);
  console.table({
    rootCellId: dump.rootCellId,
    playerPosition: formatVec3(dump.playerPosition),
    eyePosition: formatVec3(dump.eyePosition),
    forward: formatVec3(dump.forward),
    lookAtWorld: formatVec3(dump.lookAtWorld),
    yaw: `${dump.yawRadians} rad / ${dump.yawDegrees} deg`,
    pitch: `${dump.pitchRadians} rad / ${dump.pitchDegrees} deg`,
    threeCameraPosition: formatVec3(dump.threeCameraPosition),
    viewportPixels: `${dump.viewportPixels.width} x ${dump.viewportPixels.height}`,
    cssCanvasSize: `${dump.renderQuality.cssCanvasSize.width} x ${dump.renderQuality.cssCanvasSize.height}`,
    drawingBufferSize: `${dump.renderQuality.drawingBufferSize.width} x ${dump.renderQuality.drawingBufferSize.height}`,
    pixelRatio: dump.renderQuality.pixelRatio,
    antialiasRequested: dump.renderQuality.antialiasRequested,
    projection: `fov=${dump.projection.fovDegrees}, aspect=${dump.projection.aspect}, near=${dump.projection.near}, far=${dump.projection.far}`,
  });

  return dump;
}

/** Returns the visible-path summary with candidate and kept counts replaced by the static-cull counts for rootCellId when available. */
export function mergeStaticPathCounts(
  summary: VisiblePortalPathDebugSummary,
  staticCull: StaticPortalPathCullResult,
  rootCellId: string,
): VisiblePortalPathDebugSummary {
  const staticSummary = staticCull.summariesByRootCellId.get(rootCellId);

  return {
    ...summary,
    candidatePathCount: staticSummary?.inputPathCount ?? summary.candidatePathCount,
    keptPathCount: staticSummary?.keptPathCount ?? summary.keptPathCount,
  };
}

/** Copies the counters of a visible-path summary into the render-state shape. */
export function visibleSummaryToRenderState(summary: VisiblePortalPathDebugSummary): VisiblePortalPathRenderState {
  return {
    candidatePathCount: summary.candidatePathCount,
    keptPathCount: summary.keptPathCount,
    visiblePathCount: summary.visiblePathCount,
    visiblePathCountByDepth: summary.visiblePathCountByDepth,
    maxVisibleDepth: summary.maxVisibleDepth,
    clippedByCameraCount: summary.clippedByCameraCount,
    clippedByAreaCount: summary.clippedByAreaCount,
    clippedByBudgetCount: summary.clippedByBudgetCount,
    budgetExhausted: summary.budgetExhausted,
  };
}

/** Formats a one-line overlay label for an inspected path (text, destination cell, Vis/Invis), or undefined when the check did not match a path. */
export function formatInspectedPathLine(
  pathText: string | undefined,
  check: PortalPathCheckResultWithVisibility | undefined,
  latestVisibleResult: ComputeVisiblePortalPathsResult | undefined,
): string | undefined {
  if (!pathText || !check || check.matchedPathId === undefined || !check.destinationCellId) {
    return undefined;
  }

  const visibility = describeVisiblePortalPath(check.matchedPathId, latestVisibleResult);
  const visibilityLabel = visibility.currentlyVisible ? "Vis" : "Invis";

  return `Path ${pathText} -> ${check.destinationCellId} ${visibilityLabel}`;
}

/** Returns a CSS color for the index-th tracked clip polygon, cycling through a fixed six-color palette. */
export function clipPolygonColorForIndex(index: number): string {
  const palette = ["#ff5252", "#3dd9b6", "#ffe066", "#5da9ff", "#ff8fab", "#b892ff"];
  return palette[index % palette.length];
}

/** Returns a copy of the point with each component rounded by roundNumber. */
export function roundVec3(point: { readonly x: number; readonly y: number; readonly z: number }): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  return {
    x: roundNumber(point.x),
    y: roundNumber(point.y),
    z: roundNumber(point.z),
  };
}

/** Rounds a Three.js vector's components (same as roundVec3). */
export function roundThreeVector3(point: THREE.Vector3): { readonly x: number; readonly y: number; readonly z: number } {
  return roundVec3(point);
}

/** Returns the quaternion components rounded by roundNumber. */
export function roundQuaternion(quaternion: THREE.Quaternion): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
} {
  return {
    x: roundNumber(quaternion.x),
    y: roundNumber(quaternion.y),
    z: roundNumber(quaternion.z),
    w: roundNumber(quaternion.w),
  };
}

/** Returns the matrix's 16 elements (column-major) rounded by roundNumber. */
export function roundMatrix(matrix: THREE.Matrix4): readonly number[] {
  return matrix.toArray().map(roundNumber);
}

/** True when every element of the two matrices differs by at most tolerance (default 1e-5). */
export function matricesNearlyEqual(left: THREE.Matrix4, right: THREE.Matrix4, tolerance = 1e-5): boolean {
  const leftElements = left.elements;
  const rightElements = right.elements;

  for (let index = 0; index < leftElements.length; index += 1) {
    if (Math.abs(leftElements[index] - rightElements[index]) > tolerance) {
      return false;
    }
  }

  return true;
}

/** Rounds to six decimal places. */
export function roundNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Formats a portal word as space-separated source:portal->target:portal steps, or "(root)" for the empty word. */
export function formatGeodesicPortalWord(word: readonly GeodesicPortalTraversal[]): string {
  return word.length === 0
    ? "(root)"
    : word
      .map((step) => `${step.sourceCellId}:${step.sourcePortalId}->${step.targetCellId}:${step.targetPortalId}`)
      .join(" ");
}

/** Returns the traversal as seen when crossing the portal in the opposite direction. */
export function reverseGeodesicPortalTraversal(step: GeodesicPortalTraversal): GeodesicPortalTraversal {
  return {
    sourceCellId: step.targetCellId,
    sourcePortalId: step.targetPortalId,
    targetCellId: step.sourceCellId,
    targetPortalId: step.sourcePortalId,
  };
}

/** Formats an endpoint as geodesicId.role. */
export function formatEndpointRef(endpoint: { readonly geodesicId: string; readonly role: string }): string {
  return `${endpoint.geodesicId}.${endpoint.role}`;
}

/** Rounds a length in meters to four decimal places. */
export function roundedMeters(value: number): number {
  return Number(value.toFixed(4));
}

/** Sums the lengthMeters of the segments, in meters. */
export function totalGeodesicLengthFromDebugSegments(
  segments: readonly { readonly lengthMeters: number }[],
): number {
  return segments.reduce((total, segment) => total + segment.lengthMeters, 0);
}

/** Returns the cannon anchor position in its cell's local frame, raised to the geodesic beam height (meters, z up). */
export function getGeodesicDebugAnchorPoint(
  anchor: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
): Vec3 {
  return {
    x: anchor.localPose.translation.x,
    y: anchor.localPose.translation.y,
    z: anchor.localPose.translation.z + geodesicRayBeamHeightMeters,
  };
}

/** Formats a point as "(x, y, z)" without rounding. */
export function formatVec3(point: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `(${point.x}, ${point.y}, ${point.z})`;
}
