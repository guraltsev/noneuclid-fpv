/**
 * Cell-complex spec validator: structural checks on a CellComplexSpec before it is compiled (authoring spec -> compiled complex stage).
 * Returns human-readable error strings instead of throwing so the compiler can report all problems at once. It checks cell ids, base polygon size (3-8 vertices), finite base coordinates, counterclockwise strictly convex orientation in the cell's x/y plane, finite positive height, portal side indices, at most one portal per side, reciprocity of portal pairs (no self-targeting portals), equal length of glued sides (within gluedSideLengthToleranceMeters), and the starting position; it does not check unequal cell heights across a portal or object contents.
 */
import type { CellComplexSpec } from "./specs";

/**
 * Optional switches for `validateCellComplexSpec`.
 */
export interface ValidateCellComplexSpecOptions {
  /**
   * Whether to report glued sides whose lengths differ by more than gluedSideLengthToleranceMeters (default true).
   * compileCellComplex passes false because deformation code deliberately builds length-mismatched complexes and reports them itself (validateTopologyPreservingSnapshot).
   */
  readonly checkGluedSideLengths?: boolean;
}

/** Largest allowed length difference, in meters, between the two sides glued by a portal pair. */
export const gluedSideLengthToleranceMeters = 1e-6;

/**
 * Validates a world spec and returns the list of problems found, empty when valid.
 * Every portal must target an existing portal that targets it back; a portal may not target itself, two portals may not share a side of one cell, and glued sides must have equal length (unless options.checkGluedSideLengths is false). Units: heights in meters, angles in radians.
 */
export function validateCellComplexSpec(
  spec: CellComplexSpec,
  options: ValidateCellComplexSpecOptions = {},
): readonly string[] {
  const checkGluedSideLengths = options.checkGluedSideLengths ?? true;
  const errors: string[] = [];
  const cellsById = new Map<string, CellComplexSpec["cells"][number]>();

  if (spec.cells.length === 0) {
    errors.push("A world spec must contain at least one cell.");
  }

  for (const cell of spec.cells) {
    if (cellsById.has(cell.id)) {
      errors.push(`Duplicate cell id "${cell.id}".`);
    } else {
      cellsById.set(cell.id, cell);
    }

    if (cell.baseVertices.length < 3) {
      errors.push(`Cell "${cell.id}" must have at least 3 base vertices.`);
    }

    if (cell.baseVertices.length > 8) {
      errors.push(`Cell "${cell.id}" must have at most 8 base vertices.`);
    }

    const baseValidationError = validatePrismBase(cell.baseVertices);

    if (baseValidationError) {
      errors.push(`Cell "${cell.id}" ${baseValidationError}`);
    }

    if (!Number.isFinite(cell.heightMeters)) {
      errors.push(`Cell "${cell.id}" must have a finite height.`);
    } else if (cell.heightMeters <= 0) {
      errors.push(`Cell "${cell.id}" must have a positive height.`);
    }

    cell.baseVertices.forEach((vertex, vertexIndex) => {
      if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
        errors.push(`Cell "${cell.id}" base vertex ${vertexIndex} must have finite coordinates.`);
      }
    });

    const portalIds = new Set<string>();
    const portalIdBySide = new Map<number, string>();

    for (const portal of cell.portals) {
      if (portalIds.has(portal.id)) {
        errors.push(`Cell "${cell.id}" has duplicate portal id "${portal.id}".`);
      } else {
        portalIds.add(portal.id);
      }

      if (!Number.isInteger(portal.sideIndex) || portal.sideIndex < 0 || portal.sideIndex >= cell.baseVertices.length) {
        errors.push(
          `Portal "${cell.id}:${portal.id}" has sideIndex ${portal.sideIndex}, expected 0-${cell.baseVertices.length - 1}.`,
        );
      } else {
        const otherPortalId = portalIdBySide.get(portal.sideIndex);

        if (otherPortalId !== undefined) {
          errors.push(
            `Portals "${cell.id}:${otherPortalId}" and "${cell.id}:${portal.id}" are both on sideIndex ${portal.sideIndex}.`,
          );
        } else {
          portalIdBySide.set(portal.sideIndex, portal.id);
        }
      }
    }
  }

  for (const cell of spec.cells) {
    for (const portal of cell.portals) {
      const targetCell = cellsById.get(portal.targetCellId);

      if (!targetCell) {
        errors.push(`Portal "${cell.id}:${portal.id}" targets missing cell "${portal.targetCellId}".`);
        continue;
      }

      const targetPortal = targetCell.portals.find((candidate) => candidate.id === portal.targetPortalId);

      if (!targetPortal) {
        errors.push(
          `Portal "${cell.id}:${portal.id}" targets missing portal "${portal.targetCellId}:${portal.targetPortalId}".`,
        );
        continue;
      }

      if (targetCell === cell && targetPortal === portal) {
        errors.push(`Portal "${cell.id}:${portal.id}" targets itself.`);
        continue;
      }

      if (targetPortal.targetCellId !== cell.id || targetPortal.targetPortalId !== portal.id) {
        errors.push(
          `Portal "${cell.id}:${portal.id}" is not reciprocated by "${targetCell.id}:${targetPortal.id}".`,
        );
        continue;
      }

      const sideLength = sideLengthMeters(cell, portal.sideIndex);
      const targetSideLength = sideLengthMeters(targetCell, targetPortal.sideIndex);

      if (
        checkGluedSideLengths &&
        sideLength !== undefined &&
        targetSideLength !== undefined &&
        Math.abs(sideLength - targetSideLength) > gluedSideLengthToleranceMeters
      ) {
        errors.push(
          `Portal "${cell.id}:${portal.id}" glues a side of length ${sideLength} m to "${targetCell.id}:${targetPortal.id}" of length ${targetSideLength} m; glued sides must have equal length.`,
        );
      }
    }
  }

  if (spec.startingPosition) {
    if (!cellsById.has(spec.startingPosition.cellId)) {
      errors.push(`Starting position targets missing cell "${spec.startingPosition.cellId}".`);
    }

    for (const [axis, value] of Object.entries(spec.startingPosition.position)) {
      if (!Number.isFinite(value)) {
        errors.push(`Starting position ${axis} coordinate must be finite.`);
      }
    }

    if (
      spec.startingPosition.yawRadians !== undefined &&
      !Number.isFinite(spec.startingPosition.yawRadians)
    ) {
      errors.push("Starting position yawRadians must be finite.");
    }

    if (
      spec.startingPosition.pitchRadians !== undefined &&
      !Number.isFinite(spec.startingPosition.pitchRadians)
    ) {
      errors.push("Starting position pitchRadians must be finite.");
    }
  }

  return errors;
}

// Returns an error fragment if the polygon is not counterclockwise (shoelace signed area <= 0) or has a non-left turn at any vertex (cross product of consecutive edges <= 0); undefined when strictly convex.
function validatePrismBase(
  vertices: readonly { readonly x: number; readonly y: number }[],
): string | undefined {
  if (vertices.length < 3) {
    return undefined;
  }

  let signedAreaTwice = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    // Shoelace formula: accumulates twice the signed area; positive means counterclockwise.
    signedAreaTwice += current.x * next.y - next.x * current.y;
  }

  if (signedAreaTwice <= 0) {
    return "must list baseVertices in counterclockwise order in the x/y plane.";
  }

  for (let index = 0; index < vertices.length; index += 1) {
    const prev = vertices[(index + vertices.length - 1) % vertices.length];
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const edgeAX = current.x - prev.x;
    const edgeAY = current.y - prev.y;
    const edgeBX = next.x - current.x;
    const edgeBY = next.y - current.y;
    // z-component of the cross product of consecutive edges; positive is a left (counterclockwise) turn. A strictly convex CCW polygon has only positive turns.
    const turn = edgeAX * edgeBY - edgeAY * edgeBX;

    if (turn <= 0) {
      return "must be strictly convex; non-convex prism cells are not supported.";
    }
  }

  return undefined;
}

// Length in meters of side `sideIndex` (base vertex i to i + 1, wrapping); undefined for an invalid index or non-finite result so earlier errors are not duplicated.
function sideLengthMeters(cell: CellComplexSpec["cells"][number], sideIndex: number): number | undefined {
  if (!Number.isInteger(sideIndex) || sideIndex < 0 || sideIndex >= cell.baseVertices.length) {
    return undefined;
  }

  const start = cell.baseVertices[sideIndex];
  const end = cell.baseVertices[(sideIndex + 1) % cell.baseVertices.length];
  const length = Math.hypot(end.x - start.x, end.y - start.y);

  return Number.isFinite(length) ? length : undefined;
}
