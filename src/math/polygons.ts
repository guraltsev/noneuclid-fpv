/**
 * Planar polygons in the horizontal x/y plane: signed area, validation and point-in-polygon classification.
 * Polygons are simple, counterclockwise (positive signed area, viewed from +z looking down) vertex lists; they describe the convex base of a prism cell in cell-local meters. The xz-named aliases at the bottom are legacy names for the same x/y functions (the vertical axis is z, so there is no x/z geometry here). Point classification is a crossing-number test, so it is correct for any simple polygon, but boundary detection uses an absolute tolerance.
 */
import { geometryTolerance } from "./tolerances";

/**
 * 2D point or vector in the horizontal x/y plane, in meters.
 */
export interface Vec2xy {
  readonly x: number;
  readonly y: number;
}

/**
 * Polygon given by its vertices in order; valid polygons are counterclockwise and the last vertex connects back to the first.
 */
export interface Polygon2xy {
  readonly vertices: readonly Vec2xy[];
}

/**
 * Alias of {@link Polygon2xy}.
 */
export type Polygon2 = Polygon2xy;
/**
 * Legacy alias of {@link Vec2xy}; the coordinates are still x and y.
 */
export type Vec2xz = Vec2xy;
/**
 * Legacy alias of {@link Polygon2xy}.
 */
export type Polygon2xz = Polygon2xy;

/**
 * Position of a point relative to a polygon: strictly "inside", strictly "outside", or on the "boundary" (within tolerance).
 */
export type PolygonPointClassification = "inside" | "outside" | "boundary";

/**
 * Returns the signed area of the polygon by the shoelace formula, positive for counterclockwise vertex order.
 * Units are square meters; works for any vertex count (fewer than three yields 0).
 */
export function polygonSignedArea2xy(polygon: Polygon2xy): number {
  let area = 0;

  for (let index = 0; index < polygon.vertices.length; index += 1) {
    const current = polygon.vertices[index];
    const next = polygon.vertices[(index + 1) % polygon.vertices.length];

    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

/**
 * Throws unless the polygon has at least three vertices and a signed area greater than `tolerance` (i.e. is counterclockwise and non-degenerate).
 * Convexity and simplicity are not checked here.
 */
export function validatePolygon2xy(polygon: Polygon2xy, tolerance = geometryTolerance): void {
  if (polygon.vertices.length < 3) {
    throw new Error("Polygon2xy requires at least three vertices.");
  }

  if (polygonSignedArea2xy(polygon) <= tolerance) {
    throw new Error("Polygon2xy vertices must be counterclockwise in the x/y plane.");
  }
}

/**
 * Classifies a point as inside, outside or on the boundary of a counterclockwise polygon.
 * Edges within `tolerance` of the point give "boundary"; otherwise an even-odd ray cast toward +x decides. Validates the polygon first and therefore throws for clockwise or degenerate input; costs O(n).
 */
export function classifyPointInPolygon2xy(
  polygon: Polygon2xy,
  point: Vec2xy,
  tolerance = geometryTolerance,
): PolygonPointClassification {
  validatePolygon2xy(polygon, tolerance);

  let inside = false;

  for (let index = 0; index < polygon.vertices.length; index += 1) {
    const start = polygon.vertices[index];
    const end = polygon.vertices[(index + 1) % polygon.vertices.length];

    if (pointLiesOnSegment2xy(point, start, end, tolerance)) {
      return "boundary";
    }

    // The edge straddles the horizontal line through the point (half-open in y so a shared vertex is counted once); if it also crosses to the right of the point, toggle parity.
    const crossesRay = (start.y > point.y) !== (end.y > point.y);

    if (crossesRay) {
      const xAtPointY = start.x + ((point.y - start.y) * (end.x - start.x)) / (end.y - start.y);

      if (xAtPointY > point.x) {
        inside = !inside;
      }
    }
  }

  return inside ? "inside" : "outside";
}

function pointLiesOnSegment2xy(point: Vec2xy, start: Vec2xy, end: Vec2xy, tolerance: number): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;

  if (Math.abs(cross) > tolerance) {
    return false;
  }

  const minX = Math.min(start.x, end.x) - tolerance;
  const maxX = Math.max(start.x, end.x) + tolerance;
  const minY = Math.min(start.y, end.y) - tolerance;
  const maxY = Math.max(start.y, end.y) + tolerance;

  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

/**
 * Legacy alias of {@link polygonSignedArea2xy}.
 */
export const polygonSignedArea2xz = polygonSignedArea2xy;
/**
 * Legacy alias of {@link validatePolygon2xy}.
 */
export const validatePolygon2xz = validatePolygon2xy;
/**
 * Legacy alias of {@link classifyPointInPolygon2xy}.
 */
export const classifyPointInPolygon2xz = classifyPointInPolygon2xy;
