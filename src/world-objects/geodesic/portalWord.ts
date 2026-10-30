/**
 * Portal-word algebra of geodesic intervals: reversal, free reduction, comparison, role-aware sub-words and the update of a word when an anchor crosses a portal; pure, no registry access.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type {
  GeodesicCarryPortalTransition,
  GeodesicEndRole,
  GeodesicIntervalObject,
  GeodesicPortalTraversal,
  TraceGeodesicSegmentResult,
} from "./objects";

/**
 * Returns the inverse portal word: reversed order, with each traversal's source and target swapped.
 *
 * Reading an interval's word from its `end` toward its `start` uses this. Pure; involutive
 * (`reverse(reverse(w))` equals `w`).
 */
export function reverseGeodesicPortalWord(
  word: readonly GeodesicPortalTraversal[],
): readonly GeodesicPortalTraversal[] {
  return word.slice().reverse().map((traversal) => ({
    sourceCellId: traversal.targetCellId,
    sourcePortalId: traversal.targetPortalId,
    targetCellId: traversal.sourceCellId,
    targetPortalId: traversal.sourcePortalId,
  }));
}

/** Returns the interval's portal word read from `sourceRole` to `targetRole`: the stored word, its inverse, or empty when the roles are equal. */
export function getPortalWordBetweenEndpointRoles(input: {
  readonly interval: GeodesicIntervalObject;
  readonly sourceRole: GeodesicEndRole;
  readonly targetRole: GeodesicEndRole;
}): readonly GeodesicPortalTraversal[] {
  if (input.sourceRole === input.targetRole) {
    return [];
  }
  return input.sourceRole === "start"
    ? input.interval.portalWord
    : reverseGeodesicPortalWord(input.interval.portalWord);
}

// Reads the portal word off a trace chain: one traversal per `portal-hit` terminal, ids resolved from the world's portal table.
// A portal-hit whose portal is unknown to the world is skipped, which would silently shorten the word.
/** Portal word recorded by the `portal-hit` pieces of a trace. */
export function collectPortalWordFromTraces(
  world: CompiledCellComplex,
  traces: readonly TraceGeodesicSegmentResult[],
): readonly GeodesicPortalTraversal[] {
  return traces.flatMap((trace) => {
    if (trace.terminal.kind !== "portal-hit") {
      return [];
    }
    const portal = world.cellsById.get(trace.cellId)?.portalsById.get(trace.terminal.portalId);
    return portal
      ? [{
          sourceCellId: trace.cellId,
          sourcePortalId: portal.id,
          targetCellId: portal.targetCellId,
          targetPortalId: portal.targetPortalId,
        }]
      : [];
  });
}

// Element-wise equality of two portal words by all four ids.
/** Element-wise equality of two portal words. */
export function samePortalWord(
  left: readonly GeodesicPortalTraversal[],
  right: readonly GeodesicPortalTraversal[],
): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.sourceCellId === other.sourceCellId &&
      entry.sourcePortalId === other.sourcePortalId &&
      entry.targetCellId === other.targetCellId &&
      entry.targetPortalId === other.targetPortalId;
  });
}

/** The portal traversal that a carry portal transition records. */
export function portalTraversalFromCarryTransition(
  transition: GeodesicCarryPortalTransition,
): GeodesicPortalTraversal {
  return {
    sourceCellId: transition.sourceCellId,
    sourcePortalId: transition.sourcePortalId,
    targetCellId: transition.targetCellId,
    targetPortalId: transition.targetPortalId,
  };
}

/** The portal traversal that leaves `sourceCellId` through the given portal. */
export function getPortalTraversalFromSource(
  world: CompiledCellComplex,
  sourceCellId: string,
  sourcePortalId: string,
): GeodesicPortalTraversal | undefined {
  const portal = world.cellsById.get(sourceCellId)?.portalsById.get(sourcePortalId);
  return portal
    ? {
        sourceCellId,
        sourcePortalId: portal.id,
        targetCellId: portal.targetCellId,
        targetPortalId: portal.targetPortalId,
      }
    : undefined;
}

// Free reduction of a word: cancels each traversal against an immediately preceding inverse one (a stack-based pass), so
// crossing a portal and returning through it leaves no trace in the homotopy class.
// New portal word of `interval` after anchor `anchorObjectId` crossed a portal by `traversal`. The `end` role appends the
// traversal (the path gains one crossing at its end); the `start` role prepends its inverse (the path first steps back across
// the portal). When both roles sit on the anchor (a loop) both apply, which conjugates the word: w -> p^-1 w p. The result is
// freely reduced. Returns undefined when neither role is on the anchor. Does not check the cell chain; callers do.
/** Portal word of an interval after one of its anchors crossed a portal. */
export function portalWordAfterAnchorCrossing(input: {
  readonly interval: GeodesicIntervalObject;
  readonly anchorObjectId: string;
  readonly traversal: GeodesicPortalTraversal;
}): readonly GeodesicPortalTraversal[] | undefined {
  const movesStart = input.interval.start.anchorObjectId === input.anchorObjectId;
  const movesEnd = input.interval.end.anchorObjectId === input.anchorObjectId;
  if (!movesStart && !movesEnd) {
    return undefined;
  }
  let word: readonly GeodesicPortalTraversal[] = input.interval.portalWord;
  if (movesEnd) {
    word = [...word, input.traversal];
  }
  if (movesStart) {
    word = [reverseGeodesicPortalWord([input.traversal])[0], ...word];
  }
  return reduceAdjacentInversePortalTraversals(word);
}

/**
 * Applies {@link portalWordAfterAnchorCrossing} once per traversal, in order, feeding each resulting word into the next.
 * Returns `undefined` if any step fails (the anchor is not an endpoint of the interval).
 */
export function applyAnchorCrossingTraversals(input: {
  readonly interval: GeodesicIntervalObject;
  readonly anchorObjectId: string;
  readonly traversals: readonly GeodesicPortalTraversal[];
}): readonly GeodesicPortalTraversal[] | undefined {
  let interval = input.interval;
  let word: readonly GeodesicPortalTraversal[] | undefined;
  for (const traversal of input.traversals) {
    word = portalWordAfterAnchorCrossing({ interval, anchorObjectId: input.anchorObjectId, traversal });
    if (!word) {
      return undefined;
    }
    interval = { ...interval, portalWord: word };
  }
  return word;
}

/** Freely reduces a portal word by cancelling adjacent inverse traversals. */
export function reduceAdjacentInversePortalTraversals(
  word: readonly GeodesicPortalTraversal[],
): readonly GeodesicPortalTraversal[] {
  const reduced: GeodesicPortalTraversal[] = [];
  for (const traversal of word) {
    const previous = reduced.at(-1);
    if (previous && portalTraversalsAreInverse(previous, traversal)) {
      reduced.pop();
      continue;
    }
    reduced.push(traversal);
  }
  return reduced;
}

function portalTraversalsAreInverse(
  left: GeodesicPortalTraversal,
  right: GeodesicPortalTraversal,
): boolean {
  return left.sourceCellId === right.targetCellId &&
    left.sourcePortalId === right.targetPortalId &&
    left.targetCellId === right.sourceCellId &&
    left.targetPortalId === right.sourcePortalId;
}
