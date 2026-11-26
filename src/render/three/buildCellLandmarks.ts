/**
 * Mesh of the generated landmarks of one cell (design 018 section 4.3), in the cell mesh's Three.js axes (cell-local (x, y, height) is Three (x, height, -y)).
 *
 * One merged mesh with vertex colours; the light of the cell (`shadowAzimuthRadians`) is baked into the colours, because the scene has no directional light.
 */
import * as THREE from "three";
import type { LandmarkPlacement } from "../../world-assets/landmarkLayout";

/** Builds the landmark mesh of a cell (`name = "landmarks:<cellId>"`, `userData.kind = "landmark"`), or undefined when the cell has no landmarks. */
export function buildCellLandmarksMesh(
  _cellId: string,
  _placements: readonly LandmarkPlacement[],
  _shadowAzimuthRadians: number,
): THREE.Mesh | undefined {
  return undefined;
}
