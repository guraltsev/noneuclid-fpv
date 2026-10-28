/**
 * Instanced-mesh archetypes for runtime objects: one `THREE.InstancedMesh` per source mesh, drawn once per visible portal path.
 *
 * Each archetype bakes its source mesh's transform relative to the object root into a cloned geometry (so an
 * instance matrix only needs the object's pose composed with a path's `rootFromDestination`), clones the
 * material, optionally patches it with `patchPortalClipMaterial`, and carries the two per-instance attributes
 * `portalPathId` and `portalClipIndex` used by the clip shader. Capacity is fixed at creation
 * (`recordCount * maxVisiblePaths`, at least 1); instances beyond it are dropped and reported through
 * `RuntimeObjectRenderArchetypeDiagnostics`. Frustum culling is off because instance bounds are not tracked.
 */

import * as THREE from "three";
import { patchPortalClipMaterial, type PortalClipMaterialState } from "./portalClipMaterial";
import type { RuntimeObjectRenderRecord, RuntimeObjectRenderSourceMesh } from "./runtimeObjectRenderRecords";
import { disposeMaterial } from "./runtimeSceneUtils";

/** An instanced mesh plus its per-instance portal attributes for one runtime-object source mesh. */
export interface RuntimeObjectRenderArchetype {
  /** Key shared with the `RuntimeObjectRenderRecord`s that use this archetype. */
  readonly archetypeKey: string;
  readonly mesh: THREE.InstancedMesh;
  /** Per-instance portal path id (float) read by the clip shader. */
  readonly portalPathIdAttribute: THREE.InstancedBufferAttribute;
  /** Per-instance clip-texture row, -2 for unclipped, -1 for no slot. */
  readonly portalClipIndexAttribute: THREE.InstancedBufferAttribute;
  /** Maximum instances that can be drawn per frame. */
  readonly capacity: number;
  /** Id of the runtime object the source mesh came from. */
  readonly sourceObjectId: string;
}

/** Per-frame collector of runtime-object archetypes whose capacity was exceeded. */
export interface RuntimeObjectRenderArchetypeDiagnostics {
  /** Clears recorded overflows; call at the start of each frame. */
  reset(): void;
  /** Records that `archetype` was asked for `requestedCount` instances. */
  recordCapacityOverflow(archetype: RuntimeObjectRenderArchetype, requestedCount: number): void;
  /** Sorted keys of overflowed archetypes since the last reset. */
  readonly capacityOverflowArchetypes: readonly string[];
  /** Number of distinct overflowed archetypes. */
  readonly capacityOverflowCount: number;
}

/** Creates an empty overflow collector keyed by archetype key. */
export function createRuntimeObjectRenderArchetypeDiagnostics(): RuntimeObjectRenderArchetypeDiagnostics {
  const capacityOverflowArchetypes = new Set<string>();

  return {
    reset() {
      capacityOverflowArchetypes.clear();
    },
    recordCapacityOverflow(archetype) {
      capacityOverflowArchetypes.add(archetype.archetypeKey);
    },
    get capacityOverflowArchetypes() {
      return [...capacityOverflowArchetypes].sort();
    },
    get capacityOverflowCount() {
      return capacityOverflowArchetypes.size;
    },
  };
}

/**
 * Builds the instanced mesh for one source mesh with room for `capacity` instances.
 *
 * Geometry and material are cloned (the source is untouched). The geometry is transformed by
 * `inverse(root.matrixWorld) * mesh.matrixWorld`, i.e. into the object root's frame. The mesh starts with
 * `count = 0` and dynamic-draw buffers. Pass `portalClipMaterialState` to enable portal clipping.
 */
export function buildRuntimeObjectRenderArchetype(
  source: RuntimeObjectRenderSourceMesh,
  capacity: number,
  portalClipMaterialState: PortalClipMaterialState | undefined,
): RuntimeObjectRenderArchetype {
  const geometry = source.mesh.geometry.clone();
  const rootFromWorld = new THREE.Matrix4().copy(source.root.matrixWorld).invert();
  geometry.applyMatrix4(rootFromWorld.multiply(source.mesh.matrixWorld));

  const material = cloneMaterial(source.mesh.material);
  const clippedMaterial = portalClipMaterialState ? patchPortalClipMaterial(material, portalClipMaterialState) : material;
  const mesh = new THREE.InstancedMesh(geometry, clippedMaterial, capacity);
  const portalPathIdAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const portalClipIndexAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);

  mesh.name = `runtime-object-archetype:${source.archetypeKey}`;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  portalPathIdAttribute.setUsage(THREE.DynamicDrawUsage);
  portalClipIndexAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("portalPathId", portalPathIdAttribute);
  geometry.setAttribute("portalClipIndex", portalClipIndexAttribute);
  mesh.userData = {
    kind: "runtime-object-render-archetype",
    objectId: source.objectId,
    archetypeKey: source.archetypeKey,
  };

  return {
    archetypeKey: source.archetypeKey,
    mesh,
    portalPathIdAttribute,
    portalClipIndexAttribute,
    capacity,
    sourceObjectId: source.objectId,
  };
}

/** Disposes the cloned geometry and materials of the given archetypes (not textures shared with other materials). */
export function disposeRuntimeObjectRenderArchetypes(
  archetypes: Iterable<RuntimeObjectRenderArchetype>,
): void {
  for (const archetype of archetypes) {
    archetype.mesh.geometry.dispose();
    disposeMaterial(archetype.mesh.material);
  }
}

/** Groups records by `archetypeKey`, preserving order within each group. */
export function groupRuntimeObjectRenderRecordsByArchetype(
  records: readonly RuntimeObjectRenderRecord[],
): ReadonlyMap<string, readonly RuntimeObjectRenderRecord[]> {
  const grouped = new Map<string, RuntimeObjectRenderRecord[]>();

  for (const record of records) {
    const existing = grouped.get(record.archetypeKey);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(record.archetypeKey, [record]);
    }
  }

  return grouped;
}

/** Returns the instance capacity needed if every record is drawn on every visible path: max(1, recordCount x maxVisiblePaths). */
export function deriveRuntimeObjectRenderArchetypeCapacity(
  recordCount: number,
  maxVisiblePaths: number,
): number {
  return Math.max(1, recordCount * maxVisiblePaths);
}

function cloneMaterial(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => entry.clone());
  }

  return material.clone();
}
