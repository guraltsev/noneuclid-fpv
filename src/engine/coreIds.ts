/**
 * The names the engine knows without any module: the object kinds of the registry's core union and the tool ids of the core tools.
 * Both tables are `Record`s over the unions, so adding a kind or a tool id without listing it here is a type error. Composition (composeModules.ts) checks module declarations against them.
 */
import type { CoreToolId, RuntimeToolId } from "../glue/toolIds";
import type { RuntimeWorldObject } from "../world-objects/runtimeObjectRegistry";

const coreObjectKindTable: Record<RuntimeWorldObject["kind"], true> = {
  "geodesci-marmot": true,
  "geo-mouse": true,
  "geo-butterfly": true,
  asset: true,
  "placed-flag": true,
  "geodesicEmitters/emitter": true,
  "geodesicModel/arc": true,
  "geodesicModel/vertex": true,
  "geodesicModel/segment": true,
  "geodesicModel/crossing": true,
  "geodesicMeasurements/length": true,
  "geodesicMeasurements/angle": true,
};

const coreToolIdTable: Record<CoreToolId, true> = {
  none: true,
  aim: true,
  "place-flag": true,
  "measure-length": true,
  protractor: true,
  "geodesicEmitters/carry": true,
  "geodesicEmitters/rotate": true,
  "geodesicEmitters/aim": true,
};

/** Kinds of the core union of the registry. */
export const coreObjectKinds: readonly string[] = Object.keys(coreObjectKindTable);

/**
 * Kinds of the registry's core union that a module declares as its own (design 013 section 13.1): the emitters, the geodesic model and the geodesic measurements keep their declaring files in `world-objects/geodesic/objects.ts` and in the core union in this wave, and its `objectKinds` lists them.
 * Composition accepts a declaration of exactly these kinds (rule 5); any other declaration of a core kind is still a problem.
 */
export const moduleOwnedCoreKinds: readonly string[] = [
  "geodesicEmitters/emitter",
  "geodesicModel/arc",
  "geodesicModel/vertex",
  "geodesicModel/segment",
  "geodesicModel/crossing",
  "geodesicMeasurements/length",
  "geodesicMeasurements/angle",
];

/** Ids of the tools the shell defines itself. */
export const coreToolIds: readonly RuntimeToolId[] = Object.keys(coreToolIdTable) as RuntimeToolId[];
