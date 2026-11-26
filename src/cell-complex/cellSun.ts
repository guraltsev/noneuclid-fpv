/**
 * The baked light direction of every cell (design 018 section 3).
 *
 * A polyhedral world cannot have one sun: carrying a horizontal direction around a corner turns it. So the direction the light comes from is a property of
 * each cell, baked into what is fixed in that cell (ground shadows, the shading of generated landmarks) and never into a light in the scene. It is carried
 * from cell to cell across portals along a breadth-first tree that starts at the first cell, so it is continuous across the tree's sides and jumps only
 * across the other sides: the jump is the holonomy of the surface made visible.
 */
import { transformDirection3 } from "../math/rigidTransform3";
import { vec3 } from "../math/vec3";
import type { CompiledPrismCell } from "./prismCells";

/** Direction the shadows of the first cell point to, as an angle in radians from the cell's +x axis toward +y. */
export const firstCellShadowAzimuthRadians = 2.2;

/**
 * Computes, per cell id, the azimuth (radians from +x toward +y, cell-local) of the direction in which shadows fall in that cell.
 * Cells not reachable from the first cell through portals get {@link firstCellShadowAzimuthRadians}.
 */
export function computeCellShadowAzimuths(world: { readonly cells: readonly CompiledPrismCell[] }): ReadonlyMap<string, number> {
  const azimuths = new Map<string, number>();
  const cellsById = new Map(world.cells.map((cell) => [cell.id, cell]));
  const first = world.cells[0];

  if (!first) {
    return azimuths;
  }

  azimuths.set(first.id, firstCellShadowAzimuthRadians);
  const queue: CompiledPrismCell[] = [first];

  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head];
    const azimuth = azimuths.get(cell.id) ?? firstCellShadowAzimuthRadians;
    const direction = vec3(Math.cos(azimuth), Math.sin(azimuth), 0);

    for (const portal of cell.portals) {
      const target = cellsById.get(portal.targetCellId);

      if (!target || azimuths.has(target.id)) {
        continue;
      }

      const carried = transformDirection3(portal.transformToTarget, direction);
      azimuths.set(target.id, Math.atan2(carried.y, carried.x));
      queue.push(target);
    }
  }

  for (const cell of world.cells) {
    if (!azimuths.has(cell.id)) {
      azimuths.set(cell.id, firstCellShadowAzimuthRadians);
    }
  }

  return azimuths;
}
