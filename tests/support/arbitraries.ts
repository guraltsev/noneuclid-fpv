import fc from "fast-check";
import * as examples from "../../src/authoring/exampleWorlds";
import type { CompiledPrismCell } from "../../src/cell-complex/prismCells";
import type { CellComplexSpec } from "../../src/cell-complex/specs";
import type { Polygon2xy } from "../../src/math/polygons";
import { yawRigidTransform3, type RigidTransform3 } from "../../src/math/rigidTransform3";
import { normalizeVec3, vec3, type Vec3 } from "../../src/math/vec3";

/** Coordinates in meters; never NaN or infinite. */
export const arbCoordinate = fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true });

/** Any point or vector with coordinates in [-100, 100] m. */
export const arbVec3: fc.Arbitrary<Vec3> = fc.tuple(arbCoordinate, arbCoordinate, arbCoordinate).map(([x, y, z]) => vec3(x, y, z));

/** Unit-length vector (drawn from {@link arbVec3}, length > 1e-3, then normalized). */
export const arbUnitVec3: fc.Arbitrary<Vec3> = arbVec3
  .filter((v) => Math.hypot(v.x, v.y, v.z) > 1e-3)
  .map((v) => normalizeVec3(v));

/** Yaw angle in radians. */
export const arbYawRadians = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

/** Rotation about +z by a random yaw followed by a horizontal translation (z = 0), like a gluing map. */
export const arbYawRigidTransform3: fc.Arbitrary<RigidTransform3> = fc
  .tuple(arbYawRadians, arbCoordinate, arbCoordinate)
  .map(([yaw, x, y]) => yawRigidTransform3(yaw, vec3(x, y, 0)));

/** General rigid transform: random unit quaternion turned into a rotation matrix, plus a random translation. */
export const arbRigidTransform3: fc.Arbitrary<RigidTransform3> = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([w, x, y, z]) => Math.hypot(w, x, y, z) > 1e-3)
  .chain(([w, x, y, z]) => {
    const n = Math.hypot(w, x, y, z);
    const [a, b, c, d] = [w / n, x / n, y / n, z / n];

    return arbVec3.map(
      (translation): RigidTransform3 => ({
        rotation: {
          m00: 1 - 2 * (c * c + d * d),
          m01: 2 * (b * c - a * d),
          m02: 2 * (b * d + a * c),
          m10: 2 * (b * c + a * d),
          m11: 1 - 2 * (b * b + d * d),
          m12: 2 * (c * d - a * b),
          m20: 2 * (b * d - a * c),
          m21: 2 * (c * d + a * b),
          m22: 1 - 2 * (b * b + c * c),
        },
        translation,
      }),
    );
  });

/** Strictly convex counterclockwise polygon with 3-8 vertices on a circle of radius 1-20 m, no edge shorter than 0.05 m. */
export const arbConvexPolygon2xy: fc.Arbitrary<Polygon2xy> = fc
  .tuple(
    fc.integer({ min: 3, max: 8 }),
    fc.double({ min: 1, max: 20, noNaN: true }),
    fc.double({ min: -50, max: 50, noNaN: true }),
    fc.double({ min: -50, max: 50, noNaN: true }),
    fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    fc.array(fc.double({ min: 1, max: 2, noNaN: true }), { minLength: 8, maxLength: 8 }),
  )
  .map(([n, radius, cx, cy, phase, gaps]) => {
    const used = gaps.slice(0, n);
    const total = used.reduce((sum, gap) => sum + gap, 0);
    let angle = phase;
    const vertices = used.map((gap) => {
      const vertex = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };

      angle += (gap / total) * 2 * Math.PI;
      return vertex;
    });

    return { vertices } as Polygon2xy;
  })
  .filter((polygon) =>
    polygon.vertices.every((vertex, index) => {
      const next = polygon.vertices[(index + 1) % polygon.vertices.length];

      return Math.hypot(next.x - vertex.x, next.y - vertex.y) >= 0.05;
    }),
  );

/** The ten bundled example world specs, by name. */
export const exampleWorldSpecs: readonly (readonly [string, CellComplexSpec])[] = [
  ["basicCube", examples.basicCube],
  ["basicTetrahedron", examples.basicTetrahedron],
  ["cube", examples.cube],
  ["dodecahedron", examples.dodecahedron],
  ["genus2Torus", examples.genus2Torus],
  ["icosahedron", examples.icosahedron],
  ["octahedron", examples.octahedron],
  ["tetrahedron", examples.tetrahedron],
  ["torus", examples.torus],
  ["torusModuli", examples.torusModuli],
];

/**
 * A cone-point fan: 3-8 triangles around a common apex, glued cyclically through their spokes. Apex angles are in [0.3, 2.0] rad and spoke radii in [3, 12] m, so the total angle ranges over about [0.9, 16] rad and cone points with angle sum below and above 2 pi both occur. Cell `fan-i` has portal "out" on side 2 and "in" on side 0; side 1 is a wall.
 */
export const arbConeFanWorldSpec: fc.Arbitrary<CellComplexSpec> = fc
  .integer({ min: 3, max: 8 })
  .chain((n) =>
    fc.tuple(
      fc.array(fc.double({ min: 0.3, max: 2.0, noNaN: true }), { minLength: n, maxLength: n }),
      fc.array(fc.double({ min: 3, max: 12, noNaN: true }), { minLength: n, maxLength: n }),
    ),
  )
  .map(([angles, radii]) => {
    const n = angles.length;
    const thetas = [0];

    for (let i = 0; i < n; i += 1) {
      thetas.push(thetas[i] + angles[i]);
    }

    const cells = angles.map((_, i) => {
      const next = (i + 1) % n;
      const previous = (i + n - 1) % n;

      return {
        id: `fan-${i}`,
        heightMeters: 3,
        baseVertices: [
          { x: 0, y: 0 },
          { x: radii[i] * Math.cos(thetas[i]), y: radii[i] * Math.sin(thetas[i]) },
          { x: radii[next] * Math.cos(thetas[i + 1]), y: radii[next] * Math.sin(thetas[i + 1]) },
        ],
        portals: [
          { id: "in", sideIndex: 0, targetCellId: `fan-${previous}`, targetPortalId: "out" },
          { id: "out", sideIndex: 2, targetCellId: `fan-${next}`, targetPortalId: "in" },
        ],
      };
    });

    return { cells } as unknown as CellComplexSpec;
  });

/** Point strictly inside a (convex) cell: a weighted average of its base vertices with weights in [0.01, 1]. */
export function arbPointInCell(cell: CompiledPrismCell): fc.Arbitrary<{ x: number; y: number }> {
  return fc
    .array(fc.double({ min: 0.01, max: 1, noNaN: true }), {
      minLength: cell.baseVertices.length,
      maxLength: cell.baseVertices.length,
    })
    .map((weights) => {
      const total = weights.reduce((sum, weight) => sum + weight, 0);

      return {
        x: cell.baseVertices.reduce((sum, vertex, index) => sum + vertex.x * weights[index], 0) / total,
        y: cell.baseVertices.reduce((sum, vertex, index) => sum + vertex.y * weights[index], 0) / total,
      };
    });
}
