/**
 * Static, view-independent culling of portal-path tables: discards portal words through which no sight line from the root cell could reach the destination cell.
 * For a path (portal word) from a root cell, every test is carried out in the root cell's local frame by mapping the destination prism's corners and each crossed portal's side into that frame with the path's rigid transforms. Three families of rejection are applied, cheapest first. (1) Aperture tests against every crossed portal in turn: all corners of the destination prism lie on the inner side of that portal's plane ("outside-ancestor-portal-plane"), or all lie below the floor or above the ceiling of that portal's cell ("outside-ancestor-vertical-range"). (2) For words of three or more portals, a plan-view transversal test ("no-static-line-transversal"): a segment from a point tau along the first portal's base edge to a point sigma along the last one must meet every intermediate portal edge; feasibility in (tau, sigma) in [0,1]^2 is decided first by a conservative interval branch-and-bound and then by convex polygon clipping after a projective change of coordinates that makes the first and last edges parallel. (3) An optional per-root cap on kept paths ("static-path-budget"). Tolerances are absolute and in meters; the aperture tests use at least half the forbidden-junction radius, see StaticPortalPathCullOptions. The z coordinate is used only by the vertical-range test; the transversal test works on the plan projection.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import { forbiddenPortalJunctionRadiusMeters } from "./forbiddenZones";
import {
  createPortalPathTable,
  type PortalPathTable,
  type PortalPathTablesByRootCell,
  type PortalRenderPath,
  type PortalRenderStep,
} from "./portalPaths";
import { developPortalSegment, type OrientedPortalSegment } from "./orientedPortal";
import type { CompiledPortal } from "./specs";
import type { CompiledPrismSide } from "./prismCells";
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
  transformPoint3,
  type RigidTransform3,
} from "../math/rigidTransform3";
import { vec3, type Vec3 } from "../math/vec3";

/**
 * 2D point or vector in the plan (x/y) projection of the root frame, in meters unless noted.
 */
interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Directed 2D segment, here the base edge (at z = 0) of a portal side expressed in the root frame.
 */
interface Segment2 {
  readonly start: Vec2;
  readonly end: Vec2;
}

/**
 * Axis-aligned box of (tau, sigma) parameters, where tau runs along the first (root) portal edge and sigma along the last (leaf) portal edge, both from 0 at the side's start vertex to 1 at its end vertex.
 */
interface TauSigmaBox {
  readonly tauMin: number;
  readonly tauMax: number;
  readonly sigmaMin: number;
  readonly sigmaMax: number;
}

/**
 * Half-plane {(p, q) : a p + b q + c >= 0} in 2D parameter space (in this file, the (tau, sigma) square).
 */
interface HalfPlane2 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/**
 * Outcome of the projective feasibility test: mayExist is false only when status is "rejected"; the degenerate-map fallback keeps the path.
 */
interface ProjectiveTauSigmaResult {
  readonly mayExist: boolean;
  readonly status: "accepted" | "rejected" | "fallback-degenerate-projective-map";
}

/**
 * Tuning for static path culling.
 */
export interface StaticPortalPathCullOptions {
  /**
   * Non-negative absolute tolerance. The aperture tests use max(toleranceMeters, forbiddenPortalJunctionRadiusMeters / 2), i.e. at least 0.075 m, and treat anything within that distance of a portal plane as inside the aperture side; the transversal test uses toleranceMeters itself, applied also to dimensionless and area-like quantities.
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
  /**
   * If true, console.warn when the interval test rejects a path that the projective test would have accepted, with a summary at the end of the run.
   */
  readonly debugTauSigmaDisagreements?: boolean;
}

/**
 * Counters for the optional disagreement diagnostics; at most one example of each kind is logged.
 */
interface TauSigmaDisagreementStats {
  exactAccepted: number;
  fallbackAccepted: number;
  loggedExactAccepted: number;
  loggedFallbackAccepted: number;
}

/**
 * Options for {@link buildStaticallyCulledPortalPathTables}: the culling options plus the path-generation limits and a progress callback.
 */
export interface BuildStaticallyCulledPortalPathTablesOptions extends StaticPortalPathCullOptions {
  readonly maxDepth: number;
  readonly skipImmediateReverse?: boolean;
  /**
   * Called after each depth level of each root (including depth 0) with cumulative statistics.
   */
  readonly onDepthComplete?: (status: StaticPortalPathDepthStatus) => void;
}

/**
 * Progress report for one root cell after finishing one depth level of the culled expansion.
 */
export interface StaticPortalPathDepthStatus {
  readonly rootCellId: string;
  readonly depth: number;
  /**
   * Candidate children examined at this depth (accepted plus rejected, except those never reached after the budget ran out).
   */
  readonly processedPathCount: number;
  readonly acceptedPathCount: number;
  readonly rejectedPathCount: number;
  /**
   * Cumulative kept paths for this root, including the root path.
   */
  readonly totalKeptPathCount: number;
  readonly totalRejectedPathCount: number;
  /**
   * True once maxKeptPathsPerRoot has been reached; expansion stops after this depth.
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
 * Why a path was removed. "outside-ancestor-portal-plane": every corner of the destination prism, mapped into the frame of an ancestor portal's cell, is on the inward side of that portal's plane (within tolerance), so nothing of the destination lies beyond the portal. "outside-ancestor-vertical-range": every corner lies below the floor or above the ceiling of that cell. "no-static-line-transversal": no plan-view segment from the first to the last portal edge meets all intermediate portal edges. "static-path-budget": maxKeptPathsPerRoot was exhausted.
 */
export type StaticPortalPathRejectReason =
  | "outside-ancestor-portal-plane"
  | "no-static-line-transversal"
  | "outside-ancestor-vertical-range"
  | "static-path-budget";

/**
 * Record of one rejected path: its id, the rejection reason and optional explanatory text.
 */
export interface RejectedPortalRenderPath {
  readonly pathId: number;
  readonly reason: StaticPortalPathRejectReason;
  readonly details?: string;
}

/**
 * Generates portal-path tables breadth-first while culling by oriented line cones, so descendants of rejected paths are never created.
 * Each word is kept iff some oriented plan-view line crosses its portals in order (see staticLineCone). Path ids are assigned to every candidate child before it is tested, so kept paths have sparse ids that do not match those of an unculled table built separately. After the budget is hit a single "static-path-budget" rejection is recorded and expansion of that root stops. Depth-0 root path is always kept; every other kept path carries newestPortalInRoot.
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
    const keptPaths: PortalRenderPath[] = [rootPath];
    const rejectedPaths: RejectedPortalRenderPath[] = [];
    const rejectedByReason = new Map<StaticPortalPathRejectReason, number>();
    // Cones of kept paths of depth >= 2, dropped at the end of the root.
    const conesByPathId = new Map<number, LineCone>();
    let frontier: PortalRenderPath[] = [rootPath];
    const budget = options.maxKeptPathsPerRoot ?? Number.POSITIVE_INFINITY;
    let nextPathId = 1;
    let budgetExhausted = false;

    options.onDepthComplete?.({
      rootCellId: rootCell.id,
      depth: 0,
      processedPathCount: 1,
      acceptedPathCount: 1,
      rejectedPathCount: 0,
      totalKeptPathCount: keptPaths.length,
      totalRejectedPathCount: rejectedPaths.length,
      budgetExhausted,
    });

    for (let depth = 1; depth <= options.maxDepth && frontier.length > 0 && !budgetExhausted; depth += 1) {
      const nextFrontier: PortalRenderPath[] = [];
      let processedPathCount = 0;
      let acceptedPathCount = 0;
      let rejectedPathCount = 0;

      for (const parent of frontier) {
        const sourceCell = world.cellsById.get(parent.destinationCellId);

        if (!sourceCell) {
          throw new Error(`Portal path reached missing cell "${parent.destinationCellId}".`);
        }

        for (const portal of sourceCell.portals) {
          if (skipImmediateReverse && isImmediateReverse(parent, portal)) {
            continue;
          }

          processedPathCount += 1;

          // The budget check precedes the geometric tests, so once the cap is reached the next candidate is recorded as a budget rejection and this root's expansion stops.
          if (keptPaths.length >= budget) {
            const rejection = createRejection(nextPathId, "static-path-budget", options.keepRejectedPathDetails);
            rejectedPaths.push(rejection);
            rejectedByReason.set(rejection.reason, (rejectedByReason.get(rejection.reason) ?? 0) + 1);
            rejectedPathCount += 1;
            budgetExhausted = true;
            break;
          }

          const destinationFromRoot = composeRigidTransform3(portal.transformToTarget, parent.destinationFromRoot);
          const child: PortalRenderPath = {
            id: nextPathId,
            rootCellId: rootCell.id,
            destinationCellId: portal.targetCellId,
            depth,
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
            newestPortalInRoot: developPortalSegment(world, sourceCell.id, portal.sideIndex, parent.rootFromDestination),
          };
          nextPathId += 1;

          const result = testChild(
            depth,
            conesByPathId.get(parent.id),
            parent.newestPortalInRoot,
            child.newestPortalInRoot!,
            options.toleranceMeters,
          );

          if (!result) {
            const rejection = createLineTransversalRejection(child.id, options.keepRejectedPathDetails);
            rejectedPaths.push(rejection);
            rejectedByReason.set(rejection.reason, (rejectedByReason.get(rejection.reason) ?? 0) + 1);
            rejectedPathCount += 1;
            continue;
          }

          if (result.cone) {
            conesByPathId.set(child.id, result.cone);
          }

          keptPaths.push(child);
          nextFrontier.push(child);
          acceptedPathCount += 1;
        }

        if (budgetExhausted) {
          break;
        }
      }

      options.onDepthComplete?.({
        rootCellId: rootCell.id,
        depth,
        processedPathCount,
        acceptedPathCount,
        rejectedPathCount,
        totalKeptPathCount: keptPaths.length,
        totalRejectedPathCount: rejectedPaths.length,
        budgetExhausted,
      });

      frontier = nextFrontier;
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
 * Outcome of testing one child word: the cone of lines crossing it (absent at depth 1, which has none) and its Crofton measure.
 */
interface ChildTestResult {
  readonly cone: LineCone | undefined;
  readonly measure: number;
}

/**
 * Tests a child word of the given depth. Depth-1 words are never rejected and carry no cone; depth 2 builds the cone from the two portals; deeper words clip the parent's cone by the newest portal. Returns undefined if the word is rejected (empty cone or measure below staticLineConeMinMeasureMeters).
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
 * Legacy tau/sigma builder, kept temporarily for the old-versus-new comparison test.
 * @deprecated removed in Part C of job 20.
 */
export function buildStaticallyCulledPortalPathTablesLegacy(
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
  // TODO(issue 56): the aperture slack (max(toleranceMeters, junction radius / 2)) makes rejection MORE aggressive as it grows, which can remove visible paths; soundness of this widening needs design review.
  // Widen the aperture tolerance to half the forbidden-junction radius; larger tolerance means more paths count as "not beyond the portal plane", so this makes the aperture rejection more aggressive, not more conservative.
  const cullTolerance = Math.max(options.toleranceMeters, forbiddenPortalJunctionRadiusMeters / 2);
  const tauSigmaDebugStats = options.debugTauSigmaDisagreements ? createTauSigmaDisagreementStats() : undefined;

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
    const keptPaths: PortalRenderPath[] = [rootPath];
    const rejectedPaths: RejectedPortalRenderPath[] = [];
    const rejectedByReason = new Map<StaticPortalPathRejectReason, number>();
    let frontier: PortalRenderPath[] = [rootPath];
    const budget = options.maxKeptPathsPerRoot ?? Number.POSITIVE_INFINITY;
    let nextPathId = 1;
    let budgetExhausted = false;

    options.onDepthComplete?.({
      rootCellId: rootCell.id,
      depth: 0,
      processedPathCount: 1,
      acceptedPathCount: 1,
      rejectedPathCount: 0,
      totalKeptPathCount: keptPaths.length,
      totalRejectedPathCount: rejectedPaths.length,
      budgetExhausted,
    });

    for (let depth = 1; depth <= options.maxDepth && frontier.length > 0 && !budgetExhausted; depth += 1) {
      const nextFrontier: PortalRenderPath[] = [];
      let processedPathCount = 0;
      let acceptedPathCount = 0;
      let rejectedPathCount = 0;

      for (const parent of frontier) {
        const sourceCell = world.cellsById.get(parent.destinationCellId);

        if (!sourceCell) {
          throw new Error(`Portal path reached missing cell "${parent.destinationCellId}".`);
        }

        for (const portal of sourceCell.portals) {
          if (skipImmediateReverse && isImmediateReverse(parent, portal)) {
            continue;
          }

          processedPathCount += 1;

          // The budget check precedes the geometric tests, so once the cap is reached the next candidate is recorded as a budget rejection and this root's expansion stops.
          if (keptPaths.length >= budget) {
            const rejection = createRejection(nextPathId, "static-path-budget", options.keepRejectedPathDetails);
            rejectedPaths.push(rejection);
            rejectedByReason.set(rejection.reason, (rejectedByReason.get(rejection.reason) ?? 0) + 1);
            rejectedPathCount += 1;
            budgetExhausted = true;
            break;
          }

          const destinationFromRoot = composeRigidTransform3(portal.transformToTarget, parent.destinationFromRoot);
          const child: PortalRenderPath = {
            id: nextPathId,
            rootCellId: rootCell.id,
            destinationCellId: portal.targetCellId,
            depth,
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
          nextPathId += 1;

          const rejection =
            rejectGeometrically(world, child, cullTolerance, options.keepRejectedPathDetails) ??
            rejectByTauSigmaTransversal(
              world,
              child,
              options.toleranceMeters,
              options.keepRejectedPathDetails,
              options.debugTauSigmaDisagreements,
              tauSigmaDebugStats,
            );

          if (rejection) {
            rejectedPaths.push(rejection);
            rejectedByReason.set(rejection.reason, (rejectedByReason.get(rejection.reason) ?? 0) + 1);
            rejectedPathCount += 1;
            continue;
          }

          keptPaths.push(child);
          nextFrontier.push(child);
          acceptedPathCount += 1;
        }

        if (budgetExhausted) {
          break;
        }
      }

      options.onDepthComplete?.({
        rootCellId: rootCell.id,
        depth,
        processedPathCount,
        acceptedPathCount,
        rejectedPathCount,
        totalKeptPathCount: keptPaths.length,
        totalRejectedPathCount: rejectedPaths.length,
        budgetExhausted,
      });

      frontier = nextFrontier;
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
  }

  logTauSigmaDisagreementSummary(tauSigmaDebugStats);

  return {
    tables: {
      maxDepth: options.maxDepth,
      tablesByRootCellId,
    },
    summariesByRootCellId,
  };
}

/**
 * Filters existing portal-path tables, keeping each path only if it passes all geometric tests, preserving the original path ids.
 * Each path is tested against all of its own ancestors' portals; in addition, a path whose parent was not kept is rejected with the parent's reason, so every kept path's parent is also kept (kept tables are prefix-closed). The root path is always kept; the budget is applied in table order after the geometric tests.
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
 * Applies the aperture tests of every portal along the path to the destination prism, returning the first rejection.
 * The destination's 2n prism corners are mapped into the root frame (rootFromDestination), then, walking the word, into the frame of each crossed portal's source cell (sourceFromRoot, updated after each step by composing that portal's transformToTarget) and tested against that portal's side.
 */
function rejectGeometrically(
  world: CompiledCellComplex,
  path: PortalRenderPath,
  toleranceMeters: number,
  includeDetails: boolean | undefined,
): RejectedPortalRenderPath | undefined {
  const destinationCell = world.cellsById.get(path.destinationCellId);

  if (!destinationCell) {
    throw new Error(`Static portal path culling reached missing destination cell "${path.destinationCellId}".`);
  }

  const boundInRoot = prismBoundVertices(destinationCell.baseVertices, destinationCell.heightMeters).map((point) =>
    transformPoint3(path.rootFromDestination, point),
  );
  let sourceFromRoot: RigidTransform3 = identityRigidTransform3;

  for (const step of path.steps) {
    const sourceCell = world.cellsById.get(step.sourceCellId);
    const portal = sourceCell?.portalsById.get(step.sourcePortalId);

    if (!sourceCell || !portal) {
      throw new Error(`Static portal path culling reached missing portal "${step.sourceCellId}:${step.sourcePortalId}".`);
    }

    const boundInSource = boundInRoot.map((point) => transformPoint3(sourceFromRoot, point));
    const rejection = rejectAgainstPortalAperture(
      path.id,
      sourceCell.id,
      sourceCell.sides[portal.sideIndex],
      sourceCell.heightMeters,
      boundInSource,
      toleranceMeters,
      includeDetails,
    );

    if (rejection) {
      return rejection;
    }

    sourceFromRoot = composeRigidTransform3(portal.transformToTarget, sourceFromRoot);
  }

  return undefined;
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
 * Rejects a path of three or more portals if no plan-view segment can run from the first portal's edge to the last one while meeting every intermediate portal edge.
 * Paths of at most two portals have no intermediate edge, so any pair of points is feasible and they are never rejected here. Uses toleranceMeters unchanged.
 */
function rejectByTauSigmaTransversal(
  world: CompiledCellComplex,
  path: PortalRenderPath,
  toleranceMeters: number,
  includeDetails: boolean | undefined,
  debugDisagreements: boolean | undefined,
  debugStats: TauSigmaDisagreementStats | undefined,
): RejectedPortalRenderPath | undefined {
  // A word of at most two portals has no intermediate portal edge, so every (tau, sigma) pair is feasible and there is nothing to test.
  if (path.steps.length <= 2) {
    return undefined;
  }

  const portalSegments = portalSegmentsInRoot(world, path);

  if (portalSegments.length !== path.steps.length) {
    return undefined;
  }

  const rootPortal = portalSegments[0];
  const leafPortal = portalSegments[portalSegments.length - 1];
  const intermediatePortals = portalSegments.slice(1, -1);
  const feasible = tauSigmaLineTransversalMayExist(rootPortal, leafPortal, intermediatePortals, {
    pathId: path.id,
    toleranceMeters,
    debugDisagreements,
    debugStats,
  });

  if (feasible) {
    return undefined;
  }

  return {
    pathId: path.id,
    reason: "no-static-line-transversal",
    ...(includeDetails ? { details: `Rejected path ${path.id}; no tau/sigma line intersects all portal windows.` } : {}),
  };
}

/**
 * Returns each crossed portal's base edge (z = 0) as a segment in the root frame's x/y plane, in path order.
 * For step i the portal belongs to the i-th cell, whose frame is related to the root's by sourceFromRoot, so its edge is mapped back with the inverse transform.
 */
function portalSegmentsInRoot(world: CompiledCellComplex, path: PortalRenderPath): readonly Segment2[] {
  const segments: Segment2[] = [];
  let sourceFromRoot: RigidTransform3 = identityRigidTransform3;

  for (const step of path.steps) {
    const sourceCell = world.cellsById.get(step.sourceCellId);
    const portal = sourceCell?.portalsById.get(step.sourcePortalId);

    if (!sourceCell || !portal) {
      throw new Error(`Static portal path culling reached missing portal "${step.sourceCellId}:${step.sourcePortalId}".`);
    }

    const side = sourceCell.sides[portal.sideIndex];
    const rootFromSource = invertRigidTransform3(sourceFromRoot);
    const start = transformPoint3(rootFromSource, vec3(side.start.x, side.start.y, 0));
    const end = transformPoint3(rootFromSource, vec3(side.end.x, side.end.y, 0));

    segments.push({
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    });
    sourceFromRoot = composeRigidTransform3(portal.transformToTarget, sourceFromRoot);
  }

  return segments;
}

/**
 * Decides whether a plan-view segment from a point on rootPortal to a point on leafPortal can meet every window (intermediate portal edge).
 * Runs the conservative interval test first; if it rejects, the path is rejected. If it accepts, the projective clipping test has the final word. With debugDisagreements, a case where interval rejects but projective would accept is logged.
 */
function tauSigmaLineTransversalMayExist(
  rootPortal: Segment2,
  leafPortal: Segment2,
  windows: readonly Segment2[],
  options: {
    readonly pathId: number;
    readonly toleranceMeters: number;
    readonly debugDisagreements?: boolean;
    readonly debugStats?: TauSigmaDisagreementStats;
  },
): boolean {
  const toleranceMeters = options.toleranceMeters;

  if (!affineIntervalLineTransversalMayExist(rootPortal, leafPortal, windows, toleranceMeters)) {
    const projective = options.debugDisagreements
      ? projectiveTauSigmaLineTransversalMayExist(rootPortal, leafPortal, windows, toleranceMeters)
      : undefined;

    if (projective?.mayExist) {
      logTauSigmaDisagreement({
        pathId: options.pathId,
        projectiveStatus: projective.status,
        rootPortal,
        leafPortal,
        windows,
        stats: options.debugStats,
      });
    }

    return false;
  }

  return projectiveTauSigmaLineTransversalMayExist(rootPortal, leafPortal, windows, toleranceMeters).mayExist;
}

function createTauSigmaDisagreementStats(): TauSigmaDisagreementStats {
  return {
    exactAccepted: 0,
    fallbackAccepted: 0,
    loggedExactAccepted: 0,
    loggedFallbackAccepted: 0,
  };
}

function logTauSigmaDisagreement(options: {
  readonly pathId: number;
  readonly projectiveStatus: ProjectiveTauSigmaResult["status"];
  readonly rootPortal: Segment2;
  readonly leafPortal: Segment2;
  readonly windows: readonly Segment2[];
  readonly stats?: TauSigmaDisagreementStats;
}): void {
  const isExact = options.projectiveStatus === "accepted";
  const stats = options.stats;
  const maxLogsPerKind = 1;

  if (stats) {
    if (isExact) {
      stats.exactAccepted += 1;

      if (stats.loggedExactAccepted >= maxLogsPerKind) {
        return;
      }

      stats.loggedExactAccepted += 1;
    } else {
      stats.fallbackAccepted += 1;
      return;
    }
  }

  const message = isExact
    ? "Tau-sigma culling disagreement: affine rejected but projective accepted exactly."
    : "Tau-sigma culling note: affine rejected; projective kept only by conservative fallback.";
  console.warn(`${message} ${JSON.stringify({
    pathId: options.pathId,
    projectiveStatus: options.projectiveStatus,
    rootPortal: cloneSegmentForDebug(options.rootPortal),
    leafPortal: cloneSegmentForDebug(options.leafPortal),
    windows: options.windows.map(cloneSegmentForDebug),
  })}`);
}

function cloneSegmentForDebug(segment: Segment2): Segment2 {
  return {
    start: { x: segment.start.x, y: segment.start.y },
    end: { x: segment.end.x, y: segment.end.y },
  };
}

function logTauSigmaDisagreementSummary(stats: TauSigmaDisagreementStats | undefined): void {
  if (!stats || (stats.exactAccepted === 0 && stats.fallbackAccepted === 0)) {
    return;
  }

  console.warn("Tau-sigma culling disagreement summary.", {
    exactAccepted: stats.exactAccepted,
    fallbackAccepted: stats.fallbackAccepted,
    loggedExactAccepted: stats.loggedExactAccepted,
    loggedFallbackAccepted: stats.loggedFallbackAccepted,
  });
}

/**
 * Convex-clipping feasibility test in (tau, sigma) space after a projective map that makes the root and leaf edges parallel.
 * In the projected plane, the condition that the segment from P(tau) on the root edge to Q(sigma) on the leaf edge meets a window W is: the endpoints of W lie on opposite sides of line PQ, and P and Q lie on opposite sides of W's supporting line. Because root and leaf are parallel after the map, both conditions are affine in (tau, sigma), so the feasible set is a union of convex polygons obtained by clipping the unit square with half-planes (each opposite-sign condition splits into two cases). An empty set rejects the path; a degenerate map keeps it conservatively. When the root and leaf edge lines intersect, the domain is first restricted to parameters whose points lie on the same side of the intersection point's critical line (the preimage of infinity), and each window is required to lie in the same chart; sight lines that cross that critical line between the root and leaf edges are therefore not represented in the projected test.
 */
function projectiveTauSigmaLineTransversalMayExist(
  rootPortal: Segment2,
  leafPortal: Segment2,
  windows: readonly Segment2[],
  toleranceMeters: number,
): ProjectiveTauSigmaResult {
  // TODO(issue 56): this stage does not represent sight lines that cross the line sent to infinity (the critical line); such paths may be rejected although visible. Needs design review before changing.
  const rootDirection = sub2(rootPortal.end, rootPortal.start);
  const leafDirection = sub2(leafPortal.end, leafPortal.start);
  // Non-parallel root and leaf edge lines need the projective chart bookkeeping below. This threshold is not the same as the areaTolerance used when the projection is built, so the two can disagree for nearly parallel edges.
  const rootLeafLinesIntersect = Math.abs(cross2(rootDirection, leafDirection)) > toleranceMeters;
  const projectedSegments = projectSegmentsToParallelRootLeaf([rootPortal, leafPortal, ...windows], toleranceMeters);

  if (!projectedSegments) {
    return {
      mayExist: true,
      status: "fallback-degenerate-projective-map",
    };
  }

  const projectedRoot = projectedSegments[0];
  const projectedLeaf = projectedSegments[1];
  const projectedWindows = projectedSegments.slice(2);
  const rootDenominatorLine = parameterCoordinateLine(projectedRoot.start.y, projectedRoot.end.y, "tau");
  const leafDenominatorLine = parameterCoordinateLine(projectedLeaf.start.y, projectedLeaf.end.y, "sigma");
  let domains: Vec2[][] = rootLeafLinesIntersect
    ? clipDomainsBySameSigns([unitTauSigmaSquare()], rootDenominatorLine, leafDenominatorLine, toleranceMeters)
    : [unitTauSigmaSquare()];

  if (domains.length === 0) {
    return {
      mayExist: false,
      status: "rejected",
    };
  }

  for (const window of projectedWindows) {
    if (rootLeafLinesIntersect) {
      domains = clipDomainsToWindowChart(domains, rootDenominatorLine, leafDenominatorLine, window, toleranceMeters);

      if (domains.length === 0) {
        return {
          mayExist: false,
          status: "rejected",
        };
      }
    }

    const startLine = tauSigmaLineForPoint(projectedRoot, projectedLeaf, window.start);
    const endLine = tauSigmaLineForPoint(projectedRoot, projectedLeaf, window.end);
    const rootLine = parameterLineForPointOnSegment(window, projectedRoot.start, projectedRoot.end, "tau");
    const leafLine = parameterLineForPointOnSegment(window, projectedLeaf.start, projectedLeaf.end, "sigma");
    const lineCrossingDomains = clipDomainsByOppositeSigns(domains, startLine, endLine, toleranceMeters);
    const nextDomains = clipDomainsByOppositeSigns(lineCrossingDomains, rootLine, leafLine, toleranceMeters);

    if (nextDomains.length === 0) {
      return {
        mayExist: false,
        status: "rejected",
      };
    }

    domains = pruneTauSigmaDomains(nextDomains, toleranceMeters);
  }

  domains = filterDomainsByProjectedWitness(projectedRoot, projectedLeaf, projectedWindows, domains, toleranceMeters);

  return {
    mayExist: domains.length > 0,
    status: domains.length > 0 ? "accepted" : "rejected",
  };
}

/**
 * Keeps only the convex pieces that contain a (tau, sigma) sample (vertex average or a vertex) whose segment meets every projected window when re-tested directly.
 */
function filterDomainsByProjectedWitness(
  projectedRoot: Segment2,
  projectedLeaf: Segment2,
  projectedWindows: readonly Segment2[],
  domains: readonly Vec2[][],
  toleranceMeters: number,
): Vec2[][] {
  return domains.filter((domain) => {
    const centroid = polygonCentroid(domain);
    const candidates = centroid ? [centroid, ...domain] : domain;

    return candidates.some((candidate) =>
      projectedWindows.every((window) => projectedRayIntersectsWindow(projectedRoot, projectedLeaf, candidate, window, toleranceMeters)),
    );
  });
}

/**
 * Vertex average of the polygon (not the area centroid); undefined for an empty polygon.
 */
function polygonCentroid(polygon: readonly Vec2[]): Vec2 | undefined {
  if (polygon.length === 0) {
    return undefined;
  }

  let x = 0;
  let y = 0;

  for (const point of polygon) {
    x += point.x;
    y += point.y;
  }

  return {
    x: x / polygon.length,
    y: y / polygon.length,
  };
}

/**
 * Tests whether the segment from interpolate(root, tau) to interpolate(leaf, sigma) can meet the window, allowing tolerance: the window endpoints must not be strictly on one side of the segment's line and the segment endpoints must not both be strictly on one side of the window's line.
 */
function projectedRayIntersectsWindow(
  projectedRoot: Segment2,
  projectedLeaf: Segment2,
  parameter: Vec2,
  window: Segment2,
  toleranceMeters: number,
): boolean {
  const rayStart = interpolate2(projectedRoot.start, projectedRoot.end, parameter.x);
  const rayEnd = interpolate2(projectedLeaf.start, projectedLeaf.end, parameter.y);
  const windowStartSide = orient2(rayStart, rayEnd, window.start);
  const windowEndSide = orient2(rayStart, rayEnd, window.end);
  const rayStartSide = orient2(window.start, window.end, rayStart);
  const rayEndSide = orient2(window.start, window.end, rayEnd);

  return (
    valuesMayHaveOppositeSigns(windowStartSide, windowEndSide, toleranceMeters) &&
    valuesMayHaveOppositeSigns(rayStartSide, rayEndSide, toleranceMeters)
  );
}

/**
 * False only if both values are strictly positive or both strictly negative beyond the tolerance.
 */
function valuesMayHaveOppositeSigns(first: number, second: number, toleranceMeters: number): boolean {
  return !((first > toleranceMeters && second > toleranceMeters) || (first < -toleranceMeters && second < -toleranceMeters));
}

/**
 * Conservative branch-and-bound over the (tau, sigma) unit square in the original (unprojected) coordinates.
 * A box is discarded if for some window it provably contains no segment meeting that window; a box that survives is split along its longer side. The search gives up and answers "may exist" after 8 splits in total or when a surviving box has diameter at most 1e-3, so a false result is a proof of infeasibility (up to tolerance) while true only means not refuted.
 */
function affineIntervalLineTransversalMayExist(
  rootPortal: Segment2,
  leafPortal: Segment2,
  windows: readonly Segment2[],
  toleranceMeters: number,
): boolean {
  const stack: TauSigmaBox[] = [{ tauMin: 0, tauMax: 1, sigmaMin: 0, sigmaMax: 1 }];
  // Global cap on box splits for the whole search (not per branch); it bounds the cost and makes the test answer "may exist" when unresolved.
  const maxSplits = 8;
  let splitCount = 0;

  while (stack.length > 0) {
    const box = stack.pop()!;

    if (windows.some((window) => !affineBoxMayContainRayThroughWindow(rootPortal, leafPortal, window, box, toleranceMeters))) {
      continue;
    }

    if (splitCount >= maxSplits || tauSigmaBoxDiameter(box) <= 1e-3) {
      return true;
    }

    splitCount += 1;
    stack.push(...splitTauSigmaBox(box));
  }

  return false;
}

/**
 * Interval test that a box of (tau, sigma) values may contain a segment meeting the window.
 * Rejects the box if the root-edge and leaf-edge points are on the same strict side of the window's supporting line for the whole box, or if the window's two endpoints are on the same strict side of the moving line PQ for the whole box (the orientation is bilinear in (tau, sigma), so its range over the box is attained at the box corners).
 */
function affineBoxMayContainRayThroughWindow(
  rootPortal: Segment2,
  leafPortal: Segment2,
  window: Segment2,
  box: TauSigmaBox,
  toleranceMeters: number,
): boolean {
  const rootSide = affineOrientationInterval(
    window.start,
    window.end,
    rootPortal.start,
    rootPortal.end,
    box.tauMin,
    box.tauMax,
  );
  const leafSide = affineOrientationInterval(
    window.start,
    window.end,
    leafPortal.start,
    leafPortal.end,
    box.sigmaMin,
    box.sigmaMax,
  );

  if (intervalsHaveSameStrictSign(rootSide, leafSide, toleranceMeters)) {
    return false;
  }

  const windowStartSide = movingRayEndpointOrientationInterval(rootPortal, leafPortal, window.start, box);
  const windowEndSide = movingRayEndpointOrientationInterval(rootPortal, leafPortal, window.end, box);

  return !intervalsHaveSameStrictSign(windowStartSide, windowEndSide, toleranceMeters);
}

/**
 * Range of the orientation of the segment's interpolated point relative to the directed line over a parameter interval (orientation is affine in the parameter, so the endpoints give the range).
 */
function affineOrientationInterval(
  lineStart: Vec2,
  lineEnd: Vec2,
  segmentStart: Vec2,
  segmentEnd: Vec2,
  parameterMin: number,
  parameterMax: number,
): readonly [number, number] {
  const valueAtMin = orient2(lineStart, lineEnd, interpolate2(segmentStart, segmentEnd, parameterMin));
  const valueAtMax = orient2(lineStart, lineEnd, interpolate2(segmentStart, segmentEnd, parameterMax));

  return [Math.min(valueAtMin, valueAtMax), Math.max(valueAtMin, valueAtMax)];
}

/**
 * Range of orient(P(tau), Q(sigma), point) over a box, from its four corners.
 */
function movingRayEndpointOrientationInterval(
  rootPortal: Segment2,
  leafPortal: Segment2,
  point: Vec2,
  box: TauSigmaBox,
): readonly [number, number] {
  const values = [
    orient2(interpolate2(rootPortal.start, rootPortal.end, box.tauMin), interpolate2(leafPortal.start, leafPortal.end, box.sigmaMin), point),
    orient2(interpolate2(rootPortal.start, rootPortal.end, box.tauMin), interpolate2(leafPortal.start, leafPortal.end, box.sigmaMax), point),
    orient2(interpolate2(rootPortal.start, rootPortal.end, box.tauMax), interpolate2(leafPortal.start, leafPortal.end, box.sigmaMin), point),
    orient2(interpolate2(rootPortal.start, rootPortal.end, box.tauMax), interpolate2(leafPortal.start, leafPortal.end, box.sigmaMax), point),
  ];

  return [Math.min(...values), Math.max(...values)];
}

/**
 * True if both intervals lie entirely above +tolerance or both entirely below -tolerance.
 */
function intervalsHaveSameStrictSign(
  first: readonly [number, number],
  second: readonly [number, number],
  toleranceMeters: number,
): boolean {
  return (
    (first[0] > toleranceMeters && second[0] > toleranceMeters) ||
    (first[1] < -toleranceMeters && second[1] < -toleranceMeters)
  );
}

/**
 * Bisects the box across its longer side (tau on ties).
 */
function splitTauSigmaBox(box: TauSigmaBox): readonly TauSigmaBox[] {
  const tauSize = box.tauMax - box.tauMin;
  const sigmaSize = box.sigmaMax - box.sigmaMin;

  if (tauSize >= sigmaSize) {
    const mid = (box.tauMin + box.tauMax) / 2;
    return [
      { ...box, tauMax: mid },
      { ...box, tauMin: mid },
    ];
  }

  const mid = (box.sigmaMin + box.sigmaMax) / 2;
  return [
    { ...box, sigmaMax: mid },
    { ...box, sigmaMin: mid },
  ];
}

/**
 * Larger side length of the box in parameter units.
 */
function tauSigmaBoxDiameter(box: TauSigmaBox): number {
  return Math.max(box.tauMax - box.tauMin, box.sigmaMax - box.sigmaMin);
}

/**
 * Restricts each convex domain to points where the two affine functions have opposite signs, as the union of {first >= 0, second <= 0} and {first <= 0, second >= 0}.
 */
function clipDomainsByOppositeSigns(
  domains: readonly Vec2[][],
  firstLine: HalfPlane2,
  secondLine: HalfPlane2,
  toleranceMeters: number,
): Vec2[][] {
  const nextDomains: Vec2[][] = [];

  for (const domain of domains) {
    const firstPositive = clipConvexPolygonByHalfPlane(
      clipConvexPolygonByHalfPlane(domain, firstLine, toleranceMeters),
      negateHalfPlane(secondLine),
      toleranceMeters,
    );
    const secondPositive = clipConvexPolygonByHalfPlane(
      clipConvexPolygonByHalfPlane(domain, negateHalfPlane(firstLine), toleranceMeters),
      secondLine,
      toleranceMeters,
    );

    if (firstPositive.length > 0) {
      nextDomains.push(firstPositive);
    }

    if (secondPositive.length > 0) {
      nextDomains.push(secondPositive);
    }
  }

  return pruneTauSigmaDomains(nextDomains, toleranceMeters);
}

/**
 * Restricts each convex domain to points where the two affine functions have the same sign, as the union of {both >= 0} and {both <= 0}.
 */
function clipDomainsBySameSigns(
  domains: readonly Vec2[][],
  firstLine: HalfPlane2,
  secondLine: HalfPlane2,
  toleranceMeters: number,
): Vec2[][] {
  const nextDomains: Vec2[][] = [];

  for (const domain of domains) {
    const bothPositive = clipConvexPolygonByHalfPlane(
      clipConvexPolygonByHalfPlane(domain, firstLine, toleranceMeters),
      secondLine,
      toleranceMeters,
    );
    const bothNegative = clipConvexPolygonByHalfPlane(
      clipConvexPolygonByHalfPlane(domain, negateHalfPlane(firstLine), toleranceMeters),
      negateHalfPlane(secondLine),
      toleranceMeters,
    );

    if (bothPositive.length > 0) {
      nextDomains.push(bothPositive);
    }

    if (bothNegative.length > 0) {
      nextDomains.push(bothNegative);
    }
  }

  return pruneTauSigmaDomains(nextDomains, toleranceMeters);
}

/**
 * Keeps the parameters whose root and leaf points lie on the same side of the critical line as the window (sign of its mean projected y); the window's chart is fixed by that sign.
 */
function clipDomainsToWindowChart(
  domains: readonly Vec2[][],
  rootDenominatorLine: HalfPlane2,
  leafDenominatorLine: HalfPlane2,
  window: Segment2,
  toleranceMeters: number,
): Vec2[][] {
  const windowSign = Math.sign((window.start.y + window.end.y) / 2);

  if (windowSign === 0) {
    return domains as Vec2[][];
  }

  const rootLine = windowSign > 0 ? rootDenominatorLine : negateHalfPlane(rootDenominatorLine);
  const leafLine = windowSign > 0 ? leafDenominatorLine : negateHalfPlane(leafDenominatorLine);

  return pruneTauSigmaDomains(
    domains
      .map((domain) =>
        clipConvexPolygonByHalfPlane(
          clipConvexPolygonByHalfPlane(domain, rootLine, toleranceMeters),
          leafLine,
          toleranceMeters,
        ),
      )
      .filter((domain) => domain.length > 0),
    toleranceMeters,
  );
}

/**
 * Half-plane value equal to the projected y-coordinate of the edge point at parameter tau (or sigma); its sign is the sign of the projective denominator at that point.
 */
function parameterCoordinateLine(startValue: number, endValue: number, parameterName: "tau" | "sigma"): HalfPlane2 {
  const slope = endValue - startValue;

  return parameterName === "tau"
    ? {
        a: slope,
        b: 0,
        c: startValue,
      }
    : {
        a: 0,
        b: slope,
        c: startValue,
      };
}

/**
 * Maps the root edge, leaf edge and windows (in that order) into a frame in which the root and leaf edges are parallel, or returns undefined if that is not possible.
 * If the edges are not (near) parallel the map is projective with the edges' intersection O as origin; if they are near parallel an affine map is used. Returns undefined for a degenerate edge, near-coincident parallel edges, or a segment crossing the preimage of infinity.
 */
function projectSegmentsToParallelRootLeaf(
  segments: readonly Segment2[],
  toleranceMeters: number,
): readonly Segment2[] | undefined {
  const root = segments[0];
  const leaf = segments[1];
  const rootDirection = sub2(root.end, root.start);
  const leafDirection = sub2(leaf.end, leaf.start);
  const rootLength = length2(rootDirection);
  const leafLength = length2(leafDirection);

  if (rootLength <= toleranceMeters || leafLength <= toleranceMeters) {
    return undefined;
  }

  const directionCross = cross2(rootDirection, leafDirection);

  if (Math.abs(directionCross) <= areaTolerance(rootLength, leafLength, toleranceMeters)) {
    return projectParallelSegmentsToAffineFrame(segments, toleranceMeters);
  }

  const rootToLeaf = sub2(leaf.start, root.start);
  const rootParameter = cross2(rootToLeaf, leafDirection) / directionCross;
  const intersection = add2(root.start, scale2(rootDirection, rootParameter));

  return projectIntersectingSegmentsToParallelFrame(segments, intersection, rootDirection, leafDirection, toleranceMeters);
}

/**
 * Affine frame for (near-)parallel root and leaf edges: x is the position along the root edge direction (0 at the root start, 1 at its end) and y is the signed distance to the root line in units of the root-leaf separation, so the root edge has y = 0 and the leaf line y = 1.
 */
function projectParallelSegmentsToAffineFrame(
  segments: readonly Segment2[],
  toleranceMeters: number,
): readonly Segment2[] | undefined {
  const root = segments[0];
  const leaf = segments[1];
  const rootDirection = sub2(root.end, root.start);
  const rootLength = length2(rootDirection);
  const rootLengthSquared = dot2(rootDirection, rootDirection);
  const denominator = cross2(rootDirection, sub2(leaf.start, root.start));

  if (rootLength <= toleranceMeters || Math.abs(denominator) <= toleranceMeters * rootLength) {
    return undefined;
  }

  return segments.map((segment) => ({
    start: projectParallelPoint(segment.start, root.start, rootDirection, rootLengthSquared, denominator),
    end: projectParallelPoint(segment.end, root.start, rootDirection, rootLengthSquared, denominator),
  }));
}

/**
 * Coordinates (x, y) of a point in the frame defined by origin, x-axis vector and the y normalization.
 */
function projectParallelPoint(
  point: Vec2,
  origin: Vec2,
  xAxis: Vec2,
  xAxisLengthSquared: number,
  yDenominator: number,
): Vec2 {
  const offset = sub2(point, origin);

  return {
    x: dot2(offset, xAxis) / xAxisLengthSquared,
    y: cross2(xAxis, offset) / yDenominator,
  };
}

/**
 * Projective map for intersecting root and leaf lines: writing a point as O + u * rootDirection + v * leafDirection, the map sends (u, v) to (u / (u + v), 1 / (u + v)).
 * The root line (v = 0) lands on x = 1 and the leaf line (u = 0) on x = 0, so they become parallel; the line u + v = 0 goes to infinity. Lines map to lines, so segments map to segments provided they do not cross that line, which is why such segments make the function return undefined.
 */
function projectIntersectingSegmentsToParallelFrame(
  segments: readonly Segment2[],
  intersection: Vec2,
  rootDirection: Vec2,
  leafDirection: Vec2,
  toleranceMeters: number,
): readonly Segment2[] | undefined {
  const basisDeterminant = cross2(rootDirection, leafDirection);
  const rootLength = length2(rootDirection);
  const leafLength = length2(leafDirection);

  if (
    rootLength <= toleranceMeters ||
    leafLength <= toleranceMeters ||
    Math.abs(basisDeterminant) <= areaTolerance(rootLength, leafLength, toleranceMeters)
  ) {
    return undefined;
  }

  const projected: Segment2[] = [];

  for (const segment of segments) {
    const startCoordinates = intersectingBasisCoordinates(
      segment.start,
      intersection,
      rootDirection,
      leafDirection,
      basisDeterminant,
    );
    const endCoordinates = intersectingBasisCoordinates(
      segment.end,
      intersection,
      rootDirection,
      leafDirection,
      basisDeterminant,
    );

    if (crossesProjectiveInfinity(startCoordinates, endCoordinates, toleranceMeters)) {
      return undefined;
    }

    const start = projectIntersectingCoordinates(startCoordinates, toleranceMeters);
    const end = projectIntersectingCoordinates(endCoordinates, toleranceMeters);

    if (!start || !end) {
      return undefined;
    }

    projected.push({ start, end });
  }

  return projected;
}

/**
 * Coordinates (u, v) of a point in the (non-orthogonal) basis (rootDirection, leafDirection) centered at the lines' intersection.
 */
function intersectingBasisCoordinates(
  point: Vec2,
  intersection: Vec2,
  rootDirection: Vec2,
  leafDirection: Vec2,
  basisDeterminant: number,
): Vec2 {
  const offset = sub2(point, intersection);

  return {
    x: cross2(offset, leafDirection) / basisDeterminant,
    y: cross2(rootDirection, offset) / basisDeterminant,
  };
}

/**
 * True if the segment's endpoints have projective denominators u + v of opposite sign, i.e. the segment crosses the line sent to infinity.
 */
function crossesProjectiveInfinity(start: Vec2, end: Vec2, toleranceMeters: number): boolean {
  const startDenominator = start.x + start.y;
  const endDenominator = end.x + end.y;

  return startDenominator * endDenominator < -toleranceMeters * toleranceMeters;
}

/**
 * Applies (u, v) -> (u / (u + v), 1 / (u + v)); undefined if |u + v| is within tolerance.
 */
function projectIntersectingCoordinates(coordinates: Vec2, toleranceMeters: number): Vec2 | undefined {
  const denominator = coordinates.x + coordinates.y;

  if (Math.abs(denominator) <= toleranceMeters) {
    return undefined;
  }

  return {
    x: coordinates.x / denominator,
    y: 1 / denominator,
  };
}

/**
 * Tolerance on a cross product of two edge directions: toleranceMeters times the larger edge length, at least toleranceMeters.
 */
function areaTolerance(firstLength: number, secondLength: number, toleranceMeters: number): number {
  return toleranceMeters * Math.max(firstLength, secondLength, 1);
}

/**
 * Affine function (as a half-plane) f(tau, sigma) = orient(P(tau), Q(sigma), point), whose sign says on which side of line PQ the point lies.
 * Only valid when the root and leaf edges are parallel, which removes the tau * sigma term; the coefficients are read off the values at (0,0), (1,0) and (0,1).
 */
function tauSigmaLineForPoint(rootPortal: Segment2, leafPortal: Segment2, point: Vec2): HalfPlane2 {
  const value00 = orient2(rootPortal.start, leafPortal.start, point);
  const value10 = orient2(rootPortal.end, leafPortal.start, point);
  const value01 = orient2(rootPortal.start, leafPortal.end, point);

  return {
    a: value10 - value00,
    b: value01 - value00,
    c: value00,
  };
}

/**
 * Affine function of tau (or sigma) equal to the orientation of the moving edge point relative to the window's supporting line.
 */
function parameterLineForPointOnSegment(
  lineSegment: Segment2,
  parameterStart: Vec2,
  parameterEnd: Vec2,
  parameterName: "tau" | "sigma",
): HalfPlane2 {
  const valueAtStart = orient2(lineSegment.start, lineSegment.end, parameterStart);
  const valueAtEnd = orient2(lineSegment.start, lineSegment.end, parameterEnd);
  const slope = valueAtEnd - valueAtStart;

  return parameterName === "tau"
    ? {
        a: slope,
        b: 0,
        c: valueAtStart,
      }
    : {
        a: 0,
        b: slope,
        c: valueAtStart,
      };
}

/**
 * The square [0,1]^2 as a counterclockwise polygon.
 */
function unitTauSigmaSquare(): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
}

/**
 * Drops polygons of area at most tolerance squared and duplicates (same vertex set after rounding to the tolerance).
 */
function pruneTauSigmaDomains(domains: readonly Vec2[][], toleranceMeters: number): Vec2[][] {
  const seen = new Set<string>();
  const pruned: Vec2[][] = [];

  for (const domain of domains) {
    if (polygonArea(domain) <= toleranceMeters * toleranceMeters) {
      continue;
    }

    const key = polygonKey(domain, toleranceMeters);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    pruned.push(domain);
  }

  return pruned;
}

/**
 * Absolute area by the shoelace formula.
 */
function polygonArea(polygon: readonly Vec2[]): number {
  let twiceArea = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(twiceArea) / 2;
}

/**
 * Order-independent key of a polygon's vertices rounded to the tolerance, used for de-duplication.
 */
function polygonKey(polygon: readonly Vec2[], toleranceMeters: number): string {
  const scale = 1 / Math.max(toleranceMeters, 1e-9);

  return polygon
    .map((point) => `${Math.round(point.x * scale)},${Math.round(point.y * scale)}`)
    .sort()
    .join(";");
}

/**
 * Sutherland-Hodgman clip of a convex polygon against {a p + b q + c >= 0}; returns an empty array if nothing remains.
 * Vertices closer than the tolerance are merged afterwards.
 */
function clipConvexPolygonByHalfPlane(
  polygon: readonly Vec2[],
  halfPlane: HalfPlane2,
  toleranceMeters: number,
): Vec2[] {
  if (polygon.length === 0) {
    return [];
  }

  const clipped: Vec2[] = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentValue = evaluateHalfPlane(halfPlane, current);
    const nextValue = evaluateHalfPlane(halfPlane, next);
    const currentInside = currentValue >= 0;
    const nextInside = nextValue >= 0;

    if (currentInside && nextInside) {
      clipped.push(next);
      continue;
    }

    if (currentInside !== nextInside) {
      clipped.push(intersectTauSigmaEdge(current, next, currentValue, nextValue));
    }

    if (!currentInside && nextInside) {
      clipped.push(next);
    }
  }

  return dedupePolygonVertices(clipped, toleranceMeters);
}

/**
 * Point where the edge from start to end meets the zero set, by linear interpolation of the two function values.
 */
function intersectTauSigmaEdge(start: Vec2, end: Vec2, startValue: number, endValue: number): Vec2 {
  const alpha = startValue / (startValue - endValue);

  return {
    x: start.x + (end.x - start.x) * alpha,
    y: start.y + (end.y - start.y) * alpha,
  };
}

/**
 * Removes consecutive (and wrap-around) vertices within the tolerance of each other.
 */
function dedupePolygonVertices(vertices: readonly Vec2[], toleranceMeters: number): Vec2[] {
  const deduped: Vec2[] = [];

  for (const vertex of vertices) {
    const previous = deduped[deduped.length - 1];

    if (!previous || Math.hypot(vertex.x - previous.x, vertex.y - previous.y) > toleranceMeters) {
      deduped.push(vertex);
    }
  }

  const first = deduped[0];
  const last = deduped[deduped.length - 1];

  if (first && last && deduped.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) <= toleranceMeters) {
    deduped.pop();
  }

  return deduped;
}

function negateHalfPlane(halfPlane: HalfPlane2): HalfPlane2 {
  return {
    a: -halfPlane.a,
    b: -halfPlane.b,
    c: -halfPlane.c,
  };
}

function evaluateHalfPlane(halfPlane: HalfPlane2, point: Vec2): number {
  return halfPlane.a * point.x + halfPlane.b * point.y + halfPlane.c;
}

function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale2(vector: Vec2, scale: number): Vec2 {
  return { x: vector.x * scale, y: vector.y * scale };
}

function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function length2(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

function interpolate2(start: Vec2, end: Vec2, parameter: number): Vec2 {
  return {
    x: start.x + (end.x - start.x) * parameter,
    y: start.y + (end.y - start.y) * parameter,
  };
}

/**
 * Twice the signed area of triangle (a, b, c): positive when c is to the left of the directed line a to b.
 */
function orient2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Tests the destination corners, given in the source cell's frame, against one crossed portal.
 * planeDistances are signed distances along the side's inward normal: positive on the cell side of the portal plane, negative beyond it. If no corner is beyond the plane by more than the tolerance, the destination cannot be seen through this portal. The vertical test rejects if all corners are below z = 0 or above the source cell height.
 */
function rejectAgainstPortalAperture(
  pathId: number,
  sourceCellId: string,
  side: CompiledPrismSide,
  sourceCellHeightMeters: number,
  boundInSource: readonly Vec3[],
  toleranceMeters: number,
  includeDetails: boolean | undefined,
): RejectedPortalRenderPath | undefined {
  const sideStart = vec3(side.start.x, side.start.y, 0);
  const inwardNormal = vec3(side.inwardNormal.x, side.inwardNormal.y, 0);
  // Signed distance in meters from each corner to the portal's side plane along the inward normal: positive on the cell's side, negative beyond the portal.
  const planeDistances = boundInSource.map((point) =>
    (point.x - sideStart.x) * inwardNormal.x + (point.y - sideStart.y) * inwardNormal.y,
  );

  if (planeDistances.every((distance) => distance > -toleranceMeters)) {
    return createGeometricRejection(
      pathId,
      "outside-ancestor-portal-plane",
      includeDetails,
      `${sourceCellId}:side-${side.sideIndex}`,
    );
  }

  if (
    boundInSource.every((point) => point.z < -toleranceMeters) ||
    boundInSource.every((point) => point.z > sourceCellHeightMeters + toleranceMeters)
  ) {
    return createGeometricRejection(
      pathId,
      "outside-ancestor-vertical-range",
      includeDetails,
      `${sourceCellId}:side-${side.sideIndex}`,
    );
  }

  return undefined;
}

/**
 * The 2n corners of the prism: each base vertex at z = 0 and z = height.
 */
function prismBoundVertices(
  baseVertices: readonly { readonly x: number; readonly y: number }[],
  heightMeters: number,
): readonly Vec3[] {
  return baseVertices.flatMap((vertex) => [vec3(vertex.x, vertex.y, 0), vec3(vertex.x, vertex.y, heightMeters)]);
}

/**
 * Builds a rejection record for an aperture test, naming the portal side.
 */
function createGeometricRejection(
  pathId: number,
  reason: StaticPortalPathRejectReason,
  includeDetails: boolean | undefined,
  portalLabel: string,
): RejectedPortalRenderPath {
  return {
    pathId,
    reason,
    ...(includeDetails ? { details: `Rejected path ${pathId} against ancestor portal ${portalLabel}.` } : {}),
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
