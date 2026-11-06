/**
 * Lagrange-Gauss reduction of a plane lattice basis and the lattice's covering radius.
 * A reduced basis (first, second) has |first| <= |second| and |first . second| <= |first|^2 / 2, so it is the shortest basis of the lattice.
 * The result depends on the lattice up to signs and ties; callers must use it only for quantities that do not depend on the choice of basis.
 */

/** A vector of the plane. */
export interface LatticeVector {
  readonly x: number;
  readonly y: number;
}

/** A reduced basis of a plane lattice. */
export interface ReducedLatticeBasis {
  readonly first: LatticeVector;
  readonly second: LatticeVector;
}

const maxReductionSteps = 64;

/** Reduces the basis (u, v), which must be linearly independent. */
export function reduceLatticeBasis(u: LatticeVector, v: LatticeVector): ReducedLatticeBasis {
  let first = u;
  let second = v;
  for (let step = 0; step < maxReductionSteps; step += 1) {
    if (dot(first, first) > dot(second, second)) {
      [first, second] = [second, first];
    }
    const multiple = Math.round(dot(first, second) / dot(first, first));
    if (multiple === 0) {
      break;
    }
    second = { x: second.x - multiple * first.x, y: second.y - multiple * first.y };
  }
  return { first, second };
}

/** Distance from the farthest point of the plane to the nearest lattice point, for a reduced basis: the circumradius of its non-obtuse triangle. */
export function latticeCoveringRadius(basis: ReducedLatticeBasis): number {
  const { first } = basis;
  const second = dot(first, basis.second) < 0 ? { x: -basis.second.x, y: -basis.second.y } : basis.second;
  const sideA = Math.hypot(first.x, first.y);
  const sideB = Math.hypot(second.x, second.y);
  const sideC = Math.hypot(second.x - first.x, second.y - first.y);
  const doubleArea = Math.abs(first.x * second.y - first.y * second.x);
  return (sideA * sideB * sideC) / (2 * doubleArea);
}

function dot(left: LatticeVector, right: LatticeVector): number {
  return left.x * right.x + left.y * right.y;
}
