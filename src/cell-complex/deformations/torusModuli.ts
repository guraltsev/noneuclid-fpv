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

/** How a torus relates to the torus the world started with: the start itself, the start after Dehn twists, the same flat torus marked differently, or another flat torus. */
export type TorusRelation =
  | { readonly kind: "start" }
  | { readonly kind: "twisted"; readonly twists: number }
  | { readonly kind: "marked-differently" }
  | { readonly kind: "different" };

/** Classifies `state` against `start`; every kind but "different" means the same flat torus. */
export function torusRelation(state: TorusLatticeParameters, start: TorusLatticeParameters): TorusRelation {
  const sameWidth = Math.abs(state.widthMeters - start.widthMeters) <= moduliTolerance;
  const sameDepth = Math.abs(state.depthMeters - start.depthMeters) <= moduliTolerance;
  const twists = (state.skewXMeters - start.skewXMeters) / state.widthMeters;
  if (sameWidth && sameDepth && Math.abs(twists - Math.round(twists)) <= moduliTolerance) {
    const count = Math.abs(Math.round(twists));
    return count === 0 ? { kind: "start" } : { kind: "twisted", twists: count };
  }
  const modulus = reducedTorusModulus(state);
  const startModulus = reducedTorusModulus(start);
  const same =
    Math.abs(modulus.re - startModulus.re) <= moduliTolerance && Math.abs(modulus.im - startModulus.im) <= moduliTolerance;
  return same ? { kind: "marked-differently" } : { kind: "different" };
}

/** Whether `state` is the same flat torus as `start` (the start itself, a Dehn twist of it, or the same torus marked differently). */
export function isSameFlatTorus(state: TorusLatticeParameters, start: TorusLatticeParameters): boolean {
  return torusRelation(state, start).kind !== "different";
}

/** One line for the geometry computer: how a torus relates to the torus the world started with. */
export function describeTorusRelation(state: TorusLatticeParameters, start: TorusLatticeParameters): string {
  const relation = torusRelation(state, start);
  switch (relation.kind) {
    case "start":
      return "This is the starting torus.";
    case "twisted":
      return `Same flat torus as the start: ${relation.twists} Dehn twist${relation.twists === 1 ? "" : "s"}.`;
    case "marked-differently":
      return "Same flat torus as the start, marked differently.";
    case "different":
      return "A different flat torus from the start.";
  }
}
