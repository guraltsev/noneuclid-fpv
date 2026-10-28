/**
 * Registry of WorldDeformationFamily implementations keyed by state kind, plus helpers to apply a state to a spec and to choose the initial state for a world.
 * The default registry contains "static-world" (identity, no deformation) and "torus-skew" (see deformations/torusSkewDeformation.ts), which only applies to a one-cell torus world named "torus-room".
 * Registries are looked up by kind from the session, the worker and the renderer's commit step; an unknown kind is a hard error (getWorldDeformationFamilyOrThrow).
 */
import type { CellComplexSpec } from "../cell-complex/specs";
import {
  createIdentityCellDeformationMaps,
  validateTopologyPreservingSnapshot,
  type DynamicGeometryStepOptions,
  type StaticWorldDeformationState,
  type WorldDeformationFamily,
  type WorldDeformationState,
} from "./worldGeometryDeformations";
import {
  createTorusSkewDeformationFamily,
  defaultTorusSkewDeformationState,
  inferTorusSkewState,
  type TorusSkewDeformationState,
} from "./deformations/torusSkewDeformation";

/** Lookup table from deformation kind to its WorldDeformationFamily. */
export interface WorldDeformationFamilyRegistry {
  /** Returns the family registered for the kind, or undefined. */
  get<TState extends WorldDeformationState>(
    kind: TState["kind"],
  ): WorldDeformationFamily<TState> | undefined;
  /** Returns all registered families (one per kind). */
  list(): readonly WorldDeformationFamily<WorldDeformationState>[];
}

/** Builds a registry from a list of families; if two share a kind the later one wins. */
export function createWorldDeformationFamilyRegistry(
  families: readonly WorldDeformationFamily<WorldDeformationState>[],
): WorldDeformationFamilyRegistry {
  const familiesByKind = new Map<WorldDeformationState["kind"], WorldDeformationFamily<WorldDeformationState>>();

  for (const family of families) {
    familiesByKind.set(family.kind, family);
  }

  return {
    get(kind) {
      return familiesByKind.get(kind) as WorldDeformationFamily<never> | undefined;
    },
    list() {
      return [...familiesByKind.values()];
    },
  };
}

/** Builds a registry containing the static-world and torus-skew families. */
export function createDefaultWorldDeformationFamilyRegistry(): WorldDeformationFamilyRegistry {
  return createWorldDeformationFamilyRegistry([
    createStaticWorldDeformationFamily(),
    createTorusSkewDeformationFamily() as WorldDeformationFamily<WorldDeformationState>,
  ]);
}

/** Returns the family for a kind or throws "Unknown world deformation family". */
export function getWorldDeformationFamilyOrThrow<TState extends WorldDeformationState>(
  registry: WorldDeformationFamilyRegistry,
  kind: TState["kind"],
): WorldDeformationFamily<TState> {
  const family = registry.get<TState>(kind);
  if (!family) {
    throw new Error(`Unknown world deformation family "${kind}".`);
  }

  return family;
}

/**
 * Returns the base spec deformed by the given state (normalized first); throws if the family is unknown or cannot apply to this spec.
 */
export function applyWorldDeformationToSpec(
  baseSpec: CellComplexSpec,
  state: WorldDeformationState,
  registry: WorldDeformationFamilyRegistry = createDefaultWorldDeformationFamilyRegistry(),
): CellComplexSpec {
  const family = getWorldDeformationFamilyOrThrow(registry, state.kind);
  if (!family.canApplyToSpec(baseSpec)) {
    throw new Error(`World deformation family "${state.kind}" cannot apply to this world spec.`);
  }

  return family.applyToSpec(baseSpec, family.normalizeState(baseSpec, state as never));
}

/**
 * Chooses the starting deformation state for a base spec: if the torus family applies, the torus-skew state inferred from the spec's own footprint (width, depth, skew), so the initial state matches the authored geometry; if inference fails (for example the footprint is outside the family's range) it falls back to the 15 m x 15 m zero-skew default; otherwise static-world.
 */
export function createInitialWorldDeformationState(baseSpec: CellComplexSpec): WorldDeformationState {
  const registry = createDefaultWorldDeformationFamilyRegistry();
  const torusFamily = registry.get("torus-skew");

  if (torusFamily?.canApplyToSpec(baseSpec)) {
    let inferred: TorusSkewDeformationState;
    try {
      inferred = inferTorusSkewState(baseSpec);
    } catch {
      inferred = defaultTorusSkewDeformationState;
    }
    return torusFamily.normalizeState(baseSpec, inferred);
  }

  return { kind: "static-world" };
}

function createStaticWorldDeformationFamily(): WorldDeformationFamily<StaticWorldDeformationState> {
  return {
    kind: "static-world",
    canApplyToSpec() {
      return true;
    },
    normalizeState() {
      return { kind: "static-world" };
    },
    applyToSpec(baseSpec) {
      return baseSpec;
    },
    createDynamicObjectMaps(_previous, _next, previousWorld) {
      return createIdentityCellDeformationMaps(previousWorld);
    },
    nextStep(current, _target, _options: DynamicGeometryStepOptions) {
      return current;
    },
    validateSnapshot(previousWorld, nextWorld) {
      return validateTopologyPreservingSnapshot(previousWorld, nextWorld);
    },
  };
}
