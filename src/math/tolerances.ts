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
