/**
 * Fills the per-frame instance buffers that draw each visible portal path as an instance of its destination cell.
 *
 * Each cell (and each runtime-object type) has an instanced-mesh "archetype" with a fixed capacity. For every
 * `VisiblePortalPath` (see `visiblePortalPaths`) one instance is written whose matrix is the path's
 * `rootFromDestinationMatrix`, i.e. the rigid transform placing the destination cell in the ROOT cell's Three.js
 * frame; runtime objects use `rootFromDestination * record.localMatrix` (three.js `multiplyMatrices(a, b)` = a*b,
 * so the object's cell-local matrix is applied first). Two per-instance attributes accompany the matrix:
 * `portalPathId` and `portalClipIndex`, the row of the clip-polygon texture (`portalClipData`) that the fragment
 * shader (`portalClipMaterial`) uses to discard fragments outside the path's NDC polygon.
 *
 * Clip-index sentinels: `unclippedPortalClipIndex` (-2) marks the root instance (never clipped); -1 marks a path
 * that has no clip slot (budget or vertex-count overflow) and is therefore fully discarded. Instances beyond an
 * archetype's capacity are dropped and recorded in `PortalInstanceDiagnostics`. This module also builds the debug
 * state shown by the overlay. All work is CPU-side, linear in the number of visible paths per frame.
 */

import * as THREE from "three";
import type { PortalRenderPath } from "../../cell-complex/portalPaths";
import type { CellRenderArchetype } from "./cellRenderArchetypes";
import type {
  RuntimeObjectRenderArchetype,
  RuntimeObjectRenderArchetypeDiagnostics,
} from "./runtimeObjectRenderArchetypes";
import type { RuntimeObjectRenderRecord } from "./runtimeObjectRenderRecords";
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
  readonly clipPolygonVertexCountsByPath: readonly {
    readonly pathId: number;
    readonly vertexCount: number;
  }[];
  /** Paths hidden because their clip polygon had more vertices than the clip texture holds. */
  readonly clipPolygonOverflowPathIds: readonly number[];
  /** Visible paths that did not fit in the clip texture's rows. */
  readonly visiblePathOverflowCount: number;
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
 * Writes instance matrices and clip attributes for every cell archetype from the visible paths of its cell.
 *
 * For archetype instance i: matrix = path.rootFromDestinationMatrix, `portalPathId` = path id, `portalClipIndex` =
 * -2 for depth 0 else `clipIndexByPathId.get(id) ?? -1`. Sets `mesh.count = min(paths, capacity)`, flags the GPU
 * buffers for upload, and records overflow in `diagnostics`. Allocation-free apart from the optional default map.
 */
export function updateCellRenderArchetypeInstances(
  archetypes: readonly CellRenderArchetype[],
  visiblePathsByDestinationCell: ReadonlyMap<string, readonly VisiblePortalPath[]>,
  diagnostics: PortalInstanceDiagnostics,
  clipIndexByPathId: ReadonlyMap<number, number> = new Map(),
): void {
  for (const archetype of archetypes) {
    const paths = visiblePathsByDestinationCell.get(archetype.cellId) ?? [];
    const count = Math.min(paths.length, archetype.capacity);

    for (let index = 0; index < count; index += 1) {
      const path = paths[index];
      archetype.mesh.setMatrixAt(index, path.rootFromDestinationMatrix);
      archetype.portalPathIdAttribute.setX(index, path.pathId);
      archetype.portalClipIndexAttribute.setX(
        index,
        path.depth === 0 ? unclippedPortalClipIndex : clipIndexByPathId.get(path.pathId) ?? -1,
      );
    }

    archetype.mesh.count = count;
    archetype.mesh.instanceMatrix.needsUpdate = true;
    archetype.portalPathIdAttribute.needsUpdate = true;
    archetype.portalClipIndexAttribute.needsUpdate = true;

    if (paths.length > archetype.capacity) {
      diagnostics.recordCapacityOverflow(archetype, paths.length);
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

        archetype.mesh.setMatrixAt(count, composedMatrix);
        archetype.portalPathIdAttribute.setX(count, path.pathId);
        archetype.portalClipIndexAttribute.setX(
          count,
          path.depth === 0 ? unclippedPortalClipIndex : clipIndexByPathId.get(path.pathId) ?? -1,
        );
        count += 1;
      }
    }

    archetype.mesh.count = count;
    archetype.mesh.instanceMatrix.needsUpdate = true;
    archetype.portalPathIdAttribute.needsUpdate = true;
    archetype.portalClipIndexAttribute.needsUpdate = true;

    if (requestedCount > archetype.capacity) {
      diagnostics.recordCapacityOverflow(archetype, requestedCount);
    }
  }
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
    readonly clipPolygonVertexCountsByPathId?: ReadonlyMap<number, number>;
    readonly clipPolygonOverflowPathIds?: readonly number[];
    readonly visiblePathOverflowCount?: number;
  },
): PortalInstanceRenderDebugState {
  const totalCapacity = archetypes.reduce((sum, archetype) => sum + archetype.capacity, 0);
  const renderedInstanceCount = archetypes.reduce((sum, archetype) => sum + archetype.mesh.count, 0);
  const countsByCell = new Map<string, number>();

  for (const archetype of archetypes) {
    countsByCell.set(archetype.cellId, (countsByCell.get(archetype.cellId) ?? 0) + archetype.mesh.count);
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
    clipPolygonVertexCountsByPath: [...(options.clipPolygonVertexCountsByPathId ?? new Map()).entries()]
      .map(([pathId, vertexCount]) => ({ pathId, vertexCount }))
      .sort((left, right) => left.pathId - right.pathId),
    clipPolygonOverflowPathIds: options.clipPolygonOverflowPathIds ?? [],
    visiblePathOverflowCount: options.visiblePathOverflowCount ?? 0,
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
    clippedByAreaCount: summary.clippedByAreaCount,
    clippedByBudgetCount: summary.clippedByBudgetCount,
    budgetExhausted: summary.budgetExhausted,
  };
}
