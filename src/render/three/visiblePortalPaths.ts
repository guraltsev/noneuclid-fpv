/**
 * Per-frame portal visibility: decides which entries of a root cell's portal-path table are actually visible
 * on screen and returns, for each, the convex NDC polygon through which its destination cell may be drawn.
 *
 * A `PortalRenderPath` is a chain of portal steps starting in the root (camera) cell; its `rootFromDestination`
 * rigid transform maps the destination cell's local frame into the root cell's frame (cell-local
 * x-right/y-forward/z-up, meters; the root frame is mapped to Three.js axes by `worldAxes`). Visibility is
 * computed top-down over the table (parents precede children, depth-limited): the aperture of the NEWEST
 * portal of a path (a floor-to-ceiling quad in its source cell) is carried into root space with the parent's
 * `rootFromDestination`, projected through the camera into NDC (near-plane clipped, convex-hulled over all
 * supplied cameras so stereo eyes share one conservative polygon), and clipped with Sutherland-Hodgman against
 * the parent's already-clipped NDC polygon. Paths whose polygon degenerates (<3 vertices) or whose pixel area
 * falls below `minPortalScreenAreaPixels` are dropped together with their whole subtree, since their children
 * are never visited; survivors are sorted and truncated to `maxVisiblePaths`.
 *
 * Invariants: path 0 is the root with the full-screen polygon; every kept polygon is convex and lies inside its
 * parent's polygon (up to a 1e-9 tolerance); results are conservative (may over-include slightly, should not
 * under-include a portal a camera can see). The output feeds `renderPortalInstances`, which draws one instance
 * of the destination cell per visible path, clipped by `clipPolygonNdc` in a fragment shader.
 */

import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { PortalPathTable, PortalRenderPath } from "../../cell-complex/portalPaths";
import { transformPoint3, type RigidTransform3 } from "../../math/rigidTransform3";
import { vec3, type Vec3 } from "../../math/vec3";
import { rigidTransformToThreeMatrix, worldPointToThree } from "./worldAxes";

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

/** Inputs for {@link computeVisiblePortalPaths}: a path table plus the camera(s) and viewport it is evaluated against. */
export interface ComputeVisiblePortalPathsInput {
  /** Compiled world; used to look up portal sides (aperture geometry) and cell heights. */
  readonly world: CompiledCellComplex;
  /** Root (camera) cell id; only used for diagnostics and the error message. */
  readonly rootCellId: string;
  /** Precomputed path table for `rootCellId`; must contain path id 0 and list each parent before its children. */
  readonly pathTable: PortalPathTable;
  /** Primary camera; used only when `cameras` is absent or empty. Its matrices are refreshed by the call. */
  readonly camera: THREE.Camera;
  /** All cameras (e.g. both XR eyes) whose projections are unioned into one conservative polygon per portal. */
  readonly cameras?: readonly THREE.Camera[];
  /** Render-target size in physical pixels; only used to convert NDC areas to pixel areas. */
  readonly viewportPixels: { readonly width: number; readonly height: number };
  /** Culling and sorting parameters. */
  readonly options: VisiblePortalPathOptions;
}

/** Inputs for {@link computeIndependentVisiblePortalPaths}: like the shared variant, but `cameras` is required and each is evaluated separately. */
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
  /** Largest path depth (number of portals crossed) considered; deeper table entries are skipped. */
  readonly maxDepth: number;
  /** Hard cap on the number of returned paths (including the root when `includeRootCell`); clamped at 0. */
  readonly maxVisiblePaths: number;
  /** Paths whose clipped aperture covers fewer pixels than this are culled together with their descendants. */
  readonly minPortalScreenAreaPixels: number;
  /** Whether the root path (depth 0, full screen) is included in the output list. */
  readonly includeRootCell: boolean;
  /** `depth-then-area` keeps shallow paths first under the budget; `area-then-depth` favors large on-screen apertures. */
  readonly sortMode: "depth-then-area" | "area-then-depth";
}

/** One visible portal path: a destination cell to draw, its placement in the root frame, and its screen-space clip polygon. */
export interface VisiblePortalPath {
  /** Id of the source `PortalRenderPath` within its table (0 is the root). */
  readonly pathId: number;
  /** Cell whose geometry is drawn for this path. */
  readonly destinationCellId: string;
  /** Number of portals crossed from the root cell. */
  readonly depth: number;
  /** `rootFromDestination` expressed in Three.js axes: maps destination-cell geometry (in Three axes) into the root cell's Three frame. */
  readonly rootFromDestinationMatrix: THREE.Matrix4;
  /** Convex clip region in NDC, already intersected with every ancestor aperture (vertex order follows the clipper; winding not guaranteed). */
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
  /** Number of returned paths after the budget cut. */
  readonly visiblePathCount: number;
  readonly visiblePathCountByDepth: readonly { readonly depth: number; readonly count: number }[];
  readonly maxVisibleDepth: number;
  /** Paths dropped because the portal aperture was entirely behind the camera. */
  readonly clippedByCameraCount: number;
  /** Paths dropped because the clipped polygon was degenerate or below the pixel-area threshold. */
  readonly clippedByAreaCount: number;
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

interface InternalVisiblePath extends VisiblePortalPath {
  readonly sourcePath: PortalRenderPath;
}

interface VisiblePathAccumulator {
  readonly camera: THREE.Camera;
  readonly visibleBeforeBudgetById: Map<number, InternalVisiblePath>;
  readonly discovered: InternalVisiblePath[];
  clippedByCameraCount: number;
  clippedByAreaCount: number;
}

const fullScreenPolygonNdc: readonly Vec2[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

const polygonTolerance = 1e-9;
const nearCoplanarPortalToleranceMeters = 0.05;

/**
 * Computes the visible portal paths for a root cell, using all supplied cameras as one conservative union.
 *
 * Traverses `pathTable.paths` in order (parents must precede children). A path is visible iff its parent is
 * visible and the newest portal's projected aperture, clipped to the parent's polygon, has at least 3 vertices
 * and at least `minPortalScreenAreaPixels` pixels. Budget truncation happens last, so a path may be returned
 * even if its parent was cut by the budget (possible with `area-then-depth`). Cost is O(paths x cameras) with
 * small per-path allocations; no GPU work.
 *
 * Side effects: calls `updateMatrixWorld(true)` and `updateProjectionMatrix()` on every camera.
 * @throws Error if the table has no path with id 0.
 */
export function computeVisiblePortalPaths(input: ComputeVisiblePortalPathsInput): ComputeVisiblePortalPathsResult {
  const rootPath = input.pathTable.pathsById.get(0);

  if (!rootPath) {
    throw new Error(`Visible portal path table for root "${input.rootCellId}" has no root path.`);
  }

  const cameras = input.cameras && input.cameras.length > 0 ? input.cameras : [input.camera];

  for (const camera of cameras) {
    camera.updateMatrixWorld(true);
    if ("updateProjectionMatrix" in camera && typeof camera.updateProjectionMatrix === "function") {
      camera.updateProjectionMatrix();
    }
  }

  const rootVisiblePath = createVisiblePath(rootPath, fullScreenPolygonNdc, input.viewportPixels);
  const visibleBeforeBudgetById = new Map<number, InternalVisiblePath>([[rootPath.id, rootVisiblePath]]);
  const discovered: InternalVisiblePath[] = input.options.includeRootCell ? [rootVisiblePath] : [];
  let clippedByCameraCount = 0;
  let clippedByAreaCount = 0;

  for (const path of input.pathTable.paths) {
    if (path.depth === 0 || path.depth > input.options.maxDepth) {
      continue;
    }

    const parentPathId = path.parentPathId;
    const parentVisible = parentPathId === undefined ? undefined : visibleBeforeBudgetById.get(parentPathId);

    if (!parentVisible) {
      continue;
    }

    const portalPolygon = projectNewestPortalApertureToNdc(input.world, path, parentVisible.sourcePath, cameras);

    if (!portalPolygon) {
      clippedByCameraCount += 1;
      continue;
    }

    const clippedPolygon = clipConvexPolygonByConvexPolygon(portalPolygon, parentVisible.clipPolygonNdc);
    const screenAreaPixels = ndcPolygonAreaPixels(clippedPolygon, input.viewportPixels);

    if (clippedPolygon.length < 3 || screenAreaPixels < input.options.minPortalScreenAreaPixels) {
      clippedByAreaCount += 1;
      continue;
    }

    const visiblePath = createVisiblePath(path, clippedPolygon, input.viewportPixels);
    visibleBeforeBudgetById.set(path.id, visiblePath);
    discovered.push(visiblePath);
  }

  const sorted = [...discovered].sort((a, b) => compareVisiblePaths(a, b, input.options.sortMode));
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
      visiblePathCount: paths.length,
      visiblePathCountByDepth: summarizeVisiblePathCountByDepth(paths),
      maxVisibleDepth: Math.max(0, ...paths.map((path) => path.depth)),
      clippedByCameraCount,
      clippedByAreaCount,
      clippedByBudgetCount,
      budgetExhausted: clippedByBudgetCount > 0,
    },
  };
}

/**
 * Computes one visibility result per camera, each evaluated against that camera alone (no cross-eye union).
 *
 * Same algorithm as {@link computeVisiblePortalPaths}, but every camera keeps its own parent-visibility map, so
 * the result array parallels `input.cameras`. The portal aperture in root space is computed once per path and
 * shared across cameras. Returns an empty array for an empty camera list.
 * Side effects: refreshes camera matrices. @throws Error if the table has no path with id 0.
 */
export function computeIndependentVisiblePortalPaths(
  input: ComputeIndependentVisiblePortalPathsInput,
): readonly ComputeVisiblePortalPathsResult[] {
  const rootPath = input.pathTable.pathsById.get(0);

  if (!rootPath) {
    throw new Error(`Visible portal path table for root "${input.rootCellId}" has no root path.`);
  }

  if (input.cameras.length === 0) {
    return [];
  }

  for (const camera of input.cameras) {
    camera.updateMatrixWorld(true);
    if ("updateProjectionMatrix" in camera && typeof camera.updateProjectionMatrix === "function") {
      camera.updateProjectionMatrix();
    }
  }

  const states = input.cameras.map((camera) => {
    const rootVisiblePath = createVisiblePath(rootPath, fullScreenPolygonNdc, input.viewportPixels);

    return {
      camera,
      visibleBeforeBudgetById: new Map<number, InternalVisiblePath>([[rootPath.id, rootVisiblePath]]),
      discovered: input.options.includeRootCell ? [rootVisiblePath] : [],
      clippedByCameraCount: 0,
      clippedByAreaCount: 0,
    };
  });

  for (const path of input.pathTable.paths) {
    if (path.depth === 0 || path.depth > input.options.maxDepth) {
      continue;
    }

    const parentPathId = path.parentPathId;
    let apertureInRoot: readonly Vec3[] | undefined;

    for (const state of states) {
      const parentVisible = parentPathId === undefined ? undefined : state.visibleBeforeBudgetById.get(parentPathId);

      if (!parentVisible) {
        continue;
      }

      if (!apertureInRoot) {
        apertureInRoot = buildNewestPortalApertureInRoot(input.world, path, parentVisible.sourcePath);
      }

      const portalPolygon = projectRootSpacePointsToConservativeNdc(apertureInRoot, [state.camera]);

      if (!portalPolygon) {
        state.clippedByCameraCount += 1;
        continue;
      }

      const clippedPolygon = clipConvexPolygonByConvexPolygon(portalPolygon, parentVisible.clipPolygonNdc);
      const screenAreaPixels = ndcPolygonAreaPixels(clippedPolygon, input.viewportPixels);

      if (clippedPolygon.length < 3 || screenAreaPixels < input.options.minPortalScreenAreaPixels) {
        state.clippedByAreaCount += 1;
        continue;
      }

      const visiblePath = createVisiblePath(path, clippedPolygon, input.viewportPixels);
      state.visibleBeforeBudgetById.set(path.id, visiblePath);
      state.discovered.push(visiblePath);
    }
  }

  return states.map((state) => finalizeVisiblePortalPathResult(input, state));
}

/**
 * Builds the four corners of a portal side's aperture as a floor-to-ceiling quad in the cell's local frame.
 *
 * Corners are (start,0), (end,0), (end,height), (start,height) using the side's 2D endpoints (meters) and the
 * cell's `heightMeters`, i.e. a planar convex quad lying on the prism's wall.
 * @throws Error if the cell or side index does not exist.
 */
export function buildPortalApertureCorners(
  world: CompiledCellComplex,
  cellId: string,
  sideIndex: number,
): readonly Vec3[] {
  const cell = world.cellsById.get(cellId);
  const side = cell?.sides[sideIndex];

  if (!cell || !side) {
    throw new Error(`Cannot build portal aperture for missing side "${cellId}:${sideIndex}".`);
  }

  return [
    vec3(side.start.x, side.start.y, 0),
    vec3(side.end.x, side.end.y, 0),
    vec3(side.end.x, side.end.y, cell.heightMeters),
    vec3(side.start.x, side.start.y, cell.heightMeters),
  ];
}

/** Maps aperture corners from a source cell's local frame into the root frame by applying `rootFromSource` to each point. */
export function transformApertureCornersToRoot(
  apertureCorners: readonly Vec3[],
  rootFromSource: RigidTransform3,
): readonly Vec3[] {
  return apertureCorners.map((point) => transformPoint3(rootFromSource, point));
}

/**
 * Projects root-frame points through one camera into NDC, clipping against the camera's near plane first.
 *
 * Points are converted to the Three.js frame and then to camera space (camera looks down -z, so visible points
 * have z < 0). Polygons nearly coplanar with the image plane (within near + 5 cm) are clipped at a much smaller
 * distance so a portal the camera is touching does not vanish. Otherwise the polygon is clipped at z = -near.
 * Returns the projected vertices (not a hull; order follows the clipped polygon) or `undefined` when the polygon
 * is entirely behind the near plane. NDC x/y are perspective-divided, so this is valid for perspective cameras.
 */
export function projectRootSpacePointsToNdc(
  rootSpacePoints: readonly Vec3[],
  camera: THREE.Camera,
): readonly Vec2[] | undefined {
  const cameraSpacePoints = rootSpacePoints.map((point) =>
    worldPointToThree(point).applyMatrix4(camera.matrixWorldInverse),
  );
  const near = "near" in camera && typeof camera.near === "number" ? camera.near : 0.01;
  const nearCoplanarPolygon = projectNearCoplanarPortalToNdc(cameraSpacePoints, camera, near);

  if (nearCoplanarPolygon) {
    return nearCoplanarPolygon;
  }

  const clippedCameraSpacePoints = clipCameraSpacePolygonAgainstNearPlane(cameraSpacePoints, near);

  if (clippedCameraSpacePoints.length >= 3) {
    return projectCameraSpacePointsToNdc(clippedCameraSpacePoints, camera);
  }

  if (cameraSpacePoints.every((point) => point.z < -polygonTolerance)) {
    return projectCameraSpacePointsToNdc(cameraSpacePoints, camera);
  }

  return undefined;
}

// Special case for portals nearly coplanar with the camera image plane (e.g. standing in a doorway): the
// ordinary near-plane clip would discard them, so clip against a tiny near distance instead.
function projectNearCoplanarPortalToNdc(
  points: readonly THREE.Vector3[],
  camera: THREE.Camera,
  near: number,
): readonly Vec2[] | undefined {
  if (points.length < 3 || !points.some((point) => point.z < -polygonTolerance)) {
    return undefined;
  }

  const normal = new THREE.Vector3()
    .subVectors(points[1], points[0])
    .cross(new THREE.Vector3().subVectors(points[2], points[0]));
  const normalLength = normal.length();

  if (normalLength <= polygonTolerance) {
    return undefined;
  }

  normal.divideScalar(normalLength);
  const planeDistanceFromCamera = Math.abs(normal.dot(points[0]));

  if (planeDistanceFromCamera >= near + nearCoplanarPortalToleranceMeters) {
    return undefined;
  }

  const cameraPlaneClipped = clipCameraSpacePolygonAgainstNearPlane(points, Math.min(near, 1e-4));

  return cameraPlaneClipped.length >= 3 ? projectCameraSpacePointsToNdc(cameraPlaneClipped, camera) : undefined;
}

// Perspective divide by clip-space w (= -z_cam for perspective projections); `|| 1` guards w == 0.
function projectCameraSpacePointsToNdc(
  cameraSpacePoints: readonly THREE.Vector3[],
  camera: THREE.Camera,
): readonly Vec2[] {
  return cameraSpacePoints.map((point) => {
    const projected = new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(camera.projectionMatrix);
    const w = projected.w || 1;

    return {
      x: projected.x / w,
      y: projected.y / w,
    };
  });
}

/**
 * Intersects two convex polygons with Sutherland-Hodgman clipping and returns the (possibly empty) result.
 *
 * `candidatePolygon` is clipped successively by the half-plane of each edge of `clipPolygon`; the clip winding
 * is detected from its signed area, so either orientation works. Points within 1e-9 of an edge count as inside
 * (slightly conservative). Returns `[]` if the candidate is empty, the clip polygon has fewer than 3 vertices,
 * or the intersection is empty; the result may still have fewer than 3 vertices for touching polygons.
 */
export function clipConvexPolygonByConvexPolygon(
  candidatePolygon: readonly Vec2[],
  clipPolygon: readonly Vec2[],
): Vec2[] {
  if (candidatePolygon.length === 0 || clipPolygon.length < 3) {
    return [];
  }

  let clipped = [...candidatePolygon];
  const clipSign = Math.sign(signedPolygonArea(clipPolygon)) || 1;

  for (let index = 0; index < clipPolygon.length; index += 1) {
    const start = clipPolygon[index];
    const end = clipPolygon[(index + 1) % clipPolygon.length];

    clipped = clipPolygonByEdgeHalfPlane(clipped, start, end, clipSign);

    if (clipped.length === 0) {
      return [];
    }
  }

  return dedupePolygonVertices(clipped);
}

/** Returns the axis-aligned NDC bounding box of a polygon; yields infinities for an empty polygon. */
export function ndcRectForPolygon(polygon: readonly Vec2[]): Rect2 {
  return {
    minX: Math.min(...polygon.map((point) => point.x)),
    minY: Math.min(...polygon.map((point) => point.y)),
    maxX: Math.max(...polygon.map((point) => point.x)),
    maxY: Math.max(...polygon.map((point) => point.y)),
  };
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

// NDC polygon (convex hull over all cameras) of the newest portal in `path`. Its source cell is the parent's
// destination cell, so the aperture is placed with the PARENT's rootFromDestination.
function projectNewestPortalApertureToNdc(
  world: CompiledCellComplex,
  path: PortalRenderPath,
  parentPath: PortalRenderPath,
  cameras: readonly THREE.Camera[],
): readonly Vec2[] | undefined {
  return projectRootSpacePointsToConservativeNdc(
    buildNewestPortalApertureInRoot(world, path, parentPath),
    cameras,
  );
}

function buildNewestPortalApertureInRoot(
  world: CompiledCellComplex,
  path: PortalRenderPath,
  parentPath: PortalRenderPath,
): readonly Vec3[] {
  const newestStep = path.steps[path.steps.length - 1];

  if (!newestStep) {
    return [];
  }

  const apertureCorners = buildPortalApertureCorners(world, newestStep.sourceCellId, newestStep.sourcePortalSideIndex);

  return transformApertureCornersToRoot(apertureCorners, parentPath.rootFromDestination);
}

function finalizeVisiblePortalPathResult(
  input: ComputeIndependentVisiblePortalPathsInput,
  state: VisiblePathAccumulator,
): ComputeVisiblePortalPathsResult {
  const sorted = [...state.discovered].sort((a, b) => compareVisiblePaths(a, b, input.options.sortMode));
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
      visiblePathCount: paths.length,
      visiblePathCountByDepth: summarizeVisiblePathCountByDepth(paths),
      maxVisibleDepth: Math.max(0, ...paths.map((path) => path.depth)),
      clippedByCameraCount: state.clippedByCameraCount,
      clippedByAreaCount: state.clippedByAreaCount,
      clippedByBudgetCount,
      budgetExhausted: clippedByBudgetCount > 0,
    },
  };
}

// Union of per-camera projections, hulled: one polygon valid (conservatively) for every eye.
function projectRootSpacePointsToConservativeNdc(
  rootSpacePoints: readonly Vec3[],
  cameras: readonly THREE.Camera[],
): readonly Vec2[] | undefined {
  const projectedPoints = cameras.flatMap((camera) => projectRootSpacePointsToNdc(rootSpacePoints, camera) ?? []);

  if (projectedPoints.length < 3) {
    return undefined;
  }

  return convexHull(projectedPoints);
}

function createVisiblePath(
  path: PortalRenderPath,
  clipPolygonNdc: readonly Vec2[],
  viewportPixels: { readonly width: number; readonly height: number },
): InternalVisiblePath {
  return {
    pathId: path.id,
    destinationCellId: path.destinationCellId,
    depth: path.depth,
    rootFromDestinationMatrix: rigidTransformToThreeMatrix(path.rootFromDestination),
    clipPolygonNdc,
    clipRectNdc: ndcRectForPolygon(clipPolygonNdc),
    screenAreaPixels: ndcPolygonAreaPixels(clipPolygonNdc, viewportPixels),
    sourcePath: path,
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

// One Sutherland-Hodgman step: keeps the part of `polygon` on the left of the directed edge (clipSign = +1 for
// a CCW clip polygon; -1 flips the test for CW). Emits `next` for inside->inside and outside->inside, and the
// crossing point for each inside/outside transition.
function clipPolygonByEdgeHalfPlane(
  polygon: readonly Vec2[],
  edgeStart: Vec2,
  edgeEnd: Vec2,
  clipSign: number,
): Vec2[] {
  const clipped: Vec2[] = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentValue = clipSign * orient2(edgeStart, edgeEnd, current);
    const nextValue = clipSign * orient2(edgeStart, edgeEnd, next);
    const currentInside = currentValue >= -polygonTolerance;
    const nextInside = nextValue >= -polygonTolerance;

    if (currentInside && nextInside) {
      clipped.push(next);
      continue;
    }

    if (currentInside !== nextInside) {
      clipped.push(intersectEdge(current, next, currentValue, nextValue));
    }

    if (!currentInside && nextInside) {
      clipped.push(next);
    }
  }

  return clipped;
}

// Linear interpolation to the zero of the signed edge distance between two vertices of opposite sign.
function intersectEdge(start: Vec2, end: Vec2, startValue: number, endValue: number): Vec2 {
  const alpha = startValue / (startValue - endValue);

  return {
    x: start.x + (end.x - start.x) * alpha,
    y: start.y + (end.y - start.y) * alpha,
  };
}

// Clips a camera-space polygon (camera looks down -z) to z <= -near against the single plane z = -near.
function clipCameraSpacePolygonAgainstNearPlane(
  polygon: readonly THREE.Vector3[],
  near: number,
): readonly THREE.Vector3[] {
  const clipped: THREE.Vector3[] = [];
  const nearPlaneZ = -near;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentInside = current.z <= nearPlaneZ + polygonTolerance;
    const nextInside = next.z <= nearPlaneZ + polygonTolerance;

    if (currentInside && nextInside) {
      clipped.push(next.clone());
      continue;
    }

    if (currentInside !== nextInside) {
      clipped.push(intersectCameraSpaceNearPlane(current, next, nearPlaneZ));
    }

    if (!currentInside && nextInside) {
      clipped.push(next.clone());
    }
  }

  return dedupeCameraSpaceVertices(clipped);
}

function intersectCameraSpaceNearPlane(
  start: THREE.Vector3,
  end: THREE.Vector3,
  nearPlaneZ: number,
): THREE.Vector3 {
  const alpha = (nearPlaneZ - start.z) / (end.z - start.z);

  return new THREE.Vector3(
    start.x + (end.x - start.x) * alpha,
    start.y + (end.y - start.y) * alpha,
    nearPlaneZ,
  );
}

function dedupeCameraSpaceVertices(vertices: readonly THREE.Vector3[]): THREE.Vector3[] {
  const deduped: THREE.Vector3[] = [];

  for (const vertex of vertices) {
    const previous = deduped[deduped.length - 1];

    if (!previous || previous.distanceTo(vertex) > polygonTolerance) {
      deduped.push(vertex);
    }
  }

  const first = deduped[0];
  const last = deduped[deduped.length - 1];

  if (first && last && deduped.length > 1 && first.distanceTo(last) <= polygonTolerance) {
    deduped.pop();
  }

  return deduped;
}

function dedupePolygonVertices(vertices: readonly Vec2[]): Vec2[] {
  const deduped: Vec2[] = [];

  for (const vertex of vertices) {
    const previous = deduped[deduped.length - 1];

    if (!previous || Math.hypot(vertex.x - previous.x, vertex.y - previous.y) > polygonTolerance) {
      deduped.push(vertex);
    }
  }

  const first = deduped[0];
  const last = deduped[deduped.length - 1];

  if (first && last && deduped.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) <= polygonTolerance) {
    deduped.pop();
  }

  return deduped;
}

// Andrew's monotone chain; near-collinear points (within tolerance) are dropped. Returns a CCW hull.
function convexHull(points: readonly Vec2[]): Vec2[] {
  const sorted = dedupeSortedPoints(
    [...points].sort((left, right) => left.x - right.x || left.y - right.y),
  );

  if (sorted.length <= 2) {
    return sorted;
  }

  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && orient2(lower[lower.length - 2], lower[lower.length - 1], point) <= polygonTolerance) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Vec2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && orient2(upper[upper.length - 2], upper[upper.length - 1], point) <= polygonTolerance) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function dedupeSortedPoints(points: readonly Vec2[]): Vec2[] {
  const deduped: Vec2[] = [];

  for (const point of points) {
    const previous = deduped[deduped.length - 1];

    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > polygonTolerance) {
      deduped.push(point);
    }
  }

  return deduped;
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

// 2D cross product (b-a) x (c-a): positive when c is left of the directed line a->b.
function orient2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
