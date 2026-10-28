/**
 * Defines AppState, the initial immutable bundle of compiled world, player body and player pose that main.ts hands to the renderer, and the factory that builds it.
 * The player starts at the world's declared startingPosition (cell, local position, yaw, pitch) or, if absent, at a default pose in the first compiled cell.
 * The renderer treats this as seed data and keeps its own mutable per-frame state afterwards.
 */
import type { CompiledCellComplex } from "./cell-complex/compileCellComplex";
import { createDefaultPlayerBody, type PlayerBody } from "./movement/playerBody";
import { createDefaultPlayerPose, type PlayerPose } from "./movement/playerPose";

/**
 * Initial application state for one world run: compiled world, player body, player pose and selected tool.
 */
export interface AppState {
  readonly world: CompiledCellComplex;
  readonly playerBody: PlayerBody;
  readonly playerPose: PlayerPose;
  /** Tool selected at startup; always "none" from createInitialAppState. */
  readonly selectedTool: "none" | "straight-ray" | "marker";
}

/**
 * Creates the AppState for a compiled world, placing the player at world.startingPosition (yaw and pitch default to 0) or at the default pose in cells[0]; throws if the world has no cells.
 */
export function createInitialAppState(world: CompiledCellComplex): AppState {
  const startCell = world.cells[0];

  if (!startCell) {
    throw new Error("Cannot create app state without at least one compiled cell.");
  }

  return {
    world,
    playerBody: createDefaultPlayerBody(),
    playerPose: world.startingPosition
      ? {
          cellId: world.startingPosition.cellId,
          position: world.startingPosition.position,
          yawRadians: world.startingPosition.yawRadians ?? 0,
          pitchRadians: world.startingPosition.pitchRadians ?? 0,
        }
      : createDefaultPlayerPose(startCell.id),
    selectedTool: "none",
  };
}
