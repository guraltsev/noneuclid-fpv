/**
 * Pure transforms that carry live state across a geometry commit: the player pose, a placed sign and a geodesic emitter are sent
 * through the per-cell deformation maps of the previous to the new world. None of them touches the registry or the renderer;
 * the caller applies the result (see `geometryCommit.ts`). Positions are cell-local meters, yaws radians about +z.
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { type CellDeformationMap, transformPoseWithCellMaps } from "../../cell-complex/worldGeometryDeformations";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { depenetrateDynamicObject } from "../../movement/depenetrateDynamicObject";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { type PlayerPose, playerPoseFromDynamicObject } from "../../movement/playerPose";
import type { RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState } from "../../world-objects/runtimeObjectBase";
import type { PlacedFlagObject } from "../../world-objects/toolObjects";
import { transformYawWithMap, yawFromPose } from "./runtimeSceneUtils";

/** Outcome of mapping the player: no legal image (reset to home), or a pose; `foundLegalPose` is false when no legal pose was found and the mapped pose is kept. */
export type PlayerGeometryCommitResult =
  | { readonly kind: "reset" }
  | { readonly kind: "pose"; readonly pose: PlayerPose; readonly foundLegalPose: boolean };

/**
 * Maps the player through the cell maps and pushes the image out of obstacles of `nextWorld`. The pose keeps its cell
 * (renamed by the map) and its pitch. `reset` when the cell has no map or the image's cell is not in `nextWorld`.
 */
export function transformPlayerPoseForGeometryCommit(
  pose: PlayerPose,
  mapByCellId: ReadonlyMap<string, CellDeformationMap>,
  nextWorld: CompiledCellComplex,
  createCollisionState: (pose: PlayerPose) => DynamicObjectState,
): PlayerGeometryCommitResult {
  const transformed = transformPoseWithCellMaps(
    { cellId: pose.cellId, localPose: yawRigidTransform3(pose.yawRadians, pose.position) },
    mapByCellId,
  );
  if (!transformed || !nextWorld.cellsById.has(transformed.cellId)) {
    return { kind: "reset" };
  }

  const mappedPose: PlayerPose = {
    ...pose,
    cellId: transformed.cellId,
    position: transformed.localPose.translation,
    yawRadians: yawFromPose(transformed.localPose),
  };
  const result = depenetrateDynamicObject(nextWorld, createCollisionState(mappedPose));
  if (result.kind === "failed") {
    return { kind: "pose", pose: mappedPose, foundLegalPose: false };
  }
  return { kind: "pose", pose: playerPoseFromDynamicObject(result.object, mappedPose.pitchRadians), foundLegalPose: true };
}

/** Maps a placed sign through the cell maps and pushes it out of obstacles; `undefined` when its cell has no map (the sign is removed). */
export function transformPlacedFlagForGeometryCommit(
  flag: PlacedFlagObject,
  mapByCellId: ReadonlyMap<string, CellDeformationMap>,
  nextWorld: CompiledCellComplex,
): PlacedFlagObject | undefined {
  const transformed = transformPoseWithCellMaps(flag, mapByCellId);
  if (!transformed) {
    return undefined;
  }

  const depenetrated = depenetrateDynamicObject(
    nextWorld,
    runtimeObjectToDynamicObjectState({ ...flag, cellId: transformed.cellId, localPose: transformed.localPose }),
  );
  return { ...flag, cellId: depenetrated.object.cellId, localPose: depenetrated.object.localPose };
}

/**
 * Maps an emitter's pose, aim yaw and per-geodesic launch yaws through its cell's map; `undefined` when the cell has no map
 * (the emitter is removed). The geodesics themselves are rebuilt afterwards by the computed-object policy.
 */
export function transformGeodesicCannonForGeometryCommit(
  object: Extract<RuntimeWorldObject, { readonly kind: "geodesicEmitters/emitter" }>,
  mapByCellId: ReadonlyMap<string, CellDeformationMap>,
): Extract<RuntimeWorldObject, { readonly kind: "geodesicEmitters/emitter" }> | undefined {
  const map = mapByCellId.get(object.cellId);
  if (!map) {
    return undefined;
  }

  const position = map.mapPoint(object.localPose.translation);
  const aimYawRadians = transformYawWithMap(object.aimYawRadians, object.localPose.translation, map);

  return {
    ...object,
    cellId: map.cellId,
    localPose: yawRigidTransform3(aimYawRadians, position),
    aimYawRadians,
  };
}
