/**
 * Consistency checker for geodesic creatures (marmot, mouse, butterfly) that produces a debug dump.
 *
 * For each creature runtime it cross-checks three sources of truth: the runtime's Three.js root (parent cell node, visibility,
 * position in the Three.js frame), the runtime object registry (cell id, kind, cell-local pose in world axes: x right, y forward,
 * z up, meters) and the compiled cell (collision cylinder inside the cell polygon). Each discrepancy becomes a short issue
 * code string in the record. The check is read-only and allocation-heavy, intended for on-demand debugging, not per-frame use.
 * Numbers in the dump are rounded to 1e-6.
 */
import * as THREE from "three";
import type { CompiledCellComplex } from "../../cell-complex/compileCellComplex";
import { getDynamicObjectCollisionBounds, signedDistanceToSide, testCellCollision } from "../../movement/collision";
import { runtimeObjectToDynamicObjectState, type RuntimeObjectRegistry } from "../../world-objects/runtimeObjectRegistry";
import type { GeodesicMarmotRuntime } from "../../world-objects/geodesicMarmot";
import type { SimpleGeoCreatureRuntime } from "../../world-objects/simpleGeoCreature";
import { worldPointToThree } from "./worldAxes";

/** Any creature runtime that exposes a Three.js `root` plus `objectId` and `cellId`. */
export type GeodesicCreatureRuntime = GeodesicMarmotRuntime | SimpleGeoCreatureRuntime;

/** Diagnostic snapshot for one creature, with an `issues` list of problem codes (empty when consistent). */
export interface GeodesicCreatureDebugRecord {
  /** Registry object id of the creature. */
  readonly id: string;
  /** Registry kind, if the object is registered. */
  readonly kind?: string;
  /** Cell the runtime believes it is in. */
  readonly runtimeCellId: string;
  /** Cell recorded in the registry; differing from `runtimeCellId` yields `registry-cell-mismatch`. */
  readonly registryCellId?: string;
  /** Cell whose root node is the actual Three.js parent of the creature root, if any. */
  readonly parentCellId?: string;
  /** Registry pose translation in the cell-local world frame (x right, y forward, z up), meters. */
  readonly localPosition?: { readonly x: number; readonly y: number; readonly z: number };
  /** Actual local position of the creature root in its parent's Three.js frame (y up), meters. */
  readonly threePosition: { readonly x: number; readonly y: number; readonly z: number };
  /** `localPosition` converted to the Three.js frame; `threePosition` should match within 1e-4 m. */
  readonly expectedThreePosition?: { readonly x: number; readonly y: number; readonly z: number };
  /** Collision cylinder centre in the cell-local world frame, meters. */
  readonly collisionCenter?: { readonly x: number; readonly y: number; readonly z: number };
  /** Collision cylinder radius, meters. */
  readonly collisionRadius?: number;
  /** Collision cylinder half-height, meters. */
  readonly collisionHalfHeight?: number;
  /** The root's own `visible` flag. */
  readonly renderVisible: boolean;
  /** True if the root and all its ancestors are visible. */
  readonly ancestorsVisible: boolean;
  /** Issue codes, e.g. `runtime-cell-missing`, `parent-cell-mismatch`, `render-hidden`, `root-pose-mismatch`, `collision-<reason>`, `outside-side-<n>`. */
  readonly issues: readonly string[];
}

/** Result of a full creature consistency pass. */
export interface GeodesicCreatureDebugDump {
  /** Wall-clock time of the check, ISO 8601. */
  readonly checkedAtIso: string;
  readonly creatureCount: number;
  /** Total number of issue codes over all records. */
  readonly issueCount: number;
  readonly records: readonly GeodesicCreatureDebugRecord[];
}

/**
 * Checks every creature runtime against the registry, cell roots and compiled cell, and returns the findings.
 *
 * Updates the world matrices of each creature root as a side effect. Runtimes whose cell, registry entry or parent
 * node are missing are reported as issues rather than throwing. `cellRoots` maps cell ids to their Three.js nodes.
 */
export function collectGeodesicCreatureDebugDump(options: {
  readonly world: CompiledCellComplex;
  readonly runtimes: readonly GeodesicCreatureRuntime[];
  readonly registry: RuntimeObjectRegistry;
  readonly cellRoots: ReadonlyMap<string, THREE.Object3D>;
}): GeodesicCreatureDebugDump {
  const records = options.runtimes.map((runtime) =>
    collectGeodesicCreatureDebugRecord(runtime, options.world, options.registry, options.cellRoots),
  );

  return {
    checkedAtIso: new Date().toISOString(),
    creatureCount: records.length,
    issueCount: records.reduce((total, record) => total + record.issues.length, 0),
    records,
  };
}

function collectGeodesicCreatureDebugRecord(
  runtime: GeodesicCreatureRuntime,
  world: CompiledCellComplex,
  registry: RuntimeObjectRegistry,
  cellRoots: ReadonlyMap<string, THREE.Object3D>,
): GeodesicCreatureDebugRecord {
  runtime.root.updateMatrixWorld(true);

  const object = registry.get(runtime.objectId);
  const cell = world.cellsById.get(runtime.cellId);
  const expectedParent = cellRoots.get(runtime.cellId);
  const parentCellId = findParentCellId(runtime.root.parent, cellRoots);
  const worldPosition = new THREE.Vector3();
  runtime.root.getWorldPosition(worldPosition);

  const issues: string[] = [];

  if (!cell) {
    issues.push("runtime-cell-missing");
  }

  if (!object) {
    issues.push("registry-object-missing");
  } else {
    if (object.cellId !== runtime.cellId) {
      issues.push("registry-cell-mismatch");
    }

    // The 'geodesci-marmot' spelling is the registry's actual kind literal.
    if (object.kind !== "geodesci-marmot" && object.kind !== "geo-mouse" && object.kind !== "geo-butterfly") {
      issues.push("registry-kind-mismatch");
    }
  }

  if (expectedParent && runtime.root.parent !== expectedParent) {
    issues.push("parent-cell-mismatch");
  }

  const ancestorsVisible = objectAndAncestorsVisible(runtime.root);

  // A hidden root is only acceptable for portal-rendered objects whose visibility is managed per portal path.
  if (!runtime.root.visible || (!object?.portalRenderable && !ancestorsVisible)) {
    issues.push("render-hidden");
  }

  if (!isFiniteThreeVector(runtime.root.position)) {
    issues.push("root-position-non-finite");
  }

  if (!isFiniteThreeVector(worldPosition)) {
    issues.push("world-position-non-finite");
  }

  const state = object ? runtimeObjectToDynamicObjectState(object) : undefined;
  const expectedThreePosition = state ? worldPointToThree(state.localPose.translation) : undefined;

  if (state && !isFiniteVec3(state.localPose.translation)) {
    issues.push("local-position-non-finite");
  }

  if (expectedThreePosition && runtime.root.position.distanceTo(expectedThreePosition) > 1e-4) {
    issues.push("root-pose-mismatch");
  }

  const bounds = state ? getDynamicObjectCollisionBounds(state) : undefined;

  if (bounds && !isFiniteVec3(bounds.center)) {
    issues.push("collision-center-non-finite");
  }

  if (bounds && (!Number.isFinite(bounds.radius) || !Number.isFinite(bounds.halfHeight))) {
    issues.push("collision-size-non-finite");
  }

  if (cell && state) {
    // Collision against the cell with forbidden zones ignored: detects creatures embedded in walls or outside the cell.
    const collision = testCellCollision({
      cell,
      object: state,
      ignoreForbiddenZones: true,
    });

    if (collision.blocked) {
      issues.push(`collision-${collision.reason ?? "blocked"}`);
    }

    if (bounds) {
      for (const side of cell.sides) {
        // Cylinder centre is farther than its radius outside a side plane, i.e. completely outside that side.
        if (signedDistanceToSide(side, bounds.center) < -bounds.radius) {
          issues.push(`outside-side-${side.sideIndex}`);
        }
      }
    }
  }

  return {
    id: runtime.objectId,
    kind: object?.kind,
    runtimeCellId: runtime.cellId,
    registryCellId: object?.cellId,
    parentCellId,
    localPosition: state ? roundVec3(state.localPose.translation) : undefined,
    threePosition: roundThreeVector3(runtime.root.position),
    expectedThreePosition: expectedThreePosition ? roundThreeVector3(expectedThreePosition) : undefined,
    collisionCenter: bounds ? roundVec3(bounds.center) : undefined,
    collisionRadius: bounds ? roundNumber(bounds.radius) : undefined,
    collisionHalfHeight: bounds ? roundNumber(bounds.halfHeight) : undefined,
    renderVisible: runtime.root.visible,
    ancestorsVisible,
    issues,
  };
}

// Reverse lookup of the cell whose root node is `parent`.
function findParentCellId(
  parent: THREE.Object3D | null,
  cellRoots: ReadonlyMap<string, THREE.Object3D>,
): string | undefined {
  for (const [cellId, root] of cellRoots) {
    if (parent === root) {
      return cellId;
    }
  }

  return undefined;
}

function isFiniteThreeVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function objectAndAncestorsVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (!current.visible) {
      return false;
    }

    current = current.parent;
  }

  return true;
}

function isFiniteVec3(value: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function roundVec3(point: { readonly x: number; readonly y: number; readonly z: number }): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  return {
    x: roundNumber(point.x),
    y: roundNumber(point.y),
    z: roundNumber(point.z),
  };
}

function roundThreeVector3(point: THREE.Vector3): { readonly x: number; readonly y: number; readonly z: number } {
  return roundVec3(point);
}

// Round to 6 decimals to keep dumps compact and diffable.
function roundNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
