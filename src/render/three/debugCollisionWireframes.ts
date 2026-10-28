/**
 * Debug wireframes for collision volumes: forbidden-zone (singularity) columns and object collision cylinders.
 *
 * All shapes are drawn as line-segment outlines of a unit cylinder (diameter 1, height 1, axis along Three.js y) that is
 * positioned and non-uniformly scaled to the real cylinder (radius and height in meters). Positions come from the cell-local
 * world frame (x right, y forward, z up) and are mapped to the Three.js frame by `worldPointToThree`. Two variants exist for
 * objects: one parented under the object's own node (compensating for the object's pose) and one placed directly in the
 * cell's axes. Objects without collision bounds are hidden (`visible = false`) and shown again once bounds exist.
 */
import * as THREE from "three";
import type { SingularityCollisionCylinder } from "../../cell-complex/forbiddenZones";
import { getDynamicObjectCollisionBounds } from "../../movement/collision";
import type { DynamicObjectState } from "../../movement/dynamicObject";
import { rigidTransformToThreeMatrix, worldPointToThree } from "./worldAxes";

// Colours as 0xRRGGBB: red for forbidden zones, green for object collision.
const forbiddenZoneWireframeColor = 0xff3b30;
const objectCollisionWireframeColor = 0x37d67a;
// Facets per circle of the outline.
const cylinderCircleSegments = 24;

/**
 * Builds the wireframe of a singularity exclusion cylinder in cell `cellId`.
 *
 * Positioned at the cylinder centre (cell-local frame converted to Three.js) with diameter 2 * radius. Height is the
 * cylinder's own height when finite; for infinite columns it is `displayHeightMeters`, else max(2 * centre.z, 1) m.
 * The mesh is tagged in `userData` (`debugWireframeKind: "forbidden-zone"`) and drawn late (renderOrder 900) without depth writes.
 */
export function buildForbiddenZoneWireframe(
  cellId: string,
  exclusionCylinder: SingularityCollisionCylinder,
  displayHeightMeters?: number,
): THREE.LineSegments {
  const height = Number.isFinite(exclusionCylinder.height)
    ? exclusionCylinder.height
    : displayHeightMeters ?? Math.max(exclusionCylinder.center.z * 2, 1);
  const geometry = buildSimpleCylinderOutlineGeometry();
  const material = new THREE.LineBasicMaterial({
    color: forbiddenZoneWireframeColor,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = `forbidden-zone-wireframe:${cellId}:${exclusionCylinder.junctionId}`;
  mesh.position.copy(worldPointToThree(exclusionCylinder.center));
  mesh.scale.set(exclusionCylinder.radius * 2, height, exclusionCylinder.radius * 2);
  mesh.renderOrder = 900;
  mesh.userData = {
    kind: "debug-wireframe",
    debugWireframeKind: "forbidden-zone",
    cellId,
    junctionId: exclusionCylinder.junctionId,
  };
  return mesh;
}

/**
 * Builds a collision wireframe meant to be a child of the object's own Three.js node.
 *
 * The initial transform comes from {@link updateObjectCollisionWireframe}. Hidden if the object has no collision bounds.
 */
export function buildObjectCollisionWireframe(
  objectId: string,
  object: DynamicObjectState,
): THREE.LineSegments {
  const mesh = createObjectCollisionWireframe(objectId);
  updateObjectCollisionWireframe(mesh, object);
  return mesh;
}

/**
 * Builds a collision wireframe meant to be a child of the cell's root node (cell axes, not the object's frame).
 *
 * The initial transform comes from {@link updateObjectCollisionWireframeInCellAxes}. Hidden if the object has no collision bounds.
 */
export function buildObjectCollisionWireframeInCellAxes(
  objectId: string,
  object: DynamicObjectState,
): THREE.LineSegments {
  const mesh = createObjectCollisionWireframe(objectId);
  updateObjectCollisionWireframeInCellAxes(mesh, object);
  return mesh;
}

function createObjectCollisionWireframe(objectId: string): THREE.LineSegments {
  const geometry = buildSimpleCylinderOutlineGeometry();
  const material = new THREE.LineBasicMaterial({
    color: objectCollisionWireframeColor,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.name = `object-collision-wireframe:${objectId}`;
  mesh.renderOrder = 910;
  mesh.userData = {
    kind: "debug-wireframe",
    debugWireframeKind: "object-collision",
    objectId,
  };
  return mesh;
}

/**
 * Re-poses a wireframe that is parented under the object's node so that it matches the object's collision cylinder.
 *
 * Collision bounds are in the cell-local frame, whereas the mesh's transform is relative to the object's node, so the
 * object's pose matrix is inverted out: local = inverse(pose) * (cell-frame cylinder transform). Sets `visible` to
 * whether the object has collision bounds (leaving the transform unchanged when it has none).
 */
export function updateObjectCollisionWireframe(mesh: THREE.Object3D, object: DynamicObjectState): void {
  const bounds = getDynamicObjectCollisionBounds(object);

  mesh.visible = bounds !== undefined;
  if (!bounds) {
    return;
  }

  // Object pose as a Three.js matrix; cylinder placement is expressed in the cell frame and then moved into the object's frame.
  const rootMatrix = rigidTransformToThreeMatrix(object.localPose);
  const desiredCellMatrix = new THREE.Matrix4().compose(
    worldPointToThree(bounds.center),
    new THREE.Quaternion(),
    // Unit cylinder has diameter 1 and height 1: scale x/z by the diameter and y by the full height.
    new THREE.Vector3(bounds.radius * 2, bounds.halfHeight * 2, bounds.radius * 2),
  );
  const localMatrix = rootMatrix.clone().invert().multiply(desiredCellMatrix);

  localMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
}

/**
 * Re-poses a wireframe that is parented under the cell root so that it matches the object's collision cylinder.
 *
 * Sets position and scale directly from the bounds (cylinders are axis-aligned with z, so no rotation). Sets
 * `visible` to whether the object has collision bounds, so the wireframe reappears when bounds return.
 */
export function updateObjectCollisionWireframeInCellAxes(mesh: THREE.Object3D, object: DynamicObjectState): void {
  const bounds = getDynamicObjectCollisionBounds(object);

  mesh.visible = bounds !== undefined;
  if (!bounds) {
    return;
  }

  mesh.position.copy(worldPointToThree(bounds.center));
  mesh.quaternion.identity();
  mesh.scale.set(bounds.radius * 2, bounds.halfHeight * 2, bounds.radius * 2);
}

// Unit cylinder outline: two horizontal circles at y = +/-0.5 and four vertical lines at the compass points.
function buildSimpleCylinderOutlineGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const halfHeight = 0.5;

  for (let index = 0; index < cylinderCircleSegments; index += 1) {
    const startAngle = (index / cylinderCircleSegments) * Math.PI * 2;
    const endAngle = ((index + 1) / cylinderCircleSegments) * Math.PI * 2;
    addHorizontalCircleSegment(positions, -halfHeight, startAngle, endAngle);
    addHorizontalCircleSegment(positions, halfHeight, startAngle, endAngle);
  }

  addLine(positions, 0.5, -halfHeight, 0, 0.5, halfHeight, 0);
  addLine(positions, -0.5, -halfHeight, 0, -0.5, halfHeight, 0);
  addLine(positions, 0, -halfHeight, 0.5, 0, halfHeight, 0.5);
  addLine(positions, 0, -halfHeight, -0.5, 0, halfHeight, -0.5);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function addHorizontalCircleSegment(
  positions: number[],
  y: number,
  startAngle: number,
  endAngle: number,
): void {
  addLine(
    positions,
    Math.cos(startAngle) * 0.5,
    y,
    Math.sin(startAngle) * 0.5,
    Math.cos(endAngle) * 0.5,
    y,
    Math.sin(endAngle) * 0.5,
  );
}

function addLine(
  positions: number[],
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
): void {
  positions.push(startX, startY, startZ, endX, endY, endZ);
}
