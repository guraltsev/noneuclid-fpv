/**
 * Static, view-independent culling of portal-path tables: discards portal words through which no sight line from the root cell could cross the portals in order.
 * A word is kept iff some oriented plan-view line crosses its portals in order, each in the forward sense. Each portal is developed into the root cell's plan (newestPortalInRoot) and contributes two linear constraints on the homogeneous line (a, b, c); the set of admissible lines is a convex cone, updated in O(|cone|) per child by clipping the parent's cone (see staticLineCone). A word is rejected ("no-static-line-transversal") when its cone is empty or its Crofton measure is below staticLineConeMinMeasureMeters. Tolerances only enlarge the cone: each portal is lengthened by toleranceMeters at both ends. Heights are ignored (the plan test is necessary, so this is conservative). An optional per-root cap on kept paths ("static-path-budget") is spent best-first by the Crofton measure of each word's cone, so the words dropped are those with the fewest sight lines in every direction.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import { developPortalSegment, type OrientedPortalSegment } from "./orientedPortal";
import {
  createPortalPathTable,
  type PortalPathTable,
  type PortalPathTablesByRootCell,
  type PortalRenderPath,
  type PortalRenderStep,
} from "./portalPaths";
import type { CompiledPortal } from "./specs";
import {
  clipLineConeByPortal,
  lineConeForTwoPortals,
  lineConeMeasure,
  staticLineConeMinMeasureMeters,
  type LineCone,
} from "./staticLineCone";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
} from "../math/rigidTransform3";

/**
 * Tuning for static path culling.
 */
export interface StaticPortalPathCullOptions {
  /**
   * Non-negative absolute tolerance in meters: each developed portal segment is lengthened by this at both ends before its constraints are formed, which only enlarges the set of admissible lines.
   */
  readonly toleranceMeters: number;
  /**
   * Cap on kept paths per root, counting the root path; paths beyond it are rejected as "static-path-budget". Unlimited if absent.
   */
  readonly maxKeptPathsPerRoot?: number;
  /**
   * If true, rejected-path records carry a human-readable `details` string; otherwise only id and reason are stored.
   */
  readonly keepRejectedPathDetails?: boolean;
}

/**
 * Options for {@link buildStaticallyCulledPortalPathTables}: the culling options plus the path-generation limits and a progress callback.
 */
export interface BuildStaticallyCulledPortalPathTablesOptions extends StaticPortalPathCullOptions {
  readonly maxDepth: number;
  readonly skipImmediateReverse?: boolean;
  /**
   * Called once per root cell when its expansion is finished.
   */
  readonly onRootComplete?: (status: StaticPortalPathRootStatus) => void;
}

/**
 * Progress report for one root cell after the culled expansion finished.
 */
export interface StaticPortalPathRootStatus {
  readonly rootCellId: string;
  /**
   * Kept paths, including the root path.
   */
  readonly keptPathCount: number;
  readonly rejectedPathCount: number;
  /**
   * Kept paths per depth; the index is the depth.
   */
  readonly keptPathCountByDepth: readonly number[];
  /**
   * True if maxKeptPathsPerRoot was reached and feasible words were cut.
   */
  readonly budgetExhausted: boolean;
}

/**
 * Culled tables and per-root summaries produced by static culling.
 */
export interface StaticPortalPathCullResult {
  readonly tables: PortalPathTablesByRootCell;
  readonly summariesByRootCellId: ReadonlyMap<string, StaticPortalPathCullSummary>;
}

/**
 * Per-root statistics of a culling run.
 */
export interface StaticPortalPathCullSummary {
  readonly rootCellId: string;
  /**
   * Number of candidate paths examined. For staticallyCullPortalPathTables this is the size of the input table; for buildStaticallyCulledPortalPathTables it is kept plus rejected, which excludes descendants of rejected paths because those are never generated.
   */
  readonly inputPathCount: number;
  readonly keptPathCount: number;
  readonly rejectedPathCount: number;
  readonly rejectedByReason: ReadonlyMap<StaticPortalPathRejectReason, number>;
  /**
   * One record per rejected path; `details` is present only if keepRejectedPathDetails was set.
   */
  readonly rejectedPaths: readonly RejectedPortalRenderPath[];
}

/**
 * Why a path was removed. "no-static-line-transversal": no oriented plan-view line crosses the word's portals in order (empty line cone, or cone measure below staticLineConeMinMeasureMeters). "static-path-budget": maxKeptPathsPerRoot was exhausted.
 */
export type StaticPortalPathRejectReason = "no-static-line-transversal" | "static-path-budget";

/**
 * Record of one rejected path: its id, the rejection reason and optional explanatory text.
 */
export interface RejectedPortalRenderPath {
  readonly pathId: number;
  readonly reason: StaticPortalPathRejectReason;
  readonly details?: string;
}

/**
 * One candidate word waiting in the best-first queue.
 */
interface QueueEntry {
  readonly path: PortalRenderPath;
  readonly cone: LineCone | undefined;
  readonly measure: number;
  readonly seq: number;
}

/**
 * Generates portal-path tables while culling by oriented line cones, so descendants of rejected paths are never created.
 * Words are expanded best-first by the Crofton measure of their cone (largest set of sight lines first); parents are popped before their children because the measure never increases down a word, so `paths` lists parents first but is not ordered by depth. Path ids are assigned to every candidate child when it is created, so kept paths have sparse ids that do not match those of an unculled table built separately. When the budget is reached, the candidate being popped and every candidate still queued are rejected as "static-path-budget" (one record each) and the root is finished. Children are cone-tested when they are pushed, so a budget rejection always means feasible but cut. The depth-0 root path is always kept; every other kept path carries newestPortalInRoot. Cones live only during the build.
 * @throws Error if maxDepth is not a non-negative integer, toleranceMeters is negative, or a path reaches a missing cell or portal.
 */
export function buildStaticallyCulledPortalPathTables(
  world: CompiledCellComplex,
  options: BuildStaticallyCulledPortalPathTablesOptions,
): StaticPortalPathCullResult {
  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0) {
    throw new Error(`Portal path maxDepth must be a non-negative integer; received ${options.maxDepth}.`);
  }

  if (options.toleranceMeters < 0) {
    throw new Error(`Static portal path cull tolerance must be non-negative; received ${options.toleranceMeters}.`);
  }

  const tablesByRootCellId = new Map<string, PortalPathTable>();
  const summariesByRootCellId = new Map<string, StaticPortalPathCullSummary>();
  const skipImmediateReverse = options.skipImmediateReverse ?? true;
  const budget = options.maxKeptPathsPerRoot ?? Number.POSITIVE_INFINITY;

  for (const rootCell of world.cells) {
    const rootPath: PortalRenderPath = {
      id: 0,
      rootCellId: rootCell.id,
      destinationCellId: rootCell.id,
      depth: 0,
      steps: [],
      destinationFromRoot: identityRigidTransform3,
      rootFromDestination: identityRigidTransform3,
    };
    const keptPaths: PortalRenderPath[] = [];
    const keptPathCountByDepth: number[] = [];
    const rejectedPaths: RejectedPortalRenderPath[] = [];
    const rejectedByReason = new Map<StaticPortalPathRejectReason, number>();
    const queue = new MaxQueue();
    let nextPathId = 1;
    let nextSeq = 1;
    let budgetExhausted = false;
    const reject = (rejection: RejectedPortalRenderPath): void => {
      rejectedPaths.push(rejection);
      rejectedByReason.set(rejection.reason, (rejectedByReason.get(rejection.reason) ?? 0) + 1);
    };

    queue.push({ path: rootPath, cone: undefined, measure: Number.POSITIVE_INFINITY, seq: 0 });

    for (let entry = queue.popMax(); entry; entry = queue.popMax()) {
      const { path } = entry;

      // The root path is exempt from the budget.
      if (path.depth > 0 && keptPaths.length >= budget) {
        budgetExhausted = true;
        reject(createRejection(path.id, "static-path-budget", options.keepRejectedPathDetails));

        for (let rest = queue.popMax(); rest; rest = queue.popMax()) {
          reject(createRejection(rest.path.id, "static-path-budget", options.keepRejectedPathDetails));
        }

        break;
      }

      keptPaths.push(path);
      keptPathCountByDepth[path.depth] = (keptPathCountByDepth[path.depth] ?? 0) + 1;

      if (path.depth >= options.maxDepth) {
        continue;
      }

      const sourceCell = world.cellsById.get(path.destinationCellId);

      if (!sourceCell) {
        throw new Error(`Portal path reached missing cell "${path.destinationCellId}".`);
      }

      for (const portal of sourceCell.portals) {
        if (skipImmediateReverse && isImmediateReverse(path, portal)) {
          continue;
        }

        const destinationFromRoot = composeRigidTransform3(portal.transformToTarget, path.destinationFromRoot);
        const child: PortalRenderPath = {
          id: nextPathId,
          rootCellId: rootCell.id,
          destinationCellId: portal.targetCellId,
          depth: path.depth + 1,
          parentPathId: path.id,
          steps: [
            ...path.steps,
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
          newestPortalInRoot: developPortalSegment(world, sourceCell.id, portal.sideIndex, path.rootFromDestination),
        };

        nextPathId += 1;

        const result = testChild(child.depth, entry.cone, path.newestPortalInRoot, child.newestPortalInRoot!, options.toleranceMeters);

        if (!result) {
          reject(createLineTransversalRejection(child.id, options.keepRejectedPathDetails));
          continue;
        }

        queue.push({ path: child, cone: result.cone, measure: result.measure, seq: nextSeq });
        nextSeq += 1;
      }
    }

    tablesByRootCellId.set(rootCell.id, createPortalPathTable(rootCell.id, options.maxDepth, keptPaths));
    summariesByRootCellId.set(rootCell.id, {
      rootCellId: rootCell.id,
      inputPathCount: keptPaths.length + rejectedPaths.length,
      keptPathCount: keptPaths.length,
      rejectedPathCount: rejectedPaths.length,
      rejectedByReason,
      rejectedPaths: options.keepRejectedPathDetails ? rejectedPaths : rejectedPaths.map(stripRejectionDetails),
    });
    options.onRootComplete?.({
      rootCellId: rootCell.id,
      keptPathCount: keptPaths.length,
      rejectedPathCount: rejectedPaths.length,
      keptPathCountByDepth: Array.from(keptPathCountByDepth, (count) => count ?? 0),
      budgetExhausted,
    });
  }

  return {
    tables: {
      maxDepth: options.maxDepth,
      tablesByRootCellId,
    },
    summariesByRootCellId,
  };
}

/**
 * Filters existing portal-path tables, keeping each path only if its word passes the line-cone test, preserving the original path ids.
 * A path whose parent was not kept is rejected with the parent's reason, so every kept path's parent is also kept (kept tables are prefix-closed). The root path is always kept; the budget is applied in table order after the geometric tests. Paths without newestPortalInRoot (hand-built fixtures) are developed from the parent's transform.
 * @throws Error if toleranceMeters is negative, a root cell is unknown, or a path references a missing cell or portal.
 */
export function staticallyCullPortalPathTables(
  world: CompiledCellComplex,
  pathTables: PortalPathTablesByRootCell,
  options: StaticPortalPathCullOptions,
): StaticPortalPathCullResult {
  if (options.toleranceMeters < 0) {
    throw new Error(`Static portal path cull tolerance must be non-negative; received ${options.toleranceMeters}.`);
  }

  const tablesByRootCellId = new Map<string, PortalPathTable>();
  const summariesByRootCellId = new Map<string, StaticPortalPathCullSummary>();

  for (const [rootCellId, table] of pathTables.tablesByRootCellId) {
    if (!world.cellsById.has(rootCellId)) {
      throw new Error(`Static portal path culling received unknown root cell "${rootCellId}".`);
    }

    const keptPaths: PortalRenderPath[] = [];
    const rejectedPaths: RejectedPortalRenderPath[] = [];
    const rejectedByReason = new Map<StaticPortalPathRejectReason, number>();
    const budget = options.maxKeptPathsPerRoot ?? Number.POSITIVE_INFINITY;
    const keptPathIds = new Set<number>();
    const conesByPathId = new Map<number, LineCone>();
    const rejectionReasonByPathId = new Map<number, StaticPortalPathRejectReason>();

    for (const path of table.paths) {
      const parentRejectionReason =
        path.parentPathId !== undefined && !keptPathIds.has(path.parentPathId)
          ? rejectionReasonByPathId.get(path.parentPathId) ?? "static-path-budget"
          : undefined;
      let childResult: ChildTestResult | undefined;
      let geometricRejection: RejectedPortalRenderPath | undefined;

      if (path.depth === 0) {
        geometricRejection = undefined;
      } else if (parentRejectionReason) {
        geometricRejection = createInheritedRejection(
          path.id,
          path.parentPathId,
          parentRejectionReason,
          options.keepRejectedPathDetails,
        );
      } else {
        const portal = newestPortalOf(world, table, path);
        const parent = path.parentPathId === undefined ? undefined : table.pathsById.get(path.parentPathId);

        if (!portal) {
          throw new Error(`Static portal path culling cannot develop the newest portal of path ${path.id}.`);
        }

        childResult = testChild(
          path.depth,
          path.parentPathId === undefined ? undefined : conesByPathId.get(path.parentPathId),
          parent ? newestPortalOf(world, table, parent) : undefined,
          portal,
          options.toleranceMeters,
        );
        geometricRejection = childResult ? undefined : createLineTransversalRejection(path.id, options.keepRejectedPathDetails);
      }

      // The budget counts only paths that passed the geometric tests; the root path (depth 0) is exempt.
      const budgetRejection =
        path.depth > 0 && !geometricRejection && keptPaths.length >= budget
          ? createRejection(path.id, "static-path-budget", options.keepRejectedPathDetails)
          : undefined;
      const rejection = geometricRejection ?? budgetRejection;

      if (rejection) {
        rejectedPaths.push(rejection);
        rejectionReasonByPathId.set(path.id, rejection.reason);
        rejectedByReason.set(rejection.reason, (rejectedByReason.get(rejection.reason) ?? 0) + 1);
        continue;
      }

      keptPaths.push(path);
      keptPathIds.add(path.id);

      if (childResult?.cone) {
        conesByPathId.set(path.id, childResult.cone);
      }
    }

    tablesByRootCellId.set(rootCellId, createPortalPathTable(rootCellId, table.maxDepth, keptPaths));
    summariesByRootCellId.set(rootCellId, {
      rootCellId,
      inputPathCount: table.paths.length,
      keptPathCount: keptPaths.length,
      rejectedPathCount: rejectedPaths.length,
      rejectedByReason,
      rejectedPaths: options.keepRejectedPathDetails ? rejectedPaths : rejectedPaths.map(stripRejectionDetails),
    });
  }

  return {
    tables: {
      maxDepth: pathTables.maxDepth,
      tablesByRootCellId,
    },
    summariesByRootCellId,
  };
}

/**
 * Outcome of testing one child word: the cone of lines crossing it (absent at depth 1, which has none) and its Crofton measure.
 */
interface ChildTestResult {
  readonly cone: LineCone | undefined;
  readonly measure: number;
}

/**
 * Tests a child word of the given depth. Depth-1 words are never rejected and carry no cone (measure = all lines meeting the segment); depth 2 builds the cone from the two portals; deeper words clip the parent's cone by the newest portal. Returns undefined if the word is rejected (empty cone or measure below staticLineConeMinMeasureMeters).
 */
function testChild(
  depth: number,
  parentCone: LineCone | undefined,
  parentPortal: OrientedPortalSegment | undefined,
  portal: OrientedPortalSegment,
  wideningMeters: number,
): ChildTestResult | undefined {
  if (depth <= 1) {
    return { cone: undefined, measure: 2 * Math.hypot(portal.left.x - portal.right.x, portal.left.y - portal.right.y) };
  }

  const cone =
    depth === 2
      ? parentPortal
        ? lineConeForTwoPortals(parentPortal, portal, wideningMeters)
        : []
      : parentCone
      ? clipLineConeByPortal(parentCone, portal, wideningMeters)
      : [];
  const measure = lineConeMeasure(cone);

  if (cone.length === 0 || measure < staticLineConeMinMeasureMeters) {
    return undefined;
  }

  return { cone, measure };
}

/**
 * The newest portal of a table path developed into the root frame: the stored value, or computed from the parent's transform for hand-built paths.
 */
function newestPortalOf(world: CompiledCellComplex, table: PortalPathTable, path: PortalRenderPath): OrientedPortalSegment | undefined {
  if (path.newestPortalInRoot) {
    return path.newestPortalInRoot;
  }

  const parent = path.parentPathId === undefined ? undefined : table.pathsById.get(path.parentPathId);
  const step = path.steps[path.steps.length - 1];

  if (!parent || !step) {
    return undefined;
  }

  return developPortalSegment(world, step.sourceCellId, step.sourcePortalSideIndex, parent.rootFromDestination);
}

/**
 * True if `portal` leads straight back through the portal that `parent` just crossed (same rule as in portalPaths.ts).
 */
function isImmediateReverse(parent: PortalRenderPath, portal: CompiledPortal): boolean {
  const previousStep: PortalRenderStep | undefined = parent.steps[parent.steps.length - 1];

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

/**
 * Binary max-heap of queue entries, ordered by measure descending, then insertion sequence ascending.
 */
class MaxQueue {
  private readonly items: QueueEntry[] = [];

  push(entry: QueueEntry): void {
    const items = this.items;
    let index = items.length;

    items.push(entry);

    while (index > 0) {
      const parentIndex = (index - 1) >> 1;

      if (!isBefore(entry, items[parentIndex])) {
        break;
      }

      items[index] = items[parentIndex];
      index = parentIndex;
    }

    items[index] = entry;
  }

  popMax(): QueueEntry | undefined {
    const items = this.items;
    const top = items[0];

    if (top === undefined) {
      return undefined;
    }

    const last = items.pop()!;

    if (items.length === 0) {
      return top;
    }

    let index = 0;

    for (;;) {
      let child = 2 * index + 1;

      if (child >= items.length) {
        break;
      }

      if (child + 1 < items.length && isBefore(items[child + 1], items[child])) {
        child += 1;
      }

      if (!isBefore(items[child], last)) {
        break;
      }

      items[index] = items[child];
      index = child;
    }

    items[index] = last;
    return top;
  }
}

function isBefore(a: QueueEntry, b: QueueEntry): boolean {
  return a.measure > b.measure || (a.measure === b.measure && a.seq < b.seq);
}

/**
 * Builds a rejection record for a word with no oriented line crossing its portals in order.
 */
function createLineTransversalRejection(pathId: number, includeDetails: boolean | undefined): RejectedPortalRenderPath {
  return {
    pathId,
    reason: "no-static-line-transversal",
    ...(includeDetails ? { details: `Rejected path ${pathId}; no oriented line crosses its portals in order.` } : {}),
  };
}

/**
 * Builds a rejection record for the path budget.
 */
function createRejection(
  pathId: number,
  reason: StaticPortalPathRejectReason,
  includeDetails: boolean | undefined,
): RejectedPortalRenderPath {
  return {
    pathId,
    reason,
    ...(includeDetails ? { details: `Rejected path ${pathId} because the static path budget was exhausted.` } : {}),
  };
}

/**
 * Builds a rejection record for a path dropped because its parent path was rejected; it carries the parent's reason.
 */
function createInheritedRejection(
  pathId: number,
  parentPathId: number | undefined,
  reason: StaticPortalPathRejectReason,
  includeDetails: boolean | undefined,
): RejectedPortalRenderPath {
  return {
    pathId,
    reason,
    ...(includeDetails
      ? { details: `Rejected path ${pathId} because its parent path ${parentPathId} was rejected (${reason}).` }
      : {}),
  };
}

/**
 * Copies a rejection record without its details text.
 */
function stripRejectionDetails(rejection: RejectedPortalRenderPath): RejectedPortalRenderPath {
  return {
    pathId: rejection.pathId,
    reason: rejection.reason,
  };
}
