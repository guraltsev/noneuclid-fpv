/**
 * Shared absolute tolerance for geometric comparisons.
 * Every math, cell-complex and movement predicate that needs an epsilon defaults to this value. It is an absolute tolerance in meters for lengths and signed distances, and is also used (unscaled) for dimensionless quantities such as dot products and ray parameters, so it is only meaningful for scenes with coordinates of modest magnitude.
 */
/**
 * Default absolute geometric tolerance, 1e-8 (meters for lengths and signed distances).
 */
export const geometryTolerance = 1e-8;

/**
 * Alias of {@link geometryTolerance}, named to make the meters unit explicit.
 */
export const defaultGeometryToleranceMeters = geometryTolerance;

/**
 * Two side crossings closer than this (meters along the walk) are a pass through their shared vertex.
 */
export const segmentWalkVertexTieMeters = 1e-9;

/**
 * A walk start or atlas centre may lie this far (meters) outside its cell and still count as inside.
 */
export const cellContainmentToleranceMeters = 1e-6;

/**
 * A side is crossed outward when dot(direction, inwardNormal) is below minus this (dimensionless).
 */
export const segmentWalkOutgoingDotTolerance = 1e-12;

/**
 * Clearance, meters, kept between a body and an obstacle after a collision response.
 */
export const collisionSkinMeters = 1e-6;

/**
 * Lengths, speeds and displacements (meters) at or below this are treated as zero: a degenerate segment has no direction, a zero horizontal step does not walk.
 */
export const degenerateLengthMeters = 1e-12;

/**
 * Tolerance (dimensionless, cross products of unit directions) for a direction lying on the boundary of a visibility wedge.
 */
export const wedgeCrossTolerance = 1e-12;

/**
 * A half-plane constraint whose coefficient on the ray parameter is below this (dimensionless) is treated as parallel to the ray.
 */
export const parallelConstraintTolerance = 1e-15;

/**
 * A point whose signed distance to a side is at most this (meters) counts as on the side, not past it.
 */
export const sideBoundaryToleranceMeters = 1e-12;

/**
 * Slack (meters) when clamping a vertical step against the floor and ceiling of a cell.
 */
export const verticalStepSlackMeters = 1e-12;

/**
 * An offset (meters) between a body's anchor and its collision centre below this is treated as zero.
 */
export const anchorCentreOffsetToleranceMeters = 1e-9;

/**
 * A distance (meters) below this is treated as zero when a direction would be computed from it (depenetration out of a zone).
 */
export const zeroDistanceToleranceMeters = 1e-9;

/**
 * A neighbouring cell counts as lower than the body top only if it is lower by more than this (meters).
 */
export const ceilingHeightSlackMeters = 1e-9;

/**
 * Tolerance (meters, a dot product of a displacement with a unit normal) for a remaining displacement still approaching an earlier contact.
 */
export const approachDotToleranceMeters = 1e-12;
