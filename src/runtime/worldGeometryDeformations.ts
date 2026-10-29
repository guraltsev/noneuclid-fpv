/**
 * Family-independent vocabulary and helpers for live deformation of a cell complex while preserving its combinatorics (cells, sides, portals and their pairing).
 * A WorldDeformationState is a small parameter record (static-world, or torus-skew with width w, skew a and depth b); a WorldDeformationFamily knows how to turn a base CellComplexSpec plus a state into a deformed spec, how to step the state toward a target, and how to validate that a rebuilt world is topology preserving.
 * For each pair (previous state, next state) a family also yields one CellDeformationMap per cell: the map between the previous and next local frame of that cell. Maps carry points, headings, poses, starting positions and positioned objects across a geometry commit, so the player and creatures keep the same place in the deforming cell.
 * Everything here is pure and immutable: functions return new specs and objects, and validation is by exact side/portal bookkeeping with a 1e-6 m tolerance.
 */
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { FloorLatticeUvFrame } from "../cell-complex/floorUv";
import type { CellComplexSpec, CellObjectSpec, PositionedCellObjectSpec, PrismCellSpec } from "../cell-complex/specs";
import { yawRigidTransform3, type RigidTransform3 } from "../math/rigidTransform3";
import { normalizeVec3, vec3, type Vec3 } from "../math/vec3";
import type { TorusSkewDeformationState } from "./deformations/torusSkewDeformation";

/** Deformation state of a world that is never deformed. */
export interface StaticWorldDeformationState {
  readonly kind: "static-world";
}

/** Union of all deformation parameter records, discriminated by kind; extend it when adding a family. */
export type WorldDeformationState = StaticWorldDeformationState | TorusSkewDeformationState;

/** Step-size limits for moving a deformation state toward its target one rebuild at a time. */
export interface DynamicGeometryStepOptions {
  /** Maximum parameter-space distance (meters) a single step may travel. */
  readonly maxStepMeters: number;
  /**
   * Distance at or below which the step jumps straight to the target; the torus family defaults it to 1e-9.
   */
  readonly snapToleranceMeters?: number;
}

/**
 * Spatial map between a cell's previous and next local frames (cell-local meters), used to carry points and headings across a geometry commit.
 */
export interface CellDeformationMap {
  /** Id of the cell whose local frame this map acts on. */
  readonly cellId: string;
  /** Returns the image of a cell-local point under the deformation; does not mutate the input. */
  mapPoint(point: Vec3): Vec3;
  /**
   * Returns the image of a cell-local direction vector (translation-free, not unit length in general); atPoint is the base point for non-affine maps and is ignored by affine ones.
   */
  mapDirection(direction: Vec3, atPoint?: Vec3): Vec3;
}

/**
 * Strategy object defining one family of deformations of a cell-complex spec, parameterized by its state type.
 */
export interface WorldDeformationFamily<TState extends WorldDeformationState> {
  /** Discriminant matching TState["kind"]; the registry key. */
  readonly kind: TState["kind"];

  /** Returns whether the base spec has the structure this family requires. */
  canApplyToSpec(baseSpec: CellComplexSpec): boolean;
  /** Validates a state against the base spec and returns a canonical copy; throws if it is out of range. */
  normalizeState(baseSpec: CellComplexSpec, state: TState): TState;
  /**
   * Returns a new spec with the geometry (and spec-level positions such as startingPosition and cell objects) deformed to the given normalized state; the base spec is not mutated.
   */
  applyToSpec(baseSpec: CellComplexSpec, state: TState): CellComplexSpec;

  /**
   * Returns, keyed by cell id, the maps taking positions in the previous state's world to the next state's world, for live objects and the player at a commit.
   */
  createDynamicObjectMaps(
    previous: TState,
    next: TState,
    previousWorld: CompiledCellComplex,
    nextWorld: CompiledCellComplex,
  ): ReadonlyMap<string, CellDeformationMap>;

  /**
   * Returns the state one bounded step from current toward target (the target itself once within tolerance).
   */
  nextStep(
    current: TState,
    target: TState,
    options: DynamicGeometryStepOptions,
  ): TState;

  /**
   * Returns human-readable errors if the next compiled world is not an acceptable successor of the previous one; an empty array means valid.
   */
  validateSnapshot(
    previousWorld: CompiledCellComplex,
    nextWorld: CompiledCellComplex,
  ): readonly string[];

  /**
   * Optional floor-texture policy: per cell id, the lattice frame whose coordinates the floor UVs follow in the given state. Cells not in the map use metric UVs. Families without this method use metric UVs everywhere.
   */
  floorUvFrames?(baseSpec: CellComplexSpec, state: TState): ReadonlyMap<string, FloorLatticeUvFrame>;
}

/** Replacement footprint (2D vertices in order, meters) for one prism cell identified by id. */
export interface PrismBaseReplacement {
  readonly cellId: string;
  readonly baseVertices: readonly { readonly x: number; readonly y: number }[];
}

/** Rigid pose expressed in the local frame of a named cell. */
export interface RuntimePoseInCell {
  readonly cellId: string;
  readonly localPose: RigidTransform3;
}

const topologyToleranceMeters = 1e-6;

/**
 * Returns a spec whose listed cells have their baseVertices replaced (copied) while all else is shared with the input; throws if any replacement names a missing cell.
 */
export function applyPrismBaseReplacements(
  baseSpec: CellComplexSpec,
  replacements: readonly PrismBaseReplacement[],
): CellComplexSpec {
  const replacementsByCellId = new Map(replacements.map((replacement) => [replacement.cellId, replacement]));
  const seenCellIds = new Set<string>();

  const cells = baseSpec.cells.map((cell) => {
    const replacement = replacementsByCellId.get(cell.id);
    if (!replacement) {
      return cell;
    }

    seenCellIds.add(cell.id);
    return {
      ...cell,
      baseVertices: replacement.baseVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    };
  });

  const missing = replacements.filter((replacement) => !seenCellIds.has(replacement.cellId));
  if (missing.length > 0) {
    throw new Error(`Cannot replace missing prism base cells: ${missing.map((replacement) => `"${replacement.cellId}"`).join(", ")}.`);
  }

  return {
    ...baseSpec,
    cells,
  };
}

/** Maps a cell-local pose through the map for its cell, or returns undefined if that cell has no map. */
export function transformPoseWithCellMaps(
  pose: RuntimePoseInCell,
  mapsByCellId: ReadonlyMap<string, CellDeformationMap>,
): RuntimePoseInCell | undefined {
  const map = mapsByCellId.get(pose.cellId);
  if (!map) {
    return undefined;
  }

  return {
    cellId: map.cellId,
    localPose: transformRigidPoseWithMap(pose.localPose, map),
  };
}

/**
 * Maps a pose by sending its translation through mapPoint and its forward vector R·e_y (the rotation's second column, projected to the horizontal plane) through mapDirection; the new yaw makes R'·e_y parallel to the mapped forward vector. The result is a pure yaw rotation, so pitch and roll are discarded.
 */
export function transformRigidPoseWithMap(
  pose: RigidTransform3,
  map: CellDeformationMap,
): RigidTransform3 {
  const translation = map.mapPoint(pose.translation);
  // Forward is R·e_y = (m01, m11); carry it through the linear part of the map and rebuild the yaw from it.
  const forward = map.mapDirection(vec3(pose.rotation.m01, pose.rotation.m11, 0), pose.translation);
  const yawRadians = yawFromMappedForward(forward);

  return yawRigidTransform3(yawRadians, translation);
}

/**
 * Returns a copy of a cell-object spec with position and yaw (turnRadians or yawRadians, whichever is defined) mapped; for marmots the velocity direction is mapped by the linear part, its speed kept, and the yaw re-derived as atan2(-v'x, v'y).
 */
export function transformPositionedObjectSpecWithMap<TObject extends CellObjectSpec>(
  object: TObject,
  map: CellDeformationMap,
): TObject {
  const yawRadians = object.turnRadians ?? object.yawRadians ?? 0;
  const transformedPose = transformRigidPoseWithMap(
    yawRigidTransform3(yawRadians, object.position),
    map,
  );
  const transformedYawRadians = yawFromRigidPose(transformedPose);
  const transformedObject = {
    ...object,
    position: transformedPose.translation,
    turnRadians: object.turnRadians === undefined ? undefined : transformedYawRadians,
    yawRadians: object.yawRadians === undefined ? undefined : transformedYawRadians,
  };

  if (object.kind === "geodesci-marmot") {
    // The marmot walks along its velocity (yaw = atan2(-vx, vy)); carry the velocity direction by the map, keep the speed.
    const speedMetersPerSecond = Math.hypot(object.velocity.x, object.velocity.y);
    if (speedMetersPerSecond === 0) {
      return transformedObject as TObject;
    }
    const forward = normalizeVec3(map.mapDirection(vec3(object.velocity.x, object.velocity.y, 0), object.position));
    return {
      ...transformedObject,
      velocity: { x: forward.x * speedMetersPerSecond, y: forward.y * speedMetersPerSecond },
      yawRadians: Math.atan2(-forward.x, forward.y),
    } as TObject;
  }

  return transformedObject as TObject;
}

/**
 * Maps a spec's startingPosition through the map for its cell; returns it unchanged if there is no map and undefined if there is no starting position.
 */
export function transformStartingPositionWithMap(
  startingPosition: CellComplexSpec["startingPosition"],
  mapsByCellId: ReadonlyMap<string, CellDeformationMap>,
): CellComplexSpec["startingPosition"] {
  if (!startingPosition) {
    return undefined;
  }

  const transformed = transformPoseWithCellMaps(
    {
      cellId: startingPosition.cellId,
      localPose: yawRigidTransform3(startingPosition.yawRadians ?? 0, startingPosition.position),
    },
    mapsByCellId,
  );

  if (!transformed) {
    return startingPosition;
  }

  return {
    ...startingPosition,
    cellId: transformed.cellId,
    position: transformed.localPose.translation,
    yawRadians: yawFromRigidPose(transformed.localPose),
  };
}

/**
 * Returns the cell with every visuals.objects entry mapped by the cell's map, or the same cell if it has no map or no objects.
 */
export function transformCellObjectsWithMaps(
  cell: PrismCellSpec,
  mapsByCellId: ReadonlyMap<string, CellDeformationMap>,
): PrismCellSpec {
  const map = mapsByCellId.get(cell.id);
  if (!map || !cell.visuals?.objects) {
    return cell;
  }

  return {
    ...cell,
    visuals: {
      ...cell.visuals,
      objects: cell.visuals.objects.map((object) => transformPositionedObjectSpecWithMap(object, map)),
    },
  };
}

/** Creates a copy-through map for every cell of the world, used by families that do not move anything. */
export function createIdentityCellDeformationMaps(world: CompiledCellComplex): ReadonlyMap<string, CellDeformationMap> {
  return new Map(
    world.cells.map((cell) => [
      cell.id,
      {
        cellId: cell.id,
        mapPoint(point) {
          return { ...point };
        },
        mapDirection(direction) {
          return { ...direction };
        },
      },
    ]),
  );
}

/**
 * Lists differences in cell ids, side counts, heights, portal ids, side indices and pairings between two compiled worlds, plus any portal pair in the next world whose two sides differ in length by more than 1e-6 m.
 */
export function validateTopologyPreservingSnapshot(
  previousWorld: CompiledCellComplex,
  nextWorld: CompiledCellComplex,
): readonly string[] {
  const errors: string[] = [];
  const previousCellIds = previousWorld.cells.map((cell) => cell.id).sort();
  const nextCellIds = nextWorld.cells.map((cell) => cell.id).sort();

  if (previousCellIds.join("\0") !== nextCellIds.join("\0")) {
    errors.push(
      `Cell ids changed: previous [${previousCellIds.join(", ")}], next [${nextCellIds.join(", ")}].`,
    );
  }

  for (const previousCell of previousWorld.cells) {
    const nextCell = nextWorld.cellsById.get(previousCell.id);
    if (!nextCell) {
      continue;
    }

    if (previousCell.sideCount !== nextCell.sideCount) {
      errors.push(
        `Cell "${previousCell.id}" side count changed from ${previousCell.sideCount} to ${nextCell.sideCount}.`,
      );
    }

    if (Math.abs(previousCell.heightMeters - nextCell.heightMeters) > topologyToleranceMeters) {
      errors.push(
        `Cell "${previousCell.id}" height changed from ${previousCell.heightMeters}m to ${nextCell.heightMeters}m.`,
      );
    }

    const previousPortals = [...previousCell.portals].sort((left, right) => left.id.localeCompare(right.id));
    const nextPortals = [...nextCell.portals].sort((left, right) => left.id.localeCompare(right.id));
    const previousPortalIds = previousPortals.map((portal) => portal.id);
    const nextPortalIds = nextPortals.map((portal) => portal.id);

    if (previousPortalIds.join("\0") !== nextPortalIds.join("\0")) {
      errors.push(
        `Cell "${previousCell.id}" portal ids changed: previous [${previousPortalIds.join(", ")}], next [${nextPortalIds.join(", ")}].`,
      );
    }

    for (const previousPortal of previousPortals) {
      const nextPortal = nextCell.portalsById.get(previousPortal.id);
      if (!nextPortal) {
        continue;
      }

      if (previousPortal.sideIndex !== nextPortal.sideIndex) {
        errors.push(
          `Portal "${previousCell.id}:${previousPortal.id}" side index changed from ${previousPortal.sideIndex} to ${nextPortal.sideIndex}.`,
        );
      }

      if (
        previousPortal.targetCellId !== nextPortal.targetCellId ||
        previousPortal.targetPortalId !== nextPortal.targetPortalId ||
        previousPortal.reciprocalPortalId !== nextPortal.reciprocalPortalId
      ) {
        errors.push(`Portal "${previousCell.id}:${previousPortal.id}" target pairing changed.`);
      }
    }
  }

  const checkedPairs = new Set<string>();
  for (const cell of nextWorld.cells) {
    for (const portal of cell.portals) {
      const targetCell = nextWorld.cellsById.get(portal.targetCellId);
      const targetPortal = targetCell?.portalsById.get(portal.targetPortalId);
      if (!targetCell || !targetPortal) {
        continue;
      }

      const pairKey = [cell.id, portal.id, targetCell.id, targetPortal.id].sort().join(":");
      if (checkedPairs.has(pairKey)) {
        continue;
      }
      checkedPairs.add(pairKey);

      const sourceLength = cell.sides[portal.sideIndex]?.lengthMeters;
      const targetLength = targetCell.sides[targetPortal.sideIndex]?.lengthMeters;
      if (
        sourceLength === undefined ||
        targetLength === undefined ||
        Math.abs(sourceLength - targetLength) > topologyToleranceMeters
      ) {
        errors.push(
          `Portal pair "${cell.id}:${portal.id}" <-> "${targetCell.id}:${targetPortal.id}" has incompatible side lengths.`,
        );
      }
    }
  }

  return errors;
}

/** Throws an Error listing every difference found by validateTopologyPreservingSnapshot, if any. */
export function assertTopologyPreservingSnapshot(
  previousWorld: CompiledCellComplex,
  nextWorld: CompiledCellComplex,
): void {
  const errors = validateTopologyPreservingSnapshot(previousWorld, nextWorld);
  if (errors.length > 0) {
    throw new Error(`World geometry hot swap is not topology preserving:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

/**
 * Compares two states structurally over their own enumerable keys, independent of key order; numbers are compared with === (so NaN differs from NaN and 0 equals -0).
 */
export function deformationStatesEqual(left: WorldDeformationState, right: WorldDeformationState): boolean {
  return structurallyEqual(left, right);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && structurallyEqual(leftRecord[key], rightRecord[key]),
  );
}

function yawFromMappedForward(forward: Vec3): number {
  const horizontal = normalizeVec3({ x: forward.x, y: forward.y, z: 0 });
  return Math.atan2(-horizontal.x, horizontal.y);
}

function yawFromRigidPose(pose: RigidTransform3): number {
  return Math.atan2(pose.rotation.m10, pose.rotation.m00);
}

/** Alias of PositionedCellObjectSpec for objects that deformation maps can move. */
export type DeformablePositionedObject = PositionedCellObjectSpec;
