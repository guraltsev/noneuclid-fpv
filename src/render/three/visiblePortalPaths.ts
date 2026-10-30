/**
 * Per-frame portal visibility: decides which entries of a root cell's portal-path table are visible on screen and
 * returns, for each, its placement, the four planes through the eye that bound its visible region, and the convex
 * NDC polygon through which its destination cell may be drawn.
 *
 * A `PortalRenderPath` is a chain of portal steps starting in the root (camera) cell; its `rootFromDestination`
 * rigid transform maps the destination cell's local frame into the root cell's frame (cell-local
 * x-right/y-forward/z-up, meters; the root frame is mapped to Three.js axes by `worldAxes`). The eye lies in the
 * root cell.
 *
 * Visibility uses the exact funnel of `portalFunnel.ts`: the visible plan directions of a path form a 2D sector
 * from the eye, clipped by each portal on the way (`d . rotCW(L - e) >= 0`, `d . rotCCW(R - e) >= 0`); together
 * with the top and bottom edges of the newest portal this gives at most 4 half-spaces through the eye
 * (`clipPlanes`). The screen polygon is the NDC square clipped by the 4 corresponding lines (at most 8 vertices;
 * no near plane and no projection of apertures). The traversal is depth-first from the root over
 * `pathsByParentPathId` and visits only the children of visible, non-terminal parents. A path with an empty
 * sector is dropped with its subtree; a path whose sector is non-empty but whose polygon is empty (sight lines
 * exist, none in view) is dropped (`clippedByCameraCount`); a path whose area is positive but below
 * `minPortalScreenAreaPixels` is KEPT as a terminal path (its children are not visited), so a sliver never leaves
 * a hole; a path at `maxDepth` is terminal. Survivors are sorted and truncated to `maxVisiblePaths` after the
 * traversal.
 *
 * Scratch ownership: the module-scope scratch below (traversal stack, packed sectors, plane and polygon buffers,
 * eye vector) is owned by `computeVisiblePortalPaths` / `computeIndependentVisiblePortalPaths`; it is valid only
 * during one call, the functions are not re-entrant, and nothing returned aliases scratch. Nothing is allocated
 * per EXAMINED path. Per RETURNED path the result allocates the `VisiblePortalPath`, its `clipPlanes` (copied from
 * scratch) and its `clipPolygonNdc` array; zero allocation there needs stable ids and pooled results (the trie of
 * a later job).
 *
 * Invariants: path 0 is the root with the full-screen polygon and four always-inside planes; every kept polygon
 * is convex with at most 8 vertices. The output feeds `renderPortalInstances`, which draws one instance of the
 * destination cell per visible path, clipped by `clipPolygonNdc` in a fragment shader.
 */

import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { developPortalSegment, type OrientedPortalSegment } from "../../cell-complex/orientedPortal";
import type { PortalPathTable, PortalRenderPath } from "../../cell-complex/portalPaths";
import {
  clipPackedSectorByPortal,
  clipPlaneArrayLength,
  clipPlanesToNdcPolygon,
  sectorSlotSize,
  writeAlwaysInsideClipPlanes,
  writeFullSector,
  writeFunnelClipPlanes,
} from "./portalFunnel";
import { rigidTransformToThreeMatrix } from "./worldAxes";

/** A 2D point; used for normalized device coordinates, where the visible square is [-1,1] x [-1,1] with +y up. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle in NDC (min/max inclusive); the bounding box of a clip polygon. */
export interface Rect2 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Paths whose on-screen area is below this many physical pixels are kept but their children are not visited.
 */
export const defaultMinPortalScreenAreaPixels = 16;

/** Inputs for {@link computeVisiblePortalPaths}: a path table plus the camera and viewport it is evaluated against. */
export interface ComputeVisiblePortalPathsInput {
  /** Compiled world; used to look up portal sides when a table path carries no developed newest portal. */
  readonly world: CompiledCellComplex;
  /** Root (camera) cell id; only used for diagnostics and the error message. */
  readonly rootCellId: string;
  /** Precomputed path table for `rootCellId`; must contain path id 0. */
  readonly pathTable: PortalPathTable;
  /** Camera in the root cell's frame, positioned inside the root cell. Its matrices are refreshed by the call. */
  readonly camera: THREE.Camera;
  /** Render-target size in physical pixels; only used to convert NDC areas to pixel areas. */
  readonly viewportPixels: { readonly width: number; readonly height: number };
  /** Culling and sorting parameters. */
  readonly options: VisiblePortalPathOptions;
}

/** Inputs for {@link computeIndependentVisiblePortalPaths}: like the single variant, but `cameras` is required and each is evaluated separately. */
export interface ComputeIndependentVisiblePortalPathsInput {
  readonly world: CompiledCellComplex;
  readonly rootCellId: string;
  readonly pathTable: PortalPathTable;
  readonly cameras: readonly THREE.Camera[];
  readonly viewportPixels: { readonly width: number; readonly height: number };
  readonly options: VisiblePortalPathOptions;
}

/** Culling, budget and ordering knobs for portal visibility. */
export interface VisiblePortalPathOptions {
  /** Largest path depth (number of portals crossed) considered; paths at this depth are terminal. */
  readonly maxDepth: number;
  /** Hard cap on the number of returned paths (including the root when `includeRootCell`); clamped at 0. */
  readonly maxVisiblePaths: number;
  /** Paths whose clipped aperture covers fewer pixels than this are kept as terminal paths (children not visited). */
  readonly minPortalScreenAreaPixels: number;
  /** Whether the root path (depth 0, full screen) is included in the output list. */
  readonly includeRootCell: boolean;
  /** `depth-then-area` keeps shallow paths first under the budget; `area-then-depth` favors large on-screen apertures. */
  readonly sortMode: "depth-then-area" | "area-then-depth";
}

/** One visible portal path: a destination cell to draw, its placement in the root frame, its clip planes and its screen-space clip polygon. */
export interface VisiblePortalPath {
  /** Id of the source `PortalRenderPath` within its table (0 is the root). */
  readonly pathId: number;
  /** Cell whose geometry is drawn for this path. */
  readonly destinationCellId: string;
  /** Number of portals crossed from the root cell. */
  readonly depth: number;
  /**
   * `rootFromDestination` expressed in Three.js axes: maps destination-cell geometry (in Three axes) into the root
   * cell's Three frame. Cached per table path and shared between calls: never mutate.
   */
  readonly rootFromDestinationMatrix: THREE.Matrix4;
  /**
   * 4 planes (nx, ny, nz, d), inside where `n . X + d >= 0`, in the Three.js frame of the root cell (the frame that
   * `rootFromDestinationMatrix` maps into). `|n| = 1`, or `(0, 0, 0, 1)` for "always inside". Order: right sector
   * boundary, left sector boundary, top, bottom. Never mutate.
   */
  readonly clipPlanes: Float64Array;
  /** True when the traversal did not visit this path's children (area below the threshold, or depth == maxDepth). */
  readonly terminal: boolean;
  /** Convex clip region in NDC (at most 8 vertices; winding follows the clipper). */
  readonly clipPolygonNdc: readonly Vec2[];
  /** Axis-aligned bounds of `clipPolygonNdc`. */
  readonly clipRectNdc: Rect2;
  /** Area of `clipPolygonNdc` in pixels of the supplied viewport. */
  readonly screenAreaPixels: number;
}

/** Counters describing one visibility pass, for the debug overlay. */
export interface VisiblePortalPathDebugSummary {
  readonly rootCellId: string;
  /** Number of entries in the path table (all depths). */
  readonly candidatePathCount: number;
  /** Currently the same value as `candidatePathCount` (no pre-filtering is performed). */
  readonly keptPathCount: number;
  /** Number of children looked at by the traversal (children of visible, non-terminal parents). */
  readonly examinedPathCount: number;
  /** Number of returned paths after the budget cut. */
  readonly visiblePathCount: number;
  readonly visiblePathCountByDepth: readonly { readonly depth: number; readonly count: number }[];
  readonly maxVisibleDepth: number;
  /** Paths dropped because no sight line through their portals exists (empty plan sector). */
  readonly clippedByFunnelCount: number;
  /** Paths dropped because sight lines exist but none is inside the view (empty screen polygon). */
  readonly clippedByCameraCount: number;
  /** Paths kept as terminal because their on-screen area is below the pixel threshold. */
  readonly terminalByAreaCount: number;
  /** Paths that passed visibility but were truncated by `maxVisiblePaths`. */
  readonly clippedByBudgetCount: number;
  readonly budgetExhausted: boolean;
}

/** Result of a visibility pass: the kept paths in render order plus an id lookup and diagnostics. */
export interface ComputeVisiblePortalPathsResult {
  /** Kept paths sorted per `sortMode`, truncated to the budget. */
  readonly paths: readonly VisiblePortalPath[];
  /** The same paths keyed by `pathId`. */
  readonly visiblePathById: ReadonlyMap<number, VisiblePortalPath>;
  readonly summary: VisiblePortalPathDebugSummary;
}

/** Debug answer to "is this path visible right now?", with its area and bounds when it is. */
export interface VisiblePortalPathLookupResult {
  readonly currentlyVisible: boolean;
  readonly screenAreaPixels?: number;
  readonly clipRectNdc?: Rect2;
}

interface VisitCounters {
  examined: number;
  clippedByFunnel: number;
  clippedByCamera: number;
  terminalByArea: number;
}

const fullScreenPolygonNdc: readonly Vec2[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

// ---- Scratch (see the module header for the ownership rules) ----
const stackPaths: PortalRenderPath[] = [];
let stackSectors = new Float64Array(64 * sectorSlotSize);
const parentSectorScratch = new Float64Array(sectorSlotSize);
const childSectorScratch = new Float64Array(sectorSlotSize);
const planeScratch = new Float64Array(clipPlaneArrayLength);
const polygonScratch = new Float64Array(2 * 9);
const eyeScratch = new THREE.Vector3();

// Cached Three.js matrix per table path; shared by every result, never mutated.
const threeMatrixByPath = new WeakMap<PortalRenderPath, THREE.Matrix4>();

function threeMatrixForPath(path: PortalRenderPath): THREE.Matrix4 {
  let matrix = threeMatrixByPath.get(path);

  if (!matrix) {
    matrix = rigidTransformToThreeMatrix(path.rootFromDestination);
    threeMatrixByPath.set(path, matrix);
  }

  return matrix;
}

function pushStack(path: PortalRenderPath, sector: Float64Array, sectorOffset: number, top: number): void {
  if ((top + 1) * sectorSlotSize > stackSectors.length) {
    const grown = new Float64Array(stackSectors.length * 2);

    grown.set(stackSectors);
    stackSectors = grown;
  }

  stackPaths[top] = path;
  const base = top * sectorSlotSize;

  stackSectors[base] = sector[sectorOffset];
  stackSectors[base + 1] = sector[sectorOffset + 1];
  stackSectors[base + 2] = sector[sectorOffset + 2];
  stackSectors[base + 3] = sector[sectorOffset + 3];
}

/**
 * Computes the visible portal paths for a root cell from one camera.
 *
 * Depth-first traversal over `pathTable.pathsByParentPathId`: only the children of visible, non-terminal parents are
 * examined. See the module header for the visibility rule. Budget truncation happens last, so a path may be returned
 * even if its parent was cut by the budget (possible with `area-then-depth`).
 *
 * Side effects: calls `updateMatrixWorld(true)` and `updateProjectionMatrix()` on the camera. The camera must lie in
 * the root cell (within 1e-6 m). Not re-entrant.
 * @throws Error if the table has no path with id 0.
 */
export function computeVisiblePortalPaths(input: ComputeVisiblePortalPathsInput): ComputeVisiblePortalPathsResult {
  return visitFromRoot(input, input.camera);
}

/**
 * Computes one visibility result per camera, each evaluated against that camera alone (own eye position, own
 * funnel). The result array parallels `input.cameras`. Returns an empty array for an empty camera list.
 * Side effects: refreshes camera matrices. @throws Error if the table has no path with id 0.
 */
export function computeIndependentVisiblePortalPaths(
  input: ComputeIndependentVisiblePortalPathsInput,
): readonly ComputeVisiblePortalPathsResult[] {
  if (!input.pathTable.pathsById.get(0)) {
    throw new Error(`Visible portal path table for root "${input.rootCellId}" has no root path.`);
  }

  return input.cameras.map((camera) => visitFromRoot(input, camera));
}

function visitFromRoot(
  input: {
    readonly world: CompiledCellComplex;
    readonly rootCellId: string;
    readonly pathTable: PortalPathTable;
    readonly viewportPixels: { readonly width: number; readonly height: number };
    readonly options: VisiblePortalPathOptions;
  },
  camera: THREE.Camera,
): ComputeVisiblePortalPathsResult {
  const { world, pathTable, viewportPixels, options } = input;
  const rootPath = pathTable.pathsById.get(0);

  if (!rootPath) {
    throw new Error(`Visible portal path table for root "${input.rootCellId}" has no root path.`);
  }

  camera.updateMatrixWorld(true);
  if ("updateProjectionMatrix" in camera && typeof camera.updateProjectionMatrix === "function") {
    camera.updateProjectionMatrix();
  }

  // Eye in the root cell's world axes: Three (x, y, z) -> world (x, -z, y).
  eyeScratch.setFromMatrixPosition(camera.matrixWorld);
  const eyeX = eyeScratch.x;
  const eyeY = -eyeScratch.z;
  const eyeZ = eyeScratch.y;
  const projectionElements = camera.projectionMatrix.elements;
  const viewElements = camera.matrixWorldInverse.elements;
  const pixelScale = viewportPixels.width * viewportPixels.height / 4;
  const counters: VisitCounters = { examined: 0, clippedByFunnel: 0, clippedByCamera: 0, terminalByArea: 0 };
  const discovered: VisiblePortalPath[] = [];

  if (options.includeRootCell) {
    const rootPlanes = new Float64Array(clipPlaneArrayLength);

    writeAlwaysInsideClipPlanes(rootPlanes, 0);
    discovered.push({
      pathId: rootPath.id,
      destinationCellId: rootPath.destinationCellId,
      depth: 0,
      rootFromDestinationMatrix: threeMatrixForPath(rootPath),
      clipPlanes: rootPlanes,
      terminal: options.maxDepth <= 0,
      clipPolygonNdc: fullScreenPolygonNdc,
      clipRectNdc: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
      screenAreaPixels: viewportPixels.width * viewportPixels.height,
    });
  }

  writeFullSector(childSectorScratch, 0);
  pushStack(rootPath, childSectorScratch, 0, 0);
  let top = 1;

  while (top > 0) {
    top -= 1;
    const parent = stackPaths[top];
    const parentSectorBase = top * sectorSlotSize;

    // Copy the parent's sector out: pushing a child below reuses this stack slot.
    parentSectorScratch[0] = stackSectors[parentSectorBase];
    parentSectorScratch[1] = stackSectors[parentSectorBase + 1];
    parentSectorScratch[2] = stackSectors[parentSectorBase + 2];
    parentSectorScratch[3] = stackSectors[parentSectorBase + 3];

    const children = pathTable.pathsByParentPathId.get(parent.id);

    if (!children) {
      continue;
    }

    for (const child of children) {
      if (child.depth > options.maxDepth) {
        continue;
      }

      counters.examined += 1;

      const portal = newestPortalOf(world, child, parent);

      if (!clipPackedSectorByPortal(parentSectorScratch, 0, portal, eyeX, eyeY, childSectorScratch, 0)) {
        counters.clippedByFunnel += 1;
        continue;
      }

      writeFunnelClipPlanes(
        planeScratch,
        0,
        childSectorScratch[0],
        childSectorScratch[1],
        childSectorScratch[2],
        childSectorScratch[3],
        portal,
        eyeX,
        eyeY,
        eyeZ,
      );

      const vertexCount = clipPlanesToNdcPolygon(planeScratch, projectionElements, viewElements, polygonScratch);
      const areaPixels = vertexCount >= 3 ? polygonAreaNdc(polygonScratch, vertexCount) * pixelScale : 0;

      if (!(areaPixels > 0)) {
        counters.clippedByCamera += 1;
        continue;
      }

      const belowThreshold = areaPixels < options.minPortalScreenAreaPixels;
      const terminal = belowThreshold || child.depth >= options.maxDepth;

      if (belowThreshold) {
        counters.terminalByArea += 1;
      }

      discovered.push(createVisiblePath(child, planeScratch, polygonScratch, vertexCount, areaPixels, terminal));

      if (!terminal) {
        pushStack(child, childSectorScratch, 0, top);
        top += 1;
      }
    }
  }

  return finalizeVisiblePortalPathResult(input, discovered, counters);
}

// The newest portal of `path` in the root frame; hand-built fixtures may lack `newestPortalInRoot`.
function newestPortalOf(world: CompiledCellComplex, path: PortalRenderPath, parent: PortalRenderPath): OrientedPortalSegment {
  if (path.newestPortalInRoot) {
    return path.newestPortalInRoot;
  }

  const step = path.steps[path.steps.length - 1];

  return developPortalSegment(world, step.sourceCellId, step.sourcePortalSideIndex, parent.rootFromDestination);
}

// Shoelace area in NDC units of the first `count` vertices of a packed (x, y) polygon.
function polygonAreaNdc(polygon: Float64Array, count: number): number {
  let twiceArea = 0;

  for (let index = 0; index < count; index += 1) {
    const following = index + 1 === count ? 0 : index + 1;

    twiceArea += polygon[index * 2] * polygon[following * 2 + 1] - polygon[following * 2] * polygon[index * 2 + 1];
  }

  return Math.abs(twiceArea) / 2;
}

function createVisiblePath(
  path: PortalRenderPath,
  planes: Float64Array,
  polygon: Float64Array,
  vertexCount: number,
  screenAreaPixels: number,
  terminal: boolean,
): VisiblePortalPath {
  const clipPolygonNdc: Vec2[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < vertexCount; index += 1) {
    const x = polygon[index * 2];
    const y = polygon[index * 2 + 1];

    clipPolygonNdc.push({ x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    pathId: path.id,
    destinationCellId: path.destinationCellId,
    depth: path.depth,
    rootFromDestinationMatrix: threeMatrixForPath(path),
    clipPlanes: planes.slice(0, clipPlaneArrayLength),
    terminal,
    clipPolygonNdc,
    clipRectNdc: { minX, minY, maxX, maxY },
    screenAreaPixels,
  };
}

function finalizeVisiblePortalPathResult(
  input: { readonly rootCellId: string; readonly pathTable: PortalPathTable; readonly options: VisiblePortalPathOptions },
  discovered: VisiblePortalPath[],
  counters: VisitCounters,
): ComputeVisiblePortalPathsResult {
  const sorted = discovered.sort((a, b) => compareVisiblePaths(a, b, input.options.sortMode));
  const maxVisiblePaths = Math.max(0, input.options.maxVisiblePaths);
  const paths = sorted.slice(0, maxVisiblePaths);
  const clippedByBudgetCount = Math.max(0, sorted.length - paths.length);
  const visiblePathById = new Map(paths.map((path) => [path.pathId, path]));

  return {
    paths,
    visiblePathById,
    summary: {
      rootCellId: input.rootCellId,
      candidatePathCount: input.pathTable.paths.length,
      keptPathCount: input.pathTable.paths.length,
      examinedPathCount: counters.examined,
      visiblePathCount: paths.length,
      visiblePathCountByDepth: summarizeVisiblePathCountByDepth(paths),
      maxVisibleDepth: paths.reduce((deepest, path) => Math.max(deepest, path.depth), 0),
      clippedByFunnelCount: counters.clippedByFunnel,
      clippedByCameraCount: counters.clippedByCamera,
      terminalByAreaCount: counters.terminalByArea,
      clippedByBudgetCount,
      budgetExhausted: clippedByBudgetCount > 0,
    },
  };
}

/** Returns the axis-aligned NDC bounding box of a polygon; yields infinities for an empty polygon. */
export function ndcRectForPolygon(polygon: readonly Vec2[]): Rect2 {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Converts an NDC polygon's area to pixels of the given viewport.
 *
 * The full NDC square has area 4 and covers width x height pixels, hence pixels = |area| x width x height / 4.
 */
export function ndcPolygonAreaPixels(
  polygon: readonly Vec2[],
  viewportPixels: { readonly width: number; readonly height: number },
): number {
  const ndcArea = Math.abs(signedPolygonArea(polygon));

  return ndcArea * viewportPixels.width * viewportPixels.height / 4;
}

/** Builds an ascending-by-depth histogram of how many paths exist at each depth. */
export function summarizeVisiblePathCountByDepth(
  paths: readonly { readonly depth: number }[],
): readonly { readonly depth: number; readonly count: number }[] {
  const counts = new Map<number, number>();

  for (const path of paths) {
    counts.set(path.depth, (counts.get(path.depth) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([depth, count]) => ({ depth, count }));
}

/** Looks up a path id in the latest visibility result and reports whether it is visible, with its pixel area and NDC bounds if so. */
export function describeVisiblePortalPath(
  pathId: number | undefined,
  latestVisibleResult: Pick<ComputeVisiblePortalPathsResult, "visiblePathById"> | undefined,
): VisiblePortalPathLookupResult {
  const visiblePath = pathId === undefined ? undefined : latestVisibleResult?.visiblePathById.get(pathId);

  return {
    currentlyVisible: visiblePath !== undefined,
    ...(visiblePath
      ? {
          screenAreaPixels: visiblePath.screenAreaPixels,
          clipRectNdc: visiblePath.clipRectNdc,
        }
      : {}),
  };
}

function compareVisiblePaths(
  a: VisiblePortalPath,
  b: VisiblePortalPath,
  sortMode: VisiblePortalPathOptions["sortMode"],
): number {
  if (sortMode === "area-then-depth") {
    return b.screenAreaPixels - a.screenAreaPixels || a.depth - b.depth || a.pathId - b.pathId;
  }

  return a.depth - b.depth || b.screenAreaPixels - a.screenAreaPixels || a.pathId - b.pathId;
}

// Shoelace formula: positive for counter-clockwise vertex order.
function signedPolygonArea(polygon: readonly Vec2[]): number {
  let twiceArea = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }

  return twiceArea / 2;
}
