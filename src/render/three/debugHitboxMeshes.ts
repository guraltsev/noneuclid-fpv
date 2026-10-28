/**
 * Debug meshes that visualize selectable hitboxes (translucent solids) and aim collision outlines (wireframes) of runtime world objects.
 * Meshes are built in the owning cell's local frame (meters; world x right, y forward, z up) and converted to Three.js with worldAxes, so they are meant to be parented to the cell root. All meshes disable frustum culling, do not write depth and use high renderOrder values so they draw over the scene.
 * Lifecycle: every builder allocates new geometry and materials; the caller owns the result and must free it with disposeObject3D.
 */
import * as THREE from "three";
import { type SimpleCylinderBounds, getDynamicObjectCollisionBounds } from "../../movement/collision";
import { createProtractorAngleLabelHitbox } from "../../world-objects/protractorTool";
import { type RuntimeWorldObject, runtimeObjectToDynamicObjectState } from "../../world-objects/runtimeObjectRegistry";
import {
  geodesicSegmentAimRadiusMeters,
  getGeodesicEmitterAimCylinderBounds,
  getGeodesicEmitterAimSphereCenter,
} from "./aimTarget";
import { worldPointToThree } from "./worldAxes";

/** Color (hex RGB) of geodesic segment selectable-hitbox meshes. */
export const selectableGeodesicSegmentHitboxDebugColor = 0xff2bd6;
/** Color (hex RGB) of all aim-collision outline wireframes. */
export const aimCollisionOutlineDebugColor = 0xff44ff;
/** Opacity of selectable-hitbox meshes (0 to 1). */
export const selectableHitboxDebugOpacity = 0.24;
/** Opacity of aim-collision outline wireframes (0 to 1). */
export const aimCollisionOutlineDebugOpacity = 0.82;
/** Three.js render order of selectable-hitbox meshes, above normal scene content. */
export const selectableHitboxDebugRenderOrder = 930;
/** Three.js render order of aim-collision outlines, just above the selectable hitboxes. */
export const aimCollisionOutlineDebugRenderOrder = 935;

/** Builds an open-ended translucent cylinder showing a vertical cylinder hitbox; bounds are in cell-local meters and color is a hex RGB value. */
export function buildCylinderSelectableHitboxDebugMesh(
  bounds: SimpleCylinderBounds,
  color: number,
): THREE.Mesh {
  // Unit open-ended cylinder; position and non-uniform scale below fit it to the bounds (Three.js Y axis is world up).
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  const material = createSelectableHitboxDebugMaterial(color);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "selectable-hitbox:cylinder";
  mesh.position.copy(worldPointToThree(bounds.center));
  mesh.scale.set(bounds.radius, bounds.halfHeight * 2, bounds.radius);
  mesh.renderOrder = selectableHitboxDebugRenderOrder;
  mesh.frustumCulled = false;
  return mesh;
}

/** Builds a wireframe cylinder for the given vertical cylinder bounds (cell-local meters), named with the given mesh name. */
export function buildCylinderAimCollisionOutlineDebugMesh(
  bounds: SimpleCylinderBounds,
  name: string,
): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  const material = createAimCollisionOutlineDebugMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(worldPointToThree(bounds.center));
  mesh.scale.set(bounds.radius, bounds.halfHeight * 2, bounds.radius);
  mesh.renderOrder = aimCollisionOutlineDebugRenderOrder;
  mesh.frustumCulled = false;
  return mesh;
}

/** Builds a wireframe sphere of the given radius (meters) centered at a cell-local world-frame point. */
export function buildSphereAimCollisionOutlineDebugMesh(
  center: { readonly x: number; readonly y: number; readonly z: number },
  radius: number,
  name: string,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 24, 12);
  const material = createAimCollisionOutlineDebugMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(worldPointToThree(center));
  mesh.renderOrder = aimCollisionOutlineDebugRenderOrder;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Builds a box mesh for the protractor angle label hitbox using the supplied material and render order.
 * Uses the object's stored labelHitbox, or derives one from the angle geometry when absent. The box is yawed about the vertical axis by the hitbox yaw (radians). The caller-supplied material is used directly, not cloned.
 */
export function buildProtractorAngleLabelBoxDebugMesh(
  object: Extract<RuntimeWorldObject, { readonly kind: "protractor-angle" }>,
  name: string,
  material: THREE.Material,
  renderOrder: number,
): THREE.Mesh {
  const hitbox = object.labelHitbox ?? createProtractorAngleLabelHitbox({
    centerPoint: object.centerPoint,
    firstYawRadians: object.first.yawRadians,
    angleRadians: object.angleRadians,
    radiusMeters: object.radiusMeters,
  });
  const geometry = new THREE.BoxGeometry(hitbox.widthMeters, hitbox.heightMeters, hitbox.depthMeters);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(worldPointToThree(hitbox.center));
  mesh.rotation.y = hitbox.yawRadians;
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  return mesh;
}

/** Builds a group with a wireframe cylinder (the given bounds) and a wireframe sphere on top outlining a geodesic cannon's aim collision volume. */
export function buildGeodesicEmitterAimCollisionOutlineDebugMesh(
  object: Extract<RuntimeWorldObject, { readonly kind: "geodesic-cannon" }>,
  bounds: SimpleCylinderBounds,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "aim-collision-outline:geodesic-emitter";
  group.renderOrder = aimCollisionOutlineDebugRenderOrder;
  group.frustumCulled = false;
  group.add(
    buildCylinderAimCollisionOutlineDebugMesh(bounds, "aim-collision-outline:geodesic-emitter-cylinder"),
    buildSphereAimCollisionOutlineDebugMesh(
      getGeodesicEmitterAimSphereCenter(object),
      bounds.radius,
      "aim-collision-outline:geodesic-emitter-top-sphere",
    ),
  );
  return group;
}

/**
 * Builds a group of a cylinder with a sphere cap at each end, outlining the selectable volume of a geodesic segment.
 * The capsule has radius geodesicSegmentAimRadiusMeters and runs from the segment start along its direction for its length (at least 1 mm).
 */
export function buildGeodesicSegmentSelectableHitboxDebugMesh(
  object: Extract<RuntimeWorldObject, { readonly kind: "geodesic-segment" }>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "selectable-hitbox:geodesic-segment";
  group.renderOrder = selectableHitboxDebugRenderOrder;
  group.frustumCulled = false;

  const length = Math.max(0.001, object.lengthMeters);
  const segmentGeometry = new THREE.CylinderGeometry(
    geodesicSegmentAimRadiusMeters,
    geodesicSegmentAimRadiusMeters,
    length,
    20,
    1,
    true,
  );
  const material = createSelectableHitboxDebugMaterial(selectableGeodesicSegmentHitboxDebugColor);
  const segmentMesh = new THREE.Mesh(segmentGeometry, material);
  segmentMesh.name = "selectable-hitbox:geodesic-segment-body";
  segmentMesh.position.copy(worldPointToThree({
    x: object.start.x + object.direction.x * length * 0.5,
    y: object.start.y + object.direction.y * length * 0.5,
    z: object.start.z + object.direction.z * length * 0.5,
  }));
  const threeDirection = worldPointToThree(object.direction).normalize();
  // Cylinder axis is Three.js +Y; rotate it onto the segment direction.
  segmentMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), threeDirection);
  segmentMesh.renderOrder = selectableHitboxDebugRenderOrder;
  segmentMesh.frustumCulled = false;
  group.add(segmentMesh);

  const capGeometry = new THREE.SphereGeometry(geodesicSegmentAimRadiusMeters, 16, 8);
  const startCap = new THREE.Mesh(capGeometry, material.clone());
  startCap.name = "selectable-hitbox:geodesic-segment-start-cap";
  startCap.position.copy(worldPointToThree(object.start));
  startCap.renderOrder = selectableHitboxDebugRenderOrder;
  startCap.frustumCulled = false;
  group.add(startCap);

  // Segment end: start + direction * length (the body mesh is centered at half length).
  const endCap = new THREE.Mesh(capGeometry.clone(), material.clone());
  endCap.name = "selectable-hitbox:geodesic-segment-end-cap";
  endCap.position.copy(worldPointToThree({
    x: object.start.x + object.direction.x * length,
    y: object.start.y + object.direction.y * length,
    z: object.start.z + object.direction.z * length,
  }));
  endCap.renderOrder = selectableHitboxDebugRenderOrder;
  endCap.frustumCulled = false;
  group.add(endCap);

  return group;
}

/** Builds the wireframe counterpart of the segment hitbox: a capsule (cylinder plus two sphere caps) of geodesicSegmentAimRadiusMeters along the segment. */
export function buildGeodesicSegmentAimCollisionOutlineDebugMesh(
  object: Extract<RuntimeWorldObject, { readonly kind: "geodesic-segment" }>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "aim-collision-outline:geodesic-segment";
  group.renderOrder = aimCollisionOutlineDebugRenderOrder;
  group.frustumCulled = false;

  const length = Math.max(0.001, object.lengthMeters);
  const segmentGeometry = new THREE.CylinderGeometry(
    geodesicSegmentAimRadiusMeters,
    geodesicSegmentAimRadiusMeters,
    length,
    20,
    1,
    true,
  );
  const material = createAimCollisionOutlineDebugMaterial();
  const segmentMesh = new THREE.Mesh(segmentGeometry, material);
  segmentMesh.name = "aim-collision-outline:geodesic-segment-body";
  segmentMesh.position.copy(worldPointToThree({
    x: object.start.x + object.direction.x * length * 0.5,
    y: object.start.y + object.direction.y * length * 0.5,
    z: object.start.z + object.direction.z * length * 0.5,
  }));
  const threeDirection = worldPointToThree(object.direction).normalize();
  segmentMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), threeDirection);
  segmentMesh.renderOrder = aimCollisionOutlineDebugRenderOrder;
  segmentMesh.frustumCulled = false;
  group.add(segmentMesh);

  const capGeometry = new THREE.SphereGeometry(geodesicSegmentAimRadiusMeters, 16, 8);
  const startCap = new THREE.Mesh(capGeometry, material.clone());
  startCap.name = "aim-collision-outline:geodesic-segment-start-cap";
  startCap.position.copy(worldPointToThree(object.start));
  startCap.renderOrder = aimCollisionOutlineDebugRenderOrder;
  startCap.frustumCulled = false;
  group.add(startCap);

  const endCap = new THREE.Mesh(capGeometry.clone(), material.clone());
  endCap.name = "aim-collision-outline:geodesic-segment-end-cap";
  endCap.position.copy(worldPointToThree({
    x: object.start.x + object.direction.x * length,
    y: object.start.y + object.direction.y * length,
    z: object.start.z + object.direction.z * length,
  }));
  endCap.renderOrder = aimCollisionOutlineDebugRenderOrder;
  endCap.frustumCulled = false;
  group.add(endCap);

  return group;
}

/** Creates a translucent, double-sided, depth-write-free material of the given hex color for selectable hitboxes. */
export function createSelectableHitboxDebugMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    depthWrite: false,
    opacity: selectableHitboxDebugOpacity,
    side: THREE.DoubleSide,
    transparent: true,
  });
}

/** Creates the translucent double-sided wireframe material used for aim collision outlines. */
export function createAimCollisionOutlineDebugMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: aimCollisionOutlineDebugColor,
    depthWrite: false,
    opacity: aimCollisionOutlineDebugOpacity,
    side: THREE.DoubleSide,
    transparent: true,
    wireframe: true,
  });
}

/** Color (hex RGB) of selectable hitboxes for generic objects and protractor labels. */
export const selectableObjectHitboxDebugColor = 0xffc400;
/** Radius, in meters, of the fallback sphere outline used for objects without collision bounds. */
export const fallbackObjectAimCollisionRadiusMeters = 0.25;

/** Builds the selectable-hitbox debug visual for an object, or returns undefined if the object has neither tooltip nor interaction, or (for kinds other than geodesic segments and protractor labels) has no collision bounds. */
export function buildSelectableHitboxDebugMesh(object: RuntimeWorldObject): THREE.Object3D | undefined {
  if (!object.tooltip && !object.interactable) {
    return undefined;
  }

  if (object.kind === "geodesic-segment") {
    return buildGeodesicSegmentSelectableHitboxDebugMesh(object);
  }

  if (object.kind === "protractor-angle") {
    return buildProtractorAngleLabelBoxDebugMesh(
      object,
      "selectable-hitbox:protractor-angle-label",
      createSelectableHitboxDebugMaterial(selectableObjectHitboxDebugColor),
      selectableHitboxDebugRenderOrder,
    );
  }

  const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(object));
  return bounds ? buildCylinderSelectableHitboxDebugMesh(bounds, selectableObjectHitboxDebugColor) : undefined;
}

/**
 * Builds the aim-collision outline for an object, or returns undefined if the object has neither tooltip nor interaction.
 * Selects the shape by kind (segment capsule, cannon cylinder plus sphere, protractor label box), then the object's collision cylinder, then a fallback sphere centered at the object's local translation.
 */
export function buildAimCollisionOutlineDebugMesh(object: RuntimeWorldObject): THREE.Object3D | undefined {
  if (!object.tooltip && !object.interactable) {
    return undefined;
  }

  if (object.kind === "geodesic-segment") {
    return buildGeodesicSegmentAimCollisionOutlineDebugMesh(object);
  }

  if (object.kind === "geodesic-cannon") {
    const bounds = getGeodesicEmitterAimCylinderBounds(object);
    return bounds ? buildGeodesicEmitterAimCollisionOutlineDebugMesh(object, bounds) : undefined;
  }

  if (object.kind === "protractor-angle") {
    return buildProtractorAngleLabelBoxDebugMesh(
      object,
      "aim-collision-outline:protractor-angle-label",
      createAimCollisionOutlineDebugMaterial(),
      aimCollisionOutlineDebugRenderOrder,
    );
  }

  const bounds = getDynamicObjectCollisionBounds(runtimeObjectToDynamicObjectState(object));
  if (bounds) {
    return buildCylinderAimCollisionOutlineDebugMesh(bounds, "aim-collision-outline:cylinder");
  }

  return buildSphereAimCollisionOutlineDebugMesh(
    object.localPose.translation,
    fallbackObjectAimCollisionRadiusMeters,
    "aim-collision-outline:fallback-sphere",
  );
}
