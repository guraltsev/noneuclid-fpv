/**
 * Portal-path tables: for each root cell, every portal word (sequence of portals crossed) up to a depth limit, with the rigid transforms that place the destination cell in the root cell's frame.
 * Paths are generated breadth-first from the root, so a parent always precedes its children and ids equal array indices (root path id 0). Each path stores destinationFromRoot, mapping root-cell-local coordinates to destination-cell-local ones, built as compose(portal.transformToTarget, parent.destinationFromRoot) so the newest portal is applied last, and its inverse rootFromDestination, which places destination geometry in the root frame (this is what a renderer needs to draw the destination as seen through the portal word). The number of paths can grow like branching^depth, which is why a static culling pass (staticPortalPathCull) exists. By default a portal that immediately undoes the previous step (its reciprocal) is skipped, since the net transform would be the identity and the path would only revisit the previous cell.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import type { CompiledPortal } from "./specs";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  type RigidTransform3,
} from "../math/rigidTransform3";

/**
 * Options for {@link buildPortalPathTables}.
 */
export interface BuildPortalPathTablesOptions {
  /**
   * Maximum number of portals in a word; 0 yields only the root path. Must be a non-negative integer.
   */
  readonly maxDepth: number;
  /**
   * If true (default), do not extend a path by the portal that is the reciprocal of its last step.
   */
  readonly skipImmediateReverse?: boolean;
}

/**
 * Path tables for all root cells, keyed by root cell id, with the depth limit they were built for.
 */
export interface PortalPathTablesByRootCell {
  readonly maxDepth: number;
  readonly tablesByRootCellId: ReadonlyMap<string, PortalPathTable>;
}

/**
 * All portal paths from one root cell, with indexes by id, destination cell and parent path.
 */
export interface PortalPathTable {
  readonly rootCellId: string;
  readonly maxDepth: number;
  /**
   * All paths including the depth-0 root path; in tables built here, ordered breadth-first (parents before children).
   */
  readonly paths: readonly PortalRenderPath[];
  readonly pathsById: ReadonlyMap<number, PortalRenderPath>;
  /**
   * Paths grouped by the cell they end in (the root path is listed under the root cell).
   */
  readonly pathsByDestinationCellId: ReadonlyMap<string, readonly PortalRenderPath[]>;
  /**
   * Direct children of each path, keyed by the parent's id; paths without children have no entry.
   */
  readonly pathsByParentPathId: ReadonlyMap<number, readonly PortalRenderPath[]>;
}

/**
 * One portal word starting at `rootCellId`, with the transforms relating the root and destination frames.
 */
export interface PortalRenderPath {
  /**
   * Identifier unique within one root cell's table; equals the array index in tables from {@link buildPortalPathTables}, but may be sparse in culled tables.
   */
  readonly id: number;
  readonly rootCellId: string;
  readonly destinationCellId: string;
  /**
   * Number of portals crossed (steps.length); 0 for the root path.
   */
  readonly depth: number;
  /**
   * Id of the path obtained by dropping the last step; absent for the root path.
   */
  readonly parentPathId?: number;
  /**
   * The portals crossed, in order from the root cell outward.
   */
  readonly steps: readonly PortalRenderStep[];
  /**
   * Rigid transform taking points in the root cell's local frame to the destination cell's local frame (the successive portal transforms composed, first portal applied first).
   */
  readonly destinationFromRoot: RigidTransform3;
  /**
   * Inverse of destinationFromRoot: places destination-cell geometry in the root cell's frame.
   */
  readonly rootFromDestination: RigidTransform3;
}

/**
 * One portal crossing: leaving `sourceCellId` through `sourcePortalId` and arriving in `targetCellId` at `targetPortalId`.
 */
export interface PortalRenderStep {
  readonly sourceCellId: string;
  readonly sourcePortalId: string;
  readonly sourcePortalSideIndex: number;
  readonly targetCellId: string;
  readonly targetPortalId: string;
}

/**
 * Builds the complete (unculled) portal-path table for every cell as a root, up to options.maxDepth.
 * @throws Error if maxDepth is not a non-negative integer or a path reaches a cell missing from the world. Cost is proportional to the total number of paths generated, which can be exponential in maxDepth.
 */
export function buildPortalPathTables(
  world: CompiledCellComplex,
  options: BuildPortalPathTablesOptions,
): PortalPathTablesByRootCell {
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0) {
    throw new Error(`Portal path maxDepth must be a non-negative integer; received ${options.maxDepth}.`);
  }

  const skipImmediateReverse = options.skipImmediateReverse ?? true;
  const tablesByRootCellId = new Map(
    world.cells.map((cell) => [
      cell.id,
      buildPortalPathTableForRoot(world, cell.id, options.maxDepth, skipImmediateReverse),
    ]),
  );

  return {
    maxDepth: options.maxDepth,
    tablesByRootCellId,
  };
}

/**
 * Wraps a list of paths in a {@link PortalPathTable}, building the id, destination-cell and parent indexes.
 * Does not validate that the paths are consistent with each other or with a world.
 */
export function createPortalPathTable(
  rootCellId: string,
  maxDepth: number,
  paths: readonly PortalRenderPath[],
): PortalPathTable {
  const pathsById = new Map(paths.map((path) => [path.id, path]));
  const pathsByDestinationCellId = new Map<string, PortalRenderPath[]>();
  const pathsByParentPathId = new Map<number, PortalRenderPath[]>();

  for (const path of paths) {
    pushMapValue(pathsByDestinationCellId, path.destinationCellId, path);

    if (path.parentPathId !== undefined) {
      pushMapValue(pathsByParentPathId, path.parentPathId, path);
    }
  }

  return {
    rootCellId,
    maxDepth,
    paths,
    pathsById,
    pathsByDestinationCellId,
    pathsByParentPathId,
  };
}

/**
 * Breadth-first expansion of portal words from one root; each child extends its parent by one portal of the parent's destination cell.
 */
function buildPortalPathTableForRoot(
  world: CompiledCellComplex,
  rootCellId: string,
  maxDepth: number,
  skipImmediateReverse: boolean,
): PortalPathTable {
  const rootPath: PortalRenderPath = {
    id: 0,
    rootCellId,
    destinationCellId: rootCellId,
    depth: 0,
    steps: [],
    destinationFromRoot: identityRigidTransform3,
    rootFromDestination: identityRigidTransform3,
  };
  const paths: PortalRenderPath[] = [rootPath];
  const queue: PortalRenderPath[] = [rootPath];

  while (queue.length > 0) {
    const parent = queue.shift()!;

    if (parent.depth >= maxDepth) {
      continue;
    }

    const sourceCell = world.cellsById.get(parent.destinationCellId);

    if (!sourceCell) {
      throw new Error(`Portal path reached missing cell "${parent.destinationCellId}".`);
    }

    for (const portal of sourceCell.portals) {
      if (skipImmediateReverse && isImmediateReverse(parent, portal)) {
        continue;
      }

      // Apply the parent's map first, then this portal's gluing map.
      const destinationFromRoot = composeRigidTransform3(portal.transformToTarget, parent.destinationFromRoot);
      const child: PortalRenderPath = {
        id: paths.length,
        rootCellId,
        destinationCellId: portal.targetCellId,
        depth: parent.depth + 1,
        parentPathId: parent.id,
        steps: [
          ...parent.steps,
          {
            sourceCellId: sourceCell.id,
            sourcePortalId: portal.id,
            sourcePortalSideIndex: portal.sideIndex,
            targetCellId: portal.targetCellId,
            targetPortalId: portal.targetPortalId,
          },
        ],
        destinationFromRoot,
        rootFromDestination: invertRigidTransform3(destinationFromRoot),
      };

      paths.push(child);
      queue.push(child);
    }
  }

  return createPortalPathTable(rootCellId, maxDepth, paths);
}

/**
 * True if `portal` is the reciprocal of the parent's last step, i.e. it leads straight back through the portal just entered.
 */
function isImmediateReverse(parent: PortalRenderPath, portal: CompiledPortal): boolean {
  const previousStep = parent.steps[parent.steps.length - 1];

  if (!previousStep) {
    return false;
  }

  return (
    parent.destinationCellId === previousStep.targetCellId &&
    portal.id === previousStep.targetPortalId &&
    portal.targetCellId === previousStep.sourceCellId &&
    portal.reciprocalPortalId === previousStep.sourcePortalId
  );
}

function pushMapValue<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey, value: TValue): void {
  const current = map.get(key);

  if (current) {
    current.push(value);
    return;
  }

  map.set(key, [value]);
}
