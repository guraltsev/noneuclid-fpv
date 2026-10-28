/**
 * Large plane drawn below the cells so the void reads as ground.
 *
 * A single flat, unlit, double-sided black square (1000 m on a side) at world z = -1 m, i.e. one metre below the cell floors
 * (cell-local z = 0). It is expressed directly in the Three.js frame (y up) at the scene root, is not tied to any cell
 * or portal path, and is never frustum-culled so it stays visible whichever cell the camera is in.
 */
import * as THREE from "three";

/** Side length of the square floor plane, meters; large enough to read as infinite from inside the cells. */
export const underCellInfinityFloorSizeMeters = 1_000;
/** Height of the plane as a world-frame z coordinate, meters (-1 m); it is applied as the Three.js y position. */
export const underCellInfinityFloorWorldZMeters = -1;

/**
 * Creates the large black plane drawn below the cells so that the void reads as ground.
 *
 * The plane lies horizontally at height -1 m (rotated -90 degrees about x so its face normal is +y, Three.js up),
 * centred on the origin of the Three.js frame, double sided, unlit and not frustum-culled. The caller owns the
 * geometry and material.
 */
export function createUnderCellInfinityFloor(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    underCellInfinityFloorSizeMeters,
    underCellInfinityFloorSizeMeters,
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "under-cell-infinity-floor";
  // PlaneGeometry is built in the xy plane; rotate it flat into the xz plane.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = underCellInfinityFloorWorldZMeters;
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
