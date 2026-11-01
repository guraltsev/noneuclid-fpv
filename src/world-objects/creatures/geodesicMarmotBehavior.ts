/**
 * Motion of the geodesic marmot, with no renderer: the state it owns, how it advances each frame along its heading (a locally straight geodesic that stays straight as portals re-express the frame), and how it follows geometry changes.
 * The marmot turns only when a forbidden zone blocks it, by reflecting off the nearest zone. It registers its record in the runtime object registry and publishes every change of its pose there; the Three.js proxy mesh that shows it lives in `render/three/creatures/geodesicMarmotView`.
 * Units are meters and seconds; poses live in the current cell's local frame (x right, y forward, z up).
 */
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../../cell-complex/prismCells";
import type { GeodesicMarmotObjectSpec } from "../../cell-complex/specs";
import { transformPoseWithCellMaps, type CellDeformationMap } from "../../cell-complex/worldGeometryDeformations";
import { yawRigidTransform3, transformDirection3, type RigidTransform3 } from "../../math/rigidTransform3";
import { vec3 } from "../../math/vec3";
import { depenetrateDynamicObject } from "../../movement/depenetrateDynamicObject";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import {
  AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
  moveDynamicObject,
} from "../../movement/moveDynamicObject";
import { createGeodesicMarmotRuntimeObject } from "../geodesicMarmot";
import type { RuntimeObjectRegistry } from "../runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState, type RuntimeCreatureObject } from "../runtimeObjectBase";
import type { WorldObjectOwner } from "../worldObjectOwner";

/**
 * The motion state of one marmot, owned by its view.
 * `state` is the current cell, pose and collision shape (cell-local, meters, radians); `cellId` reports the marmot's current cell.
 */
export interface GeodesicMarmotBehavior extends WorldObjectOwner {
  readonly objectId: string;
  readonly cellId: string;
  /** Current cell, pose and collision shape; replaced (not mutated) by every update. */
  readonly state: DynamicObjectState;
  /** Advances the marmot by `deltaSeconds` along its heading, crossing portals as needed; no-op for non-positive speed or time; when a forbidden zone blocks the step it turns away from the nearest zone (reflection) instead of moving. */
  update(world: CompiledCellComplex, deltaSeconds: number): void;
  /** Remaps the current and initial poses through per-cell deformation maps after a live geometry change; leaves state untouched if either pose cannot be mapped; when `nextWorld` is given, both poses are then pushed out of obstacles in it. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
  /** Restores the initial (possibly deformation-remapped) cell and pose. */
  reset(): void;
}

/**
 * Creates the behavior for a marmot starting in `startCellId`.
 * Registers the object in `registry` when given (so it throws if the id already exists there) and claims ownership of its registry record, so only the marmot itself writes the record afterwards.
 */
export function createGeodesicMarmotBehavior(
  objectSpec: GeodesicMarmotObjectSpec,
  startCellId: string,
  registry?: RuntimeObjectRegistry,
): GeodesicMarmotBehavior {
  const initialObject = createGeodesicMarmotRuntimeObject(objectSpec, startCellId);
  registry?.add(initialObject);
  const publish = registry ? registry.claimOwnership(objectSpec.id) : (): void => {};
  let record: RuntimeCreatureObject = initialObject;
  let initialState = runtimeObjectToDynamicObjectState(initialObject);
  let state = initialState;
  const publishState = (): void => {
    record = { ...record, cellId: state.cellId, localPose: state.localPose, collision: state.collision };
    publish(record);
  };
  const forwardSpeedMetersPerSecond = Math.hypot(objectSpec.velocity.x, objectSpec.velocity.y);

  return {
    objectId: objectSpec.id,
    id: objectSpec.id,
    get cellId() {
      return state.cellId;
    },
    get state() {
      return state;
    },
    update(world, deltaSeconds) {
      if (forwardSpeedMetersPerSecond <= 0 || deltaSeconds <= 0) {
        return;
      }

      // Heading is the body +y axis; rotate the per-frame step into the cell frame.
      const displacement = transformDirection3(state.localPose, vec3(0, forwardSpeedMetersPerSecond * deltaSeconds, 0));
      const result = moveDynamicObject({
        world,
        object: state,
        displacement,
        portalCrossingMode: AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
      });
      state = result.blocked && result.blockingReason === "forbidden-zone"
        ? { ...state, localPose: turnAwayFromNearestForbiddenZone(state.localPose, world.cellsById.get(state.cellId)) }
        : result.object;
      publishState();
    },
    place(cellId, localPose) {
      state = { ...state, cellId, localPose };
      publishState();
    },
    transformGeometry(mapByCellId, nextWorld) {
      const transformedState = transformPoseWithCellMaps(state, mapByCellId);
      const transformedInitialState = transformPoseWithCellMaps(initialState, mapByCellId);
      if (!transformedState || !transformedInitialState) {
        return;
      }

      state = {
        ...state,
        cellId: transformedState.cellId,
        localPose: transformedState.localPose,
      };
      initialState = {
        ...initialState,
        cellId: transformedInitialState.cellId,
        localPose: transformedInitialState.localPose,
      };
      if (nextWorld) {
        state = depenetrateDynamicObject(nextWorld, state).object;
        initialState = depenetrateDynamicObject(nextWorld, initialState).object;
      }
      publishState();
    },
    reset() {
      state = initialState;
      publishState();
    },
  };
}

/**
 * Returns the pose turned away from the nearest forbidden-zone cylinder of the cell: the forward vector is reflected
 * about the radial normal from the zone center to the marmot, or reversed if that reflection would not point away.
 */
function turnAwayFromNearestForbiddenZone(pose: RigidTransform3, cell: CompiledPrismCell | undefined): RigidTransform3 {
  const forward = transformDirection3(pose, vec3(0, 1, 0));
  const position = pose.translation;
  let nearestCenter: { readonly x: number; readonly y: number } | undefined;
  let nearestDistance = Infinity;
  for (const column of cell?.singularityColumns ?? []) {
    const distance = Math.hypot(position.x - column.center.x, position.y - column.center.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestCenter = column.center;
    }
  }
  let next = { x: -forward.x, y: -forward.y };
  if (nearestCenter && nearestDistance > 1e-9) {
    const normalX = (position.x - nearestCenter.x) / nearestDistance;
    const normalY = (position.y - nearestCenter.y) / nearestDistance;
    const dot = forward.x * normalX + forward.y * normalY;
    if (dot < 0) {
      next = { x: forward.x - 2 * dot * normalX, y: forward.y - 2 * dot * normalY };
    }
  }
  return yawRigidTransform3(Math.atan2(-next.x, next.y), position);
}
