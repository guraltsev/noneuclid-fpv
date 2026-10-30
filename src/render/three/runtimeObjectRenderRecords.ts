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
 * Horizontal render footprint radius of an object: the largest horizontal distance (Three x and z) from the object
 * root to any corner of any source mesh's bounding box, expressed in the root's frame. Zero when there are no sources.
 * Calls `updateMatrixWorld(true)` on each source root.
 */
export function computeRenderSourceFootprintRadius(sources: readonly RuntimeObjectRenderSourceMesh[]): number {
  let radius = 0;
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
          radius = Math.max(radius, Math.hypot(corner.x, corner.z));
        }
      }
    }
  }

  return radius;
}
