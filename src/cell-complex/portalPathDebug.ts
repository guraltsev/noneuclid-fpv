/**
 * Debugging helpers that explain what happened to a portal path during table construction and static culling.
 * A path is described as a space-separated string of side indices, e.g. "2 0 1", read as the word of portals crossed starting at a root cell. The checker replays the word on the compiled world, finds the matching path in the candidate (unculled) table, and reports whether it survived the static cull and, if not, why. Nothing here affects rendering or movement.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import type { PortalPathTable, PortalPathTablesByRootCell, PortalRenderStep } from "./portalPaths";
import type {
  StaticPortalPathCullSummary,
  StaticPortalPathRejectReason,
  StaticPortalPathCullResult,
} from "./staticPortalPathCull";

/**
 * Counts summarizing the candidate and culled path tables of the current root cell, for a debug overlay.
 */
export interface PortalPathDebugState {
  readonly currentRootCellId: string;
  readonly maxDepth: number;
  /**
   * Paths in the unculled table for the root cell (including the root path).
   */
  readonly candidatePathCount: number;
  /**
   * Paths surviving static culling (equal to candidatePathCount if no cull was supplied).
   */
  readonly keptPathCount: number;
  readonly rejectedPathCountByReason: ReadonlyMap<StaticPortalPathRejectReason, number>;
  /**
   * Greatest depth present among the candidate paths (0 if there are none).
   */
  readonly maximumAvailablePathDepth: number;
  /**
   * True if at least one path was rejected with reason "static-path-budget".
   */
  readonly staticPathBudgetExhausted: boolean;
}

/**
 * Inputs for {@link checkPortalPathString}: the world, the root cell and the unculled and (optionally) culled tables and cull summaries.
 */
export interface PortalPathCheckContext {
  readonly world: CompiledCellComplex;
  readonly rootCellId: string;
  readonly candidateTables: PortalPathTablesByRootCell;
  readonly keptTables?: PortalPathTablesByRootCell;
  readonly cullSummariesByRootCellId?: ReadonlyMap<string, StaticPortalPathCullSummary>;
}

/**
 * Outcome of replaying a portal-word string against the compiled world and path tables.
 */
export interface PortalPathCheckResult {
  /**
   * False if the text was not a list of non-negative integers.
   */
  readonly parsed: boolean;
  readonly requestedPortalIndices: readonly number[];
  /**
   * True if every index named a portal in the cell reached at that point.
   */
  readonly valid: boolean;
  readonly errors: readonly string[];
  /**
   * Non-fatal notes, present only when non-empty; currently the warning that a token was resolved as a portal-array index because no portal has that side index.
   */
  readonly warnings?: readonly string[];
  readonly rootCellId: string;
  readonly destinationCellId?: string;
  readonly steps: readonly PortalRenderStep[];
  /**
   * Id of the candidate-table path with the same steps, if one exists.
   */
  readonly matchedPathId?: number;
  /**
   * True if a path with these steps is in the candidate table (it may be absent because of the depth limit or immediate-reverse skipping).
   */
  readonly existsInBuiltTable: boolean;
  /**
   * True if the matched path is also in the culled table (or no culled table was supplied).
   */
  readonly survivedStaticCull: boolean;
  /**
   * Why static culling rejected the matched path, if a cull summary with rejection records was supplied and contains it.
   */
  readonly rejectionReason?: StaticPortalPathRejectReason;
}

/**
 * Summarizes candidate and culled path counts for one root cell.
 * Falls back to the candidate table when no cull result is given, and to zero counts for an unknown root.
 */
export function createPortalPathDebugState(
  rootCellId: string,
  candidateTables: PortalPathTablesByRootCell,
  staticCull?: StaticPortalPathCullResult,
): PortalPathDebugState {
  const candidateTable = candidateTables.tablesByRootCellId.get(rootCellId);
  const keptTable = staticCull?.tables.tablesByRootCellId.get(rootCellId) ?? candidateTable;
  const summary = staticCull?.summariesByRootCellId.get(rootCellId);
  const rejectedPathCountByReason = summary?.rejectedByReason ?? new Map<StaticPortalPathRejectReason, number>();

  return {
    currentRootCellId: rootCellId,
    maxDepth: candidateTables.maxDepth,
    candidatePathCount: candidateTable?.paths.length ?? 0,
    keptPathCount: keptTable?.paths.length ?? 0,
    rejectedPathCountByReason,
    maximumAvailablePathDepth: Math.max(0, ...(candidateTable?.paths.map((path) => path.depth) ?? [0])),
    staticPathBudgetExhausted: (rejectedPathCountByReason.get("static-path-budget") ?? 0) > 0,
  };
}

/**
 * Parses a string of side indices, replays it from `context.rootCellId` and reports how the resulting path fared in the tables.
 * Each token is resolved first as a side index (portalBySideIndex). Only if no portal has that side index and the token is a valid index into the cell's portal array does it fall back to the array position, and that fallback adds a message to `warnings` because the token may not mean what the caller intended; an out-of-range token is an error. Paths are matched by cell and portal ids only. Path ids in the cull summary refer to the table the cull ran over, so rejection reasons are meaningful only when the summaries came from culling these same candidate tables (see staticallyCullPortalPathTables); an empty string denotes the root path.
 */
export function checkPortalPathString(pathText: string, context: PortalPathCheckContext): PortalPathCheckResult {
  const parsed = parsePortalPathText(pathText);

  if (!parsed.ok) {
    return {
      parsed: false,
      requestedPortalIndices: [],
      valid: false,
      errors: parsed.errors,
      rootCellId: context.rootCellId,
      steps: [],
      existsInBuiltTable: false,
      survivedStaticCull: false,
    };
  }

  const candidateTable = context.candidateTables.tablesByRootCellId.get(context.rootCellId);
  const keptTable = context.keptTables?.tablesByRootCellId.get(context.rootCellId) ?? candidateTable;
  const steps: PortalRenderStep[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let currentCellId = context.rootCellId;

  for (const portalIndex of parsed.indices) {
    const cell = context.world.cellsById.get(currentCellId);
    let portal = cell?.portalBySideIndex.get(portalIndex);

    if (cell && !portal && portalIndex < cell.portals.length) {
      portal = cell.portals[portalIndex];
      warnings.push(
        `Token "${portalIndex}" is not a portal side index of cell "${currentCellId}"; resolved it as portal-array index to portal "${portal.id}" (side ${portal.sideIndex}).`,
      );
    }

    if (!cell || !portal) {
      errors.push(`No portal "${portalIndex}" from cell "${currentCellId}".`);
      break;
    }

    steps.push({
      sourceCellId: cell.id,
      sourcePortalId: portal.id,
      sourcePortalSideIndex: portal.sideIndex,
      targetCellId: portal.targetCellId,
      targetPortalId: portal.targetPortalId,
    });
    currentCellId = portal.targetCellId;
  }

  const matchedPath = errors.length === 0 && candidateTable ? findMatchingPath(candidateTable, steps) : undefined;
  const keptPath = matchedPath && keptTable ? keptTable.pathsById.get(matchedPath.id) : undefined;
  const rejectedPath = matchedPath
    ? context.cullSummariesByRootCellId
        ?.get(context.rootCellId)
        ?.rejectedPaths.find((path) => path.pathId === matchedPath.id)
    : undefined;

  return {
    parsed: true,
    requestedPortalIndices: parsed.indices,
    valid: errors.length === 0,
    errors,
    ...(warnings.length > 0 ? { warnings } : {}),
    rootCellId: context.rootCellId,
    destinationCellId: errors.length === 0 ? currentCellId : undefined,
    steps,
    matchedPathId: matchedPath?.id,
    existsInBuiltTable: matchedPath !== undefined,
    survivedStaticCull: keptPath !== undefined,
    rejectionReason: rejectedPath?.reason,
  };
}

function parsePortalPathText(pathText: string): { readonly ok: true; readonly indices: readonly number[] } | { readonly ok: false; readonly errors: readonly string[] } {
  const trimmed = pathText.trim();

  if (!trimmed) {
    return { ok: true, indices: [] };
  }

  const indices: number[] = [];
  const errors: string[] = [];

  for (const token of trimmed.split(/\s+/)) {
    const value = Number(token);

    if (!Number.isInteger(value) || value < 0) {
      errors.push(`Portal path token "${token}" is not a non-negative integer.`);
      continue;
    }

    indices.push(value);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, indices };
}

/**
 * Linear search for the path whose steps equal the replayed steps (cell and portal ids only).
 */
function findMatchingPath(table: PortalPathTable, steps: readonly PortalRenderStep[]) {
  return table.paths.find((path) => {
    if (path.steps.length !== steps.length) {
      return false;
    }

    return path.steps.every((step, index) => {
      const expected = steps[index];

      return (
        step.sourceCellId === expected.sourceCellId &&
        step.sourcePortalId === expected.sourcePortalId &&
        step.targetCellId === expected.targetCellId &&
        step.targetPortalId === expected.targetPortalId
      );
    });
  });
}
