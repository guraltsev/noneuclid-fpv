/**
 * World object owners: the single authority on the pose of an object that can be moved (creatures, the marmot, collidable static assets).
 * An owner holds its pose and publishes it into the runtime object registry (a read model for owned objects) through the publisher returned by `claimOwnership`; every other registry write for that id throws.
 * `ObjectHost.placeAt(id, cellId, localPose)` relocates any owned object by sending a placement command to its owner; the host knows nothing about the kind of object, leaders or collision.
 * Bulk fragments (bullets, stars and other particles) must not be modelled as owners or registry records per particle; they need a dedicated particle system.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import { depenetrateDynamicObject } from "../movement/depenetrateDynamicObject";
import type { RigidTransform3 } from "../math/rigidTransform3";
import { transformPoseWithCellMaps, type CellDeformationMap } from "../runtime/worldGeometryDeformations";
import {
  runtimeObjectToDynamicObjectState,
  type RuntimeObjectRegistry,
  type RuntimeWorldObject,
} from "./runtimeObjectRegistry";

/**
 * The only authority on the pose of one object. Implemented by creatures, the marmot and `PlainWorldObject`.
 */
export interface WorldObjectOwner {
  /** Registry id of the owned object. */
  readonly id: string;
  /** Placement command: relocate to `cellId` / `localPose` (cell-local, meters, radians). The owner decides how to react. */
  place(cellId: string, localPose: RigidTransform3): void;
  /** Remaps the pose through a geometry change; `nextWorld`, when given, is the world the pose now lives in. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
}

/**
 * Registry of owners by id, used to move or remap owned objects without knowing what they are.
 */
export interface ObjectHost {
  /** Registers an owner; throws if an owner with the same id is already registered. */
  register(owner: WorldObjectOwner): void;
  /** Forgets the owner with this id; silent if absent. */
  unregister(id: string): void;
  /** Sends the placement command to the owner of `id`; returns false if there is none. Does no collision push-out. */
  placeAt(id: string, cellId: string, localPose: RigidTransform3): boolean;
  /** Calls `transformGeometry` on every registered owner, in registration order. */
  transformGeometry(mapByCellId: ReadonlyMap<string, CellDeformationMap>, nextWorld?: CompiledCellComplex): void;
}

/**
 * Creates an empty object host.
 */
export function createObjectHost(): ObjectHost {
  const owners = new Map<string, WorldObjectOwner>();
  return {
    register(owner) {
      if (owners.has(owner.id)) {
        throw new Error(`Object owner "${owner.id}" is already registered.`);
      }

      owners.set(owner.id, owner);
    },
    unregister(id) {
      owners.delete(id);
    },
    placeAt(id, cellId, localPose) {
      const owner = owners.get(id);
      if (!owner) {
        return false;
      }

      owner.place(cellId, localPose);
      return true;
    },
    transformGeometry(mapByCellId, nextWorld) {
      for (const owner of [...owners.values()]) {
        owner.transformGeometry(mapByCellId, nextWorld);
      }
    },
  };
}

/**
 * Default owner for objects that need no logic (houses, bikes): holds `{ cellId, localPose }` and publishes it.
 */
export interface PlainWorldObject extends WorldObjectOwner {
  /** Releases registry ownership; does not remove the record. */
  dispose(): void;
}

/**
 * Creates the default owner for `initial`: adds the record if the registry has none, then claims it.
 * `place` adopts the pose and publishes it; `transformGeometry` maps the pose through the cell maps and, when a next world is given, pushes it out of obstacles. An unmappable pose is left unchanged.
 */
export function createPlainWorldObject(registry: RuntimeObjectRegistry, initial: RuntimeWorldObject): PlainWorldObject {
  if (registry.get(initial.id) === undefined) {
    registry.add(initial);
  }

  const publish = registry.claimOwnership(initial.id);
  let latest: RuntimeWorldObject = registry.get(initial.id) ?? initial;

  function publishPose(cellId: string, localPose: RigidTransform3): void {
    latest = { ...latest, cellId, localPose } as RuntimeWorldObject;
    publish(latest);
  }

  return {
    id: initial.id,
    place(cellId, localPose) {
      publishPose(cellId, localPose);
    },
    transformGeometry(mapByCellId, nextWorld) {
      const mapped = transformPoseWithCellMaps(latest, mapByCellId);
      if (!mapped) {
        return;
      }

      if (!nextWorld) {
        publishPose(mapped.cellId, mapped.localPose);
        return;
      }

      const resolved = depenetrateDynamicObject(
        nextWorld,
        runtimeObjectToDynamicObjectState({ ...latest, cellId: mapped.cellId, localPose: mapped.localPose }),
      ).object;
      publishPose(resolved.cellId, resolved.localPose);
    },
    dispose() {
      registry.releaseOwnership(initial.id);
    },
  };
}
