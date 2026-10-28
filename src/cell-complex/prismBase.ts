/**
 * Type-level and runtime validation of the base polygon of a prism cell.
 * A base is a list of 3 to 8 [x, y] vertices in cell-local meters that must be strictly convex and listed counterclockwise when viewed from +z. The tuple types fix the vertex count at compile time and a branded type records that a base passed validation; the runtime validator is the same rule enforced on authored specs.
 */
import { geometryTolerance } from "../math/tolerances";

/**
 * A base corner as an [x, y] pair in cell-local meters.
 */
export type PrismBaseVertex = readonly [number, number];

/**
 * Tuple of 3 to 8 base vertices.
 */
export type PrismBaseVertices =
  | readonly [PrismBaseVertex, PrismBaseVertex, PrismBaseVertex]
  | readonly [PrismBaseVertex, PrismBaseVertex, PrismBaseVertex, PrismBaseVertex]
  | readonly [PrismBaseVertex, PrismBaseVertex, PrismBaseVertex, PrismBaseVertex, PrismBaseVertex]
  | readonly [PrismBaseVertex, PrismBaseVertex, PrismBaseVertex, PrismBaseVertex, PrismBaseVertex, PrismBaseVertex]
  | readonly [
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
    ]
  | readonly [
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
      PrismBaseVertex,
    ];

declare const convexPrismBaseBrand: unique symbol;

/**
 * A vertex tuple branded as having passed {@link validatePrismBaseVertices}; the brand exists only at the type level.
 */
export type ConvexPrismBaseVertices<TVertices extends PrismBaseVertices = PrismBaseVertices> = TVertices & {
  readonly [convexPrismBaseBrand]: true;
};

/**
 * Validates the vertices and returns them branded as convex and counterclockwise.
 * @throws Error with the validation message if {@link validatePrismBaseVertices} reports a problem.
 */
export function createConvexPrismBaseVertices<const TVertices extends PrismBaseVertices>(
  vertices: TVertices,
): ConvexPrismBaseVertices<TVertices> {
  const error = validatePrismBaseVertices(vertices);

  if (error) {
    throw new Error(error);
  }

  return vertices as ConvexPrismBaseVertices<TVertices>;
}

/**
 * Returns an error message if the vertices are not 3-8 strictly convex counterclockwise points, or undefined if valid.
 * Requires positive signed area (> geometryTolerance) and a strictly left turn (cross product > geometryTolerance) at every vertex, so collinear consecutive vertices are rejected.
 */
export function validatePrismBaseVertices(vertices: readonly PrismBaseVertex[]): string | undefined {
  if (vertices.length < 3) {
    return "must have at least 3 base vertices.";
  }

  if (vertices.length > 8) {
    return "must have at most 8 base vertices.";
  }

  let signedAreaTwice = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    signedAreaTwice += current[0] * next[1] - next[0] * current[1];
  }

  if (signedAreaTwice <= geometryTolerance) {
    return "must list baseVertices in counterclockwise order in the x/y plane.";
  }

  for (let index = 0; index < vertices.length; index += 1) {
    const prev = vertices[(index + vertices.length - 1) % vertices.length];
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const edgeAX = current[0] - prev[0];
    const edgeAY = current[1] - prev[1];
    const edgeBX = next[0] - current[0];
    const edgeBY = next[1] - current[1];
    const turn = edgeAX * edgeBY - edgeAY * edgeBX;

    if (turn <= geometryTolerance) {
      return "must be strictly convex; non-convex prism cells are not supported.";
    }
  }

  return undefined;
}
