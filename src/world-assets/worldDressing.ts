/**
 * Everything generated that dresses a world and that more than one consumer needs (design 018): the baked light direction of each cell, the
 * look of each face (theme and palette) and its landmarks.
 *
 * Computed once per compiled world and remembered, so the cell meshes, the ground tint and the player's collision all see the same landmarks.
 */
import { computeCellShadowAzimuths } from "../cell-complex/cellSun";
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { assignFaceLooks, type FaceLook } from "./faceThemeAssignment";
import { computeLandmarkLayout, type LandmarkPlacement } from "./landmarkLayout";

/** The generated dressing of a world. */
export interface WorldDressing {
  /** Per cell id, the direction in which shadows fall (radians from +x toward +y, cell-local). */
  readonly shadowAzimuthByCellId: ReadonlyMap<string, number>;
  /** Per themed cell id, its theme and palette. */
  readonly lookByCellId: ReadonlyMap<string, FaceLook>;
  /** Per cell id, the generated landmarks. */
  readonly landmarksByCellId: ReadonlyMap<string, readonly LandmarkPlacement[]>;
}

const dressingByWorld = new WeakMap<CompiledCellComplex, WorldDressing>();

/** Computes (once per world object) the dressing of a compiled world. */
export function computeWorldDressing(world: CompiledCellComplex): WorldDressing {
  const known = dressingByWorld.get(world);

  if (known) {
    return known;
  }

  const start = world.startingPosition;
  const lookByCellId = assignFaceLooks(world);
  const dressing: WorldDressing = {
    shadowAzimuthByCellId: computeCellShadowAzimuths(world),
    lookByCellId,
    landmarksByCellId: new Map(
      world.cells.map((cell) => [
        cell.id,
        computeLandmarkLayout(cell, {
          startPosition: start && start.cellId === cell.id ? { x: start.position.x, y: start.position.y } : undefined,
          look: lookByCellId.get(cell.id),
        }),
      ]),
    ),
  };
  dressingByWorld.set(world, dressing);
  return dressing;
}
