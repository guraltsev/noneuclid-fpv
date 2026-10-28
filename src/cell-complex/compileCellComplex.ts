/**
 * Top-level compiler from an authored cell-complex spec to the runtime geometry used by movement and rendering.
 * Pipeline: validate the spec (cell ids, convex counterclockwise bases, reciprocal portal pairs), compile each prism cell's side geometry and junction cylinders, derive each portal's gluing transform from the two sides it joins, then link portals back onto their cells. Everything is expressed in per-cell local frames (x right/east, y forward, z up, meters); the only cross-cell information is each portal's rigid transform. The result is immutable and is the input to portal-path table construction.
 */
import { compilePortalTransforms } from "./compilePortalTransforms";
import { compilePrismCellGeometry, linkCompiledPrismCellPortals, type CompiledPrismCell } from "./prismCells";
import type { CellComplexSpec } from "./specs";
import { validateCellComplexSpec } from "./validateCellComplexSpec";

/**
 * Compiled world: all cells with portals linked, plus an id index and the optional authored starting position.
 */
export interface CompiledCellComplex {
  readonly cells: readonly CompiledPrismCell[];
  /**
   * Lookup of the same cell objects as `cells`, keyed by cell id.
   */
  readonly cellsById: ReadonlyMap<string, CompiledPrismCell>;
  /**
   * Authored starting pose (cell id, cell-local position, yaw/pitch in radians), passed through unchanged from the spec.
   */
  readonly startingPosition?: CellComplexSpec["startingPosition"];
}

/**
 * Options for {@link compileCellComplex}.
 */
export interface CompileCellComplexOptions {
  /**
   * Skips the check that glued sides have equal length. Only for tests that deliberately build ill-formed gluings
   * (for example to exercise topology-preservation validation); the portal map then matches side midpoints only.
   */
  readonly allowUnequalGluedSides?: boolean;
}

/**
 * Validates and compiles a {@link CellComplexSpec} into a {@link CompiledCellComplex}.
 * @throws Error listing every validation error if the spec is invalid (see validateCellComplexSpec), including glued sides of unequal length unless `options.allowUnequalGluedSides` is set.
 */
export function compileCellComplex(spec: CellComplexSpec, options: CompileCellComplexOptions = {}): CompiledCellComplex {
  const errors = validateCellComplexSpec(spec, { checkGluedSideLengths: !options.allowUnequalGluedSides });

  if (errors.length > 0) {
    throw new Error(`Invalid cell complex:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const cellGeometry = spec.cells.map(compilePrismCellGeometry);
  const cellGeometryById = new Map(cellGeometry.map((cell) => [cell.id, cell]));
  const compiledPortalsByCellId = compilePortalTransforms(spec, cellGeometryById);
  const cells = cellGeometry.map((cell) =>
    linkCompiledPrismCellPortals(cell, compiledPortalsByCellId.get(cell.id) ?? []),
  );

  return {
    cells,
    cellsById: new Map(cells.map((cell) => [cell.id, cell])),
    startingPosition: spec.startingPosition,
  };
}
