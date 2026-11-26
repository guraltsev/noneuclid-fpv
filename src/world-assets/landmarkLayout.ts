/**
 * Seeded layout of the large generated landmarks of a cell (design 018 section 4.3): arches, arcades, towers, pillars and the like.
 *
 * Pure: it decides what stands where, how big and in which colours; `render/three/buildCellLandmarks.ts` turns the list into a mesh, the ground tint
 * takes the shadow casters, and the shell takes the colliders. The same cell always gets the same landmarks.
 */
import type { CompiledPrismCell } from "../cell-complex/prismCells";
import type { GroundShadowCaster } from "./groundTint";

/** What a landmark is; the mesh builder has one shape generator per kind. */
export type LandmarkKind = string;

/** One generated landmark, in cell-local meters (x right, y forward). */
export interface LandmarkPlacement {
  readonly kind: LandmarkKind;
  readonly x: number;
  readonly y: number;
  /** Turn about the vertical, radians from +x toward +y. */
  readonly yawRadians: number;
  /** Overall size factor; 1 is the kind's nominal size. */
  readonly scale: number;
  /** Seed of this landmark's own random details. */
  readonly seed: number;
  /** Radius of the disc on the ground that contains the whole landmark, meters (already scaled). */
  readonly footprintRadiusMeters: number;
  /** Height of the landmark, meters (already scaled). */
  readonly heightMeters: number;
  /** Discs the player cannot walk into (pillar feet and the like), cell-local meters. */
  readonly colliders: readonly LandmarkCollider[];
}

/** A vertical cylinder the player cannot walk into. */
export interface LandmarkCollider {
  readonly x: number;
  readonly y: number;
  readonly radiusMeters: number;
  readonly heightMeters: number;
}

/** What the layout needs to know besides the cell. */
export interface LandmarkLayoutContext {
  /** Cell-local point to keep clear because the player starts there, when the world starts in this cell. */
  readonly startPosition?: { readonly x: number; readonly y: number };
}

/** Lays out the landmarks of a cell; an empty list for a cell that gets none. */
export function computeLandmarkLayout(_cell: CompiledPrismCell, _context: LandmarkLayoutContext = {}): readonly LandmarkPlacement[] {
  return [];
}

/** The long shadows the landmarks throw on the ground of their cell. */
export function landmarkShadowCasters(_placements: readonly LandmarkPlacement[]): readonly GroundShadowCaster[] {
  return [];
}
