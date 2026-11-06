/**
 * The modulus of a flat torus, for the geometry computer's readout.
 *
 * A torus with lattice vectors u = (w, 0) and v = (a, b) has modulus tau = (a + ib)/w. Different (a, b) can be the same flat torus: a Dehn twist (a changes by a multiple of w) or any
 * other change of lattice basis does not change the torus, only how the floor is marked. `reducedTorusModulus` folds tau to the fundamental domain ignoring orientation, so equal
 * flat tori have equal reduced moduli. The tolerance is 1e-6.
 */
import { reduceLatticeBasis } from "../../math/latticeReduction";

const moduliTolerance = 1e-6;

/** Named shape of a flat torus. */
export type TorusShape = "square" | "hexagonal" | "rectangular" | "rhombic" | "oblique";

/** The modulus of a flat torus folded to the fundamental domain, ignoring orientation: 0 <= re <= 1/2, re^2 + im^2 >= 1. */
export interface TorusModulus {
  readonly re: number;
  readonly im: number;
}

/** The (a, b) parameters of a torus of width w. */
export interface TorusLatticeParameters {
  readonly widthMeters: number;
  readonly skewXMeters: number;
  readonly depthMeters: number;
}

/** Reduces tau = (a + ib)/w. */
export function reducedTorusModulus(parameters: TorusLatticeParameters): TorusModulus {
  const { first, second } = reduceLatticeBasis(
    { x: parameters.widthMeters, y: 0 },
    { x: parameters.skewXMeters, y: parameters.depthMeters },
  );
  const lengthSquared = first.x * first.x + first.y * first.y;
  return {
    re: Math.abs(first.x * second.x + first.y * second.y) / lengthSquared,
    im: Math.abs(first.x * second.y - first.y * second.x) / lengthSquared,
  };
}

/** Names the shape of a reduced modulus. */
export function torusShape(modulus: TorusModulus): TorusShape {
  const onCircle = Math.abs(modulus.re * modulus.re + modulus.im * modulus.im - 1) <= moduliTolerance;
  const onAxis = modulus.re <= moduliTolerance;
  const onEdge = Math.abs(modulus.re - 0.5) <= moduliTolerance;
  if (onAxis && onCircle) return "square";
  if (onEdge && onCircle) return "hexagonal";
  if (onAxis) return "rectangular";
  if (onCircle || onEdge) return "rhombic";
  return "oblique";
}

/** One line for the geometry computer: how a torus relates to the torus the world started with. */
export function describeTorusRelation(state: TorusLatticeParameters, start: TorusLatticeParameters): string {
  const sameWidth = Math.abs(state.widthMeters - start.widthMeters) <= moduliTolerance;
  const sameDepth = Math.abs(state.depthMeters - start.depthMeters) <= moduliTolerance;
  const twists = (state.skewXMeters - start.skewXMeters) / state.widthMeters;
  if (sameWidth && sameDepth && Math.abs(twists - Math.round(twists)) <= moduliTolerance) {
    const count = Math.abs(Math.round(twists));
    if (count === 0) return "This is the starting torus.";
    return `Same flat torus as the start: ${count} Dehn twist${count === 1 ? "" : "s"}.`;
  }
  const modulus = reducedTorusModulus(state);
  const startModulus = reducedTorusModulus(start);
  const same =
    Math.abs(modulus.re - startModulus.re) <= moduliTolerance && Math.abs(modulus.im - startModulus.im) <= moduliTolerance;
  return same ? "Same flat torus as the start, marked differently." : "A different flat torus from the start.";
}
