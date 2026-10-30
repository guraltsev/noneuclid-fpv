/**
 * Fills the per-frame instance buffers that draw each visible portal path as an instance of its destination cell.
 *
 * Each cell (and each runtime-object type) has an instanced-mesh "archetype" with a fixed capacity. For every
 * `VisiblePortalPath` (see `visiblePortalPaths`) one instance is written whose matrix is the path's
 * `rootFromDestinationMatrix`, i.e. the rigid transform placing the destination cell in the ROOT cell's Three.js
 * frame; runtime objects use `rootFromDestination * record.localMatrix` (three.js `multiplyMatrices(a, b)` = a*b,
 * so the object's cell-local matrix is applied first). Two per-instance attributes accompany the matrix:
 * `portalPathId` and `portalClipIndex`, the slot of the clip-plane texture (`portalClipData`) whose 4 world-space planes
 * the vertex shader (`portalClipMaterial`) evaluates to clip the instance to the path's visible region.
 *
 * When all eyes share one root, the depth-0 path is not an instance: the archetype's unpatched `rootMesh` draws it
 * (`separateRoot`), keeping early depth rejection. Clip-index sentinels: `unclippedPortalClipIndex` (-2) marks the root instance (never clipped); -1 is only the
 * "unknown" default of a path missing from the slot map and is fully clipped. Callers never give a visible path -1:
 * `omitPathsWithoutClipSlot` removes the (impossible by construction) paths without a slot before instancing, so
 * they are not drawn at all. Instances beyond an
 * archetype's capacity are dropped and recorded in `PortalInstanceDiagnostics`. This module also builds the debug
 * state shown by the overlay. All work is CPU-side, linear in the number of visible paths per frame.
 *
 * Uploads are dirty-checked: each instance is compared with the value already in the CPU buffer (floats compared after
 * `Math.fround`) and only a buffer that changed is flagged `needsUpdate`, with an update range covering the written
 * prefix `[0, count * itemSize)`. An archetype with no instances is hidden (`mesh.visible = false`) so it costs no draw
 * call; `prerenderCells` shows such archetypes while compiling so their shaders are still warmed up.
 */

import * as THREE from "three";
import type { PortalRenderPath } from "../../cell-complex/portalPaths";
import type { CellRenderArchetype } from "./cellRenderArchetypes";
import type {
  RuntimeObjectRenderArchetype,
  RuntimeObjectRenderArchetypeDiagnostics,
} from "./runtimeObjectRenderArchetypes";
import type { RuntimeObjectRenderRecord } from "./runtimeObjectRenderRecords";
import { clipPlaneArrayLength, writeAlwaysInsideClipPlanes } from "./portalFunnel";
import type { VisiblePortalPath, VisiblePortalPathDebugSummary } from "./visiblePortalPaths";

/** Snapshot of instanced portal rendering for the debug overlay and console helpers. */
export interface PortalInstanceRenderDebugState {
  /** Whether instanced portal rendering is enabled. */
  readonly enabled: boolean;
  /** Echo of the `showCellPathRendersInstances` option (note the capitalised field name). */
  readonly ShowCellPathRendersInstances: boolean;
  /** Number of cell archetypes considered. */
  readonly archetypeCount: number;
  /** Sum of archetype instance capacities. */
  readonly totalCapacity: number;
  /** Sum of `mesh.count` over the archetypes, i.e. instances actually drawn. */
  readonly renderedInstanceCount: number;
  readonly renderedInstanceCountByCell: readonly {
    readonly cellId: string;
    readonly count: number;
  }[];
  /** Number of archetypes that overflowed their capacity this frame. */
  readonly capacityOverflowCount: number;
  readonly capacityOverflowArchetypes: readonly string[];
  readonly normalVisiblePathRenderingActive: boolean;
  readonly visiblePathIds: readonly number[];
  readonly visiblePathDestinations: readonly {
    readonly pathId: number;
    readonly destinationCellId: string;
  }[];
  /** Visible paths that found no clip slot and were therefore not drawn (0 by construction). */
  readonly visiblePathOverflowCount: number;
  /** How portal clipping runs: `hardware` = `gl_ClipDistance` in the vertex stage, `fragment` = one compare and `discard`. */
  readonly portalClipMode: "hardware" | "fragment";
}

/** Per-frame collector of archetypes whose instance capacity was exceeded. */
export interface PortalInstanceDiagnostics {
  /** Clears the recorded overflows; call once at the start of each frame's instance update. */
  reset(): void;
  /** Records that `archetype` was asked for `requestedCount` instances but holds fewer. */
  recordCapacityOverflow(archetype: CellRenderArchetype, requestedCount: number): void;
  /** Sorted ids of the archetypes that overflowed since the last `reset`. */
  readonly capacityOverflowArchetypes: readonly string[];
  /** Number of distinct overflowed archetypes since the last `reset`. */
  readonly capacityOverflowCount: number;
}

const fullScreenPolygonNdc = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

/** Clip index meaning "do not clip" (the root cell instance); -1 means "no clip slot, discard everything". */
export const unclippedPortalClipIndex = -2;

/** Creates an empty overflow collector keyed by archetype id. */
export function createPortalInstanceDiagnostics(): PortalInstanceDiagnostics {
  const capacityOverflowArchetypes = new Set<string>();

  return {
    reset() {
      capacityOverflowArchetypes.clear();
    },
    recordCapacityOverflow(archetype) {
      capacityOverflowArchetypes.add(archetype.archetypeId);
    },
    get capacityOverflowArchetypes() {
      return [...capacityOverflowArchetypes].sort();
    },
    get capacityOverflowCount() {
      return capacityOverflowArchetypes.size;
    },
  };
}

/** Builds the synthetic depth-0 path for the root cell: identity placement, full-screen clip, infinite pixel area. */
export function createRootVisiblePortalPath(cellId: string): VisiblePortalPath {
  return {
    pathId: 0,
    destinationCellId: cellId,
    depth: 0,
    rootFromDestinationMatrix: new THREE.Matrix4(),
    clipPolygonNdc: fullScreenPolygonNdc,
    clipRectNdc: {
      minX: -1,
      minY: -1,
      maxX: 1,
      maxY: 1,
    },
    screenAreaPixels: Number.POSITIVE_INFINITY,
    clipPlanes: (() => {
      const planes = new Float64Array(clipPlaneArrayLength);

      writeAlwaysInsideClipPlanes(planes, 0);

      return planes;
    })(),
    terminal: false,
  };
}

/** Groups visible paths by `destinationCellId`, preserving input order within each group. */
export function groupVisiblePortalPathsByDestinationCell(
  paths: readonly VisiblePortalPath[],
): ReadonlyMap<string, readonly VisiblePortalPath[]> {
  const grouped = new Map<string, VisiblePortalPath[]>();

  for (const path of paths) {
    const existing = grouped.get(path.destinationCellId);

    if (existing) {
      existing.push(path);
      continue;
    }

    grouped.set(path.destinationCellId, [path]);
  }

  return grouped;
}

/**
 * Joins the statically kept path lists per destination cell with the currently visible paths.
 *
 * Cells with no visible path are omitted from the result; per-cell order follows `staticallyKeptPathsByDestinationCell`.
 */
export function buildVisiblePathsByDestinationCell(
  staticallyKeptPathsByDestinationCell: ReadonlyMap<string, readonly PortalRenderPath[]>,
  visiblePathById: ReadonlyMap<number, VisiblePortalPath>,
): ReadonlyMap<string, readonly VisiblePortalPath[]> {
  const grouped = new Map<string, VisiblePortalPath[]>();

  for (const [destinationCellId, keptPaths] of staticallyKeptPathsByDestinationCell) {
    const visiblePaths: VisiblePortalPath[] = [];

    for (const keptPath of keptPaths) {
      const visiblePath = visiblePathById.get(keptPath.id);

      if (visiblePath) {
        visiblePaths.push(visiblePath);
      }
    }

    if (visiblePaths.length > 0) {
      grouped.set(destinationCellId, visiblePaths);
    }
  }

  return grouped;
}

/** Merges grouped visible paths back into one list, de-duplicated by `pathId` and sorted ascending by id. */
export function flattenVisiblePortalPathGroups(
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
): readonly VisiblePortalPath[] {
  const visiblePathById = new Map<number, VisiblePortalPath>();

  for (const paths of visiblePathsByDestinationCell.values()) {
    for (const path of paths) {
      visiblePathById.set(path.pathId, path);
    }
  }

  return [...visiblePathById.values()].sort((left, right) => left.pathId - right.pathId);
}

/**
 * Removes depth > 0 paths that have no clip slot, so they get no instance at all instead of being drawn fully clipped.
 *
 * Slots cover the union of all eyes, so this never removes anything in practice; it returns `visiblePathsByDestinationCell`
 * itself (no allocation) when every path has a slot.
 */
export function omitPathsWithoutClipSlot(
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
  clipIndexByPathId: ReadonlyMap<number, number>,
): ReadonlyMap<string, readonly VisiblePortalPath[]> {
  let allHaveSlots = true;

  for (const paths of visiblePathsByDestinationCell.values()) {
    for (const path of paths) {
      if (path.depth > 0 && !clipIndexByPathId.has(path.pathId)) {
        allHaveSlots = false;
      }
    }
  }

  if (allHaveSlots) {
    return visiblePathsByDestinationCell;
  }

  const filtered = new Map<string, readonly VisiblePortalPath[]>();

  for (const [cellId, paths] of visiblePathsByDestinationCell) {
    const kept = paths.filter((path) => path.depth === 0 || clipIndexByPathId.has(path.pathId));

    if (kept.length > 0) {
      filtered.set(cellId, kept);
    }
  }

  return filtered;
}

/**
 * Writes instance matrices and clip attributes for every cell archetype from the visible paths of its cell.
 *
 * For archetype instance i: matrix = path.rootFromDestinationMatrix, `portalPathId` = path id, `portalClipIndex` =
 * -2 for depth 0 else `clipIndexByPathId.get(id) ?? -1`. Sets `mesh.count = min(paths, capacity)`, flags the GPU
 * buffers for upload, and records overflow in `diagnostics`. Allocation-free apart from the optional default map.
 *
 * With `options.separateRoot` a depth-0 path is not written as an instance: it is drawn by the archetype's unpatched
 * `rootMesh` (shown with the path's matrix), so the unclipped root keeps early depth rejection even when clipping
 * uses a fragment `discard`. Archetypes without a depth-0 path hide `rootMesh`.
 */
export function updateCellRenderArchetypeInstances(
  archetypes: readonly CellRenderArchetype[],
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
  diagnostics: PortalInstanceDiagnostics,
  clipIndexByPathId: ReadonlyMap<number, number> = new Map(),
  options: { readonly separateRoot: boolean } = { separateRoot: false },
): void {
  for (const archetype of archetypes) {
    const paths = visiblePathsByDestinationCell.get(archetype.cellId) ?? [];
    let requestedCount = 0;
    let count = 0;
    let rootPath: VisiblePortalPath | undefined;

    changes.matrix = false;
    changes.pathId = false;
    changes.clipIndex = false;

    for (const path of paths) {
      if (options.separateRoot && path.depth === 0) {
        rootPath ??= path;
        continue;
      }

      requestedCount += 1;

      if (count >= archetype.capacity) {
        continue;
      }

      writeInstanceIfChanged(
        archetype,
        count,
        path.rootFromDestinationMatrix,
        path.pathId,
        path.depth === 0 ? unclippedPortalClipIndex : clipIndexByPathId.get(path.pathId) ?? -1,
      );
      count += 1;
    }

    archetype.mesh.count = count;
    archetype.mesh.visible = count > 0;
    flagChangedBuffers(archetype, count);

    if (rootPath) {
      archetype.rootMesh.visible = true;
      archetype.rootMesh.matrix.copy(rootPath.rootFromDestinationMatrix);
      archetype.rootMesh.matrixWorldNeedsUpdate = true;
    } else {
      archetype.rootMesh.visible = false;
    }

    if (requestedCount > archetype.capacity) {
      diagnostics.recordCapacityOverflow(archetype, requestedCount);
    }
  }
}

/**
 * Writes instances for runtime objects (flags, markers, creatures...) once per visible path of the cell containing each record.
 *
 * Each instance matrix is `path.rootFromDestinationMatrix * record.localMatrix` (object frame -> cell frame ->
 * root frame, all in Three axes). Records with `omitRootVisiblePath` skip the depth-0 path, and records with
 * `suppressWithinCameraDistanceMeters` are skipped when their root-frame position lies closer than that distance
 * (meters) to any of `options.cameraPositions` (root Three frame), which hides objects around the viewer's own head.
 * Instances of one object that land on the same place in the root frame (same translation and first column, rounded
 * to 1e-4) are written once, from the path with the smallest depth (ties: first), so a real object and its ghost do
 * not z-fight. Overflow is counted by requested (not stored) instances.
 */
export function updateRuntimeObjectRenderArchetypeInstances(
  archetypes: readonly RuntimeObjectRenderArchetype[],
  recordsByArchetypeKey: ReadonlyMap<string, readonly RuntimeObjectRenderRecord[]>,
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
  diagnostics: RuntimeObjectRenderArchetypeDiagnostics,
  clipIndexByPathId: ReadonlyMap<number, number> = new Map(),
  options: {
    readonly cameraPositions?: readonly THREE.Vector3[];
  } = {},
): void {
  const composedMatrix = composedMatrixScratch;
  const composedPosition = composedPositionScratch;
  const lowestDepthByPlacement = lowestDepthByPlacementScratch;
  const writtenPlacements = writtenPlacementsScratch;

  for (const archetype of archetypes) {
    const records = recordsByArchetypeKey.get(archetype.archetypeKey) ?? [];
    let requestedCount = 0;
    let count = 0;

    // Pass 1: the lowest path depth per placement. A real object and a ghost that land on the same place in the
    // root frame are drawn once, by the copy with the loosest clip (depth 0 is unclipped).
    lowestDepthByPlacement.clear();
    writtenPlacements.clear();
    for (const record of records) {
      const paths = visiblePathsByDestinationCell.get(record.cellId) ?? [];

      for (const path of paths) {
        if (record.omitRootVisiblePath && path.depth === 0) {
          continue;
        }

        composedMatrix.multiplyMatrices(path.rootFromDestinationMatrix, record.localMatrix);
        if (isRuntimeObjectRecordSuppressedNearCamera(record, composedMatrix, composedPosition, options.cameraPositions)) {
          continue;
        }

        const key = runtimeObjectPlacementKey(record.objectId, composedMatrix);
        const lowest = lowestDepthByPlacement.get(key);
        if (lowest === undefined || path.depth < lowest) {
          lowestDepthByPlacement.set(key, path.depth);
        }
      }
    }

    changes.matrix = false;
    changes.pathId = false;
    changes.clipIndex = false;

    for (const record of records) {
      const paths = visiblePathsByDestinationCell.get(record.cellId) ?? [];

      for (const path of paths) {
        if (record.omitRootVisiblePath && path.depth === 0) {
          continue;
        }

        composedMatrix.multiplyMatrices(path.rootFromDestinationMatrix, record.localMatrix);
        if (isRuntimeObjectRecordSuppressedNearCamera(record, composedMatrix, composedPosition, options.cameraPositions)) {
          continue;
        }

        const key = runtimeObjectPlacementKey(record.objectId, composedMatrix);
        if (path.depth !== lowestDepthByPlacement.get(key) || writtenPlacements.has(key)) {
          continue;
        }
        writtenPlacements.add(key);

        requestedCount += 1;

        if (count >= archetype.capacity) {
          continue;
        }

        writeInstanceIfChanged(
          archetype,
          count,
          composedMatrix,
          path.pathId,
          path.depth === 0 ? unclippedPortalClipIndex : clipIndexByPathId.get(path.pathId) ?? -1,
        );
        count += 1;
      }
    }

    archetype.mesh.count = count;
    archetype.mesh.visible = count > 0;
    flagChangedBuffers(archetype, count);

    if (requestedCount > archetype.capacity) {
      diagnostics.recordCapacityOverflow(archetype, requestedCount);
    }
  }
}

// Which of an archetype's three buffers received a different value in the current update (reset per archetype).
const changes = { matrix: false, pathId: false, clipIndex: false };

interface InstancedArchetypeBuffers {
  readonly mesh: THREE.InstancedMesh;
  readonly portalPathIdAttribute: THREE.InstancedBufferAttribute;
  readonly portalClipIndexAttribute: THREE.InstancedBufferAttribute;
}

// Writes one instance, touching a buffer (and recording the change) only when a value differs. The buffers are
// Float32Arrays, so values are compared after Math.fround.
function writeInstanceIfChanged(
  archetype: InstancedArchetypeBuffers,
  index: number,
  matrix: THREE.Matrix4,
  pathId: number,
  clipIndex: number,
): void {
  const matrixArray = archetype.mesh.instanceMatrix.array;
  const base = 16 * index;
  const elements = matrix.elements;

  for (let k = 0; k < 16; k += 1) {
    if (matrixArray[base + k] !== Math.fround(elements[k])) {
      matrix.toArray(matrixArray, base);
      changes.matrix = true;
      break;
    }
  }

  if (archetype.portalPathIdAttribute.getX(index) !== Math.fround(pathId)) {
    archetype.portalPathIdAttribute.setX(index, pathId);
    changes.pathId = true;
  }

  if (archetype.portalClipIndexAttribute.getX(index) !== Math.fround(clipIndex)) {
    archetype.portalClipIndexAttribute.setX(index, clipIndex);
    changes.clipIndex = true;
  }
}

// Schedules an upload of the written prefix for each buffer that changed. Pending ranges (not yet uploaded because
// no draw happened in between) are merged into one range from 0 so no earlier change is lost.
function flagChangedBuffers(archetype: InstancedArchetypeBuffers, count: number): void {
  if (changes.matrix) {
    flagUploadPrefix(archetype.mesh.instanceMatrix, count * 16);
  }
  if (changes.pathId) {
    flagUploadPrefix(archetype.portalPathIdAttribute, count);
  }
  if (changes.clipIndex) {
    flagUploadPrefix(archetype.portalClipIndexAttribute, count);
  }
}

function flagUploadPrefix(attribute: THREE.BufferAttribute, elementCount: number): void {
  const ranges = attribute.updateRanges;

  if (ranges.length === 1 && ranges[0].start === 0) {
    ranges[0].count = Math.max(ranges[0].count, elementCount);
  } else {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, elementCount);
  }

  attribute.needsUpdate = true;
}

// Scratch for updateRuntimeObjectRenderArchetypeInstances; cleared or fully overwritten before each use.
const composedMatrixScratch = new THREE.Matrix4();
const composedPositionScratch = new THREE.Vector3();
const lowestDepthByPlacementScratch = new Map<string, number>();
const writtenPlacementsScratch = new Set<string>();

// Placement identity of an instance: object id, translation and first column of the composed matrix, rounded to 1e-4.
function runtimeObjectPlacementKey(objectId: string, matrix: THREE.Matrix4): string {
  const e = matrix.elements;
  const r = (value: number): number => Math.round(value * 1e4);

  return `${objectId}|${r(e[12])},${r(e[13])},${r(e[14])}|${r(e[0])},${r(e[1])},${r(e[2])}`;
}

// Uses the translation column of the composed matrix as the object origin; squared distances avoid sqrt.
function isRuntimeObjectRecordSuppressedNearCamera(
  record: RuntimeObjectRenderRecord,
  rootMatrix: THREE.Matrix4,
  scratchPosition: THREE.Vector3,
  cameraPositions: readonly THREE.Vector3[] | undefined,
): boolean {
  const distanceMeters = record.suppressWithinCameraDistanceMeters;
  if (distanceMeters === undefined || distanceMeters <= 0 || !cameraPositions || cameraPositions.length === 0) {
    return false;
  }

  scratchPosition.setFromMatrixPosition(rootMatrix);
  const distanceSquared = distanceMeters * distanceMeters;
  return cameraPositions.some((cameraPosition) => scratchPosition.distanceToSquared(cameraPosition) < distanceSquared);
}

/** Assembles a `PortalInstanceRenderDebugState` from the archetypes' current counts, overflow diagnostics and optional clip-data statistics. */
export function createPortalInstanceRenderDebugState(
  archetypes: readonly CellRenderArchetype[],
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
  diagnostics: PortalInstanceDiagnostics,
  options: {
    readonly enabled: boolean;
    readonly showCellPathRendersInstances: boolean;
    readonly normalVisiblePathRenderingActive?: boolean;
    readonly visiblePaths?: readonly VisiblePortalPath[];
    readonly visiblePathOverflowCount?: number;
    readonly portalClipMode?: "hardware" | "fragment";
  },
): PortalInstanceRenderDebugState {
  const totalCapacity = archetypes.reduce((sum, archetype) => sum + archetype.capacity, 0);
  // The unclipped root drawn by an archetype's `rootMesh` counts as one rendered instance.
  const drawnCount = (archetype: CellRenderArchetype): number => archetype.mesh.count + (archetype.rootMesh.visible ? 1 : 0);
  const renderedInstanceCount = archetypes.reduce((sum, archetype) => sum + drawnCount(archetype), 0);
  const countsByCell = new Map<string, number>();

  for (const archetype of archetypes) {
    countsByCell.set(archetype.cellId, (countsByCell.get(archetype.cellId) ?? 0) + drawnCount(archetype));
  }

  for (const [cellId, paths] of visiblePathsByDestinationCell) {
    if (countsByCell.has(cellId)) {
      continue;
    }

    countsByCell.set(cellId, paths.length);
  }

  return {
    enabled: options.enabled,
    ShowCellPathRendersInstances: options.showCellPathRendersInstances,
    archetypeCount: archetypes.length,
    totalCapacity,
    renderedInstanceCount,
    renderedInstanceCountByCell: [...countsByCell.entries()]
      .filter(([, count]) => count > 0)
      .map(([cellId, count]) => ({ cellId, count }))
      .sort((left, right) => left.cellId.localeCompare(right.cellId)),
    capacityOverflowCount: diagnostics.capacityOverflowCount,
    capacityOverflowArchetypes: diagnostics.capacityOverflowArchetypes,
    normalVisiblePathRenderingActive: options.normalVisiblePathRenderingActive ?? false,
    visiblePathIds: (options.visiblePaths ?? []).map((path) => path.pathId),
    visiblePathDestinations: (options.visiblePaths ?? []).map((path) => ({
      pathId: path.pathId,
      destinationCellId: path.destinationCellId,
    })),
    visiblePathOverflowCount: options.visiblePathOverflowCount ?? 0,
    portalClipMode: options.portalClipMode ?? "fragment",
  };
}

/** Projects a visibility debug summary onto the counters stored in render state (drops the root cell id). */
export function visiblePortalSummaryToRenderState(summary: VisiblePortalPathDebugSummary) {
  return {
    candidatePathCount: summary.candidatePathCount,
    keptPathCount: summary.keptPathCount,
    visiblePathCount: summary.visiblePathCount,
    visiblePathCountByDepth: summary.visiblePathCountByDepth,
    maxVisibleDepth: summary.maxVisibleDepth,
    clippedByCameraCount: summary.clippedByCameraCount,
    clippedByFunnelCount: summary.clippedByFunnelCount,
    terminalByAreaCount: summary.terminalByAreaCount,
    examinedPathCount: summary.examinedPathCount,
    clippedByBudgetCount: summary.clippedByBudgetCount,
    budgetExhausted: summary.budgetExhausted,
  };
}
