import type { CompiledCellComplex } from "../../src/cell-complex/compileCellComplex";
import type { OrientedPortalSegment } from "../../src/cell-complex/orientedPortal";
import type { LineCone } from "../../src/cell-complex/staticLineCone";
import { walkDevelopedSegment } from "../../src/cell-complex/segmentWalk";
import type { Vec2xy } from "../../src/math/polygons";
import { dotVec3, lengthVec3, vec3, type Vec3 } from "../../src/math/vec3";

/** Seeded PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Signature of a portal word, `"cellA:portal1/cellB:portal2"`. */
export function wordSignature(steps: readonly { readonly sourceCellId: string; readonly sourcePortalId: string }[]): string {
  return steps.map((step) => `${step.sourceCellId}:${step.sourcePortalId}`).join("/");
}

/** Signature of every nonempty prefix of the portal word crossed by a long segment walked from `start` along `direction`. */
export function walkedWordPrefixes(
  world: CompiledCellComplex,
  rootCellId: string,
  start: Vec2xy,
  direction: Vec2xy,
  maxCrossings: number,
): string[] {
  const result = walkDevelopedSegment({ world, cellId: rootCellId, start, direction, lengthMeters: 1000, maxCrossings });
  const prefixes: string[] = [];

  for (let count = 1; count <= result.crossings.length; count += 1) {
    prefixes.push(
      wordSignature(result.crossings.slice(0, count).map((c) => ({ sourceCellId: c.sourceCellId, sourcePortalId: c.portalId }))),
    );
  }

  return prefixes;
}

/** A random oriented line inside a cone: a normalized positive combination of its rays. */
export function sampleLineInCone(cone: LineCone, rng: () => number): Vec3 {
  let sum = vec3(0, 0, 0);

  for (const ray of cone) {
    const weight = 0.05 + rng();

    sum = vec3(sum.x + weight * ray.x, sum.y + weight * ray.y, sum.z + weight * ray.z);
  }

  const length = lengthVec3(sum);

  return vec3(sum.x / length, sum.y / length, sum.z / length);
}

/** Start point and direction of a walk along oriented line `l` that begins just before it crosses the first portal. */
export function lineStartThroughPortal(l: Vec3, first: OrientedPortalSegment): { start: Vec2xy; direction: Vec2xy } {
  const normal = Math.hypot(l.x, l.y);
  const direction = { x: l.y / normal, y: -l.x / normal };
  const lr = dotVec3(l, vec3(first.right.x, first.right.y, 1));
  const ll = dotVec3(l, vec3(first.left.x, first.left.y, 1));
  const t = lr / (lr - ll);
  const crossing = {
    x: first.right.x + t * (first.left.x - first.right.x),
    y: first.right.y + t * (first.left.y - first.right.y),
  };

  return { start: { x: crossing.x - 1e-4 * direction.x, y: crossing.y - 1e-4 * direction.y }, direction };
}
