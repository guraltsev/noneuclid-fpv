/**
 * The names the engine knows without any module: the object kinds of the registry's core union and the tool ids of the core tools.
 * Both tables are `Record`s over the unions, so adding a kind or a tool id without listing it here is a type error. Composition (composeModules.ts) checks module declarations against them.
 */
import type { RuntimeToolId } from "../glue/toolIds";
import type { RuntimeWorldObject } from "../world-objects/runtimeObjectRegistry";

const coreObjectKindTable: Record<RuntimeWorldObject["kind"], true> = {
  "geodesci-marmot": true,
  "geo-mouse": true,
  "geo-butterfly": true,
  asset: true,
  "placed-flag": true,
  "geodesic-cannon": true,
  "geodesic-interval": true,
  "free-geodesic-end": true,
  "curve-shortening-pair": true,
  "geodesic-segment": true,
  "geodesic-intersection": true,
  "measured-geodesic-length": true,
  "protractor-angle": true,
};

const coreToolIdTable: Record<RuntimeToolId, true> = {
  none: true,
  aim: true,
  "place-flag": true,
  "geodesic-cannon": true,
  "measure-length": true,
  protractor: true,
  "geodesic-cannon-carry": true,
  "geodesic-cannon-rotate": true,
  "geodesic-cannon-aim": true,
  "geodesic-cannon-tie-detach": true,
};

/** Kinds of the core union of the registry. */
export const coreObjectKinds: readonly string[] = Object.keys(coreObjectKindTable);

/** Ids of the tools the shell defines itself. */
export const coreToolIds: readonly RuntimeToolId[] = Object.keys(coreToolIdTable) as RuntimeToolId[];
