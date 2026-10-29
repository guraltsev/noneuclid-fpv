/**
 * Geodesic marmot: an autonomous creature that walks in a straight line (a locally straight geodesic) through the cell complex, crossing portals.
 * Provides the authoring helper that produces a GeodesicMarmotObjectSpec, the runtime that owns its three.js proxy mesh and moves it each frame via moveDynamicObject with the autonomous portal-crossing mode, and the registry record kept in the RuntimeObjectRegistry.
 * Units are meters and seconds; poses live in the current cell's local frame (x right, y forward, z up) and the heading is a yaw in radians derived from the authored velocity as yaw = atan2(-vx, vy), so the marmot walks along its authored velocity (body +y axis R·e_y = (-sin yaw, cos yaw)). Forward speed is the magnitude of the 2D velocity and is constant; the marmot turns only when a forbidden zone blocks it, by reflecting off the nearest zone.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { CompiledPrismCell } from "../cell-complex/prismCells";
import type { CellObjectSpec, GeodesicMarmotObjectSpec } from "../cell-complex/specs";
import { yawRigidTransform3, transformDirection3, type RigidTransform3 } from "../math/rigidTransform3";
import { vec3 } from "../math/vec3";
import type { DynamicObjectState } from "../movement/dynamicObject";
import {
  AUTONOMOUS_DYNAMIC_OBJECT_PORTAL_CROSSING_MODE,
  moveDynamicObject,
} from "../movement/moveDynamicObject";
import { buildStaticMarmotProxy } from "../render/three/buildDecorationMesh";
import {
  buildObjectCollisionWireframe,
  updateObjectCollisionWireframe,
} from "../render/three/debugCollisionWireframes";
import { runtimeDiagnostics } from "../render/three/runtimeDiagnostics";
import type { PreparedWorldAssets } from "../render/three/preloadWorldAssets";
import { applyWorldRigidTransform } from "../render/three/worldAxes";
import { transformPoseWithCellMaps, type CellDeformationMap } from "../runtime/worldGeometryDeformations";
import type { RuntimeObjectRegistry } from "./runtimeObjectRegistry";
import { runtimeObjectToDynamicObjectState, type RuntimeCreatureObject } from "./runtimeObjectRegistry";

const defaultCollisionOffset = { x: 0, y: 0, z: 0.22 } as const;
const defaultScale = 0.42;

/**
 * Inputs for createGeodesicMarmot.
 * `position` is already in cell-local coordinates (meters; z is height) and `velocity` is the planar cell-local velocity in m/s whose direction fixes the initial heading and whose magnitude is the walking speed.
 */
export interface CreateGeodesicMarmotOptions {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly velocity: { readonly x: number; readonly y: number };
  readonly scale?: number;
  readonly class?: string;
  readonly do_not_collide_with?: readonly string[];
  readonly displayHelpMessage?: string;
}

/**
 * Per-marmot runtime handle owned by the renderer.
 * `root` is the three.js group (reparented into the current cell's root by `syncParent`); `cellId` reports the marmot's current cell.
 */
export interface GeodesicMarmotRuntime {
  readonly root: THREE.Object3D;
  readonly objectId: string;
  readonly cellId: string;
  /** Advances the marmot by `deltaSeconds` along its heading, crossing portals as needed; no-op for non-positive speed or time; when a forbidden zone blocks the step it turns away from the nearest zone (reflection) instead of moving. */
  update(world: CompiledCellComplex, deltaSeconds: number): void;
  /** Attaches `root` to the scene node of the marmot's current cell if it is not already there. */
  syncParent(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
  /** Shows or hides the debug collision cylinder. */
  setCollisionWireframeVisible(visible: boolean): void;
  /** Remaps the current and initial poses through per-cell deformation maps after a live geometry change; leaves state untouched if either pose cannot be mapped. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>): void;
  /** Restores the initial (possibly deformation-remapped) cell and pose and reattaches to that cell's root. */
  reset(cellRoots: ReadonlyMap<string, THREE.Object3D>): void;
}

/**
 * Creates the authored spec for a geodesic marmot.
 * Fixes the library-owned asset, a 0.36 m radius by 0.42 m collision cylinder, a default scale of 0.42 and the class "creature" unless overridden; the initial yaw is derived from `options.velocity`.
 */
export function createGeodesicMarmot(options: CreateGeodesicMarmotOptions): GeodesicMarmotObjectSpec {
  return {
    id: options.id,
    kind: "geodesci-marmot",
    assetPath: "_legacy/racoon-animation/scene.gltf",
    position: options.position,
    scale: options.scale ?? defaultScale,
    yawRadians: yawFromVelocity(options.velocity),
    velocity: options.velocity,
    collision: {
      radius: 0.36,
      height: 0.42,
      offset: defaultCollisionOffset,
    },
    class: options.class ?? "creature",
    do_not_collide_with: options.do_not_collide_with,
    displayHelpMessage: options.displayHelpMessage,
  };
}

/**
 * Type guard: true when a cell object spec is a geodesic marmot.
 */
export function isGeodesicMarmotObjectSpec(objectSpec: CellObjectSpec): objectSpec is GeodesicMarmotObjectSpec {
  return objectSpec.kind === "geodesci-marmot";
}

/**
 * Creates the runtime (three.js group, state machine, registry entry) for a marmot starting in `startCellId`.
 * Registers the object in `registry` when given (so it throws if the id already exists there). The visual is a static proxy mesh, not the glTF in `objectSpec.assetPath`, so the `_assets` argument is unused. Movement follows the current heading in the cell's local frame, so the path is a geodesic: it stays straight as portals re-express the frame.
 */
export function createGeodesicMarmotRuntime(
  objectSpec: GeodesicMarmotObjectSpec,
  startCellId: string,
  _assets: PreparedWorldAssets,
  registry?: RuntimeObjectRegistry,
): GeodesicMarmotRuntime {
  const root = new THREE.Group();
  root.name = `geodesci-marmot:${objectSpec.id}`;

  const visual = buildStaticMarmotProxy(objectSpec.id);
  visual.rotation.y = Math.PI;
  visual.scale.setScalar(objectSpec.scale ?? defaultScale);
  root.add(visual);
  const initialObject = createRuntimeCreatureObject(objectSpec, startCellId);
  registry?.add(initialObject);
  let initialState = runtimeObjectToDynamicObjectState(initialObject);
  let state = initialState;
  const collisionWireframe = buildObjectCollisionWireframe(objectSpec.id, state);
  collisionWireframe.visible = false;
  root.add(collisionWireframe);
  // The debug option decides visibility; updateObjectCollisionWireframe alone would show it whenever bounds exist.
  let collisionWireframeRequested = false;
  const refreshCollisionWireframe = (): void => {
    updateObjectCollisionWireframe(collisionWireframe, state);
    collisionWireframe.visible = collisionWireframeRequested && collisionWireframe.visible;
  };
  refreshCollisionWireframe();
  const forwardSpeedMetersPerSecond = Math.hypot(objectSpec.velocity.x, objectSpec.velocity.y);
  const diagnostics = runtimeDiagnostics();

  diagnostics.recordAssetInstanceStart(startCellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  diagnostics.recordAssetInstanceComplete(startCellId, objectSpec.id, objectSpec.assetPath, objectSpec.kind);
  applyObjectPose(root, state.localPose);

  return {
    root,
    objectId: objectSpec.id,
    get cellId() {
      return state.cellId;
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
      syncRegistryObject(registry, objectSpec.id, state);
      applyObjectPose(root, state.localPose);
      refreshCollisionWireframe();
    },
    syncParent(cellRoots) {
      const targetRoot = cellRoots.get(state.cellId);

      if (targetRoot && root.parent !== targetRoot) {
        targetRoot.add(root);
      }
    },
    setCollisionWireframeVisible(visible) {
      collisionWireframeRequested = visible;
      refreshCollisionWireframe();
    },
    transformGeometry(mapByCellId) {
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
      syncRegistryObject(registry, objectSpec.id, state);
      applyObjectPose(root, state.localPose);
      refreshCollisionWireframe();
    },
    reset(cellRoots) {
      state = initialState;
      syncRegistryObject(registry, objectSpec.id, state);
      applyObjectPose(root, state.localPose);
      refreshCollisionWireframe();
      const targetRoot = cellRoots.get(state.cellId);

      if (targetRoot && root.parent !== targetRoot) {
        targetRoot.add(root);
      }
    },
  };
}

/**
 * Builds the registry record for a marmot spec in the given cell without creating any three.js objects.
 */
export function createGeodesicMarmotRuntimeObject(
  objectSpec: GeodesicMarmotObjectSpec,
  cellId: string,
): RuntimeCreatureObject {
  return createRuntimeCreatureObject(objectSpec, cellId);
}

function createRuntimeCreatureObject(objectSpec: GeodesicMarmotObjectSpec, cellId: string): RuntimeCreatureObject {
  return {
    id: objectSpec.id,
    kind: "geodesci-marmot",
    cellId,
    localPose: yawRigidTransform3(
      objectSpec.yawRadians ?? yawFromVelocity(objectSpec.velocity),
      vec3(objectSpec.position.x, objectSpec.position.y, objectSpec.position.z),
    ),
    collision: objectSpec.collision,
    class: objectSpec.class,
    do_not_collide_with: objectSpec.do_not_collide_with,
    portalRenderable: true,
    displayHelpMessage: objectSpec.displayHelpMessage ?? "A moving marmot that follows geodesic paths through the world.",
    tooltip: {
      label: "geodesic marmot",
      rangeMeters: 2.25,
    },
  };
}

function syncRegistryObject(
  registry: RuntimeObjectRegistry | undefined,
  id: string,
  state: DynamicObjectState,
): void {
  if (!registry) {
    return;
  }

  const object = registry.get(id);
  if (!object || object.kind !== "geodesci-marmot") {
    return;
  }

  registry.update({
    ...object,
    cellId: state.cellId,
    localPose: state.localPose,
    collision: state.collision,
  });
}

// Forward is the body +y axis R·e_y = (-sin yaw, cos yaw); yaw = atan2(-vx, vy) makes it point along the velocity.
function yawFromVelocity(velocity: GeodesicMarmotObjectSpec["velocity"]): number {
  return Math.atan2(-velocity.x, velocity.y);
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

function applyObjectPose(root: THREE.Object3D, pose: RigidTransform3): void {
  applyWorldRigidTransform(root, pose);
}
