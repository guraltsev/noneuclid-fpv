/**
 * Small scene-graph, geometry, and pose helpers shared by the app shell.
 * Covers traversal helpers (disable culling/shadows, dispose), planar cell helpers (center, warm-up views), and yaw/pose utilities. Positions are meters in the cell-local frame (x right, y forward, z up) unless a function says it works on Three.js objects; yaw is radians about +z.
 * `disposeObject3D`/`disposeMaterial` free GPU geometry and materials only; the `...WithTextures` variants also dispose material `map` textures and must only be used on textures the caller created. None of them remove objects from their parent.
 */
import * as THREE from "three";
import { type AppState } from "../../appState";
import { type CompiledPrismCell } from "../../cell-complex/prismCells";
import { yawRigidTransform3 } from "../../math/rigidTransform3";
import { type Vec3 } from "../../math/vec3";
import { DEFAULT_PLAYER_EYE_HEIGHT_METERS } from "../../movement/playerBody";
import { type CellDeformationMap, transformRigidPoseWithMap } from "../../runtime/worldGeometryDeformations";
import { type RuntimeWorldObject } from "../../world-objects/runtimeObjectRegistry";
import { buildForbiddenZoneWireframe } from "./debugCollisionWireframes";

/** Type guard: true for runtime objects rendered by the geodesic renderer (cannon, segment or intersection). */
export function isGeodesicRuntimeRenderObject(
  object: RuntimeWorldObject,
): object is Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" | "geodesic-segment" | "geodesic-intersection" }> {
  return object.kind === "geodesic-cannon" ||
    object.kind === "geodesic-segment" ||
    object.kind === "geodesic-intersection";
}

/** Turns off frustum culling for root and every descendant, so portal-clipped content is never culled by the camera frustum. */
export function disableFrustumCulling(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.frustumCulled = false;
  });
}

/** Turns off shadow casting and receiving for root and every descendant. */
export function disableShadows(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

/**
 * Returns four camera poses at the cell's vertex centroid (yaw 0, 90, 180 and 270 degrees) used to warm up rendering of a cell.
 * The eye height is min(cell height - 0.1 m, default player eye height). Position is cell-local meters and yawRadians is radians.
 */
export function createCellWarmupViews(cell: AppState["world"]["cells"][number]) {
  const center = getCellCenter(cell);
  // Keep the eye below the ceiling for low cells.
  const eyeZ = Math.min(cell.heightMeters - 0.1, DEFAULT_PLAYER_EYE_HEIGHT_METERS);

  return [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((yawRadians) => ({
    position: {
      x: center.x,
      y: center.y,
      z: eyeZ,
    },
    yawRadians,
  }));
}

/** Returns the arithmetic mean of the cell's base polygon vertices (meters, cell-local x/y); returns (0, 0) for a cell with no vertices. */
export function getCellCenter(cell: AppState["world"]["cells"][number]): { readonly x: number; readonly y: number } {
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
  };
}

/** Disposes geometry and materials of every Mesh and Line under object (including object itself); textures and non-mesh objects are untouched, and object is not detached from its parent. */
export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

/** Disposes one material or each material of an array. */
export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
    return;
  }

  material.dispose();
}

/**
 * Like `disposeMaterial`, but also disposes the material's `map` texture when it has one. Use only for materials whose map this module created (for example a canvas texture); never for maps shared with GLTF-derived assets.
 */
export function disposeMaterialWithTextures(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
    return;
  }

  if ("map" in material && material.map instanceof THREE.Texture) {
    material.map.dispose();
  }
  material.dispose();
}

/**
 * Disposes geometry, materials and material `map` textures of every Mesh and Sprite under object (including object itself). Use only for subtrees that own their textures; object is not detached from its parent.
 */
export function disposeObject3DWithTextures(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
      child.geometry?.dispose();
      disposeMaterialWithTextures(child.material);
    }
  });
}

/** Returns the squared Euclidean distance between two points, in square meters. */
export function distanceSquared(left: Vec3, right: Vec3): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Extracts the yaw (radians, about +z, atan2 of m10 and m00) from a pose's rotation matrix. */
export function yawFromPose(pose: { readonly rotation: { readonly m00: number; readonly m10: number } }): number {
  return Math.atan2(pose.rotation.m10, pose.rotation.m00);
}

/** Returns the yaw (radians) of a yaw-only pose at atPoint after pushing it through a deformation map. */
export function transformYawWithMap(
  yawRadians: number,
  atPoint: Vec3,
  map: CellDeformationMap,
): number {
  return yawFromPose(transformRigidPoseWithMap(yawRigidTransform3(yawRadians, atPoint), map));
}

/** Builds a group with one forbidden-zone collision wireframe per forbidden zone of the cell; the caller owns the group and must dispose it (see disposeObject3D). */
export function buildCurrentCellForbiddenZoneWireframes(cell: CompiledPrismCell): THREE.Object3D {
  const group = new THREE.Group();
  group.name = `forbidden-zone-wireframes:${cell.id}`;

  for (const zone of cell.forbiddenZones) {
    group.add(buildForbiddenZoneWireframe(cell.id, zone.collision, cell.heightMeters));
  }

  return group;
}

/** Returns the render-archetype key prefix for a runtime object: kind and id, plus the flag type for placed flags. */
export function runtimeObjectArchetypeKeyPrefix(object: RuntimeWorldObject): string {
  if (object.kind === "placed-flag") {
    return `placed-flag:${object.flagType}:${object.id}`;
  }

  return `${object.kind}:${object.id}`;
}

/** Rounds value to the nearest integer and clamps it to [ceil(min), floor(max)]; if that interval is empty the result is the lower bound, ceil(min). */
export function clampInteger(value: number, min: number, max: number): number {
  return Math.max(Math.ceil(min), Math.min(Math.floor(max), Math.round(value)));
}
