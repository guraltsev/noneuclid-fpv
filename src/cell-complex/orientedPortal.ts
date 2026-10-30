/**
 * Oriented portal segments: a portal side developed into a root cell's plan, with its left and right endpoints as seen when leaving the source cell through it.
 * Cells are counterclockwise, so facing out of a cell through side i (running from base vertex i to vertex i + 1) the end vertex is on the left and the start vertex on the right. Gluing maps are rotations about z plus translations, so they preserve left and right; the developed segment keeps the orientation. Used by the static line-cone cull and by the per-frame visibility code.
 */
import type { CompiledCellComplex } from "./compileCellComplex";
import type { Vec2xy } from "../math/polygons";
import { transformPoint3, type RigidTransform3 } from "../math/rigidTransform3";
import { vec3 } from "../math/vec3";

/**
 * A portal side developed into a root frame's plan; `left`/`right` as seen when leaving the source cell through it.
 */
export interface OrientedPortalSegment {
  /** Image of the side's end vertex, meters, root frame. */
  readonly left: Vec2xy;
  /** Image of the side's start vertex, meters, root frame. */
  readonly right: Vec2xy;
  /** min(source cell height, target cell height), meters. */
  readonly apertureTopMeters: number;
}

/**
 * Develops side `sideIndex` of cell `sourceCellId` into the root frame with `rootFromSource` (z of the side vertices is taken as 0).
 * @throws Error if the cell or side is missing.
 */
export function developPortalSegment(
  world: CompiledCellComplex,
  sourceCellId: string,
  sideIndex: number,
  rootFromSource: RigidTransform3,
): OrientedPortalSegment {
  const cell = world.cellsById.get(sourceCellId);
  const side = cell?.sides[sideIndex];

  if (!cell || !side) {
    throw new Error(`Cannot develop portal: missing cell "${sourceCellId}" or side ${sideIndex}.`);
  }

  const portal = cell.portalBySideIndex.get(sideIndex);
  const target = portal ? world.cellsById.get(portal.targetCellId) : undefined;
  const right = transformPoint3(rootFromSource, vec3(side.start.x, side.start.y, 0));
  const left = transformPoint3(rootFromSource, vec3(side.end.x, side.end.y, 0));

  return {
    left: { x: left.x, y: left.y },
    right: { x: right.x, y: right.y },
    apertureTopMeters: target ? Math.min(cell.heightMeters, target.heightMeters) : cell.heightMeters,
  };
}
