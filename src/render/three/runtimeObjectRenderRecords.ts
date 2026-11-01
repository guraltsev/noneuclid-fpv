/**
 * Data records describing where runtime (non-static) objects should be drawn, and the source meshes they instance.
 *
 * A `RuntimeObjectRenderRecord` says "draw archetype K at `localMatrix` inside cell C"; the instancing step
 * (`renderPortalInstances`) composes it with each visible path's `rootFromDestinationMatrix` so the object
 * appears once per portal path that shows cell C, including ghost copies in neighbouring cells
 * (`runtimeObjectGhostRecords`). Source meshes are taken from a normal Three.js object, then hidden so only
 * the instanced copies are drawn.
 */

import * as THREE from "three";

/** Request to draw one archetype of one runtime object at a cell-local pose. */
export interface RuntimeObjectRenderRecord {
  /** Id of the runtime object this record belongs to. */
  readonly objectId: string;
  /** Cell whose local frame `localMatrix` is expressed in. */
  readonly cellId: string;
  /** Key of the `RuntimeObjectRenderArchetype` (one per source mesh) to instance. */
  readonly archetypeKey: string;
  /** Object-root-to-cell transform in Three axes, applied before the path's rootFromDestination. */
  readonly localMatrix: THREE.Matrix4;
  /** If true, do not draw this record in the root cell itself (depth-0 path), only through portals; used for the viewer's own body. */
  readonly omitRootVisiblePath?: boolean;
  /** If set and positive, skip any instance whose origin is closer than this many meters to a camera. */
  readonly suppressWithinCameraDistanceMeters?: number;
}

/** A mesh of a runtime object's source hierarchy, to be baked into an instanced archetype. */
export interface RuntimeObjectRenderSourceMesh {
  readonly objectId: string;
  /** Stable key `<prefix>:mesh:<index>` in traversal order. */
  readonly archetypeKey: string;
  readonly mesh: THREE.Mesh;
  /** Root of the object hierarchy; the mesh's pose is baked relative to this node. */
  readonly root: THREE.Object3D;
}

/**
 * Collects every `Mesh` under `root` as an instancing source and hides the originals.
 *
 * Calls `updateMatrixWorld(true)` on `root`. Meshes are numbered in depth-first traversal order, so keys are stable
 * as long as the hierarchy is. Side effect: sets `visible = false` on each collected mesh.
 */
export function collectRuntimeObjectRenderSourceMeshes(
  objectId: string,
  root: THREE.Object3D,
  archetypeKeyPrefix: string,
): readonly RuntimeObjectRenderSourceMesh[] {
  root.updateMatrixWorld(true);
  const sources: RuntimeObjectRenderSourceMesh[] = [];
  let meshIndex = 0;

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    sources.push({
      objectId,
      archetypeKey: `${archetypeKeyPrefix}:mesh:${meshIndex}`,
      mesh: child,
      root,
    });
    child.visible = false;
    meshIndex += 1;
  });

  return sources;
}

/** Archetype-key prefix shared by the glTF model meshes of all placed flags of one `flagType`. */
export function placedFlagModelArchetypeKeyPrefix(flagType: string): string {
  return `placed-flag:${flagType}:model`;
}

const placedFlagTextPlanePrefix = "placed-flag-text-plane:";

/**
 * Like {@link collectRuntimeObjectRenderSourceMeshes}, but meshes named `placed-flag-text-plane:*` get keys under
 * `ownPrefix` and every other mesh under the shared model prefix of `flagType`; both are numbered separately in
 * traversal order. Placed flags of one type thereby share the archetypes (and draw calls) of their model meshes while
 * each keeps its own text planes. Same side effects as the plain collector (updates world matrices, hides meshes).
 */
export function collectPlacedFlagRenderSourceMeshes(
  flagId: string,
  flagType: string,
  root: THREE.Object3D,
  ownPrefix: string,
): readonly RuntimeObjectRenderSourceMesh[] {
  root.updateMatrixWorld(true);
  const modelPrefix = placedFlagModelArchetypeKeyPrefix(flagType);
  const sources: RuntimeObjectRenderSourceMesh[] = [];
  let modelIndex = 0;
  let ownIndex = 0;

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const isTextPlane = child.name.startsWith(placedFlagTextPlanePrefix);
    sources.push({
      objectId: flagId,
      archetypeKey: isTextPlane ? `${ownPrefix}:mesh:${ownIndex}` : `${modelPrefix}:mesh:${modelIndex}`,
      mesh: child,
      root,
    });
    child.visible = false;
    if (isTextPlane) {
      ownIndex += 1;
    } else {
      modelIndex += 1;
    }
  });

  return sources;
}

/**
 * What is drawn of an object (or of one part of it) reaches this far horizontally: a disk in the object's own frame (world axes, z up).
 * The portal ghosts of the object are decided by this disk and by nothing else, so every drawn part must have one.
 */
export interface RenderFootprint {
  /** Centre of the disk, in the object's own frame: x and y in meters. Not necessarily the object's origin or its collision centre. */
  readonly center: { readonly x: number; readonly y: number };
  /** Radius in meters; positive. */
  readonly radiusMeters: number;
}

/**
 * The render footprint of the drawn source meshes: the horizontal bounding box of every corner of every source mesh's bounding box, expressed
 * in the object root's frame, as a disk around the box centre that holds all of its corners. Returns undefined when there are no sources or
 * every box is empty (nothing measurable is drawn): the caller must treat that as a failure, never as "no footprint needed".
 * Converts from Three axes (x, z horizontal) to the object's world axes (x, y = -z). Calls `updateMatrixWorld(true)` on each source root.
 */
export function computeRenderSourceFootprint(sources: readonly RuntimeObjectRenderSourceMesh[]): RenderFootprint | undefined {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const corner = new THREE.Vector3();
  const rootInverse = new THREE.Matrix4();
  const rootFromMesh = new THREE.Matrix4();

  for (const source of sources) {
    source.root.updateMatrixWorld(true);
    const geometry = source.mesh.geometry;

    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }

    const box = geometry.boundingBox;

    if (!box || box.isEmpty()) {
      continue;
    }

    rootInverse.copy(source.root.matrixWorld).invert();
    rootFromMesh.multiplyMatrices(rootInverse, source.mesh.matrixWorld);

    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).applyMatrix4(rootFromMesh);
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minZ = Math.min(minZ, corner.z);
          maxZ = Math.max(maxZ, corner.z);
        }
      }
    }
  }

  if (!(maxX >= minX) || !(maxZ >= minZ)) {
    return undefined;
  }

  const radiusMeters = Math.hypot(maxX - minX, maxZ - minZ) / 2;

  return radiusMeters > 0
    ? { center: { x: (minX + maxX) / 2, y: -((minZ + maxZ) / 2) }, radiusMeters }
    : undefined;
}
