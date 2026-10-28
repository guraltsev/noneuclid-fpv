/**
 * Debug overlay that draws a traced portal path through the cells it crosses.
 *
 * The polyline connects cell centroids (cell-local x right, y forward, z up, meters) expressed in the
 * root cell's frame by chaining portal transforms along the path, then converts them to the Three.js
 * frame via `worldPointToThree`. Overlays are plain scene objects owned by the caller, who must remove
 * and dispose them (see `hideCellPathOverlays`).
 */
import * as THREE from "three";
import { type AppState } from "../../appState";
import { type PortalRenderPath } from "../../cell-complex/portalPaths";
import { type CompiledPrismCell } from "../../cell-complex/prismCells";
import {
  composeRigidTransform3,
  identityRigidTransform3,
  invertRigidTransform3,
  transformPoint3,
} from "../../math/rigidTransform3";
import { disposeObject3D } from "./runtimeSceneUtils";
import { worldPointToThree } from "./worldAxes";

/**
 * Builds a group holding a three-layer glowing red line through the cell centroids of a portal path, in root-cell coordinates.
 *
 * Returns an empty group (no lines) when the path yields fewer than two points, e.g. an unknown root cell.
 * The lines ignore depth testing and frustum culling and render late. The caller adds the group to the
 * scene and disposes it; the source geometry created here is only cloned (each line owns its clone) and is
 * disposed before returning.
 */
export function createPathTraceOverlay(
  world: AppState["world"],
  path: PortalRenderPath,
): THREE.Object3D {
  const points = buildPathTracePoints(world, path);
  const group = new THREE.Group();
  group.name = `debug-cell-path-trace:${path.id}`;
  group.frustumCulled = false;

  if (points.length < 2) {
    return group;
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => worldPointToThree(point)));
  // Three stacked lines of increasing opacity fake a glow around the trace.
  const materials = [
    new THREE.LineBasicMaterial({
      color: 0xff2b2b,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
    new THREE.LineBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
    new THREE.LineBasicMaterial({
      color: 0xff4d4d,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  ];

  for (const material of materials) {
    const line = new THREE.Line(geometry.clone(), material);
    line.frustumCulled = false;
    line.renderOrder = 1000;
    group.add(line);
  }
  // Each line owns a clone; the source geometry was never attached, so release it now.
  geometry.dispose();

  return group;
}

/**
 * Computes the polyline vertices of a portal path, as cell-local points in the root cell's frame.
 *
 * Starts at the root cell's trace point and appends one point per path step: the destination cell's trace
 * point mapped back into the root frame by the inverse of the accumulated portal transforms. Steps that
 * reference missing cells or portals are skipped (their transform is not accumulated). Returns an empty
 * array if the root cell is unknown.
 */
export function buildPathTracePoints(
  world: AppState["world"],
  path: PortalRenderPath,
): readonly { readonly x: number; readonly y: number; readonly z: number }[] {
  const rootCell = world.cellsById.get(path.rootCellId);

  if (!rootCell) {
    return [];
  }

  const points = [getCellTracePoint(rootCell)];
  let accumulatedTransform = identityRigidTransform3;

  for (const step of path.steps) {
    const sourceCell = world.cellsById.get(step.sourceCellId);
    const portal = sourceCell?.portalsById.get(step.sourcePortalId);
    const destinationCell = world.cellsById.get(step.targetCellId);

    if (!sourceCell || !portal || !destinationCell) {
      continue;
    }

    // Portal transforms map source-cell coordinates to target-cell coordinates, so the inverse of the
    // running composition maps a target-cell point back into the root frame.
    accumulatedTransform = composeRigidTransform3(portal.transformToTarget, accumulatedTransform);
    points.push(transformPoint3(invertRigidTransform3(accumulatedTransform), getCellTracePoint(destinationCell)));
  }

  return points;
}

/**
 * Returns the cell's base-polygon vertex average at height z = 0.03 m (just above the floor), in cell-local meters.
 *
 * An empty vertex list yields (0, 0, 0.03).
 */
export function getCellTracePoint(cell: CompiledPrismCell): { readonly x: number; readonly y: number; readonly z: number } {
  let x = 0;
  let y = 0;

  for (const vertex of cell.baseVertices) {
    x += vertex.x;
    y += vertex.y;
  }

  const count = Math.max(1, cell.baseVertices.length);

  return {
    x: x / count,
    y: y / count,
    z: 0.03,
  };
}

/**
 * Removes every overlay in the array from the scene and disposes it, emptying the array in place.
 *
 * Safe to call with an empty array.
 */
export function hideCellPathOverlays(overlays: THREE.Object3D[], scene: THREE.Scene): void {
  while (overlays.length > 0) {
    const overlay = overlays.pop()!;
    scene.remove(overlay);
    disposeObject3D(overlay);
  }
}

/**
 * Returns triangle indices (as flat triples) that fan a convex polygon of `vertexCount` vertices around vertex 0.
 *
 * Yields an empty array for fewer than three vertices; the polygon must be convex and consistently wound for correct faces.
 */
export function triangleFanIndices(vertexCount: number): number[] {
  const indices: number[] = [];

  for (let index = 1; index < vertexCount - 1; index += 1) {
    indices.push(0, index, index + 1);
  }

  return indices;
}
