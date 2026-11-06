/**
 * Policy for derived objects (geodesics, measured geodesic lengths, protractor angles, geodesic intersection markers) when a newly deformed world geometry is committed.
 * A geodesic traced in the old geometry is generally not a geodesic of the new one, so free geodesics are deleted together with the measurements and angles that depend on them. Connected geodesics (connecting two emitters) are re-solved with rebuildConnectedGeodesicBetweenEmitters in the new world; if that finds no connection they are deleted and reported as failed. Measurements and angles of the surviving geodesics are not touched here: the derive ticks of the geodesic measurements module recompute them in the next engine step. Orphaned intersection objects are pruned.
 * The function mutates the runtime object registry in place and reports what changed through renderer-agnostic callbacks and a result record of id lists; it does not touch the renderer itself.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { pruneMissingGeodesicIntersectionObjects } from "../world-objects/geodesic/intersections";
import { arcConnectsEmitters, removeGeodesic } from "../world-objects/geodesic/lifecycle";
import { rebuildConnectedGeodesicBetweenEmitters } from "../world-objects/geodesic/cannon";
import type { LegacyWorldWriter, RuntimeObjectReader } from "../world-objects/runtimeObjectRegistry";

/**
 * Optional renderer hooks invoked as the policy removes dependent objects so visuals can follow.
 */
export interface GeometryCommitComputedObjectPolicyCallbacks {
  /** Called with the id of a measured-length object just removed from the registry. */
  readonly removeMeasuredGeodesicLength?: (objectId: string) => void;
  /** Called with the id of a protractor angle just removed from the registry. */
  readonly removeProtractorAngle?: (objectId: string) => void;
}

/** Inputs for applying the post-commit policy. */
export interface ApplyGeometryCommitComputedObjectPolicyOptions {
  /** Newly committed compiled world in which connected geodesics are re-solved. */
  readonly world: CompiledCellComplex;
  /** Runtime object registry that is mutated in place. */
  readonly registry: LegacyWorldWriter;
  readonly callbacks?: GeometryCommitComputedObjectPolicyCallbacks;
}

/**
 * Ids (deduplicated, in first-seen order) of the objects the policy removed or pruned.
 */
export interface GeometryCommitComputedObjectPolicyResult {
  readonly removedGeodesicIds: readonly string[];
  /**
   * Connected geodesics that could not be re-solved in the new geometry; these are also listed in removedGeodesicIds.
   */
  readonly failedConnectedGeodesicIds: readonly string[];
  readonly removedMeasuredGeodesicLengthIds: readonly string[];
  readonly removedProtractorAngleIds: readonly string[];
  readonly prunedIntersectionIds: readonly string[];
}

/**
 * Applies the post-commit policy to the registry (delete free geodesics, re-solve connected ones, prune stale intersections) and returns what changed.
 */
export function applyGeometryCommitComputedObjectPolicy(
  options: ApplyGeometryCommitComputedObjectPolicyOptions,
): GeometryCommitComputedObjectPolicyResult {
  const result = createGeometryCommitComputedObjectPolicyResultBuilder();
  const connectedGeodesicIds = collectConnectedGeodesicIds(options.registry);
  const allGeodesicIds = collectAllGeodesicIds(options.registry);

  for (const geodesicId of allGeodesicIds) {
    if (connectedGeodesicIds.has(geodesicId)) {
      continue;
    }

    removeProtractorAnglesForGeodesic(options, geodesicId, result);
    removeMeasuredGeodesicLengthsForGeodesic(options, geodesicId, result);
    removeGeodesic(options.registry, geodesicId);
    result.removedGeodesicIds.add(geodesicId);
  }

  for (const geodesicId of connectedGeodesicIds) {
    const rebuilt = rebuildConnectedGeodesicBetweenEmitters({
      world: options.world,
      registry: options.registry,
      geodesicId,
    });
    if (rebuilt.length === 0) {
      removeProtractorAnglesForGeodesic(options, geodesicId, result);
      removeMeasuredGeodesicLengthsForGeodesic(options, geodesicId, result);
      removeGeodesic(options.registry, geodesicId);
      result.failedConnectedGeodesicIds.add(geodesicId);
      result.removedGeodesicIds.add(geodesicId);
    }
  }

  const prunedIntersectionIds = pruneMissingGeodesicIntersectionObjects(options.registry);
  for (const intersectionId of prunedIntersectionIds) {
    result.prunedIntersectionIds.add(intersectionId);
  }
  removeProtractorAnglesForMissingVertices(options, prunedIntersectionIds, result);

  return freezeGeometryCommitComputedObjectPolicyResult(result);
}

function collectConnectedGeodesicIds(registry: RuntimeObjectReader): Set<string> {
  return new Set(
    [...collectAllGeodesicIds(registry)]
      .filter((geodesicId) => arcConnectsEmitters(registry, geodesicId)),
  );
}

function collectAllGeodesicIds(registry: RuntimeObjectReader): Set<string> {
  const geodesicIds = new Set<string>();
  for (const object of registry.getAll()) {
    if (object.kind === "geodesicModel/arc") {
      geodesicIds.add(object.id);
    } else if (object.kind === "geodesicModel/segment") {
      geodesicIds.add(object.geodesicId);
    } else if (object.kind === "geodesicMeasurements/length") {
      geodesicIds.add(object.geodesicId);
    } else if (object.kind === "geodesicMeasurements/angle") {
      geodesicIds.add(object.first.geodesicId);
      geodesicIds.add(object.second.geodesicId);
    }
  }

  return geodesicIds;
}

function removeMeasuredGeodesicLengthsForGeodesic(
  options: ApplyGeometryCommitComputedObjectPolicyOptions,
  geodesicId: string,
  result: GeometryCommitComputedObjectPolicyResultBuilder,
): void {
  for (const object of options.registry.getAll()) {
    if (object.kind === "geodesicMeasurements/length" && object.geodesicId === geodesicId) {
      options.registry.remove(object.id);
      options.callbacks?.removeMeasuredGeodesicLength?.(object.id);
      result.removedMeasuredGeodesicLengthIds.add(object.id);
    }
  }
}

function removeProtractorAnglesForGeodesic(
  options: ApplyGeometryCommitComputedObjectPolicyOptions,
  geodesicId: string,
  result: GeometryCommitComputedObjectPolicyResultBuilder,
): void {
  for (const object of options.registry.getAll()) {
    if (
      object.kind === "geodesicMeasurements/angle" &&
      (object.first.geodesicId === geodesicId || object.second.geodesicId === geodesicId)
    ) {
      options.registry.remove(object.id);
      options.callbacks?.removeProtractorAngle?.(object.id);
      result.removedProtractorAngleIds.add(object.id);
    }
  }
}

function removeProtractorAnglesForMissingVertices(
  options: ApplyGeometryCommitComputedObjectPolicyOptions,
  vertexIds: readonly string[],
  result: GeometryCommitComputedObjectPolicyResultBuilder,
): void {
  if (vertexIds.length === 0) {
    return;
  }

  const missingVertexIds = new Set(vertexIds);
  for (const object of options.registry.getAll()) {
    if (object.kind === "geodesicMeasurements/angle" && missingVertexIds.has(object.centerObjectId)) {
      options.registry.remove(object.id);
      options.callbacks?.removeProtractorAngle?.(object.id);
      result.removedProtractorAngleIds.add(object.id);
    }
  }
}

interface GeometryCommitComputedObjectPolicyResultBuilder {
  readonly removedGeodesicIds: Set<string>;
  readonly failedConnectedGeodesicIds: Set<string>;
  readonly removedMeasuredGeodesicLengthIds: Set<string>;
  readonly removedProtractorAngleIds: Set<string>;
  readonly prunedIntersectionIds: Set<string>;
}

function createGeometryCommitComputedObjectPolicyResultBuilder(): GeometryCommitComputedObjectPolicyResultBuilder {
  return {
    removedGeodesicIds: new Set(),
    failedConnectedGeodesicIds: new Set(),
    removedMeasuredGeodesicLengthIds: new Set(),
    removedProtractorAngleIds: new Set(),
    prunedIntersectionIds: new Set(),
  };
}

function freezeGeometryCommitComputedObjectPolicyResult(
  result: GeometryCommitComputedObjectPolicyResultBuilder,
): GeometryCommitComputedObjectPolicyResult {
  return {
    removedGeodesicIds: [...result.removedGeodesicIds],
    failedConnectedGeodesicIds: [...result.failedConnectedGeodesicIds],
    removedMeasuredGeodesicLengthIds: [...result.removedMeasuredGeodesicLengthIds],
    removedProtractorAngleIds: [...result.removedProtractorAngleIds],
    prunedIntersectionIds: [...result.prunedIntersectionIds],
  };
}
