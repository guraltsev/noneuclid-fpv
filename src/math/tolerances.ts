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
