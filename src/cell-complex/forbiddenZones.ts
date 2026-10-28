/**
 * Constants and types for forbidden zones: vertical cylinders at cell base vertices where portal sides meet.
 * Collision only ever tests a body against its current cell, so movement keeps bodies out of a fixed-radius cylinder around every vertex where a portal side meets another side; a body then never has to be resolved against geometry glued on at that vertex. Every vertex that is an endpoint of a portal side gets a zone, whether one or two portals touch it. Zones are in cell-local meters and span the full cell height.
 */
/**
 * Radius in meters of the forbidden cylinder around a portal junction vertex (0.15 m).
 * Also used by static portal-path culling, which widens its geometric tolerance to half this value.
 */
export const forbiddenPortalJunctionRadiusMeters = 0.15;
/**
 * Height of the forbidden cylinder; Infinity, so the zone excludes the whole vertical extent of the cell.
 */
export const forbiddenPortalJunctionHeightMeters = Infinity;

/**
 * A base vertex of a cell that is an endpoint of at least one portal side.
 * `id` is "<cellId>:vertex-<vertexIndex>"; `position` is the vertex in cell-local x/y meters.
 */
export interface PortalJunction {
  readonly id: string;
  /**
   * Sorted, de-duplicated ids of the cell's portals whose sides end at this vertex.
   */
  readonly adjacentPortalIds: readonly string[];
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * Pairs a junction id with the collision cylinder that excludes bodies from it.
 */
export interface ForbiddenZone {
  readonly junctionId: string;
  readonly collision: SingularityCollisionCylinder;
}

/**
 * Invisible vertical cylinder used for collision around a portal junction.
 * `center.z` is half the cell height and `height` is infinite, so only the horizontal radius matters in practice.
 */
export interface SingularityCollisionCylinder {
  readonly kind: "invisible-cylinder";
  readonly junctionId: string;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
  readonly height: number;
}
